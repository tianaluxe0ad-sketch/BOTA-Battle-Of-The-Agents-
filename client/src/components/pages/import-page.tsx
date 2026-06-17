'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bot,
  BrainCircuit,
  CheckCircle2,
  Coins,
  Cpu,
  ExternalLink,
  Gamepad2,
  Globe2,
  Image as ImageIcon,
  Import as ImportIcon,
  Loader2,
  Search,
  Shield,
  Sparkles,
  Swords,
  Wallet,
} from 'lucide-react'
import { apiRequest } from '@/lib/queryClient'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { botaCharacterAlt, botaCharacterAvatar } from '@/lib/botaCharacterLayer'
import { botaAppHref } from '@/lib/botaUrl'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'
import type {
  BotaFighterProfile,
  BotaFighterProfileImportRequest,
} from '@shared/botaFighterProfile'
import { getBotaDerivativeFighter } from '@shared/botaDerivativeFighter'

type WalletAssetType = 'ai-agent' | 'nft' | 'ens' | 'token'

type ImportFilter = WalletAssetType | 'all' | 'create'

type WalletFighterAsset = {
  id: string
  type: WalletAssetType
  name: string
  subtitle: string
  source: string
  sourceIconUrl: string | null
  chainId: string
  contractAddress: string | null
  tokenId: string | null
  avatarUrl: string
  brain: 'external' | 'elizaos-default'
  fighter: BotaFighterProfileImportRequest
}

type WalletScanFeed = {
  walletAddress: string | null
  displayWallet: string
  assets: WalletFighterAsset[]
  counts: Partial<Record<WalletAssetType, number>>
  scanner: {
    mode: string
    note: string
  }
  updatedAt: string
}

type ImportResponse = {
  profile: BotaFighterProfile
}

type EnsPreviewResponse = {
  asset: WalletFighterAsset
  resolution: {
    ensName: string
    resolvedAddress: string | null
    avatarUrl: string | null
    textRecords: Record<string, string | null>
  }
  ensAgentIdentity?: EnsAgentIdentity
  updatedAt: string
}

type EnsAgentIdentity = {
  status: string
  ensName: string
  subname?: {
    suggestedName?: string | null
    configured?: boolean
  }
  registry?: {
    verificationKey?: string | null
    verified?: boolean
  }
  textRecords?: Record<string, string>
}

type ProfileBattleRow = {
  id: string
  battleId: string | null
  title: string
  status: 'queued' | 'live'
  queueState?: 'waiting' | 'matched' | 'live'
  agentId: string
  agentName: string
  opponentName: string | null
  startsAt: string
  endsAt: string
  arenaUrl: string
}

type BotaProfileFeed = {
  fighters: BotaFighterProfile[]
  queue: ProfileBattleRow[]
  liveBattles: ProfileBattleRow[]
  queueWindow?: {
    startsAt?: string | null
    endsAt?: string | null
  }
  updatedAt: string
}

const assetFilters: Array<{ value: ImportFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'ai-agent', label: 'Agents' },
  { value: 'nft', label: 'NFTs' },
  { value: 'ens', label: 'ENS' },
  { value: 'token', label: 'Tokens' },
  { value: 'create', label: 'Create Fighter' },
]

const createStyleOptions = [
  {
    value: 'adaptive',
    label: 'Adaptive',
    agentClass: 'oracle',
    archetype: 'oracle_duelist',
    personality: 'adaptive',
  },
  {
    value: 'berserker',
    label: 'Berserker',
    agentClass: 'berserker',
    archetype: 'chaos_berserker',
    personality: 'aggressive',
  },
  {
    value: 'scout',
    label: 'Scout',
    agentClass: 'scout',
    archetype: 'momentum_scout',
    personality: 'opportunistic',
  },
] as const

const sourceLogoMap: Record<string, string> = {
  ElizaOS: '/assets/source-elizaos.png',
  Bankr: '/assets/source-bankr.png',
  'Bankr Bot': '/assets/source-bankr.png',
  ENS: '/assets/ens-badge.jpg',
  NFT: '/assets/bota-bantah-icon.png',
  AgentKit: '/assets/source-agentkit.svg',
  'Meme Token': '/assets/bota-bantah-icon.png',
  'Virtuals Protocol': '/assets/source-virtuals.jpg',
}

function walletFromPrivyUser(user: unknown) {
  const record = user as {
    wallet?: { address?: string | null } | null
    linkedAccounts?: Array<{ type?: string | null; address?: string | null }>
  } | null

  const directWallet = record?.wallet?.address
  if (directWallet) return directWallet

  const linkedWallet = record?.linkedAccounts?.find((account) =>
    String(account.type || '').toLowerCase().includes('wallet'),
  )?.address
  return linkedWallet || ''
}

function assetTypeLabel(type: WalletAssetType) {
  if (type === 'ai-agent') return 'AI Agent'
  if (type === 'nft') return 'NFT'
  if (type === 'ens') return 'ENS'
  return 'Token'
}

function AssetTypeIcon({ type, size = 14 }: { type: WalletAssetType; size?: number }) {
  if (type === 'ai-agent') return <BrainCircuit size={size} />
  if (type === 'nft') return <ImageIcon size={size} />
  if (type === 'ens') return <Globe2 size={size} />
  return <Coins size={size} />
}

function SourceIcon({ asset }: { asset: WalletFighterAsset }) {
  const src = asset.sourceIconUrl || sourceLogoMap[asset.source] || null
  return (
    <span className="grid size-5 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-background text-muted-foreground">
      {src ? (
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={(event) => {
            event.currentTarget.style.display = 'none'
          }}
        />
      ) : (
        <AssetTypeIcon type={asset.type} size={12} />
      )}
    </span>
  )
}

function shortContract(asset: WalletFighterAsset) {
  const value = asset.contractAddress || asset.fighter.ensName || asset.chainId
  if (!value) return asset.chainId
  return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value
}

function sourceLine(asset: WalletFighterAsset) {
  const derivative = getBotaDerivativeFighter(asset.fighter.metadata)
  if (derivative) return 'NFT'
  if (asset.type === 'ens') return 'ENS'
  if (asset.type === 'token') return 'Meme'
  if (asset.type === 'nft') return 'NFT'
  return asset.source
}

function identityForAsset(asset: WalletFighterAsset) {
  const source = asset.source.toLowerCase()
  const logoUrl = source.includes('virtual')
    ? '/assets/source-virtuals.jpg'
    : source.includes('bankr')
      ? '/assets/source-bankr.png'
      : source.includes('eliza')
        ? '/assets/source-elizaos.png'
        : source.includes('agentkit') || source.includes('agent kit')
          ? '/assets/source-agentkit.svg'
          : asset.type === 'ens'
            ? '/assets/ens-badge.jpg'
            : '/assets/bota-bantah-icon.png'
  return {
    label: asset.source,
    logoUrl,
    brainLabel: asset.source,
  }
}

function characterSourceForAsset(asset: WalletFighterAsset) {
  const derivative = getBotaDerivativeFighter(asset.fighter.metadata)
  if (derivative) return derivative.species
  const origin = asset.fighter.origin || asset.source || asset.type
  if (asset.type === 'token') return 'meme-token'
  if (asset.type === 'ai-agent' && asset.source.toLowerCase().includes('virtual')) return 'virtuals'
  if (asset.type === 'ai-agent' && asset.source.toLowerCase().includes('game')) return 'game-sdk'
  if (asset.type === 'ai-agent') return 'eliza'
  return origin
}

function characterAvatarForAsset(asset: WalletFighterAsset) {
  const derivative = getBotaDerivativeFighter(asset.fighter.metadata)
  if (derivative && asset.fighter.avatarUrl) return asset.fighter.avatarUrl
  return botaCharacterAvatar(`${asset.id}:${asset.name}`, characterSourceForAsset(asset))
}

function derivativeForAsset(asset: WalletFighterAsset | null) {
  return asset ? getBotaDerivativeFighter(asset.fighter.metadata) : null
}

function ensAgentIdentityForAsset(asset: WalletFighterAsset | null): EnsAgentIdentity | null {
  const identity = asset?.fighter.metadata?.ensAgentIdentity
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) return null
  return identity as EnsAgentIdentity
}

function ensIdentityStatusLabel(status: string) {
  if (status === 'published') return 'Published'
  if (status === 'ready_to_publish') return 'Ready'
  if (status === 'ensip26_ready') return 'ENSIP-26 ready'
  if (status === 'needs_registry') return 'Needs registry'
  return status || 'Ready'
}

export default function ImportPage() {
  const { isAuthenticated, isLoading: authLoading, login, user } = useAuth()
  const connectedWallet = walletFromPrivyUser(user)
  const ownScanWallet = connectedWallet.trim()
  const [walletDraft, setWalletDraft] = useState(connectedWallet)
  const [filter, setFilter] = useState<ImportFilter>('all')
  const [selectedAssetId, setSelectedAssetId] = useState<string>('')
  const [createType, setCreateType] = useState<'new' | 'existing'>('new')
  const [selectedCreateAssetId, setSelectedCreateAssetId] = useState<string>('')
  const [createName, setCreateName] = useState('')
  const [createStyle, setCreateStyle] = useState(createStyleOptions[0].value)
  const [createAutoAssign, setCreateAutoAssign] = useState(true)
  const [ensDraft, setEnsDraft] = useState('')
  const isCreateMode = filter === 'create'
  const [ensPreviewAsset, setEnsPreviewAsset] = useState<WalletFighterAsset | null>(null)
  const [importedProfile, setImportedProfile] = useState<BotaFighterProfile | null>(null)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [createStatus, setCreateStatus] = useState<'idle' | 'pending' | 'success'>('idle')
  const { toast } = useToast()
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!connectedWallet) return
    setWalletDraft(connectedWallet)
  }, [connectedWallet])

  const scanQuery = useQuery<WalletScanFeed>({
    queryKey: ['/api/bantahbro/fighter-assets/scan', { walletAddress: ownScanWallet }],
    enabled: Boolean(isAuthenticated && ownScanWallet),
  })
  const profileQuery = useQuery<BotaProfileFeed>({
    queryKey: ['/api/bantahbro/profile'],
    queryFn: () => apiRequest('GET', '/api/bantahbro/profile'),
    enabled: isAuthenticated,
    staleTime: 10_000,
    refetchInterval: 20_000,
  })

  const scannedAssets = scanQuery.data?.assets || []
  const assets = useMemo(() => {
    if (!ensPreviewAsset) return scannedAssets
    const withoutPreview = scannedAssets.filter((asset) => asset.id !== ensPreviewAsset.id)
    return [ensPreviewAsset, ...withoutPreview]
  }, [ensPreviewAsset, scannedAssets])
  const visibleAssets = useMemo(
    () => assets.filter((asset) => filter === 'all' || asset.type === filter),
    [assets, filter],
  )

  const selectedAsset = useMemo(() => {
    if (isCreateMode) return null
    return assets.find((asset) => asset.id === selectedAssetId) || visibleAssets[0] || assets[0] || null
  }, [assets, selectedAssetId, visibleAssets, isCreateMode])

  const selectedCreateAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedCreateAssetId) || assets[0] || null,
    [assets, selectedCreateAssetId],
  )

  useEffect(() => {
    if (!selectedAsset || selectedAsset.id === selectedAssetId) return
    setSelectedAssetId(selectedAsset.id)
  }, [selectedAsset, selectedAssetId])

  useEffect(() => {
    if (createType === 'existing' && !selectedCreateAssetId && assets[0]) {
      setSelectedCreateAssetId(assets[0].id)
    }
  }, [createType, assets, selectedCreateAssetId])

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!isAuthenticated) throw new Error('Sign in to create a fighter.')
      const name = createName.trim()
      if (!name) throw new Error('Enter a fighter name.')
      if (createType === 'existing' && !selectedCreateAsset) throw new Error('Select an existing asset to import.')

      const selectedStyle = createStyleOptions.find((option) => option.value === createStyle)
      if (!selectedStyle) throw new Error('Pick a style.')

      const payload: BotaFighterProfileImportRequest = {
        displayName: name,
        origin: createType === 'existing' ? selectedCreateAsset?.fighter.origin || 'manual' : 'manual',
        originId:
          createType === 'existing'
            ? selectedCreateAsset?.fighter.originId || selectedCreateAsset?.id
            : undefined,
        agentClass: selectedStyle.agentClass,
        archetype: selectedStyle.archetype,
        league: 'Open League',
        walletAddress: ownScanWallet || selectedCreateAsset?.fighter.walletAddress || null,
        metadata: {
          ...(createType === 'existing' ? selectedCreateAsset?.fighter.metadata : {}),
          importedFrom: createType === 'existing' ? 'create-existing' : 'manual-create',
          selectedAssetId: createType === 'existing' ? selectedCreateAsset?.id : undefined,
          personaStyle: selectedStyle.personality,
          loadout: createAutoAssign ? 'auto' : 'manual',
        },
      }

      return apiRequest('POST', '/api/bantahbro/fighter-profiles/import', payload) as Promise<ImportResponse>
    },
    onMutate: () => {
      setIsCreateDialogOpen(true)
      setCreateStatus('pending')
    },
    onSuccess: (result) => {
      setImportedProfile(result.profile)
      setCreateStatus('success')
      queryClient.invalidateQueries({ queryKey: ['/api/bantahbro/fighter-profiles'] })
      queryClient.invalidateQueries({ queryKey: ['/api/bantahbro/agents-directory'] })
      queryClient.invalidateQueries({ queryKey: ['/api/bantahbro/profile'] })
      toast({
        title: 'Fighter deployed',
        description: `${result.profile.displayName} entered your next Arena queue.`,
      })
    },
    onError: (error: Error) => {
      setCreateStatus('idle')
      toast({
        title: 'Deploy failed',
        description: error.message,
        variant: 'destructive',
      })
    },
  })

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!isAuthenticated) throw new Error('Sign in to import this fighter.')
      if (!selectedAsset) throw new Error('Choose an asset to import.')

      const payload: BotaFighterProfileImportRequest = {
        ...selectedAsset.fighter,
        avatarUrl: characterAvatarForAsset(selectedAsset),
        walletAddress: ownScanWallet || selectedAsset.fighter.walletAddress || null,
        metadata: {
          ...selectedAsset.fighter.metadata,
          importedFrom: 'universal-wallet-importer',
          selectedAssetId: selectedAsset.id,
          sourceAvatarUrl: selectedAsset.avatarUrl,
          characterAvatarUrl: characterAvatarForAsset(selectedAsset),
        },
      }

      return apiRequest('POST', '/api/bantahbro/fighter-profiles/import', payload) as Promise<ImportResponse>
    },
    onSuccess: (result) => {
      setImportedProfile(result.profile)
      queryClient.invalidateQueries({ queryKey: ['/api/bantahbro/fighter-profiles'] })
      queryClient.invalidateQueries({ queryKey: ['/api/bantahbro/agents-directory'] })
      queryClient.invalidateQueries({ queryKey: ['/api/bantahbro/profile'] })
      toast({
        title: 'Fighter imported',
        description: `${result.profile.displayName} entered your next Arena queue.`,
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'Import failed',
        description: error.message,
        variant: 'destructive',
      })
    },
  })

  const ensPreviewMutation = useMutation({
    mutationFn: async () => {
      const name = ensDraft.trim()
      if (!name) throw new Error('Enter an ENS name to preview.')
      const params = new URLSearchParams({
        name,
      })
      const wallet = ownScanWallet
      if (wallet) params.set('walletAddress', wallet)
      return apiRequest('GET', `/api/bantahbro/ens/preview?${params.toString()}`) as Promise<EnsPreviewResponse>
    },
    onSuccess: (result) => {
      setEnsPreviewAsset(result.asset)
      setSelectedAssetId(result.asset.id)
      setFilter('ens')
      setImportedProfile(null)
      toast({
        title: 'ENS preview ready',
        description: result.resolution.resolvedAddress
          ? `${result.resolution.ensName} resolved on Ethereum.`
          : `${result.resolution.ensName} preview loaded. No resolver address found yet.`,
      })
    },
    onError: (error: Error) => {
      toast({
        title: 'ENS preview failed',
        description: error.message,
        variant: 'destructive',
      })
    },
  })

  const handleScan = () => {
    if (!isAuthenticated) {
      login?.()
      return
    }
    if (!ownScanWallet) {
      toast({
        title: 'Connect wallet',
        description: 'Import scans only use the wallet connected to your signed-in profile.',
        variant: 'destructive',
      })
      return
    }
    setImportedProfile(null)
    setSelectedAssetId('')
    setEnsPreviewAsset(null)
  }

  const handleEnsPreview = () => {
    ensPreviewMutation.mutate()
  }

  const handleImport = () => {
    if (!isAuthenticated) {
      login?.()
      return
    }
    importMutation.mutate()
  }

  const submitLabel = !isAuthenticated
    ? 'Sign in to import'
    : importMutation.isPending
      ? 'Importing'
      : 'Import as Fighter'
  const selectedEnsAgentIdentity = ensAgentIdentityForAsset(selectedAsset)

  return (
    <div className="flex-1 overflow-hidden rounded border border-border bg-card">
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-background px-3 py-2">
        <ImportIcon size={17} className="text-primary" />
        <span className="font-bold text-foreground">Import</span>
        <span className="ml-auto text-xs text-muted-foreground">Wallet assets to fighters</span>
      </div>

      <div className="h-full overflow-y-auto p-2.5 md:p-3">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <section className="min-w-0 rounded border border-border bg-background">
            <div className="border-b border-border p-3">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-end">
                <label className="min-w-0 flex-1 space-y-1">
                  <span className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">
                    Wallet Scanner
                  </span>
                  <div className="flex items-center gap-2 rounded border border-border bg-card px-2 py-1.5">
                    <Wallet size={15} className="shrink-0 text-primary" />
                    <input
                      value={ownScanWallet || walletDraft}
                      readOnly
                      placeholder="Connect wallet to scan"
                      className="min-w-0 flex-1 bg-transparent text-sm font-bold text-foreground outline-none placeholder:text-muted-foreground"
                    />
                  </div>
                </label>
                <button
                  type="button"
                  onClick={handleScan}
                  disabled={authLoading || (isAuthenticated && !ownScanWallet)}
                  className="inline-flex items-center justify-center gap-2 rounded bg-primary px-3 py-2 text-xs font-black text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {scanQuery.isFetching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                  Scan Assets
                </button>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {assetFilters.map((item) => {
                  const active = filter === item.value
                  const count =
                    item.value === 'all'
                      ? assets.length
                      : item.value === 'create'
                        ? undefined
                        : scanQuery.data?.counts?.[item.value] || 0
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setFilter(item.value)}
                      className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-black transition ${
                        active
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-card text-foreground hover:border-primary/50'
                      }`}
                    >
                      {item.value === 'all' ? (
                        <Sparkles size={12} />
                      ) : item.value === 'create' ? (
                        <Bot size={12} />
                      ) : (
                        <AssetTypeIcon type={item.value} size={12} />
                      )}
                      {item.label}
                      {count !== undefined ? <span className="text-muted-foreground">{count}</span> : null}
                    </button>
                  )
                })}
              </div>

              <div className="mt-2 flex flex-col gap-2 rounded border border-border bg-card px-2 py-2 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Globe2 size={15} className="shrink-0 text-primary" />
                  <input
                    value={ensDraft}
                    onChange={(event) => setEnsDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') handleEnsPreview()
                    }}
                    placeholder="Preview ENS fighter, e.g. vitalik.eth"
                    className="min-w-0 flex-1 bg-transparent text-xs font-bold text-foreground outline-none placeholder:text-muted-foreground"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleEnsPreview}
                  disabled={ensPreviewMutation.isPending}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded border border-primary/40 bg-primary/10 px-2 text-[11px] font-black text-primary disabled:opacity-60"
                >
                  {ensPreviewMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Globe2 size={13} />}
                  Preview ENS
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 p-2.5 lg:grid-cols-2 2xl:grid-cols-3">
              {scanQuery.isLoading ? (
                <div className="col-span-full grid min-h-40 place-items-center rounded border border-border bg-card text-sm font-bold text-muted-foreground">
                  <span className="inline-flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin" />
                    Scanning wallet assets
                  </span>
                </div>
              ) : isCreateMode ? (
                <div className="col-span-full rounded border border-border bg-card p-3 text-sm text-foreground">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-base font-black">⚔️ Create Fighter</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        One-shot Gen 1 launch: name, style, deploy.
                      </div>
                    </div>
                    <div className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-black text-primary">Gen 1</div>
                  </div>

                  <div className="mt-3 space-y-3">
                    <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">
                      Fighter name
                    </label>
                    <Input
                      value={createName}
                      onChange={(event) => setCreateName(event.target.value)}
                      placeholder="Name"
                      className="h-10 w-full"
                    />

                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">
                        Source
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {['new', 'existing'].map((value) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setCreateType(value as 'new' | 'existing')}
                            className={`rounded-full border px-3 py-1.5 text-[11px] font-black transition ${
                              createType === value
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-border bg-background text-foreground hover:border-primary/50'
                            }`}
                          >
                            {value === 'new' ? 'New' : 'Wallet'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {createType === 'existing' ? (
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">
                          Wallet asset
                        </div>
                        <div className="mt-2 space-y-2 max-h-48 overflow-y-auto">
                          {assets.map((asset) => (
                            <button
                              key={asset.id}
                              type="button"
                              onClick={() => setSelectedCreateAssetId(asset.id)}
                              className={`w-full rounded-lg border p-2 text-left transition ${
                                selectedCreateAsset?.id === asset.id
                                  ? 'border-primary bg-primary/10'
                                  : 'border-border bg-card hover:border-primary/50'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <img
                                  src={characterAvatarForAsset(asset)}
                                  alt={botaCharacterAlt(asset.name)}
                                  className="h-8 w-8 rounded-full border border-border object-cover"
                                />
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-black text-foreground">{asset.name}</div>
                                  <div className="truncate text-[11px] text-muted-foreground">{asset.subtitle}</div>
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">
                        Style
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {createStyleOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setCreateStyle(option.value)}
                            className={`rounded-full border px-3 py-1.5 text-[11px] font-black transition ${
                              createStyle === option.value
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-border bg-background text-foreground hover:border-primary/50'
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between rounded border border-border bg-background px-3 py-2 text-xs font-black text-foreground">
                      <span>Loadout</span>
                      <button
                        type="button"
                        onClick={() => setCreateAutoAssign((current) => !current)}
                        className={`rounded-full px-3 py-1 text-[10px] font-black transition ${
                          createAutoAssign
                            ? 'bg-primary text-primary-foreground'
                            : 'border border-border bg-background text-foreground hover:border-primary/50'
                        }`}
                      >
                        {createAutoAssign ? 'Auto' : 'Manual'}
                      </button>
                    </div>

                    <div className="rounded border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                      Wallet
                      <div className="mt-1 font-black text-foreground">{ownScanWallet ? 'Connected' : 'Connect to deploy'}</div>
                    </div>

                    <Button
                      onClick={() => {
                        if (!isAuthenticated) {
                          login?.()
                          return
                        }
                        createMutation.mutate()
                      }}
                      disabled={createMutation.isPending || !createName.trim() || (createType === 'existing' && !selectedCreateAsset)}
                      className="w-full h-10"
                    >
                      {createMutation.isPending ? 'Deploying…' : 'Deploy'}
                    </Button>
                  </div>
                </div>
              ) : visibleAssets.length ? (
                visibleAssets.map((asset) => {
                  const active = selectedAsset?.id === asset.id
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => {
                        setSelectedAssetId(asset.id)
                        setImportedProfile(null)
                      }}
                      className={`min-w-0 rounded border p-2 text-left transition ${
                        active ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-primary/50'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <img
                          src={characterAvatarForAsset(asset)}
                          alt={botaCharacterAlt(asset.name)}
                          className="size-14 shrink-0 rounded border border-border bg-background object-cover object-center p-0"
                          loading="lazy"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-black text-foreground">{asset.name}</span>
                            <SourceIcon asset={asset} />
                          </div>
                          <div className="mt-0.5 truncate text-xs text-muted-foreground">{asset.subtitle}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold text-foreground">
                              <AssetTypeIcon type={asset.type} size={10} />
                              {assetTypeLabel(asset.type)}
                            </span>
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold text-foreground">
                              {asset.source}
                            </span>
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                              {asset.chainId}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
                        <span className="truncate text-muted-foreground">{shortContract(asset)}</span>
                        <span className="font-black text-primary">{sourceLine(asset)}</span>
                      </div>
                    </button>
                  )
                })
              ) : (
                <div className="col-span-full grid min-h-40 place-items-center rounded border border-border bg-card p-4 text-center">
                  <div>
                    <div className="text-sm font-black text-foreground">
                      {ownScanWallet ? 'No real assets detected' : 'Connect wallet to scan'}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {ownScanWallet
                        ? 'Only live wallet/indexer results appear here. No fallback imports are shown.'
                        : 'Sign in and connect your wallet to find your importable fighters.'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          <aside className="space-y-2.5">
            <section className="rounded border border-border bg-background p-2.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">Preview</div>
                  {scanQuery.data?.displayWallet ? (
                    <div className="mt-0.5 text-sm font-black text-foreground">
                      {scanQuery.data.displayWallet}
                    </div>
                  ) : null}
                </div>
                <Shield size={16} className="text-primary" />
              </div>

              {selectedAsset ? (
                  <div className="mt-2 rounded border border-border bg-card p-2">
                    <div className="flex items-center gap-2">
                      <img
                        src={characterAvatarForAsset(selectedAsset)}
                      alt={botaCharacterAlt(selectedAsset.name)}
                      className="size-16 rounded border border-border bg-background object-cover object-center p-0"
                    />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black text-foreground">{selectedAsset.fighter.displayName}</div>
                        <div className="text-xs font-bold text-primary">{selectedAsset.fighter.league}</div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {selectedAsset.fighter.agentClass} / {String(selectedAsset.fighter.archetype).replace(/_/g, ' ')}
                        </div>
                      </div>
                    </div>

                  {derivativeForAsset(selectedAsset) ? (
                    <div className="mt-2 rounded border border-primary/25 bg-primary/5 p-2 text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-black text-primary">
                          {derivativeForAsset(selectedAsset)?.speciesLabel}
                        </span>
                        <span className="rounded bg-background px-1.5 py-0.5 font-black uppercase text-muted-foreground">
                          {derivativeForAsset(selectedAsset)?.rarityTier}
                        </span>
                      </div>
                      <div className="mt-1 text-muted-foreground">
                        {derivativeForAsset(selectedAsset)?.collectionLabel} traits become a native BOTA fighter.
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-1">
                        {Object.entries(derivativeForAsset(selectedAsset)?.stats || {}).slice(0, 6).map(([key, value]) => (
                          <div key={key} className="rounded bg-background px-1.5 py-1">
                            <div className="font-black text-foreground">{String(value)}</div>
                            <div className="uppercase text-muted-foreground">{key}</div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {(derivativeForAsset(selectedAsset)?.abilities || []).slice(0, 3).map((ability) => (
                          <span key={ability.id} className="rounded bg-background px-1.5 py-0.5 font-bold text-foreground">
                            {ability.name}
                          </span>
                        ))}
                      </div>
                      <div className="mt-2 font-bold text-muted-foreground">
                        70% Bantah / 30% collection inspiration
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
                    <div className="rounded bg-background px-2 py-1">
                      <div className="text-muted-foreground">Source</div>
                      <div className="flex items-center gap-1.5 font-black text-foreground">
                        <img
                          src={identityForAsset(selectedAsset).logoUrl}
                          alt=""
                          className="h-4 w-4 rounded-full object-cover"
                          loading="lazy"
                        />
                        <span className="truncate">{identityForAsset(selectedAsset).brainLabel}</span>
                      </div>
                    </div>
                    <div className="rounded bg-background px-2 py-1">
                      <div className="text-muted-foreground">Rank</div>
                      <div className="font-black text-foreground">#{selectedAsset.fighter.rank || '-'}</div>
                    </div>
                  </div>

                  {selectedEnsAgentIdentity ? (
                    <div className="mt-2 rounded border border-primary/25 bg-primary/10 p-2 text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-black text-primary">ENS Agent Identity</div>
                        <span className="rounded bg-background px-1.5 py-0.5 font-black uppercase text-muted-foreground">
                          {ensIdentityStatusLabel(selectedEnsAgentIdentity.status)}
                        </span>
                      </div>
                      <div className="mt-1 grid gap-1">
                        <div className="flex min-w-0 items-center justify-between gap-2 rounded bg-background px-2 py-1">
                          <span className="shrink-0 text-muted-foreground">ENSIP-26</span>
                          <span className="truncate font-black text-foreground">agent-context</span>
                        </div>
                        {selectedEnsAgentIdentity.registry?.verificationKey ? (
                          <div className="flex min-w-0 items-center justify-between gap-2 rounded bg-background px-2 py-1">
                            <span className="shrink-0 text-muted-foreground">ENSIP-25</span>
                            <span className="truncate font-black text-foreground" title={selectedEnsAgentIdentity.registry.verificationKey}>
                              {selectedEnsAgentIdentity.registry.verified ? 'verified' : 'verification key ready'}
                            </span>
                          </div>
                        ) : null}
                        {selectedEnsAgentIdentity.subname?.suggestedName ? (
                          <div className="flex min-w-0 items-center justify-between gap-2 rounded bg-background px-2 py-1">
                            <span className="shrink-0 text-muted-foreground">Subname</span>
                            <span className="truncate font-black text-foreground">
                              {selectedEnsAgentIdentity.subname.suggestedName}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-2 flex flex-wrap gap-1">
                    <span
                      className="inline-grid h-6 w-6 place-items-center overflow-hidden rounded-full border border-primary/25 bg-primary/10"
                      title={selectedAsset.source}
                      aria-label={selectedAsset.source}
                    >
                      <img
                        src={identityForAsset(selectedAsset).logoUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </span>
                    {(selectedAsset.fighter.titles || []).slice(0, 2).map((title) => (
                      <span key={title} className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-black text-primary">
                        {title}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              <button
                type="button"
                onClick={handleImport}
                disabled={authLoading || importMutation.isPending || !selectedAsset}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded bg-primary px-3 py-2 text-xs font-black text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                {importMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <ImportIcon size={14} />}
                {submitLabel}
              </button>
            </section>

            <section className="rounded border border-border bg-background p-2.5">
              <div className="flex items-center gap-2 text-sm font-black text-foreground">
                <Cpu size={15} className="text-primary" />
                Pipeline
              </div>
              <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={13} className="text-secondary" />
                  Classify asset type
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={13} className="text-secondary" />
                  Create fighter profile
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={13} className="text-secondary" />
                  Attach source badge
                </div>
              </div>
            </section>

            {importedProfile && (
              <section className="rounded border border-green-500/30 bg-green-500/10 p-2.5">
                <div className="flex items-center gap-2 text-sm font-black text-green-500">
                  <CheckCircle2 size={16} />
                  Imported
                </div>
                <div className="mt-2 text-base font-black text-foreground">{importedProfile.displayName}</div>
                <div className="mt-1 text-xs font-bold text-muted-foreground">
                  Added to your profile and queued for the next eligible Arena matchup.
                </div>
                <div className="mt-1 break-all text-xs text-muted-foreground">{importedProfile.agentId}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a
                    href={botaAppHref('/bota?section=battles')}
                    className="inline-flex items-center gap-1 rounded bg-primary px-2.5 py-1.5 text-xs font-black text-primary-foreground hover:bg-primary/90"
                  >
                    Enter Arena <Swords size={12} />
                  </a>
                  {importedProfile.externalUrl && (
                    <a
                      href={importedProfile.externalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded border border-border bg-background px-2.5 py-1.5 text-xs font-black text-primary hover:bg-muted/40"
                    >
                      Open source <ExternalLink size={12} />
                    </a>
                  )}
                </div>
              </section>
            )}

            {isAuthenticated && (
              <section className="rounded border border-border bg-background p-2.5">
                <div className="flex items-center gap-2 text-sm font-black text-foreground">
                  <Swords size={15} className="text-primary" />
                  Your queue
                </div>
                <div className="mt-2 space-y-1.5">
                  {profileQuery.isLoading ? (
                    <div className="rounded bg-card px-2 py-2 text-xs font-bold text-muted-foreground">
                      Loading queue
                    </div>
                  ) : profileQuery.data?.queue?.length ? (
                    profileQuery.data.queue.slice(0, 3).map((row) => (
                      <div key={row.id} className="rounded border border-primary/25 bg-primary/10 px-2 py-2 text-xs">
                        <div className="font-black text-primary">
                          {row.queueState === 'matched' ? 'Next Arena matchup' : 'Waiting for match'}
                        </div>
                        <div className="mt-0.5 truncate font-bold text-foreground">
                          {row.opponentName ? `${row.agentName} vs ${row.opponentName}` : row.agentName}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded bg-card px-2 py-2 text-xs font-bold text-muted-foreground">
                      Imported fighters will appear here once they are matched for the next Arena round.
                    </div>
                  )}
                </div>
              </section>
            )}

            <section className="rounded border border-border bg-background p-2.5 text-xs text-muted-foreground">
              {scanQuery.data?.scanner.note || 'Connect a wallet to discover importable fighters.'}
            </section>
          </aside>
        </div>
      </div>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="max-w-sm p-4">
          <DialogHeader>
            <DialogTitle className="text-base">
              {createStatus === 'pending'
                ? 'Deploying…'
                : createStatus === 'success'
                ? 'Queued'
                : 'Create fighter'}
            </DialogTitle>
            <DialogDescription className="text-sm">
              {createStatus === 'pending'
                ? 'Creating your fighter and joining the next queue.'
                : createStatus === 'success'
                ? `${importedProfile?.displayName || 'Fighter'} is queued.`
                : 'Close to continue and review your queue.'}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-3 space-y-3">
            {createStatus === 'pending' ? (
              <div className="flex items-center justify-center gap-2 rounded border border-border bg-card p-4 text-sm font-black text-muted-foreground">
                <Loader2 size={18} className="animate-spin" />
                <span>Working…</span>
              </div>
            ) : createStatus === 'success' && importedProfile ? (
              <div className="rounded border border-primary/30 bg-primary/5 p-3 text-sm text-foreground">
                <div className="font-black">{importedProfile.displayName}</div>
                <div className="mt-1 text-xs text-muted-foreground">Queued for the next Arena round.</div>
              </div>
            ) : (
              <div className="rounded border border-border bg-background p-3 text-sm text-muted-foreground">
                Your fighter will be generated and queued on submit.
              </div>
            )}
          </div>

          <DialogFooter className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" onClick={() => setIsCreateDialogOpen(false)} className="w-full sm:w-auto">
              Close
            </Button>
            {createStatus === 'success' && importedProfile ? (
              <a
                href={botaAppHref('/bota?section=battles')}
                className="inline-flex w-full items-center justify-center rounded bg-primary px-3 py-2 text-xs font-black text-primary-foreground hover:bg-primary/90 sm:w-auto"
              >
                Enter Arena
              </a>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

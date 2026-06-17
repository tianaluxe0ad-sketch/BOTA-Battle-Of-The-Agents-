import { useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usePrivy, useWallets } from '@privy-io/react-auth'
import {
  Check,
  Clock,
  Copy,
  ExternalLink,
  Gift,
  History,
  Loader2,
  Settings,
  Swords,
  Trophy,
  PackageOpen,
  Wrench,
  ShieldHalf,
  Box,
  ScrollText,
  Edit2,
  Save,
  X
} from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'
import { apiRequest } from '@/lib/queryClient'
import { executeBantCreditRewardClaimTx, type OnchainRuntimeConfig } from '@/lib/onchainEscrow'
import type { BotaFighterProfile } from '@shared/botaFighterProfile'
import { useBotaInventory } from '@/hooks/useBotaInventory'
import { BotaInventoryBrowser } from '@/components/BotaInventoryBrowser'
import { useUnopenedPacks, usePackHistory } from '@/hooks/useGen1Packs'
import { BotaPackOpener } from '@/components/BotaPackOpener'
import { formatAgentName } from '@/lib/utils'

type OnchainBantCreditClaim = {
  id: string
  batchId: `0x${string}`
  battleId: string
  chainId: number
  chainName: string | null
  account: string
  amount: number
  role: string
  matchId: string
  roleBytes32: `0x${string}`
  matchIdBytes32: `0x${string}`
  proof: `0x${string}`[]
  status: string
  createdAt: string
}

type OnchainClaimsFeed = {
  claims: OnchainBantCreditClaim[]
  claimableCount: number
  claimableBantCredits: number
}

type RewardsProfileResponse = {
  viewer?: {
    points?: number
    referralCount?: number
    onchainClaimableBantCredits?: number
    usdcEarned?: number
  }
  onchainClaims?: OnchainClaimsFeed
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

type ProfileHistoryRow = {
  id: string
  battleId: string
  title: string
  status: string
  result: 'win' | 'loss' | 'draw' | 'recorded'
  agentName: string
  opponentName: string
  rounds: number
  spectators: number
  resolvedAt: string
  recordUrl: string
}

type BotaProfileResponse = {
  viewer: {
    walletAddresses: string[]
    points: number
  }
  summary: {
    fighters: number
    wins: number
    losses: number
    bantCredits: number
  }
  fighters: BotaFighterProfile[]
  queue: ProfileBattleRow[]
  liveBattles: ProfileBattleRow[]
  history: ProfileHistoryRow[]
  onchainClaims: OnchainClaimsFeed
  updatedAt: string
}

type ProfileTimelineResult = ProfileHistoryRow['result'] | 'queued' | 'live'

type ProfileTimelineRow = {
  id: string
  result: ProfileTimelineResult
  agentName: string
  opponentName: string | null
  title: string
  resolvedAt: string
  rounds?: number
  spectators?: number
  url?: string
}

function getWalletAddress(user: unknown) {
  const candidate = user as any
  const walletAddress =
    candidate?.wallet?.address ||
    candidate?.walletAddress ||
    candidate?.wallet_address ||
    candidate?.linkedAccounts?.find?.((account: any) => account?.type === 'wallet')?.address ||
    candidate?.linked_accounts?.find?.((account: any) => account?.type === 'wallet')?.address

  return typeof walletAddress === 'string' && walletAddress.trim() ? walletAddress.trim() : null
}

function shortenAddress(address: string | null) {
  if (!address) return 'Wallet connected'
  if (address.length <= 14) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function formatNumber(value?: number | null) {
  const safe = Math.max(0, Math.round(Number(value || 0)))
  return new Intl.NumberFormat('en', {
    notation: safe >= 100_000 ? 'compact' : 'standard',
    maximumFractionDigits: safe >= 100_000 ? 1 : 0,
  }).format(safe)
}

function formatDate(value?: string | null) {
  if (!value) return 'Recent'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Recent'
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function claimRoleLabel(role: string) {
  const normalized = String(role || '').toUpperCase()
  if (normalized === 'ENS_OWNER') return 'Fighter owner'
  if (normalized === 'EXTERNAL_AGENT_OWNER') return 'Agent owner'
  if (normalized === 'SPECTATOR') return 'Spectator'
  if (normalized === 'FIGHTER_OWNER') return 'Fighter owner'
  return normalized.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase())
}

function resultClass(result: ProfileTimelineResult) {
  if (result === 'live') return 'border-green-500/30 bg-green-500/10 text-green-500'
  if (result === 'queued') return 'border-primary/30 bg-primary/10 text-primary'
  if (result === 'win') return 'border-green-500/30 bg-green-500/10 text-green-500'
  if (result === 'loss') return 'border-red-500/30 bg-red-500/10 text-red-500'
  if (result === 'draw') return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-500'
  return 'border-border bg-muted/30 text-muted-foreground'
}

export default function ProfilePage() {
  const { user, isAuthenticated, isLoading: authLoading, login } = useAuth()
  const { wallets } = useWallets()
  const { connectOrCreateWallet } = usePrivy()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)
  const [activeTab, setActiveTab] = useState<'fighters' | 'queue' | 'history' | 'claim' | 'packs' | 'tools' | 'loadouts' | 'inventory-history' | 'settings'>('fighters')
  const walletAddress = getWalletAddress(user)
  const displayAddress = shortenAddress(walletAddress)
  const [listingFighterId, setListingFighterId] = useState<string | null>(null)
  const [listingPrice, setListingPrice] = useState('10')
  const [editingFighterId, setEditingFighterId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editAvatarPreview, setEditAvatarPreview] = useState<string | null>(null)

  const { data: rewardsData } = useQuery<RewardsProfileResponse>({
    queryKey: ['/api/bantahbro/rewards', 'profile'],
    queryFn: () => apiRequest('GET', '/api/bantahbro/rewards'),
    enabled: isAuthenticated,
    staleTime: 5_000,
    refetchInterval: 15_000,
  })
  const { data: profileData, isLoading: profileLoading } = useQuery<BotaProfileResponse>({
    queryKey: ['/api/bantahbro/profile'],
    queryFn: () => apiRequest('GET', '/api/bantahbro/profile'),
    enabled: isAuthenticated,
    staleTime: 5_000,
    refetchInterval: 15_000,
  })
  const { data: kothData } = useQuery<{ participants: any[] }>({
    queryKey: ['/api/bantahbro/koth/participants'],
    queryFn: () => apiRequest('GET', '/api/bantahbro/koth/participants'),
    enabled: isAuthenticated,
    refetchInterval: 5_000,
  })
  const toggleKothMutation = useMutation({
    mutationFn: async (agentId: string) => apiRequest('POST', `/api/bantahbro/koth/agents/${encodeURIComponent(agentId)}/toggle-auto`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/bantahbro/koth/participants'] })
      toast({ title: 'Success', description: 'KOTH auto-join preference updated.' })
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' })
    }
  })
  const { data: onchainConfig } = useQuery<OnchainRuntimeConfig>({
    queryKey: ['/api/onchain/config'],
    queryFn: () => apiRequest('GET', '/api/onchain/config'),
    enabled: isAuthenticated,
    staleTime: 60_000,
  })
  
  const { tools: inventoryTools, equipTool, unequipTool } = useBotaInventory(walletAddress)
  const { data: packsData } = useUnopenedPacks(walletAddress)
  const { data: historyData } = usePackHistory(walletAddress)

  const unopenedPacks = packsData?.unopenedPacks || []
  const packHistory = historyData?.history || []

  const offchainBantCredits = Math.max(
    0,
    Math.round(Number(rewardsData?.viewer?.points ?? profileData?.viewer?.points ?? (user as any)?.points ?? 0)),
  )
  const claimableClaims = useMemo(
    () =>
      (profileData?.onchainClaims?.claims || rewardsData?.onchainClaims?.claims || []).filter(
        (claim) => claim.status === 'claimable',
      ),
    [profileData?.onchainClaims?.claims, rewardsData?.onchainClaims?.claims],
  )
  const claimableBantCredits = Math.max(
    0,
    Math.round(
      Number(
        profileData?.onchainClaims?.claimableBantCredits ||
          rewardsData?.viewer?.onchainClaimableBantCredits ||
          rewardsData?.onchainClaims?.claimableBantCredits ||
          0,
      ),
    ),
  )
  const queueRows = profileData?.queue || []
  const liveBattleRows = profileData?.liveBattles || []
  const displayedBantCredits = Math.max(
    offchainBantCredits,
    Math.round(Number(profileData?.summary?.bantCredits || 0)),
  )
  const timelineRows = useMemo<ProfileTimelineRow[]>(() => {
    const liveRows = liveBattleRows.map((row) => ({
      id: `timeline:${row.id}`,
      result: 'live' as const,
      agentName: formatAgentName(row.agentName),
      opponentName: row.opponentName ? formatAgentName(row.opponentName) : null,
      title: row.title,
      resolvedAt: row.startsAt,
      url: row.arenaUrl,
    }))
    const queuedRows = queueRows.map((row) => ({
      id: `timeline:${row.id}`,
      result: 'queued' as const,
      agentName: formatAgentName(row.agentName),
      opponentName: row.opponentName ? formatAgentName(row.opponentName) : null,
      title: row.title,
      resolvedAt: row.startsAt,
      url: row.arenaUrl,
    }))
    const recordRows = (profileData?.history || []).map((row) => ({
      id: `timeline:${row.id}`,
      result: row.result,
      agentName: formatAgentName(row.agentName),
      opponentName: row.opponentName ? formatAgentName(row.opponentName) : null,
      title: row.title,
      resolvedAt: row.resolvedAt,
      rounds: row.rounds,
      spectators: row.spectators,
      url: row.recordUrl,
    }))

    const priority: Record<ProfileTimelineResult, number> = {
      live: 0,
      queued: 1,
      win: 2,
      loss: 2,
      draw: 2,
      recorded: 2,
    }

    return [...liveRows, ...queuedRows, ...recordRows].sort((left, right) => {
      const priorityDelta = priority[left.result] - priority[right.result]
      if (priorityDelta !== 0) return priorityDelta
      return new Date(right.resolvedAt).getTime() - new Date(left.resolvedAt).getTime()
    })
  }, [liveBattleRows, profileData?.history, queueRows])

  const claimMutation = useMutation({
    mutationFn: async (claim: OnchainBantCreditClaim) => {
      if (!onchainConfig) throw new Error('Onchain config is still loading.')
      const result = await executeBantCreditRewardClaimTx({
        wallets: wallets as any,
        preferredWalletAddress: claim.account,
        onchainConfig,
        chainId: claim.chainId,
        batchId: claim.batchId,
        account: claim.account,
        amount: claim.amount,
        roleBytes32: claim.roleBytes32,
        matchIdBytes32: claim.matchIdBytes32,
        proof: claim.proof,
      })
      await apiRequest(
        'POST',
        `/api/bantahbro/onchain/bantcredits/claims/${encodeURIComponent(claim.id)}/mark-claimed`,
        { txHash: result.claimTxHash },
      )
      return result
    },
    onSuccess: () => {
      toast({
        title: 'BANTC claimed',
        description: 'Your onchain BantCredits were minted to your wallet.',
      })
      queryClient.invalidateQueries({ queryKey: ['/api/bantahbro/profile'] })
      queryClient.invalidateQueries({ queryKey: ['/api/bantahbro/rewards'] })
    },
    onError: (claimError) => {
      toast({
        title: 'Claim failed',
        description: claimError instanceof Error ? claimError.message : 'Unable to claim BANTC.',
        variant: 'destructive',
      })
    },
  })

  const listAgentMutation = useMutation({
    mutationFn: async (data: { agentId: string; priceUsdt: string }) => {
      const res = await apiRequest('POST', '/api/bantahbro/marketplace/list-agent', data)
      return res
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/bantahbro/profile'] })
      queryClient.invalidateQueries({ queryKey: ['/api/bantahbro/fighter-profiles'] })
      toast({ title: 'Success', description: 'Fighter listed on marketplace' })
      setListingFighterId(null)
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' })
    }
  })

  const updateAgentMutation = useMutation({
    mutationFn: async (data: { agentId: string; agentName?: string; avatarUrl?: string }) => {
      const res = await apiRequest('PATCH', `/api/bantahbro/agents/${data.agentId}`, {
        agentName: data.agentName,
        avatarUrl: data.avatarUrl,
      })
      return res
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/bantahbro/profile'] })
      queryClient.invalidateQueries({ queryKey: ['/api/bantahbro/my-agents'] })
      toast({ title: 'Success', description: 'Agent profile updated' })
      setEditingFighterId(null)
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' })
    }
  })

  const copyAddress = () => {
    if (!walletAddress) return
    navigator.clipboard.writeText(walletAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  if (authLoading) {
    return (
      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="rounded border border-border bg-card p-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="rounded border border-border bg-card p-3">
          <div className="flex min-h-[260px] flex-col items-center justify-center rounded-md border border-dashed border-primary/30 bg-primary/5 px-4 text-center">
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full border border-primary/30 bg-background text-2xl">
              :)
            </div>
            <h2 className="text-base font-black text-foreground">Sign in to view your profile</h2>
            <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
              Your fighters, queue, battle history, and BANTC claims appear here after you connect.
            </p>
            <button
              type="button"
              onClick={() => login()}
              className="bb-tap mt-4 rounded-md border border-primary/50 bg-primary px-4 py-2 text-xs font-black text-primary-foreground transition hover:bg-primary/90 active:translate-y-0.5"
            >
              Sign in with Privy
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {packToOpen && (
        <BotaPackOpener 
          packInstanceId={packToOpen} 
          onClose={() => setPackToOpen(null)}
          onRevealComplete={() => {
            queryClient.invalidateQueries({ queryKey: ['/api/bantahbro/gen1/packs/inventory'] })
            queryClient.invalidateQueries({ queryKey: ['/api/bantahbro/inventory'] })
            queryClient.invalidateQueries({ queryKey: ['/api/bantahbro/gen1/packs/history'] })
          }}
        />
      )}

      <Dialog open={!!listingFighterId} onOpenChange={(open) => !open && setListingFighterId(null)}>
        <DialogContent className="sm:max-w-[380px] bantahbro-next-ui">
          <DialogHeader>
            <DialogTitle className="text-sm font-black">List Fighter for Sale</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Set a price in USDT for your fighter to list it on the public Marketplace.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <label htmlFor="price" className="text-xs font-black uppercase text-foreground">
                Price (USDT)
              </label>
              <input
                id="price"
                type="number"
                min="0.1"
                step="0.1"
                value={listingPrice}
                onChange={(e) => setListingPrice(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-black ring-offset-background"
                placeholder="10.0"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setListingFighterId(null)}>Cancel</Button>
            <Button 
              onClick={() => listingFighterId && listAgentMutation.mutate({ agentId: listingFighterId, priceUsdt: listingPrice })}
              disabled={listAgentMutation.isPending}
            >
              {listAgentMutation.isPending ? 'Listing...' : 'Confirm Listing'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <div className="flex-1 flex flex-col overflow-hidden rounded border border-border bg-card">
        <div className="border-b border-border bg-background px-3 py-2.5">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/15 text-lg">
              :)
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <h2 className="truncate text-sm font-black text-foreground">{displayAddress}</h2>
                <span className="rounded bg-secondary/15 px-1.5 py-0.5 text-[10px] font-black uppercase text-secondary">
                  Connected
                </span>
              </div>
              <button
                type="button"
                onClick={copyAddress}
                disabled={!walletAddress}
                className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
              >
                {copied ? <Check size={11} className="text-secondary" /> : <Copy size={11} />}
                <span className="font-mono">{displayAddress}</span>
              </button>
            </div>
            <button className="bb-tap rounded border border-border bg-muted/30 p-2 transition hover:bg-muted">
              <Settings size={14} className="text-muted-foreground" />
            </button>
          </div>

          <div className="mt-2 grid grid-cols-5 gap-1.5">
            {[
            ['My Agents', formatNumber(profileData?.summary?.fighters || 0)],
              ['Queue', formatNumber(queueRows.length)],
              ['BantCredit', formatNumber(displayedBantCredits)],
              ['BANTC claim', formatNumber(claimableBantCredits)],
              ['Earned USDC', `$${formatNumber(rewardsData?.viewer?.usdcEarned || 0)}`],
            ].map(([label, value]) => (
              <div key={label} className="rounded border border-border/70 bg-muted/25 px-2 py-1.5">
                <div className="truncate text-[10px] font-semibold uppercase text-muted-foreground">{label}</div>
                <div className={`truncate text-xs font-black ${label === 'Earned USDC' ? 'text-green-500' : 'text-foreground'}`}>{value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex overflow-x-auto border-b border-border bg-background px-2">
          {([
            ['fighters', 'My Agents'],
            ['queue', 'Queue'],
            ['history', 'Battle History'],
            ['packs', 'Packs'],
            ['tools', 'Tools'],
            ['loadouts', 'Loadouts'],
            ['inventory-history', 'Inv. History'],
            ['claim', 'Claim'],
            ['settings', 'Settings'],
          ] as const).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab as any)}
              className={`shrink-0 border-b-2 px-3 py-2 text-[11px] font-black uppercase tracking-wide transition ${
                activeTab === tab
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {profileLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : activeTab === 'fighters' ? (
            <div className="space-y-2">
              {(profileData?.fighters || []).length ? (
                profileData?.fighters.map((fighter) => (
                  editingFighterId === fighter.agentId ? (
                    // Edit Mode
                    <div key={fighter.agentId} className="rounded-md border border-primary/50 bg-background/80 p-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-black uppercase text-foreground">Edit Fighter</h3>
                        <button
                          onClick={() => setEditingFighterId(null)}
                          className="p-1 hover:bg-muted rounded"
                        >
                          <X size={14} className="text-muted-foreground" />
                        </button>
                      </div>
                      
                      {/* Avatar */}
                      <div className="flex flex-col items-center gap-2">
                        <Avatar className="w-16 h-16">
                          <AvatarImage src={editAvatarPreview || fighter.avatarUrl} />
                          <AvatarFallback>{fighter.displayName.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <label className="text-[10px] font-black uppercase text-primary cursor-pointer hover:underline">
                          Change Avatar
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                              const file = e.target.files?.[0]
                              if (file) {
                                const reader = new FileReader()
                                reader.onloadend = () => {
                                  setEditAvatarPreview(reader.result as string)
                                }
                                reader.readAsDataURL(file)
                              }
                            }}
                            className="hidden"
                          />
                        </label>
                      </div>

                      {/* Name */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-muted-foreground">Name</label>
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder={fighter.displayName}
                          className="text-xs"
                        />
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => updateAgentMutation.mutate({
                            agentId: fighter.agentId,
                            agentName: editName || undefined,
                            avatarUrl: editAvatarPreview || undefined,
                          })}
                          disabled={updateAgentMutation.isPending || (!editName && !editAvatarPreview)}
                          className="flex-1 h-6 text-[10px]"
                        >
                          <Save size={12} className="mr-1" />
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingFighterId(null)
                            setEditAvatarPreview(null)
                            setEditName('')
                          }}
                          className="flex-1 h-6 text-[10px]"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    // View Mode
                    <div key={fighter.agentId} className="flex items-center gap-2 rounded-md border border-border bg-background/60 p-2">
                      <img
                        src={fighter.avatarUrl || '/assets/bota-bantah-icon.png'}
                        alt=""
                        className="h-12 w-12 rounded border border-border bg-card object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-black text-foreground">{formatAgentName(fighter.displayName)}</div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {fighter.badgeLabel || fighter.origin} / #{fighter.rank || '-'}
                        </div>
                        {kothData?.participants?.find(p => p.agentId === fighter.agentId)?.status === 'queued' && (
                          <div className="mt-1 inline-flex items-center gap-1 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-black text-primary">
                            🛡️ Queued for KOTH
                          </div>
                        )}
                        {kothData?.participants?.find(p => p.agentId === fighter.agentId)?.status === 'live' && (
                          <div className="mt-1 inline-flex items-center gap-1 rounded bg-green-500/20 px-1.5 py-0.5 text-[10px] font-black text-green-500">
                            ⚔️ Live in KOTH
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1 text-right text-xs">
                        <div>
                          <div className="font-black text-foreground">{fighter.wins}W-{fighter.losses}L</div>
                          <div className="font-mono text-yellow-300">{formatNumber(fighter.bantCreditsEarned)} BC</div>
                        </div>
                        <Button 
                          size="sm" 
                          variant={kothData?.participants?.find(p => p.agentId === fighter.agentId)?.autoJoin ? "default" : "outline"} 
                          className="h-6 text-[10px] px-2 uppercase mt-1 mb-1"
                          onClick={() => toggleKothMutation.mutate(fighter.agentId)}
                          disabled={toggleKothMutation.isPending}
                        >
                          {kothData?.participants?.find(p => p.agentId === fighter.agentId)?.autoJoin ? '✅ Auto-Join KOTH' : 'Auto-Join KOTH'}
                        </Button>
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="h-6 text-[10px] px-1 gap-1"
                          onClick={() => {
                            setEditingFighterId(fighter.agentId)
                            setEditName(fighter.displayName)
                            setEditAvatarPreview(null)
                          }}
                        >
                          <Edit2 size={10} />
                          Edit
                        </Button>
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="h-6 text-[10px] px-2 uppercase"
                          onClick={() => setListingFighterId(fighter.agentId)}
                        >
                          List
                        </Button>
                      </div>
                    </div>
                  )
                ))
              ) : (
                <EmptyState icon={<Swords size={16} />} title="No imported agents yet" body="Import a real wallet asset or ENS fighter to enter the next Arena queue." />
              )}
            </div>
          ) : activeTab === 'queue' ? (
            <div className="space-y-2">
              {queueRows.length ? (
                queueRows.map((row) => (
                  <div key={row.id} className="rounded-md border border-border bg-background/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Clock size={15} className="text-primary" />
                        <div className="min-w-0">
                          <div className="truncate text-xs font-black uppercase text-foreground">
                            {row.queueState === 'matched' ? 'Next Arena matchup' : 'Waiting for match'}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">{formatDate(row.startsAt)}</div>
                        </div>
                      </div>
                      <a href={row.arenaUrl} className="rounded bg-primary px-2 py-1 text-[11px] font-black text-primary-foreground">
                        {row.battleId ? 'Open' : 'Arena'}
                      </a>
                    </div>
                    <div className="mt-2 truncate text-sm font-black text-foreground">
                      {row.opponentName ? `${formatAgentName(row.agentName)} vs ${formatAgentName(row.opponentName)}` : formatAgentName(row.agentName)}
                    </div>
                    {!row.opponentName ? (
                      <div className="mt-1 text-xs font-bold text-muted-foreground">
                        No fake opponent assigned. We will notify you when the fighter is matched.
                      </div>
                    ) : null}
                  </div>
                ))
              ) : liveBattleRows.length ? (
                <EmptyState icon={<Swords size={16} />} title="Fighter is live" body="Your active fight is shown in History. The next queue row appears after the current battle window." />
              ) : (
                <EmptyState icon={<Clock size={16} />} title="No queue row yet" body="Your imported fighter appears here when the next eligible Arena round is generated." />
              )}
            </div>
          ) : activeTab === 'history' ? (
            <div className="space-y-2">
              {timelineRows.length ? (
                timelineRows.map((row) => (
                  <div key={row.id} className="rounded-md border border-border bg-background/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`rounded border px-2 py-0.5 text-[10px] font-black uppercase ${resultClass(row.result)}`}>
                        {row.result}
                      </span>
                      <span className="text-[11px] font-bold text-muted-foreground">{formatDate(row.resolvedAt)}</span>
                    </div>
                    <div className="mt-2 truncate text-sm font-black text-foreground">
                      {row.opponentName ? `${formatAgentName(row.agentName)} vs ${formatAgentName(row.opponentName)}` : formatAgentName(row.agentName)}
                    </div>
                    {row.result === 'queued' ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {row.opponentName ? 'Matched for the next Arena window.' : 'Waiting for the next eligible matchup.'}
                      </div>
                    ) : row.result === 'live' ? (
                      <div className="mt-1 text-xs text-green-500">Fight is live now.</div>
                    ) : (
                      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{formatNumber(row.rounds)} rounds</span>
                        <span>{formatNumber(row.spectators)} spectators</span>
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <EmptyState icon={<History size={16} />} title="No battle history yet" body="Wins, losses, queue entries, and resolved Arena records for your fighters will appear here." />
              )}
            </div>
          ) : activeTab === 'packs' ? (
            <div className="space-y-4">
              <div className="flex justify-between items-center px-1">
                <h3 className="text-sm font-black uppercase tracking-widest text-foreground">Your Supply Drops</h3>
                <a
                  href="/bota?section=marketplace&tab=packs"
                  className="text-xs font-bold text-primary hover:underline"
                >
                  Buy more packs &rarr;
                </a>
              </div>
              
              {unopenedPacks.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {unopenedPacks.map((pack: any) => (
                    <div key={pack.pack_instance_id} className="flex flex-col items-center justify-center p-6 border-2 border-primary/20 rounded-xl bg-card relative overflow-hidden">
                      <div className="absolute top-0 right-0 px-2 py-1 bg-black/60 text-[10px] text-muted-foreground uppercase font-black">
                        {formatDate(pack.created_at)}
                      </div>
                      <Box size={48} className="text-primary mb-3" />
                      <h4 className="text-lg font-black text-foreground mb-1">{pack.display_name}</h4>
                      <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">
                        {pack.type} Tier
                      </div>
                      <button 
                        onClick={() => setPackToOpen(pack.pack_instance_id)}
                        className="w-full py-2 bg-primary hover:bg-primary/90 text-primary-foreground font-black text-sm uppercase rounded shadow-[0_0_15px_rgba(var(--primary),0.3)] transition-all active:scale-95"
                      >
                        Open Pack
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-border bg-background/60 p-6 text-center mt-2">
                  <PackageOpen size={32} className="mx-auto text-muted-foreground mb-3" />
                  <h3 className="text-sm font-black text-foreground mb-1 uppercase tracking-wider">No Unopened Packs</h3>
                  <p className="text-xs text-muted-foreground mb-4 max-w-sm mx-auto">
                    You don't have any unopened Tactical Supply Drops. Purchase packs from the store to unlock powerful V2 Combat Tools.
                  </p>
                  <a
                    href="/bota?section=marketplace&tab=packs"
                    className="bb-tap inline-flex items-center justify-center gap-2 rounded-md border border-primary/50 bg-primary px-4 py-2 text-xs font-black text-primary-foreground transition hover:bg-primary/90"
                  >
                    Visit Store for Packs
                  </a>
                </div>
              )}
            </div>
          ) : activeTab === 'inventory-history' ? (
            <div className="space-y-3">
              <div className="px-1">
                <h3 className="text-sm font-black uppercase tracking-widest text-foreground">Inventory History</h3>
                <p className="text-xs text-muted-foreground">Recent packs opened and tools acquired.</p>
              </div>
              
              {packHistory.length > 0 ? (
                packHistory.map((item: any) => (
                  <div key={item.event_id} className="rounded-md border border-border bg-background/60 p-3 flex gap-3 items-start">
                    <div className="mt-1 bg-primary/10 p-2 rounded shrink-0">
                      <ScrollText size={16} className="text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between items-start">
                        <div className="text-sm font-black text-foreground">Opened {item.pack_name}</div>
                        <div className="text-[10px] font-bold text-muted-foreground">{formatDate(item.created_at)}</div>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground border-l-2 border-primary/30 pl-2 ml-1">
                        Acquired: <strong className={`font-black uppercase ${
                          item.tool_tier === 'epic' ? 'text-purple-400' : 
                          item.tool_tier === 'rare' ? 'text-blue-400' : 'text-gray-400'
                        }`}>{item.tool_tier}</strong> tool for <strong className="text-foreground uppercase">{item.tool_role}</strong> slot.
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState icon={<History size={16} />} title="No Inventory History" body="Your record of opened packs and acquired tools will appear here." />
              )}
            </div>
          ) : activeTab === 'tools' ? (
            <div className="space-y-2">
              <div className="mb-2 text-[10px] font-black uppercase text-muted-foreground">Your Tool Arsenal</div>
              <BotaInventoryBrowser
                walletAddress={walletAddress || ''}
                tools={inventoryTools}
                onEquip={(toolId) => equipTool({ inventoryId: toolId, fighterId: 'bota:default', slot: 'primary' })}
                onUnequip={(toolId) => unequipTool({ fighterId: 'bota:default', slot: 'primary' })}
              />
            </div>
          ) : activeTab === 'loadouts' ? (
            <div className="space-y-2">
              <div className="mb-2 text-[10px] font-black uppercase text-muted-foreground">Active Loadouts</div>
              {inventoryTools.filter(t => t.isEquipped).length > 0 ? (
                <BotaInventoryBrowser
                  walletAddress={walletAddress || ''}
                  tools={inventoryTools.filter(t => t.isEquipped)}
                  onEquip={(toolId) => equipTool({ inventoryId: toolId, fighterId: 'bota:default', slot: 'primary' })}
                  onUnequip={(toolId) => unequipTool({ fighterId: 'bota:default', slot: 'primary' })}
                />
              ) : (
                <EmptyState icon={<ShieldHalf size={16} />} title="No Equipped Loadouts" body="You haven't equipped any tools to your fighters yet. Head to the Tools tab to assign gear." />
              )}
            </div>
          ) : activeTab === 'claim' ? (
            <div className="space-y-2">
              <div className="rounded-md border border-primary/25 bg-primary/10 p-3">
                <div className="flex items-center gap-2 text-sm font-black text-foreground">
                  <Gift size={16} className="text-primary" />
                  {formatNumber(claimableBantCredits)} BANTC ready
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Claimable onchain BantCredits for your wallet-linked rewards.</p>
              </div>
              {claimableClaims.length ? (
                claimableClaims.map((claim) => {
                  const isClaiming = claimMutation.isPending && claimMutation.variables?.id === claim.id
                  return (
                    <div key={claim.id} className="rounded-md border border-border bg-background/60 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-black text-foreground">{formatNumber(claim.amount)} BANTC</div>
                          <div className="text-xs text-muted-foreground">{claimRoleLabel(claim.role)} / {claim.chainName || `Chain ${claim.chainId}`}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => (wallets.length === 0 ? connectOrCreateWallet() : claimMutation.mutate(claim))}
                          disabled={claimMutation.isPending || !onchainConfig}
                          className="bb-tap inline-flex items-center gap-1 rounded bg-primary px-2.5 py-1.5 text-xs font-black text-primary-foreground disabled:opacity-50"
                        >
                          {isClaiming ? <Loader2 size={13} className="animate-spin" /> : <Gift size={13} />}
                          Claim
                        </button>
                      </div>
                    </div>
                  )
                })
              ) : (
                <EmptyState icon={<Trophy size={16} />} title="No claimable BANTC yet" body="When reward batches are published for your wallet, claims will appear here." />
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="rounded-md border border-border bg-background/60 p-3">
                <div className="text-xs font-black uppercase tracking-wide text-foreground">Account</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Wallet auth is handled through Privy. Notifications, queue alerts, and claim updates are tied to this connected account.
                </p>
              </div>
              <a
                href="/bota?section=rewards"
                className="bb-tap inline-flex w-full items-center justify-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs font-black text-foreground transition hover:bg-muted"
              >
                Open Rewards <ExternalLink size={13} />
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function EmptyState({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-md border border-border bg-background/60 p-3">
      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-foreground">
        {icon}
        {title}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</p>
    </div>
  )
}

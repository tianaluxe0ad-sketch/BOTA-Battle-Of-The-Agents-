'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bot,
  BrainCircuit,
  Coins,
  Cpu,
  Gamepad2,
  Globe2,
  Import as ImportIcon,
  Swords,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react'
import { apiRequest } from '@/lib/queryClient'
import { botaCharacterAlt, botaFighterProfileArt } from '@/lib/botaCharacterLayer'
import { botaAppHref } from '@/lib/botaUrl'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'
import { shareBotaChallenge } from '@/utils/sharing'
import type { BotaFighterProfile } from '@shared/botaFighterProfile'
import {
  fighterTitle,
  getFighterIdentity,
  getFighterSourceMeta,
  type FighterSourceKind,
} from '@/lib/bantahbro/fighterIdentity'
import { getBotaDerivativeFighter } from '@shared/botaDerivativeFighter'
import { BotaInventoryBrowser } from '@/components/BotaInventoryBrowser'
import { BotaPreBattleLoadout } from '@/components/BotaPreBattleLoadout'
import { useBotaInventory } from '@/hooks/useBotaInventory'
import ChallengePage from '@/components/pages/challenge-page'
type AgentSourceKind = FighterSourceKind

type FighterProfilesFeed = {
  profiles: BotaFighterProfile[]
  updatedAt: string
  sources?: {
    liveArena?: boolean
    note?: string
  }
}

type DirectoryAgent = {
  id: string
  name: string
  source: string
  sourceKind: AgentSourceKind
  sourceIconUrl: string | null
  identityLabel: string
  identityStory: string
  identityLogoUrl: string
  brainLabel: string
  league: string
  rank: number | null
  avatarUrl: string
  title: string
  wins: number
  losses: number
  bantCredits: number
  challenges: number
  fameScore: number
  watchers: number
  challengeVolume: number
  tokenSymbol: string | null
  chainLabel: string | null
  externalUrl: string | null
  lastBattleId: string | null
  imported: boolean
}

type AgentDirectory = {
  agents: DirectoryAgent[]
  source: 'fighter-profiles' | 'live-battles'
  updatedAt: string
  warning?: string
}

type AgentFollowFeed = {
  states: {
    agentId: string
    followerCount: number
    following: boolean
  }[]
  updatedAt: string
}

type ChallengeForm = {
  challengerAgentId: string
  opponentAgentId: string
  matchType: 'arena' | 'degen_vs'
  stakeAmount: number
  stakeCurrency: 'USDC' | 'BXBT'
  visibility: 'public' | 'private'
  predictionEnabled: boolean
  message: string
}

function titleCase(value?: string | null) {
  return String(value || 'bota')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function firstTitle(profile: BotaFighterProfile) {
  const derivative = getBotaDerivativeFighter(profile.metadata)
  if (derivative) return derivative.titles[1] || 'Derivative Fighter'
  return profile.titles?.[0] || profile.badgeLabel || titleCase(profile.archetype)
}

function metadataText(metadata: Record<string, unknown> | undefined, keys: string[]) {
  if (!metadata) return null
  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function metadataTokenLogo(metadata: Record<string, unknown> | undefined) {
  const token = metadata?.token
  if (!token || typeof token !== 'object' || Array.isArray(token)) return null
  const logoUrl = (token as Record<string, unknown>).logoUrl
  return typeof logoUrl === 'string' && logoUrl.trim() ? logoUrl.trim() : null
}

function sourceMetaForProfile(profile: BotaFighterProfile) {
  const derivative = getBotaDerivativeFighter(profile.metadata)
  const sourceHint = metadataText(profile.metadata, ['sourceHint', 'importSource', 'importedFrom'])?.toLowerCase() || ''
  const tokenLogo = metadataText(profile.metadata, ['sourceIconUrl', 'originIconUrl', 'tokenLogoUrl']) || metadataTokenLogo(profile.metadata)
  const isMemeToken = profile.origin === 'dexscreener' || sourceHint.includes('dex') || sourceHint.includes('meme')

  if (derivative) {
    return {
      kind: derivative.species,
      label: `${derivative.speciesLabel} · ${derivative.collectionLabel}`,
      iconUrl: profile.avatarUrl || null,
    }
  }

  if (isMemeToken) {
    return {
      kind: 'meme-token' as const,
      label: profile.tokenSymbol ? `$${profile.tokenSymbol} Meme Token` : 'Meme Token',
      iconUrl: tokenLogo,
    }
  }

  if (profile.origin === 'eliza') {
    return { kind: profile.origin, label: 'ElizaOS', iconUrl: '/assets/source-elizaos.png' }
  }

  if (profile.origin === 'virtuals') {
    return { kind: profile.origin, label: 'Virtuals Protocol', iconUrl: '/assets/source-virtuals.jpg' }
  }

  if (profile.origin === 'bankr') {
    return { kind: profile.origin, label: 'Bankr', iconUrl: '/assets/source-bankr.png' }
  }

  if (profile.origin === 'game-sdk') {
    return { kind: profile.origin, label: 'GAME SDK', iconUrl: null }
  }

  if (profile.origin === 'agentkit') {
    return { kind: profile.origin, label: 'AgentKit', iconUrl: null }
  }

  if (profile.origin === 'ens') {
    return { kind: profile.origin, label: profile.ensName ? `ENS · ${profile.ensName}` : 'ENS Fighter', iconUrl: '/assets/ens-badge.jpg' }
  }

  if (profile.origin === 'nft') {
    return { kind: profile.origin, label: 'NFT Import', iconUrl: tokenLogo }
  }

  if (profile.origin === 'token') {
    return {
      kind: 'meme-token' as const,
      label: profile.tokenSymbol ? `$${profile.tokenSymbol} Meme Token` : 'Meme Token',
      iconUrl: tokenLogo,
    }
  }

  if (profile.origin === 'bota') {
    return { kind: profile.origin, label: 'BOTA Native', iconUrl: '/assets/bota-bantah-icon.png' }
  }

  return { kind: profile.origin, label: 'Manual Import', iconUrl: null }
}

function SourceFallbackIcon({ kind }: { kind: AgentSourceKind }) {
  if (String(kind).startsWith('bantah-')) return <Bot size={11} />
  if (kind === 'eliza') return <BrainCircuit size={11} />
  if (kind === 'virtuals') return <Globe2 size={11} />
  if (kind === 'bankr') return <Coins size={11} />
  if (kind === 'game-sdk') return <Gamepad2 size={11} />
  if (kind === 'agentkit') return <Cpu size={11} />
  if (kind === 'ens') return <Globe2 size={11} />
  if (kind === 'nft') return <Bot size={11} />
  if (kind === 'meme-token' || kind === 'dexscreener') return <Coins size={11} />
  return <Bot size={11} />
}

function AgentSourceBadge({ agent }: { agent: DirectoryAgent }) {
  return (
    <span
      className="relative grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-background text-muted-foreground shadow-sm"
      title={agent.source}
      aria-label={agent.source}
    >
      <span className="absolute inset-0 grid place-items-center">
        <SourceFallbackIcon kind={agent.sourceKind} />
      </span>
      {agent.sourceIconUrl ? (
        <img
          src={agent.sourceIconUrl}
          alt=""
          className="relative h-full w-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={(event) => {
            event.currentTarget.style.display = 'none'
          }}
        />
      ) : null}
    </span>
  )
}

function AgentIdentityBadge({ agent }: { agent: DirectoryAgent }) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded border border-primary/25 bg-primary/10 px-2 py-1 text-[10px] font-black text-primary"
      title={agent.source}
    >
      <span className="grid h-4 w-4 shrink-0 place-items-center overflow-hidden rounded-full border border-primary/30 bg-background">
        <img
          src={agent.identityLogoUrl}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={(event) => {
            event.currentTarget.style.display = 'none'
          }}
        />
      </span>
      <span className="truncate">{agent.identityLabel}</span>
    </span>
  )
}

function formatBantCredits(value: number) {
  const safeValue = Math.max(0, Number.isFinite(value) ? value : 0)
  if (safeValue >= 1_000_000) return `${(safeValue / 1_000_000).toFixed(1)}M`
  if (safeValue >= 1_000) return `${(safeValue / 1_000).toFixed(1)}K`
  return Math.round(safeValue).toLocaleString()
}

function formatCompactCount(value: number) {
  const safeValue = Math.max(0, Number.isFinite(value) ? value : 0)
  if (safeValue >= 1_000_000) return `${(safeValue / 1_000_000).toFixed(1)}M`
  if (safeValue >= 1_000) return `${(safeValue / 1_000).toFixed(1)}K`
  return Math.round(safeValue).toLocaleString()
}

function profileToDirectoryAgent(profile: BotaFighterProfile): DirectoryAgent {
  const challenges = profile.wins + profile.losses
  const sourceMeta = getFighterSourceMeta(profile)
  const identity = getFighterIdentity(profile)

  return {
    id: profile.agentId,
    name: profile.origin === 'ens' && profile.ensName ? profile.ensName : profile.displayName,
    source: sourceMeta.label,
    sourceKind: sourceMeta.kind,
    sourceIconUrl: sourceMeta.iconUrl,
    identityLabel: identity.label,
    identityStory: identity.story,
    identityLogoUrl: identity.logoUrl,
    brainLabel: identity.brainLabel,
    league: profile.league,
    rank: profile.rank,
    avatarUrl: botaFighterProfileArt({
      avatarUrl: profile.avatarUrl,
      seed: profile.agentId,
      source: sourceMeta.kind,
    }),
    title: fighterTitle(profile),
    wins: profile.wins,
    losses: profile.losses,
    bantCredits: Math.max(0, Math.round(Number(profile.bantCreditsEarned || profile.metadata?.bantCreditsEarned || 0))),
    challenges: challenges > 0 ? challenges : profile.lastBattleId ? 1 : 0,
    fameScore: profile.fameScore,
    watchers: profile.watchers,
    challengeVolume: profile.challengeVolume,
    tokenSymbol: profile.tokenSymbol,
    chainLabel: profile.badgeLabel || titleCase(profile.chainId),
    externalUrl: profile.externalUrl,
    lastBattleId: profile.lastBattleId,
    imported: Boolean(profile.importedAt || profile.metadata?.importedFrom),
  }
}

function classForSide(side: AgentBattleSide) {
  if ((side.liquidityUsd || 0) > 750_000) return 'Liquidity Guardian'
  if (Math.abs(side.priceChangeH24 || 0) >= 100) return 'Chaos Berserker'
  if ((side.buysH24 || 0) + (side.sellsH24 || 0) > 5_000) return 'Momentum Scout'
  return 'Signal Striker'
}

function liveSideToDirectoryAgent(side: AgentBattleSide, battleId: string): DirectoryAgent {
  const score = Math.max(1, Math.min(100, Math.round(side.score || side.confidence || 50)))
  const rank = Math.max(1, 101 - score)
  const isEns = side.dataSource === 'ens-subgraph' || side.chainLabel === 'ENS' || /\.eth$/i.test(side.agentName || side.label || '')
  const isProfile = side.dataSource === 'fighter-profile'
  const sourceKind: AgentSourceKind = isEns ? 'ens' : isProfile ? 'bota' : 'meme-token'
  const source = isEns
    ? `ENS · ${side.agentName || side.label}`
    : isProfile
      ? 'BOTA Fighter Profile'
      : side.tokenSymbol
        ? `$${side.tokenSymbol} Meme Token`
        : 'Live Fighter'
  const displaySource = isEns ? 'ENS' : isProfile ? 'BOTA' : side.tokenSymbol ? 'Meme' : 'BOTA'
  const identityLabel = displaySource
  const identityLogoUrl = isEns ? '/assets/ens-badge.jpg' : '/assets/bota-bantah-icon.png'

  return {
    id: normalizeArenaAgentId(`live:${side.id}`),
    name: side.agentName || `${side.tokenSymbol || 'BOTA'} Agent`,
    source: displaySource,
    sourceKind,
    sourceIconUrl: isEns ? '/assets/ens-badge.jpg' : side.logoUrl,
    identityLabel,
    identityStory: displaySource,
    identityLogoUrl,
    brainLabel: displaySource,
    league: isEns ? 'ENS League' : `${side.chainLabel || titleCase(side.chainId)} League`,
    rank,
    avatarUrl: botaFighterProfileArt({
      avatarUrl: side.logoUrl,
      seed: `${side.agentName}:${side.id}`,
      source: sourceKind,
    }),
    title: classForSide(side),
    wins: 0,
    losses: 0,
    bantCredits: Math.max(0, Math.round(Number(side.bantCreditsEarned || 0))),
    challenges: 1,
    fameScore: score,
    watchers: 0,
    challengeVolume: Math.max(0, Math.round((side.buysH24 || 0) + (side.sellsH24 || 0))),
    tokenSymbol: side.tokenSymbol,
    chainLabel: side.chainLabel,
    externalUrl: side.pairUrl,
    lastBattleId: battleId,
    imported: false,
  }
}

async function fetchBotaAgentDirectory(): Promise<AgentDirectory> {
  let warning: string | undefined

  try {
    const profileFeed = await apiRequest(
      'GET',
      '/api/bantahbro/fighter-profiles?limit=100&refreshLive=true',
    ) as FighterProfilesFeed

    if (Array.isArray(profileFeed.profiles) && profileFeed.profiles.length > 0) {
      return {
        agents: profileFeed.profiles.map(profileToDirectoryAgent),
        source: 'fighter-profiles',
        updatedAt: profileFeed.updatedAt,
      }
    }
  } catch (error) {
    warning = error instanceof Error ? error.message : 'Fighter profile feed unavailable.'
  }

  return {
    agents: [],
    source: 'fighter-profiles',
    updatedAt: new Date().toISOString(),
    warning,
  }
}

export default function AgentsPage() {
  const { user, login, isAuthenticated } = useAuth()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'directory' | 'loadout' | 'challenges'>('directory')
  const [challengeTarget, setChallengeTarget] = useState<DirectoryAgent | null>(null)
  const [challengeForm, setChallengeForm] = useState<ChallengeForm | null>(null)
  const [showPreBattle, setShowPreBattle] = useState(false)
  const [followOverrides, setFollowOverrides] = useState<Record<string, AgentFollowFeed['states'][number]>>({})
  const { data, isLoading, isError, error } = useQuery<AgentDirectory>({
    queryKey: ['/api/bantahbro/agents-directory'],
    queryFn: fetchBotaAgentDirectory,
    retry: 1,
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const viewerWallet = typeof (user as any)?.walletAddress === 'string' ? (user as any).walletAddress : null
  const { tools: inventoryTools, equipTool, unequipTool } = useBotaInventory(viewerWallet)

  const agents = data?.agents || []
  const agentIds = useMemo(() => agents.map((agent) => agent.id), [agents])
  const { data: followFeed } = useQuery<AgentFollowFeed>({
    queryKey: ['/api/bantahbro/agent-follows', { agentIds: agentIds.join(',') }],
    enabled: agentIds.length > 0,
    retry: 1,
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
  const followStateByAgentId = useMemo(() => {
    const states = new Map<string, AgentFollowFeed['states'][number]>()
    for (const state of followFeed?.states || []) {
      states.set(state.agentId, state)
    }
    return states
  }, [followFeed])
  const challengeAgentOptions = useMemo(
    () => agents.filter((agent) => agent.id !== challengeTarget?.id),
    [agents, challengeTarget],
  )
  const stats = useMemo(() => {
    const imported = agents.filter((agent) => agent.imported).length
    const liveSeeded = agents.length - imported
    const wins = agents.reduce((total, agent) => total + agent.wins, 0)
    const losses = agents.reduce((total, agent) => total + agent.losses, 0)
    const bantCredits = agents.reduce((total, agent) => total + agent.bantCredits, 0)
    const challenges = agents.reduce((total, agent) => total + agent.challenges, 0)
    return { imported, liveSeeded, wins, losses, bantCredits, challenges }
  }, [agents])

  const createChallengeMutation = useMutation({
    mutationFn: async (form: ChallengeForm) => apiRequest('POST', '/api/bantahbro/agent-challenges', form),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/bantahbro/agent-challenges'] })
      setChallengeTarget(null)
      setChallengeForm(null)
      setShowPreBattle(false)
      const challengeCode = String(result?.challenge?.challengeCode || '').trim()
      if (challengeCode) {
        const { shareUrl } = shareBotaChallenge(
          challengeCode,
          result?.challenge?.challengerAgent?.name && result?.challenge?.opponentAgent?.name
            ? `${result.challenge.challengerAgent.name} vs ${result.challenge.opponentAgent.name}`
            : 'BOTA Agent Challenge',
          result?.challenge?.shareCaption,
        )
        navigator.clipboard?.writeText(shareUrl).catch(() => undefined)
      }
      toast({
        title: 'Challenge created',
        description: challengeCode
          ? 'Public social card link copied. Share it on X, Farcaster, Telegram, or Discord.'
          : result?.challenge?.shareCaption || 'PvP agent callout is live.',
      })
    },
    onError: (mutationError) => {
      toast({
        title: 'Challenge failed',
        description: mutationError instanceof Error ? mutationError.message : 'Could not create this challenge.',
        variant: 'destructive',
      })
    },
  })

  const toggleFollowMutation = useMutation({
    mutationFn: async (agent: DirectoryAgent) => apiRequest(
      'POST',
      `/api/bantahbro/agent-follows/${encodeURIComponent(agent.id)}/toggle`,
      { agentName: agent.name },
    ),
    onSuccess: (result: any, agent) => {
      const agentId = String(result?.agentId || agent.id)
      const following = Boolean(result?.following)
      const followerCount = Math.max(0, Number(result?.followerCount || 0))
      setFollowOverrides((current) => ({
        ...current,
        [agentId]: { agentId, following, followerCount },
      }))
      queryClient.invalidateQueries({ queryKey: ['/api/bantahbro/agent-follows'] })
      queryClient.invalidateQueries({ queryKey: ['/api/notifications'] })
      toast({
        title: following ? 'Following agent' : 'Unfollowed agent',
        description: following
          ? 'You will see this fighter in your agent updates.'
          : 'This fighter was removed from your followed agents.',
      })
    },
    onError: (mutationError) => {
      toast({
        title: 'Follow failed',
        description: mutationError instanceof Error ? mutationError.message : 'Could not update this follow.',
        variant: 'destructive',
      })
    },
  })

  const openChallengeModal = (agent: DirectoryAgent) => {
    if (!isAuthenticated) {
      login()
      return
    }
    const challenger = agents.find((candidate) => candidate.id !== agent.id) || null
    setChallengeTarget(agent)
    setChallengeForm({
      challengerAgentId: challenger?.id || '',
      opponentAgentId: agent.id,
      matchType: 'arena',
      stakeAmount: 50,
      stakeCurrency: 'USDC',
      visibility: 'public',
      predictionEnabled: true,
      message: 'Your bot is overrated.',
    })
  }

  const updateChallengeForm = <K extends keyof ChallengeForm>(key: K, value: ChallengeForm[K]) => {
    setChallengeForm((current) => (current ? { ...current, [key]: value } : current))
  }

  const prepareChallenge = () => {
    if (!isAuthenticated) {
      login()
      return
    }
    if (!challengeForm?.challengerAgentId) {
      toast({
        title: 'Pick your agent',
        description: 'Choose the agent you want to send into this PvP callout.',
        variant: 'destructive',
      })
      return
    }
    setShowPreBattle(true)
  }

  const submitChallenge = () => {
    if (!challengeForm) return;
    createChallengeMutation.mutate(challengeForm)
  }

  const toggleFollow = (agent: DirectoryAgent) => {
    if (!isAuthenticated) {
      login()
      return
    }
    toggleFollowMutation.mutate(agent)
  }

  return (
    <div className="flex-1 bg-card border border-border rounded overflow-hidden flex flex-col">
      <div className="border-b border-border bg-background px-4 py-3 shrink-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Bot size={18} className="text-primary" />
            <span className="font-bold text-foreground">Agents</span>
            <span className="text-xs text-muted-foreground">BOTA arena fighters</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex bg-background border border-border rounded p-0.5">
              <button
                type="button"
                onClick={() => setActiveTab('directory')}
                className={`px-3 py-1 rounded text-xs font-bold ${activeTab === 'directory' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Directory
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('loadout')}
                className={`px-3 py-1 rounded text-xs font-bold ${activeTab === 'loadout' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                My Loadout
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('challenges')}
                className={`px-3 py-1 rounded text-xs font-bold ${activeTab === 'challenges' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Challenges
              </button>
            </div>
            <a
              href={botaAppHref('/bota/import')}
              className="inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90"
            >
              <ImportIcon size={13} />
              Import Agent
            </a>
          </div>
        </div>
      </div>

      {activeTab === 'challenges' ? (
        <ChallengePage />
      ) : (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {activeTab === 'loadout' ? (
            <BotaInventoryBrowser 
              walletAddress={viewerWallet || ''} 
            tools={inventoryTools} 
            onEquip={(toolId) => {
              equipTool({ inventoryId: toolId, fighterId: 'bota:default', slot: 'primary' });
            }}
            onUnequip={(toolId) => {
              unequipTool({ fighterId: 'bota:default', slot: 'primary' });
            }}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/70 pb-2 text-[11px] text-muted-foreground">
              <span><strong className="text-foreground">{agents.length}</strong> arena agents</span>
              <span><strong className="text-foreground">{stats.imported}</strong> imported</span>
              <span><strong className="text-foreground">{stats.liveSeeded}</strong> live seeded</span>
              <span><strong className="text-foreground">{stats.wins}</strong> wins</span>
              <span><strong className="text-foreground">{stats.challenges}</strong> challenges</span>
              <span><strong className="text-foreground">{formatBantCredits(stats.bantCredits)}</strong> BantCredit</span>
            </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="h-28 animate-pulse rounded border border-border bg-muted/40" />
            ))}
          </div>
        ) : isError ? (
          <div className="rounded border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {error instanceof Error ? error.message : 'Could not load BOTA agents.'}
          </div>
        ) : agents.length === 0 ? (
          <div className="rounded border border-border p-8 text-center text-muted-foreground">
            <div className="mb-1 text-sm font-bold text-foreground">No arena agents yet</div>
            <div className="text-xs">Import an agent or wait for live battles to seed the fighter list.</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {agents.map((agent) => {
              const followState = followOverrides[agent.id] || followStateByAgentId.get(agent.id)
              const isFollowing = Boolean(followState?.following)
              const followerCount = followState?.followerCount || 0
              const isFollowPending = toggleFollowMutation.isPending && toggleFollowMutation.variables?.id === agent.id

              return (
                <div
                  key={agent.id}
                  className="rounded border border-border bg-background p-3 transition-colors hover:bg-muted/30"
                >
                  <div className="flex items-start gap-3">
                    <span className="relative h-16 w-16 shrink-0">
                      <img
                        src={agent.avatarUrl}
                        alt={botaCharacterAlt(agent.name)}
                        className="h-16 w-16 rounded border border-border bg-muted/30 object-cover object-center p-0"
                      />
                      <span className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center overflow-hidden rounded-full border border-background bg-card shadow">
                        <img
                          src={agent.sourceIconUrl || agent.identityLogoUrl}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                          onError={(event) => {
                            event.currentTarget.style.display = 'none'
                          }}
                        />
                      </span>
                    </span>
                    <div className="min-w-0 flex-1 pt-1">
                      <div className="truncate text-base font-black text-foreground">{agent.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{agent.title}</div>
                      <div className="mt-2 flex min-w-0 flex-wrap gap-1">
                        <AgentSourceBadge agent={agent} />
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-4 divide-x divide-border/70 text-center">
                    <div className="px-2">
                      <div className="text-sm font-black text-foreground">
                        {agent.rank ? `#${agent.rank}` : '-'}
                      </div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">Rank</div>
                    </div>
                    <div className="px-2">
                      <div className="text-sm font-black text-foreground">{agent.wins}</div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">Wins</div>
                    </div>
                    <div className="px-2">
                      <div className="text-sm font-black text-foreground">{formatBantCredits(agent.bantCredits)}</div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">BantCredit</div>
                    </div>
                    <div className="px-2">
                      <div className="text-sm font-black text-foreground">{agent.challenges}</div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">Challenges</div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-2 border-t border-border/70 pt-3 text-[11px] text-muted-foreground">
                    <button
                      type="button"
                      onClick={() => openChallengeModal(agent)}
                      className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1 text-[10px] font-black text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
                    >
                      <Swords size={11} />
                      Challenge
                    </button>
                    <div className="flex min-w-0 items-center justify-end gap-2">
                      <span className="truncate text-[10px]">
                        {formatCompactCount(followerCount)} followers
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleFollow(agent)}
                        disabled={isFollowPending}
                        className={`inline-flex h-7 items-center gap-1 rounded border px-2 text-[10px] font-black transition disabled:opacity-60 ${
                          isFollowing
                            ? 'border-border bg-muted text-foreground hover:bg-muted/80'
                            : 'border-primary/50 bg-primary/10 text-primary hover:bg-primary/15'
                        }`}
                      >
                        {isFollowing ? <UserCheck size={11} /> : <UserPlus size={11} />}
                        {isFollowPending ? 'Saving' : isFollowing ? 'Unfollow' : 'Follow'}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        </>
        )}
      </div>
      )}

      {challengeTarget && challengeForm && (
        <Dialog open={!!challengeTarget} onOpenChange={(open) => !open && setChallengeTarget(null)}>
          <DialogContent className="max-h-[92vh] w-full max-w-sm overflow-y-auto rounded border border-border bg-card p-0">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <div>
                <div className="text-sm font-black leading-tight text-foreground">Challenge Agent</div>
                <div className="text-[10px] leading-tight text-muted-foreground">PvP callout for Arena or Degen VS.</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setChallengeTarget(null)
                  setChallengeForm(null)
                  setShowPreBattle(false)
                }}
                className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <X size={16} />
              </button>
            </div>

            {showPreBattle ? (
              <BotaPreBattleLoadout
                viewerWallet={viewerWallet}
                challengerAgentId={challengeForm.challengerAgentId}
                opponentAgentName={challengeTarget.name}
                opponentAvatarUrl={challengeTarget.avatarUrl}
                onConfirm={submitChallenge}
                onCancel={() => setShowPreBattle(false)}
              />
            ) : (
            <div className="space-y-2 p-3">
              <label className="block">
                <span className="mb-1 block text-[9px] font-black uppercase text-muted-foreground">Your Agent</span>
                <select
                  value={challengeForm.challengerAgentId}
                  onChange={(event) => updateChallengeForm('challengerAgentId', event.target.value)}
                  className="h-8 w-full rounded border border-border bg-background px-2 text-xs font-bold text-foreground outline-none"
                >
                  {challengeAgentOptions.length === 0 ? (
                    <option value="">Import another agent first</option>
                  ) : null}
                  {challengeAgentOptions.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name} {agent.rank ? `(#${agent.rank})` : ''}
                    </option>
                  ))}
                </select>
              </label>

              <div className="rounded border border-border bg-background px-2 py-1.5">
                <div className="mb-1 text-[9px] font-black uppercase text-muted-foreground">Opponent</div>
                <div className="flex items-center gap-2">
                  <img src={challengeTarget.avatarUrl} alt="" className="h-10 w-10 rounded border border-border bg-muted/30 object-cover object-center p-0" />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-black text-foreground">{challengeTarget.name}</div>
                    <div className="truncate text-[10px] text-muted-foreground">{challengeTarget.title}</div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {[
                  ['arena', 'Arena'],
                  ['degen_vs', 'Degen VS'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => updateChallengeForm('matchType', value as ChallengeForm['matchType'])}
                    className={`h-8 rounded border px-2 text-[11px] font-black transition ${
                      challengeForm.matchType === value
                        ? 'border-primary bg-primary/15 text-primary'
                        : 'border-border bg-background text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-[1fr_7rem] gap-2">
                <label className="block">
                  <span className="mb-1 block text-[9px] font-black uppercase text-muted-foreground">Stake</span>
                  <input
                    type="number"
                    min={0}
                    value={challengeForm.stakeAmount}
                    onChange={(event) => updateChallengeForm('stakeAmount', Number(event.target.value))}
                    className="h-8 w-full rounded border border-border bg-background px-2 text-xs font-bold text-foreground outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[9px] font-black uppercase text-muted-foreground">Token</span>
                  <select
                    value={challengeForm.stakeCurrency}
                    onChange={(event) => updateChallengeForm('stakeCurrency', event.target.value as ChallengeForm['stakeCurrency'])}
                    className="h-8 w-full rounded border border-border bg-background px-2 text-xs font-bold text-foreground outline-none"
                  >
                    <option value="USDC">USDC</option>
                    <option value="BXBT">BXBT</option>
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-[9px] font-black uppercase text-muted-foreground">Message</span>
                <textarea
                  value={challengeForm.message}
                  onChange={(event) => updateChallengeForm('message', event.target.value)}
                  maxLength={240}
                  rows={2}
                  className="w-full resize-none rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none"
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => updateChallengeForm('visibility', challengeForm.visibility === 'public' ? 'private' : 'public')}
                  className="h-8 rounded border border-border bg-background px-2 text-[11px] font-bold text-foreground"
                >
                  {challengeForm.visibility === 'public' ? 'Public Challenge' : 'Private Challenge'}
                </button>
                <button
                  type="button"
                  onClick={() => updateChallengeForm('predictionEnabled', !challengeForm.predictionEnabled)}
                  className="h-8 rounded border border-border bg-background px-2 text-[11px] font-bold text-foreground"
                >
                  {challengeForm.predictionEnabled ? 'Prediction On' : 'Prediction Off'}
                </button>
              </div>

              <button
                type="button"
                onClick={prepareChallenge}
                disabled={createChallengeMutation.isPending}
                className="h-10 w-full rounded bg-primary font-black text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
              >
                {createChallengeMutation.isPending ? 'Calling out...' : 'Next: Pre-Battle Loadout'}
              </button>
            </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

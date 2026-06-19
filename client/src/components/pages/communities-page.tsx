'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Crown, Swords, Trophy, Users } from 'lucide-react'
import { botaCharacterAlt, botaFighterProfileArt } from '@/lib/botaCharacterLayer'
import { getFighterSourceMeta } from '@/lib/bantahbro/fighterIdentity'
import type { BotaFighterProfile } from '@shared/botaFighterProfile'

type FighterProfilesFeed = {
  profiles: BotaFighterProfile[]
  updatedAt: string
}

type CommunityKey =
  | 'all'
  | 'ens'
  | 'virtuals'
  | 'eliza'
  | 'bankr'
  | 'agentkit'
  | 'game-sdk'
  | 'meme'
  | 'nft'
  | 'bota'

type CommunityAgent = {
  id: string
  name: string
  source: string
  sourceIconUrl: string | null
  avatarUrl: string
  rank: number | null
  wins: number
  losses: number
  bantCredits: number
  score: number
}

type DisplayCommunitySummary = {
  key: CommunityKey
  label: string
  iconUrl: string
  agents: CommunityAgent[]
  wins: number
  losses: number
  bantCredits: number
  score: number
  topAgent: CommunityAgent | null
}

type CommunityStatsSummary = {
  key: CommunityKey
  label: string
  iconUrl: string
  agents: number
  wins: number
  losses: number
  bantCredits: number
  score: number
  topAgent: {
    agentId: string
    name: string
    rank: number | null
    wins: number
    losses: number
    bantCredits: number
    score: number
    avatarUrl: string | null
  } | null
  onchain: {
    battles: number
    events: number
    wins: number
    losses: number
    spectators: number
    fighterBantCredits: number
    spectatorBantCredits: number
    totalBantCredits: number
  }
}

type CommunitiesStatsFeed = {
  communities: CommunityStatsSummary[]
  totals: CommunityStatsSummary
  sources: {
    profiles: string
    arenaRecords: string
    profileRowsScanned: number
    maxProfiles: number
    maxRecords: number
  }
  warning?: string
  updatedAt: string
}

const COMMUNITY_DEFS: Array<{ key: CommunityKey; label: string; iconUrl: string }> = [
  { key: 'all', label: 'All', iconUrl: '/assets/bota-bantah-icon.png' },
  { key: 'ens', label: 'ENS', iconUrl: '/assets/ens-badge.jpg' },
  { key: 'virtuals', label: 'Virtuals', iconUrl: '/assets/source-virtuals.jpg' },
  { key: 'eliza', label: 'ElizaOS', iconUrl: '/assets/source-elizaos.png' },
  { key: 'bankr', label: 'Bankr', iconUrl: '/assets/source-bankr.png' },
  { key: 'agentkit', label: 'AgentKit', iconUrl: '/assets/source-agentkit.svg' },
  { key: 'game-sdk', label: 'GAME SDK', iconUrl: '/assets/source-game-sdk.svg' },
  { key: 'meme', label: 'Meme', iconUrl: '/assets/bota-bantah-icon.png' },
  { key: 'nft', label: 'NFT', iconUrl: '/assets/bota-bantah-icon.png' },
  { key: 'bota', label: 'BOTA', iconUrl: '/assets/bota-bantah-icon.png' },
]

function formatCompact(value: number) {
  const safe = Math.max(0, Number.isFinite(value) ? value : 0)
  if (safe >= 1_000_000) return `${(safe / 1_000_000).toFixed(1)}M`
  if (safe >= 1_000) return `${(safe / 1_000).toFixed(1)}K`
  return Math.round(safe).toLocaleString()
}

function profileName(profile: BotaFighterProfile) {
  return profile.origin === 'ens' && profile.ensName ? profile.ensName : profile.displayName
}

function communityKeyForProfile(profile: BotaFighterProfile): CommunityKey {
  const source = getFighterSourceMeta(profile)
  if (source.leaderboardOrigin === 'virtuals') return 'virtuals'
  if (source.leaderboardOrigin === 'eliza') return 'eliza'
  if (source.leaderboardOrigin === 'bankr') return 'bankr'
  if (source.leaderboardOrigin === 'agentkit') return 'agentkit'
  if (source.leaderboardOrigin === 'game-sdk') return 'game-sdk'
  if (source.leaderboardOrigin === 'ens') return 'ens'
  if (source.leaderboardOrigin === 'meme') return 'meme'
  if (source.leaderboardOrigin === 'nft') return 'nft'
  return 'bota'
}

function profileToCommunityAgent(profile: BotaFighterProfile): CommunityAgent {
  const source = getFighterSourceMeta(profile)
  return {
    id: profile.agentId,
    name: profileName(profile),
    source: source.label,
    sourceIconUrl: source.iconUrl,
    avatarUrl: botaFighterProfileArt({
      avatarUrl: profile.avatarUrl,
      seed: profile.agentId,
      source: source.kind,
    }),
    rank: profile.rank,
    wins: profile.wins,
    losses: profile.losses,
    bantCredits: Math.max(0, Math.round(Number(profile.bantCreditsEarned || profile.metadata?.bantCreditsEarned || 0))),
    score: Math.max(0, Math.round(Number(profile.fameScore || 0))),
  }
}

function buildCommunitySummaries(profiles: BotaFighterProfile[]) {
  const grouped = new Map<CommunityKey, CommunityAgent[]>()
  for (const definition of COMMUNITY_DEFS) grouped.set(definition.key, [])

  for (const profile of profiles) {
    const agent = profileToCommunityAgent(profile)
    grouped.get('all')?.push(agent)
    grouped.get(communityKeyForProfile(profile))?.push(agent)
  }

  return COMMUNITY_DEFS.map((definition) => {
    const agents = [...(grouped.get(definition.key) || [])].sort((left, right) => {
      const winsDiff = right.wins - left.wins
      if (winsDiff !== 0) return winsDiff
      const scoreDiff = right.score - left.score
      if (scoreDiff !== 0) return scoreDiff
      return (left.rank || 9999) - (right.rank || 9999)
    })
    const wins = agents.reduce((total, agent) => total + agent.wins, 0)
    const losses = agents.reduce((total, agent) => total + agent.losses, 0)
    const bantCredits = agents.reduce((total, agent) => total + agent.bantCredits, 0)
    const score = agents.reduce((total, agent) => total + agent.score, 0)

    return {
      ...definition,
      agents,
      wins,
      losses,
      bantCredits,
      score,
      topAgent: agents[0] || null,
    }
  })
}

function fallbackStatsFromDisplay(summary: DisplayCommunitySummary): CommunityStatsSummary {
  return {
    key: summary.key,
    label: summary.label,
    iconUrl: summary.iconUrl,
    agents: summary.agents.length,
    wins: summary.wins,
    losses: summary.losses,
    bantCredits: summary.bantCredits,
    score: summary.score,
    topAgent: summary.topAgent
      ? {
          agentId: summary.topAgent.id,
          name: summary.topAgent.name,
          rank: summary.topAgent.rank,
          wins: summary.topAgent.wins,
          losses: summary.topAgent.losses,
          bantCredits: summary.topAgent.bantCredits,
          score: summary.topAgent.score,
          avatarUrl: summary.topAgent.avatarUrl,
        }
      : null,
    onchain: {
      battles: 0,
      events: 0,
      wins: 0,
      losses: 0,
      spectators: 0,
      fighterBantCredits: 0,
      spectatorBantCredits: 0,
      totalBantCredits: 0,
    },
  }
}

function topBy(summaries: CommunityStatsSummary[], selector: (summary: CommunityStatsSummary) => number) {
  return [...summaries]
    .filter((summary) => summary.key !== 'all')
    .sort((left, right) => selector(right) - selector(left))[0] || null
}

export default function CommunitiesPage({ embedded = false }: { embedded?: boolean }) {
  const [activeKey, setActiveKey] = useState<CommunityKey>('all')
  const { data, isLoading, isError, error } = useQuery<FighterProfilesFeed>({
    queryKey: ['/api/bantahbro/fighter-profiles', { limit: '5000', refreshLive: 'true' }],
    staleTime: 20_000,
    refetchInterval: 45_000,
  })
  const {
    data: statsData,
    isLoading: statsLoading,
    isError: statsIsError,
    error: statsError,
  } = useQuery<CommunitiesStatsFeed>({
    queryKey: ['/api/bantahbro/fighter-communities/stats', { maxProfiles: '10000', maxRecords: '10000' }],
    staleTime: 45_000,
    refetchInterval: 60_000,
  })

  const displaySummaries = useMemo(
    () => buildCommunitySummaries(data?.profiles || []),
    [data?.profiles],
  )
  const aggregateSummaries = useMemo(
    () => statsData?.communities?.some((summary) => summary.agents > 0 || summary.onchain.battles > 0)
      ? statsData.communities
      : displaySummaries.map(fallbackStatsFromDisplay),
    [displaySummaries, statsData?.communities],
  )
  const activeCommunity = aggregateSummaries.find((summary) => summary.key === activeKey) || aggregateSummaries[0]
  const activeDisplayCommunity = displaySummaries.find((summary) => summary.key === activeKey) || displaySummaries[0]
  const topWins = topBy(aggregateSummaries, (summary) => summary.wins)
  const topEarned = topBy(aggregateSummaries, (summary) => summary.bantCredits)
  const biggest = topBy(aggregateSummaries, (summary) => summary.agents)

  const content = (
    <div className="flex-1 overflow-y-auto bg-background p-2 pb-24 text-foreground md:p-3 md:pb-3">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3">
        <section className="flex gap-1 overflow-x-auto rounded-lg bg-card p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {aggregateSummaries.map((summary) => (
            <button
              key={summary.key}
              type="button"
              onClick={() => setActiveKey(summary.key)}
              className={`flex h-11 shrink-0 items-center gap-2 rounded-md px-2.5 text-xs font-black transition ${
                activeKey === summary.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-background hover:text-foreground'
              }`}
            >
              <span className="grid h-6 w-6 place-items-center overflow-hidden rounded-full bg-background">
                <img src={summary.iconUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
              </span>
              <span>{summary.label}</span>
              <span className={activeKey === summary.key ? 'text-primary-foreground/75' : 'text-muted-foreground'}>
                {formatCompact(summary.agents)}
              </span>
            </button>
          ))}
        </section>

        <section className="grid grid-cols-4 lg:grid-cols-7 gap-1 md:gap-1.5">
          <div className="rounded-md bg-card p-1.5 text-center md:text-left">
            <div className="flex items-center justify-center md:justify-start gap-1 text-[9px] font-black uppercase text-muted-foreground">
              <Users size={12} className="text-primary" /> Agents
            </div>
            <div className="mt-0.5 text-sm md:text-base font-black">{formatCompact(activeCommunity.agents)}</div>
          </div>
          <div className="rounded-md bg-card p-1.5 text-center md:text-left">
            <div className="flex items-center justify-center md:justify-start gap-1 text-[9px] font-black uppercase text-muted-foreground">
              <Trophy size={12} className="text-primary" /> Wins
            </div>
            <div className="mt-0.5 text-sm md:text-base font-black">{formatCompact(activeCommunity.wins)}</div>
          </div>
          <div className="rounded-md bg-card p-1.5 text-center md:text-left">
            <div className="flex items-center justify-center md:justify-start gap-1 text-[9px] font-black uppercase text-muted-foreground">
              <Swords size={12} className="text-primary" /> Losses
            </div>
            <div className="mt-0.5 text-sm md:text-base font-black">{formatCompact(activeCommunity.losses)}</div>
          </div>
          <div className="rounded-md bg-card p-1.5 text-center md:text-left">
            <div className="flex items-center justify-center md:justify-start gap-1 text-[9px] font-black uppercase text-muted-foreground">
              <Crown size={12} className="text-primary" /> BantCredit
            </div>
            <div className="mt-0.5 text-sm md:text-base font-black">{formatCompact(activeCommunity.bantCredits)}</div>
          </div>
          <div className="rounded-md bg-card p-1.5 text-center md:text-left">
            <div className="text-[9px] font-black uppercase text-muted-foreground">Recorded</div>
            <div className="mt-0.5 text-sm md:text-base font-black">{formatCompact(activeCommunity.onchain.battles)}</div>
          </div>
          <div className="rounded-md bg-card p-1.5 text-center md:text-left">
            <div className="text-[9px] font-black uppercase text-muted-foreground">Events</div>
            <div className="mt-0.5 text-sm md:text-base font-black">{formatCompact(activeCommunity.onchain.events)}</div>
          </div>
          <div className="rounded-md bg-card p-1.5 text-center md:text-left">
            <div className="text-[9px] font-black uppercase text-muted-foreground">Onchain BC</div>
            <div className="mt-0.5 text-sm md:text-base font-black">{formatCompact(activeCommunity.onchain.totalBantCredits)}</div>
          </div>
        </section>

        {isError || statsIsError ? (
          <div className="rounded-lg bg-destructive/10 p-3 text-sm font-bold text-destructive">
            {error instanceof Error
              ? error.message
              : statsError instanceof Error
                ? statsError.message
                : 'Community data could not be loaded.'}
          </div>
        ) : null}

        <section>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {activeDisplayCommunity.agents.map((agent) => (
              <article key={agent.id} className="flex gap-3 rounded-lg bg-card p-3 shadow-sm">
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-background">
                  <img
                    src={agent.avatarUrl}
                    alt={botaCharacterAlt(agent.name)}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                  {agent.sourceIconUrl ? (
                    <span className="absolute bottom-1 right-1 grid h-5 w-5 place-items-center overflow-hidden rounded-full bg-background shadow">
                      <img src={agent.sourceIconUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                    </span>
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-black">{agent.name}</h2>
                      <p className="truncate text-[11px] font-bold text-muted-foreground">{agent.source}</p>
                    </div>
                    <span className="rounded bg-primary/12 px-1.5 py-1 text-[10px] font-black text-primary">
                      #{agent.rank || '-'}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1 text-center">
                    <div className="rounded bg-background/70 px-1 py-1">
                      <div className="text-xs font-black">{formatCompact(agent.wins)}</div>
                      <div className="text-[9px] font-bold uppercase text-muted-foreground">Wins</div>
                    </div>
                    <div className="rounded bg-background/70 px-1 py-1">
                      <div className="text-xs font-black">{formatCompact(agent.losses)}</div>
                      <div className="text-[9px] font-bold uppercase text-muted-foreground">Loss</div>
                    </div>
                    <div className="rounded bg-background/70 px-1 py-1">
                      <div className="text-xs font-black">{formatCompact(agent.bantCredits)}</div>
                      <div className="text-[9px] font-bold uppercase text-muted-foreground">BC</div>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        {isLoading || statsLoading ? (
          <div className="rounded-lg bg-card p-4 text-sm font-bold text-muted-foreground">
            Loading community stats...
          </div>
        ) : !activeDisplayCommunity.agents.length ? (
          <div className="rounded-lg bg-card p-4 text-sm font-bold text-muted-foreground">
            No agents found for {activeCommunity.label} in the live fighter profile feed.
          </div>
        ) : null}
      </div>
    </div>
  )

  return embedded ? content : <main className="flex-1 flex flex-col min-h-0 overflow-hidden">{content}</main>
}

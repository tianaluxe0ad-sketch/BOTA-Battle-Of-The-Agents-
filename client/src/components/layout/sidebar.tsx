'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AppSection } from '@/app/page'
import type { AgentBattleFeed } from '@/types/agentBattle'
import { botaCharacterAlt, botaFighterProfileArt } from '@/lib/botaCharacterLayer'
import { getFighterSourceMeta } from '@/lib/bantahbro/fighterIdentity'
import type { BotaFighterProfile } from '@shared/botaFighterProfile'

interface FighterProfilesFeed {
  profiles: BotaFighterProfile[]
  updatedAt: string
}

interface SidebarProps {
  activeSection?: AppSection
  onNavigate?: (section: AppSection) => void
  onClose?: () => void
}

const menuItems: { icon: string; label: string; section: AppSection }[] = [
  { icon: '🏟️', label: 'ARENA (A2A)', section: 'battles' },
  { icon: '🤖', label: 'Agents', section: 'agents' },
  { icon: '⬇️', label: 'Create Fighter', section: 'import' },
  { icon: '🛒', label: 'Marketplace', section: 'marketplace' },
  { icon: '🏆', label: 'Leaderboard', section: 'leaderboard' },
  { icon: '🌐', label: 'Communities', section: 'communities' },
  { icon: '🎁', label: 'Rewards', section: 'rewards' },
  { icon: '📘', label: 'Docs', section: 'docs' },
  { icon: '📣', label: 'Advertise', section: 'ads' },
]

function profileDisplayName(profile: BotaFighterProfile) {
  return profile.origin === 'ens' && profile.ensName ? profile.ensName : profile.displayName
}

function compactNumber(value: number) {
  const safe = Math.max(0, Number.isFinite(value) ? value : 0)
  if (safe >= 1_000_000) return `${(safe / 1_000_000).toFixed(1)}M`
  if (safe >= 1_000) return `${(safe / 1_000).toFixed(1)}K`
  return Math.round(safe).toLocaleString()
}

function compactBantCredit(value: number) {
  return `${compactNumber(value)} BC`
}

function profileBantCredit(profile: BotaFighterProfile) {
  const metadataValue = Number(profile.metadata?.bantCreditsEarned)
  return Math.max(
    0,
    Math.round(Number(profile.bantCreditsEarned || 0) || (Number.isFinite(metadataValue) ? metadataValue : 0)),
  )
}

function sortByLeaderboardRank(profiles: BotaFighterProfile[]) {
  return [...profiles].sort((left, right) => {
    const leftRank = Number(left.rank || Number.POSITIVE_INFINITY)
    const rightRank = Number(right.rank || Number.POSITIVE_INFINITY)
    if (leftRank !== rightRank) return leftRank - rightRank
    const rightScore = Number(right.fameScore || 0)
    const leftScore = Number(left.fameScore || 0)
    if (rightScore !== leftScore) return rightScore - leftScore
    return Number(right.wins || 0) - Number(left.wins || 0)
  })
}

export default function Sidebar({
  activeSection,
  onNavigate,
  onClose,
}: SidebarProps) {
  const { data: battleFeed } = useQuery<AgentBattleFeed>({
    queryKey: ['/api/bantahbro/agent-battles/live', { limit: '6', liveStats: '0' }],
    staleTime: 20_000,
    refetchInterval: 30_000,
  })
  const { data: fighterFeed, isLoading: isAgentOfWeekLoading } = useQuery<FighterProfilesFeed>({
    queryKey: ['/api/bantahbro/fighter-profiles', { limit: '20', refreshLive: 'true' }],
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
  
  const { data: agentsDirData } = useQuery<{ agents: any[] }>({
    queryKey: ['/api/bantahbro/agents-directory'],
    staleTime: 60_000,
  })
  const totalAgentsCount = agentsDirData?.agents?.length || 0

  const liveBattleCount = battleFeed?.battles?.length ?? 0
  const agentOfWeek = useMemo(
    () => sortByLeaderboardRank(fighterFeed?.profiles || [])[0] || null,
    [fighterFeed?.profiles],
  )
  const agentOfWeekMeta = agentOfWeek ? getFighterSourceMeta(agentOfWeek) : null
  const agentOfWeekName = agentOfWeek ? profileDisplayName(agentOfWeek) : ''
  const agentOfWeekArt = agentOfWeek
    ? botaFighterProfileArt({
        avatarUrl: agentOfWeek.avatarUrl,
        seed: agentOfWeek.agentId,
        source: agentOfWeekMeta?.kind || agentOfWeek.origin,
      })
    : ''
  const agentOfWeekBantCredit = agentOfWeek ? profileBantCredit(agentOfWeek) : 0

  const handleClick = (section: AppSection) => {
    onNavigate?.(section)
    onClose?.()
  }

  return (
    <div className="w-52 bg-sidebar border-r border-border flex flex-col overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="p-2 border-b border-border">
        <div className="flex items-center gap-2 mb-2">
          <img src="/assets/bota-bantah-icon.png" alt="BOTA" width={36} height={36} className="rounded-lg bg-[#0f101c] object-contain" />
          <div>
            <div className="text-sm font-bold text-primary leading-tight">BOTA</div>
            <div className="text-xs text-muted-foreground leading-tight">Battle Of The Agents</div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="py-1 px-0">
          <div className="text-xs font-bold text-muted-foreground px-3 py-1 mt-1 tracking-wider">MAIN</div>
          {menuItems.map((item) => {
            const isActive = activeSection === item.section

            return (
              <button
                key={item.label}
                onClick={() => {
                  handleClick(item.section)
                }}
                className={`w-full text-left text-sm py-1.5 px-3 transition flex items-center gap-2 ${
                  isActive
                    ? 'bg-primary/20 text-primary font-bold border-r-2 border-primary'
                    : 'hover:bg-sidebar-accent hover:text-accent-foreground text-sidebar-foreground'
                }`}
              >
                <span className="grid h-5 w-5 shrink-0 place-items-center text-base leading-none">
                  {item.icon}
                </span>
                <span className="flex-1">{item.label}</span>
                {item.section === 'battles' && (
                  <span className="ml-auto rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-black leading-none text-white">
                    {liveBattleCount}
                  </span>
                )}
                {item.section === 'agents' && totalAgentsCount > 0 && (
                  <span className="ml-auto rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-black leading-none text-primary">
                    {totalAgentsCount}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="hidden px-2 pb-2 pt-1 md:block">
          {agentOfWeek ? (
            <button
              type="button"
              onClick={() => handleClick('leaderboard')}
              className="group w-full overflow-hidden rounded-lg bg-gradient-to-br from-primary/18 via-card to-card p-2 text-left shadow-[0_0_24px_rgba(116,64,255,0.12)] transition hover:-translate-y-0.5 hover:shadow-[0_0_30px_rgba(116,64,255,0.2)]"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-[10px] font-black uppercase tracking-wide text-primary">
                  Agent of the Week
                </div>
                <div className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-black leading-none text-primary-foreground">
                  #{agentOfWeek.rank || 1}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-background">
                  <img
                    src={agentOfWeekArt}
                    alt={botaCharacterAlt(agentOfWeekName)}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                  {agentOfWeekMeta?.iconUrl ? (
                    <span className="absolute bottom-0 right-0 grid h-4 w-4 place-items-center overflow-hidden rounded-full bg-background shadow">
                      <img
                        src={agentOfWeekMeta.iconUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    </span>
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-black text-sidebar-foreground">
                    {agentOfWeekName}
                  </div>
                  <div className="truncate text-[10px] font-bold text-muted-foreground">
                    {agentOfWeekMeta?.label || agentOfWeek.origin}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-[10px] font-black text-primary">
                    <span>{compactNumber(agentOfWeek.wins)}W</span>
                    <span className="text-muted-foreground">{compactNumber(agentOfWeek.losses)}L</span>
                  </div>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1">
                <div className="rounded bg-background/55 px-1.5 py-1">
                  <div className="text-[9px] font-bold uppercase text-muted-foreground">Score</div>
                  <div className="text-[11px] font-black text-sidebar-foreground">
                    {compactNumber(agentOfWeek.fameScore || 0)}
                  </div>
                </div>
                <div className="rounded bg-background/55 px-1.5 py-1">
                  <div className="text-[9px] font-bold uppercase text-muted-foreground">BantCredit</div>
                  <div className="text-[11px] font-black text-sidebar-foreground">
                    {compactBantCredit(agentOfWeekBantCredit)}
                  </div>
                </div>
              </div>
            </button>
          ) : isAgentOfWeekLoading ? (
            <div className="rounded-lg bg-card/80 p-2 text-[11px] font-bold text-muted-foreground">
              Loading top agent
            </div>
          ) : null}
        </div>
      </div>

      <div className="border-t border-border p-2 text-center">
        <div className="text-xs font-bold text-primary mb-2">Battle Of The Agent</div>
        <div className="flex items-center justify-center gap-1.5">
          <img src="/assets/bota-bantah-icon.png" alt="BOTA" width={18} height={18} className="rounded bg-[#0f101c] object-contain" />
          <span className="text-xs font-bold text-primary">BOTA</span>
        </div>
      </div>
    </div>
  )
}

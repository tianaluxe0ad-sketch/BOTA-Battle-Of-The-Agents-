'use client'

import { Bell, BookOpen, ChevronLeft, ChevronRight, CircleHelp, Eye, Menu, Search, Swords, Trophy, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { arenaAgentAvatar } from '@/lib/arenaAgentAvatars'
import { arenaLabelForBattleWithSources } from '@/lib/bantahbro/arenaVenues'
import { getBattleTimeRemainingSeconds } from '@/lib/bantahbro/battleTiming'
import { useTheme } from '@/lib/theme-provider'
import { useNetworkState } from '@/stores/useNetworkState'
import { useState, useRef, useEffect, type CSSProperties } from 'react'
import MobileDrawer from './mobile-drawer'
import type { AppSection, BantahTool } from '@/app/page'
import type { AgentBattle, AgentBattleFeed } from '@/types/agentBattle'
import type { BattleArenaStatus, BattleExperienceMode } from '@/components/bantahbro/FightingGameArenaEmbed'

interface TopBarProps {
  onNavigate?: (section: AppSection) => void
  onOpenBattle?: (battleId: string) => void
  activeSection?: AppSection
  activeTool?: BantahTool
  onToolSelect?: (tool: BantahTool) => void
}

type SearchItem = {
  emoji: string
  name: string
  type: string
  section: AppSection
  tool?: BantahTool
}

type BantCreditStatsResponse = {
  token: 'BantCredit'
  lifetimeEarned: number
  currentAggregate: number
  currentUserPoints: number
  currentAgentPoints: number
  earnedFromTransactions: number
  userCount: number
  agentCount: number
  rewardTransactionCount: number
  basis: string
  updatedAt: string
  totalUsdcEarned?: number
}

type AgentPvpChallengeSnapshot = {
  id: string
  name: string
  avatarUrl: string | null
  rank: number | null
  league: string
  record: string
  title: string
  tokenSymbol: string | null
}

type AgentPvpChallenge = {
  challengeCode: string
  status: 'pending' | 'accepted' | 'scheduled' | 'live' | 'resolved' | 'expired' | 'cancelled'
  matchType: 'arena' | 'degen_vs'
  stakeAmount: number
  stakeCurrency: string
  challengerAgent: AgentPvpChallengeSnapshot
  opponentAgent: AgentPvpChallengeSnapshot
  expiresAt: string
  scheduledAt: string | null
  challengeUrl: string
}

type AgentPvpChallengeFeed = {
  challenges: AgentPvpChallenge[]
  updatedAt: string
}

function formatCompact(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '...'
  return new Intl.NumberFormat('en', {
    notation: value >= 100_000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 100_000 ? 1 : 0,
  }).format(value)
}

function formatBattleDuration(totalSeconds?: number) {
  const safe = Math.max(0, Math.round(totalSeconds || 0))
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function secondsUntil(value?: string | null) {
  if (!value) return 0
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return 0
  return Math.max(0, Math.round((time - Date.now()) / 1000))
}

function formatStripTime(totalSeconds?: number) {
  const safe = Math.max(0, Math.round(totalSeconds || 0))
  if (safe >= 3600) {
    const hours = Math.floor(safe / 3600)
    const minutes = Math.floor((safe % 3600) / 60)
    return `${hours}h ${minutes}m`
  }
  return formatBattleDuration(safe)
}

type FighterStripAccent = 'blue' | 'purple' | 'green' | 'amber' | 'rose' | 'cyan'

type FighterStripCard = {
  id: string
  sourceBattleId?: string
  challengeCode?: string
  mode: BattleExperienceMode
  slotLabel: string
  status: BattleArenaStatus
  statusLabel: string
  startsInSeconds?: number
  leftName: string
  rightName: string
  leftTag: string
  rightTag: string
  leftAvatar: string
  rightAvatar: string
  meta: string
  arena: string
  accent: FighterStripAccent
}

function stripAgentAvatar(seed: string) {
  return arenaAgentAvatar(seed)
}

const LIVE_FIGHTER_STRIP_ACCENTS: FighterStripAccent[] = ['blue', 'purple', 'green', 'amber', 'cyan', 'rose']

function fighterStripTone(accent: FighterStripAccent) {
  switch (accent) {
    case 'purple':
      return 'border-violet-400/35 bg-violet-500/10 text-violet-200'
    case 'green':
      return 'border-emerald-400/35 bg-emerald-500/10 text-emerald-200'
    case 'amber':
      return 'border-amber-400/35 bg-amber-500/10 text-amber-200'
    case 'rose':
      return 'border-rose-400/35 bg-rose-500/10 text-rose-200'
    case 'cyan':
      return 'border-cyan-400/35 bg-cyan-500/10 text-cyan-200'
    default:
      return 'border-sky-400/35 bg-sky-500/10 text-sky-200'
  }
}

function avatarStripTone(accent: FighterStripAccent) {
  switch (accent) {
    case 'purple':
      return 'border-violet-300 bg-violet-500/20'
    case 'green':
      return 'border-emerald-300 bg-emerald-500/20'
    case 'amber':
      return 'border-amber-300 bg-amber-500/20'
    case 'rose':
      return 'border-rose-300 bg-rose-500/20'
    case 'cyan':
      return 'border-cyan-300 bg-cyan-500/20'
    default:
      return 'border-sky-300 bg-sky-500/20'
  }
}

function stripSideName(side: AgentBattle['sides'][number] | undefined, fallback: string) {
  return side?.agentName || side?.tokenName || side?.label || fallback
}

function stripSideTag(side: AgentBattle['sides'][number] | undefined, fallback: string) {
  return side?.label || side?.tokenSymbol || side?.chainLabel || fallback
}

function stripSideAvatar(side: AgentBattle['sides'][number] | undefined, fallbackSeed: string) {
  return stripAgentAvatar(side ? `${side.agentName}:${side.id}` : fallbackSeed)
}

function buildLiveFighterStripCard(battle: AgentBattle, index: number): FighterStripCard {
  const timeRemainingSeconds = getBattleTimeRemainingSeconds(battle.endsAt, battle.timeRemainingSeconds)
  const left = battle.sides?.[0]
  const right = battle.sides?.[1]

  return {
    id: battle.id,
    sourceBattleId: battle.id,
    mode: 'arena',
    slotLabel: `Live ${index + 1}`,
    status: 'live',
    statusLabel: 'Live',
    leftName: stripSideName(left, 'BOTA Agent Alpha'),
    rightName: stripSideName(right, 'BOTA Agent Beta'),
    leftTag: stripSideTag(left, 'Alpha'),
    rightTag: stripSideTag(right, 'Beta'),
    leftAvatar: stripSideAvatar(left, `${battle.id}:left`),
    rightAvatar: stripSideAvatar(right, `${battle.id}:right`),
    meta: formatBattleDuration(timeRemainingSeconds),
    arena: arenaLabelForBattleWithSources(battle, battle.id, index),
    accent: LIVE_FIGHTER_STRIP_ACCENTS[index % LIVE_FIGHTER_STRIP_ACCENTS.length],
  }
}

function stripChallengeAvatar(agent: AgentPvpChallengeSnapshot | undefined, fallbackSeed: string) {
  return agent?.avatarUrl || stripAgentAvatar(agent ? `${agent.name}:${agent.id}` : fallbackSeed)
}

function stripChallengeTag(agent: AgentPvpChallengeSnapshot | undefined) {
  if (!agent) return 'BOTA'
  if (agent.tokenSymbol) return agent.tokenSymbol
  if (agent.rank) return `Rank #${agent.rank}`
  return agent.league || 'BOTA'
}

function challengeStripStatusLabel(status: AgentPvpChallenge['status']) {
  if (status === 'pending') return 'Callout'
  if (status === 'live') return 'Live PvP'
  return 'Scheduled'
}

function buildPvpChallengeStripCard(challenge: AgentPvpChallenge, index: number): FighterStripCard {
  const scheduledSeconds = secondsUntil(challenge.scheduledAt)
  const expirySeconds = secondsUntil(challenge.expiresAt)
  const countdownSeconds = scheduledSeconds || expirySeconds
  const stake = `${challenge.stakeAmount.toLocaleString()} ${challenge.stakeCurrency}`
  const isLive = challenge.status === 'live'

  return {
    id: `pvp:${challenge.challengeCode}`,
    challengeCode: challenge.challengeCode,
    mode: challenge.matchType === 'degen_vs' ? 'challenge' : 'arena',
    slotLabel: 'PvP',
    status: isLive ? 'live' : 'queued',
    statusLabel: challengeStripStatusLabel(challenge.status),
    startsInSeconds: countdownSeconds,
    leftName: challenge.challengerAgent?.name || 'BOTA Agent Alpha',
    rightName: challenge.opponentAgent?.name || 'BOTA Agent Beta',
    leftTag: stripChallengeTag(challenge.challengerAgent),
    rightTag: stripChallengeTag(challenge.opponentAgent),
    leftAvatar: stripChallengeAvatar(challenge.challengerAgent, `${challenge.challengeCode}:left`),
    rightAvatar: stripChallengeAvatar(challenge.opponentAgent, `${challenge.challengeCode}:right`),
    meta: challenge.status === 'pending' ? `${stake} callout` : formatStripTime(countdownSeconds),
    arena: challenge.matchType === 'degen_vs' ? 'PvP Arena' : 'Challenge Arena',
    accent: LIVE_FIGHTER_STRIP_ACCENTS[(index + 2) % LIVE_FIGHTER_STRIP_ACCENTS.length],
  }
}

const ARENA_PREVIEW_EVENT = 'bantahbro:arena-preview-change'
const ARENA_PREVIEW_PARAMS = [
  'battleLayer',
  'arenaState',
  'arenaStartsAt',
  'arenaMatchup',
  'arenaLabel',
  'arenaPreviewId',
]

function updateArenaPreviewParams(card: FighterStripCard) {
  if (typeof window === 'undefined') return

  const params = new URLSearchParams(window.location.search)
  params.set('section', 'battles')
  params.delete('battle')
  params.set('battleLayer', card.mode)
  params.set('arenaState', card.status)
  params.set('arenaPreviewId', card.id)
  params.set('arenaMatchup', `${card.leftName} VS ${card.rightName}`)
  params.set('arenaLabel', card.arena)

  if (card.status === 'queued' && card.startsInSeconds) {
    params.set('arenaStartsAt', String(Date.now() + card.startsInSeconds * 1000))
  } else {
    params.delete('arenaStartsAt')
  }

  window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`)
  window.dispatchEvent(new Event(ARENA_PREVIEW_EVENT))
}

function clearArenaPreviewParams() {
  if (typeof window === 'undefined') return

  const params = new URLSearchParams(window.location.search)
  ARENA_PREVIEW_PARAMS.forEach((param) => params.delete(param))
  params.set('battleLayer', 'arena')
  const queryString = params.toString()
  window.history.replaceState({}, '', `${window.location.pathname}${queryString ? `?${queryString}` : ''}`)
  window.dispatchEvent(new Event(ARENA_PREVIEW_EVENT))
}

function openChallengeStripCard(challengeCode: string, onNavigate?: (section: AppSection) => void) {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search)
    params.set('section', 'challenge')
    params.set('challenge', challengeCode)
    params.delete('battle')
    ARENA_PREVIEW_PARAMS.forEach((param) => params.delete(param))
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`)
  }
  onNavigate?.('challenge')
}

const SEARCH_DATA: SearchItem[] = [
  { emoji: '₿', name: 'BTC', type: 'Token', section: 'challenge' },
  { emoji: '◆', name: 'ETH', type: 'Token', section: 'challenge' },
  { emoji: '◎', name: 'SOL', type: 'Token', section: 'challenge' },
  { emoji: '⚪', name: 'BASE', type: 'Ecosystem', section: 'challenge' },
  { emoji: 'S', name: 'TAO', type: 'Token', section: 'challenge' },
  { emoji: '🤖', name: 'Agents', type: 'Page', section: 'agents' },
  { emoji: '↓', name: 'Create Fighter', type: 'Page', section: 'import' },
  { emoji: '🛒', name: 'Marketplace', type: 'Page', section: 'marketplace' },
  { emoji: '👥', name: 'Communities', type: 'Page', section: 'communities' },
  { emoji: 'ENS', name: 'ENS Community', type: 'Community', section: 'communities' },
  { emoji: 'VP', name: 'Virtuals Community', type: 'Community', section: 'communities' },
  { emoji: 'EL', name: 'ElizaOS Community', type: 'Community', section: 'communities' },
  { emoji: '🤖', name: 'BullBot', type: 'Agent', section: 'battles' },
  { emoji: '🎭', name: 'ChaosBot', type: 'Agent', section: 'battles' },
  { emoji: 'B', name: 'BOTA', type: 'Agent', section: 'battles' },
  { emoji: '🎁', name: 'Rewards', type: 'Page', section: 'rewards' },
  { emoji: '📘', name: 'Docs', type: 'Page', section: 'docs' },
  { emoji: '📘', name: 'How It Works', type: 'Docs', section: 'docs' },
  { emoji: '⬇️', name: 'How to Import Agent', type: 'Docs', section: 'docs' },
  { emoji: '⚔️', name: 'Challenge', type: 'Page', section: 'challenge' },
  { emoji: '🏆', name: 'Leaderboard', type: 'Page', section: 'leaderboard' },
  { emoji: '🛡️', name: 'Rug Scorer', type: 'Page', section: 'rug-scorer' },
  { emoji: '↓', name: 'Create Fighter', type: 'Page', section: 'import' },
  { emoji: '📡', name: 'Signals', type: 'Page', section: 'challenge' },
  { emoji: '🧠', name: 'Analyze Token', type: 'Tool', section: 'chat', tool: 'analyze' },
  { emoji: '👛', name: 'Wallet Ops', type: 'Tool', section: 'chat', tool: 'wallet' },
  { emoji: '🧭', name: 'Discover', type: 'Tool', section: 'chat', tool: 'discover' },
  { emoji: '⚔️', name: 'Battle Desk', type: 'Tool', section: 'chat', tool: 'battle' },
  { emoji: '🛡️', name: 'Rug Score', type: 'Tool', section: 'chat', tool: 'rug' },
  { emoji: '📈', name: 'Runner Score', type: 'Tool', section: 'chat', tool: 'runner' },
  { emoji: '🔔', name: 'Live Alerts', type: 'Tool', section: 'chat', tool: 'alerts' },
  { emoji: '📊', name: 'Live Markets', type: 'Tool', section: 'chat', tool: 'markets' },
  { emoji: 'AD', name: 'Advertise', type: 'Page', section: 'ads' },
  { emoji: 'AD', name: 'Ads Placement', type: 'Page', section: 'ads' },
]

const PARTICIPATION_SLIDES = [
  {
    eyebrow: 'Step 1',
    title: 'Open a battle',
    body: 'Pick a live arena fight and check both fighter agents.',
    stat: 'Live arena',
    Icon: Swords,
    tone: 'bg-green-500 text-white shadow-[0_0_18px_rgba(34,197,94,.32)]',
  },
  {
    eyebrow: 'Step 2',
    title: 'Choose your action',
    body: 'Use YES or NO in challenge fights, or watch simulated rounds.',
    stat: 'YES / NO',
    Icon: Eye,
    tone: 'bg-primary text-primary-foreground shadow-[0_0_18px_rgba(124,58,237,.34)]',
  },
  {
    eyebrow: 'Step 3',
    title: 'Track BantCredit',
    body: 'Track rewards, ranks, profile stats, and claimable BANTC.',
    stat: 'BantCredit',
    Icon: Trophy,
    tone: 'bg-red-500 text-white shadow-[0_0_18px_rgba(239,68,68,.3)]',
  },
]

export default function TopBar({ onNavigate, onOpenBattle, activeSection, activeTool, onToolSelect }: TopBarProps) {
  const { theme, toggleTheme } = useTheme()
  const { activeNetwork, setNetwork } = useNetworkState()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [participationOpen, setParticipationOpen] = useState(false)
  const [participationSlide, setParticipationSlide] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const { data: bantCreditStats, isLoading: bantCreditStatsLoading } = useQuery<BantCreditStatsResponse>({
    queryKey: ['/api/bantahbro/stats/bantcredit'],
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
  const { data: battleStripFeed, isLoading: battleStripLoading } = useQuery<AgentBattleFeed>({
    queryKey: ['/api/bantahbro/agent-battles/live', { limit: '16' }],
    staleTime: 20_000,
    refetchInterval: 30_000,
    retry: 1,
    retryDelay: 1_500,
    placeholderData: (previousData) => previousData,
  })
  const { data: challengeStripFeed } = useQuery<AgentPvpChallengeFeed>({
    queryKey: ['/api/bantahbro/agent-challenges', { limit: '20', status: 'all' }],
    staleTime: 5_000,
    refetchInterval: 20_000,
    retry: 2,
    retryDelay: 1_500,
    placeholderData: (previousData) => previousData,
  })

  const searchResults = searchQuery.trim()
    ? SEARCH_DATA.filter(
        (item) =>
          item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.type.toLowerCase().includes(searchQuery.toLowerCase())
      ).slice(0, 6)
    : []
  const battleStripBattles = (battleStripFeed?.battles || []).filter(
    (battle) =>
      battle.status === 'live' &&
      getBattleTimeRemainingSeconds(battle.endsAt, battle.timeRemainingSeconds) > 0,
  )
  const pvpStripCards = (challengeStripFeed?.challenges || [])
    .filter((challenge) =>
      ['pending', 'accepted', 'scheduled', 'live'].includes(challenge.status) &&
      (challenge.status === 'live' || secondsUntil(challenge.scheduledAt || challenge.expiresAt) > 0),
    )
    .map((challenge, index) => buildPvpChallengeStripCard(challenge, index))
  const liveStripCards = battleStripBattles.map((battle, index) => buildLiveFighterStripCard(battle, index))
  const fighterStripCards = [...pvpStripCards, ...liveStripCards].slice(0, 48)
  const fighterStripSlides = fighterStripCards.length > 1 ? [...fighterStripCards, ...fighterStripCards] : fighterStripCards
  const fighterStripDurationSeconds = Math.min(1400, Math.max(520, fighterStripCards.length * 16))
  const isBattlesPage = activeSection === 'battles'

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchFocused(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSearchSelect = (item: SearchItem) => {
    if (item.tool) {
      onToolSelect?.(item.tool)
    }
    onNavigate?.(item.section)
    setSearchQuery('')
    setSearchFocused(false)
  }

  const currentParticipationSlide = PARTICIPATION_SLIDES[participationSlide]
  const CurrentParticipationIcon = currentParticipationSlide.Icon

  const moveParticipationSlide = (direction: 1 | -1) => {
    setParticipationSlide((current) =>
      (current + direction + PARTICIPATION_SLIDES.length) % PARTICIPATION_SLIDES.length,
    )
  }

  const openDocs = () => {
    setParticipationOpen(false)
    setParticipationSlide(0)
    onNavigate?.('docs')
  }

  return (
    <>
      <MobileDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        activeSection={activeSection}
        onNavigate={onNavigate}
      />
      <Dialog
        open={participationOpen}
        onOpenChange={(open) => {
          setParticipationOpen(open)
          if (!open) setParticipationSlide(0)
        }}
      >
        <DialogContent className="w-[calc(100vw-1rem)] max-w-[360px] gap-0 overflow-hidden rounded-2xl bg-[#f7f4ff] p-0 text-slate-950 shadow-[0_26px_80px_rgba(0,0,0,.42)] dark:bg-[#0b0f17] dark:text-white">
          <DialogHeader className="sr-only">
            <DialogTitle>How to Participate</DialogTitle>
            <DialogDescription>Three quick moves to enter the BOTA arena.</DialogDescription>
          </DialogHeader>

          <div className="relative h-[128px] overflow-hidden bg-[#10131f]">
            <img
              src="/assets/bota-bantah-logo.jpg"
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full object-cover object-center opacity-100"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/62 via-black/18 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-[#f7f4ff] to-transparent dark:from-[#0b0f17]" />
            <div className="relative z-10 flex h-full flex-col justify-between px-4 py-3 pr-10">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-black/62 px-2.5 text-[10px] font-black uppercase text-white shadow backdrop-blur-md">
                  <span className="h-2 w-2 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,.85)]" />
                  Arena Guide
                </span>
                <img src="/assets/bota-bantah-icon.png" alt="" className="size-8 rounded-lg bg-black/60 object-contain p-1 shadow-lg" />
              </div>
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-green-300">BOTA Battle</div>
                <div className="mt-0.5 text-xl font-black uppercase leading-none text-white drop-shadow">
                  How to Participate
                </div>
              </div>
            </div>
          </div>

          <div className="px-3 pb-3 pt-3">
            <div className="grid grid-cols-3 gap-1.5">
              {PARTICIPATION_SLIDES.map((slide, index) => (
                <button
                  key={slide.title}
                  type="button"
                  onClick={() => setParticipationSlide(index)}
                  className={`h-8 rounded-lg text-[10px] font-black uppercase transition active:scale-[0.98] ${
                    participationSlide === index
                      ? slide.tone
                      : 'bg-white text-slate-500 shadow-sm hover:bg-white/85 dark:bg-white/[0.08] dark:text-white/62 dark:hover:bg-white/[0.12]'
                  }`}
                  aria-label={`Go to ${slide.eyebrow}`}
                >
                  {slide.eyebrow.replace('Step ', '')}
                </button>
              ))}
            </div>

            <div className="mt-2.5 overflow-hidden rounded-xl bg-white p-3 shadow-[0_12px_30px_rgba(18,24,40,.12)] dark:bg-white/[0.08] dark:shadow-none">
              <div className="flex items-start gap-3">
                <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${currentParticipationSlide.tone}`}>
                  <CurrentParticipationIcon size={20} strokeWidth={2.6} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-md bg-black/80 px-2 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-white dark:bg-black/60">
                      {currentParticipationSlide.eyebrow}
                    </span>
                    <span className="rounded-md bg-[#f1edff] px-2 py-1 text-[9px] font-black uppercase text-slate-500 dark:bg-black/30 dark:text-white/58">
                      {participationSlide + 1}/{PARTICIPATION_SLIDES.length}
                    </span>
                  </div>
                  <div className="mt-2 text-base font-black leading-tight text-slate-950 dark:text-white">
                    {currentParticipationSlide.title}
                  </div>
                  <p className="mt-1 text-xs font-semibold leading-5 text-slate-600 dark:text-white/62">
                    {currentParticipationSlide.body}
                  </p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <div className="h-2 overflow-hidden rounded-full bg-green-500/18">
                  <div className="h-full w-2/3 rounded-full bg-gradient-to-r from-green-600 to-lime-300 shadow-[0_0_14px_rgba(132,255,78,.55)]" />
                </div>
                <span className="rounded-lg bg-black px-2.5 py-1 text-[10px] font-black uppercase text-white shadow dark:bg-black/70">
                  {currentParticipationSlide.stat}
                </span>
                <div className="h-2 overflow-hidden rounded-full bg-red-500/18">
                  <div className="ml-auto h-full w-1/2 rounded-full bg-gradient-to-r from-red-500 to-red-400 shadow-[0_0_14px_rgba(239,68,68,.5)]" />
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-[#f7f4ff] px-3 pb-3 dark:bg-[#0b0f17]">
            <button
              type="button"
              onClick={() => moveParticipationSlide(-1)}
              className="grid size-9 shrink-0 place-items-center rounded-xl bg-white text-slate-950 shadow-sm transition hover:bg-white/85 active:scale-95 dark:bg-white/[0.08] dark:text-white"
              aria-label="Previous step"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={openDocs}
              className="inline-flex h-9 flex-1 items-center justify-center rounded-xl bg-primary px-3 text-xs font-black text-primary-foreground shadow-[0_0_22px_rgba(124,58,237,.3)] transition hover:opacity-90 active:scale-[0.98]"
            >
              See more
            </button>
            <button
              type="button"
              onClick={() => moveParticipationSlide(1)}
              className="grid size-9 shrink-0 place-items-center rounded-xl bg-white text-slate-950 shadow-sm transition hover:bg-white/85 active:scale-95 dark:bg-white/[0.08] dark:text-white"
              aria-label="Next step"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <div className="border-b border-border bg-card">
        {!isBattlesPage && (
        <div className="flex items-center justify-between px-2 py-1.5 gap-2">
          <button onClick={() => setDrawerOpen(true)} className="md:hidden p-1.5 hover:bg-sidebar-accent rounded transition">
            <Menu size={20} />
          </button>

          <div ref={searchRef} className="relative min-w-0 flex-none basis-12 max-w-[4rem] sm:flex-1 sm:basis-auto sm:max-w-xs md:max-w-sm lg:max-w-md xl:max-w-lg transition-all duration-200 focus-within:max-w-[10rem] focus-within:basis-[30vw]">
            <div className="flex items-center bg-input rounded px-2 sm:px-3 py-1.5">
              <Search size={16} className="text-muted-foreground shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                placeholder="Search battles"
                className="w-full bg-transparent text-sm outline-none pl-1 sm:pl-2 placeholder:text-transparent sm:placeholder:text-muted-foreground"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="text-muted-foreground hover:text-foreground transition ml-1 shrink-0">
                  <X size={14} />
                </button>
              )}
              <span className="text-xs text-muted-foreground hidden sm:block ml-1 shrink-0">/</span>
            </div>

            {searchFocused && searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded shadow-xl z-50 overflow-hidden">
                {searchResults.map((item) => (
                  <button
                    key={`${item.type}-${item.name}`}
                    onClick={() => handleSearchSelect(item)}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition text-left"
                  >
                    <span className="text-base w-6 text-center">{item.emoji}</span>
                    <span className="text-sm font-bold text-foreground flex-1">{item.name}</span>
                    <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{item.type}</span>
                  </button>
                ))}
              </div>
            )}

            {searchFocused && searchQuery && searchResults.length === 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded shadow-xl z-50 p-3 text-sm text-muted-foreground text-center">
                No results for &ldquo;{searchQuery}&rdquo;
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setParticipationOpen(true)}
            className="hidden md:inline-flex h-8 w-8 shrink-0 items-center justify-center rounded bg-primary text-xs font-black text-primary-foreground transition hover:opacity-90"
            title="How to Participate"
            aria-label="How to Participate"
          >
            <BookOpen size={14} />
          </button>

          <div className="flex items-center gap-1.5 md:gap-2">
            <button
              type="button"
              onClick={() => onNavigate?.('rewards')}
              title={bantCreditStats?.basis || 'Total BantCredit across Bantah ecosystem'}
              className="flex text-sm pr-2 sm:pr-3 pl-1 sm:pl-1.5 py-1 rounded-full items-center gap-1 sm:gap-2 border border-amber-500/30 bg-gradient-to-r from-amber-500/10 to-transparent hover:from-amber-500/20 transition shadow-[0_0_12px_rgba(245,158,11,0.15)]"
            >
              <div className="flex shrink-0 items-center justify-center animate-pulse drop-shadow-md">
                <span className="text-sm sm:text-base">💎</span>
              </div>
              <div className="flex flex-col items-start justify-center gap-0.5">
                <span className="hidden sm:block text-[9px] font-bold uppercase tracking-wider leading-none text-amber-500/80">BC Earned</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-black leading-none text-amber-500">
                    {bantCreditStatsLoading ? '...' : formatCompact(bantCreditStats?.lifetimeEarned)}
                  </span>
                  <span className="text-[10px] text-amber-500/40">|</span>
                  <span className="text-xs font-black leading-none text-green-500">
                    ${formatCompact(bantCreditStats?.totalUsdcEarned || 0)}
                  </span>
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setParticipationOpen(true)}
              className="md:hidden p-1.5 hover:bg-sidebar-accent rounded transition"
              aria-label="How to participate"
              title="How to Participate"
            >
              <CircleHelp size={18} />
            </button>
            <button onClick={() => onNavigate?.('notifications')} className="p-1.5 hover:bg-sidebar-accent rounded transition relative">
              <Bell size={18} />
              <span className="absolute top-0.5 right-0.5 w-2.5 h-2.5 bg-destructive rounded-full"></span>
            </button>
            <button
              onClick={toggleTheme}
              className="hidden md:flex p-1.5 hover:bg-sidebar-accent rounded transition"
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              <span className="text-xl">{theme === 'dark' ? '☀️' : '🌙'}</span>
            </button>
            <button
              onClick={() => setNetwork(activeNetwork === 'evm' ? 'solana' : 'evm')}
              className="hidden sm:flex items-center gap-1.5 px-2 py-1.5 hover:bg-sidebar-accent rounded transition border border-border bg-background/50 shadow-sm"
              title={`Switch Network (Current: ${activeNetwork.toUpperCase()})`}
            >
              <span className="text-sm">{activeNetwork === 'evm' ? '🔵 Base' : '🟣 Solana'}</span>
            </button>
            <button
              onClick={() => onNavigate?.('profile')}
              className="bb-tap flex md:hidden h-8 w-8 items-center justify-center rounded-full bg-input ring-1 ring-border transition hover:bg-sidebar-accent"
              title="Open profile"
              aria-label="Open profile"
            >
              <img src="/assets/bota-bantah-icon.png" alt="Profile" width={22} height={22} className="rounded bg-[#0f101c] object-contain" />
            </button>
            <button
              onClick={() => onNavigate?.('profile')}
              className="hidden sm:flex items-center gap-1.5 text-sm px-2 py-1.5 hover:bg-sidebar-accent rounded transition"
            >
              <img src="/assets/bota-bantah-icon.png" alt="BOTA" width={20} height={20} className="rounded bg-[#0f101c] object-contain" />
              <span>BOTA</span>
              <span className="text-muted-foreground">▼</span>
            </button>
          </div>
        </div>
        )}

        <style>{`
          @keyframes bb-battle-strip-slide {
            0% { transform: translateX(0); }
            100% { transform: translateX(-50%); }
          }

          .bb-battle-strip-track {
            animation: bb-battle-strip-slide var(--bb-battle-strip-duration, 520s) linear infinite;
          }

          .bb-battle-strip-track:hover {
            animation-play-state: paused;
          }

          @media (prefers-reduced-motion: reduce) {
            .bb-battle-strip-track {
              animation: none;
            }
          }
        `}</style>
        {isBattlesPage && (
          <div className="hidden sm:block overflow-hidden border-border bg-background/50 px-2 py-1.5 border-t">
            {fighterStripSlides.length > 0 && (
              <div
                className="bb-battle-strip-track flex w-max items-center gap-2"
                style={{ '--bb-battle-strip-duration': `${fighterStripDurationSeconds}s` } as CSSProperties}
              >
                {fighterStripSlides.map((battle, displayIndex) => {
                  const tone = fighterStripTone(battle.accent)
                  const avatarTone = avatarStripTone(battle.accent)
                  return (
                    <button
                      key={`${battle.id}-${displayIndex}`}
                      onClick={() => {
                        if (battle.challengeCode) {
                          openChallengeStripCard(battle.challengeCode, onNavigate)
                        } else if (battle.sourceBattleId) {
                          if (onOpenBattle) {
                            onOpenBattle(battle.sourceBattleId)
                          } else {
                            const params = new URLSearchParams(window.location.search)
                            params.set('section', 'battles')
                            params.set('battle', battle.sourceBattleId)
                            params.set('battleLayer', 'arena')
                            ARENA_PREVIEW_PARAMS
                              .filter((param) => param !== 'battleLayer')
                              .forEach((param) => params.delete(param))
                            window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`)
                            window.dispatchEvent(new Event(ARENA_PREVIEW_EVENT))
                            onNavigate?.('battles')
                          }
                        } else {
                          updateArenaPreviewParams(battle)
                          onNavigate?.('battles')
                        }
                      }}
                      title={`${battle.leftName} vs ${battle.rightName} - ${battle.arena}`}
                      className={`relative inline-flex min-h-11 min-w-max shrink-0 items-center gap-2 whitespace-nowrap rounded border px-2.5 py-1.5 pr-10 text-left text-sm transition hover:bg-sidebar-accent ${tone}`}
                    >
                      <span className="absolute right-1 top-1 rounded bg-destructive px-1.5 py-0.5 text-[9px] font-black uppercase leading-none text-white shadow-sm">
                        {battle.statusLabel}
                      </span>
                      <span
                        className="shrink-0 rounded border border-sky-300/35 bg-sky-400/15 px-1.5 py-0.5 text-xs leading-none text-sky-100"
                        title="Arena"
                        aria-label="Arena"
                      >
                        🏟️
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1.5">
                        <span className={`h-9 w-9 shrink-0 overflow-hidden rounded-md border-2 bg-background/60 p-1 ${avatarTone}`}>
                          <img
                            src={battle.leftAvatar}
                            alt=""
                            className="h-full w-full rounded object-cover object-center"
                            loading="lazy"
                          />
                        </span>
                        <span className="grid leading-tight">
                          <span className="text-xs font-black text-foreground">{battle.leftName}</span>
                          <span className="text-[9px] font-bold uppercase text-muted-foreground">{battle.leftTag}</span>
                        </span>
                      </span>
                      <span className="shrink-0 rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-black text-muted-foreground">VS</span>
                      <span className="inline-flex shrink-0 items-center gap-1.5">
                        <span className={`h-9 w-9 shrink-0 overflow-hidden rounded-md border-2 bg-background/60 p-1 ${avatarTone}`}>
                          <img
                            src={battle.rightAvatar}
                            alt=""
                            className="h-full w-full rounded object-cover object-center"
                            loading="lazy"
                          />
                        </span>
                        <span className="grid leading-tight">
                          <span className="text-xs font-black text-foreground">{battle.rightName}</span>
                          <span className="text-[9px] font-bold uppercase text-muted-foreground">{battle.rightTag}</span>
                        </span>
                      </span>
                      <span className="shrink-0 rounded bg-background/70 px-1.5 py-0.5 font-mono text-xs text-foreground">
                        {battle.meta}
                      </span>
                      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                        {battle.arena}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}

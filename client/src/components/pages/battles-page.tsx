'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, Eye, Send, Settings, Share2, Smile, Star, Users, Volume2, VolumeX } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useWallets } from '@privy-io/react-auth';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { usePublicUserBasic, getUserDisplayName } from '@/hooks/usePublicUserBasic';
import { arenaLabelForBattleWithSources } from '@/lib/bantahbro/arenaVenues';
import { getBattleTimeRemainingSeconds, useBattleClock } from '@/lib/bantahbro/battleTiming';
import { arenaAgentAvatar } from '@/lib/arenaAgentAvatars';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useBattleSpectatorRewards } from '@/hooks/useBattleSpectatorRewards';
import { shareBotaArenaBattle } from '@/utils/sharing';
import type { BattleSpectatorRewardHudState } from '@/hooks/useBattleSpectatorRewards';
import {
  executeOnchainEscrowStakeTx,
  type OnchainRuntimeConfig,
  type OnchainTokenSymbol,
} from '@/lib/onchainEscrow';
import type { AppSection } from '@/app/page';
import type { AgentBattle, AgentBattleFeed, AgentBattleSide } from '@/types/agentBattle';
import type {
  AgentBattleP2PHistoryPosition,
  AgentBattleP2PHistoryResponse,
  AgentBattleP2PPool,
  AgentBattleP2PStakeResponse,
} from '@shared/agentBattleP2P';
import type {
  BotaAgentChallengePredictionPool,
  BotaAgentChallengePredictionPosition,
  BotaAgentChallengePredictionStakeResponse,
} from '@shared/botaAgentChallengePrediction';
import {
  FightingGameArenaEmbed,
  type BattleArenaStatus,
  type BattleExperienceMode,
} from '@/components/bantahbro/FightingGameArenaEmbed';

interface BattlesPageProps {
  onNavigate?: (section: AppSection) => void;
  externalBattle?: AgentBattleFeed['battles'][number] | null;
  externalExecutionUrl?: string | null;
  externalSourceLabel?: string;
  onExternalBack?: () => void;
}

type TrollboxMessage = {
  id: string;
  source: 'web' | 'telegram' | 'system';
  user: string;
  handle: string | null;
  message: string;
  createdAt: string;
};

type TrollboxFeed = {
  roomId: string;
  battleId: string | null;
  generatedAt: string;
  messages: TrollboxMessage[];
  counts: {
    web: number;
    telegram: number;
    system: number;
  };
};

type SidebarFeedSource = 'bantah' | 'twitter' | 'telegram';

type SidebarFeedItem = {
  id: string;
  user: string;
  handle?: string | null;
  timestamp: string;
  content: string;
  source: SidebarFeedSource;
  market?: string | null;
};

type SidebarFeedResponse = {
  items?: SidebarFeedItem[];
};

type DesktopTrollboxItem = {
  id: string;
  createdAt: string;
  sourceLabel: string;
  sourceClassName: string;
  avatarUrl?: string | null;
  statusIcon?: '🟢' | '🔴' | null;
  statusLabel?: string | null;
  user: string;
  message: string;
  meta?: string | null;
};

type BattleOutcomeTone = 'live' | 'result' | 'win' | 'loss' | 'reward' | 'settling';

type MobileBattlePanel = 'trade' | 'stats' | 'side' | 'feed';
type MobileDetailTab = 'overview' | 'trades' | 'holders';
type MobileSocialTab = 'side' | 'trollbox' | 'events' | 'stats' | 'slips' | 'top';
type DesktopSideTab = 'trollbox' | 'details';
type DesktopBattleTab = 'stats' | 'feed' | 'side';
const BATTLE_MODE_STORAGE_KEY = 'bantahbro:battle-mode:v2';
const GAME_SOUND_STORAGE_KEY = 'bota.game.soundEnabled';
const DESKTOP_BATTLE_MEDIA_QUERY = '(min-width: 1024px)';
const DEFAULT_ARENA_LABEL = 'BOTA Arena';
const INITIAL_ARENA_BATTLE_LIMIT = 8;
const FULL_ARENA_BATTLE_LIMIT = 50;

function readIsDesktopBattleLayout() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(DESKTOP_BATTLE_MEDIA_QUERY).matches;
}

function readInitialGameSoundEnabled() {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(GAME_SOUND_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function formatUsd(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 'n/a';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

function formatClock(value?: string) {
  if (!value) return '--:--';
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function getWalletAddress(wallets: unknown[]) {
  const firstWallet = wallets.find((wallet) => typeof (wallet as { address?: unknown })?.address === 'string') as
    | { address?: string }
    | undefined;
  return firstWallet?.address || '';
}

function shortAddress(address: string) {
  if (!address) return 'No wallet';
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatDuration(totalSeconds: number) {
  const safe = Math.max(0, Math.round(totalSeconds || 0));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatNumber(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0';
  return Math.round(value).toLocaleString();
}

function formatCompactNumber(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('en', {
    notation: value >= 100_000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 100_000 ? 1 : 0,
  }).format(value);
}

function formatTokenAmount(value?: number | null, symbol?: string | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return symbol ? `0 ${symbol}` : '0';
  const formatted = value.toLocaleString(undefined, {
    minimumFractionDigits: value > 0 && value < 1 ? 2 : 0,
    maximumFractionDigits: value > 0 && value < 1 ? 6 : 2,
  });
  return symbol ? `${formatted} ${symbol}` : formatted;
}

function formatRelativeTime(value?: string | null) {
  if (!value) return 'Unknown time';
  const target = new Date(value).getTime();
  if (!Number.isFinite(target)) return 'Unknown time';
  const diffSeconds = Math.round((Date.now() - target) / 1000);
  const absoluteSeconds = Math.abs(diffSeconds);
  if (absoluteSeconds < 60) return diffSeconds >= 0 ? 'just now' : 'in a moment';
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, unitSeconds] of units) {
    if (absoluteSeconds >= unitSeconds) {
      return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
        -Math.round(diffSeconds / unitSeconds),
        unit,
      );
    }
  }
  return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(-diffSeconds, 'second');
}

function battleSlipStatusLabel(status: AgentBattleP2PHistoryPosition['resultStatus']) {
  switch (status) {
    case 'won':
      return 'Won';
    case 'lost':
      return 'Lost';
    case 'awaiting_settlement':
      return 'Settling';
    case 'unmatched':
      return 'Unmatched';
    case 'needs_escrow':
      return 'Not Locked';
    case 'failed':
      return 'Issue';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Live';
  }
}

function battleSlipStatusClassName(status: AgentBattleP2PHistoryPosition['resultStatus']) {
  switch (status) {
    case 'won':
      return 'border-green-500/30 bg-green-500/15 text-green-400';
    case 'lost':
      return 'border-red-500/30 bg-red-500/15 text-red-400';
    case 'awaiting_settlement':
      return 'border-amber-500/30 bg-amber-500/15 text-amber-300';
    case 'unmatched':
      return 'border-orange-500/30 bg-orange-500/15 text-orange-300';
    case 'needs_escrow':
      return 'border-slate-500/30 bg-slate-500/15 text-slate-300';
    case 'failed':
      return 'border-rose-500/30 bg-rose-500/15 text-rose-300';
    case 'cancelled':
      return 'border-slate-500/30 bg-slate-500/15 text-slate-300';
    default:
      return 'border-primary/30 bg-primary/10 text-primary';
  }
}

function buildExplorerTxUrl(
  position: AgentBattleP2PHistoryPosition,
  onchainConfig?: OnchainRuntimeConfig | null,
) {
  const txHash = position.payoutTxHash || position.escrowTxHash;
  const explorerBase = onchainConfig?.chains?.[String(position.escrowChainId || 0)]?.blockExplorerUrl;
  if (!txHash || !explorerBase) return null;
  return `${explorerBase.replace(/\/$/, '')}/tx/${txHash}`;
}

function formatPriceAxis(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 'n/a';
  if (value >= 1) return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
}

function readBattleIdFromUrl() {
  if (typeof window === 'undefined') return null;
  const battleId = new URLSearchParams(window.location.search).get('battle');
  return battleId?.trim() || null;
}

const OPEN_BATTLE_SNAPSHOT_STORAGE_KEY = 'bantahbro:arena-open-battle-snapshot';
const LIVE_BATTLE_FEED_SNAPSHOT_STORAGE_KEY = 'bantahbro:arena-live-feed-snapshot';
const OPEN_BATTLE_SNAPSHOT_TTL_MS = 5 * 60 * 1000;

function readOpenBattleSnapshot(requestedBattleId: string | null): AgentBattle | null {
  if (!requestedBattleId || typeof window === 'undefined') return null;

  try {
    const rawSnapshot = window.sessionStorage.getItem(OPEN_BATTLE_SNAPSHOT_STORAGE_KEY);
    if (!rawSnapshot) return null;

    const snapshot = JSON.parse(rawSnapshot) as {
      battleId?: string;
      battle?: AgentBattle;
      createdAt?: number;
    };
    const battle = snapshot.battle;

    if (!battle || battle.id !== requestedBattleId || snapshot.battleId !== requestedBattleId) {
      return null;
    }

    if (!Array.isArray(battle.sides) || battle.sides.length < 2) {
      return null;
    }

    if (typeof snapshot.createdAt === 'number' && Date.now() - snapshot.createdAt > OPEN_BATTLE_SNAPSHOT_TTL_MS) {
      window.sessionStorage.removeItem(OPEN_BATTLE_SNAPSHOT_STORAGE_KEY);
      return null;
    }

    return battle;
  } catch {
    return null;
  }
}

function readLiveBattleFeedSnapshot(): AgentBattleFeed | null {
  if (typeof window === 'undefined') return null;

  try {
    const rawSnapshot = window.sessionStorage.getItem(LIVE_BATTLE_FEED_SNAPSHOT_STORAGE_KEY);
    if (!rawSnapshot) return null;

    const snapshot = JSON.parse(rawSnapshot) as {
      feed?: AgentBattleFeed;
      createdAt?: number;
    };
    const feed = snapshot.feed;

    if (!feed || !Array.isArray(feed.battles) || !feed.battles.length) {
      return null;
    }

    if (typeof snapshot.createdAt === 'number' && Date.now() - snapshot.createdAt > OPEN_BATTLE_SNAPSHOT_TTL_MS) {
      window.sessionStorage.removeItem(LIVE_BATTLE_FEED_SNAPSHOT_STORAGE_KEY);
      return null;
    }

    const liveBattles = feed.battles.filter((candidate) => isBattleLiveForArena(candidate));
    if (!liveBattles.length) return null;

    return {
      ...feed,
      battles: liveBattles,
    };
  } catch {
    return null;
  }
}

function writeLiveBattleFeedSnapshot(feed?: AgentBattleFeed | null) {
  if (typeof window === 'undefined' || !feed?.battles?.length) return;

  try {
    const liveBattles = feed.battles.filter((candidate) => isBattleLiveForArena(candidate));
    if (!liveBattles.length) return;

    window.sessionStorage.setItem(
      LIVE_BATTLE_FEED_SNAPSHOT_STORAGE_KEY,
      JSON.stringify({
        feed: {
          ...feed,
          battles: liveBattles.slice(0, INITIAL_ARENA_BATTLE_LIMIT),
        },
        createdAt: Date.now(),
      }),
    );
  } catch {
    // Session storage can be unavailable in private browsing; the live query remains authoritative.
  }
}

const ARENA_PREVIEW_EVENT = 'bantahbro:arena-preview-change';

type ArenaPreviewState = {
  mode: BattleExperienceMode;
  status: BattleArenaStatus;
  startsAtMs: number | null;
  matchupLabel: string;
  arenaLabel: string;
};

function normalizeBattleLayer(value: string | null): BattleExperienceMode {
  if (value === 'challenge') return 'challenge';
  return 'arena';
}

function normalizeArenaStatus(value: string | null): BattleArenaStatus {
  if (value === 'queued' || value === 'cancelled' || value === 'rematch') return value;
  return 'live';
}

function readArenaPreviewFromUrl(): ArenaPreviewState {
  if (typeof window === 'undefined') {
    return {
      mode: 'arena',
      status: 'live',
      startsAtMs: null,
      matchupLabel: 'BOTA Agent Alpha VS BOTA Agent Beta',
      arenaLabel: DEFAULT_ARENA_LABEL,
    };
  }

  const params = new URLSearchParams(window.location.search);
  const startsAtMs = Number(params.get('arenaStartsAt'));

  return {
    mode: normalizeBattleLayer(params.get('battleLayer')),
    status: normalizeArenaStatus(params.get('arenaState')),
    startsAtMs: Number.isFinite(startsAtMs) && startsAtMs > 0 ? startsAtMs : null,
    matchupLabel: params.get('arenaMatchup') || 'BOTA Agent Alpha VS BOTA Agent Beta',
    arenaLabel: params.get('arenaLabel') || DEFAULT_ARENA_LABEL,
  };
}

function isBattleLiveForArena(battle?: AgentBattle | null, nowMs = Date.now()) {
  if (!battle) return false;
  return getBattleTimeRemainingSeconds(
    battle.endsAt,
    battle.timeRemainingSeconds,
    nowMs,
  ) > 1;
}

function firstLiveBattleForArena(
  battles: AgentBattle[] | undefined,
  excludeBattleId?: string | null,
  nowMs = Date.now(),
) {
  return (battles || []).find(
    (candidate) => candidate.id !== excludeBattleId && isBattleLiveForArena(candidate, nowMs),
  ) || null;
}

function resolveBattleArenaLabel(arenaPreview: ArenaPreviewState, battle?: AgentBattle | null) {
  const previewLabel = arenaPreview.arenaLabel?.trim();
  if (previewLabel && previewLabel !== DEFAULT_ARENA_LABEL && previewLabel !== 'Main Arena') {
    return previewLabel;
  }
  return arenaLabelForBattleWithSources(battle, battle?.id || arenaPreview.matchupLabel);
}

function formatSignedPercent(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0.00%';
  const absolute = Math.abs(value);
  const precision = absolute >= 100 ? 0 : absolute >= 10 ? 1 : 2;
  return `${value > 0 ? '+' : ''}${value.toFixed(precision)}%`;
}

function formatLiveTokenPrice(side: AgentBattleSide) {
  return side.priceDisplay || formatUsd(side.priceUsd);
}

function dexScreenerEmbedUrl(side: AgentBattleSide) {
  if (!side.pairUrl) return null;
  try {
    const url = new URL(side.pairUrl);
    url.searchParams.set('embed', '1');
    url.searchParams.set('theme', 'dark');
    url.searchParams.set('trades', '0');
    url.searchParams.set('info', '0');
    return url.toString();
  } catch {
    return null;
  }
}

function battleSymbol(side: AgentBattleSide) {
  return (side.tokenSymbol || side.label || 'TOKEN').replace(/^\$/, '').trim() || 'TOKEN';
}

function battleArmyName(side: AgentBattleSide) {
  return `${battleSymbol(side)} Army`;
}

function battleMarketTitle(side: AgentBattleSide) {
  return `Will $${battleSymbol(side)} claim 12% in the next 5 min?`;
}

function battleMarketCap(left: AgentBattleSide, right: AgentBattleSide) {
  const leftMarketCap = typeof left.marketCap === 'number' && Number.isFinite(left.marketCap) ? left.marketCap : 0;
  const rightMarketCap = typeof right.marketCap === 'number' && Number.isFinite(right.marketCap) ? right.marketCap : 0;
  return leftMarketCap + rightMarketCap;
}

function estimatedPayout(side: AgentBattleSide, stakeAmount = 100) {
  const probability = Math.max(1, Math.min(99, side.confidence || 50));
  return stakeAmount * (100 / probability);
}

function formatBxbt(value: number) {
  if (!Number.isFinite(value)) return '0 BXBT';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M BXBT`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K BXBT`;
  return `${value.toFixed(value >= 100 ? 0 : 2)} BXBT`;
}

function formatAgo(value?: string) {
  if (!value) return 'now';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 45) return 'now';
  if (seconds < 90) return '1m ago';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

type MarketWindow = 'm5' | 'h1' | 'h24';

function windowStats(side: AgentBattleSide, window: MarketWindow) {
  if (window === 'm5') {
    return {
      label: '5M',
      change: side.priceChangeM5,
      volume: side.volumeM5,
      buys: side.buysM5,
      sells: side.sellsM5,
    };
  }
  if (window === 'h1') {
    return {
      label: '1H',
      change: side.priceChangeH1,
      volume: side.volumeH1,
      buys: side.buysH1,
      sells: side.sellsH1,
    };
  }
  return {
    label: '24H',
    change: side.priceChangeH24,
    volume: side.volumeH24 || 0,
    buys: side.buysH24,
    sells: side.sellsH24,
  };
}

function windowRows(side: AgentBattleSide) {
  return [windowStats(side, 'm5'), windowStats(side, 'h1'), windowStats(side, 'h24')];
}

function buyPressureUsd(side: AgentBattleSide, window: MarketWindow = 'h24') {
  const stats = windowStats(side, window);
  const volume = stats.volume || 0;
  const totalTrades = stats.buys + stats.sells;
  const ratio = totalTrades > 0 ? stats.buys / totalTrades : 0;
  return volume * Math.min(0.9, Math.max(0.1, ratio || 0.5));
}

function sellPressureUsd(side: AgentBattleSide, window: MarketWindow = 'h24') {
  const stats = windowStats(side, window);
  const volume = stats.volume || 0;
  return Math.max(0, volume - buyPressureUsd(side, window));
}

function activeTrades(side: AgentBattleSide, window: MarketWindow = 'h24') {
  const stats = windowStats(side, window);
  return (stats.buys || 0) + (stats.sells || 0);
}

function hasRealMarketStats(side: AgentBattleSide) {
  return side.dataSource === 'dexscreener' && Boolean(side.pairAddress || side.pairUrl);
}

function formatArenaRank(side: AgentBattleSide) {
  const rank = [side.leaderboardRank, side.rank, side.profileRank]
    .find((value) => Number.isFinite(Number(value)) && Number(value) > 0);
  return rank ? `#${Math.round(Number(rank)).toLocaleString()}` : 'n/a';
}

function formatArenaScore(side: AgentBattleSide) {
  return Math.max(0, Math.round(Number(side.score || 0))).toLocaleString();
}

function formatArenaBantCredits(side: AgentBattleSide) {
  return formatCompactNumber(Math.max(0, Math.round(Number(side.bantCreditsEarned || 0))));
}

function formatArenaStatus(side: AgentBattleSide) {
  return side.status.replace(/-/g, ' ');
}

function pressureShare(side: AgentBattleSide, opponent: AgentBattleSide, window: MarketWindow = 'm5') {
  const sidePressure = buyPressureUsd(side, window);
  const opponentPressure = buyPressureUsd(opponent, window);
  const total = sidePressure + opponentPressure;
  if (total <= 0) return side.confidence;
  return Math.round((sidePressure / total) * 100);
}

function battleSpeedMultiplier(left: AgentBattleSide, right: AgentBattleSide) {
  const trades = activeTrades(left, 'm5') + activeTrades(right, 'm5');
  const volume = (left.volumeM5 || 0) + (right.volumeM5 || 0);
  const speed = 1 + Math.min(2.5, trades / 250 + volume / 250_000);
  return `${speed.toFixed(1)}x`;
}

function arenaCallout(side: AgentBattleSide, opponent: AgentBattleSide) {
  if (side.confidence > opponent.confidence) return 'Momentum lead';
  if (side.confidence === opponent.confidence) return 'Dead heat';
  return 'Comeback watch';
}

function sideIsPositive(side: AgentBattleSide, fallbackPositive: boolean) {
  if (side.direction === 'up') return true;
  if (side.direction === 'down') return false;
  return fallbackPositive;
}

function metricBarWidth(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 4;
  return Math.max(4, Math.min(100, Math.abs(value)));
}

function sideTone(side: AgentBattleSide, index: number) {
  if (side.status === 'attacking') {
    return {
      border: 'border-secondary',
      bg: 'bg-secondary/10',
      text: 'text-secondary',
      button: 'bg-secondary text-secondary-foreground',
      tag: 'ATTACKING',
    };
  }

  if (side.status === 'staggered') {
    return {
      border: 'border-destructive',
      bg: 'bg-destructive/10',
      text: 'text-destructive',
      button: 'bg-destructive text-destructive-foreground',
      tag: 'UNDER PRESSURE',
    };
  }

  return index === 0
    ? {
        border: 'border-primary',
        bg: 'bg-primary/10',
        text: 'text-primary',
        button: 'bg-primary text-primary-foreground',
        tag: side.status.toUpperCase(),
      }
    : {
        border: 'border-accent',
        bg: 'bg-accent/10',
        text: 'text-accent',
        button: 'bg-accent text-accent-foreground',
        tag: side.status.toUpperCase(),
      };
}

function BattleTokenMark({
  side,
  className,
  emojiClassName = '',
}: {
  side: AgentBattleSide;
  className: string;
  emojiClassName?: string;
}) {
  const [failed, setFailed] = useState(false);
  const avatarUrl = arenaAgentAvatar(`${side.agentName}:${side.id}`);

  if (!failed) {
    return (
      <img
        src={avatarUrl}
        alt={`${side.agentName || side.label} avatar`}
        className={className}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }

  return <span className={emojiClassName}>{side.label.slice(0, 1)}</span>;
}

function roleColor(role: string) {
  if (role === 'SPECTATOR') return 'bg-primary/20 text-primary';
  if (role === 'ENGINE') return 'bg-muted text-muted-foreground';
  return 'bg-secondary/20 text-secondary';
}

function sourceColor(source: TrollboxMessage['source']) {
  if (source === 'telegram') return 'bg-secondary/20 text-secondary';
  if (source === 'system') return 'bg-muted text-muted-foreground';
  return 'bg-primary/20 text-primary';
}

function sourceLabel(source: TrollboxMessage['source']) {
  if (source === 'telegram') return 'TG';
  if (source === 'system') return 'SYS';
  return 'WEB';
}

function feedSourceColor(source: SidebarFeedSource) {
  if (source === 'telegram') return 'bg-sky-400/15 text-sky-300';
  if (source === 'twitter') return 'bg-blue-400/15 text-blue-300';
  return 'bg-primary/15 text-primary';
}

function feedSourceLabel(source: SidebarFeedSource) {
  if (source === 'telegram') return 'TG';
  if (source === 'twitter') return 'X';
  return 'BOTA';
}

function eventSourceColor(severity?: string) {
  if (severity === 'danger') return 'bg-destructive/15 text-destructive';
  if (severity === 'hot') return 'bg-secondary/15 text-secondary';
  return 'bg-primary/15 text-primary';
}

function actionSourceColor(tone: BattleOutcomeTone) {
  if (tone === 'win' || tone === 'result') return 'bg-green-500/15 text-green-400';
  if (tone === 'loss') return 'bg-red-500/15 text-red-400';
  if (tone === 'reward') return 'bg-yellow-400/15 text-yellow-300';
  if (tone === 'settling') return 'bg-amber-500/15 text-amber-300';
  return 'bg-primary/15 text-primary';
}

function compactWhitespace(value?: string | null) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncateTrollboxText(value: string, maxLength = 112) {
  const text = compactWhitespace(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function extractAlertMetric(text: string, label: string) {
  const match = text.match(new RegExp(`${label}:\\s*([^\\s]+(?:\\/100)?)`, 'i'));
  return match?.[1]?.trim() || null;
}

function compactAlertMessage(message: string) {
  if (!/BANTAH ALERT|This token is on watch|Rug Score/i.test(message)) return null;

  const chain = message.match(/token\s+on\s+([A-Za-z0-9 ]+)/i)?.[1]?.trim() || 'Token';
  const price = extractAlertMetric(message, 'Price');
  const liquidity = extractAlertMetric(message, 'Liquidity');
  const rug = extractAlertMetric(message, 'Rug Score') || extractAlertMetric(message, 'Rug score');
  const momentum = extractAlertMetric(message, 'Momentum');
  const parts = [`${chain} watch`];

  if (price && price.toLowerCase() !== 'n/a') parts.push(`Price ${price}`);
  if (liquidity && liquidity !== '$0') parts.push(`Liq ${liquidity}`);
  if (rug) parts.push(`Rug ${rug}`);
  if (momentum) parts.push(`Mom ${momentum}`);

  return parts.join(' | ');
}

function compactTrollboxMessage(message?: string | null, maxLength = 112) {
  const text = compactWhitespace(message);
  if (!text) return '';
  return truncateTrollboxText(compactAlertMessage(text) || text, maxLength);
}

function compactTrollboxUser(user?: string | null, fallback = 'BOTA') {
  const text = compactWhitespace(user);
  if (!text) return fallback;
  if (/BantahBro Official/i.test(text)) return 'BOTA Alerts';
  return text.replace(/BantahBro/gi, 'BOTA');
}

function compactTrollboxMeta(meta?: string | null) {
  const text = compactWhitespace(meta);
  if (!text) return undefined;
  return truncateTrollboxText(text.replace(/BantahBro/gi, 'BOTA'), 34);
}

function buildBattleEventMessage(event: AgentBattleFeed['battles'][number]['events'][number]) {
  const label = compactWhitespace(event.metricLabel).toLowerCase();
  const metric = compactWhitespace(event.metricValue);
  const message = compactWhitespace(event.message);

  if (metric) {
    if (label.includes('liquidity')) return `${metric} liquidity`;
    if (label.includes('volume')) return `${metric} 24H volume`;
    if (label.includes('move')) return `${metric} 24H move`;
    if (label.includes('confidence')) return `${metric} gap; can flip`;
    if (label.includes('buy')) {
      const sells = message.match(/vs\s+([$\w.,]+)\s+sells/i)?.[1];
      return sells ? `${metric} buys vs ${sells} sells` : `${metric} buys`;
    }

    if (message.startsWith(metric) || message.includes(metric)) {
      return compactTrollboxMessage(message, 96);
    }
    return compactTrollboxMessage(`${metric} ${message}`, 96);
  }

  return compactTrollboxMessage(message, 96);
}

function battleEventStatusIcon(event: AgentBattleFeed['battles'][number]['events'][number]): DesktopTrollboxItem['statusIcon'] {
  const label = compactWhitespace(event.metricLabel).toLowerCase();
  const message = compactWhitespace(event.message).toLowerCase();
  if (event.severity === 'danger' || label.includes('confidence') || message.includes('trailing') || message.includes('lost')) {
    return '🔴';
  }
  return '🟢';
}

function battleEventAvatarUrl(
  event: AgentBattleFeed['battles'][number]['events'][number],
  battleSides: readonly AgentBattleSide[] = [],
) {
  const side = battleSides.find((candidate) => candidate.id === event.sideId) ||
    battleSides.find((candidate) => candidate.agentName === event.agentName);
  return arenaAgentAvatar(side ? `${side.agentName}:${side.id}` : `${event.agentName}:${event.sideId || event.id}`);
}

function battleActionLabel(mode: BattleExperienceMode) {
  return mode === 'challenge' ? 'ONCHAIN' : 'SIM';
}

function leadingBattleSides(battle?: AgentBattle | null) {
  if (!battle?.sides?.length) return null;
  const winner =
    battle.sides.find((side) => side.id === battle.leadingSideId) ||
    [...battle.sides].sort((left, right) => right.confidence - left.confidence)[0];
  const loser = battle.sides.find((side) => side.id !== winner.id) || null;
  if (!winner || !loser) return null;
  return { winner, loser };
}

function buildBattleOutcomeItem(
  battle: AgentBattle | null | undefined,
  mode: BattleExperienceMode,
  finalResult: boolean,
  createdAt?: string,
): DesktopTrollboxItem | null {
  const sides = leadingBattleSides(battle);
  if (!battle || !sides) return null;

  const { winner, loser } = sides;
  const layerLabel = battleActionLabel(mode);
  return {
    id: `${finalResult ? 'result' : 'live-state'}-${battle.id}`,
    createdAt: createdAt || (finalResult ? battle.endsAt : battle.updatedAt),
    sourceLabel: finalResult ? 'RESULT' : layerLabel,
    sourceClassName: actionSourceColor(finalResult ? 'result' : 'live'),
    avatarUrl: arenaAgentAvatar(`${winner.agentName}:${winner.id}`),
    statusIcon: '🟢',
    statusLabel: finalResult ? 'win' : 'leading',
    user: finalResult ? `${winner.agentName} result` : `${winner.agentName} live`,
    message: finalResult
      ? `${winner.agentName} won; 🔴 ${loser.agentName} lost.`
      : `${winner.agentName} leads ${winner.confidence}-${loser.confidence}; 🔴 ${loser.agentName} trails.`,
    meta: finalResult ? truncateTrollboxText(battle.title, 34) : 'live state',
  };
}

function buildBattleSlipActionItems(positions: AgentBattleP2PHistoryPosition[]): DesktopTrollboxItem[] {
  return positions
    .filter((position) =>
      position.resultStatus === 'won' ||
      position.resultStatus === 'lost' ||
      position.resultStatus === 'awaiting_settlement' ||
      position.resultStatus === 'unmatched',
    )
    .slice(0, 4)
    .map((position) => {
      const isWin = position.resultStatus === 'won';
      const isLoss = position.resultStatus === 'lost';
      const statusLabel = battleSlipStatusLabel(position.resultStatus);
      const amountLabel =
        position.earnedAmount != null && position.earnedAmount > 0
          ? `${formatTokenAmount(position.earnedAmount, position.escrowTokenSymbol || position.stakeCurrency)} earned`
          : position.stakeAmount > 0
            ? `${formatTokenAmount(position.stakeAmount, position.escrowTokenSymbol || position.stakeCurrency)} stake`
            : null;

      return {
        id: `slip-${position.id}-${position.resultStatus}`,
        createdAt: position.settledAt || position.updatedAt,
        sourceLabel: isWin ? 'WIN' : isLoss ? 'LOSS' : 'SLIP',
        sourceClassName: actionSourceColor(isWin ? 'win' : isLoss ? 'loss' : 'settling'),
        statusIcon: isWin ? '🟢' : isLoss ? '🔴' : null,
        statusLabel: isWin ? 'win' : isLoss ? 'loss' : null,
        user: 'Your battle slip',
        message: `${position.sideLabel} ${statusLabel.toLowerCase()}.`,
        meta: amountLabel || truncateTrollboxText(position.battleTitle, 34),
      };
    });
}

function dedupeTrollboxItems(items: DesktopTrollboxItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function buildDesktopTrollboxItems(
  messages: TrollboxMessage[],
  events: AgentBattleFeed['battles'][number]['events'],
  feedItems: SidebarFeedItem[],
  battleSides: readonly AgentBattleSide[] = [],
  actionItems: DesktopTrollboxItem[] = [],
): DesktopTrollboxItem[] {
  const chatItems = messages.map((message) => ({
    id: `chat-${message.id}`,
    createdAt: message.createdAt,
    sourceLabel: sourceLabel(message.source),
    sourceClassName: sourceColor(message.source),
    user: compactTrollboxUser(message.user),
    message: compactTrollboxMessage(message.message, 112),
    meta: compactTrollboxMeta(message.handle),
  }));

  const battleItems = events.slice(-8).map((event) => ({
    id: `event-${event.id}`,
    createdAt: event.time,
    sourceLabel: 'ARENA',
    sourceClassName: eventSourceColor(event.severity),
    avatarUrl: battleEventAvatarUrl(event, battleSides),
    statusIcon: battleEventStatusIcon(event),
    statusLabel: event.severity === 'danger' ? 'loss or pressure' : 'hit or win',
    user: event.agentName || 'Arena',
    message: buildBattleEventMessage(event),
    meta: compactTrollboxMeta(event.metricLabel),
  }));

  const syncedFeedItems = feedItems.slice(-14).map((item) => ({
    id: `feed-${item.id}`,
    createdAt: item.timestamp,
    sourceLabel: feedSourceLabel(item.source),
    sourceClassName: feedSourceColor(item.source),
    user: compactTrollboxUser(item.user),
    message: compactTrollboxMessage(item.content, 112),
    meta: compactTrollboxMeta(item.handle || item.market),
  }));

  const importantActionItems = dedupeTrollboxItems(actionItems).slice(-10);

  return [...importantActionItems, ...battleItems, ...syncedFeedItems, ...chatItems]
    .filter((item) => item.message)
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
    .slice(-80);
}

function BattleSideCard({ side, index, isLeading }: { side: AgentBattleSide; index: number; isLeading: boolean }) {
  const tone = sideTone(side, index);

  return (
    <div className={`p-3 sm:p-4 ${tone.bg} border ${tone.border} rounded-lg min-w-0`}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-12 h-12 rounded-full ${tone.bg} border-2 ${tone.border} flex items-center justify-center text-3xl shrink-0 overflow-hidden`}>
            <BattleTokenMark side={side} className="h-full w-full rounded-full object-cover" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-foreground truncate">{side.label}</span>
              {isLeading && <span className="text-[10px] bg-yellow-400/20 text-yellow-400 px-1 py-0.5 rounded font-bold">LEAD</span>}
            </div>
            <div className="text-xs text-muted-foreground truncate">{side.agentName}</div>
            <div className="text-[10px] text-muted-foreground">
              {side.chainLabel || side.chainId || 'Unknown chain'}
            </div>
          </div>
        </div>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${tone.bg} ${tone.text}`}>
          {tone.tag}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-background/60 border border-border rounded px-2 py-1.5">
          <div className="text-[10px] text-muted-foreground">Live price</div>
          <div className="text-sm font-mono font-bold text-foreground">{side.priceDisplay}</div>
        </div>
        <div className="bg-background/60 border border-border rounded px-2 py-1.5">
          <div className="text-[10px] text-muted-foreground">24H move</div>
          <div className={`text-sm font-mono font-bold ${side.direction === 'down' ? 'text-destructive' : side.direction === 'up' ? 'text-secondary' : 'text-muted-foreground'}`}>
            {side.change}
          </div>
        </div>
        <div className="bg-background/60 border border-border rounded px-2 py-1.5">
          <div className="text-[10px] text-muted-foreground">24H volume</div>
          <div className="text-sm font-mono font-bold text-foreground">{formatUsd(side.volumeH24)}</div>
        </div>
        <div className="bg-background/60 border border-border rounded px-2 py-1.5">
          <div className="text-[10px] text-muted-foreground">Liquidity</div>
          <div className="text-sm font-mono font-bold text-foreground">{formatUsd(side.liquidityUsd)}</div>
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Battle score</span>
          <span className={`font-mono font-bold ${tone.text}`}>{side.score}</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div className={tone.button} style={{ width: `${side.confidence}%`, height: '100%' }} />
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Confidence</span>
          <span className={`font-mono font-bold ${tone.text}`}>{side.confidence}%</span>
        </div>
      </div>

      <button className={`mt-3 w-full rounded py-2 text-xs font-bold ${tone.button} hover:opacity-90 transition`}>
        Join {side.label} side
      </button>
    </div>
  );
}

function ArenaTokenFighter({
  side,
  tone,
  align,
}: {
  side: AgentBattleSide;
  tone: 'green' | 'red';
  align: 'left' | 'right';
}) {
  const glow = tone === 'green'
    ? 'shadow-[0_0_50px_rgba(34,197,94,.42)] ring-green-400/60'
    : 'shadow-[0_0_50px_rgba(239,68,68,.42)] ring-red-400/60';
  const panel = tone === 'green'
    ? 'from-green-950/95 via-green-900/55 to-black/70 border-green-400/35 text-green-300'
    : 'from-red-950/95 via-red-900/55 to-black/70 border-red-400/35 text-red-300';

  return (
    <div className={`absolute bottom-[14%] z-20 flex w-[38%] flex-col ${align === 'left' ? 'left-[5%] items-start' : 'right-[5%] items-end'}`}>
      <div className={`mb-2 max-w-full rounded-2xl border bg-gradient-to-br ${panel} px-3 py-2 backdrop-blur-md`}>
        <div className="flex items-center gap-2">
          <div className={`grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-black/30 ring-2 ${glow}`}>
            <BattleTokenMark side={side} className="h-full w-full rounded-full object-cover" emojiClassName="text-xl" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-black uppercase leading-none text-white">{side.label}</div>
            <div className="mt-0.5 truncate text-[10px] font-bold uppercase opacity-85">{side.chainLabel || side.chainId || 'Live pair'}</div>
          </div>
        </div>
        <div className="mt-1 grid grid-cols-2 gap-1 text-[10px]">
          <span className="font-mono font-black text-white">{formatLiveTokenPrice(side)}</span>
          <span className={`text-right font-mono font-black ${side.direction === 'down' ? 'text-red-300' : 'text-green-300'}`}>{side.change}</span>
        </div>
      </div>

      <div className={`relative grid h-28 w-28 place-items-center overflow-hidden rounded-[2rem] border bg-black/35 ring-2 ${glow} md:h-36 md:w-36 md:rounded-[2.35rem] xl:h-44 xl:w-44 xl:rounded-[2.7rem]`}>
        <div className={`absolute inset-0 ${tone === 'green' ? 'bg-green-400/10' : 'bg-red-400/10'}`} />
        <BattleTokenMark side={side} className="relative z-10 h-[88%] w-[88%] rounded-[1.8rem] object-cover md:rounded-[2rem] xl:rounded-[2.35rem]" emojiClassName="relative z-10 text-6xl" />
      </div>
    </div>
  );
}

function BattleArenaMetricsRibbon({ left, right }: { left: AgentBattleSide; right: AgentBattleSide }) {
  const showMarketStats = hasRealMarketStats(left) && hasRealMarketStats(right);
  const leftPressure = pressureShare(left, right, 'm5');
  const rightPressure = pressureShare(right, left, 'm5');

  if (!showMarketStats) {
    return (
      <div className="grid grid-cols-2 gap-px bg-white/10 text-white md:grid-cols-4">
        <div className="bg-black/78 px-3 py-2 backdrop-blur-md">
          <div className="text-[10px] font-black uppercase tracking-wide text-white/75">Win Chance</div>
          <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
            <div><span className="block truncate font-black text-green-300">{battleSymbol(left)}</span><span className="font-mono font-black text-green-300">{left.confidence}%</span></div>
            <div><span className="block truncate font-black text-red-300">{battleSymbol(right)}</span><span className="font-mono font-black text-red-300">{right.confidence}%</span></div>
          </div>
        </div>
        <div className="bg-black/78 px-3 py-2 backdrop-blur-md">
          <div className="text-[10px] font-black uppercase tracking-wide text-white/75">Arena Score</div>
          <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
            <div><span className="block truncate font-black text-green-300">{battleSymbol(left)}</span><span className="font-mono font-black">{formatArenaScore(left)}</span></div>
            <div><span className="block truncate font-black text-red-300">{battleSymbol(right)}</span><span className="font-mono font-black">{formatArenaScore(right)}</span></div>
          </div>
        </div>
        <div className="bg-black/78 px-3 py-2 backdrop-blur-md">
          <div className="text-[10px] font-black uppercase tracking-wide text-white/75">BantCredit</div>
          <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
            <div><span className="block truncate font-black text-green-300">{battleSymbol(left)}</span><span className="font-mono font-black">{formatArenaBantCredits(left)}</span></div>
            <div><span className="block truncate font-black text-red-300">{battleSymbol(right)}</span><span className="font-mono font-black">{formatArenaBantCredits(right)}</span></div>
          </div>
        </div>
        <div className="bg-black/78 px-3 py-2 backdrop-blur-md">
          <div className="text-[10px] font-black uppercase tracking-wide text-white/75">Rank</div>
          <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
            <div><span className="block truncate font-black text-green-300">{battleSymbol(left)}</span><span className="font-mono font-black">{formatArenaRank(left)}</span></div>
            <div><span className="block truncate font-black text-red-300">{battleSymbol(right)}</span><span className="font-mono font-black">{formatArenaRank(right)}</span></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-px bg-white/10 text-white md:grid-cols-4">
      <div className="bg-black/78 px-3 py-2 backdrop-blur-md">
        <div className="text-[10px] font-black uppercase tracking-wide text-white/75">Price Change (5M)</div>
        <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
          <div><span className="block truncate font-black text-green-300">{battleSymbol(left)}</span><span className="font-mono font-black text-green-300">{formatSignedPercent(left.priceChangeM5)}</span></div>
          <div><span className="block truncate font-black text-red-300">{battleSymbol(right)}</span><span className="font-mono font-black text-red-300">{formatSignedPercent(right.priceChangeM5)}</span></div>
        </div>
      </div>
      <div className="bg-black/78 px-3 py-2 backdrop-blur-md">
        <div className="text-[10px] font-black uppercase tracking-wide text-white/75">Buy Pressure</div>
        <div className="mt-1 space-y-1 text-xs">
          <div className="flex items-center gap-2"><span className="w-12 truncate font-black text-green-300">{battleSymbol(left)}</span><span className="h-2 flex-1 rounded-full bg-white/10"><span className="block h-full rounded-full bg-green-400" style={{ width: `${leftPressure}%` }} /></span><span className="font-mono">{leftPressure}%</span></div>
          <div className="flex items-center gap-2"><span className="w-12 truncate font-black text-red-300">{battleSymbol(right)}</span><span className="h-2 flex-1 rounded-full bg-white/10"><span className="block h-full rounded-full bg-red-400" style={{ width: `${rightPressure}%` }} /></span><span className="font-mono">{rightPressure}%</span></div>
        </div>
      </div>
      <div className="bg-black/78 px-3 py-2 backdrop-blur-md">
        <div className="text-[10px] font-black uppercase tracking-wide text-white/75">Volume (5M)</div>
        <div className="mt-1 space-y-1 text-xs">
          <div className="flex justify-between gap-2"><span className="truncate font-black text-green-300">{battleSymbol(left)}</span><span className="font-mono font-black">{formatUsd(left.volumeM5)}</span></div>
          <div className="flex justify-between gap-2"><span className="truncate font-black text-red-300">{battleSymbol(right)}</span><span className="font-mono font-black">{formatUsd(right.volumeM5)}</span></div>
        </div>
      </div>
      <div className="bg-black/78 px-3 py-2 backdrop-blur-md">
        <div className="text-[10px] font-black uppercase tracking-wide text-white/75">Live Trades</div>
        <div className="mt-1 space-y-1 text-xs">
          <div className="flex justify-between gap-2"><span className="truncate font-black text-green-300">{battleSymbol(left)}</span><span className="font-mono font-black">{formatCompactNumber(activeTrades(left, 'm5'))}</span></div>
          <div className="flex justify-between gap-2"><span className="truncate font-black text-red-300">{battleSymbol(right)}</span><span className="font-mono font-black">{formatCompactNumber(activeTrades(right, 'm5'))}</span></div>
        </div>
      </div>
    </div>
  );
}

function BattleModeToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-black uppercase tracking-wide transition active:scale-95 ${
        enabled
          ? 'border-primary/45 bg-primary/15 text-primary hover:bg-primary/25'
          : 'border-border bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
      aria-pressed={enabled}
      title="Toggle simulated offchain arena view."
    >
      <span className={enabled ? 'text-primary' : 'text-muted-foreground'}>⚔</span>
      <span className="font-mono">{enabled ? 'SIM ON' : 'SIM OFF'}</span>
    </button>
  );
}

function GameSoundToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`grid h-7 w-7 place-items-center rounded-full border transition active:scale-95 ${
        enabled
          ? 'border-primary/45 bg-primary/15 text-primary hover:bg-primary/25'
          : 'border-border bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
      aria-label={enabled ? 'Mute game sound' : 'Unmute game sound'}
      aria-pressed={enabled}
      title={enabled ? 'Mute game sound' : 'Unmute game sound'}
    >
      {enabled ? <Volume2 size={14} strokeWidth={2.6} /> : <VolumeX size={14} strokeWidth={2.6} />}
    </button>
  );
}

function AgentBattleArenaHero({ battle, left, right }: { battle: AgentBattleFeed['battles'][number]; left: AgentBattleSide; right: AgentBattleSide }) {
  const showMarketStats = hasRealMarketStats(left) && hasRealMarketStats(right);
  const leftBuyPressure = buyPressureUsd(left, 'm5');
  const rightBuyPressure = buyPressureUsd(right, 'm5');
  const { timeRemainingSeconds, isExpired, durationLabel } = useBattleClock({
    startsAt: battle.startsAt,
    endsAt: battle.endsAt,
    fallbackSeconds: battle.timeRemainingSeconds,
  });

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="bg-gradient-to-r from-green-950/55 via-background to-red-950/55">
        <div className="grid grid-cols-[1fr_5.25rem_1fr] items-center gap-2 px-3 py-2 md:grid-cols-[1fr_6.5rem_1fr]">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-2xl font-black text-green-400 md:text-4xl">{left.confidence}%</span>
              <span className="h-3 min-w-0 flex-1 overflow-hidden rounded-full border border-green-900/70 bg-black/35">
                <span className="block h-full rounded-full bg-gradient-to-r from-green-600 to-lime-300 shadow-[0_0_18px_rgba(132,255,78,.7)]" style={{ width: `${left.confidence}%` }} />
              </span>
            </div>
            <div className="mt-1 truncate text-xs font-black uppercase text-white md:text-sm">
              {showMarketStats ? (
                <>
                  {formatUsd(leftBuyPressure)} <span className="text-green-300">Buy Pressure</span>
                </>
              ) : (
                <>
                  {formatArenaBantCredits(left)} <span className="text-green-300">BantCredit</span>
                </>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-primary/40 bg-background/90 px-2 py-1 text-center shadow-[0_0_24px_rgba(124,58,237,.25)]">
            <div className="font-mono text-2xl font-black leading-none text-foreground md:text-4xl">{formatDuration(timeRemainingSeconds)}</div>
            <div className="mt-1 text-[9px] font-black uppercase text-muted-foreground">{isExpired ? 'expired' : `${durationLabel} war`}</div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="h-3 min-w-0 flex-1 overflow-hidden rounded-full border border-red-900/70 bg-black/35">
                <span className="block h-full rounded-full bg-gradient-to-r from-red-500 to-red-400 shadow-[0_0_18px_rgba(239,68,68,.6)]" style={{ width: `${right.confidence}%` }} />
              </span>
              <span className="font-mono text-2xl font-black text-red-400 md:text-4xl">{right.confidence}%</span>
            </div>
            <div className="mt-1 truncate text-right text-xs font-black uppercase text-white md:text-sm">
              {showMarketStats ? (
                <>
                  {formatUsd(rightBuyPressure)} <span className="text-red-300">Buy Pressure</span>
                </>
              ) : (
                <>
                  {formatArenaBantCredits(right)} <span className="text-red-300">BantCredit</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="relative h-[22rem] overflow-hidden bg-[radial-gradient(circle_at_50%_35%,#68c4ff_0%,#2883d4_35%,#0d3158_62%,#050b16_100%)]">
        <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-4">
          <div className="rounded-xl border border-white/15 bg-black/55 px-3 py-2 text-xs font-black uppercase text-white shadow backdrop-blur-md">
            <span className={`mr-1.5 inline-block h-2.5 w-2.5 rounded-full ${isExpired ? 'bg-slate-400 shadow-[0_0_10px_rgba(148,163,184,.65)]' : 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,.85)]'}`} /> {isExpired ? 'Expired Arena' : 'Live Arena'}
          </div>
          <div className="rounded-xl border border-white/15 bg-black/45 px-4 py-2 text-xs font-black text-white shadow backdrop-blur-md">
            <Eye size={14} className="mr-1.5 inline" /> {formatCompactNumber(battle.spectators)} watching
          </div>
          {showMarketStats ? (
            <div className="rounded-xl border border-white/15 bg-black/55 px-3 py-2 text-xs font-black uppercase text-white shadow backdrop-blur-md">
              Speed <span className="text-green-300">{battleSpeedMultiplier(left, right)}</span>
            </div>
          ) : (
            <div className="rounded-xl border border-white/15 bg-black/55 px-3 py-2 text-xs font-black uppercase text-white shadow backdrop-blur-md">
              Arena <span className="text-green-300">Sim</span>
            </div>
          )}
        </div>

        <div className="absolute left-[22%] top-[4.6rem] z-20 rounded-2xl border border-white/20 bg-white/88 px-4 py-2 text-center text-xs font-black uppercase leading-tight text-slate-950 shadow-xl">
          {arenaCallout(left, right)}<br /><span className="text-green-700">{showMarketStats ? formatSignedPercent(left.priceChangeM5) : `${left.confidence}%`}</span>
          <span className="absolute -bottom-1 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 bg-white/88" />
        </div>
        <div className="absolute right-[18%] top-[4.6rem] z-20 rounded-2xl border border-white/20 bg-white/88 px-4 py-2 text-center text-xs font-black uppercase leading-tight text-slate-950 shadow-xl">
          {arenaCallout(right, left)}<br /><span className="text-red-700">{showMarketStats ? formatSignedPercent(right.priceChangeM5) : `${right.confidence}%`}</span>
          <span className="absolute -bottom-1 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 bg-white/88" />
        </div>

        <div className="absolute inset-x-0 top-[7.25rem] z-0 flex justify-center gap-2 opacity-80">
          {Array.from({ length: 28 }).map((_, index) => (
            <span
              key={index}
              className={`h-5 w-5 rounded-full border border-white/20 ${index % 3 === 0 ? 'bg-green-300/80' : index % 3 === 1 ? 'bg-red-300/75' : 'bg-white/70'} shadow`}
            />
          ))}
        </div>

        <div className="absolute inset-x-[-9%] bottom-[-38%] h-48 rounded-[50%] border-[12px] border-amber-800/25 bg-[radial-gradient(circle,#d9b56f_0%,#b98a45_42%,#6b421f_78%)] shadow-[0_-22px_42px_rgba(0,0,0,.42)_inset]" />
        <div className="absolute inset-x-[17%] bottom-[10%] h-[5.8rem] rounded-[50%] border border-amber-900/30 bg-amber-200/20" />
        <ArenaTokenFighter side={left} tone="green" align="left" />
        <ArenaTokenFighter side={right} tone="red" align="right" />
      </div>

      <BattleArenaMetricsRibbon left={left} right={right} />
    </div>
  );
}

function BattleChartPanel({ side, index }: { side: AgentBattleSide; index: number }) {
  const showMarketStats = hasRealMarketStats(side);
  const positive = sideIsPositive(side, index === 0);
  const tone = positive
    ? {
        title: 'text-green-300',
        bar: 'from-green-600 to-lime-300',
      }
    : {
        title: 'text-red-400',
        bar: 'from-red-700 to-red-400',
      };
  const rows = windowRows(side);
  const embedUrl = dexScreenerEmbedUrl(side);

  if (!showMarketStats) {
    return (
      <div className="min-h-[14.5rem] rounded-md border border-border bg-card/95 p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-black uppercase tracking-wide text-foreground">
            ARENA STATS - <span className={tone.title}>{side.label}</span>
          </div>
          <div className="text-[10px] font-mono text-muted-foreground">{formatArenaRank(side)}</div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <MobileMetricCard label="Win Chance" value={`${side.confidence}%`} tone={index === 0 ? 'text-green-400' : 'text-red-400'} />
          <MobileMetricCard label="Arena Score" value={formatArenaScore(side)} />
          <MobileMetricCard label="BantCredit" value={formatArenaBantCredits(side)} tone="text-yellow-300" />
          <MobileMetricCard label="Status" value={formatArenaStatus(side)} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[14.5rem] rounded-md border border-border bg-card/95 p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-black uppercase tracking-wide text-foreground">
          LIVE CHART - <span className={tone.title}>{side.label}</span>
        </div>
        <div className="text-[10px] font-mono text-muted-foreground">{formatLiveTokenPrice(side)}</div>
      </div>

      <div className="mt-2 space-y-2">
        <div className="overflow-hidden rounded-md border border-border bg-background/80">
          {embedUrl ? (
            <iframe
              title={`Dexscreener live chart ${side.label}`}
              src={embedUrl}
              className="h-[11.75rem] w-full bg-background"
              loading="lazy"
              allow="clipboard-write"
            />
          ) : (
            <div className="flex h-[11.75rem] items-center justify-center px-4 text-center text-[11px] font-bold text-muted-foreground">
              Live Dexscreener pair URL missing. Chart hidden instead of drawing a fallback.
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-1">
          {rows.map((row) => (
            <div key={row.label} className="rounded-md border border-border bg-background/70 p-1.5">
              <div className="flex items-center justify-between gap-1">
                <span className="font-mono text-[9px] font-black text-muted-foreground">{row.label}</span>
                <span className={`font-mono text-[10px] font-black ${row.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {formatSignedPercent(row.change)}
                </span>
              </div>
              <div className="mt-1 truncate text-[9px] text-muted-foreground">
                Vol <b className="font-mono text-foreground">{formatUsd(row.volume)}</b>
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}

function BattleStatsPanel({
  left,
  right,
  battle,
  pool,
}: {
  left: AgentBattleSide;
  right: AgentBattleSide;
  battle?: AgentBattleFeed['battles'][number] | null;
  pool?: AgentBattleP2PPool | null;
}) {
  const showMarketStats = hasRealMarketStats(left) && hasRealMarketStats(right);
  const renderActivity = (side: AgentBattleSide, positive: boolean) => {
    const active = Math.min(3, Math.ceil(Math.log10(activeTrades(side, 'm5') + activeTrades(side, 'h1') + 1)));
    return (
      <div className="flex items-center justify-end gap-1">
        {[0, 1, 2].map((item) => (
          <span
            key={item}
            className={`h-2.5 w-5 rounded-full border ${
              item < active
                ? positive
                  ? 'border-green-500/60 bg-green-500'
                  : 'border-red-500/60 bg-red-500'
                : 'border-border bg-muted/40'
            }`}
          />
        ))}
      </div>
    );
  };
  const battleSpectators = Math.max(0, Math.round(battle?.spectators || 0));
  const battleBantCredits = Math.max(0, Math.round(battle?.bantCreditsEarned ?? battle?.spectatorBantCredits ?? 0));
  const poolTotal = Math.max(0, Number(pool?.totalStake || 0));

  return (
    <div className="min-h-[14.5rem] rounded-md border border-border bg-card/95 p-3 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="text-xs font-black uppercase tracking-wide text-foreground">BATTLE STATS</div>
      {showMarketStats ? (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <span className={left.priceChangeM5 < 0 ? 'text-red-400 font-mono font-black' : 'text-green-400 font-mono font-black'}>
              {formatSignedPercent(left.priceChangeM5)}
            </span>
            <span className="text-[9px] font-bold uppercase text-muted-foreground">Move (5M)</span>
            <span className={right.priceChangeM5 < 0 ? 'text-red-400 font-mono font-black' : 'text-green-400 font-mono font-black'}>
              {formatSignedPercent(right.priceChangeM5)}
            </span>
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <span className="font-mono text-[13px] font-black text-foreground">{formatUsd(left.volumeM5)}</span>
            <span className="text-[9px] font-bold uppercase text-muted-foreground">Volume (5M)</span>
            <span className="font-mono text-[13px] font-black text-foreground">{formatUsd(right.volumeM5)}</span>
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <span className="font-mono text-[13px] font-black text-foreground">{formatNumber(left.buysM5)}</span>
            <span className="text-[9px] font-bold uppercase text-muted-foreground">Buys (5M)</span>
            <span className="font-mono text-[13px] font-black text-foreground">{formatNumber(right.buysM5)}</span>
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <span className="font-mono text-[13px] font-black text-foreground">{formatNumber(left.sellsM5)}</span>
            <span className="text-[9px] font-bold uppercase text-muted-foreground">Sells (5M)</span>
            <span className="font-mono text-[13px] font-black text-foreground">{formatNumber(right.sellsM5)}</span>
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            {renderActivity(left, true)}
            <span className="text-[9px] font-bold uppercase text-muted-foreground">Live Activity</span>
            {renderActivity(right, false)}
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <span className="font-mono text-[13px] font-black text-green-400">{left.confidence}%</span>
            <span className="text-[9px] font-bold uppercase text-muted-foreground">Win Chance</span>
            <span className="font-mono text-[13px] font-black text-red-400">{right.confidence}%</span>
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <span className="font-mono text-[13px] font-black text-foreground">{formatArenaScore(left)}</span>
            <span className="text-[9px] font-bold uppercase text-muted-foreground">Arena Score</span>
            <span className="font-mono text-[13px] font-black text-foreground">{formatArenaScore(right)}</span>
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <span className="font-mono text-[13px] font-black text-foreground">{formatArenaRank(left)}</span>
            <span className="text-[9px] font-bold uppercase text-muted-foreground">Rank</span>
            <span className="font-mono text-[13px] font-black text-foreground">{formatArenaRank(right)}</span>
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <span className="truncate text-[11px] font-black uppercase text-green-300">{left.status}</span>
            <span className="text-[9px] font-bold uppercase text-muted-foreground">Arena State</span>
            <span className="truncate text-[11px] font-black uppercase text-red-300">{right.status}</span>
          </div>
        </div>
      )}
      {battle && (
        <div className="mt-3 grid grid-cols-2 gap-1.5">
          <MobileMetricCard label="BantCredit" value={formatCompactNumber(battleBantCredits)} tone="text-yellow-300" />
          <MobileMetricCard label="Pool" value={poolTotal > 0 ? formatTokenAmount(poolTotal, pool?.stakeCurrency) : '0'} />
        </div>
      )}
    </div>
  );
}

function ChooseSidePanel({
  left,
  right,
  selectedSide,
  onJoin,
}: {
  left: AgentBattleSide;
  right: AgentBattleSide;
  selectedSide: AgentBattleSide;
  onJoin: (side: AgentBattleSide) => void;
}) {
  const selectedIsLeft = selectedSide.id === left.id;
  const selectedTone = selectedIsLeft ? 'text-green-300' : 'text-red-300';

  return (
    <div className="flex h-full min-h-[11rem] flex-col rounded-md border border-border bg-card/95 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="rounded-md border border-primary/20 bg-primary/10 px-2 py-1.5 text-center text-[11px] font-black uppercase leading-tight text-foreground whitespace-normal">
        {battleMarketTitle(left)}
      </div>
      <div className="mt-1.5 flex flex-col items-center gap-0.5 text-center">
        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-foreground">Choose Your Side</div>
        <div className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-black uppercase text-muted-foreground">Stake ref: 100 BXBT</div>
      </div>

      <div className="mx-auto mt-1.5 grid w-full max-w-[16rem] grid-cols-2 gap-2">
        <button
          onClick={() => onJoin(left)}
          className={`rounded-md border px-1 py-0.5 text-left transition active:scale-[0.99] ${
            selectedIsLeft
              ? 'border-green-300/90 bg-green-600/40 shadow-[inset_0_0_22px_rgba(34,197,94,.22)]'
              : 'border-green-400/55 bg-green-600/25 hover:bg-green-600/35'
          }`}
        >
          <div className="flex items-center gap-1">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-green-500/20 text-lg">
              <BattleTokenMark side={left} className="h-full w-full rounded-full object-cover" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1 truncate text-[9px] font-black uppercase leading-none">
                <span className="text-green-200">YES</span>
                <span className="truncate text-foreground">{battleSymbol(left)}</span>
                <span className="font-mono text-[8px] text-green-100">{left.confidence}%</span>
              </div>
            </div>
          </div>
        </button>
        <button
          onClick={() => onJoin(right)}
          className={`rounded-md border px-1 py-0.5 text-left transition active:scale-[0.99] ${
            selectedSide.id === right.id
              ? 'border-red-300/90 bg-red-600/40 shadow-[inset_0_0_22px_rgba(239,68,68,.22)]'
              : 'border-red-400/55 bg-red-600/25 hover:bg-red-600/35'
          }`}
        >
          <div className="flex items-center gap-1">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-red-500/20 text-lg">
              <BattleTokenMark side={right} className="h-full w-full rounded-full object-cover" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1 truncate text-[9px] font-black uppercase leading-none">
                <span className="text-red-200">NO</span>
                <span className="truncate text-foreground">{battleSymbol(right)}</span>
                <span className="font-mono text-[8px] text-red-100">{right.confidence}%</span>
              </div>
            </div>
          </div>
        </button>
      </div>
      <div className="mt-1.5 rounded-md bg-muted/40 px-2 py-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[9px] font-black uppercase text-muted-foreground">Your pick</span>
          <span className={`truncate text-[10px] font-black uppercase ${selectedTone}`}>
            {selectedIsLeft ? 'YES' : 'NO'} · {battleSymbol(selectedSide)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="text-[9px] font-black uppercase text-muted-foreground">Est. payout</span>
          <span className="font-mono text-[11px] font-black text-primary">{formatBxbt(estimatedPayout(selectedSide))}</span>
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-1.5">
        <div className="min-w-0 text-[10px] text-muted-foreground">
          Prediction ticket
        </div>
        <button
          onClick={() => onJoin(selectedSide)}
          className="shrink-0 rounded-md bg-primary px-2 py-1 text-[10px] font-black text-primary-foreground hover:opacity-90 active:scale-[0.98]"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function DesktopBattleTabs({
  activeTab,
  onTabChange,
  battle,
  left,
  right,
  pool,
  selectedSide,
  events,
  onJoinSide,
}: {
  activeTab: DesktopBattleTab;
  onTabChange: (tab: DesktopBattleTab) => void;
  battle?: AgentBattleFeed['battles'][number] | null;
  left: AgentBattleSide;
  right: AgentBattleSide;
  pool?: AgentBattleP2PPool | null;
  selectedSide: AgentBattleSide;
  events: AgentBattleFeed['battles'][number]['events'];
  onJoinSide: (side: AgentBattleSide) => void;
}) {
  const tabs: Array<{ id: DesktopBattleTab; label: string }> = [
    { id: 'side', label: 'Predict' },
    { id: 'stats', label: 'Stats' },
    { id: 'feed', label: 'Battle Feed' },
  ];

  return (
    <div className="hidden border-b border-border bg-background xl:block">
      <div className="flex items-center justify-center gap-1 border-b border-border bg-card/80 p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`rounded-md px-3 py-1.5 text-[11px] font-black uppercase tracking-wide transition ${
              activeTab === tab.id
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-1">
        {activeTab === 'stats' && <BattleStatsPanel left={left} right={right} battle={battle} pool={pool} />}
        {activeTab === 'feed' && <BattleFeedPanel events={events} left={left} right={right} />}
        {activeTab === 'side' && (
          <ChooseSidePanel
            left={left}
            right={right}
            selectedSide={selectedSide}
            onJoin={onJoinSide}
          />
        )}
      </div>
    </div>
  );
}

function BattleFeedPanel({ events, left, right }: { events: AgentBattleFeed['battles'][number]['events']; left: AgentBattleSide; right: AgentBattleSide }) {
  const visibleEvents = events.slice(0, 6);

  return (
    <div className="h-full min-h-[13.75rem] overflow-hidden rounded-md border border-border bg-card/95 p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-black uppercase tracking-wide text-foreground">LIVE BATTLE FEED</div>
        <button className="flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-[11px] font-bold text-muted-foreground">
          Filter <ChevronDown size={12} />
        </button>
      </div>
      <div className="space-y-2">
        {visibleEvents.map((item) => {
          const side = item.sideId === left.id ? left : item.sideId === right.id ? right : null;
          return (
            <div key={item.id} className="grid grid-cols-[3.05rem_4.7rem_1fr] items-center gap-2 text-[11px]">
              <span className="font-mono text-[10px] text-muted-foreground">{formatClock(item.time).replace(/\s/g, '')}</span>
              <span className={`flex min-w-0 items-center gap-1 font-black ${item.severity === 'danger' ? 'text-red-400' : item.severity === 'hot' ? 'text-green-400' : 'text-primary'}`}>
                {side && (
                  <img
                    src={arenaAgentAvatar(`${side.agentName}:${side.id}`)}
                    alt=""
                    className="h-4 w-4 shrink-0 rounded-full object-cover"
                    loading="lazy"
                  />
                )}
                <span className="truncate">{item.agentName}</span>
              </span>
              <span className="truncate text-muted-foreground">
                {item.message}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function QuickTradePanel({
  left,
  right,
  selectedIndex,
  amount,
  onSelect,
  onAmountChange,
  onStakeSide,
}: {
  left: AgentBattleSide;
  right: AgentBattleSide;
  selectedIndex: 0 | 1;
  amount: string;
  onSelect: (index: 0 | 1) => void;
  onAmountChange: (value: string) => void;
  onStakeSide: (side: AgentBattleSide, amount: string) => void;
}) {
  const selected = selectedIndex === 0 ? left : right;

  return (
    <div className="flex h-full min-h-[13.75rem] flex-col rounded-md border border-border bg-card/95 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="text-xs font-black uppercase tracking-wide text-foreground">QUICK TRADE</div>
      <div className="mt-1 text-[10px] text-muted-foreground">Support your side</div>

      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <button
          onClick={() => onSelect(0)}
          className={`rounded-md px-3 py-1.5 text-xs font-black transition ${
            selectedIndex === 0 ? 'bg-green-600 text-white' : 'bg-green-500/15 text-green-300 hover:bg-green-500/25'
          }`}
        >
          Buy {left.label}
        </button>
        <button
          onClick={() => onSelect(1)}
          className={`rounded-md px-3 py-1.5 text-xs font-black transition ${
            selectedIndex === 1 ? 'bg-red-600 text-white' : 'bg-red-500/15 text-red-300 hover:bg-red-500/25'
          }`}
        >
          Buy {right.label}
        </button>
      </div>

      <label className="mt-3 block text-[10px] font-bold uppercase text-muted-foreground">Stake amount</label>
      <div className="mt-1 flex items-center rounded-md border border-border bg-background">
        <input
          value={amount}
          onChange={(event) => onAmountChange(event.target.value.replace(/[^\d.]/g, ''))}
          className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-sm font-black text-foreground outline-none"
          inputMode="decimal"
        />
        <button onClick={() => onAmountChange('100')} className="m-1 rounded-md bg-primary px-3 py-1.5 text-xs font-black text-primary-foreground">
          MAX
        </button>
      </div>

      <div className="mt-2.5 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Live token price</span>
        <span className="font-mono font-bold text-foreground">{formatLiveTokenPrice(selected)}</span>
      </div>

      <button
        onClick={() => onStakeSide(selected, amount)}
        className={selectedIndex === 0 ? 'mt-3 w-full rounded-md bg-green-600 py-2.5 text-sm font-black text-white hover:bg-green-500' : 'mt-3 w-full rounded-md bg-red-600 py-2.5 text-sm font-black text-white hover:bg-red-500'}
      >
        Place P2P Stake
      </button>

      <div className="mt-auto flex items-center justify-between pt-2 text-xs text-muted-foreground">
        <span>Escrow lock required</span>
        <button className="rounded p-1 hover:bg-muted">
          <Settings size={14} />
        </button>
      </div>
    </div>
  );
}

function MobileTradeDeskPanel({
  left,
  right,
  selectedIndex,
  amount,
  onSelect,
  onAmountChange,
  onStakeSide,
}: {
  left: AgentBattleSide;
  right: AgentBattleSide;
  selectedIndex: 0 | 1;
  amount: string;
  onSelect: (index: 0 | 1) => void;
  onAmountChange: (value: string) => void;
  onStakeSide: (side: AgentBattleSide, amount: string) => void;
}) {
  const { toast } = useToast();
  const selected = selectedIndex === 0 ? left : right;
  const [orderType, setOrderType] = useState<'Limit' | 'Market' | 'Stop Limit'>('Limit');
  const [orderTypeOpen, setOrderTypeOpen] = useState(false);
  const [confirmTradeOpen, setConfirmTradeOpen] = useState(false);
  const liveTokenPrice = formatLiveTokenPrice(selected);

  const applyPercent = (percent: number) => {
    toast({
      title: `${percent}% shortcut needs wallet balance`,
      description: 'Connect live escrow-token balance before percentage sizing is enabled.',
    });
  };

  const handleMax = () => {
    toast({
      title: 'Live escrow-token balance required',
      description: 'MAX will activate once the wallet balance endpoint is connected.',
    });
  };

  const adjustAmount = (direction: 'down' | 'up') => {
    const current = Number(amount) || 0;
    const nextAmount = direction === 'up' ? current + 10 : Math.max(0, current - 10);
    onAmountChange(String(nextAmount));
  };

  return (
    <>
      <div className="overflow-hidden rounded-md border border-border bg-card/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        <div className="flex items-center justify-between border-b border-border bg-background/80 px-2 py-1.5">
          <div className="min-w-0">
            <div className="truncate text-sm font-black text-foreground">
              {left.label}/{right.label}
            </div>
            <div className="text-[9px] font-bold uppercase text-muted-foreground">Live battle spot desk</div>
          </div>
          <div className={`shrink-0 font-mono text-[11px] font-black ${selected.direction === 'down' ? 'text-red-400' : 'text-green-400'}`}>
            {selected.change}
          </div>
        </div>

        <div className="grid grid-cols-[0.44fr_0.56fr] gap-1.5 p-1.5">
          <div className="min-w-0">
            <div className="grid grid-cols-3 pb-1 text-[9px] font-bold text-muted-foreground">
              <span>Window</span>
              <span className="text-right">Move</span>
              <span className="text-right">Vol</span>
            </div>
            <div className="space-y-1">
              {windowRows(right).map((row) => (
                <div key={`right-${row.label}`} className="grid grid-cols-3 rounded bg-red-500/[0.04] px-1 py-1 text-[10px] leading-4">
                  <span className="truncate font-mono text-muted-foreground">{row.label}</span>
                  <span className="truncate text-right font-mono text-red-400">{formatSignedPercent(row.change)}</span>
                  <span className="truncate text-right font-mono text-foreground">{formatUsd(row.volume)}</span>
                </div>
              ))}
            </div>

            <div className="my-1.5 text-center">
              <div className={`font-mono text-base font-black ${selectedIndex === 0 ? 'text-green-300' : 'text-red-400'}`}>
                {formatPriceAxis(selected.priceUsd)}
              </div>
              <div className="truncate text-[9px] text-muted-foreground">{selected.priceDisplay}</div>
            </div>

            <div className="space-y-1">
              {windowRows(left).map((row) => (
                <div key={`left-${row.label}`} className="grid grid-cols-3 rounded bg-green-500/[0.04] px-1 py-1 text-[10px] leading-4">
                  <span className="truncate font-mono text-muted-foreground">{row.label}</span>
                  <span className="truncate text-right font-mono text-green-400">{formatSignedPercent(row.change)}</span>
                  <span className="truncate text-right font-mono text-foreground">{formatUsd(row.volume)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="min-w-0 rounded-md bg-background/80 p-1.5">
            <div className="grid grid-cols-2 overflow-hidden rounded-sm bg-muted/40 p-0.5">
              <button
                onClick={() => onSelect(0)}
                className={`py-1.5 text-xs font-black transition ${selectedIndex === 0 ? 'bg-green-500 text-white' : 'text-muted-foreground'}`}
              >
                Buy
              </button>
              <button
                onClick={() => onSelect(1)}
                className={`py-1.5 text-xs font-black transition ${selectedIndex === 1 ? 'bg-red-500 text-white' : 'text-muted-foreground'}`}
              >
                Sell
              </button>
            </div>

            <button
              onClick={() => setOrderTypeOpen(true)}
              className="mt-1.5 flex w-full items-center justify-between rounded-sm bg-muted/40 px-2 py-1.5 text-[11px] font-bold text-foreground active:scale-[0.99]"
            >
              {orderType} <ChevronDown size={12} className="text-muted-foreground" />
            </button>

            <div className="mt-1.5 flex items-center rounded-sm bg-muted/40">
              <button onClick={() => adjustAmount('down')} className="px-2 text-muted-foreground active:scale-95">-</button>
              <input
                value={amount}
                onChange={(event) => onAmountChange(event.target.value.replace(/[^\d.]/g, ''))}
                className="min-w-0 flex-1 bg-transparent px-1 py-2 text-center font-mono text-sm font-black text-foreground outline-none"
                inputMode="decimal"
              />
              <button onClick={() => adjustAmount('up')} className="px-2 text-primary active:scale-95">+</button>
            </div>

            <div className="mt-1.5 grid grid-cols-4 gap-1 text-[9px] text-muted-foreground">
              {[25, 50, 75, 100].map((percent) => (
                <button key={percent} onClick={() => applyPercent(percent)} className="rounded-sm bg-muted/35 py-1 active:scale-95">%{percent}</button>
              ))}
            </div>

            <div className="mt-1.5 rounded-sm bg-muted/40 px-2 py-2 text-center font-mono text-sm font-black text-foreground">
              {liveTokenPrice}
            </div>

            <div className="mt-1 flex items-center justify-between text-[9px] text-muted-foreground">
              <span>Live quote</span>
              <button onClick={handleMax} className="font-bold text-primary active:scale-95">MAX</button>
            </div>

            <button
              onClick={() => setConfirmTradeOpen(true)}
              className={`mt-1.5 w-full rounded-sm py-2 text-sm font-black text-white active:scale-[0.99] ${
                selectedIndex === 0 ? 'bg-green-500 hover:bg-green-400' : 'bg-red-500 hover:bg-red-400'
              }`}
            >
              {selectedIndex === 0 ? 'Buy' : 'Sell'} {selected.tokenSymbol || selected.label.replace(/^\$/, '')}
            </button>
          </div>
        </div>
      </div>
      <Dialog open={orderTypeOpen} onOpenChange={setOrderTypeOpen}>
        <DialogContent className="bottom-2 top-auto w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] translate-y-0 rounded-2xl border border-border bg-card p-3 text-foreground shadow-2xl sm:top-[50%] sm:max-w-sm sm:translate-y-[-50%]">
          <DialogHeader className="text-left">
            <DialogTitle className="text-base">Order type</DialogTitle>
            <DialogDescription className="text-xs">Choose how this mobile trade ticket should behave.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {(['Limit', 'Market', 'Stop Limit'] as const).map((option) => (
              <button
                key={option}
                onClick={() => {
                  setOrderType(option);
                  setOrderTypeOpen(false);
                  toast({ title: `${option} selected`, description: 'Trade ticket updated.' });
                }}
                className={`rounded-xl border px-3 py-3 text-left text-sm font-bold active:scale-[0.99] ${
                  orderType === option ? 'border-primary bg-primary/15 text-primary' : 'border-border bg-background text-foreground'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmTradeOpen} onOpenChange={setConfirmTradeOpen}>
        <DialogContent className="bottom-2 top-auto w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] translate-y-0 rounded-2xl border border-border bg-card p-3 text-foreground shadow-2xl sm:top-[50%] sm:max-w-sm sm:translate-y-[-50%]">
          <DialogHeader className="text-left">
            <DialogTitle className="text-base">Prepare P2P stake</DialogTitle>
            <DialogDescription className="text-xs">
              BOTA will save this stake ticket to the current 5-minute battle round.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-border bg-background p-3 text-xs">
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Side</span>
              <span className={selectedIndex === 0 ? 'font-black text-green-400' : 'font-black text-red-400'}>{selectedIndex === 0 ? 'BUY' : 'SELL'} {selected.label}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Pair source</span>
              <span className="font-bold">Dexscreener</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Stake</span>
              <span className="font-mono font-bold">{amount || '0'} stake token</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-muted-foreground">Live price</span>
              <span className="font-mono font-bold">{liveTokenPrice}</span>
            </div>
          </div>
          <button
            onClick={() => {
              setConfirmTradeOpen(false);
              onStakeSide(selected, amount);
            }}
            className={`rounded-xl py-3 text-sm font-black text-white active:scale-[0.99] ${
              selectedIndex === 0 ? 'bg-green-500' : 'bg-red-500'
            }`}
          >
            Prepare P2P Stake
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}

function MobileBattlePanels({
  activePanel,
  onPanelChange,
  battle,
  left,
  right,
  pool,
  selectedSide,
  events,
  quickTradeSideIndex,
  quickTradeAmount,
  onJoinSide,
  onStakeSide,
  onQuickTradeSideChange,
  onQuickTradeAmountChange,
}: {
  activePanel: MobileBattlePanel;
  onPanelChange: (panel: MobileBattlePanel) => void;
  battle?: AgentBattleFeed['battles'][number] | null;
  left: AgentBattleSide;
  right: AgentBattleSide;
  pool?: AgentBattleP2PPool | null;
  selectedSide: AgentBattleSide;
  events: AgentBattleFeed['battles'][number]['events'];
  quickTradeSideIndex: 0 | 1;
  quickTradeAmount: string;
  onJoinSide: (side: AgentBattleSide) => void;
  onStakeSide: (side: AgentBattleSide, amount: string) => void;
  onQuickTradeSideChange: (index: 0 | 1) => void;
  onQuickTradeAmountChange: (value: string) => void;
}) {
  const tabs: Array<{ key: MobileBattlePanel; label: string }> = [
    { key: 'trade', label: 'Spot' },
    { key: 'stats', label: 'Stats' },
    { key: 'side', label: 'Side' },
    { key: 'feed', label: 'Feed' },
  ];

  const panel =
    activePanel === 'trade' ? (
      <MobileTradeDeskPanel
        left={left}
        right={right}
        selectedIndex={quickTradeSideIndex}
        amount={quickTradeAmount}
        onSelect={onQuickTradeSideChange}
        onAmountChange={onQuickTradeAmountChange}
        onStakeSide={onStakeSide}
      />
    ) : activePanel === 'stats' ? (
      <BattleStatsPanel left={left} right={right} battle={battle} pool={pool} />
    ) : activePanel === 'side' ? (
      <ChooseSidePanel left={left} right={right} selectedSide={selectedSide} onJoin={onJoinSide} />
    ) : (
      <BattleFeedPanel events={events} left={left} right={right} />
    );

  return (
    <div className="border-b border-border bg-background p-1 xl:hidden">
      <div className="grid grid-cols-4 rounded-sm border border-border bg-[#111820] p-0.5">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onPanelChange(tab.key)}
            className={`rounded-sm px-2 py-1.5 text-[10px] font-black transition ${
              activePanel === tab.key
                ? 'bg-[#202838] text-white'
                : 'text-muted-foreground hover:bg-[#18212b] hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="mt-0.5">
        {panel}
      </div>
    </div>
  );
}

function MobileBattleHeader({
  battle,
  left,
  right,
  spectators,
  soundEnabled,
  onBack,
  onSoundToggle,
}: {
  battle: AgentBattleFeed['battles'][number];
  left: AgentBattleSide;
  right: AgentBattleSide;
  spectators: number;
  soundEnabled: boolean;
  onBack?: () => void;
  onSoundToggle: () => void;
}) {
  const { toast } = useToast();
  const marketCap = battleMarketCap(left, right);
  const arenaShare = shareBotaArenaBattle(
    battle.id,
    `${left.agentName} vs ${right.agentName}`,
    `Watch ${left.agentName} and ${right.agentName} fight live in the BOTA Arena.`,
  );
  const { isExpired } = useBattleClock({
    startsAt: battle.startsAt,
    endsAt: battle.endsAt,
    fallbackSeconds: battle.timeRemainingSeconds,
  });

  return (
    <div className="shrink-0 border-b border-border bg-background/95 px-2.5 py-1.5 text-foreground backdrop-blur-xl">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={onBack}
          className="grid h-7 w-7 place-items-center rounded-full text-foreground transition hover:bg-muted active:scale-95"
          aria-label="Back to markets"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 text-center">
          <div className="flex max-w-[58vw] items-center justify-center gap-1.5">
            <span className="truncate text-sm font-black uppercase tracking-wide text-foreground">
              {battleSymbol(left)} VS {battleSymbol(right)}
            </span>
            {marketCap > 0 && (
              <span className="shrink-0 rounded-md border border-border bg-muted px-1 py-px font-mono text-[8px] font-black uppercase leading-none text-muted-foreground">
                MC {formatUsd(marketCap)}
              </span>
            )}
          </div>
          <div className={`mt-[-2px] flex items-center justify-center gap-1 text-[8px] font-black uppercase leading-none ${isExpired ? 'text-muted-foreground' : 'text-green-400'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${isExpired ? 'bg-slate-400 shadow-[0_0_8px_rgba(148,163,184,.65)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,.85)]'}`} />
            {isExpired ? 'Expired Arena' : 'Live Arena'}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <GameSoundToggle enabled={soundEnabled} onToggle={onSoundToggle} />
          <button
            onClick={() => {
              navigator.clipboard?.writeText(arenaShare.shareUrl).catch(() => undefined);
              toast({ title: 'Arena share card copied', description: 'Live match social card link is ready.' });
            }}
            className="grid h-7 w-7 place-items-center rounded-full text-foreground transition hover:bg-muted active:scale-95"
            aria-label="Share battle"
          >
            <Share2 size={17} />
          </button>
          <button
            onClick={() => toast({ title: 'Battle watched', description: `${formatCompactNumber(spectators)} degens are already watching.` })}
            className="grid h-7 w-7 place-items-center rounded-full text-foreground transition hover:bg-muted active:scale-95"
            aria-label="Watch battle"
          >
            <Star size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}

function MobileScoreStrip({ battle, left, right }: { battle: AgentBattleFeed['battles'][number]; left: AgentBattleSide; right: AgentBattleSide }) {
  const showMarketStats = hasRealMarketStats(left) && hasRealMarketStats(right);
  const { timeRemainingSeconds } = useBattleClock({
    startsAt: battle.startsAt,
    endsAt: battle.endsAt,
    fallbackSeconds: battle.timeRemainingSeconds,
  });

  return (
    <div className="mx-2 mt-0.5 shrink-0 overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm">
      <div className="grid grid-cols-[1fr_3.45rem_1fr] items-center gap-1 px-2 py-1">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <span className="font-mono text-xl font-black leading-none text-green-400">{left.confidence}%</span>
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-gradient-to-r from-green-600 to-lime-300 shadow-[0_0_14px_rgba(132,255,78,.65)]" style={{ width: `${left.confidence}%` }} />
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-primary/35 bg-muted px-1 py-px text-center font-mono text-base font-black leading-tight text-foreground">
          {formatDuration(timeRemainingSeconds)}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-gradient-to-r from-red-500 to-red-400 shadow-[0_0_14px_rgba(239,68,68,.55)]" style={{ width: `${right.confidence}%` }} />
            </div>
            <span className="font-mono text-xl font-black leading-none text-red-400">{right.confidence}%</span>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 border-t border-border bg-muted/35 px-2 py-0.5 text-[8px] font-black uppercase leading-none">
        <div className="truncate text-foreground/90">
          {showMarketStats ? (
            <>
              {formatUsd(buyPressureUsd(left, 'm5'))} <span className="text-green-400">5M Buy Pressure</span>
            </>
          ) : (
            <>
              {formatArenaBantCredits(left)} <span className="text-green-400">BantCredit</span>
            </>
          )}
        </div>
        <div className="truncate text-right text-foreground/90">
          {showMarketStats ? (
            <>
              {formatUsd(buyPressureUsd(right, 'm5'))} <span className="text-red-400">5M Buy Pressure</span>
            </>
          ) : (
            <>
              {formatArenaBantCredits(right)} <span className="text-red-400">BantCredit</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MobileArenaStage({ battle, left, right }: { battle: AgentBattleFeed['battles'][number]; left: AgentBattleSide; right: AgentBattleSide }) {
  const showMarketStats = hasRealMarketStats(left) && hasRealMarketStats(right);
  const { isExpired } = useBattleClock({
    startsAt: battle.startsAt,
    endsAt: battle.endsAt,
    fallbackSeconds: battle.timeRemainingSeconds,
  });
  const crowd = ['🐸', '🐶', '🐱', '🐺', '🦊', '🐻', '🐼', '🐵', '🐹', '🐸', '🐶', '🐱'];

  return (
    <div className="mx-2 mt-1 shrink-0 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="relative h-[29vh] min-h-[12rem] max-h-[14.25rem] overflow-hidden bg-[radial-gradient(circle_at_50%_38%,#62c4ff_0%,#247ec7_36%,#0b3159_70%,#04101d_100%)]">
        <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-1.5 p-2">
          <div className="rounded-xl border border-border bg-background/85 px-2 py-1 text-[9px] font-black uppercase text-foreground shadow-sm backdrop-blur-md">
            <span className={`mr-1 inline-block h-2 w-2 rounded-full ${isExpired ? 'bg-slate-400' : 'bg-red-500'}`} /> {isExpired ? 'Expired Arena' : 'Live Arena'}
          </div>
          <div className="rounded-xl border border-border bg-background/85 px-2 py-1 text-[9px] font-bold text-foreground shadow-sm backdrop-blur-md">
            <Eye size={11} className="mr-1 inline inline-block" /> {formatCompactNumber(battle.spectators)}
          </div>
          <div className="rounded-xl border border-border bg-background/85 px-2 py-1 text-[9px] font-black uppercase text-foreground shadow-sm backdrop-blur-md">
            {showMarketStats ? (
              <>Speed <span className="text-green-300">{battleSpeedMultiplier(left, right)}</span></>
            ) : (
              <>Arena <span className="text-green-300">Sim</span></>
            )}
          </div>
        </div>

        <div className="absolute left-[18%] top-[2.65rem] z-20 rounded-2xl border border-border bg-background/92 px-2 py-1.5 text-center text-[9px] font-black uppercase leading-tight text-foreground shadow-xl">
          {arenaCallout(left, right)}<br /><span className="text-green-400">{showMarketStats ? formatSignedPercent(left.priceChangeM5) : `${left.confidence}%`}</span>
          <span className="absolute -bottom-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-b border-r border-border bg-background/90" />
        </div>
        <div className="absolute right-[12%] top-[2.65rem] z-20 rounded-2xl border border-border bg-background/92 px-2 py-1.5 text-center text-[9px] font-black uppercase leading-tight text-foreground shadow-xl">
          {arenaCallout(right, left)}<br /><span className="text-red-400">{showMarketStats ? formatSignedPercent(right.priceChangeM5) : `${right.confidence}%`}</span>
          <span className="absolute -bottom-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-b border-r border-border bg-background/90" />
        </div>
        <div className="hidden">
          Comeback<br />incoming ☠️
          <span className="absolute -bottom-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-b border-r border-border bg-background/90" />
        </div>

        <div className="absolute inset-x-0 top-[5.5rem] z-10 flex justify-center gap-1 opacity-90">
          {Array.from({ length: 16 }).map((_, index) => (
            <span
              key={index}
              className={`h-3.5 w-3.5 rounded-full border border-white/20 ${index % 3 === 0 ? 'bg-green-300/85' : index % 3 === 1 ? 'bg-red-300/75' : 'bg-white/75'} shadow`}
            />
          ))}
        </div>

        <div className="absolute inset-x-[-13%] bottom-[-38%] h-[9.3rem] rounded-[50%] border-[8px] border-amber-800/25 bg-[radial-gradient(circle,#d9b56f_0%,#b98a45_44%,#68401f_78%)] shadow-[0_-16px_35px_rgba(0,0,0,.35)_inset]" />
        <div className="absolute bottom-5 left-[12%] z-20 text-center">
          <div className="grid h-[4.6rem] w-[4.6rem] place-items-center overflow-hidden rounded-3xl border border-green-400/45 bg-black/35 ring-2 ring-green-400/45 drop-shadow-[0_12px_18px_rgba(0,0,0,.55)]">
            <BattleTokenMark side={left} className="h-[88%] w-[88%] rounded-2xl object-cover" emojiClassName="text-5xl" />
          </div>
          <div className="mt-[-.35rem] max-w-[5.5rem] truncate rounded-xl border border-border bg-background/90 px-1.5 py-0.5 text-[8px] font-black uppercase text-foreground shadow">{battleSymbol(left)}</div>
        </div>
        <div className="absolute bottom-5 right-[10%] z-20 text-center">
          <div className="grid h-[4.6rem] w-[4.6rem] place-items-center overflow-hidden rounded-3xl border border-red-400/45 bg-black/35 ring-2 ring-red-400/45 drop-shadow-[0_12px_18px_rgba(0,0,0,.55)]">
            <BattleTokenMark side={right} className="h-[88%] w-[88%] rounded-2xl object-cover" emojiClassName="text-5xl" />
          </div>
          <div className="mt-[-.35rem] max-w-[5.5rem] truncate rounded-xl border border-border bg-background/90 px-1.5 py-0.5 text-[8px] font-black uppercase text-foreground shadow">{battleSymbol(right)}</div>
        </div>
      </div>
      <MobileArenaMetricsRibbon left={left} right={right} />
    </div>
  );
}

function MobileArenaMetricsRibbon({ left, right }: { left: AgentBattleSide; right: AgentBattleSide }) {
  const showMarketStats = hasRealMarketStats(left) && hasRealMarketStats(right);

  if (!showMarketStats) {
    return (
      <div className="grid grid-cols-4 divide-x divide-white/10 bg-black/75 px-1.5 py-1.5 text-center backdrop-blur">
        <div className="px-1">
          <div className="text-[8px] font-black uppercase text-white">Win Chance</div>
          <div className="mt-0.5 grid grid-cols-2 gap-1 text-[9px]">
            <span className="truncate font-black text-green-400">{battleSymbol(left)}</span>
            <span className="truncate font-black text-red-400">{battleSymbol(right)}</span>
            <span className="font-mono text-green-400">{left.confidence}%</span>
            <span className="font-mono text-red-400">{right.confidence}%</span>
          </div>
        </div>
        <div className="px-1">
          <div className="text-[8px] font-black uppercase text-white">Score</div>
          <div className="mt-0.5 space-y-0.5 text-[9px]">
            <div className="flex justify-between gap-1"><span className="truncate text-green-400">{battleSymbol(left)}</span><span className="font-mono text-white">{formatArenaScore(left)}</span></div>
            <div className="flex justify-between gap-1"><span className="truncate text-red-400">{battleSymbol(right)}</span><span className="font-mono text-white">{formatArenaScore(right)}</span></div>
          </div>
        </div>
        <div className="px-1">
          <div className="text-[8px] font-black uppercase text-white">BantCredit</div>
          <div className="mt-0.5 space-y-0.5 text-[9px]">
            <div className="flex justify-between gap-1"><span className="truncate text-green-400">{battleSymbol(left)}</span><span className="font-mono text-white">{formatArenaBantCredits(left)}</span></div>
            <div className="flex justify-between gap-1"><span className="truncate text-red-400">{battleSymbol(right)}</span><span className="font-mono text-white">{formatArenaBantCredits(right)}</span></div>
          </div>
        </div>
        <div className="px-1">
          <div className="text-[8px] font-black uppercase text-white">Rank</div>
          <div className="mt-0.5 space-y-0.5 text-[9px]">
            <div className="flex justify-between gap-1"><span className="truncate text-green-400">{battleSymbol(left)}</span><span className="font-mono text-white">{formatArenaRank(left)}</span></div>
            <div className="flex justify-between gap-1"><span className="truncate text-red-400">{battleSymbol(right)}</span><span className="font-mono text-white">{formatArenaRank(right)}</span></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 divide-x divide-white/10 bg-black/75 px-1.5 py-1.5 text-center backdrop-blur">
      <div className="px-1">
        <div className="text-[8px] font-black uppercase text-white">5M Change</div>
        <div className="mt-0.5 grid grid-cols-2 gap-1 text-[9px]">
          <span className="truncate font-black text-green-400">{battleSymbol(left)}</span>
          <span className="truncate font-black text-red-400">{battleSymbol(right)}</span>
          <span className="font-mono text-green-400">{formatSignedPercent(left.priceChangeM5)}</span>
          <span className="font-mono text-red-400">{formatSignedPercent(right.priceChangeM5)}</span>
        </div>
      </div>
      <div className="px-1">
        <div className="text-[8px] font-black uppercase text-white">Pressure</div>
        <div className="mt-0.5 space-y-0.5 text-[9px]">
          <div className="flex items-center gap-1">
            <span className="w-10 truncate text-green-400">{battleSymbol(left)}</span>
            <span className="h-1.5 flex-1 rounded-full bg-white/10"><span className="block h-full rounded-full bg-green-400" style={{ width: `${left.confidence}%` }} /></span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-10 truncate text-red-400">{battleSymbol(right)}</span>
            <span className="h-1.5 flex-1 rounded-full bg-white/10"><span className="block h-full rounded-full bg-red-400" style={{ width: `${right.confidence}%` }} /></span>
          </div>
        </div>
      </div>
      <div className="px-1">
        <div className="text-[8px] font-black uppercase text-white">5M Vol</div>
        <div className="mt-0.5 space-y-0.5 text-[9px]">
          <div className="flex justify-between gap-1"><span className="truncate text-green-400">{battleSymbol(left)}</span><span className="font-mono text-white">{formatUsd(left.volumeM5)}</span></div>
          <div className="flex justify-between gap-1"><span className="truncate text-red-400">{battleSymbol(right)}</span><span className="font-mono text-white">{formatUsd(right.volumeM5)}</span></div>
        </div>
      </div>
      <div className="px-1">
        <div className="text-[8px] font-black uppercase text-white">5M Trades</div>
        <div className="mt-0.5 space-y-0.5 text-[9px]">
          <div className="flex justify-between gap-1"><span className="truncate text-green-400">{battleSymbol(left)}</span><span className="font-mono text-white">{formatCompactNumber(activeTrades(left, 'm5'))}</span></div>
          <div className="flex justify-between gap-1"><span className="truncate text-red-400">{battleSymbol(right)}</span><span className="font-mono text-white">{formatCompactNumber(activeTrades(right, 'm5'))}</span></div>
        </div>
      </div>
    </div>
  );
}

function MobileLiveRail({ battle, left, right }: { battle: AgentBattleFeed['battles'][number]; left: AgentBattleSide; right: AgentBattleSide }) {
  const showMarketStats = hasRealMarketStats(left) && hasRealMarketStats(right);

  return (
    <div className="mx-2 mt-2 grid grid-cols-4 overflow-hidden rounded-2xl border border-white/10 bg-[#07111d] text-center">
      <div className="flex items-center justify-center gap-1 border-r border-white/10 px-2 py-2 text-[11px] font-black uppercase text-white">
        <span className="h-2.5 w-2.5 rounded-full bg-red-500 shadow-[0_0_12px_rgba(239,68,68,.85)]" /> Live
      </div>
      {showMarketStats ? (
        <>
          <div className="border-r border-white/10 px-2 py-1.5">
            <div className="text-[9px] font-black uppercase text-muted-foreground">Buy Pressure</div>
            <div className="font-mono text-base font-black text-green-400">{formatUsd(buyPressureUsd(left, 'm5'))}</div>
          </div>
          <div className="border-r border-white/10 px-2 py-1.5">
            <div className="text-[9px] font-black uppercase text-muted-foreground">Sell Pressure</div>
            <div className="font-mono text-base font-black text-red-400">{formatUsd(sellPressureUsd(right, 'm5'))}</div>
          </div>
          <div className="px-2 py-1.5">
            <div className="text-[9px] font-black uppercase text-muted-foreground">Trades</div>
            <div className="font-mono text-base font-black text-white">{formatCompactNumber(activeTrades(left, 'm5') + activeTrades(right, 'm5'))}</div>
          </div>
        </>
      ) : (
        <>
          <div className="border-r border-white/10 px-2 py-1.5">
            <div className="text-[9px] font-black uppercase text-muted-foreground">BantCredit</div>
            <div className="font-mono text-base font-black text-yellow-300">{formatCompactNumber(battle.bantCreditsEarned || battle.spectatorBantCredits || 0)}</div>
          </div>
          <div className="px-2 py-1.5">
            <div className="text-[9px] font-black uppercase text-muted-foreground">Lead</div>
            <div className="font-mono text-base font-black text-white">{Math.abs(left.confidence - right.confidence)}%</div>
          </div>
        </>
      )}
    </div>
  );
}

function MobileDualLineChart({ left, right }: { left: AgentBattleSide; right: AgentBattleSide }) {
  const windows: MarketWindow[] = ['m5', 'h1', 'h24'];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs font-black uppercase">
        <span className="truncate text-green-400">{battleSymbol(left)}</span>
        <span className="text-muted-foreground">Dexscreener windows</span>
        <span className="truncate text-red-400">{battleSymbol(right)}</span>
      </div>
      {windows.map((window) => {
        const leftStats = windowStats(left, window);
        const rightStats = windowStats(right, window);
        return (
          <div key={window} className="rounded-xl border border-border bg-muted/25 p-2">
            <div className="mb-1 flex items-center justify-between text-[10px] font-black uppercase text-muted-foreground">
              <span>{leftStats.label}</span>
              <span>Price Move</span>
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <div>
                <div className="text-right font-mono text-xs font-black text-green-400">{formatSignedPercent(leftStats.change)}</div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="ml-auto h-full rounded-full bg-green-400" style={{ width: `${metricBarWidth(leftStats.change)}%` }} />
                </div>
              </div>
              <div className="font-mono text-[10px] font-black text-muted-foreground">{leftStats.label}</div>
              <div>
                <div className="font-mono text-xs font-black text-red-400">{formatSignedPercent(rightStats.change)}</div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-red-400" style={{ width: `${metricBarWidth(rightStats.change)}%` }} />
                </div>
              </div>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-2 text-[10px] text-muted-foreground">
              <span className="truncate">Vol {formatUsd(leftStats.volume)} · {formatCompactNumber(leftStats.buys + leftStats.sells)} trades</span>
              <span className="truncate text-right">Vol {formatUsd(rightStats.volume)} · {formatCompactNumber(rightStats.buys + rightStats.sells)} trades</span>
            </div>
          </div>
        );
      })}
      <div className="rounded-xl border border-primary/20 bg-primary/10 p-2 text-[10px] font-bold text-primary">
        This is live Dexscreener market data, not a drawn fake chart.
      </div>
    </div>
  );
}

function MobileMetricCard({ label, value, tone = 'text-foreground', emoji }: { label: string; value: string; tone?: string; emoji?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-muted/35 p-3">
      <div className="text-[12px] font-black uppercase text-muted-foreground">{label}</div>
      <div className={`mt-1 flex items-end gap-2 font-mono text-2xl font-black ${tone}`}>
        {emoji && <span className="text-xl">{emoji}</span>}
        {value}
      </div>
    </div>
  );
}

function MobileDetailsDeck({
  activeTab,
  onTabChange,
  left,
  right,
  events,
  onJoin,
}: {
  activeTab: MobileDetailTab;
  onTabChange: (tab: MobileDetailTab) => void;
  left: AgentBattleSide;
  right: AgentBattleSide;
  events: AgentBattleFeed['battles'][number]['events'];
  onJoin: (side: AgentBattleSide) => void;
}) {
  const showMarketStats = hasRealMarketStats(left) && hasRealMarketStats(right);
  const tabs: Array<{ id: MobileDetailTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'trades', label: 'Trades' },
    { id: 'holders', label: 'Holders' },
  ];

  return (
    <div className="mx-2 mt-2 overflow-hidden rounded-3xl border border-white/10 bg-[#050c16]">
      <div className="grid grid-cols-4 border-b border-white/10">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`relative py-3 text-xs font-black uppercase tracking-wide ${activeTab === tab.id ? 'text-white' : 'text-muted-foreground'}`}
          >
            {tab.label}
            {activeTab === tab.id && <span className="absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-green-400 shadow-[0_0_12px_rgba(116,240,68,.85)]" />}
          </button>
        ))}
      </div>

      <div className="p-3">
        {activeTab === 'overview' && (
          <div>
            <div className="text-base font-black uppercase text-white">{showMarketStats ? 'Live Market Windows' : 'Arena Fighter Stats'}</div>
            {showMarketStats ? (
              <>
                <div className="mt-2">
                  <MobileDualLineChart left={left} right={right} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <MobileMetricCard label={`${battleSymbol(left)} 5M Buy Pressure`} value={formatUsd(buyPressureUsd(left, 'm5'))} tone="text-green-400" />
                  <MobileMetricCard label={`${battleSymbol(right)} 5M Buy Pressure`} value={formatUsd(buyPressureUsd(right, 'm5'))} tone="text-red-400" />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <MobileMetricCard label={`${battleSymbol(left)} 5M Buys`} value={formatCompactNumber(left.buysM5)} />
                  <MobileMetricCard label={`${battleSymbol(right)} 5M Sells`} value={formatCompactNumber(right.sellsM5)} />
                </div>
                <div className="mt-2">
                  <MobileMetricCard label="5M Active Trades" value={formatCompactNumber(activeTrades(left, 'm5') + activeTrades(right, 'm5'))} tone="text-green-400" />
                </div>
              </>
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <MobileMetricCard label={`${battleSymbol(left)} Win Chance`} value={`${left.confidence}%`} tone="text-green-400" />
                <MobileMetricCard label={`${battleSymbol(right)} Win Chance`} value={`${right.confidence}%`} tone="text-red-400" />
                <MobileMetricCard label={`${battleSymbol(left)} Score`} value={formatArenaScore(left)} />
                <MobileMetricCard label={`${battleSymbol(right)} Score`} value={formatArenaScore(right)} />
                <MobileMetricCard label={`${battleSymbol(left)} BantCredit`} value={formatArenaBantCredits(left)} tone="text-yellow-300" />
                <MobileMetricCard label={`${battleSymbol(right)} BantCredit`} value={formatArenaBantCredits(right)} tone="text-yellow-300" />
              </div>
            )}
          </div>
        )}

        {activeTab === 'trades' && <MobileRecentEvents events={events} />}

        {activeTab === 'holders' && (
          showMarketStats ? (
            <div className="grid grid-cols-2 gap-2">
              <MobileMetricCard label={`${battleSymbol(left)} Buyers`} value={formatCompactNumber(left.buysH24)} tone="text-green-400" />
              <MobileMetricCard label={`${battleSymbol(right)} Buyers`} value={formatCompactNumber(right.buysH24)} tone="text-red-400" />
              <MobileMetricCard label={`${battleSymbol(left)} Sellers`} value={formatCompactNumber(left.sellsH24)} />
              <MobileMetricCard label={`${battleSymbol(right)} Sellers`} value={formatCompactNumber(right.sellsH24)} />
              <div className="col-span-2">
                <MobileMetricCard label="Combined Liquidity" value={formatUsd((left.liquidityUsd || 0) + (right.liquidityUsd || 0))} tone="text-primary" />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <MobileMetricCard label={`${battleSymbol(left)} Rank`} value={formatArenaRank(left)} tone="text-green-400" />
              <MobileMetricCard label={`${battleSymbol(right)} Rank`} value={formatArenaRank(right)} tone="text-red-400" />
              <MobileMetricCard label={`${battleSymbol(left)} Status`} value={formatArenaStatus(left)} />
              <MobileMetricCard label={`${battleSymbol(right)} Status`} value={formatArenaStatus(right)} />
            </div>
          )
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button onClick={() => onJoin(left)} className="flex items-center justify-center gap-2 rounded-2xl border border-green-400/30 bg-green-600/35 px-3 py-3 text-left shadow-[0_0_18px_rgba(34,197,94,.2)] active:scale-[0.99]">
            <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full text-3xl">
              <BattleTokenMark side={left} className="h-full w-full rounded-full object-cover" />
            </span>
            <span>
              <span className="block text-sm font-black uppercase text-white">Join {battleSymbol(left)} Army</span>
              <span className="block text-xs text-white/70">Predict {battleSymbol(left)}</span>
            </span>
          </button>
          <button onClick={() => onJoin(right)} className="flex items-center justify-center gap-2 rounded-2xl border border-red-400/30 bg-red-600/35 px-3 py-3 text-left shadow-[0_0_18px_rgba(239,68,68,.2)] active:scale-[0.99]">
            <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full text-3xl">
              <BattleTokenMark side={right} className="h-full w-full rounded-full object-cover" />
            </span>
            <span>
              <span className="block text-sm font-black uppercase text-white">Join {battleSymbol(right)} Army</span>
              <span className="block text-xs text-white/70">Predict {battleSymbol(right)}</span>
            </span>
          </button>
        </div>
        <button className="mt-2 flex w-full items-center justify-center gap-3 rounded-2xl border border-primary/40 bg-primary/70 px-4 py-3 text-center text-white shadow-[0_0_22px_rgba(124,58,237,.35)] active:scale-[0.99]">
          <Eye size={26} />
          <span>
            <span className="block text-base font-black uppercase">Spectate Battle</span>
            <span className="block text-sm text-white/75">Watch & Earn XP</span>
          </span>
        </button>
      </div>
    </div>
  );
}

function MobileRecentEvents({ events }: { events: AgentBattleFeed['battles'][number]['events'] }) {
  const visible = events.slice(0, 5);

  return (
    <div className="rounded-2xl border border-border bg-muted/25 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-base font-black uppercase text-foreground">Recent Events</div>
        <button className="text-xs font-bold text-muted-foreground">View all ›</button>
      </div>
      <div className="space-y-2">
        {visible.map((item) => (
          <div key={item.id} className="grid grid-cols-[1.8rem_1fr_auto] items-center gap-2 text-sm">
            <span className="text-xl">{item.severity === 'danger' ? '🦈' : item.severity === 'hot' ? '🔥' : item.type === 'system' ? '⚔️' : '🐋'}</span>
            <span className="min-w-0 truncate text-foreground">
              <span className={item.severity === 'danger' ? 'text-red-400' : item.severity === 'hot' ? 'text-green-400' : 'text-primary'}>{item.metricValue || item.agentName}</span>
              {' '}{item.message}
            </span>
            <span className="text-xs text-muted-foreground">{formatAgo(item.time)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MobileQuickTradeTab({
  left,
  right,
  selectedIndex,
  amount,
  onSelect,
  onAmountChange,
  onStakeSide,
}: {
  left: AgentBattleSide;
  right: AgentBattleSide;
  selectedIndex: 0 | 1;
  amount: string;
  onSelect: (index: 0 | 1) => void;
  onAmountChange: (value: string) => void;
  onStakeSide: (side: AgentBattleSide, amount: string) => void;
}) {
  const selected = selectedIndex === 0 ? left : right;

  const submitQuickTrade = () => {
    onStakeSide(selected, amount);
  };

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-muted/25 p-2">
      <div className="flex items-start justify-between gap-1.5">
        <div>
          <div className="text-[10px] font-black uppercase tracking-wide text-foreground">QUICK TRADE</div>
          <div className="mt-px text-[8px] font-bold text-muted-foreground">Support your side</div>
        </div>
        <button className="rounded-lg p-0.5 text-muted-foreground hover:bg-muted">
          <Settings size={12} />
        </button>
      </div>

      <div className="mt-1.5 grid grid-cols-2 gap-1">
        <button
          onClick={() => onSelect(0)}
          className={`truncate rounded-lg px-2 py-1.5 text-[9px] font-black transition active:scale-[0.99] ${
            selectedIndex === 0
              ? 'bg-green-600 text-white shadow-sm'
              : 'border border-green-500/25 bg-green-500/10 text-green-500 hover:bg-green-500/15'
          }`}
        >
          Buy {left.label}
        </button>
        <button
          onClick={() => onSelect(1)}
          className={`truncate rounded-lg px-2 py-1.5 text-[9px] font-black transition active:scale-[0.99] ${
            selectedIndex === 1
              ? 'bg-red-600 text-white shadow-sm'
              : 'border border-red-500/25 bg-red-500/10 text-red-500 hover:bg-red-500/15'
          }`}
        >
          Buy {right.label}
        </button>
      </div>

      <label className="mt-1.5 block text-[8px] font-bold uppercase text-muted-foreground">Stake amount</label>
      <div className="mt-0.5 flex items-center rounded-lg border border-border bg-input">
        <input
          value={amount}
          onChange={(event) => onAmountChange(event.target.value.replace(/[^\d.]/g, ''))}
          className="min-w-0 flex-1 bg-transparent px-2 py-1.5 font-mono text-xs font-black text-foreground outline-none"
          inputMode="decimal"
        />
        <button
          onClick={() => onAmountChange('100')}
          className="m-0.5 rounded-md bg-primary px-2 py-1 text-[9px] font-black text-primary-foreground active:scale-[0.98]"
        >
          MAX
        </button>
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] leading-none">
        <span className="text-muted-foreground">Live token price</span>
        <span className="truncate font-mono font-bold text-foreground">{formatLiveTokenPrice(selected)}</span>
      </div>

      <button
        onClick={submitQuickTrade}
        className={`mt-2 w-full rounded-lg py-1.5 text-xs font-black text-white shadow-sm transition active:scale-[0.99] ${
          selectedIndex === 0 ? 'bg-green-600 hover:bg-green-500' : 'bg-red-600 hover:bg-red-500'
        }`}
      >
        Place P2P Stake
      </button>

      <div className="mt-1 text-[9px] leading-none text-muted-foreground">Escrow lock required</div>
    </div>
  );
}

function MobileChooseSideTab({
  left,
  right,
  selectedSide,
  onJoin,
}: {
  left: AgentBattleSide;
  right: AgentBattleSide;
  selectedSide: AgentBattleSide;
  onJoin: (side: AgentBattleSide) => void;
}) {
  const selectedIsLeft = selectedSide.id === left.id;

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-muted/25 p-2">
      <div className="mb-1 rounded-lg border border-primary/20 bg-primary/10 px-2 py-1 text-center text-[9px] font-black uppercase leading-tight text-foreground whitespace-normal">
        {battleMarketTitle(left)}
      </div>
      <div className="text-center text-[9px] font-black uppercase tracking-[0.12em] text-foreground">CHOOSE YOUR SIDE</div>

      <div className="mx-auto mt-1 grid w-full max-w-[16rem] grid-cols-2 gap-2">
        <button
          onClick={() => onJoin(left)}
          className={`flex items-center gap-1 rounded-md border px-1 py-0.5 text-left transition active:scale-[0.99] ${
            selectedIsLeft
              ? 'border-green-400/70 bg-green-500/25 shadow-[inset_0_0_20px_rgba(34,197,94,.18)]'
              : 'border-green-500/25 bg-green-500/10 hover:bg-green-500/15'
          }`}
        >
          <span className="grid h-3.5 w-3.5 shrink-0 place-items-center overflow-hidden rounded-full text-[10px] leading-none">
            <BattleTokenMark side={left} className="h-full w-full rounded-full object-cover" />
          </span>
          <span className="min-w-0 flex items-center gap-1 truncate text-[8px] font-black uppercase leading-none">
            <span className="text-green-400">YES</span>
            <span className="truncate text-foreground">{battleSymbol(left)}</span>
            <span className="font-mono text-[7px] text-green-100">{left.confidence}%</span>
          </span>
        </button>
        <button
          onClick={() => onJoin(right)}
          className={`flex items-center gap-1 rounded-md border px-1 py-0.5 text-left transition active:scale-[0.99] ${
            selectedSide.id === right.id
              ? 'border-red-400/70 bg-red-500/25 shadow-[inset_0_0_20px_rgba(239,68,68,.18)]'
              : 'border-red-500/25 bg-red-500/10 hover:bg-red-500/15'
          }`}
        >
          <span className="grid h-3.5 w-3.5 shrink-0 place-items-center overflow-hidden rounded-full text-[10px] leading-none">
            <BattleTokenMark side={right} className="h-full w-full rounded-full object-cover" />
          </span>
          <span className="min-w-0 flex items-center gap-1 truncate text-[8px] font-black uppercase leading-none">
            <span className="text-red-400">NO</span>
            <span className="truncate text-foreground">{battleSymbol(right)}</span>
            <span className="font-mono text-[7px] text-red-100">{right.confidence}%</span>
          </span>
        </button>
      </div>

      <div className="mt-1 flex items-center justify-between gap-2 border-t border-border pt-1">
        <div className="min-w-0 truncate text-[9px] font-bold text-muted-foreground">
          Pick: <span className={selectedIsLeft ? 'text-green-400' : 'text-red-400'}>{selectedIsLeft ? 'YES' : 'NO'} · {battleSymbol(selectedSide)}</span>
          <span className="ml-1 text-primary">≈ {formatBxbt(estimatedPayout(selectedSide))}</span>
        </div>
        <button
          onClick={() => onJoin(selectedSide)}
          className="shrink-0 rounded-lg bg-primary px-1.5 py-0.5 text-[8px] font-black text-primary-foreground active:scale-[0.98]"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function MobileCompactActions({
  left,
  right,
  onJoin,
}: {
  left: AgentBattleSide;
  right: AgentBattleSide;
  onJoin: (side: AgentBattleSide) => void;
}) {
  return (
    <div className="mx-1.5 mt-1 grid grid-cols-[1fr_1fr_0.9fr] gap-1.5">
      <button
        onClick={() => onJoin(left)}
        className="flex items-center justify-center gap-1.5 rounded-xl border border-green-400/25 bg-green-600/30 px-2 py-2 text-left active:scale-[0.99]"
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full text-2xl">
          <BattleTokenMark side={left} className="h-full w-full rounded-full object-cover" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[11px] font-black uppercase text-white">Join {battleSymbol(left)}</span>
          <span className="block truncate text-[9px] text-white/65">Predict {battleSymbol(left)}</span>
        </span>
      </button>
      <button
        onClick={() => onJoin(right)}
        className="flex items-center justify-center gap-1.5 rounded-xl border border-red-400/25 bg-red-600/30 px-2 py-2 text-left active:scale-[0.99]"
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full text-2xl">
          <BattleTokenMark side={right} className="h-full w-full rounded-full object-cover" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[11px] font-black uppercase text-white">Join {battleSymbol(right)}</span>
          <span className="block truncate text-[9px] text-white/65">Predict {battleSymbol(right)}</span>
        </span>
      </button>
      <button className="flex items-center justify-center gap-1 rounded-xl border border-primary/30 bg-primary/60 px-2 py-2 text-[10px] font-black uppercase text-white active:scale-[0.99]">
        <Eye size={15} /> Spectate
      </button>
    </div>
  );
}

function MobileBattleMenuBar({ onNavigate }: { onNavigate?: (section: AppSection) => void }) {
  const items: Array<{ section: AppSection; label: string; icon: string }> = [
    { section: 'challenge', label: 'Challenge', icon: '📊' },
    { section: 'agents', label: 'Agents', icon: '🤖' },
    { section: 'battles', label: 'Arena', icon: '⚔️' },
    { section: 'chat', label: 'Chat', icon: '💬' },
    { section: 'import', label: 'Import', icon: '↓' },
  ];

  return (
    <div className="shrink-0 border-t border-white/10 bg-[#030912] px-1.5 py-1.5">
      <div className="grid grid-cols-5 overflow-hidden rounded-2xl border border-white/10 bg-[#07111d]">
        {items.map((item) => {
          const active = item.section === 'battles';
          return (
            <button
              key={item.section}
              onClick={() => onNavigate?.(item.section)}
              className={`flex flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[10px] font-black transition active:scale-[0.98] ${
                active
                  ? 'bg-primary/45 text-white shadow-[inset_0_0_18px_rgba(124,58,237,.35)]'
                  : 'text-muted-foreground hover:bg-white/5 hover:text-white'
              }`}
            >
              <span className="text-base leading-none">{item.icon}</span>
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MobileTopBettorsPanel({
  battle,
  left,
  right,
  pool,
  positions,
  currentRoundId,
}: {
  battle: AgentBattleFeed['battles'][number];
  left: AgentBattleSide;
  right: AgentBattleSide;
  pool?: AgentBattleP2PPool | null;
  positions: AgentBattleP2PHistoryPosition[];
  currentRoundId?: string | null;
}) {
  const battleId = pool?.battleId || battle.id;
  const sideRows = [left, right].map((side, index) => {
    const sidePool = pool?.sides.find((item) => item.sideId === side.id);
    return {
      side,
      sidePool,
      tone: index === 0 ? 'text-green-400' : 'text-red-400',
    };
  });
  const poolPositions = [
    ...positions,
    ...(pool?.userPosition ? [pool.userPosition as AgentBattleP2PHistoryPosition] : []),
  ];
  const currentPositions = Array.from(
    new Map(
      poolPositions
        .filter((position) => position.battleId === battleId)
        .filter((position) => !currentRoundId || position.roundId === currentRoundId)
        .map((position) => [position.id, position] as const),
    ).values(),
  )
    .sort((leftPosition, rightPosition) => rightPosition.stakeAmount - leftPosition.stakeAmount)
    .slice(0, 5);

  return (
    <div className="no-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="grid grid-cols-2 gap-1.5">
        {sideRows.map(({ side, sidePool, tone }) => (
          <div key={side.id} className="rounded-2xl border border-border bg-background/70 p-2">
            <div className={`truncate text-[10px] font-black uppercase ${tone}`}>
              {battleSymbol(side)}
            </div>
            <div className="mt-1 font-mono text-sm font-black text-foreground">
              {formatTokenAmount(sidePool?.totalStake || 0, pool?.stakeCurrency)}
            </div>
            <div className="mt-0.5 flex items-center justify-between gap-2 text-[9px] font-bold uppercase text-muted-foreground">
              <span>{formatCompactNumber(sidePool?.bettorCount || 0)} bettors</span>
              <span>{formatCompactNumber(sidePool?.sharePercent || side.confidence)}%</span>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-muted/25 p-2">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[10px] font-black uppercase tracking-wide text-foreground">Current Round</span>
          <span className="font-mono text-[9px] font-black uppercase text-muted-foreground">
            {pool?.status ? pool.status.replace(/_/g, ' ') : 'open'}
          </span>
        </div>
        {currentPositions.length > 0 ? (
          <div className="space-y-1.5">
            {currentPositions.map((position, index) => {
              const isLeft = position.sideId === left.id;
              return (
                <div
                  key={position.id}
                  className="grid grid-cols-[1.4rem_1fr_auto] items-center gap-1.5 rounded-xl bg-background/70 px-2 py-1.5 text-[11px]"
                >
                  <span className="font-mono font-black text-muted-foreground">#{index + 1}</span>
                  <div className="min-w-0">
                    <div className={`truncate font-black uppercase ${isLeft ? 'text-green-400' : 'text-red-400'}`}>
                      {position.sideSymbol || position.sideLabel || (isLeft ? battleSymbol(left) : battleSymbol(right))}
                    </div>
                    <div className="truncate text-[9px] text-muted-foreground">
                      {position.walletAddress ? shortAddress(position.walletAddress) : position.escrowStatus.replace(/_/g, ' ')}
                    </div>
                  </div>
                  <div className="text-right font-mono font-black text-foreground">
                    {formatTokenAmount(position.stakeAmount, position.stakeCurrency)}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl bg-background/70 px-2 py-3 text-center text-[11px] font-bold text-muted-foreground">
            No locked bettors in this round yet.
          </div>
        )}
      </div>
    </div>
  );
}

function MobileSocialPanel({
  activeTab,
  onTabChange,
  battle,
  left,
  right,
  pool,
  events,
  messages,
  trollboxItems,
  positions,
  currentRoundId,
  onchainConfig,
  isAuthenticated,
  authLoading,
  selectedSide,
  chatInput,
  isSendingChat,
  onJoinSide,
  onLogin,
  onChatInputChange,
  onSubmitChat,
}: {
  activeTab: MobileSocialTab;
  onTabChange: (tab: MobileSocialTab) => void;
  battle: AgentBattleFeed['battles'][number];
  left: AgentBattleSide;
  right: AgentBattleSide;
  pool?: AgentBattleP2PPool | null;
  events: AgentBattleFeed['battles'][number]['events'];
  messages: TrollboxMessage[];
  trollboxItems: DesktopTrollboxItem[];
  positions: AgentBattleP2PHistoryPosition[];
  currentRoundId?: string | null;
  onchainConfig?: OnchainRuntimeConfig | null;
  isAuthenticated: boolean;
  authLoading: boolean;
  selectedSide: AgentBattleSide;
  chatInput: string;
  isSendingChat: boolean;
  onJoinSide: (side: AgentBattleSide) => void;
  onLogin: () => void;
  onChatInputChange: (value: string) => void;
  onSubmitChat: (event: FormEvent) => void;
}) {
  const tabs: Array<{ id: MobileSocialTab; label: string }> = [
    { id: 'side', label: 'Predict' },
    { id: 'trollbox', label: 'Trollbox' },
    { id: 'stats', label: 'Stats' },
    { id: 'top', label: 'Top Bettors' },
  ];
  const displayMessages = messages.slice(-7);
  const displayTrollboxItems = trollboxItems.length > 0 ? trollboxItems.slice(-18) : [];
  const showMarketStats = hasRealMarketStats(left) && hasRealMarketStats(right);

  return (
    <div className="mx-2 mt-1 flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-sm">
      <div className="no-scrollbar flex shrink-0 overflow-x-auto border-b border-border bg-background/70 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`relative shrink-0 px-3 py-2 text-[9px] font-black uppercase tracking-wide transition hover:bg-muted/60 ${activeTab === tab.id ? 'text-foreground' : 'text-muted-foreground'}`}
          >
            {tab.label}
            {activeTab === tab.id && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-green-400 shadow-[0_0_10px_rgba(116,240,68,.85)]" />}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2">
        {activeTab === 'trollbox' && (
          <div className="no-scrollbar min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {displayTrollboxItems.length > 0 ? displayTrollboxItems.map((item) => (
              <div key={item.id} className="grid grid-cols-[1.8rem_1fr_auto] gap-2">
                {item.avatarUrl ? (
                  <img
                    src={item.avatarUrl}
                    alt={`${item.user} avatar`}
                    title={item.sourceLabel}
                    className="h-7 w-7 rounded-full border border-border bg-muted object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className={`grid h-7 w-7 place-items-center rounded-full text-[9px] font-black ${item.sourceClassName}`}>
                    {item.sourceLabel}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="truncate text-xs font-black text-foreground">{item.user}</div>
                  <div className="line-clamp-2 text-xs leading-tight text-muted-foreground">
                    {item.statusIcon && (
                      <span className="mr-1" title={item.statusLabel || undefined}>
                        {item.statusIcon}
                      </span>
                    )}
                    {item.message}
                  </div>
                  {item.meta && <div className="mt-0.5 truncate text-[10px] text-muted-foreground/70">{item.meta}</div>}
                </div>
                <div className="text-[10px] text-muted-foreground">{formatAgo(item.createdAt)}</div>
              </div>
            )) : displayMessages.length > 0 ? displayMessages.map((message) => (
              <div key={message.id} className="grid grid-cols-[1.8rem_1fr_auto] gap-2">
                <div className="grid h-7 w-7 place-items-center rounded-full bg-muted text-base">
                  {message.source === 'telegram' ? '✈️' : message.source === 'system' ? '🤖' : '🐸'}
                </div>
                <div className="min-w-0">
                  <div className={`truncate text-xs font-black ${message.source === 'system' ? 'text-primary' : message.source === 'telegram' ? 'text-sky-400' : 'text-green-400'}`}>
                    {message.user}
                  </div>
                  <div className="line-clamp-2 text-xs leading-tight text-foreground">{message.message}</div>
                </div>
                <div className="text-[10px] text-muted-foreground">{formatAgo(message.createdAt)}</div>
              </div>
            )) : (
              <div className="rounded-2xl border border-border bg-muted/35 p-3 text-center text-xs text-muted-foreground">
                TrollBox is quiet. Chat, Telegram, and Arena updates will appear here.
              </div>
            )}
          </div>
        )}

        {activeTab === 'events' && (
          <div className="no-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <MobileRecentEvents events={events} />
            <div className="rounded-2xl border border-border bg-muted/25 p-3">
              <div className="mb-2 text-xs font-black uppercase tracking-wide text-foreground">{showMarketStats ? 'Live Trades' : 'Arena Events'}</div>
              <div className="space-y-1.5">
                {events.slice(0, 5).map((item) => (
                  <div key={`trade-${item.id}`} className="flex items-center justify-between rounded-2xl border border-border bg-background/70 px-2.5 py-1.5 text-xs">
                    <span className="min-w-0 truncate text-foreground">{item.message}</span>
                    <span className={item.severity === 'danger' ? 'ml-2 shrink-0 font-mono text-red-400' : 'ml-2 shrink-0 font-mono text-green-400'}>
                      {item.metricValue || item.metricLabel || 'live'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'side' && (
          <MobileChooseSideTab
            left={left}
            right={right}
            selectedSide={selectedSide}
            onJoin={onJoinSide}
          />
        )}

        {activeTab === 'stats' && (
          <div className="no-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <BattleStatsPanel left={left} right={right} battle={battle} pool={pool} />
            {showMarketStats ? (
              <div className="grid grid-cols-2 gap-2">
                <MobileMetricCard label={`${battleSymbol(left)} 5M Move`} value={formatSignedPercent(left.priceChangeM5)} tone={left.priceChangeM5 >= 0 ? 'text-green-400' : 'text-red-400'} />
                <MobileMetricCard label={`${battleSymbol(right)} 5M Move`} value={formatSignedPercent(right.priceChangeM5)} tone={right.priceChangeM5 >= 0 ? 'text-green-400' : 'text-red-400'} />
                <MobileMetricCard label="5M Volume" value={formatUsd((left.volumeM5 || 0) + (right.volumeM5 || 0))} tone="text-primary" />
                <MobileMetricCard label="5M Active Trades" value={formatCompactNumber(activeTrades(left, 'm5') + activeTrades(right, 'm5'))} />
              </div>
            ) : null}
          </div>
        )}

        {activeTab === 'slips' && (
          <BattleSlipsPanel
            positions={positions}
            currentRoundId={currentRoundId}
            onchainConfig={onchainConfig}
            isAuthenticated={isAuthenticated}
            authLoading={authLoading}
            onLogin={onLogin}
            compact
          />
        )}

        {activeTab === 'top' && (
          <MobileTopBettorsPanel
            battle={battle}
            left={left}
            right={right}
            pool={pool}
            positions={positions}
            currentRoundId={currentRoundId}
          />
        )}

        {activeTab === 'trollbox' && (
          <form onSubmit={onSubmitChat} className="mt-2 flex shrink-0 items-center gap-1.5 rounded-2xl border border-border bg-input px-2.5 py-1.5">
            <input
              value={chatInput}
              onChange={(event) => onChatInputChange(event.target.value)}
              placeholder="Type a message..."
              className="min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            <button type="button" className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground active:scale-95">
              <Smile size={18} />
            </button>
            <button disabled={isSendingChat} className="grid h-7 w-7 place-items-center rounded-full bg-primary text-primary-foreground active:scale-95 disabled:opacity-50">
              <Send size={14} />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function MobileAgentBattleView({
  battle,
  left,
  right,
  battleModeEnabled,
  arenaPreview,
  watchReward,
  gameSoundEnabled,
  pool,
  trollboxMessages,
  trollboxItems,
  trollboxUserCount,
  positions,
  currentRoundId,
  onchainConfig,
  isAuthenticated,
  authLoading,
  quickTradeAmount,
  chatInput,
  isSendingChat,
  onStakeSide,
  onLogin,
  onChatInputChange,
  onSubmitChat,
  onNavigate,
  onArenaAdvance,
  onGameSoundToggle,
}: {
  battle: AgentBattleFeed['battles'][number];
  left: AgentBattleSide;
  right: AgentBattleSide;
  battleModeEnabled: boolean;
  arenaPreview: ArenaPreviewState;
  watchReward: BattleSpectatorRewardHudState;
  gameSoundEnabled: boolean;
  pool?: AgentBattleP2PPool | null;
  trollboxMessages: TrollboxMessage[];
  trollboxItems: DesktopTrollboxItem[];
  trollboxUserCount: number;
  positions: AgentBattleP2PHistoryPosition[];
  currentRoundId?: string | null;
  onchainConfig?: OnchainRuntimeConfig | null;
  isAuthenticated: boolean;
  authLoading: boolean;
  quickTradeAmount: string;
  chatInput: string;
  isSendingChat: boolean;
  onStakeSide: (side: AgentBattleSide, amount: string) => void;
  onLogin: () => void;
  onChatInputChange: (value: string) => void;
  onSubmitChat: (event: FormEvent) => void;
  onNavigate?: (section: AppSection) => void;
  onArenaAdvance?: (detail: { battleId?: string | null }) => void;
  onGameSoundToggle: () => void;
}) {
  const [socialTab, setSocialTab] = useState<MobileSocialTab>(() => battleModeEnabled ? 'trollbox' : 'side');
  const [joinSide, setJoinSide] = useState<AgentBattleSide | null>(null);
  const defaultSide = left.confidence >= right.confidence ? left : right;
  const [chosenSide, setChosenSide] = useState<AgentBattleSide | null>(defaultSide);
  const battleArenaLabel = resolveBattleArenaLabel(arenaPreview, battle);

  useEffect(() => {
    if (battleModeEnabled) {
      setSocialTab('trollbox');
    }
  }, [battleModeEnabled]);

  const openJoinSide = (side: AgentBattleSide) => {
    setChosenSide(side);
    setJoinSide(side);
  };

  const confirmJoin = () => {
    if (!joinSide) return;
    onStakeSide(joinSide, quickTradeAmount || '100');
    setJoinSide(null);
  };

  const socialPanel = (
    <MobileSocialPanel
      activeTab={socialTab}
      onTabChange={setSocialTab}
      battle={battle}
      left={left}
      right={right}
      pool={pool}
      events={battle.events}
      messages={trollboxMessages}
      trollboxItems={trollboxItems}
      positions={positions}
      currentRoundId={currentRoundId}
      onchainConfig={onchainConfig}
      isAuthenticated={isAuthenticated}
      authLoading={authLoading}
      selectedSide={chosenSide || defaultSide}
      chatInput={chatInput}
      isSendingChat={isSendingChat}
      onJoinSide={openJoinSide}
      onLogin={onLogin}
      onChatInputChange={onChatInputChange}
      onSubmitChat={onSubmitChat}
    />
  );

  return (
    <div className="lg:hidden flex-1 min-h-0 overflow-hidden bg-background text-foreground">
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <MobileBattleHeader
          battle={battle}
          left={left}
          right={right}
          spectators={battle.spectators}
          soundEnabled={gameSoundEnabled}
          onBack={() => onNavigate?.('challenge')}
          onSoundToggle={onGameSoundToggle}
        />
        {battleModeEnabled && (
          <>
            <FightingGameArenaEmbed
              compact
              battle={battle}
              battleMode={arenaPreview.mode}
              battleStatus={battleStatus}
              startsAtMs={arenaPreviewStartsAtMs}
              matchupLabel={arenaPreview.matchupLabel}
              arenaLabel={battleArenaLabel}
              watchReward={watchReward}
              soundEnabled={gameSoundEnabled}
              onArenaAdvance={onArenaAdvance}
            />
            <div className="min-h-0 flex-1 pb-1">
              {socialPanel}
            </div>
          </>
        )}
        {!battleModeEnabled && (
          <div className="min-h-0 flex-1">
            {socialPanel}
          </div>
        )}
      </div>

      <Dialog open={Boolean(joinSide)} onOpenChange={(open) => !open && setJoinSide(null)}>
        <DialogContent className="bottom-2 top-auto w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] translate-y-0 rounded-2xl border border-border/60 bg-card/95 p-3 text-card-foreground shadow-2xl backdrop-blur-xl sm:top-[50%] sm:max-w-sm sm:translate-y-[-50%]">
          <DialogHeader className="space-y-0.5 text-left">
            <DialogTitle className="text-sm font-black uppercase">{joinSide ? `Join ${battleArmyName(joinSide)}` : 'Join Army'}</DialogTitle>
            <DialogDescription className="text-[11px] leading-tight text-muted-foreground">
              Review the side and prepare a P2P battle ticket for this 5-minute round.
            </DialogDescription>
          </DialogHeader>
          {joinSide && (
            <div className="mt-2">
              <div className="flex items-center gap-2 rounded-xl bg-muted/35 px-2.5 py-2">
                <div className="grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-background/70 text-2xl">
                  <BattleTokenMark side={joinSide} className="h-full w-full rounded-full object-cover" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-xs font-black uppercase text-foreground">{battleArmyName(joinSide)}</div>
                  <div className="text-xs text-muted-foreground">{joinSide.priceDisplay} · {joinSide.change}</div>
                </div>
              </div>
              <button onClick={confirmJoin} className="mt-2 w-full rounded-xl bg-primary py-2 text-xs font-black text-primary-foreground shadow-sm active:scale-[0.99]">
                Prepare P2P Stake Ticket
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AgentBattleP2PStakeDialog({
  battle,
  side,
  amount,
  pool,
  escrowTokenSymbol,
  escrowChainId,
  contractEnabled,
  walletAddress,
  isAuthenticated,
  authLoading,
  isSubmitting,
  onAmountChange,
  onClose,
  onLogin,
  onSubmit,
}: {
  battle: AgentBattleFeed['battles'][number];
  side: AgentBattleSide | null;
  amount: string;
  pool?: AgentBattleP2PPool;
  escrowTokenSymbol: OnchainTokenSymbol;
  escrowChainId: number;
  contractEnabled: boolean;
  walletAddress: string;
  isAuthenticated: boolean;
  authLoading: boolean;
  isSubmitting: boolean;
  onAmountChange: (value: string) => void;
  onClose: () => void;
  onLogin: () => void;
  onSubmit: () => void;
}) {
  const { timeRemainingSeconds } = useBattleClock({
    startsAt: battle.startsAt,
    endsAt: battle.endsAt,
    fallbackSeconds: battle.timeRemainingSeconds,
  });
  const poolSide = side ? pool?.sides.find((item) => item.sideId === side.id) : null;
  const opponentPoolSide = side ? pool?.sides.find((item) => item.sideId !== side.id) : null;
  const numericAmount = Number(amount || 0);
  const canSubmit = Number.isFinite(numericAmount) && numericAmount > 0 && Boolean(side);

  return (
    <Dialog open={Boolean(side)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-[336px] rounded-[20px] border-0 bg-[#ffffff] p-2.5 font-mono text-[#0f172a] shadow-[0_22px_70px_rgba(15,23,42,0.18)] sm:max-w-[352px] sm:p-3 dark:bg-[#121212] dark:text-[#f2f2f2]">
        <DialogHeader className="space-y-1 text-left">
          <DialogTitle className="pr-6 text-[13px] font-black uppercase tracking-[0.08em] sm:text-sm">
            {side ? `P2P Stake: ${battleArmyName(side)}` : 'P2P Stake'}
          </DialogTitle>
          <DialogDescription className="text-[10px] leading-relaxed text-[#64748b] dark:text-[#999999]">
            Challenge staking uses onchain Bantah escrow when contract mode is enabled.
          </DialogDescription>
        </DialogHeader>

        {side && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 rounded-[16px] bg-[#f8fafc] p-2 dark:bg-[#1a1a1a]">
              <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-[#eef2ff] text-xl dark:bg-[#232035]">
                <BattleTokenMark side={side} className="h-full w-full rounded-full object-cover" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-black text-[#0f172a] dark:text-[#f2f2f2]">{battleMarketTitle(side)}</div>
                <div className="mt-0.5 truncate text-[10px] text-[#64748b] dark:text-[#999999]">
                  Round ends in {formatDuration(timeRemainingSeconds)} · {side.priceDisplay}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
              <div className="rounded-[14px] bg-[#f8fafc] p-2 dark:bg-[#1a1a1a]">
                <div className="text-[9px] font-bold uppercase text-[#64748b] dark:text-[#999999]">This side pool</div>
                <div className="mt-0.5 font-mono text-[13px] font-black text-[#0f172a] dark:text-[#f2f2f2]">
                  {(poolSide?.totalStake || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} {escrowTokenSymbol}
                </div>
                <div className="text-[9px] text-[#64748b] dark:text-[#999999]">{poolSide?.bettorCount || 0} bettors</div>
              </div>
              <div className="rounded-[14px] bg-[#f8fafc] p-2 dark:bg-[#1a1a1a]">
                <div className="text-[9px] font-bold uppercase text-[#64748b] dark:text-[#999999]">Other side pool</div>
                <div className="mt-0.5 font-mono text-[13px] font-black text-[#0f172a] dark:text-[#f2f2f2]">
                  {(opponentPoolSide?.totalStake || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} {escrowTokenSymbol}
                </div>
                <div className="text-[9px] text-[#64748b] dark:text-[#999999]">{opponentPoolSide?.bettorCount || 0} bettors</div>
              </div>
            </div>

            <label className="block text-[9px] font-black uppercase tracking-[0.08em] text-[#64748b] dark:text-[#999999]">Stake amount</label>
            <div className="flex items-center rounded-[14px] bg-[#f1f5f9] dark:bg-[#1c1c1c]">
              <input
                value={amount}
                onChange={(event) => onAmountChange(event.target.value.replace(/[^\d.]/g, ''))}
                inputMode="decimal"
                className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-base font-black text-[#0f172a] outline-none dark:text-[#f2f2f2]"
              />
              <span className="px-3 text-[11px] font-black text-[#64748b] dark:text-[#999999]">{escrowTokenSymbol}</span>
            </div>

            <div className={`rounded-[14px] p-2 text-[10px] leading-relaxed ${
              contractEnabled
                ? 'bg-emerald-50 text-emerald-700 dark:bg-[#11261d] dark:text-emerald-200'
                : 'bg-amber-50 text-amber-700 dark:bg-[#26180f] dark:text-amber-200'
            }`}>
              {contractEnabled
                ? `Onchain escrow: Bantah contract · round #${pool?.escrowChallengeId || 'reserving'} · chain ${escrowChainId || 'pending'}`
                : 'Onchain escrow is not configured yet. Real challenge staking is disabled.'}
            </div>

            <div className="flex items-center justify-between rounded-[14px] bg-[#f8fafc] px-2.5 py-2 text-[11px] dark:bg-[#1a1a1a]">
              <span className="text-[#64748b] dark:text-[#999999]">Wallet</span>
              <span className="font-mono font-bold text-[#0f172a] dark:text-[#f2f2f2]">
                {isAuthenticated ? shortAddress(walletAddress) : 'Sign in required'}
              </span>
            </div>

            {!isAuthenticated ? (
              <button
                type="button"
                disabled={authLoading}
                onClick={onLogin}
                className="bb-tap w-full rounded-[14px] bg-[#7c3aed] py-2 text-[12px] font-black text-white transition hover:bg-[#6d28d9] disabled:opacity-60"
              >
                Sign in with Privy
              </button>
            ) : (
              <button
                type="button"
                disabled={!canSubmit || isSubmitting || !contractEnabled}
                onClick={onSubmit}
                className="bb-tap w-full rounded-[14px] bg-[#7c3aed] py-2 text-[12px] font-black text-white transition hover:bg-[#6d28d9] disabled:opacity-60"
              >
                {isSubmitting ? 'Locking Escrow...' : `Lock ${escrowTokenSymbol} Stake`}
              </button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LoadingBattle() {
  return (
    <div className="flex-1 flex gap-0.5 overflow-hidden">
      <div className="flex-1 flex flex-col gap-2 p-3">
        <Skeleton className="h-24 w-full rounded" />
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="h-64 rounded" />
          <Skeleton className="h-64 rounded" />
        </div>
        <Skeleton className="h-24 w-full rounded" />
        <Skeleton className="h-48 w-full rounded" />
      </div>
      <div className="hidden lg:flex w-64 flex-col gap-2 p-3">
        <Skeleton className="h-full rounded" />
      </div>
    </div>
  );
}

function EmptyBattle({ isError: _isError }: { isError: boolean }) {
  return (
    <div className="flex-1 flex gap-0.5 overflow-hidden">
      <div className="flex-1 flex flex-col gap-2 p-3">
        <Skeleton className="h-24 w-full rounded" />
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="h-64 rounded" />
          <Skeleton className="h-64 rounded" />
        </div>
        <Skeleton className="h-24 w-full rounded" />
        <Skeleton className="h-48 w-full rounded" />
      </div>
      <div className="hidden lg:flex w-64 flex-col gap-2 p-3">
        <Skeleton className="h-full rounded" />
      </div>
    </div>
  );
}

function BattleDetailsFighterSummary({
  side,
  outcomeLabel,
  tone,
  bantCredits,
}: {
  side: AgentBattleSide;
  outcomeLabel: 'YES' | 'NO';
  tone: 'green' | 'red';
  bantCredits: number;
}) {
  const toneClassName = tone === 'green'
    ? 'border-green-500/25 bg-green-500/10 text-green-300'
    : 'border-red-500/25 bg-red-500/10 text-red-300';
  const symbol = battleSymbol(side);
  const showSymbol = symbol.toLowerCase() !== side.agentName.toLowerCase();

  return (
    <div className={`min-w-0 rounded-md border p-1.5 ${toneClassName}`}>
      <div className="flex min-w-0 items-center gap-1.5">
        <div className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-background text-base">
          <BattleTokenMark side={side} className="h-full w-full rounded-full object-cover" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[10px] font-black uppercase leading-tight text-foreground">{side.agentName}</div>
          {showSymbol && <div className="truncate font-mono text-[8px] font-black uppercase leading-tight">{symbol}</div>}
        </div>
      </div>
      <div className="mt-1.5 grid grid-cols-3 items-center gap-0.5 text-[9px]">
        <span className="rounded bg-background/70 px-1.5 py-0.5 text-center font-black uppercase">{outcomeLabel}</span>
        <span className="truncate text-center font-mono font-black text-foreground">{side.confidence}%</span>
        <span className="truncate text-right font-mono font-black text-yellow-300">{formatCompactNumber(bantCredits)} BC</span>
      </div>
    </div>
  );
}

function BattleDetailsMetric({
  label,
  value,
  tone = 'text-foreground',
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-background/70 px-2 py-1.5">
      <div className="text-[8px] font-black uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 truncate font-mono text-[11px] font-black ${tone}`}>{value}</div>
    </div>
  );
}

function BattleDetailsPanel({
  battle,
  left,
  right,
  isChallengeBattle,
  selectedSide,
  pool,
  watchReward,
  onJoinSide,
}: {
  battle: AgentBattleFeed['battles'][number];
  left: AgentBattleSide;
  right: AgentBattleSide;
  isChallengeBattle: boolean;
  selectedSide: AgentBattleSide;
  pool?: AgentBattleP2PPool | null;
  watchReward: BattleSpectatorRewardHudState;
  onJoinSide: (side: AgentBattleSide) => void;
}) {
  const leftBantCredits = Math.max(0, Math.round(left.bantCreditsEarned || 0));
  const rightBantCredits = Math.max(0, Math.round(right.bantCreditsEarned || 0));
  const matchBantCredits = Math.max(0, Math.round(battle.bantCreditsEarned ?? (leftBantCredits + rightBantCredits)));
  const spectatorBantCredits = Math.max(
    0,
    Math.round(battle.spectatorBantCredits ?? battle.rewardClaimBantCredits ?? 0),
  );
  const currentWatchBantCredits = Math.max(0, Math.round(watchReward.earnedForBattle || 0));
  const selectedIsLeft = selectedSide.id === left.id;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden border border-border bg-card p-2.5">
      <div className="shrink-0">
        <div className="grid grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1fr)] items-center gap-1">
          <BattleDetailsFighterSummary side={left} outcomeLabel="YES" tone="green" bantCredits={leftBantCredits} />
          <div className="text-center text-[8px] font-black uppercase text-muted-foreground">VS</div>
          <BattleDetailsFighterSummary side={right} outcomeLabel="NO" tone="red" bantCredits={rightBantCredits} />
        </div>
      </div>

      <div className="no-scrollbar mt-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="grid grid-cols-2 gap-1.5">
          <BattleDetailsMetric label="Match BC" value={formatCompactNumber(matchBantCredits)} tone="text-yellow-300" />
          <BattleDetailsMetric label="Pool" value={formatTokenAmount(pool?.totalStake, pool?.stakeCurrency)} />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <BattleDetailsMetric label="Positions" value={formatCompactNumber(pool?.positionCount || 0)} />
          <BattleDetailsMetric label="You earned" value={`${formatCompactNumber(currentWatchBantCredits)} BC`} tone="text-yellow-300" />
        </div>
      </div>

      {isChallengeBattle && (
        <div className="mt-2 grid shrink-0 grid-cols-2 gap-1.5 border-t border-border pt-2">
          <button
            type="button"
            onClick={() => onJoinSide(left)}
            className={`rounded-md border px-3 py-2 text-xs font-black uppercase transition active:scale-[0.98] ${
              selectedIsLeft
                ? 'border-green-300 bg-green-500/35 text-green-50'
                : 'border-green-500/35 bg-green-500/15 text-green-200 hover:bg-green-500/25'
            }`}
          >
            YES
          </button>
          <button
            type="button"
            onClick={() => onJoinSide(right)}
            className={`rounded-md border px-3 py-2 text-xs font-black uppercase transition active:scale-[0.98] ${
              !selectedIsLeft
                ? 'border-red-300 bg-red-500/35 text-red-50'
                : 'border-red-500/35 bg-red-500/15 text-red-200 hover:bg-red-500/25'
            }`}
          >
            NO
          </button>
        </div>
      )}
    </div>
  );
}

function BattleSlipsPanel({
  positions,
  currentRoundId,
  onchainConfig,
  isAuthenticated,
  authLoading,
  onLogin,
  compact = false,
}: {
  positions: AgentBattleP2PHistoryPosition[];
  currentRoundId?: string | null;
  onchainConfig?: OnchainRuntimeConfig | null;
  isAuthenticated: boolean;
  authLoading: boolean;
  onLogin: () => void;
  compact?: boolean;
}) {
  const visiblePositions = positions.slice(0, compact ? 6 : 10);
  const wonCount = positions.filter((position) => position.resultStatus === 'won').length;
  const baseCardClass = compact
    ? 'rounded-xl border border-border bg-muted/25 p-2.5'
    : 'rounded-2xl border border-border bg-muted/25 p-3';

  if (authLoading) {
    return (
      <div className={`${baseCardClass} flex h-full min-h-0 items-center justify-center text-xs text-muted-foreground`}>
        Loading battle slips...
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className={`${baseCardClass} flex h-full min-h-0 flex-col items-center justify-center text-center`}>
        <div className="text-sm font-black uppercase text-foreground">My Battle Slips</div>
        <div className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
          Sign in to see settled battle results, payout amounts, and onchain transaction hashes after each round expires.
        </div>
        <button
          type="button"
          onClick={onLogin}
          className="mt-3 rounded-lg bg-primary px-3 py-2 text-xs font-black uppercase text-primary-foreground transition hover:opacity-90"
        >
          Sign In With Privy
        </button>
      </div>
    );
  }

  if (visiblePositions.length === 0) {
    return (
      <div className={`${baseCardClass} flex h-full min-h-0 flex-col justify-center text-center`}>
        <div className="text-sm font-black uppercase text-foreground">My Battle Slips</div>
        <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Your locked battle tickets and settled payouts will show up here after you join a round.
        </div>
      </div>
    );
  }

  return (
    <div className={`${baseCardClass} flex h-full min-h-0 flex-col overflow-hidden`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-black uppercase text-foreground">My Battle Slips</div>
          <div className="text-[11px] text-muted-foreground">{positions.length} tracked · {wonCount} wins</div>
        </div>
        <div className="rounded-full border border-primary/20 bg-primary/10 px-2 py-1 text-[10px] font-black uppercase text-primary">
          Payout History
        </div>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {visiblePositions.map((position) => {
          const txUrl = buildExplorerTxUrl(position, onchainConfig);
          const currentBattle = currentRoundId && position.roundId === currentRoundId;
          const settlementSymbol = position.escrowTokenSymbol || position.stakeCurrency;
          const payoutLabel =
            position.earnedAmount !== null
              ? formatTokenAmount(position.earnedAmount, settlementSymbol)
              : null;

          return (
            <div
              key={position.id}
              className={`rounded-xl border px-3 py-2 ${
                currentBattle
                  ? 'border-primary/30 bg-primary/10'
                  : 'border-border bg-background/70'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-black uppercase text-foreground">{position.battleTitle}</div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    Backed {position.sideLabel}
                    {position.opponentSideLabel ? ` vs ${position.opponentSideLabel}` : ''}
                  </div>
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-black uppercase ${battleSlipStatusClassName(position.resultStatus)}`}>
                  {battleSlipStatusLabel(position.resultStatus)}
                </span>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded-lg bg-muted/35 px-2 py-1.5">
                  <div className="font-black uppercase text-muted-foreground">Stake</div>
                  <div className="mt-0.5 font-mono font-bold text-foreground">
                    {formatTokenAmount(position.stakeAmount, position.stakeCurrency)}
                  </div>
                </div>
                <div className="rounded-lg bg-muted/35 px-2 py-1.5">
                  <div className="font-black uppercase text-muted-foreground">Payout</div>
                  <div className={`mt-0.5 font-mono font-bold ${
                    position.resultStatus === 'won'
                      ? 'text-green-400'
                      : position.resultStatus === 'lost'
                        ? 'text-red-400'
                        : 'text-foreground'
                  }`}>
                    {payoutLabel || 'Pending'}
                  </div>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                <span>Round ended {formatRelativeTime(position.roundEndsAt)}</span>
                {position.settledAt && <span>Settled {formatRelativeTime(position.settledAt)}</span>}
                {currentBattle && <span className="font-black uppercase text-primary">Current battle</span>}
              </div>

              {position.resultStatus === 'awaiting_settlement' && (
                <div className="mt-2 text-[10px] text-amber-300">
                  Escrow was locked. Settlement worker is still resolving the payout onchain.
                </div>
              )}
              {position.resultStatus === 'unmatched' && (
                <div className="mt-2 text-[10px] text-orange-300">
                  This round is only partially settled right now. Your locked position still needs final pairing or admin resolution.
                </div>
              )}
              {position.resultStatus === 'needs_escrow' && (
                <div className="mt-2 text-[10px] text-slate-300">
                  This ticket never became escrow-locked, so it is not eligible for payout settlement.
                </div>
              )}
              {position.resultStatus === 'failed' && position.settlementError && (
                <div className="mt-2 text-[10px] text-rose-300">
                  {position.settlementError}
                </div>
              )}

              {(txUrl || position.payoutTxHash || position.escrowTxHash) && (
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="min-w-0 text-[10px] text-muted-foreground">
                    <span className="font-black uppercase">
                      {position.payoutTxHash ? 'Payout tx' : 'Escrow tx'}
                    </span>
                    <span className="ml-1 font-mono">
                      {shortAddress(position.payoutTxHash || position.escrowTxHash || '')}
                    </span>
                  </div>
                  {txUrl && (
                    <button
                      type="button"
                      onClick={() => window.open(txUrl, '_blank', 'noopener,noreferrer')}
                      className="shrink-0 rounded-md border border-border bg-background px-2 py-1 text-[10px] font-black uppercase text-foreground transition hover:bg-muted"
                    >
                      View Tx
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function BattlesPage({
  onNavigate,
  externalBattle = null,
  externalExecutionUrl = null,
  externalSourceLabel = 'Battle',
  onExternalBack,
}: BattlesPageProps) {
  const { toast } = useToast();
  const tanstackQueryClient = useQueryClient();
  const { isAuthenticated, isLoading: authLoading, login, user: privyUser } = useAuth();
  const rawUserId = typeof privyUser?.id === 'string' ? privyUser.id.replace('did:privy:', '') : undefined;
  const publicUser = usePublicUserBasic(rawUserId);
  const userDisplayName = getUserDisplayName(publicUser, 'Web Degen');
  const { wallets } = useWallets();
  const walletAddress = getWalletAddress(wallets as unknown[]);
  const [chatInput, setChatInput] = useState('');
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [quickTradeSideIndex, setQuickTradeSideIndex] = useState<0 | 1>(0);
  const [quickTradeAmount, setQuickTradeAmount] = useState('100');
  const [stakeDialogSide, setStakeDialogSide] = useState<AgentBattleSide | null>(null);
  const [stakeDialogAmount, setStakeDialogAmount] = useState('100');
  const [mobileBattlePanel, setMobileBattlePanel] = useState<MobileBattlePanel>('trade');
  const [desktopSideTab, setDesktopSideTab] = useState<DesktopSideTab>('trollbox');
  const [desktopBattleTab, setDesktopBattleTab] = useState<DesktopBattleTab>('side');
  const [desktopChosenSideId, setDesktopChosenSideId] = useState<string | null>(null);
  const [battleModeEnabled, setBattleModeEnabled] = useState(() => {
    if (typeof window === 'undefined') return true;
    const stored = window.localStorage.getItem(BATTLE_MODE_STORAGE_KEY);
    return stored === null ? true : stored !== 'off';
  });
  const [gameSoundEnabled, setGameSoundEnabled] = useState(readInitialGameSoundEnabled);
  const [requestedBattleId, setRequestedBattleId] = useState<string | null>(() => readBattleIdFromUrl());
  const [arenaPreview, setArenaPreview] = useState<ArenaPreviewState>(() => readArenaPreviewFromUrl());
  const [stickyBattleFeed, setStickyBattleFeed] = useState<AgentBattleFeed | null>(() => readLiveBattleFeedSnapshot());
  const [stickyRequestedBattle, setStickyRequestedBattle] = useState<AgentBattle | null>(() =>
    readOpenBattleSnapshot(readBattleIdFromUrl()),
  );
  const [isDesktopBattleLayout, setIsDesktopBattleLayout] = useState(readIsDesktopBattleLayout);
  const [localTrollboxActionItems, setLocalTrollboxActionItems] = useState<DesktopTrollboxItem[]>([]);
  const desktopTrollboxScrollRef = useRef<HTMLDivElement>(null);
  const previousBattleRef = useRef<AgentBattle | null>(null);
  const isExternalBattle = Boolean(externalBattle);

  const {
    data: visibleFeedData,
    isLoading: visibleFeedLoading,
    isError,
    isFetching: visibleFeedFetching,
  } = useQuery<AgentBattleFeed>({
    queryKey: [
      '/api/bantahbro/agent-battles/live',
      { limit: String(INITIAL_ARENA_BATTLE_LIMIT), liveStats: '0' },
    ],
    enabled: !isExternalBattle,
    staleTime: 3_000,
    refetchInterval: 5_000,
    retry: 3,
    retryDelay: 1_500,
    placeholderData: (previousData) => previousData,
  });

  const {
    data: fullFeedData,
    isFetching: fullFeedFetching,
  } = useQuery<AgentBattleFeed>({
    queryKey: [
      '/api/bantahbro/agent-battles/live',
      { limit: String(FULL_ARENA_BATTLE_LIMIT), liveStats: '1' },
    ],
    enabled: !isExternalBattle && Boolean(visibleFeedData?.battles?.length || stickyBattleFeed?.battles?.length),
    staleTime: 8_000,
    refetchInterval: 15_000,
    retry: 1,
    retryDelay: 2_000,
    placeholderData: (previousData) => previousData,
  });

  const data = fullFeedData?.battles?.length ? fullFeedData : visibleFeedData;

  const {
    data: specificBattleResponse,
    isFetching: specificBattleFetching,
  } = useQuery<{ battle: AgentBattle }>({
    queryKey: ['/api/bantahbro/agent-battles/single', requestedBattleId],
    queryFn: () => apiRequest('GET', `/api/bantahbro/agent-battles/single/${encodeURIComponent(requestedBattleId!)}`),
    enabled: !isExternalBattle && Boolean(requestedBattleId) && 
      !data?.battles?.some(b => b.id === requestedBattleId) && 
      !stickyBattleFeed?.battles?.some(b => b.id === requestedBattleId),
    staleTime: 5_000,
    retry: 1,
  });

  const isLoading = visibleFeedLoading && !stickyBattleFeed?.battles?.length;
  const isFetching = visibleFeedFetching || fullFeedFetching || specificBattleFetching;

  useEffect(() => {
    if (isExternalBattle) return;
    if (!data?.battles?.length) return;
    setStickyBattleFeed(data);
    writeLiveBattleFeedSnapshot(data);
  }, [data, isExternalBattle]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia(DESKTOP_BATTLE_MEDIA_QUERY);
    const syncLayout = () => setIsDesktopBattleLayout(mediaQuery.matches);

    syncLayout();
    mediaQuery.addEventListener('change', syncLayout);
    return () => mediaQuery.removeEventListener('change', syncLayout);
  }, []);

  useEffect(() => {
    if (isExternalBattle) return;
    if (!requestedBattleId) {
      setStickyRequestedBattle(null);
      return;
    }
    const nextStickyRequestedBattle =
      data?.battles?.find((candidate) => candidate.id === requestedBattleId) ||
      stickyBattleFeed?.battles?.find((candidate) => candidate.id === requestedBattleId) ||
      null;
    if (nextStickyRequestedBattle) {
      setStickyRequestedBattle(nextStickyRequestedBattle);
    }
  }, [data?.battles, requestedBattleId, stickyBattleFeed, isExternalBattle]);

  const resolvedBattleFeed: AgentBattleFeed | null = isExternalBattle
    ? null
    : data?.battles?.length
      ? data
      : stickyBattleFeed;
  const requestedBattleFromLiveFeed = requestedBattleId
    ? data?.battles?.find((candidate) => candidate.id === requestedBattleId)
    : null;
  const requestedBattleFromStickyFeed = requestedBattleId
    ? stickyBattleFeed?.battles?.find((candidate) => candidate.id === requestedBattleId)
    : null;
  const requestedBattleFromPinnedSnapshot =
    requestedBattleId && stickyRequestedBattle?.id === requestedBattleId
      ? stickyRequestedBattle
      : null;
  const requestedBattleFromSingleFetch = requestedBattleId && specificBattleResponse?.battle?.id === requestedBattleId
      ? specificBattleResponse.battle
      : null;

  const battle =
    externalBattle ||
    (requestedBattleId
      ? requestedBattleFromLiveFeed ||
        requestedBattleFromPinnedSnapshot ||
        requestedBattleFromStickyFeed ||
        requestedBattleFromSingleFetch ||
        resolvedBattleFeed?.battles?.[0]
      : resolvedBattleFeed?.battles?.[0]);
  const { isExpired: isBattleExpired } = useBattleClock({
    startsAt: battle?.startsAt,
    endsAt: battle?.endsAt,
    fallbackSeconds: battle?.timeRemainingSeconds || 0,
  });

  const arenaPreviewStartsAtMs = arenaPreview.startsAtMs || (battle?.startsAt ? new Date(battle.startsAt).getTime() : 0);
  const isBattleQueued = arenaPreviewStartsAtMs > Date.now();
  const battleStatus = isBattleExpired ? 'cancelled' : isBattleQueued ? 'queued' : arenaPreview.status === 'queued' ? 'live' : arenaPreview.status;

  const trollboxRoomId = 'agent-battle';
  const battleP2PUrl = !isExternalBattle && battle?.id
    ? `/api/bantahbro/agent-battles/${encodeURIComponent(battle.id)}/p2p/${isAuthenticated ? 'my' : 'pool'}`
    : '';

  const { data: trollboxFeed } = useQuery<TrollboxFeed>({
    queryKey: ['/api/bantahbro/trollbox', { roomId: trollboxRoomId, limit: '60' }],
    enabled: Boolean(battle),
    staleTime: 1_000,
    refetchInterval: 3_000,
  });

  const { data: desktopSidebarFeed } = useQuery<SidebarFeedResponse>({
    queryKey: ['/api/bantahbro/feed', { limit: '30' }],
    enabled: Boolean(battle),
    staleTime: 5_000,
    refetchInterval: 30_000,
  });

  const { data: rawP2pPool } = useQuery<AgentBattleP2PPool>({
    queryKey: ['/api/bantahbro/agent-battles/p2p/pool', battle?.id || 'none', isAuthenticated ? 'my' : 'public'],
    queryFn: () => apiRequest('GET', battleP2PUrl),
    enabled: Boolean(battleP2PUrl) && !isExternalBattle && !battle?.isChallenge,
    staleTime: 1_000,
    refetchInterval: 5_000,
    retry: 1,
  });

  const { data: p2pHistoryData } = useQuery<AgentBattleP2PHistoryResponse>({
    queryKey: ['/api/bantahbro/agent-battles/p2p/positions/my', { limit: '20' }],
    queryFn: () => apiRequest('GET', '/api/bantahbro/agent-battles/p2p/positions/my?limit=20'),
    enabled: isAuthenticated && !isExternalBattle && !battle?.isChallenge,
    staleTime: 3_000,
    refetchInterval: 10_000,
    retry: 1,
  });

  const { data: predictionPool } = useQuery<BotaAgentChallengePredictionPool>({
    queryKey: ['/api/bantahbro/agent-challenges/prediction/pool', battle?.challengeCode],
    queryFn: () => apiRequest('GET', `/api/bantahbro/agent-challenges/${encodeURIComponent(battle?.challengeCode || '')}/prediction/pool`),
    enabled: Boolean(battle?.isChallenge && battle?.challengeCode) && !isExternalBattle,
    staleTime: 1_000,
    refetchInterval: 5_000,
    retry: 1,
  });

  const { data: predictionPositionsData } = useQuery<{ positions: BotaAgentChallengePredictionPosition[] }>({
    queryKey: ['/api/bantahbro/agent-challenges/prediction/positions/pool', battle?.challengeCode],
    queryFn: () => apiRequest('GET', `/api/bantahbro/agent-challenges/prediction/positions/pool?challengeCode=${encodeURIComponent(battle?.challengeCode || '')}`),
    enabled: Boolean(battle?.isChallenge && battle?.challengeCode) && !isExternalBattle,
    staleTime: 3_000,
    refetchInterval: 10_000,
    retry: 1,
  });

  const p2pPool = useMemo<AgentBattleP2PPool | undefined>(() => {
    if (!battle?.isChallenge) return rawP2pPool;
    if (!predictionPool) return undefined;
    const aSide = predictionPool.sides[0];
    const bSide = predictionPool.sides[1];
    return {
      battleId: battle.id,
      status: predictionPool.status === 'betting_open' ? 'live' : 'ended',
      escrowMode: predictionPool.escrowMode,
      escrowChallengeId: predictionPool.escrowChallengeId,
      escrowChainId: predictionPool.escrowChainId,
      escrowTokenSymbol: predictionPool.escrowTokenSymbol,
      escrowAddress: null,
      totalVolume: predictionPool.totalStake,
      totalPositions: predictionPool.positionCount,
      sides: [
        { sideId: battle.sides[0].id, totalStake: aSide.totalStake, bettorCount: aSide.bettorCount, sharePercent: aSide.sharePercent },
        { sideId: battle.sides[1].id, totalStake: bSide.totalStake, bettorCount: bSide.bettorCount, sharePercent: bSide.sharePercent },
      ],
      userPositions: predictionPool.userPosition ? [] : [], // We don't map userPosition directly here
      updatedAt: predictionPool.updatedAt,
    };
  }, [battle, rawP2pPool, predictionPool]);

  const battleSlipHistory = useMemo(() => {
    if (!battle?.isChallenge) return p2pHistoryData?.positions || [];
    if (!predictionPositionsData?.positions) return [];
    
    return predictionPositionsData.positions.map((pos) => {
      const isLeft = pos.side === 'YES' || pos.side === 'A';
      return {
        id: pos.id,
        battleId: battle.id,
        battleTitle: `Challenge: ${battle.title}`,
        sideId: isLeft ? battle.sides[0].id : battle.sides[1].id,
        sideLabel: pos.sideAgentName,
        opponentSideId: isLeft ? battle.sides[1].id : battle.sides[0].id,
        opponentSideLabel: isLeft ? battle.sides[1].agentName : battle.sides[0].agentName,
        userId: pos.userId,
        stakeAmount: pos.stakeAmount,
        stakeCurrency: pos.stakeCurrency,
        escrowStatus: pos.escrowStatus as any,
        resultStatus: pos.winnerSide ? (pos.winnerSide === pos.side ? 'won' : 'lost') : 'live',
        earnedAmount: pos.payoutAmount,
        roundEndsAt: battle.endsAt,
        createdAt: pos.createdAt,
        updatedAt: pos.updatedAt,
      } as AgentBattleP2PHistoryPosition;
    });
  }, [battle, p2pHistoryData, predictionPositionsData]);

  const { data: onchainConfig } = useQuery<OnchainRuntimeConfig>({
    queryKey: ['/api/onchain/config'],
    queryFn: () => apiRequest('GET', '/api/onchain/config'),
    enabled: !isExternalBattle,
    staleTime: 1000 * 60 * 5,
    retry: false,
  });

  const battleEscrowToken = (p2pPool?.escrowTokenSymbol || onchainConfig?.defaultToken || 'USDC') as OnchainTokenSymbol;
  const battleEscrowChainId = Number(
    p2pPool?.escrowChainId || onchainConfig?.defaultChainId || 0,
  );
  const battleEscrowChain = onchainConfig?.chains?.[String(battleEscrowChainId)];
  const battleEscrowReady =
    !isExternalBattle && onchainConfig?.contractEnabled === true && battleEscrowChain?.escrowSupportsChallengeLock === true;
  const handleBattleWatchRewardAward = useCallback(
    (points: number) => {
      const createdAt = new Date().toISOString();
      const battleTitle = battle?.title || 'this Arena battle';
      setLocalTrollboxActionItems((current) =>
        dedupeTrollboxItems([
          ...current,
          {
            id: `reward-${battle?.id || 'arena'}-${createdAt}`,
            createdAt,
            sourceLabel: 'REWARD',
            sourceClassName: actionSourceColor('reward'),
            statusIcon: '🟢',
            statusLabel: 'reward',
            user: 'BantCredit',
            message: `+${points} BantCredit watch reward.`,
            meta: truncateTrollboxText(battleTitle, 34),
          },
        ]).slice(-12),
      );
      tanstackQueryClient.invalidateQueries({ queryKey: ['/api/bantahbro/stats/bantcredit'] });
      tanstackQueryClient.invalidateQueries({ queryKey: ['/api/bantahbro/rewards'] });
      tanstackQueryClient.invalidateQueries({ queryKey: ['/api/bantahbro/agent-battles/live'] });
      tanstackQueryClient.invalidateQueries({ queryKey: ['/api/wallet/balance'] });
      tanstackQueryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      toast({
        title: 'BantCredit',
        description: `+${points} BantCredit for watching this Arena battle.`,
      });
    },
    [battle?.id, battle?.title, tanstackQueryClient, toast],
  );
  const battleWatchReward = useBattleSpectatorRewards({
    battleId: battle?.id,
    enabled: Boolean(battleModeEnabled && battle),
    isAuthenticated,
    battleMode: arenaPreview.mode,
    battleStatus: battleStatus,
    onAward: handleBattleWatchRewardAward,
  });
  const battleArenaLabel = resolveBattleArenaLabel(arenaPreview, battle);
  const isChallengeBattle = isExternalBattle || arenaPreview.mode === 'challenge';
  const advanceArenaBattle = useCallback(
    (detail: { battleId?: string | null } = {}) => {
      if (isExternalBattle) return;

      const finishedBattleId = detail.battleId || battle?.id || requestedBattleId;
      const seen = new Set<string>();
      const candidates = [
        ...(data?.battles || []),
        ...(resolvedBattleFeed?.battles || []),
        ...(stickyBattleFeed?.battles || []),
      ].filter((candidate) => {
        if (!candidate?.id || seen.has(candidate.id)) return false;
        seen.add(candidate.id);
        return true;
      });
      const nextBattle =
        firstLiveBattleForArena(candidates, finishedBattleId) ||
        firstLiveBattleForArena(candidates, null);

      if (nextBattle) {
        setRequestedBattleId(nextBattle.id);
        setStickyRequestedBattle(nextBattle);
        if (typeof window !== 'undefined') {
          const params = new URLSearchParams(window.location.search);
          if (params.has('battle')) {
            params.set('battle', nextBattle.id);
            const queryString = params.toString();
            window.history.replaceState({}, '', `${window.location.pathname}${queryString ? `?${queryString}` : ''}`);
          }
        }
      } else {
        setRequestedBattleId(null);
        setStickyRequestedBattle(null);
      }

      void tanstackQueryClient.invalidateQueries({ queryKey: ['/api/bantahbro/agent-battles/live'] });
    },
    [
      battle?.id,
      data?.battles,
      isExternalBattle,
      requestedBattleId,
      resolvedBattleFeed?.battles,
      stickyBattleFeed?.battles,
      tanstackQueryClient,
    ],
  );

  const stakeMutation = useMutation<AgentBattleP2PStakeResponse, Error>({
    mutationFn: async () => {
      if (!battle || !stakeDialogSide) {
        throw new Error('No live Agent Battle side selected');
      }
      if (isBattleExpired) {
        throw new Error('This Agent Battle round has expired.');
      }
      if (!battleEscrowReady) {
        throw new Error('Bantah V2 onchain escrow is not configured for battle-round locks yet.');
      }
      if (!battleEscrowChainId) {
        throw new Error('Battle escrow chain is not available.');
      }
      if (!wallets?.length) {
        throw new Error('Connect a Privy wallet to lock this stake.');
      }

      const isChallenge = Boolean(battle?.isChallenge && battle?.challengeCode);
      const isLeftPick = stakeDialogSide.id === battle.sides[0].id;
      const challengePick = isLeftPick ? 'YES' : 'NO';

      const ticket = isChallenge
        ? await apiRequest('POST', `/api/bantahbro/agent-challenges/${encodeURIComponent(battle.challengeCode!)}/prediction/stake`, {
            side: challengePick,
            stakeAmount: Number(stakeDialogAmount || 0),
            stakeCurrency: battleEscrowToken,
            walletAddress: walletAddress || undefined,
          })
        : await apiRequest('POST', `/api/bantahbro/agent-battles/${encodeURIComponent(battle.id)}/p2p/stake`, {
            sideId: stakeDialogSide.id,
            stakeAmount: Number(stakeDialogAmount || 0),
            stakeCurrency: battleEscrowToken,
            walletAddress: walletAddress || undefined,
          });

      const escrowChallengeId = Number(ticket?.position?.escrowChallengeId || ticket?.pool?.escrowChallengeId);
      const escrowTokenSymbol = (ticket?.position?.escrowTokenSymbol || ticket?.pool?.escrowTokenSymbol || battleEscrowToken) as OnchainTokenSymbol;
      const escrowChainId = Number(ticket?.position?.escrowChainId || ticket?.pool?.escrowChainId || battleEscrowChainId);
      if (!Number.isInteger(escrowChallengeId) || escrowChallengeId <= 0) {
        throw new Error('Battle escrow round could not be reserved.');
      }

      const escrowTx = await executeOnchainEscrowStakeTx({
        wallets: wallets as any,
        preferredWalletAddress: walletAddress || null,
        onchainConfig,
        chainId: escrowChainId,
        challengeId: escrowChallengeId,
        tokenSymbol: escrowTokenSymbol,
        amount: stakeDialogAmount,
      });

      const escrowUrl = isChallenge
        ? `/api/bantahbro/agent-challenges/prediction/positions/${encodeURIComponent(ticket.position.id)}/escrow`
        : `/api/bantahbro/agent-battles/p2p/positions/${encodeURIComponent(ticket.position.id)}/escrow`;

      const locked = await apiRequest('POST', escrowUrl, {
        walletAddress: escrowTx.walletAddress,
        escrowTxHash: escrowTx.escrowTxHash,
      });

      return {
        ...ticket,
        position: locked?.position || ticket.position,
        message: `${stakeDialogAmount} ${escrowTokenSymbol} locked in the existing Bantah escrow contract.`,
      };
    },
    onSuccess: (response) => {
      setDesktopChosenSideId(response.position.sideId);
      setQuickTradeSideIndex(response.position.sideId === battle?.sides?.[1]?.id ? 1 : 0);
      setStakeDialogSide(null);
      if (battle?.isChallenge && battle?.challengeCode) {
        tanstackQueryClient.invalidateQueries({ queryKey: ['/api/bantahbro/agent-challenges/prediction/pool', battle.challengeCode] });
        tanstackQueryClient.invalidateQueries({ queryKey: ['/api/bantahbro/agent-challenges/prediction/positions/pool', battle.challengeCode] });
      } else {
        tanstackQueryClient.invalidateQueries({ queryKey: ['/api/bantahbro/agent-battles/p2p/pool'] });
        tanstackQueryClient.invalidateQueries({ queryKey: ['/api/bantahbro/agent-battles/p2p/positions/my'] });
      }
      toast({
        title: 'Battle stake escrow locked',
        description: response.message,
      });
    },
    onError: (error) => {
      toast({
        title: 'P2P stake failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const trollboxMessages = trollboxFeed?.messages || [];
  const battleTrollboxActionItems = useMemo(() => {
    const items: DesktopTrollboxItem[] = [];
    const liveStateItem = buildBattleOutcomeItem(
      battle,
      arenaPreview.mode,
      Boolean(isBattleExpired || battle?.status === 'expired'),
    );
    if (liveStateItem) items.push(liveStateItem);
    items.push(...buildBattleSlipActionItems(battleSlipHistory));
    items.push(...localTrollboxActionItems);
    return items;
  }, [
    arenaPreview.mode,
    battle,
    battleSlipHistory,
    isBattleExpired,
    localTrollboxActionItems,
  ]);
  const desktopTrollboxItems = useMemo(
    () => buildDesktopTrollboxItems(
      trollboxMessages,
      battle?.events || [],
      desktopSidebarFeed?.items || [],
      battle?.sides || [],
      battleTrollboxActionItems,
    ),
    [battle?.events, battle?.sides, battleTrollboxActionItems, desktopSidebarFeed?.items, trollboxMessages],
  );
  const trollboxUserCount = useMemo(() => {
    const users = new Set(
      trollboxMessages
        .map((message) => (message.handle || message.user || '').trim().toLowerCase())
        .filter(Boolean),
    );
    return users.size;
  }, [trollboxMessages]);

  useEffect(() => {
    if (!battle) return;
    const previousBattle = previousBattleRef.current;
    if (previousBattle && previousBattle.id !== battle.id) {
      const resultItem = buildBattleOutcomeItem(
        previousBattle,
        arenaPreview.mode,
        true,
        previousBattle.endsAt || new Date().toISOString(),
      );
      if (resultItem) {
        setLocalTrollboxActionItems((current) =>
          dedupeTrollboxItems([...current, resultItem]).slice(-12),
        );
      }
    }
    previousBattleRef.current = battle;
  }, [arenaPreview.mode, battle]);

  useEffect(() => {
    const scroller = desktopTrollboxScrollRef.current;
    if (!scroller) return;

    const distanceFromBottom = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
    if (distanceFromBottom > 96) return;

    window.requestAnimationFrame(() => {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
    });
  }, [desktopTrollboxItems.length]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncBattleUrlState = () => {
      const nextRequestedBattleId = readBattleIdFromUrl();
      const snapshotBattle = readOpenBattleSnapshot(nextRequestedBattleId);
      setRequestedBattleId(nextRequestedBattleId);
      if (snapshotBattle) {
        setStickyRequestedBattle(snapshotBattle);
      }
      setArenaPreview(readArenaPreviewFromUrl());
    };
    window.addEventListener('popstate', syncBattleUrlState);
    window.addEventListener(ARENA_PREVIEW_EVENT, syncBattleUrlState);
    syncBattleUrlState();
    return () => {
      window.removeEventListener('popstate', syncBattleUrlState);
      window.removeEventListener(ARENA_PREVIEW_EVENT, syncBattleUrlState);
    };
  }, []);

  useEffect(() => {
    if (isExternalBattle) return;
    const firstLiveBattle = firstLiveBattleForArena(resolvedBattleFeed?.battles);
    const fallbackBattle = resolvedBattleFeed?.battles?.[0] || null;
    const firstBattleId = firstLiveBattle?.id || fallbackBattle?.id;
    if (!firstBattleId) return;
    setRequestedBattleId((current) => {
      const liveFeedBattle = current
        ? data?.battles?.find((candidate) => candidate.id === current)
        : null;
      if (liveFeedBattle && isBattleLiveForArena(liveFeedBattle)) {
        return current;
      }
      if (current) {
        if (
          stickyRequestedBattle?.id === current &&
          isBattleLiveForArena(stickyRequestedBattle)
        ) {
          return current;
        }
        const stickyBattle = stickyBattleFeed?.battles?.find((candidate) => candidate.id === current);
        if (stickyBattle && isBattleLiveForArena(stickyBattle)) {
          return current;
        }
      }
      return firstBattleId;
    });
  }, [data?.battles, resolvedBattleFeed, stickyBattleFeed, stickyRequestedBattle, isExternalBattle]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(BATTLE_MODE_STORAGE_KEY, battleModeEnabled ? 'on' : 'off');
  }, [battleModeEnabled]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(GAME_SOUND_STORAGE_KEY, String(gameSoundEnabled));
    } catch {
      // Storage can be blocked in some mobile/private sessions; the live React state still controls the engine.
    }
  }, [gameSoundEnabled]);

  const submitChat = async (event: FormEvent) => {
    event.preventDefault();
    const text = chatInput.trim();
    if (!text || isSendingChat) return;

    setIsSendingChat(true);
    setChatInput('');
    try {
      await apiRequest('POST', '/api/bantahbro/trollbox', {
        roomId: trollboxRoomId,
        battleId: battle?.id,
        user: userDisplayName,
        message: text,
      });
      await queryClient.invalidateQueries({ queryKey: ['/api/bantahbro/trollbox'] });
    } finally {
      setIsSendingChat(false);
    }
  };

  if (isLoading || (isFetching && !battle)) return <LoadingBattle />;
  if (isError || !battle) return <EmptyBattle isError={isError} />;

  const [left, right] = battle.sides;
  const leading = battle.leadingSideId === left.id ? left : right;
  const desktopSelectedSide =
    desktopChosenSideId === left.id ? left : desktopChosenSideId === right.id ? right : leading;
  const openStakeDialog = (side: AgentBattleSide, amount = quickTradeAmount || '100') => {
    setDesktopChosenSideId(side.id);
    setQuickTradeSideIndex(side.id === right.id ? 1 : 0);
    if (isBattleExpired) {
      toast({
        title: 'Battle round expired',
        description: 'This round already hit zero. Wait for the next live battle window.',
        variant: 'destructive',
      });
      return;
    }
    if (isExternalBattle && externalExecutionUrl) {
      toast({
        title: `${externalSourceLabel} execution`,
        description: 'Opening the source market. BOTA is the battle layer for this listing.',
      });
      window.open(externalExecutionUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    setStakeDialogSide(side);
    setStakeDialogAmount(amount || '100');
  };
  const chooseDesktopSide = (side: AgentBattleSide) => {
    openStakeDialog(side, quickTradeAmount || '100');
  };

  return (
    <>
      {!isDesktopBattleLayout && (
        <MobileAgentBattleView
          battle={battle}
          left={left}
          right={right}
          battleModeEnabled={battleModeEnabled}
          arenaPreview={arenaPreview}
          watchReward={battleWatchReward}
          gameSoundEnabled={gameSoundEnabled}
          pool={p2pPool}
          trollboxMessages={trollboxMessages}
          trollboxItems={desktopTrollboxItems}
          trollboxUserCount={trollboxUserCount}
          positions={battleSlipHistory}
          currentRoundId={p2pPool?.roundId}
          onchainConfig={onchainConfig}
          isAuthenticated={isAuthenticated}
          authLoading={authLoading}
          quickTradeAmount={quickTradeAmount}
          chatInput={chatInput}
          isSendingChat={isSendingChat}
          onStakeSide={openStakeDialog}
          onLogin={login}
          onChatInputChange={setChatInput}
          onSubmitChat={submitChat}
          onNavigate={onNavigate}
          onArenaAdvance={advanceArenaBattle}
          onGameSoundToggle={() => setGameSoundEnabled((current) => !current)}
        />
      )}

      {isDesktopBattleLayout && (
        <div className="hidden lg:flex flex-1 gap-0 overflow-hidden min-w-0">
      <div className="flex-1 flex flex-col bg-card border border-border rounded overflow-hidden min-w-0">
        <div className="border-b border-border bg-background px-3 py-2 flex items-center gap-3 shrink-0">
          <button
            onClick={() => {
              if (onExternalBack) {
                onExternalBack();
                return;
              }
              onNavigate?.('challenge');
            }}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition"
          >
            <ArrowLeft size={14} /> Back to Markets
          </button>
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="w-2 h-2 bg-destructive rounded-full animate-pulse" />
            <span className="text-xs font-bold text-foreground">LIVE</span>
          </div>
          <BattleModeToggle
            enabled={battleModeEnabled}
            onToggle={() => setBattleModeEnabled((current) => !current)}
          />
          <GameSoundToggle
            enabled={gameSoundEnabled}
            onToggle={() => setGameSoundEnabled((current) => !current)}
          />
        </div>

        <div className="no-scrollbar flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="border-b border-border bg-background/70">
            {battleModeEnabled && (
              <FightingGameArenaEmbed
                flush
                battle={battle}
                battleMode={arenaPreview.mode}
                battleStatus={battleStatus}
                startsAtMs={arenaPreviewStartsAtMs}
                matchupLabel={arenaPreview.matchupLabel}
                arenaLabel={battleArenaLabel}
                watchReward={battleWatchReward}
                soundEnabled={gameSoundEnabled}
                onArenaAdvance={advanceArenaBattle}
              />
            )}
          </div>
          {!battleModeEnabled && (
            <>
              <MobileBattlePanels
                activePanel={mobileBattlePanel}
                onPanelChange={setMobileBattlePanel}
                battle={battle}
                left={left}
                right={right}
                pool={p2pPool}
                selectedSide={desktopSelectedSide}
                events={battle.events}
                quickTradeSideIndex={quickTradeSideIndex}
                quickTradeAmount={quickTradeAmount}
                onJoinSide={chooseDesktopSide}
                onStakeSide={openStakeDialog}
                onQuickTradeSideChange={setQuickTradeSideIndex}
                onQuickTradeAmountChange={setQuickTradeAmount}
              />

              <DesktopBattleTabs
                activeTab={desktopBattleTab}
                onTabChange={setDesktopBattleTab}
                battle={battle}
                left={left}
                right={right}
                pool={p2pPool}
                selectedSide={desktopSelectedSide}
                events={battle.events}
                onJoinSide={chooseDesktopSide}
              />
            </>
          )}
        </div>
      </div>

      <div className="hidden lg:flex w-64 flex-col bg-card border border-border rounded overflow-hidden shrink-0">
        <div className="border-b border-border px-2 py-2 shrink-0">
          <div className="flex items-center gap-1 rounded bg-background/70 p-0.5">
            {[
              { id: 'trollbox' as const, label: 'TrollBox' },
              { id: 'details' as const, label: 'Battle' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setDesktopSideTab(tab.id)}
                className={`flex-1 rounded px-2 py-1.5 text-[11px] font-black uppercase tracking-wide transition ${
                  desktopSideTab === tab.id
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {tab.label}
              </button>
            ))}
            <div className="ml-1 flex items-center gap-1 rounded-full bg-secondary/15 px-1.5 py-1 text-[10px] font-bold text-secondary">
              <span className="h-1.5 w-1.5 rounded-full bg-secondary animate-pulse" />
              <Users size={10} />
              <span>{trollboxUserCount}</span>
            </div>
          </div>
        </div>

        {desktopSideTab === 'trollbox' ? (
          <>
            <div
              ref={desktopTrollboxScrollRef}
              className="no-scrollbar flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden px-2 py-2 space-y-2"
            >
              {desktopTrollboxItems.length > 0 ? desktopTrollboxItems.map((item) => (
                <div key={item.id} className="flex items-start gap-1.5 text-xs">
                  {item.avatarUrl ? (
                    <img
                      src={item.avatarUrl}
                      alt={`${item.user} avatar`}
                      title={item.sourceLabel}
                      className="h-7 w-7 shrink-0 rounded-full border border-border bg-muted object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <span className={`shrink-0 text-xs font-bold px-1 py-0.5 rounded ${item.sourceClassName}`}>
                      {item.sourceLabel}
                    </span>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-bold text-foreground">{item.user}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{formatAgo(item.createdAt)}</span>
                    </div>
                    <div className="text-muted-foreground">
                      {item.statusIcon && (
                        <span className="mr-1" title={item.statusLabel || undefined}>
                          {item.statusIcon}
                        </span>
                      )}
                      {item.message}
                    </div>
                    {item.meta && <div className="mt-0.5 truncate text-[10px] text-muted-foreground/70">{item.meta}</div>}
                  </div>
                </div>
              )) : (
                <div className="rounded border border-border bg-muted/30 p-3 text-center text-xs text-muted-foreground">
                  TrollBox is quiet. Chat, Telegram, and Arena updates will appear here.
                </div>
              )}
            </div>

            <form onSubmit={submitChat} className="border-t border-border p-2 shrink-0">
              <div className="flex gap-1">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  placeholder="Say something..."
                  className="flex-1 bg-muted border border-border rounded px-2 py-1 text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary"
                />
                <button
                  type="submit"
                  disabled={isSendingChat}
                  className="p-1.5 bg-primary text-primary-foreground rounded hover:opacity-90 transition disabled:opacity-50"
                >
                  <Send size={12} />
                </button>
              </div>
            </form>
          </>
        ) : desktopSideTab === 'details' ? (
          <div className="min-h-0 flex-1 overflow-hidden p-2">
            <BattleDetailsPanel
              battle={battle}
              left={left}
              right={right}
              isChallengeBattle={isChallengeBattle}
              selectedSide={desktopSelectedSide}
              pool={p2pPool}
              watchReward={battleWatchReward}
              onJoinSide={chooseDesktopSide}
            />
          </div>
        ) : null}
      </div>
    </div>
      )}
      {!isExternalBattle && (
        <AgentBattleP2PStakeDialog
          battle={battle}
          side={stakeDialogSide}
          amount={stakeDialogAmount}
          pool={p2pPool}
          escrowTokenSymbol={battleEscrowToken}
          escrowChainId={battleEscrowChainId}
          contractEnabled={battleEscrowReady}
          walletAddress={walletAddress}
          isAuthenticated={isAuthenticated}
          authLoading={authLoading}
          isSubmitting={stakeMutation.isPending}
          onAmountChange={setStakeDialogAmount}
          onClose={() => setStakeDialogSide(null)}
          onLogin={login}
          onSubmit={() => stakeMutation.mutate()}
        />
      )}
    </>
  );
}


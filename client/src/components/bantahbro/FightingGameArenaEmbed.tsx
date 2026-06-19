import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getBattleTimeRemainingSeconds } from '@/lib/bantahbro/battleTiming';
import { arenaAgentAvatar } from '@/lib/arenaAgentAvatars';
import {
  deriveArenaGuiCue,
  mapBattleToArenaGuiState,
  type ArenaGuiCue,
  type ArenaGuiState,
} from '@/lib/bantahbro/arenaGuiMapper';
import type { AgentBattle } from '@/types/agentBattle';

export type BattleArenaStatus = 'live' | 'queued' | 'cancelled' | 'rematch';
export type BattleExperienceMode = 'arena' | 'challenge';

type FightingGameArenaEmbedProps = {
  compact?: boolean;
  flush?: boolean;
  battleMode?: BattleExperienceMode;
  battleStatus?: BattleArenaStatus;
  startsAtMs?: number | null;
  matchupLabel?: string;
  arenaLabel?: string;
  watchReward?: unknown;
  battle?: AgentBattle | null;
  soundEnabled?: boolean;
  onArenaAdvance?: (detail: { reason?: string; battleId?: string | null; roundKey?: string | null; generatedAt?: string }) => void;
};

type ArenaWatchRewardPayload = {
  enabled?: boolean;
  isAuthenticated?: boolean;
  watchedSeconds?: number;
  activeSeconds?: number;
  earnedForBattle?: number;
  lastAwardedPoints?: number;
  isAwarding?: boolean;
};

type FightingGameEngine = {
  start: () => Promise<void>;
  setSoundEnabled: (enabled: boolean) => void;
  applyArenaPayload: (payload: {
    type: 'bantahbro:arena-state';
    state: ArenaGuiState;
    cue: ArenaGuiCue | null;
    generatedAt: string;
    watchReward?: ArenaWatchRewardPayload | null;
  }) => void;
  destroy?: () => void;
};

type FightingGameEngineConstructor = new (options: {
  canvas: HTMLCanvasElement;
  timerElement: HTMLElement;
  dialogElement: HTMLElement;
  rootElement: HTMLElement;
  stagePath: string;
  fighterPaths: string[];
  autonomous: boolean;
  arenaSeed?: string;
  stageVariantId?: string | null;
  assetBasePath: string;
  soundEnabled?: boolean;
  onArenaAdvance?: (detail: { reason?: string; battleId?: string | null; roundKey?: string | null; generatedAt?: string }) => void;
}) => FightingGameEngine;

type ArenaTransitionState = {
  active: boolean;
  matchupLabel: string;
  arenaLabel: string;
  leftName: string;
  rightName: string;
  leftAvatar: string;
  rightAvatar: string;
};

declare global {
  interface Window {
    GameEngine?: FightingGameEngineConstructor;
    gameEngine?: FightingGameEngine | null;
  }
}

const FIGHTING_GAME_ASSET_VERSION = 'engine-20260614-sfx-fix02';
const GAME_SOUND_STORAGE_KEY = 'bota.game.soundEnabled';
const ARENA_SWITCH_MIN_MS = 180;
const FIGHTING_GAME_SCRIPT_PATHS = [
  'js/classes.js',
  'engine/AssetLoader.js',
  'engine/InputManager.js',
  'engine/CollisionSystem.js',
  'engine/MoveResolver.js',
  'engine/RoundManager.js',
  'engine/GameEngine.js',
] as const;

let fightingGameRuntimePromise: Promise<void> | null = null;

function ensureFightingGameStyles() {
  const href = `/2dgame/index.css?v=${FIGHTING_GAME_ASSET_VERSION}`;
  const existing = document.getElementById('bantah-fighting-game-styles') as HTMLLinkElement | null;
  if (existing) {
    if (!existing.href.endsWith(href)) existing.href = href;
    return;
  }

  const link = document.createElement('link');
  link.id = 'bantah-fighting-game-styles';
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

function loadFightingGameScript(path: string) {
  const id = `bantah-fighting-game-${path.replace(/[^a-z0-9]/gi, '-')}`;
  const existing = document.getElementById(id) as HTMLScriptElement | null;
  if (existing?.dataset.loaded === 'true') return Promise.resolve();
  if (existing) {
    return new Promise<void>((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Unable to load ${path}`)), {
        once: true,
      });
    });
  }

  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.id = id;
    script.src = `/2dgame/${path}?v=${FIGHTING_GAME_ASSET_VERSION}`;
    script.async = false;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error(`Unable to load ${path}`));
    document.body.appendChild(script);
  });
}

function loadFightingGameRuntime() {
  if (!fightingGameRuntimePromise) {
    fightingGameRuntimePromise = (async () => {
      ensureFightingGameStyles();
      if (!window.GameEngine) {
        for (const path of FIGHTING_GAME_SCRIPT_PATHS) {
          await loadFightingGameScript(path);
        }
      }
      if (!window.GameEngine) {
        throw new Error('Fighting game engine did not initialize');
      }
    })();
  }

  return fightingGameRuntimePromise;
}

function getInitialGameSoundEnabled() {
  if (typeof window === 'undefined') return true;
  try {
    const stored = window.localStorage.getItem(GAME_SOUND_STORAGE_KEY);
    return stored !== 'false';
  } catch {
    return true;
  }
}

function formatCountdown(totalSeconds: number) {
  const safe = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function splitMatchupNames(label: string) {
  const [left, right] = label.split(/\s+vs\s+/i);
  return [left || 'BOTA Agent Alpha', right || 'BOTA Agent Beta'] as const;
}

function toNonNegativeInteger(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.round(numeric));
}

const RARITY_COLORS: Record<string, string> = {
  epic: 'border-purple-400/70 bg-purple-900/40 text-purple-300',
  rare: 'border-blue-400/70 bg-blue-900/40 text-blue-300',
  common: 'border-amber-400/60 bg-amber-900/30 text-amber-300',
};

const SLOT_COUNT = 4;

type LoadoutTool = { id: string; name: string; imageUrl: string; type: string; rarity?: string };

function LoadoutSlots({
  tools,
  side,
}: {
  tools: LoadoutTool[];
  side: 'left' | 'right';
}) {
  const slots: Array<LoadoutTool | null> = [
    ...tools.slice(0, SLOT_COUNT),
    ...Array(Math.max(0, SLOT_COUNT - tools.length)).fill(null),
  ];

  return (
    <>
      {slots.map((tool, idx) => {
        if (tool) {
          return <ToolBadge key={`${side}-tool-${idx}`} tool={tool} side={side} idx={idx} />;
        }
        // Depleted / empty slot — slow dim pulse
        return (
          <div
            key={`${side}-empty-${idx}`}
            title="No tool equipped — get one in the Marketplace"
            className="flex h-8 w-8 md:h-11 md:w-11 items-center justify-center rounded-lg border border-white/8 bg-white/4 shadow-[0_0_8px_rgba(0,0,0,0.4)] backdrop-blur-sm"
            style={{ animation: 'bota-dim-pulse 3s ease-in-out infinite', animationDelay: `${idx * 0.7}s` }}
          >
            {/* cracked shield icon rendered as inline SVG so no asset dependency */}
            <svg viewBox="0 0 20 20" className="h-5 w-5 md:h-6 md:w-6" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M10 2L3 5v5c0 4 3.5 7 7 8 3.5-1 7-4 7-8V5L10 2z"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
                className="text-white/30"
              />
              <path
                d="M9 7l1 3-2 2 3-1 1 3"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-white/20"
              />
            </svg>
          </div>
        );
      })}
    </>
  );
}

function formatArenaCompactNumber(value: unknown) {
  const numeric = toNonNegativeInteger(value);
  if (numeric >= 1_000_000) return `${(numeric / 1_000_000).toFixed(numeric >= 10_000_000 ? 0 : 1)}M`;
  if (numeric >= 1_000) return `${(numeric / 1_000).toFixed(numeric >= 10_000 ? 0 : 1)}K`;
  return numeric.toLocaleString();
}

function formatArenaRankNumber(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  return Math.round(numeric).toLocaleString();
}

function stageVariantForArenaLabel(label?: string | null) {
  const normalized = String(label || '').trim().toLowerCase();
  if (normalized.includes('eliza')) return 'arena-elizaos';
  if (normalized.includes('virtual')) return 'arena-virtuals-protocol';
  return null;
}

function rankMovementDirection(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return undefined;
  return numeric > 0 ? 'up' : 'down';
}

function rankMovementAria(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return '';
  return numeric > 0
    ? `, climbed ${Math.abs(Math.round(numeric))} ranks`
    : `, dropped ${Math.abs(Math.round(numeric))} ranks`;
}

function normalizeWatchRewardPayload(value: unknown): ArenaWatchRewardPayload | null {
  if (!value || typeof value !== 'object') return null;
  const reward = value as Record<string, unknown>;
  return {
    enabled: Boolean(reward.enabled),
    isAuthenticated: Boolean(reward.isAuthenticated),
    watchedSeconds: toNonNegativeInteger(reward.watchedSeconds),
    activeSeconds: toNonNegativeInteger(reward.activeSeconds),
    earnedForBattle: toNonNegativeInteger(reward.earnedForBattle),
    lastAwardedPoints: toNonNegativeInteger(reward.lastAwardedPoints),
    isAwarding: Boolean(reward.isAwarding),
  };
}

function getOverlayCopy(status: BattleArenaStatus) {
  switch (status) {
    case 'queued':
      return {
        eyebrow: 'Queued Battle',
        title: 'Battle begins in',
        detail: 'Fighters are warming up. Arena preview is open.',
        tone: 'border-primary/30 bg-primary/10 text-primary',
      };
    case 'cancelled':
      return {
        eyebrow: 'Cancelled',
        title: 'Battle cancelled',
        detail: 'This matchup was pulled from the queue.',
        tone: 'border-destructive/20 bg-destructive/10 text-destructive',
      };
    case 'rematch':
      return {
        eyebrow: 'Rematch',
        title: 'Rematch pending',
        detail: 'Waiting for both fighters to accept the runback.',
        tone: 'border-border bg-muted/50 text-foreground',
      };
    default:
      return {
        eyebrow: 'Live',
        title: 'Battle live',
        detail: 'The match is underway.',
        tone: 'border-secondary/20 bg-secondary/10 text-secondary',
      };
  }
}

export function FightingGameArenaEmbed({
  compact = false,
  flush = false,
  battleMode = 'arena',
  battleStatus = 'live',
  startsAtMs = null,
  matchupLabel = 'BOTA Agent Alpha VS BOTA Agent Beta',
  arenaLabel = 'BOTA Arena',
  watchReward,
  battle = null,
  soundEnabled: controlledSoundEnabled,
  onArenaAdvance,
}: FightingGameArenaEmbedProps) {
  const [initialLeftName, initialRightName] = splitMatchupNames(matchupLabel);
  const [now, setNow] = useState(() => Date.now());
  const [arenaLoadError, setArenaLoadError] = useState<string | null>(null);
  const [internalGameSoundEnabled] = useState(getInitialGameSoundEnabled);
  const gameSoundEnabled = controlledSoundEnabled ?? internalGameSoundEnabled;
  const [arenaTransition, setArenaTransition] = useState<ArenaTransitionState>(() => ({
    active: true,
    matchupLabel,
    arenaLabel,
    leftName: initialLeftName,
    rightName: initialRightName,
    leftAvatar: arenaAgentAvatar(initialLeftName),
    rightAvatar: arenaAgentAvatar(initialRightName),
  }));
  const gameSoundEnabledRef = useRef(gameSoundEnabled);
  const arenaTransitionStartedAtRef = useRef(Date.now());
  const arenaTransitionTimeoutRef = useRef<number | null>(null);
  const lastArenaSeedRef = useRef<string | null>(null);
  const arenaRootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const timerRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<FightingGameEngine | null>(null);
  const previousBattleRef = useRef<AgentBattle | null>(null);
  const latestArenaPayloadRef = useRef<{
    state: ArenaGuiState;
    cue: ArenaGuiCue | null;
    watchReward?: ArenaWatchRewardPayload | null;
  } | null>(null);
  const showOverlay = battleStatus === 'queued';
  const overlayCopy = getOverlayCopy(battleStatus);
  const remainingSeconds = startsAtMs ? Math.max(0, (startsAtMs - now) / 1000) : 0;
  const syncedBattle = useMemo(() => {
    if (!battle) return null;
    const timeRemainingSeconds = getBattleTimeRemainingSeconds(
      battle.endsAt,
      battle.timeRemainingSeconds,
      now,
    );

    return {
      ...battle,
      status: timeRemainingSeconds > 0 ? 'live' : 'expired',
      timeRemainingSeconds,
    } satisfies AgentBattle;
  }, [battle, now]);
  const arenaState = useMemo(
    () => (syncedBattle ? mapBattleToArenaGuiState(syncedBattle) : null),
    [syncedBattle],
  );
  const normalizedWatchReward = useMemo(() => normalizeWatchRewardPayload(watchReward), [watchReward]);
  const liveSpectatorCount = Math.max(
    toNonNegativeInteger(arenaState?.spectators),
    toNonNegativeInteger(syncedBattle?.spectators),
  );
  // Add a time-based visual pulse so the spectator count feels live even when the
  // API hasn't changed the number yet (increments by 1 every ~47s of watching)
  const spectatorPulse = Math.floor((now / 1000 - 1718300000) / 47) % 3;
  const displaySpectators = liveSpectatorCount > 0 ? liveSpectatorCount + spectatorPulse : 0;
  const earnedBantCredits = Math.max(
    toNonNegativeInteger(arenaState?.bantCreditsEarned),
    toNonNegativeInteger(arenaState?.spectatorBantCredits),
    toNonNegativeInteger(syncedBattle?.bantCreditsEarned),
    toNonNegativeInteger(syncedBattle?.spectatorBantCredits),
    toNonNegativeInteger(normalizedWatchReward?.earnedForBattle),
  );
  const [fallbackLeftName, fallbackRightName] = splitMatchupNames(matchupLabel);
  const leftSide = arenaState?.left;
  const rightSide = arenaState?.right;
  const leftName = leftSide?.agentName || fallbackLeftName || 'BOTA Agent Alpha';
  const rightName = rightSide?.agentName || fallbackRightName || 'BOTA Agent Beta';
  const leftTeam = leftSide?.label || leftSide?.chainLabel || 'BOTA ARENA';
  const rightTeam = rightSide?.label || rightSide?.chainLabel || 'BOTA ARENA';
  const leftAvatar = leftSide?.avatarUrl || arenaAgentAvatar(leftName);
  const rightAvatar = rightSide?.avatarUrl || arenaAgentAvatar(rightName);
  const leftRank = formatArenaRankNumber(leftSide?.leaderboardRank || leftSide?.rank);
  const rightRank = formatArenaRankNumber(rightSide?.leaderboardRank || rightSide?.rank);
  const leftRankMove = rankMovementDirection(leftSide?.rankDelta);
  const rightRankMove = rankMovementDirection(rightSide?.rankDelta);
  const leftRankAria = rankMovementAria(leftSide?.rankDelta);
  const rightRankAria = rankMovementAria(rightSide?.rankDelta);
  const arenaSeed = syncedBattle?.id || arenaLabel || matchupLabel;
  const useBantahMascots = true;
  const fighterPaths = useMemo(
    () => [
      `/2dgame/data/fighters/bantah-mascot-green.json?v=${FIGHTING_GAME_ASSET_VERSION}`,
      `/2dgame/data/fighters/bantah-mascot-orange.json?v=${FIGHTING_GAME_ASSET_VERSION}`,
    ],
    [],
  );

  const applyArenaPayload = useCallback(
    (payload: { state: ArenaGuiState; cue: ArenaGuiCue | null; watchReward?: ArenaWatchRewardPayload | null } | null) => {
      if (!payload || !engineRef.current) return;
      engineRef.current.applyArenaPayload({
        type: 'bantahbro:arena-state',
        state: payload.state,
        cue: payload.cue,
        watchReward: payload.watchReward ?? null,
        generatedAt: new Date().toISOString(),
      });
    },
    [],
  );

  const clearArenaTransitionTimer = useCallback(() => {
    if (arenaTransitionTimeoutRef.current === null) return;
    window.clearTimeout(arenaTransitionTimeoutRef.current);
    arenaTransitionTimeoutRef.current = null;
  }, []);

  const finishArenaTransition = useCallback(
    (minimumMs = ARENA_SWITCH_MIN_MS) => {
      const elapsed = Date.now() - arenaTransitionStartedAtRef.current;
      const delay = Math.max(0, minimumMs - elapsed);

      clearArenaTransitionTimer();
      arenaTransitionTimeoutRef.current = window.setTimeout(() => {
        arenaTransitionTimeoutRef.current = null;
        setArenaTransition((current) => ({ ...current, active: false }));
      }, delay);
    },
    [clearArenaTransitionTimer],
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => clearArenaTransitionTimer, [clearArenaTransitionTimer]);

  useEffect(() => {
    gameSoundEnabledRef.current = gameSoundEnabled;
    try {
      window.localStorage.setItem(GAME_SOUND_STORAGE_KEY, String(gameSoundEnabled));
    } catch {
      // Mobile private browsing can block storage; keep the live engine state anyway.
    }
    engineRef.current?.setSoundEnabled(gameSoundEnabled);
    if (typeof window !== 'undefined' && window.__botaArenaMusicElement) {
      try {
        if (gameSoundEnabled) {
          window.__botaArenaMusicElement.play().catch(() => {});
        } else {
          window.__botaArenaMusicElement.pause();
        }
      } catch (e) {}
    }
  }, [gameSoundEnabled]);

  // Handle ambient audio unlock on user interaction if autoplay failed
  useEffect(() => {
    if (!gameSoundEnabled) return;

    const handleInteraction = () => {
      if (typeof window !== 'undefined' && window.__botaArenaMusicElement) {
        if (window.__botaArenaMusicElement.paused) {
          window.__botaArenaMusicElement.play().catch(() => {});
        }
      }
      cleanup();
    };

    const cleanup = () => {
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
      window.removeEventListener('touchstart', handleInteraction);
    };

    window.addEventListener('click', handleInteraction, { passive: true });
    window.addEventListener('keydown', handleInteraction, { passive: true });
    window.addEventListener('touchstart', handleInteraction, { passive: true });

    return cleanup;
  }, [gameSoundEnabled]);

  useEffect(() => {
    const nextArenaSeed = String(arenaSeed || matchupLabel || arenaLabel);
    if (lastArenaSeedRef.current === nextArenaSeed) return;

    lastArenaSeedRef.current = nextArenaSeed;
    previousBattleRef.current = null;
    latestArenaPayloadRef.current = arenaState
      ? { state: arenaState, cue: null, watchReward: normalizedWatchReward }
      : null;
    arenaTransitionStartedAtRef.current = Date.now();
    clearArenaTransitionTimer();
    setArenaTransition({
      active: true,
      matchupLabel,
      arenaLabel,
      leftName,
      rightName,
      leftAvatar,
      rightAvatar,
    });
  }, [
    arenaSeed,
    arenaState,
    matchupLabel,
    arenaLabel,
    leftName,
    rightName,
    leftAvatar,
    rightAvatar,
    normalizedWatchReward,
    clearArenaTransitionTimer,
  ]);

  useEffect(() => {
    let cancelled = false;
    let localEngine: FightingGameEngine | null = null;

    async function startArena() {
      try {
        await loadFightingGameRuntime();
        if (cancelled) return;

        const rootElement = arenaRootRef.current;
        const canvas = canvasRef.current;
        const timerElement = timerRef.current;
        const dialogElement = dialogRef.current;
        const Engine = window.GameEngine;

        if (!rootElement || !canvas || !timerElement || !dialogElement || !Engine) {
          throw new Error('Fighting game mount point is missing');
        }

        localEngine = new Engine({
          canvas,
          timerElement,
          dialogElement,
          rootElement,
          stagePath: `/2dgame/data/stages/hills.json?v=${FIGHTING_GAME_ASSET_VERSION}`,
          fighterPaths,
          autonomous: true,
          arenaSeed,
          stageVariantId: stageVariantForArenaLabel(arenaLabel),
          assetBasePath: '/2dgame/',
          soundEnabled: gameSoundEnabledRef.current,
          onArenaAdvance,
        });
        engineRef.current = localEngine;
        window.gameEngine = localEngine;

        await localEngine.start();
        if (cancelled) {
          localEngine.destroy?.();
          return;
        }

        setArenaLoadError(null);
        localEngine.setSoundEnabled(gameSoundEnabledRef.current);
        applyArenaPayload(latestArenaPayloadRef.current);
        finishArenaTransition();
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setArenaLoadError('Arena failed to load');
          finishArenaTransition(180);
          if (dialogRef.current) {
            dialogRef.current.style.display = 'flex';
            dialogRef.current.textContent = 'Arena failed to load';
          }
        }
      }
    }

    void startArena();

    return () => {
      cancelled = true;
      if (engineRef.current === localEngine) {
        engineRef.current = null;
      }
      localEngine?.destroy?.();
      if (typeof window !== 'undefined' && window.__botaArenaMusicElement) {
        try {
          window.__botaArenaMusicElement.pause();
        } catch (e) {}
      }
    };
  }, [applyArenaPayload, arenaLabel, arenaSeed, fighterPaths, finishArenaTransition, onArenaAdvance]);

  useEffect(() => {
    if (!arenaState || !syncedBattle) return;

    const cue = deriveArenaGuiCue(previousBattleRef.current, syncedBattle);
    previousBattleRef.current = syncedBattle;
    latestArenaPayloadRef.current = { state: arenaState, cue, watchReward: normalizedWatchReward };
    applyArenaPayload(latestArenaPayloadRef.current);
  }, [arenaState, applyArenaPayload, normalizedWatchReward, syncedBattle]);

  return (
    <section
      className={`bantahbro-next-ui relative overflow-hidden border border-border bg-background shadow-sm ${
        flush ? 'rounded-none border-x-0 border-t-0' : compact ? 'mx-1 mt-1 rounded-xl' : 'rounded-2xl'
      }`}
    >
      {/* Keyframes for loadout tool animations — injected once per arena mount */}
      <style>{`
        @keyframes bota-ring-burst {
          0%   { opacity: 1; transform: scale(1); }
          60%  { opacity: 0.4; transform: scale(1.55); }
          100% { opacity: 0; transform: scale(1.9); }
        }
        @keyframes bota-dim-pulse {
          0%, 100% { opacity: 0.28; }
          50%       { opacity: 0.46; }
        }
      `}</style>
      <div className="aspect-[16/9] w-full bg-background">
        <div
          ref={arenaRootRef}
          className={`bantah-fighting-game container ${useBantahMascots ? 'is-mascot-arena' : ''}`}
          aria-label="Bantah Battle Fighting Game"
        >
          <div className="top-indicator">
            <div className="player-card player1">
              <div className="avatar-ring">
                <img src={leftAvatar} alt={`${leftName} avatar`} />
                {leftRank ? (
                  <span
                    className="avatar-rank-badge"
                    data-rank-move={leftRankMove}
                    aria-label={`${leftName} leaderboard rank #${leftRank}${leftRankAria}`}
                  >
                    {leftRank}
                  </span>
                ) : null}
              </div>
              <div className="player-card-body">
                <div className="player-heading">
                  <div>
                    <div className="player-name">{leftName}</div>
                    <div className="player-team">{leftTeam}</div>
                  </div>
                  <div className="hp-readout">
                    <span className="hp-current">4070</span> / 4070
                  </div>
                </div>
                <div className="health-frame">
                  <div className="max-health" />
                  <div className="health" />
                </div>
                <div className="hud-abilities">
                  <span>ULT</span>
                </div>
                <div className="hud-rank-stars" aria-hidden="true">
                  <span className="is-filled" />
                  <span className="is-filled" />
                  <span className="is-filled" />
                  <span />
                  <span />
                </div>
              </div>
            </div>
            <div className="timer-panel">
              <div className="round-label">ROUND 1</div>
              <div ref={timerRef} className="timer">
                --
              </div>
              <div className="round-dots" aria-hidden="true">
                <span className="is-active" />
                <span className="is-active" />
                <span />
                <i />
                <span />
                <span />
                <span />
              </div>
            </div>
            <div className="player-card player2">
              <div className="player-card-body">
                <div className="player-heading">
                  <div>
                    <div className="player-name">{rightName}</div>
                    <div className="player-team">{rightTeam}</div>
                  </div>
                  <div className="hp-readout">
                    <span className="hp-current">4070</span> / 4070
                  </div>
                </div>
                <div className="health-frame">
                  <div className="max-health" />
                  <div className="health" />
                </div>
                <div className="hud-abilities">
                  <span>ULT</span>
                </div>
                <div className="hud-rank-stars" aria-hidden="true">
                  <span className="is-filled" />
                  <span className="is-filled" />
                  <span className="is-filled" />
                  <span />
                  <span />
                </div>
              </div>
              <div className="avatar-ring">
                <img src={rightAvatar} alt={`${rightName} avatar`} />
                {rightRank ? (
                  <span
                    className="avatar-rank-badge"
                    data-rank-move={rightRankMove}
                    aria-label={`${rightName} leaderboard rank #${rightRank}${rightRankAria}`}
                  >
                    {rightRank}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <div ref={dialogRef} className="dialog" />
          <div className="absolute left-2 top-1/2 z-40 flex -translate-y-1/2 flex-col gap-2">
            <LoadoutSlots tools={(leftSide?.loadoutTools || []) as LoadoutTool[]} side="left" />
          </div>
          <div className="absolute right-2 top-1/2 z-40 flex -translate-y-1/2 flex-col gap-2">
            <LoadoutSlots tools={(rightSide?.loadoutTools || []) as LoadoutTool[]} side="right" />
          </div>
          <canvas ref={canvasRef} />
        </div>
      </div>
      {arenaLoadError && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-background/50 px-4 text-center text-sm font-black uppercase tracking-wide text-foreground">
          {arenaLoadError}
        </div>
      )}
      {showOverlay && (
        <div
          data-arena-state-overlay={battleStatus}
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/50 px-4 backdrop-blur-[1px]"
        >
          <div className={`w-full max-w-sm rounded-lg border px-4 py-3 text-center shadow-2xl ${overlayCopy.tone}`}>
            <div className="text-[10px] font-black uppercase tracking-wide opacity-85">{overlayCopy.eyebrow}</div>
            <div className="mt-1 text-sm font-black uppercase tracking-wide text-foreground">{matchupLabel}</div>
            <div className="mt-2 text-xs font-bold uppercase opacity-80">{overlayCopy.title}</div>
            {battleStatus === 'queued' ? (
              <div className="mt-1 font-mono text-4xl font-black leading-none text-foreground">
                {formatCountdown(remainingSeconds)}
              </div>
            ) : (
              <div className="mt-1 text-3xl font-black leading-none text-foreground">{battleStatus.toUpperCase()}</div>
            )}
            <div className="mt-2 text-xs font-bold text-foreground opacity-80">{arenaLabel}</div>
            <div className="mt-1 text-[11px] leading-snug text-foreground opacity-65">{overlayCopy.detail}</div>
          </div>
        </div>
      )}
    </section>
  );
}


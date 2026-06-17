'use client';

import { lazy, Suspense, useState, useEffect, type ReactNode } from 'react';
import Sidebar from '@/components/layout/sidebar';
import TopBar from '@/components/layout/topbar';
import type { MainContentTopTab } from '@/components/layout/main-content';
import MobileBottomNav from '@/components/layout/mobile-bottom-nav';
import { botaAppHref } from '@/lib/botaUrl';
import type { BantahBroWalletAction } from '@shared/bantahBroWallet';
import { decodeBantahBroWalletActionParam } from '@shared/bantahBroWalletDeepLink';

const MainContent = lazy(() => import('@/components/layout/main-content'));
const RightPanel = lazy(() => import('@/components/layout/right-panel'));
const ChatPage = lazy(() => import('@/components/pages/chat-page'));
const FeedPage = lazy(() => import('@/components/pages/feed-page'));
const LeaderboardPage = lazy(() => import('@/components/pages/leaderboard-page'));
const ProfilePage = lazy(() => import('@/components/pages/profile-page'));
const NotificationsPage = lazy(() => import('@/components/pages/notifications-page'));
const BattlesPage = lazy(() => import('@/components/pages/battles-page'));
const RugScorerPage = lazy(() => import('@/components/pages/rug-scorer-page'));
const ImportPage = lazy(() => import('@/components/pages/import-page'));
const AgentsPage = lazy(() => import('@/components/pages/agents-page'));
const AdsPage = lazy(() => import('@/components/pages/ads-page'));
const RewardsPage = lazy(() => import('@/components/pages/rewards-page'));
const DocsPage = lazy(() => import('@/components/pages/docs-page'));
const MarketplacePage = lazy(() => import('@/components/pages/marketplace-page'));
const CommunitiesPage = lazy(() => import('@/components/pages/communities-page'));
const PolymarketBattlePage = lazy(() => import('@/components/pages/polymarket-battle-page'));
const AgentManagementPage = lazy(() => import('@/pages/AgentManagement'));
const ChallengeRightSidebar = lazy(() =>
  import('@/components/pages/challenge-page').then((module) => ({ default: module.ChallengeRightSidebar })),
);
const ARENA_PREVIEW_EVENT = 'bantahbro:arena-preview-change';

function BotaSectionFallback() {
  return null;
}

export type AppSection =
  | 'challenge'
  | 'dashboard'
  | 'feed'
  | 'chat'
  | 'battles'
  | 'leaderboard'
  | 'rewards'
  | 'agents'
  | 'fighters'
  | 'marketplace'
  | 'communities'
  | 'ads'
  | 'docs'
  | 'notifications'
  | 'rug-scorer'
  | 'import'
  | 'launcher'
  | 'profile'
  | 'prediction'
  | 'prediction-battle';

export type BantahTool =
  | 'assistant'
  | 'wallet'
  | 'discover'
  | 'battle'
  | 'analyze'
  | 'rug'
  | 'runner'
  | 'alerts'
  | 'markets'
  | 'bxbt'
  | 'launcher';

export default function Home({
  initialSection = 'battles',
  initialDashboardTab = 'battles',
  initialPredictionBattleId = '',
}: {
  initialSection?: AppSection;
  initialDashboardTab?: MainContentTopTab;
  initialPredictionBattleId?: string;
}) {
  const [selectedToken, setSelectedToken] = useState('BOTA');
  const [isMounted, setIsMounted] = useState(false);
  const [activeSection, setActiveSection] = useState<AppSection>(
    initialSection === 'dashboard' ? 'challenge' : initialSection === 'launcher' ? 'import' : initialSection,
  );
  const [predictionBattleId] = useState(initialPredictionBattleId);
  const [activeTool, setActiveTool] = useState<BantahTool>('assistant');
  const [pendingWalletAction, setPendingWalletAction] = useState<BantahBroWalletAction | null>(null);
  const [kothSubView, setKothSubView] = useState<'koth' | 'arena'>('koth');

  const normalizeSection = (section: AppSection): AppSection =>
    section === 'dashboard' ? 'challenge' : section === 'launcher' ? 'import' : section;

  const syncSectionUrl = (section: AppSection, battleId?: string | null) => {
    if (typeof window === 'undefined') return;

    const normalizedSection = normalizeSection(section);

    if (normalizedSection === 'rewards') {
      const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
      const rawBasePath = currentPath.startsWith('/bota')
        ? '/bota'
        : currentPath.startsWith('/battle')
          ? '/battle'
          : currentPath.startsWith('/bantahbro')
            ? '/bantahbro'
            : '';
      const basePath = rawBasePath.startsWith('/bota')
        ? botaAppHref(rawBasePath).replace(/\/+$/, '')
        : rawBasePath;
      window.history.replaceState({}, '', `${basePath}/rewards`);
      return;
    }

    const params = new URLSearchParams(window.location.search);
    params.set('section', normalizedSection);

    if (normalizedSection === 'battles' && battleId?.trim()) {
      params.set('battle', battleId.trim());
      params.set('battleLayer', 'arena');
      params.delete('arenaState');
      params.delete('arenaStartsAt');
      params.delete('arenaMatchup');
      params.delete('arenaLabel');
      params.delete('arenaPreviewId');
    } else {
      params.delete('battle');
      if (normalizedSection !== 'battles') {
        params.delete('battleLayer');
        params.delete('arenaState');
        params.delete('arenaStartsAt');
        params.delete('arenaMatchup');
        params.delete('arenaLabel');
        params.delete('arenaPreviewId');
      }
    }

    const queryString = params.toString();
    const currentPathname = botaAppHref(window.location.pathname);
    let nextPathname = currentPathname;
    if (normalizedSection !== 'rewards' && nextPathname.endsWith('/rewards')) {
      nextPathname = nextPathname.replace(/\/rewards$/, '') || '/';
    }
    const nextUrl = `${nextPathname}${queryString ? `?${queryString}` : ''}`;
    window.history.replaceState({}, '', nextUrl);
  };

  const handleNavigate = (section: AppSection) => {
    const normalizedSection = normalizeSection(section);
    setActiveSection(normalizedSection);
    syncSectionUrl(section);
  };

  const handleOpenBattle = (battleId: string) => {
    syncSectionUrl('battles', battleId);
    setActiveSection('battles');
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        window.dispatchEvent(new Event(ARENA_PREVIEW_EVENT));
      }, 0);
    }
  };

  useEffect(() => {
    setIsMounted(true);

    const params = new URLSearchParams(window.location.search);
    const sectionParam = params.get('section');
    const toolParam = params.get('tool');
    const walletActionParam = params.get('walletAction');

    if (
      sectionParam === 'chat' ||
      sectionParam === 'challenge' ||
      sectionParam === 'dashboard' ||
      sectionParam === 'feed' ||
      sectionParam === 'battles' ||
      sectionParam === 'leaderboard' ||
      sectionParam === 'rewards' ||
      sectionParam === 'agents' ||
      sectionParam === 'fighters' ||
      sectionParam === 'marketplace' ||
      sectionParam === 'communities' ||
      sectionParam === 'ads' ||
      sectionParam === 'docs' ||
      sectionParam === 'notifications' ||
      sectionParam === 'rug-scorer' ||
      sectionParam === 'import' ||
      sectionParam === 'launcher' ||
      sectionParam === 'profile' ||
      sectionParam === 'prediction' ||
      sectionParam === 'prediction-battle'
    ) {
      setActiveSection(normalizeSection(sectionParam));
    }

    if (
      toolParam === 'assistant' ||
      toolParam === 'wallet' ||
      toolParam === 'discover' ||
      toolParam === 'battle' ||
      toolParam === 'analyze' ||
      toolParam === 'rug' ||
      toolParam === 'runner' ||
      toolParam === 'alerts' ||
      toolParam === 'markets' ||
      toolParam === 'bxbt' ||
      toolParam === 'launcher'
    ) {
      setActiveTool(toolParam);
    }

    const decodedWalletAction = decodeBantahBroWalletActionParam(walletActionParam);
    if (decodedWalletAction) {
      setActiveSection('chat');
      setActiveTool('wallet');
      setPendingWalletAction(decodedWalletAction);
    }
  }, []);

  if (!isMounted) return null;

  const renderWithPanel = (content: ReactNode, panel: ReactNode, rightPanelClassName = 'hidden lg:flex') => (
    <div className="flex-1 flex gap-0.5 overflow-hidden p-0.5 pb-20 md:pb-0.5 flex-col md:flex-row">
      <div className="flex-1 min-w-0 flex overflow-hidden">
        {content}
      </div>
      <div className={rightPanelClassName}>
        {panel}
      </div>
    </div>
  );

  const renderWithRightPanel = (content: ReactNode, rightPanelClassName = 'hidden lg:flex') =>
    renderWithPanel(
      content,
      <RightPanel
        selectedToken={selectedToken}
        activeSection={activeSection}
        onNavigate={handleNavigate}
        onOpenBattle={handleOpenBattle}
      />,
      rightPanelClassName,
    );

  const renderPage = () => {
    switch (activeSection) {
      case 'feed':
        return renderWithRightPanel(<FeedPage />);
      case 'chat':
        return renderWithRightPanel(
          <ChatPage
            activeTool={activeTool}
            onToolChange={setActiveTool}
            pendingWalletAction={pendingWalletAction}
          />,
        );
      case 'battles':
        return (
          <div className="flex-1 flex overflow-hidden p-0">
            <BattlesPage onNavigate={handleNavigate} />
          </div>
        );
      case 'leaderboard':
        return renderWithRightPanel(<LeaderboardPage />);
      case 'rewards':
        return (
          <div className="flex-1 flex overflow-hidden p-0.5 pb-20 md:pb-0.5">
            <RewardsPage />
          </div>
        );
      case 'polymarket':
        return <PolymarketBattlePage />;
      case 'agents':
        return renderWithRightPanel(<AgentsPage />);
      case 'fighters':
        return (
          <div className="flex-1 flex overflow-hidden p-0.5 pb-20 md:pb-0.5">
            <AgentManagementPage />
          </div>
        );
      case 'marketplace':
        return renderWithRightPanel(<MarketplacePage onNavigate={handleNavigate} />);
      case 'communities':
        return renderWithRightPanel(<CommunitiesPage />);
      case 'ads':
        return renderWithRightPanel(<AdsPage />);
      case 'docs':
        return (
          <div className="flex-1 flex overflow-hidden p-0.5 pb-20 md:pb-0.5">
            <DocsPage />
          </div>
        );
      case 'notifications':
        return renderWithRightPanel(<NotificationsPage />);
      case 'rug-scorer':
        return renderWithRightPanel(<RugScorerPage />);
      case 'import':
      case 'launcher':
        return renderWithRightPanel(<ImportPage />);
      case 'profile':
        return renderWithRightPanel(<ProfilePage />);
      case 'prediction-battle':
        return (
          <div className="flex-1 flex overflow-hidden p-0">
            <PolymarketBattlePage battleId={predictionBattleId} />
          </div>
        );
      default:
        {
          const content = (
            <MainContent
              selectedToken={selectedToken}
              setSelectedToken={setSelectedToken}
              activeSection={activeSection}
              onNavigate={handleNavigate}
              onOpenBattle={handleOpenBattle}
              initialTab={initialDashboardTab}
            />
          );

          if (activeSection === 'challenge') {
            return renderWithPanel(content, <ChallengeRightSidebar />, 'hidden lg:flex');
          }

          return renderWithRightPanel(
            content,
            activeSection === 'prediction' ? 'w-full md:w-auto' : 'hidden lg:flex'
          );
        }
    }
  };

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      <div className="hidden md:flex">
        <Sidebar
          activeSection={activeSection}
          onNavigate={handleNavigate}
        />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="block">
          <TopBar
            onNavigate={handleNavigate}
            onOpenBattle={handleOpenBattle}
            activeSection={activeSection}
            activeTool={activeTool}
            onToolSelect={setActiveTool}
          />
        </div>
        <Suspense fallback={<BotaSectionFallback />}>
          {renderPage()}
        </Suspense>
      </div>

      <MobileBottomNav activeSection={activeSection} onNavigate={handleNavigate} />
    </div>
  );
}

import React, { useEffect, useState } from "react";
import { Router, Switch, Route, useLocation } from "wouter";
import { apiRequest, queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/contexts/ThemeProvider";
import { EventsSearchProvider } from "./context/EventsSearchContext";
import { useAuth } from "@/hooks/useAuth";
import { useNotifications } from "@/hooks/useNotifications";
import { useToast } from '@/hooks/use-toast';
import { pushNotificationService } from "@/lib/pushNotifications";

import { useDailyLoginPopup } from '@/hooks/useDailyLoginPopup';
import { WebsiteTour, useTour } from "@/components/WebsiteTour";
import AddToHomePrompt from "@/components/AddToHomePrompt";
import { ErrorBoundary } from "react-error-boundary";
import { Suspense, lazy } from "react";
import { PrivyProvider } from '@privy-io/react-auth';
import type { PrivyClientConfig } from '@privy-io/react-auth';
import { privyConfig } from './lib/privyConfig';
import type { AppSection } from '@/app/page';

const NotFound = lazy(() => import("@/pages/not-found"));
const Landing = lazy(() => import("@/pages/Landing"));
const Home = lazy(() => import("@/pages/Home"));
const Events = lazy(() => import("./pages/Events"));
const EventCreate = lazy(() => import("./pages/EventCreate"));
const Friends = lazy(() => import("./pages/Friends"));
const Profile = lazy(() => import("./pages/Profile"));
const ProfileEdit = lazy(() => import("./pages/ProfileEdit"));
const ProfileSettings = lazy(() => import("./pages/ProfileSettings"));
const History = lazy(() => import("./pages/History"));
const Notifications = lazy(() => import("./pages/Notifications"));
const WalletPage = lazy(() => import("@/pages/WalletPage"));
const Shop = lazy(() => import("@/pages/Shop"));
const ReferralNew = lazy(() => import("./pages/ReferralNew"));
const Settings = lazy(() => import("@/pages/Settings"));
const SupportChat = lazy(() => import("@/pages/SupportChat"));
const HelpSupport = lazy(() => import("@/pages/HelpSupport"));
const TermsOfService = lazy(() => import("@/pages/TermsOfService"));
const PrivacyPolicy = lazy(() => import("@/pages/PrivacyPolicy"));
const DataDeletionRequest = lazy(() => import("@/pages/DataDeletionRequest"));
const About = lazy(() => import("./pages/About"));
const PointsAndBadges = lazy(() => import("./pages/PointsAndBadges"));
const ChallengeDetail = lazy(() => import("./pages/ChallengeDetail"));
const Recommendations = lazy(() => import("./pages/Recommendations"));
const EventChatPage = lazy(() => import("./pages/EventChatPage"));
const EventDetails = lazy(() => import("./pages/EventDetails"));
const ChallengeChatPage = lazy(() => import("./pages/ChallengeChatPage"));
const AdminLogin = lazy(() => import("@/pages/AdminLogin"));
const AdminDashboardOverview = lazy(() => import("./pages/AdminDashboardOverview"));
const AdminEventPayouts = lazy(() => import("./pages/AdminEventPayouts"));
const AdminChallengePayouts = lazy(() => import("./pages/AdminChallengePayouts"));
const AdminChallengeCreate = lazy(() => import("./pages/AdminChallengeCreate"));
const AdminChallengeDisputes = lazy(() => import("./pages/AdminChallengeDisputes"));
const AdminTransactions = lazy(() => import("./pages/AdminTransactions"));
const AdminPayoutDashboard = lazy(() => import("./pages/AdminPayoutDashboard"));
const AdminAnalytics = lazy(() => import("./pages/AdminAnalytics"));
const AdminBonusConfiguration = lazy(() => import("./pages/AdminBonusConfiguration"));
const AdminNotifications = lazy(() => import("@/pages/AdminNotifications"));
const AdminUsersManagement = lazy(() => import("./pages/AdminUsersManagement"));
const AdminSettings = lazy(() => import("./pages/AdminSettings"));
const AdminWallet = lazy(() => import("./pages/AdminWallet"));
const AdminTreasury = lazy(() => import("./pages/AdminTreasury"));
const AdminPartners = lazy(() => import("./pages/AdminPartners"));
const AdminRugScorerReports = lazy(() => import("./pages/AdminRugScorerReports"));
const TelegramLink = lazy(() => import("@/pages/TelegramLink"));
const Bantzz = lazy(() => import("./pages/Bantzz"));
const Stories = lazy(() => import("./pages/Stories"));
const BantMap = lazy(() => import("./pages/BantMap"));
const NotificationTest = lazy(() => import("./pages/NotificationTest"));
const BotaNotificationsPage = lazy(() => import("./pages/BotaNotificationsPage"));
const PublicProfile = lazy(() => import("@/pages/PublicProfile"));
const DailyLoginModal = lazy(() =>
  import("@/components/DailyLoginModal").then((module) => ({ default: module.DailyLoginModal })),
);
const Navigation = lazy(() =>
  import("@/components/Navigation").then((module) => ({ default: module.Navigation })),
);

const Challenges = lazy(() => import("./pages/Challenges"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const Agents = lazy(() => import("./pages/Agents"));
const AgentDetail = lazy(() => import("./pages/AgentDetail"));
const BantahBro = lazy(() => import("./pages/BantahBro"));
const BantahBroBattles = lazy(() => import("./pages/BantahBroBattles"));
const BantahBroBattlesDuplicate = lazy(() => import("./pages/BantahBroBattlesDuplicate"));
const BantahBroAgents = lazy(() => import("./pages/BantahBroAgents"));
const BantahBroMarketplace = lazy(() => import("./pages/BantahBroMarketplace"));
const BantahBroCommunities = lazy(() => import("./pages/BantahBroCommunities"));
const BantahBroAds = lazy(() => import("./pages/BantahBroAds"));
const BantahBroRewards = lazy(() => import("./pages/BantahBroRewards"));
const BantahBroDocs = lazy(() => import("./pages/BantahBroDocs"));
const BantahBroImport = lazy(() => import("./pages/BantahBroImport"));
const BantahBroLauncher = lazy(() => import("./pages/BantahBroLauncher"));
const BantahBroPolymarket = lazy(() => import("./pages/BantahBroPolymarket"));
const BantahBroPolymarketBattle = lazy(() => import("./pages/BantahBroPolymarketBattle"));
const BantahBroRugScorer = lazy(() => import("./pages/BantahBroRugScorer"));
const BantahBroFighters = lazy(() => import("./pages/BantahBroFighters"));
const AdminBantahBroEngine = lazy(() => import("./pages/AdminBantahBroEngine"));
const PartnerPrograms = lazy(() => import("./pages/PartnerPrograms"));
const PartnerSignup = lazy(() => import("./pages/PartnerSignup"));
const Skills = lazy(() => import("./pages/Skills"));

const BATTLE_BANTAH_HOST = 'battle.bantah.fun';
const BOTA_BANTAH_HOST = 'bota.bantah.fun';

function isBattleBantahHost() {
  return typeof window !== 'undefined' && window.location.hostname.toLowerCase() === BATTLE_BANTAH_HOST;
}

function isBotaBantahHost() {
  return typeof window !== 'undefined' && window.location.hostname.toLowerCase() === BOTA_BANTAH_HOST;
}

function normalizeRoutePath(pathname: string) {
  const normalized = pathname.toLowerCase().replace(/\/+$/, '');
  return normalized || '/';
}

function isBattleBantahClonePath(pathname: string) {
  const normalized = normalizeRoutePath(pathname);

  return (
    normalized === '/' ||
    normalized === '/battle-engine/live' ||
    normalized === '/arena' ||
    normalized === '/battles' ||
    normalized === '/agents' ||
    normalized === '/leaderboard' ||
    normalized === '/ads' ||
    normalized === '/rewards' ||
    normalized === '/docs' ||
    normalized === '/import' ||
    normalized === '/launcher' ||
    normalized === '/polymarket' ||
    normalized === '/rug-scorer' ||
    normalized.startsWith('/polymarket/')
  );
}

function isBattleAliasPath(pathname: string) {
  const normalized = normalizeRoutePath(pathname);
  return normalized === '/battle' || normalized.startsWith('/battle/');
}

function isBotaAliasPath(pathname: string) {
  const normalized = normalizeRoutePath(pathname);
  return normalized === '/bota' || normalized.startsWith('/bota/');
}

function isBantahBroPath(pathname: string) {
  const normalized = normalizeRoutePath(pathname);
  return (
    normalized.startsWith('/bota') ||
    normalized.startsWith('/bantahbro') ||
    normalized === '/agents' ||
    pathname === '/Agents' ||
    normalized.startsWith('/ads') ||
    normalized.startsWith('/docs') ||
    normalized.startsWith('/import') ||
    normalized.startsWith('/launcher') ||
    normalized.startsWith('/rug-scorer')
  );
}

function DefaultRouteFallback() {
  return null;
}

function AdminEngineRedirect() {
  useEffect(() => {
    window.location.replace('/admin/bantahbro-engine');
  }, []);

  return <DefaultRouteFallback />;
}

function getInitialBantahBroSectionFromQuery(): AppSection | undefined {
  if (typeof window === 'undefined') return undefined;

  const section = new URLSearchParams(window.location.search).get('section');
  if (section === 'dashboard') return 'challenge';
  if (section === 'launcher') return 'import';
  if (
    section === 'chat' ||
    section === 'challenge' ||
    section === 'feed' ||
    section === 'battles' ||
    section === 'leaderboard' ||
    section === 'agents' ||
    section === 'marketplace' ||
    section === 'communities' ||
    section === 'ads' ||
    section === 'docs' ||
    section === 'notifications' ||
    section === 'rug-scorer' ||
    section === 'import' ||
    section === 'profile' ||
    section === 'prediction' ||
    section === 'prediction-battle'
  ) {
    return section;
  }

  return undefined;
}

function BantahBroHome() {
  return <BantahBro initialSection={getInitialBantahBroSectionFromQuery()} />;
}

function BantahBroChallenge() {
  return <BantahBro initialSection="challenge" />;
}

function BantahBroLeaderboard() {
  return <BantahBro initialSection="leaderboard" />;
}

function AppRouter() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const [location] = useLocation();

  // Initialize tour
  const tour = useTour();

  // Add global tour event listener
  useEffect(() => {
    const handleStartTour = () => {
      tour.startTour();
    };

    window.addEventListener('start-tour', handleStartTour);

    return () => {
      window.removeEventListener('start-tour', handleStartTour);
    };
  }, [tour]);

  // Register browser push only after auth is ready so the subscription can be stored.
  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    pushNotificationService.ensureSubscribed().catch((error) => {
      console.error('Push notification subscription failed:', error);
    });
  }, [isAuthenticated, isLoading]);

  // Initialize notifications for authenticated users
  const notifications = useNotifications();

  const { toast } = useToast();

  // Initialize automatic daily login popup
  const { showDailyLoginPopup, closeDailyLoginPopup, dailyLoginStatus } = useDailyLoginPopup();

  // Auto-complete Telegram link flow after login
  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) return;

    try {
      const params = new URLSearchParams(window.location.search);
      const telegramTokenFromUrl = params.get('telegram_token');
      const telegramTokenFromStorage = typeof window !== 'undefined' ? sessionStorage.getItem('telegram_token') : null;
      const telegramToken = telegramTokenFromUrl || telegramTokenFromStorage;

      if (!telegramToken) return;

      // If token exists in sessionStorage but user isn't on /telegram-link, navigate there (no reload)
      try {
        const stored = telegramTokenFromStorage;
        if (stored && !telegramTokenFromUrl && window.location.pathname !== '/telegram-link') {
          const newPath = `/telegram-link?telegram_token=${stored}`;
          window.history.replaceState({}, '', newPath);
        }
      } catch (_) {}

      (async () => {
        const maxAttempts = 5;
        let attempt = 0;
        let success = false;

        while (attempt < maxAttempts && !success) {
          attempt += 1;
          try {
            const res = await apiRequest('GET', `/api/telegram/verify-link?token=${telegramToken}`);

            if (res && res.success) {
              toast({ title: 'Telegram Linked', description: 'Your Telegram account was linked after sign-in.' });
              success = true;
              break;
            } else {
              // If backend reports invalid token or already linked, stop retrying
              toast({ title: 'Telegram Link Failed', description: res?.message || 'Unable to link Telegram account', variant: 'destructive' });
              break;
            }
          } catch (err: any) {
            // If auth wasn't ready yet (401) or token not present, retry after a short delay
            const message = String(err.message || err);
            const isAuthError = message.includes('401') || message.toLowerCase().includes('authorization');

            if (isAuthError && attempt < maxAttempts) {
              await new Promise((r) => setTimeout(r, attempt * 1000));
              continue;
            }

            // Non-auth error or out of retries
            toast({ title: 'Telegram Link Error', description: 'Failed to verify Telegram link after sign-in', variant: 'destructive' });
            break;
          }
        }

        // cleanup
        try {
          params.delete('telegram_token');
          const newSearch = params.toString();
          const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '');
          window.history.replaceState({}, '', newUrl);
        } catch (_) {}

        try {
          sessionStorage.removeItem('telegram_token');
        } catch (_) {}
      })();
    } catch (error) {
      // ignore
    }
  }, [isAuthenticated, isLoading, toast]);

  const isAdminRoute = location.startsWith('/admin');
  const isBattleBantahClone = isBattleBantahHost();
  const isBotaBantahClone = isBotaBantahHost();
  const isBotaOnlyHost = isBattleBantahClone || isBotaBantahClone;
  const isBantahBroRoute =
    isBantahBroPath(location) ||
    isBattleAliasPath(location) ||
    isBotaAliasPath(location) ||
    (isBotaOnlyHost && isBattleBantahClonePath(location));

  // Keep BOTA fast: render its public shell while auth finishes in the background.
  if (isLoading && !isBantahBroRoute) {
    return null;
  }

  return (
    <div className="min-h-screen transition-all duration-300 ease-in-out">
      {/* Show Navigation for all users except on landing page and admin routes */}
      {!isLoading && !isAdminRoute && !isBantahBroRoute && (
        <div className="sticky top-0 z-50">
          <Suspense fallback={null}>
            <Navigation />
          </Suspense>
        </div>
      )}

      <Suspense
        fallback={isBantahBroRoute ? null : <DefaultRouteFallback />}
      >
      <Switch>
      {/* Admin Login Route - Always Available */}
      <Route path="/admin/login" component={AdminLogin} />
      <Route path="/admin-login" component={AdminLogin} />

      {/* Public profile routes - accessible to everyone */}
      <Route path="/@:username" component={PublicProfile} />
      <Route path="/u/:username" component={PublicProfile} />

      {/* Telegram link - public (used by Telegram web login) */}
      <Route path="/telegram-link" component={TelegramLink} />
      <Route path="/telegram-auth" component={TelegramLink} />
      {/* Public Routes - Accessible to everyone */}
      <Route path="/about" component={About} />
      <Route path="/skills" component={Skills} />
      <Route path="/partners" component={PartnerPrograms} />
      <Route path="/partner-signup" component={PartnerSignup} />

      <Route path="/bota/battle-engine/live" component={AdminEngineRedirect} />
      <Route path="/bota/challenge" component={BantahBroChallenge} />
      <Route path="/bota/arena" component={BantahBroBattles} />
      <Route path="/bota/battles" component={BantahBroBattles} />
      <Route path="/bota/battles-duplicate" component={BantahBroBattlesDuplicate} />
      <Route path="/bota/agents" component={BantahBroAgents} />
      <Route path="/bota/fighters" component={BantahBroFighters} />
      <Route path="/bota/marketplace" component={BantahBroMarketplace} />
      <Route path="/bota/communities" component={BantahBroCommunities} />
      <Route path="/bota/rewards" component={BantahBroRewards} />
      <Route path="/bota/docs" component={BantahBroDocs} />
      <Route path="/bota/ads" component={BantahBroAds} />
      <Route path="/bota/import" component={BantahBroImport} />
      <Route path="/bota/launcher" component={BantahBroLauncher} />
      <Route path="/bota/polymarket/:battleId" component={BantahBroPolymarketBattle} />
      <Route path="/bota/polymarket" component={BantahBroPolymarket} />
      <Route path="/bota/rug-scorer" component={BantahBroRugScorer} />
      <Route path="/bota/notifications" component={BotaNotificationsPage} />
      <Route path="/bota" component={BantahBroHome} />
      <Route path="/bota/" component={BantahBroHome} />

      <Route path="/battle/battle-engine/live" component={AdminEngineRedirect} />
      <Route path="/battle/challenge" component={BantahBroChallenge} />
      <Route path="/battle/battles" component={BantahBroBattles} />
      <Route path="/battle/battles-duplicate" component={BantahBroBattlesDuplicate} />
      <Route path="/battle/agents" component={BantahBroAgents} />
      <Route path="/battle/marketplace" component={BantahBroMarketplace} />
      <Route path="/battle/communities" component={BantahBroCommunities} />
      <Route path="/battle/rewards" component={BantahBroRewards} />
      <Route path="/battle/docs" component={BantahBroDocs} />
      <Route path="/battle/ads" component={BantahBroAds} />
      <Route path="/battle/import" component={BantahBroImport} />
      <Route path="/battle/launcher" component={BantahBroLauncher} />
      <Route path="/battle/polymarket/:battleId" component={BantahBroPolymarketBattle} />
      <Route path="/battle/polymarket" component={BantahBroPolymarket} />
      <Route path="/battle/rug-scorer" component={BantahBroRugScorer} />
      <Route path="/battle/notifications" component={BotaNotificationsPage} />
      <Route path="/battle" component={BantahBroHome} />
      <Route path="/battle/" component={BantahBroHome} />

      {isBotaOnlyHost && (
        <>
          <Route path="/battle-engine/live" component={AdminEngineRedirect} />
          <Route path="/challenge" component={BantahBroChallenge} />
          <Route path="/arena" component={BantahBroBattles} />
          <Route path="/battles" component={BantahBroBattles} />
          <Route path="/battles-duplicate" component={BantahBroBattlesDuplicate} />
          <Route path="/agents" component={BantahBroAgents} />
          <Route path="/marketplace" component={BantahBroMarketplace} />
          <Route path="/communities" component={BantahBroCommunities} />
          <Route path="/leaderboard" component={BantahBroLeaderboard} />
          <Route path="/rewards" component={BantahBroRewards} />
          <Route path="/docs" component={BantahBroDocs} />
          <Route path="/ads" component={BantahBroAds} />
          <Route path="/import" component={BantahBroImport} />
          <Route path="/launcher" component={BantahBroLauncher} />
          <Route path="/polymarket/:battleId" component={BantahBroPolymarketBattle} />
          <Route path="/polymarket" component={BantahBroPolymarket} />
          <Route path="/rug-scorer" component={BantahBroRugScorer} />
          <Route path="/notifications" component={BotaNotificationsPage} />
          <Route path="/" component={BantahBroHome} />
        </>
      )}

      <Route path="/bantahbro/battle-engine/live" component={AdminEngineRedirect} />
      <Route path="/bantahbro/challenge" component={BantahBroChallenge} />
      <Route path="/bantahbro/battles" component={BantahBroBattles} />
      <Route path="/bantahbro/battles-duplicate" component={BantahBroBattlesDuplicate} />
      <Route path="/bantahbro/agents" component={BantahBroAgents} />
      <Route path="/bantahbro/marketplace" component={BantahBroMarketplace} />
      <Route path="/bantahbro/communities" component={BantahBroCommunities} />
      <Route path="/bantahbro/rewards" component={BantahBroRewards} />
      <Route path="/bantahbro/docs" component={BantahBroDocs} />
      <Route path="/bantahbro/ads" component={BantahBroAds} />
      <Route path="/bantahbro/import" component={BantahBroImport} />
      <Route path="/bantahbro/launcher" component={BantahBroLauncher} />
      <Route path="/bantahbro/polymarket/:battleId" component={BantahBroPolymarketBattle} />
      <Route path="/bantahbro/polymarket" component={BantahBroPolymarket} />
      <Route path="/bantahbro/rug-scorer" component={BantahBroRugScorer} />
      <Route path="/bantahbro/notifications" component={BotaNotificationsPage} />
      <Route path="/bantahbro" component={BantahBroHome} />
      <Route path="/bantahbro/" component={BantahBroHome} />
      <Route path="/Agents" component={BantahBroAgents} />
      <Route path="/agents" component={BantahBroAgents} />
      <Route path="/Marketplace" component={BantahBroMarketplace} />
      <Route path="/marketplace" component={BantahBroMarketplace} />
      <Route path="/Communities" component={BantahBroCommunities} />
      <Route path="/communities" component={BantahBroCommunities} />
      <Route path="/Rewards" component={BantahBroRewards} />
      <Route path="/rewards" component={BantahBroRewards} />
      <Route path="/Docs" component={BantahBroDocs} />
      <Route path="/docs" component={BantahBroDocs} />
      <Route path="/ads" component={BantahBroAds} />
      <Route path="/Ads" component={BantahBroAds} />
      <Route path="/import" component={BantahBroImport} />
      <Route path="/Import" component={BantahBroImport} />
      <Route path="/launcher" component={BantahBroLauncher} />
      <Route path="/Launcher" component={BantahBroLauncher} />
      <Route path="/rug-scorer" component={BantahBroRugScorer} />
      <Route path="/agents/:agentId" component={AgentDetail} />
      <Route path="/events/:id/chat" component={EventChatPage} />
      <Route path="/challenges/:id/activity" component={ChallengeChatPage} />
      <Route path="/challenges/:id/chat" component={ChallengeChatPage} />
      <Route path="/challenge/:id/activity" component={ChallengeChatPage} />
      <Route path="/challenge/:id/chat" component={ChallengeChatPage} />
      <Route path="/challenge/:id" component={ChallengeDetail} />
      <Route path="/events/:id" component={EventDetails} />
      <Route path="/event/:id/chat" component={EventChatPage} />
      <Route path="/event/:id" component={EventChatPage} />

      {/* Admin routes - accessible regardless of main authentication state */}
      <Route path="/admin/bantahbro-engine" component={AdminBantahBroEngine} />
      <Route path="/admin/rug-reports" component={AdminRugScorerReports} />
      <Route path="/admin" component={AdminDashboardOverview} />
      <Route path="/admin/payouts" component={AdminPayoutDashboard} />
      <Route path="/admin/events" component={AdminEventPayouts} />
      <Route path="/admin/challenges" component={AdminChallengePayouts} />
      <Route path="/admin/challenges/create" component={AdminChallengeCreate} />
      <Route path="/admin/challenges/disputes" component={AdminChallengeDisputes} />
      <Route path="/admin/transactions" component={AdminTransactions} />
      <Route path="/admin/analytics" component={AdminAnalytics} />
      <Route path="/admin/bonuses" component={AdminBonusConfiguration} />
      <Route path="/admin/wallet" component={AdminWallet} />
      <Route path="/admin/treasury" component={AdminTreasury} />
      <Route path="/admin/notifications" component={AdminNotifications} />
      <Route path="/admin/users" component={AdminUsersManagement} />
      <Route path="/admin/partners" component={AdminPartners} />
      <Route path="/admin/settings" component={AdminSettings} />

      {isLoading ? (
        <>
          <Route path="/" component={Landing} />
          <Route path="/ref/:code" component={Landing} />
        </>
      ) : !isAuthenticated ? (
        <>
          <Route path="/" component={Challenges} />
          <Route path="/events" component={Events} />
          <Route path="/home" component={Home} />
          <Route path="/recommendations" component={Recommendations} />
          <Route path="/challenges" component={Challenges} />
          <Route path="/agents" component={Agents} />
          <Route path="/challenges/:id" component={ChallengeDetail} />
          <Route path="/friends" component={Friends} />
          <Route path="/leaderboard" component={Leaderboard} />
          <Route path="/points" component={PointsAndBadges} />
          <Route path="/ref/:code" component={Landing} />
        </>
      ) : (
        <>
          <Route path="/" component={Challenges} />
          <Route path="/events" component={Events} />
          <Route path="/home" component={Home} />
          <Route path="/events/create" component={EventCreate} />
          <Route path="/create" component={EventCreate} />
          <Route path="/recommendations" component={Recommendations} />
          <Route path="/challenges" component={Challenges} />
          <Route path="/agents" component={Agents} />
          <Route path="/challenges/:id" component={ChallengeDetail} />
          <Route path="/friends" component={Friends} />
          <Route path="/wallet" component={WalletPage} />
          <Route path="/shop" component={Shop} />
          <Route path="/leaderboard" component={Leaderboard} />
          <Route path="/points" component={PointsAndBadges} />
          <Route path="/notifications" component={Notifications} />
          <Route path="/profile" component={Profile} />
          <Route path="/profile/edit" component={ProfileEdit} />
          <Route path="/profile/settings" component={ProfileSettings} />
          <Route path="/referrals" component={ReferralNew} />
          <Route path="/history" component={History} />
          <Route path="/settings" component={Settings} />
          <Route path="/support-chat" component={SupportChat} />
          <Route path="/help-support" component={HelpSupport} />
          <Route path="/terms-of-service" component={TermsOfService} />
          <Route path="/privacy-policy" component={PrivacyPolicy} />
          <Route path="/data-deletion-request" component={DataDeletionRequest} />
          <Route path="/telegram-auth" component={TelegramLink} />
          <Route path="/telegram-link" component={TelegramLink} />
          <Route path="/bantzz" component={Bantzz} />
          <Route path="/stories" component={Stories} />
          <Route path="/bant-map" component={BantMap} />
          <Route path="/notifications/test" component={NotificationTest} />
          <Route path="/ref/:code" component={Landing} />
        </>
      )}

      {/* Catch-all route for undefined paths - must be last */}
      <Route path="/:rest*" component={NotFound} />
    </Switch>
    </Suspense>



    {/* Automatic Daily Login Popup */}
    {isAuthenticated && (
      <Suspense fallback={null}>
        <DailyLoginModal 
          isOpen={showDailyLoginPopup}
          onClose={closeDailyLoginPopup}
          currentStreak={(dailyLoginStatus as any)?.streak || 0}
          hasClaimedToday={(dailyLoginStatus as any)?.hasSignedInToday || false}
          canClaim={(dailyLoginStatus as any)?.canClaim || false}
        />
      </Suspense>
    )}

    {/* Website Tour */}
    {isAuthenticated && (
      <WebsiteTour 
        isOpen={tour.isOpen}
        onClose={tour.closeTour}
      />
    )}
    </div>
  );
}

function App() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);

    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <PrivyProvider
        appId={privyConfig.appId}
        config={privyConfig.config as unknown as PrivyClientConfig}
      >
        <ThemeProvider>
          <EventsSearchProvider>
            <div className={`${isMobile ? 'mobile-app' : ''}`}>
              <TooltipProvider>
                <Toaster />
                <AddToHomePrompt />
                <ErrorBoundary
                  fallback={<div className="p-4 text-center">Something went wrong. Please refresh the page.</div>}
                  onError={(error) => console.error("App Error:", error)}
                >
                  <Router>
                    <AppRouter />
                  </Router>
                </ErrorBoundary>
              </TooltipProvider>
            </div>
          </EventsSearchProvider>
        </ThemeProvider>
      </PrivyProvider>
    </QueryClientProvider>
  );
}

export default App;

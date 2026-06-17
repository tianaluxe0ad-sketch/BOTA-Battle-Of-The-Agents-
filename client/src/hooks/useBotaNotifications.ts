import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { apiRequest } from '@/lib/queryClient';
import { useEffect } from 'react';
import { pusher } from '@/lib/pusher';
import { useToast } from './use-toast';
import type { BotaNotificationData } from '@shared/botaNotifications';

/**
 * Hook for managing BOTA per-agent activity notifications
 * Provides real-time updates for match events, payouts, tool drops, etc.
 */
export function useBotaNotifications() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch notifications for the authenticated user's agents
  const isTestMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('test') === 'true';
  
  const { data: notifications = [], isLoading, refetch } = useQuery({
    queryKey: ['/api/bantahbro/notifications'],
    queryFn: async () => {
      // In test mode, return mock data
      if (isTestMode) {
        // Return mock data for testing
        const mockNotifications: BotaNotificationData[] = [
          {
            id: '1',
            eventType: 'queued',
            agentName: 'vitalik.eth',
            agentId: 'agent-001',
            timestamp: new Date(Date.now() - 10 * 60000).toISOString(),
            read: false,
          },
          {
            id: '2',
            eventType: 'match_found',
            agentName: 'wizard.eth',
            agentId: 'agent-002',
            opponentName: 'satoshi.eth',
            timestamp: new Date(Date.now() - 8 * 60000).toISOString(),
            read: false,
          },
          {
            id: '3',
            eventType: 'win',
            agentName: 'vitalik.eth',
            agentId: 'agent-001',
            opponentName: 'wizard.eth',
            earnedBC: 45,
            earnedUSDT: 0.009,
            battleId: 'battle-001',
            timestamp: new Date(Date.now() - 5 * 60000).toISOString(),
            read: false,
          },
          {
            id: '4',
            eventType: 'loss',
            agentName: 'wizard.eth',
            agentId: 'agent-002',
            opponentName: 'satoshi.eth',
            battleId: 'battle-002',
            timestamp: new Date(Date.now() - 3 * 60000).toISOString(),
            read: true,
          },
          {
            id: '5',
            eventType: 'pot_payout',
            agentName: 'bantah.eth',
            agentId: 'agent-003',
            earnedUSDT: 4.20,
            timestamp: new Date(Date.now() - 2 * 60000).toISOString(),
            read: false,
          },
          {
            id: '6',
            eventType: 'tool_drop',
            agentName: 'elite.eth',
            agentId: 'agent-004',
            timestamp: new Date(Date.now() - 60000).toISOString(),
            read: false,
          },
          {
            id: '7',
            eventType: 'royale_result',
            agentName: 'royale.eth',
            agentId: 'agent-005',
            timestamp: new Date().toISOString(),
            read: false,
            metadata: { placement: 8, knockouts: 3 },
          },
        ];
        return mockNotifications;
      }

      const response = await apiRequest('GET', '/api/bantahbro/notifications');
      return Array.isArray(response) ? response : Array.isArray(response?.data) ? response.data : [];
    },
    enabled: !!user || isTestMode,
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  // Mark notification as read
  const markAsReadMutation = useMutation({
    mutationFn: (notificationId: string | number) =>
      apiRequest('PATCH', `/api/bantahbro/notifications/${notificationId}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/bantahbro/notifications'] });
    },
  });

  // Dismiss notification
  const dismissMutation = useMutation({
    mutationFn: (notificationId: string | number) =>
      apiRequest('DELETE', `/api/bantahbro/notifications/${notificationId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/bantahbro/notifications'] });
    },
  });

  // Set up real-time notifications via Pusher
  useEffect(() => {
    if (!user?.id) return;

    const channel = pusher.subscribe(`bota-user-${user.id}`);

    const eventTypes = [
      'bota:agent-queued',
      'bota:match-found',
      'bota:battle-won',
      'bota:battle-lost',
      'bota:royale-result',
      'bota:pot-payout',
      'bota:tool-drop',
    ];

    eventTypes.forEach((eventName) => {
      channel.bind(eventName, (data: BotaNotificationData) => {
        console.log(`[BOTA] ${eventName}:`, data);

        // Show toast notification for realtime events
        toast({
          title: `${data.agentName} • ${eventName.split(':')[1].toUpperCase()}`,
          description: formatNotificationMessageForToast(data),
          duration: 5000,
        });

        // Refresh notifications list
        queryClient.invalidateQueries({ queryKey: ['/api/bantahbro/notifications'] });
      });
    });

    return () => {
      eventTypes.forEach((eventName) => {
        channel.unbind(eventName);
      });
      pusher.unsubscribe(`bota-user-${user.id}`);
    };
  }, [user?.id, queryClient, toast]);

  return {
    notifications: notifications as (BotaNotificationData & { id: string | number })[] || [],
    isLoading,
    refetch,
    markAsRead: markAsReadMutation.mutate,
    dismiss: dismissMutation.mutate,
    unreadCount: Array.isArray(notifications)
      ? notifications.filter((n: any) => !n.read).length
      : 0,
  };
}

function formatNotificationMessageForToast(data: BotaNotificationData): string {
  switch (data.eventType) {
    case 'queued':
      return 'Agent entered matchmaking';
    case 'match_found':
      return `Matched vs ${data.opponentName}`;
    case 'win':
      return `Victory! +${data.earnedBC} BC`;
    case 'loss':
      return `Lost to ${data.opponentName}`;
    case 'royale_result':
      return `Top ${data.placement} finish`;
    case 'pot_payout':
      return `+${data.payoutAmount} ${data.payoutCurrency}`;
    case 'tool_drop':
      return `New tool: ${data.toolName}`;
    default:
      return 'New activity';
  }
}

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

interface Agent {
  agentId: string;
  agentName: string;
  avatarUrl?: string;
  walletAddress: string;
  status: string;
  winCount: number;
  lossCount: number;
  winnings?: {
    totalBC: number;
    totalUSDT: number;
  };
}

interface AgentUpdatePayload {
  agentName?: string;
  avatarUrl?: string;
}

export function useAgentManagement() {
  const queryClient = useQueryClient();

  // Fetch user's agents
  const { data: agents = [], isLoading } = useQuery({
    queryKey: ['/api/bantahbro/my-agents'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/bantahbro/my-agents');
      return Array.isArray(response) ? response : response?.data || [];
    },
  });

  // Update agent
  const updateAgentMutation = useMutation({
    mutationFn: (payload: { agentId: string; data: AgentUpdatePayload }) =>
      apiRequest('PATCH', `/api/bantahbro/agents/${payload.agentId}`, payload.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/bantahbro/my-agents'] });
    },
  });

  // Get agent earnings/stats
  const { data: agentStats = {} } = useQuery({
    queryKey: ['/api/bantahbro/agent-stats'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/bantahbro/agent-stats');
      return response || {};
    },
  });

  return {
    agents,
    isLoading,
    updateAgent: (agentId: string, data: AgentUpdatePayload) =>
      updateAgentMutation.mutate({ agentId, data }),
    agentStats,
    isUpdating: updateAgentMutation.isPending,
  };
}

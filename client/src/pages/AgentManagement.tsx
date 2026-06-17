'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AgentEditor } from '@/components/bantahbro/AgentEditor';
import { AgentStats } from '@/components/bantahbro/AgentStats';
import { AgentSelector } from '@/components/bantahbro/AgentSelector';
import { useAgentManagement } from '@/hooks/useAgentManagement';
import { Button } from '@/components/ui/button';
import { Plus, Trophy } from 'lucide-react';

export default function AgentManagementPage() {
  const { agents, isLoading } = useAgentManagement();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [showNewAgent, setShowNewAgent] = useState(false);

  const selectedAgent = agents.find((a) => a.agentId === selectedAgentId) || agents[0];

  const { data: agentStats = {} } = useQuery({
    queryKey: ['/api/bantahbro/agent-stats'],
    queryFn: async () => {
      const response = await fetch('/api/bantahbro/agent-stats');
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground">Loading agents...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 max-w-4xl mx-auto">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Agent Management</h1>
        <p className="text-muted-foreground">Edit your agents, manage profiles, and track earnings</p>
      </div>

      {agents.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center">
            <Trophy className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground mb-4">No agents yet. Import or create your first agent to get started!</p>
            <Button asChild>
              <a href="/bota/agents">Browse Agents</a>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="selector" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="selector">Select Agent</TabsTrigger>
            <TabsTrigger value="edit">Edit Profile</TabsTrigger>
            <TabsTrigger value="stats">Statistics</TabsTrigger>
          </TabsList>

          {/* Agent Selector */}
          <TabsContent value="selector">
            <Card>
              <CardHeader>
                <CardTitle>Your Agents</CardTitle>
                <CardDescription>Choose an agent to manage</CardDescription>
              </CardHeader>
              <CardContent>
                <AgentSelector
                  selectedAgentId={selectedAgentId || agents[0]?.agentId}
                  onSelect={(agentId) => setSelectedAgentId(agentId)}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Agent Edit */}
          <TabsContent value="edit">
            {selectedAgent ? (
              <div className="space-y-4">
                <AgentEditor
                  agentId={selectedAgent.agentId}
                  initialName={selectedAgent.agentName}
                  initialAvatar={selectedAgent.avatarUrl}
                  onSave={() => {
                    // Refetch or update cache
                  }}
                />

                {/* Wallet Info Card */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Agent Details</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Wallet Address</p>
                      <p className="text-sm font-mono bg-muted p-2 rounded truncate">
                        {selectedAgent.walletAddress}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Status</p>
                        <p className="text-sm font-medium capitalize">
                          <span className="inline-block w-2 h-2 bg-green-500 rounded-full mr-2" />
                          {selectedAgent.status || 'Active'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Type</p>
                        <p className="text-sm font-medium capitalize">{selectedAgent.agentType || 'General'}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <Card>
                <CardContent className="pt-6 text-center text-muted-foreground">
                  Select an agent first
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Agent Stats */}
          <TabsContent value="stats">
            {selectedAgent && agentStats[selectedAgent.agentId] ? (
              <div className="space-y-4">
                <AgentStats
                  agentName={selectedAgent.agentName}
                  wins={agentStats[selectedAgent.agentId]?.wins || 0}
                  losses={agentStats[selectedAgent.agentId]?.losses || 0}
                  totalBC={agentStats[selectedAgent.agentId]?.totalBC || 0}
                  totalUSDT={agentStats[selectedAgent.agentId]?.totalUSDT || 0}
                />

                {/* Recent Battles */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Recent Activity</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      Battle history coming soon. Check the Arena for live battles.
                    </p>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <Card>
                <CardContent className="pt-6 text-center text-muted-foreground">
                  Select an agent to view statistics
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

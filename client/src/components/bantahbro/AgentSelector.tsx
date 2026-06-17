'use client';

import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { useAgentManagement } from '@/hooks/useAgentManagement';
import { Loader2 } from 'lucide-react';

interface AgentSelectorProps {
  onSelect: (agentId: string, agentName: string) => void;
  selectedAgentId?: string;
}

export function AgentSelector({ onSelect, selectedAgentId }: AgentSelectorProps) {
  const { agents, isLoading } = useAgentManagement();

  if (isLoading) {
    return <Loader2 className="w-4 h-4 animate-spin" />;
  }

  if (agents.length === 0) {
    return <p className="text-sm text-muted-foreground">No agents found. Import or create an agent first.</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Select Agent for Battle</p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {agents.map((agent) => (
          <Button
            key={agent.agentId}
            variant={selectedAgentId === agent.agentId ? 'default' : 'outline'}
            onClick={() => onSelect(agent.agentId, agent.agentName)}
            className="flex-col h-auto py-3 gap-2"
          >
            <Avatar className="w-10 h-10">
              <AvatarImage src={agent.avatarUrl} />
              <AvatarFallback>{agent.agentName.charAt(0)}</AvatarFallback>
            </Avatar>
            <span className="text-xs text-center truncate">{agent.agentName}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}

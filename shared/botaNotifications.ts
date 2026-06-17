/**
 * BOTA Notifications System
 * Per-Agent Activity Feed notification types and interfaces
 */

export type BotaNotificationEventType = 
  | 'queued'
  | 'match_found'
  | 'win'
  | 'loss'
  | 'royale_result'
  | 'pot_payout'
  | 'tool_drop';

export interface BotaNotificationData {
  eventType: BotaNotificationEventType;
  agentName: string;
  agentId: string;
  timestamp: string;
  id?: string | number;
  read?: boolean;
  
  // Common fields
  battleId?: string;
  battleReplayUrl?: string;
  
  // Win/Loss specific
  opponentName?: string;
  opponentId?: string;
  earnedBC?: number;
  earnedUSDT?: number;
  
  // Royale specific
  placement?: number;
  knockouts?: number;
  
  // Pot Payout specific
  payoutAmount?: number;
  payoutCurrency?: string;
  
  // Tool Drop specific
  toolRarity?: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  toolName?: string;
  
  // Additional metadata
  metadata?: Record<string, any>;
}

export const NOTIFICATION_DISPLAY_CONFIG: Record<BotaNotificationEventType, {
  icon: string;
  label: string;
  color: string;
}> = {
  'queued': {
    icon: '⏳',
    label: 'QUEUED',
    color: 'bg-blue-500/20 text-blue-400',
  },
  'match_found': {
    icon: '⚔️',
    label: 'MATCH FOUND',
    color: 'bg-purple-500/20 text-purple-400',
  },
  'win': {
    icon: '✅',
    label: 'WIN',
    color: 'bg-green-500/20 text-green-400',
  },
  'loss': {
    icon: '❌',
    label: 'LOSS',
    color: 'bg-red-500/20 text-red-400',
  },
  'royale_result': {
    icon: '🏆',
    label: 'ROYALE RESULT',
    color: 'bg-yellow-500/20 text-yellow-400',
  },
  'pot_payout': {
    icon: '💰',
    label: 'POT PAYOUT',
    color: 'bg-emerald-500/20 text-emerald-400',
  },
  'tool_drop': {
    icon: '🎁',
    label: 'TOOL DROP',
    color: 'bg-orange-500/20 text-orange-400',
  },
};

export function formatNotificationMessage(data: BotaNotificationData): string {
  switch (data.eventType) {
    case 'queued':
      return `${data.agentName} queued`;
    case 'match_found':
      return `vs ${data.opponentName} in 60s`;
    case 'win':
      return `defeated ${data.opponentName}`;
    case 'loss':
      return `lost to ${data.opponentName}`;
    case 'royale_result':
      return `Top ${data.placement} finish${data.knockouts ? `, ${data.knockouts} KOs` : ''}`;
    case 'pot_payout':
      return `+${data.payoutAmount} ${data.payoutCurrency} from Pot`;
    case 'tool_drop':
      return `${data.toolRarity === 'rare' ? 'Rare' : data.toolRarity === 'legendary' ? 'Legendary' : 'New'}: ${data.toolName}`;
    default:
      return 'Activity update';
  }
}

export function formatNotificationEarnings(data: BotaNotificationData): string {
  const parts: string[] = [];
  
  if (data.earnedBC) {
    parts.push(`+${data.earnedBC} BC`);
  }
  if (data.earnedUSDT) {
    parts.push(`+${data.earnedUSDT.toFixed(4)} USDT`);
  }
  
  return parts.length > 0 ? `Earned: ${parts.join(' • ')}` : '';
}

export function getNotificationActionUrl(data: BotaNotificationData): string | null {
  if (data.battleReplayUrl) {
    return data.battleReplayUrl;
  }
  if (data.battleId) {
    return `/bota/battles?battleId=${data.battleId}`;
  }
  return null;
}

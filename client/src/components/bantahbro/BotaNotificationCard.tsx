'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { ChevronRight } from 'lucide-react';
import type { BotaNotificationData } from '@shared/botaNotifications';
import {
  NOTIFICATION_DISPLAY_CONFIG,
  formatNotificationMessage,
  formatNotificationEarnings,
  getNotificationActionUrl,
} from '@shared/botaNotifications';

interface BotaNotificationCardProps {
  notification: BotaNotificationData & { id?: string | number; createdAt?: string };
  onMarkAsRead?: (id: string | number) => void;
  onAction?: (action: string, notificationId?: string | number) => void;
}

export function BotaNotificationCard({
  notification,
  onMarkAsRead,
  onAction,
}: BotaNotificationCardProps) {
  const config = NOTIFICATION_DISPLAY_CONFIG[notification.eventType];
  const timestamp = notification.createdAt || notification.timestamp;
  const timeAgo = formatDistanceToNow(new Date(timestamp), { addSuffix: true });
  const message = formatNotificationMessage(notification);
  const earnings = formatNotificationEarnings(notification);
  const actionUrl = getNotificationActionUrl(notification);

  const handleCardClick = () => {
    if (notification.id && onMarkAsRead) {
      onMarkAsRead(notification.id);
    }
    if (actionUrl && onAction) {
      onAction('view-replay', notification.id);
    }
  };

  return (
    <Card className="relative overflow-hidden border-l-4 transition-all hover:shadow-lg" style={{
      borderLeftColor: config.color === 'bg-green-500/20 text-green-400' 
        ? '#22c55e' 
        : config.color === 'bg-red-500/20 text-red-400'
        ? '#ef4444'
        : '#3b82f6'
    }}>
      <CardContent className="p-4">
        <div className="space-y-3">
          {/* Header: Status Badge and Timestamp */}
          <div className="flex items-center justify-between">
            <Badge variant="outline" className={`${config.color} border-0 font-bold`}>
              {config.icon} {config.label}
            </Badge>
            <span className="text-xs text-muted-foreground">{timeAgo}</span>
          </div>

          {/* Primary Message */}
          <div className="text-sm font-semibold text-foreground">
            {notification.agentName} {message}
          </div>

          {/* Earnings (if applicable) */}
          {earnings && (
            <div className="text-xs text-emerald-400 font-medium">
              {earnings}
            </div>
          )}

          {/* Action Button */}
          {actionUrl && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-between h-8 text-xs hover:bg-secondary/50"
              onClick={handleCardClick}
            >
              <span>View Battle Replay</span>
              <ChevronRight className="w-4 h-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

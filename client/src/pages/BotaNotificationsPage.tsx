'use client';

import { useBotaNotifications } from '@/hooks/useBotaNotifications';
import { BotaNotificationCard } from '@/components/bantahbro/BotaNotificationCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Trash2, CheckCheck } from 'lucide-react';

export default function BotaNotificationsPage() {
  const {
    notifications,
    isLoading,
    markAsRead,
    dismiss,
    unreadCount,
  } = useBotaNotifications();

  const unreadNotifications = notifications.filter((n) => !n.read);
  const readNotifications = notifications.filter((n) => n.read);

  const handleMarkAllAsRead = () => {
    unreadNotifications.forEach((n) => {
      if (n.id) markAsRead(n.id);
    });
  };

  const handleDismissAll = () => {
    notifications.forEach((n) => {
      if (n.id) dismiss(n.id);
    });
  };

  return (
    <div className="w-full max-w-2xl mx-auto p-4 space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">Activity Feed</h1>
        <p className="text-muted-foreground">
          Real-time updates from your Battle of the Agents
        </p>
      </div>

      {/* Action Bar */}
      {notifications.length > 0 && (
        <div className="flex gap-2">
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleMarkAllAsRead}
              className="gap-2"
            >
              <CheckCheck className="w-4 h-4" />
              Mark {unreadCount} as Read
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleDismissAll}
            className="gap-2 text-destructive hover:text-destructive"
          >
            <Trash2 className="w-4 h-4" />
            Dismiss All
          </Button>
        </div>
      )}

      {/* Notifications Tabs */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : notifications.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-lg font-semibold text-muted-foreground">
              No activity yet
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Your agents will start showing activity here
            </p>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="unread" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="unread">
              Unread ({unreadCount})
            </TabsTrigger>
            <TabsTrigger value="all">
              All ({notifications.length})
            </TabsTrigger>
          </TabsList>

          {/* Unread Tab */}
          <TabsContent value="unread" className="space-y-3 mt-4">
            {unreadNotifications.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-8 text-center">
                  <p className="text-muted-foreground">All caught up!</p>
                </CardContent>
              </Card>
            ) : (
              unreadNotifications.map((notification) => (
                <BotaNotificationCard
                  key={notification.id}
                  notification={notification}
                  onMarkAsRead={markAsRead}
                  onAction={(action, id) => {
                    if (action === 'view-replay' && id) {
                      markAsRead(id);
                      // Navigate to battle replay
                      const url = `/bota/battles?battleId=${notification.battleId}`;
                      window.location.href = url;
                    }
                  }}
                />
              ))
            )}
          </TabsContent>

          {/* All Tab */}
          <TabsContent value="all" className="space-y-3 mt-4">
            {notifications.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-8 text-center">
                  <p className="text-muted-foreground">No notifications</p>
                </CardContent>
              </Card>
            ) : (
              notifications.map((notification) => (
                <div key={notification.id} className="relative">
                  {!notification.read && (
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-full" />
                  )}
                  <BotaNotificationCard
                    notification={notification}
                    onMarkAsRead={markAsRead}
                    onAction={(action, id) => {
                      if (action === 'view-replay' && id) {
                        markAsRead(id);
                        const url = `/bota/battles?battleId=${notification.battleId}`;
                        window.location.href = url;
                      }
                    }}
                  />
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

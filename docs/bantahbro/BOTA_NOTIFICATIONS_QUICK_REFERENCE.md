# BOTA Notifications System - Quick Reference

## 🚀 Quick Start

### View Notifications (Demo Mode)
Navigate to: **`http://localhost:5000/bota/notifications?test=true`**

This loads 7 sample notifications across all event types for testing the UI.

---

## 📋 Event Types

### 1. ⏳ **Queued**
Agent entered the matchmaking queue
```
"vitalik.eth queued"
```

### 2. ⚔️ **Match Found**
Opponent has been assigned
```
"vs wizard.eth in 60s"
```

### 3. ✅ **Win**
Battle resolved with victory
```
"defeated wizard.eth"
Earned: +45 BC • +0.009 USDT
```

### 4. ❌ **Loss**
Battle resolved with defeat
```
"lost to satoshi.eth"
```

### 5. 💰 **Pot Payout**
Weekly distribution received
```
"+4.20 USDT from Pot"
```

### 6. 🎁 **Tool Drop**
New tool/item from pack
```
"Rare: Bounce Laser"
```

### 7. 🏆 **Royale Result**
Royale battle completed
```
"Top 8 finish, 3 KOs"
```

---

## 🔧 API Usage

### Get Notifications
```javascript
const response = await fetch('/api/bantahbro/notifications', {
  headers: { 'Authorization': 'Bearer ' + token }
});
const notifications = await response.json();
```

### Create Test Notifications
```javascript
// No auth required - demo endpoint
const response = await fetch('/api/bantahbro/notifications/test-create', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
});
const result = await response.json();
// Returns: { success: true, created: 7, notifications: [...] }
```

### Mark as Read
```javascript
await fetch(`/api/bantahbro/notifications/${notificationId}/read`, {
  method: 'PATCH',
  headers: { 'Authorization': 'Bearer ' + token }
});
```

### Delete Notification
```javascript
await fetch(`/api/bantahbro/notifications/${notificationId}`, {
  method: 'DELETE',
  headers: { 'Authorization': 'Bearer ' + token }
});
```

---

## 📱 UI Components

### BotaNotificationCard
```tsx
import { BotaNotificationCard } from '@/components/bantahbro/BotaNotificationCard';

<BotaNotificationCard
  notification={notification}
  onMarkAsRead={(id) => console.log('Read:', id)}
  onAction={(action, id) => console.log(action, id)}
/>
```

### useBotaNotifications Hook
```tsx
const {
  notifications,        // Array of notifications
  isLoading,           // Loading state
  unreadCount,         // Count of unread
  markAsRead,          // Function to mark as read
  dismiss,             // Function to dismiss
  refetch,             // Refetch notifications
} = useBotaNotifications();
```

---

## 🎨 Display Features

- **Color-coded badges** by event type
- **Relative timestamps** (e.g., "2 min ago")
- **Earnings display** for win/payout events
- **Action buttons** with navigation
- **Tab filters** (Unread / All)
- **Bulk actions** (Mark All, Dismiss All)
- **Empty states** with helpful messages

---

## 📊 Real-Time Events (Pusher)

Events are pushed on channel: `bota-user-{userId}`

- `bota:agent-queued`
- `bota:match-found`
- `bota:battle-won`
- `bota:battle-lost`
- `bota:royale-result`
- `bota:pot-payout`
- `bota:tool-drop`

---

## 🧪 Test Mode

Add `?test=true` to any of these URLs to load demo notifications:

- `http://localhost:5000/bota/notifications?test=true`
- `http://localhost:5000/battle/notifications?test=true`
- `http://localhost:5000/bantahbro/notifications?test=true`
- `http://localhost:5000/notifications?test=true`

**Demo Data**: 7 sample notifications (6 unread, 1 read)

---

## 🔗 Routes

All variants supported:
- `/bota/notifications`
- `/battle/notifications`
- `/bantahbro/notifications`
- `/notifications` (on dedicated hosts)

---

## 💾 Data Structure

```typescript
interface BotaNotificationData {
  eventType: 'queued' | 'match_found' | 'win' | 'loss' | 
             'royale_result' | 'pot_payout' | 'tool_drop';
  agentName: string;              // e.g., "vitalik.eth"
  agentId: string;                // e.g., "agent-001"
  timestamp: string;              // ISO format
  read?: boolean;
  
  // Combat events
  battleId?: string;
  battleReplayUrl?: string;
  opponentName?: string;
  
  // Earnings
  earnedBC?: number;              // BantaCredit
  earnedUSDT?: number;            // USDT
  
  // Royale specific
  placement?: number;             // e.g., 8
  knockouts?: number;             // e.g., 3
  
  // Tool drops
  toolRarity?: 'rare' | 'epic' | 'legendary';
  toolName?: string;
}
```

---

## 📚 Files Reference

| File | Purpose |
|------|---------|
| `shared/botaNotifications.ts` | Types and formatters |
| `client/src/components/bantahbro/BotaNotificationCard.tsx` | Card UI |
| `client/src/hooks/useBotaNotifications.ts` | React hook |
| `client/src/pages/BotaNotificationsPage.tsx` | Page component |
| `server/routes.ts` | API endpoints |
| `docs/bantahbro/BOTA_Notifications_System.md` | Full specification |

---

## ✅ Status

- ✅ All components rendering correctly
- ✅ All event types displaying
- ✅ API endpoints working
- ✅ Mock data for testing
- ✅ Real-time Pusher integration ready
- ⏳ Database integration pending
- ⏳ Battle event wiring pending

---

## 📞 Support

- Check browser console for errors
- Test mode: `?test=true`
- Review test report: `BOTA_NOTIFICATIONS_TEST_REPORT.md`
- Full docs: `BOTA_Notifications_System.md`

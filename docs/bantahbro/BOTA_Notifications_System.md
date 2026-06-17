# BOTA Notifications System
## Per-Agent Activity Feed

Updated: 2026-06-17

---

## Notification Event Types

| EVENT TYPE | TRIGGERS WHEN | DISPLAYS |
|---|---|---|
| **Queued** | Agent enters matchmaking | `"vitalik.eth queued"` |
| **Match Found** | Opponent assigned | `"vs wizard.eth in 60s"` |
| **Win** | Battle resolved, agent won | `"+12 BC, +0.004 USDT"` |
| **Loss** | Battle resolved, agent lost | `"vs BANTAH ALPHA"` |
| **Royale Result** | Royale match ends | `"Top 8 finish, 3 KOs"` |
| **Pot Payout** | Weekly distribution lands | `"+$4.20 USDT from Pot"` |
| **Tool Drop** | Pack opened | `"Rare: Bounce Laser"` |

---

## Notification Card Design

### Card Layout
```
┌──────────────────────────────────────┐
│ ✅ WIN  •  2 min ago                  │
│ vitalik.eth defeated wizard.eth       │
│ Earned: +45 BC  •  +0.009 USDT       │
│ [View Battle Replay]  →               │
└──────────────────────────────────────┘
```

### UI Components
- **Status Badge**: Icon + Event Type Label (WIN, LOSS, etc.)
- **Timestamp**: Relative time (e.g., "2 min ago")
- **Primary Message**: Agent name + action
- **Secondary Details**: Earnings/stats (conditional)
- **Action Button**: "View Battle Replay" with chevron

### Visual Hierarchy
- **Header**: Status + Timestamp
- **Body**: Primary message (bold)
- **Footer**: Earnings or details (smaller font)
- **CTA**: Action button (optional)

---

## Color Coding

| Event Type | Icon | Color Scheme |
|---|---|---|
| Queued | ⏳ | Blue: `#3b82f6` |
| Match Found | ⚔️ | Purple: `#a855f7` |
| Win | ✅ | Green: `#22c55e` |
| Loss | ❌ | Red: `#ef4444` |
| Royale Result | 🏆 | Gold: `#eab308` |
| Pot Payout | 💰 | Emerald: `#10b981` |
| Tool Drop | 🎁 | Orange: `#f97316` |

---

## Data Structure

```typescript
interface BotaNotificationData {
  eventType: 'queued' | 'match_found' | 'win' | 'loss' | 'royale_result' | 'pot_payout' | 'tool_drop';
  agentName: string;
  agentId: string;
  timestamp: string;
  read?: boolean;
  
  // Combat events
  battleId?: string;
  battleReplayUrl?: string;
  opponentName?: string;
  opponentId?: string;
  
  // Earnings
  earnedBC?: number;
  earnedUSDT?: number;
  
  // Royale specific
  placement?: number;
  knockouts?: number;
  
  // Payout specific
  payoutAmount?: number;
  payoutCurrency?: string;
  
  // Tool drops
  toolRarity?: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  toolName?: string;
}
```

---

## Real-Time Events

Notifications are pushed via Pusher channels:

- `bota:agent-queued`
- `bota:match-found`
- `bota:battle-won`
- `bota:battle-lost`
- `bota:royale-result`
- `bota:pot-payout`
- `bota:tool-drop`

---

## API Endpoints

```
GET   /api/bantahbro/notifications              - Fetch all notifications
PATCH /api/bantahbro/notifications/{id}/read    - Mark as read
DELETE /api/bantahbro/notifications/{id}        - Dismiss notification
```

---

## Implementation Files

- `shared/botaNotifications.ts` - Type definitions and formatters
- `client/src/components/bantahbro/BotaNotificationCard.tsx` - Card UI component
- `client/src/hooks/useBotaNotifications.ts` - React hook for managing notifications

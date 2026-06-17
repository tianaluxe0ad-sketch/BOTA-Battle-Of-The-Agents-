import { db } from "./server/db";
import { notifications } from "./shared/schema";

const userId = "test-user-123"; // Test user ID

const testNotifs = [
  {
    userId,
    type: "bota_activity",
    title: "[QUEUED] vitalik.eth",
    message: "Agent activity: queued",
    data: {
      eventType: "queued",
      agentName: "vitalik.eth",
      agentId: "agent-001",
      timestamp: new Date().toISOString(),
      read: false,
    },
    read: false,
    createdAt: new Date(),
  },
  {
    userId,
    type: "bota_activity",
    title: "[WIN] vitalik.eth",
    message: "Agent activity: win",
    data: {
      eventType: "win",
      agentName: "vitalik.eth",
      agentId: "agent-001",
      opponentName: "wizard.eth",
      earnedBC: 45,
      earnedUSDT: 0.009,
      battleId: "battle-001",
      timestamp: new Date().toISOString(),
      read: false,
    },
    read: false,
    createdAt: new Date(),
  },
];

try {
  for (const notif of testNotifs) {
    const result = await db.insert(notifications).values(notif);
    console.log("Created notification:", result);
  }
  console.log("Test notifications created successfully");
  process.exit(0);
} catch (error) {
  console.error("Error:", error);
  process.exit(1);
}

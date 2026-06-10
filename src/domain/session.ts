export interface RealtimeSessionRecord {
  sessionId: string;
  userId?: string;
  tenantId?: string;
  callId?: string;
  location?: string;
  createdAt: string;
  status: "created" | "connected" | "closed" | "error";
  observerAttached: boolean;
}

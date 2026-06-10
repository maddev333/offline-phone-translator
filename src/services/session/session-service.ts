import { randomUUID } from "node:crypto";
import type { SessionStore } from "./session-store.js";
import type { RealtimeSessionRecord } from "../../domain/session.js";

export class SessionService {
  constructor(private readonly store: SessionStore) {}

  async create(userId?: string, tenantId?: string): Promise<RealtimeSessionRecord> {
    const session: RealtimeSessionRecord = {
      sessionId: randomUUID(),
      createdAt: new Date().toISOString(),
      status: "created",
      observerAttached: false
    };

    if (userId) {
      session.userId = userId;
    }
    if (tenantId) {
      session.tenantId = tenantId;
    }

    await this.store.save(session);
    return session;
  }

  async get(sessionId: string): Promise<RealtimeSessionRecord | null> {
    return this.store.get(sessionId);
  }

  async getOwned(sessionId: string, userId: string): Promise<RealtimeSessionRecord | null> {
    const session = await this.get(sessionId);
    if (!session) return null;
    return session.userId === userId ? session : null;
  }

  async markConnected(
    sessionId: string,
    patch: { callId?: string; location?: string; observerAttached?: boolean }
  ): Promise<void> {
    await this.store.update(sessionId, {
      ...patch,
      status: "connected"
    });
  }
}

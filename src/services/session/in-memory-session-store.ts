import type { SessionStore } from "./session-store.js";
import type { RealtimeSessionRecord } from "../../domain/session.js";

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, RealtimeSessionRecord>();

  async save(session: RealtimeSessionRecord): Promise<void> {
    this.sessions.set(session.sessionId, session);
  }

  async get(sessionId: string): Promise<RealtimeSessionRecord | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async update(sessionId: string, patch: Partial<RealtimeSessionRecord>): Promise<void> {
    const current = this.sessions.get(sessionId);
    if (!current) return;
    this.sessions.set(sessionId, { ...current, ...patch });
  }
}

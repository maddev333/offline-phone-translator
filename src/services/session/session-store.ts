import type { RealtimeSessionRecord } from "../../domain/session.js";

export interface SessionStore {
  save(session: RealtimeSessionRecord): Promise<void>;
  get(sessionId: string): Promise<RealtimeSessionRecord | null>;
  update(sessionId: string, patch: Partial<RealtimeSessionRecord>): Promise<void>;
}

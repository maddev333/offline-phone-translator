import type { SessionStore } from "./session-store.js";
import { InMemorySessionStore } from "./in-memory-session-store.js";

export const sessionStore: SessionStore = new InMemorySessionStore();

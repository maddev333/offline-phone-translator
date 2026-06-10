type ToolEvent = {
  type: string;
  toolName?: string;
  ok?: boolean;
  message: string;
  args?: Record<string, unknown>;
};

type Listener = (event: ToolEvent) => void;

class ToolEventBus {
  private readonly listeners = new Map<string, Set<Listener>>();

  subscribe(sessionId: string, listener: Listener): () => void {
    const set = this.listeners.get(sessionId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(sessionId, set);
    return () => {
      const current = this.listeners.get(sessionId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(sessionId);
      }
    };
  }

  publish(sessionId: string, event: ToolEvent): void {
    const set = this.listeners.get(sessionId);
    if (!set) return;
    for (const listener of set) {
      listener(event);
    }
  }
}

export const toolEventBus = new ToolEventBus();
export type { ToolEvent };

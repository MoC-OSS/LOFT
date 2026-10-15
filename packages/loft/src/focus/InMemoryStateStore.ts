import type { Agent } from '@moc-global/loft-definitions';

export class InMemoryFocusStateStore implements Agent.FocusStateStore {
  private store = new Map<string, Map<string, Map<string, unknown>>>();
  private writeTimestamps = new Map<string, Map<string, number>>();
  private readonly ttlMs: number;

  /**
   * @param ttlMs - Time-to-live in milliseconds for each (sessionId, agentName) entry.
   *   Entries are evicted lazily on the next access after the TTL expires.
   *   Pass 0 (default) to disable TTL and keep entries indefinitely.
   */
  constructor(ttlMs = 0) {
    this.ttlMs = ttlMs;
  }

  private evictIfExpired(sessionId: string, agentName: string): void {
    if (this.ttlMs <= 0) return;
    const ts = this.writeTimestamps.get(sessionId)?.get(agentName);
    if (ts !== undefined && Date.now() - ts > this.ttlMs) {
      this.store.get(sessionId)?.delete(agentName);
      this.writeTimestamps.get(sessionId)?.delete(agentName);
    }
  }

  private touch(sessionId: string, agentName: string): void {
    if (this.ttlMs <= 0) return;
    if (!this.writeTimestamps.has(sessionId)) {
      this.writeTimestamps.set(sessionId, new Map());
    }
    this.writeTimestamps.get(sessionId)!.set(agentName, Date.now());
  }

  private getAgentMap(sessionId: string, agentName: string): Map<string, unknown> {
    if (!this.store.has(sessionId)) {
      this.store.set(sessionId, new Map());
    }
    const sessionMap = this.store.get(sessionId)!;
    if (!sessionMap.has(agentName)) {
      sessionMap.set(agentName, new Map());
    }
    return sessionMap.get(agentName)!;
  }

  async get<T = unknown>(sessionId: string, agentName: string, fieldKey: string): Promise<T | undefined> {
    this.evictIfExpired(sessionId, agentName);
    return this.getAgentMap(sessionId, agentName).get(fieldKey) as T | undefined;
  }

  async getAll(sessionId: string, agentName: string): Promise<Record<string, unknown>> {
    this.evictIfExpired(sessionId, agentName);
    const result: Record<string, unknown> = {};
    for (const [key, value] of this.getAgentMap(sessionId, agentName)) {
      result[key] = value;
    }
    return result;
  }

  async set<T = unknown>(sessionId: string, agentName: string, fieldKey: string, value: T): Promise<void> {
    this.getAgentMap(sessionId, agentName).set(fieldKey, value);
    this.touch(sessionId, agentName);
  }

  async delete(sessionId: string, agentName: string, fieldKey: string): Promise<void> {
    this.evictIfExpired(sessionId, agentName);
    this.getAgentMap(sessionId, agentName).delete(fieldKey);
  }

  async clear(sessionId: string, agentName: string): Promise<void> {
    this.store.get(sessionId)?.delete(agentName);
    this.writeTimestamps.get(sessionId)?.delete(agentName);
  }

  async clearAll(sessionId: string): Promise<void> {
    this.store.delete(sessionId);
    this.writeTimestamps.delete(sessionId);
  }
}

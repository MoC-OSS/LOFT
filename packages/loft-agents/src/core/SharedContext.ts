import { Agent } from '@moc-global/loft-definitions';

export class ScopedContext implements Agent.ScopedContextInterface {
  constructor(
    private readonly prefix: string,
    private readonly context: SharedContext
  ) {}

  get<T>(key: string): T | undefined {
    return this.context.get<T>(`${this.prefix}.${key}`);
  }

  set<T>(key: string, value: T): void {
    this.context.set<T>(`${this.prefix}.${key}`, value);
  }
}

export class SharedContext implements Agent.SharedContextInterface {
  private readonly store = new Map<string, unknown>();

  constructor(public readonly sessionId: string) {}

  get<T>(key: string): T | undefined {
    const value = this.store.get(key);
    if (value === undefined) {
      return undefined;
    }
    return structuredClone(value) as T;
  }

  set<T>(key: string, value: T): void {
    this.store.set(key, value);
  }

  keys(): string[] {
    return Array.from(this.store.keys());
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  for(agentName: string): ScopedContext {
    return new ScopedContext(agentName, this);
  }
}

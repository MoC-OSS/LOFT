import { Agent, Logger } from '@moc-global/loft-definitions';

export class FocusRegistry {
  private readonly log = new Logger('FocusRegistry');
  private readonly configs = new Map<string, Agent.Focus>();

  register(name: string, config: Agent.Focus): void {
    if (this.configs.has(name)) {
      throw new Error(`Focus "${name}" is already registered`);
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(config.agentName)) {
      throw new Error(
        `Focus agentName "${config.agentName}" contains invalid characters. ` +
          `Only letters, numbers, underscores, and hyphens are allowed.`
      );
    }
    this.configs.set(name, config);
    this.log.info(`Focus "${name}" registered`);
  }

  get(name: string): Agent.Focus | undefined {
    return this.configs.get(name);
  }

  has(name: string): boolean {
    return this.configs.has(name);
  }
}

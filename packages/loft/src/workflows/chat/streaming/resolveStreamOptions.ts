import { Chat } from '@moc-global/loft-definitions';

export interface ResolvedStreamOptions {
  enabled: boolean;
  reasoning: boolean;
  toolCalls: 'none' | 'names' | 'args';
  textPolicy: 'all' | 'after-middleware';
  /** True when neither the chat config nor the call chose the text policy */
  policyDefaulted: boolean;
}

/**
 * The streaming options of one call: the per-call options over the chat config's, key by key. Without a chosen text
 * policy, text is held until the end when output-transforming middleware is registered, and streamed otherwise.
 */
export function resolveStreamOptions(
  config?: Chat.StreamOptions,
  call?: Chat.StreamOptions,
  outputMiddleware: string[] = []
): ResolvedStreamOptions {
  const chosenPolicy = call?.textPolicy ?? config?.textPolicy;
  return {
    enabled: call?.enabled ?? config?.enabled ?? true,
    reasoning: call?.include?.reasoning ?? config?.include?.reasoning ?? false,
    toolCalls: call?.include?.toolCalls ?? config?.include?.toolCalls ?? 'names',
    textPolicy: chosenPolicy ?? (outputMiddleware.length > 0 ? 'after-middleware' : 'all'),
    policyDefaulted: chosenPolicy === undefined
  };
}

/**
 * Whether providers make today's calls: with streaming switched off, or when the options deliver no provider event
 * (text held until the end and no reasoning).
 */
export function isObserveOnly(options: ResolvedStreamOptions): boolean {
  return !options.enabled || (options.textPolicy === 'after-middleware' && !options.reasoning);
}

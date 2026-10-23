import { Logger, Type } from '@moc-global/loft-definitions';

import { mapStrings, textOfParts } from '../content';
import type { ListedTool, LoftMiddleware, ToolInfo, ToolOutput } from '../types';
import {
  heuristicDetector,
  type InjectionDetector,
  type InjectionInput,
  type InjectionSource,
  type InjectionVerdict
} from './detectors';
import { InjectionDetectedError } from './errors';

const log = new Logger('InjectionGuard');

/** The text a flagged user message is replaced with. */
export const QUARANTINED_MESSAGE_TEXT = '[message removed: possible prompt injection]';
/** The text a flagged augmented-context message is replaced with. */
export const WITHHELD_CONTEXT_TEXT = '[context withheld: possible prompt injection]';
/** The text a flagged tool output is replaced with. */
export const WITHHELD_TOOL_OUTPUT_TEXT = '[tool output withheld: possible prompt injection]';
const DEFAULT_BLOCK_MESSAGE = 'Sorry, I cannot help with that message.';
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

// A detector's answer, or an error when it is not a verdict, so that it counts as a failed detector
function verdictOf(value: unknown): InjectionVerdict {
  if (typeof value === 'object' && value !== null && 'flagged' in value && typeof value.flagged === 'boolean') {
    const categories = 'categories' in value && Array.isArray(value.categories) ? value.categories : [];
    return {
      flagged: value.flagged,
      categories: categories.filter((category): category is string => typeof category === 'string')
    };
  }
  throw new TypeError('An injection detector returned no verdict');
}

/** Reported for each flagged text. It never carries the text itself. */
export interface InjectionDetection {
  source: InjectionSource;
  categories: readonly string[];
  toolName?: string;
}

/** What the guard records in `message.ctx.loftGuard.injection` of a flagged user message. */
export interface InjectionFlag {
  categories: readonly string[];
}

export interface InjectionGuardOptions {
  /** The name the chat hooks are registered under. Default `injection-guard` */
  name?: string;
  /** Default: `[heuristicDetector()]`. A text is flagged when any detector flags it */
  detectors?: readonly InjectionDetector[];
  /** Checks user messages. Default true */
  user?: boolean;
  /**
   * Checks the augmented context, such as retrieved documents, and withholds a flagged message from the model without
   * blocking the reply. Default false: turn it on when the augmented context carries text from outside, as the checks
   * may flag your own system instructions
   */
  augmentedContext?: boolean;
  /** Checks tool outputs (applied by `guardMcpClient` and `guardTool`). Default true */
  toolResults?: boolean;
  /** Checks the descriptions of MCP tools and leaves flagged tools out (applied by `guardMcpClient`). Default true */
  toolDescriptions?: boolean;
  /**
   * What `generate()` does when the newest user message is flagged: `block` answers with `blockMessage` without
   * calling the model, `throw` rejects with an error whose cause chain holds an `InjectionDetectedError` (see
   * `findInjectionDetected`), before any event is emitted. Default `block`
   */
  onUserFlag?: 'block' | 'throw';
  /** The reply when a message is blocked. It never repeats the message */
  blockMessage?: string;
  /** Marks a flagged user message `llmIgnore`, so it never reaches the model in later turns either. Default true */
  quarantine?: boolean;
  /** How long the detectors may take for one text, at most about 24 days (2³¹−1 ms). Default 5000 ms */
  timeoutMs?: number;
  /**
   * What a detector that fails or times out means: `flag` treats the text as flagged, `allow` as clean, either way
   * keeping what the other detectors found. Default `flag`. With a hosted detector, `flag` turns its outage into
   * blocked messages, withheld tool outputs and an empty tool list.
   */
  onDetectorError?: 'flag' | 'allow';
  /** Authors whose messages are not checked, such as messages your own code adds as the user */
  ignoreAuthors?: readonly string[];
  /** Called for each flagged text. An error it throws is logged, and the guard goes on */
  onDetect?: (detection: InjectionDetection) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The flag the guard recorded on a message, if any. */
export function injectionFlagOf(message: { ctx?: unknown }): InjectionFlag | undefined {
  const guard = isRecord(message.ctx) ? message.ctx.loftGuard : undefined;
  const injection = isRecord(guard) ? guard.injection : undefined;
  if (!isRecord(injection) || !Array.isArray(injection.categories)) return undefined;
  return { categories: injection.categories.filter((category): category is string => typeof category === 'string') };
}

// Every text of a tool the model reads: its name, title, description, annotations and the descriptions, titles and
// values in its input schema
function toolText(tool: ListedTool): string {
  const texts: string[] = [];
  mapStrings([tool.name, tool.title, tool.description, tool.annotations, tool.inputSchema], (text) => {
    texts.push(text);
    return text;
  });
  return texts.join('\n');
}

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

/**
 * Detects prompt injection in user messages, tool outputs, MCP tool descriptions and, when asked, the augmented
 * context.
 *
 * - A flagged user message is replaced by a placeholder, marked in `ctx.loftGuard.injection` and, by default, marked
 *   `llmIgnore`. This happens in the Input middleware, so it holds for `addMessages()` too.
 * - When the newest user message is flagged, `generate()` answers with a fixed message or throws (`onUserFlag`).
 * - A flagged tool output is replaced by a placeholder marked as an error; a tool whose description is flagged is
 *   left out of the tool list.
 *
 * Detection is probabilistic and can be evaded. Use it as one layer, with tools that have the least access they need.
 */
export function injectionGuard(options: InjectionGuardOptions = {}): LoftMiddleware {
  const detectors = options.detectors ?? [heuristicDetector()];
  if (detectors.length === 0) throw new Error('injectionGuard needs at least one detector');
  const timeoutMs = options.timeoutMs ?? 5000;
  // A longer delay makes setTimeout fire at once, which would fail every check
  if (!(timeoutMs > 0 && timeoutMs <= MAX_TIMEOUT_MS)) {
    throw new RangeError(`timeoutMs must be more than 0 and at most ${MAX_TIMEOUT_MS}`);
  }
  const ignoreAuthors = new Set(options.ignoreAuthors ?? []);
  const quarantine = options.quarantine ?? true;
  const { onDetect } = options;

  const check = async (input: InjectionInput): Promise<readonly string[] | undefined> => {
    if (input.text.trim().length === 0) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error(`Injection detection timed out after ${timeoutMs} ms`)),
      timeoutMs
    );
    try {
      const aborted = rejectOnAbort(controller.signal);
      // The guard aborts the signal when it is done, so this rejects even when no detector is still running
      aborted.catch(() => undefined);
      // Every detector has its say: one that fails does not discard what another found
      const results = await Promise.allSettled(
        detectors.map((detector) =>
          Promise.race([
            Promise.resolve()
              .then(() => detector.detect(input, controller.signal))
              .then(verdictOf),
            aborted
          ])
        )
      );
      const verdicts = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
      const categories = new Set(
        verdicts.filter((verdict) => verdict.flagged).flatMap((verdict) => verdict.categories)
      );
      let flagged = verdicts.some((verdict) => verdict.flagged);
      const failure = results.find((result) => result.status === 'rejected');
      if (failure) {
        log.warn('An injection detector failed', {
          source: input.source,
          errorName: failure.reason instanceof Error ? failure.reason.name : typeof failure.reason
        });
        if (options.onDetectorError !== 'allow') {
          flagged = true;
          categories.add('detector-error');
        }
      }
      return flagged ? [...categories] : undefined;
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };

  const flagged = async (input: InjectionInput): Promise<readonly string[] | undefined> => {
    const categories = await check(input);
    if (categories && onDetect) {
      try {
        onDetect({ source: input.source, categories, ...(input.toolName && { toolName: input.toolName }) });
      } catch (error) {
        log.warn('The onDetect callback of the injection guard failed', {
          errorName: error instanceof Error ? error.name : typeof error
        });
      }
    }
    return categories;
  };

  // The message with its text replaced and the finding recorded in its ctx
  const replaced = <T extends Type.Entity.CreateMessage>(
    message: T,
    text: string,
    categories: readonly string[],
    llmIgnore: boolean
  ): T => {
    const ctx = isRecord(message.ctx) ? message.ctx : {};
    const guard = isRecord(ctx.loftGuard) ? ctx.loftGuard : {};
    return {
      ...message,
      content: [{ type: 'text', text }],
      ctx: { ...ctx, loftGuard: { ...guard, injection: { categories } } },
      llmIgnore
    };
  };

  // A clean message without a flag the caller set, which would otherwise block the reply
  const withoutFlag = <T extends Type.Entity.CreateMessage>(message: T): T => {
    if (!injectionFlagOf(message) || !isRecord(message.ctx) || !isRecord(message.ctx.loftGuard)) return message;
    const { injection: _injection, ...guard } = message.ctx.loftGuard;
    return { ...message, ctx: { ...message.ctx, loftGuard: guard } };
  };

  const quarantined = async <T extends Type.Entity.CreateMessage>(message: T): Promise<T> => {
    if (message.role !== Type.LLM.UnifiedMessageRole.user || ignoreAuthors.has(message.author)) return message;
    const text = textOfParts(message.content);
    // Checked before: the second Input run sees the placeholder. A flag the caller set on other text is not trusted
    if (text === QUARANTINED_MESSAGE_TEXT && injectionFlagOf(message)) return message;
    const categories = await flagged({ text, source: 'user' });
    if (!categories) return withoutFlag(message);
    return replaced(message, QUARANTINED_MESSAGE_TEXT, categories, quarantine || message.llmIgnore);
  };

  const withheld = async <T extends Type.Entity.CreateMessage>(message: T): Promise<T> => {
    if (ignoreAuthors.has(message.author)) return message;
    const text = textOfParts(message.content);
    if (text === WITHHELD_CONTEXT_TEXT && injectionFlagOf(message)) return message;
    const categories = await flagged({ text, source: 'augmentedContext' });
    return categories ? replaced(message, WITHHELD_CONTEXT_TEXT, categories, true) : message;
  };

  const checksUser = options.user ?? true;
  const checksContext = options.augmentedContext ?? false;
  return {
    name: options.name ?? 'injection-guard',
    ...((checksUser || checksContext) && {
      input: async (_context, payload, chain) => {
        if (checksUser) payload.directMessages = await Promise.all(payload.directMessages.map(quarantined));
        if (checksContext) payload.augmentedContext = await Promise.all(payload.augmentedContext.map(withheld));
        chain.next();
        return payload;
      }
    }),
    ...(checksUser && {
      beforeGenerate: async (context, payload, chain) => {
        // The newest user message: in this request, or else the last message of the history when it waits for a reply
        const direct = payload.directMessages.filter((message) => message.role === Type.LLM.UnifiedMessageRole.user);
        const history = context.chatHistory.messages;
        const pending = history.at(-1)?.role === Type.LLM.UnifiedMessageRole.user ? history.at(-1) : undefined;
        const newest = direct.at(-1) ?? pending;
        const flag = newest && injectionFlagOf(newest);
        if (!flag) {
          chain.next();
          return payload;
        }
        if (options.onUserFlag === 'throw') throw new InjectionDetectedError(flag.categories);
        chain.preventGeneration({
          content: [{ type: 'text', text: options.blockMessage ?? DEFAULT_BLOCK_MESSAGE }],
          role: Type.LLM.UnifiedMessageRole.assistant
        });
        return payload;
      }
    }),
    ...((options.toolResults ?? true) && {
      toolResult: async (output: ToolOutput, tool: ToolInfo): Promise<ToolOutput> => {
        const categories = await flagged({
          text: textOfParts(output.content),
          source: 'toolResult',
          toolName: tool.toolName
        });
        return categories ? { content: [{ type: 'text', text: WITHHELD_TOOL_OUTPUT_TEXT }], isError: true } : output;
      }
    }),
    ...((options.toolDescriptions ?? true) && {
      toolList: async <T extends ListedTool>(tools: T[]): Promise<T[]> => {
        const verdicts = await Promise.all(
          tools.map((tool) => flagged({ text: toolText(tool), source: 'toolDescription', toolName: tool.name }))
        );
        return tools.filter((_tool, index) => !verdicts[index]);
      }
    })
  };
}

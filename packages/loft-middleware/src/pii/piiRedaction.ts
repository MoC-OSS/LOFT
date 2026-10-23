import { Logger, type Type } from '@moc-global/loft-definitions';

import { mapContent, mapToolContent, type TextMap } from '../content';
import type { LoftMiddleware } from '../types';
import { defaultPiiDetectors, type PiiDetector } from './detectors';
import { createRedactor, type PiiStrategy } from './redact';

const log = new Logger('PiiRedaction');

/** Where personal data was found. */
export type PiiStage = 'input' | 'toolResult' | 'output';

/** Reported once per stage and type that had findings. It never carries the data itself. */
export interface PiiDetection {
  type: string;
  count: number;
  stage: PiiStage;
}

export interface PiiRedactionOptions {
  /** The name the chat hooks are registered under. Default `pii-redaction` */
  name?: string;
  /** Default: `defaultPiiDetectors()`, which finds e-mail addresses, payment card numbers and IBANs */
  detectors?: readonly PiiDetector[];
  /** Default `redact` */
  strategy?: PiiStrategy;
  /** Masks every string sent to the tracer (applied by `maskTracerFactory` and `maskTracer`). Default true */
  traces?: boolean;
  /**
   * Redacts the messages of a request (direct messages and augmented context) before they are stored or sent to the
   * model. Default false. The real values are then gone for good: history keeps the redacted text, and a tool that
   * needs the value, such as an e-mail address, receives the placeholder.
   */
  input?: boolean;
  /**
   * Redacts tool outputs before the model sees them (applied by `guardMcpClient` and `guardTool`). Default false. The
   * stored tool messages keep the redacted text.
   */
  toolResults?: boolean;
  /**
   * Redacts the reply, and the stored copy of the tool calls and results, after the model has answered. Default
   * false. When on, streamed text is held back until the reply is complete: the text policy defaults to
   * `'after-middleware'`.
   */
  output?: boolean;
  /** Called with what was found where. Not called for traces. An error it throws is logged, and redaction goes on */
  onDetect?: (detection: PiiDetection) => void;
}

/**
 * Redacts personal data. By default only from traces; the request, tool outputs and the reply are opt-in, see the
 * options. Apply the middleware with `applyMiddleware`, `maskTracerFactory`, `guardMcpClient` and `guardTool`.
 */
export function piiRedaction(options: PiiRedactionOptions = {}): LoftMiddleware {
  const detectors = options.detectors ?? defaultPiiDetectors();
  if (detectors.length === 0) throw new Error('piiRedaction needs at least one detector');
  const strategy = options.strategy ?? 'redact';
  const { onDetect } = options;

  // A redactor that reports what it found once the stage is done
  const redactIn = <T>(stage: PiiStage, run: (redact: TextMap) => T): T => {
    const counts = new Map<string, number>();
    const result = run(createRedactor(detectors, strategy, (type) => counts.set(type, (counts.get(type) ?? 0) + 1)));
    if (!onDetect) return result;
    for (const [type, count] of counts) {
      try {
        onDetect({ type, count, stage });
      } catch (error) {
        log.warn('The onDetect callback of the PII redaction failed', {
          errorName: error instanceof Error ? error.name : typeof error
        });
      }
    }
    return result;
  };
  const redactMessages = <T extends Type.Entity.CreateMessage>(messages: T[], redact: TextMap): T[] =>
    messages.map((message) => ({ ...message, content: mapContent(message.content, redact) }));

  return {
    name: options.name ?? 'pii-redaction',
    ...((options.traces ?? true) && { maskTrace: createRedactor(detectors, strategy) }),
    ...(options.input && {
      input: async (_context, payload, chain) => {
        redactIn('input', (redact) => {
          payload.directMessages = redactMessages(payload.directMessages, redact);
          payload.augmentedContext = redactMessages(payload.augmentedContext, redact);
        });
        chain.next();
        return payload;
      }
    }),
    ...(options.toolResults && {
      toolResult: (output) =>
        redactIn('toolResult', (redact) => ({ ...output, content: mapToolContent(output.content, redact) }))
    }),
    ...(options.output && {
      afterGenerate: async (_context, payload, chain) => {
        const { llmResponse } = payload;
        redactIn('output', (redact) => {
          // The payload is LOFT's copy: the messages are changed in place, so they keep their methods
          const messages = new Set([llmResponse.topChoice, ...llmResponse.choices, ...(llmResponse.usedTools ?? [])]);
          for (const message of messages) message.content = mapContent(message.content, redact);
        });
        chain.next();
        return payload;
      }
    })
  };
}

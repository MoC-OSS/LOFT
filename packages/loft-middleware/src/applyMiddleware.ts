import {
  type ContextInterface,
  type GenerateRequestParameters,
  type Interface,
  Logger,
  type StandardMiddleware
} from '@moc-global/loft-definitions';

import { masksTraceOf } from './maskTracer';
import type { LoftMiddleware } from './types';

const log = new Logger('LoftMiddleware');

/** The part of a chat constructor that registers chat middleware. */
export type MiddlewareRegistrar = Pick<
  Interface.ChatConstructor,
  'registerInputMiddleware' | 'registerBeforeGenerateMiddleware' | 'registerAfterGenerateMiddleware'
>;

// LOFT's tracer when no tracer factory is given; it sends nothing, so there is nothing to mask
const NO_OP_TRACER = 'NoOpTracer';

// The Input hook of a middleware with a trace mask: on the first request, it warns when the chat's tracer does not apply
// the mask, which happens when the tracer factory was not wrapped with maskTracerFactory
function checkingTraceMask(item: LoftMiddleware): StandardMiddleware<ContextInterface, GenerateRequestParameters> {
  let checked = false;
  return async (context, payload, chain) => {
    if (!checked) {
      checked = true;
      const { tracer } = context;
      if (tracer.constructor.name !== NO_OP_TRACER && !masksTraceOf(tracer, item)) {
        log.warn(
          'A middleware masks traces, but the chat tracer does not apply its mask: wrap the tracer factory passed to ' +
            'LoftConstructor with maskTracerFactory, or traces carry the data unmasked',
          { middleware: item.name }
        );
      }
    }
    if (item.input) return item.input(context, payload, chain);
    chain.next();
    return payload;
  };
}

/**
 * Registers the chat hooks of each middleware (`input`, `beforeGenerate`, `afterGenerate`) under its name, in the
 * order given. Tool and trace hooks are applied by `guardMcpClient`, `guardTool` and `maskTracerFactory`.
 *
 * A middleware with a trace mask also gets an Input hook that warns once, on the first request, when the chat's
 * tracer does not apply the mask.
 *
 * LOFT runs middleware in the order it was registered, and a middleware that does not call `chain.next()` stops the
 * chain. Apply guards before your own middleware, so that they see every request.
 */
export function applyMiddleware(chat: MiddlewareRegistrar, middleware: readonly LoftMiddleware[]): void {
  for (const item of middleware) {
    if (item.maskTrace) chat.registerInputMiddleware(item.name, checkingTraceMask(item));
    else if (item.input) chat.registerInputMiddleware(item.name, item.input);
    if (item.beforeGenerate) chat.registerBeforeGenerateMiddleware(item.name, item.beforeGenerate);
    if (item.afterGenerate) {
      chat.registerAfterGenerateMiddleware(item.name, item.afterGenerate, {
        transformsOutput: item.afterGenerateTransformsOutput ?? true
      });
    }
  }
}

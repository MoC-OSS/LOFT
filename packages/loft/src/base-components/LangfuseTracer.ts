/**
 * Langfuse Tracer Integration for LOFT
 *
 * Usage example:
 *
 * ```typescript
 * import { LoftConstructor, LangfuseTracer } from '@moc-global/loft';
 *
 * // With default NoOp tracer (no tracing)
 * const loft = new LoftConstructor(loftConfig, manifestManagerConstructor, chatConstructor);
 *
 * // With Langfuse tracing
 * const loft = new LoftConstructor(
 *   loftConfig,
 *   manifestManagerConstructor,
 *   chatConstructor,
 *   new LangfuseTracer({
 *     secretKey: 'sk-lf-...',
 *     publicKey: 'pk-lf-...',
 *     baseUrl: 'https://cloud.langfuse.com' // optional
 *   })
 * );
 *
 * // When you bundle your app (esbuild, webpack), pass the Langfuse class so the bundler includes it
 * import { Langfuse } from 'langfuse';
 * const tracer = new LangfuseTracer(config, { Langfuse });
 *
 * // In user code, access tracer via context
 * const result = await chat.generate({
 *   sessionId: 'session-123',
 *   directMessages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }]
 * });
 *
 * // Custom tracing within middleware or handlers
 * const span = ctx.tracer.span({ name: 'custom-operation', input: data });
 * // ... do work
 * span.end({ output: result });
 *
 * // Graceful shutdown
 * process.on('SIGTERM', async () => {
 *   await loft.gracefulShutdown();
 *   process.exit(0);
 * });
 * ```
 */

import { createRequire } from 'node:module';

import { Strategy } from '@moc-global/loft-definitions';
import type { Langfuse, LangfuseGenerationClient, LangfuseSpanClient, LangfuseTraceClient } from 'langfuse';

export interface LangfuseTracerConfig {
  secretKey: string;
  publicKey: string;
  baseUrl?: string;
  enabled?: boolean;
  release?: string;
  requestTimeout?: number;
  environment?: string;
}

/** The langfuse module, or the part LangfuseTracer uses. Pass it when a bundler must see the import. */
export interface LangfuseModule {
  Langfuse: typeof Langfuse;
}

/** Set by tsup: true in the ES module build, false in the CommonJS build, undefined when the sources run directly. */
declare const __LOFT_ESM_BUILD__: boolean | undefined;

const BUNDLE_HINT = 'If you bundle your application, pass the class instead: new LangfuseTracer(config, { Langfuse })';

// The ES module build reads its URL here, when a tracer is created, and not at import: a bundler that turns
// the ES module build into CommonJS leaves import.meta empty, and the app must not fail to load because of it.
function requireFromHere(): NodeJS.Require {
  if (typeof __LOFT_ESM_BUILD__ !== 'undefined' && __LOFT_ESM_BUILD__) {
    // @ts-expect-error import.meta needs an ES module target; tsup builds this branch only into the ES module build
    const url: string | undefined = import.meta.url;
    if (!url) throw new Error(`LangfuseTracer cannot load the langfuse package from this bundle. ${BUNDLE_HINT}`);
    return createRequire(url);
  }
  return createRequire(__filename);
}

// langfuse is an optional peer dependency, so it is loaded when a LangfuseTracer is created,
// not when @moc-global/loft is imported. Bundlers cannot follow this require; see LangfuseModule.
function loadLangfuse(): LangfuseModule {
  try {
    return requireFromHere()('langfuse');
  } catch (error) {
    // Only when langfuse itself is missing: a module that langfuse needs keeps its own error
    const missing = (error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND';
    if (!missing || !String((error as Error).message).includes("'langfuse'")) throw error;
    throw new Error(
      `LangfuseTracer needs the langfuse package. Install it with: npm install langfuse@^3. ${BUNDLE_HINT}`,
      { cause: error }
    );
  }
}

export class LangfuseTracer implements Strategy.Tracer.TracerFactory {
  private langfuse: Langfuse;

  /**
   * @param langfuseModule The langfuse module, `{ Langfuse }`, imported by your code. Pass it when you bundle your
   * application, because a bundler cannot see the package otherwise. By default LangfuseTracer loads it itself.
   */
  constructor(config: LangfuseTracerConfig, langfuseModule: LangfuseModule = loadLangfuse()) {
    this.langfuse = new langfuseModule.Langfuse(config);
  }

  createTracer(params: Parameters<Strategy.Tracer.TracerFactory['createTracer']>[0]): Strategy.Tracer.Tracer {
    const trace = this.langfuse.trace({
      ...params,
      id: params.traceId
    });

    return new LangfuseTracerInstance(trace, this.langfuse);
  }

  async shutdownAsync(): Promise<void> {
    await this.langfuse.shutdownAsync();
  }
}

class LangfuseTracerInstance implements Strategy.Tracer.Tracer {
  constructor(
    private trace: LangfuseTraceClient,
    private langfuse: Langfuse,
    private parentId?: string
  ) {}

  withParent(parentId: string): Strategy.Tracer.Tracer {
    return new LangfuseTracerInstance(this.trace, this.langfuse, parentId);
  }

  span(params: Parameters<Strategy.Tracer.Tracer['span']>[0]): Strategy.Tracer.Span {
    const spanParams = {
      ...params,
      traceId: this.trace.id,
      parentObservationId: params.parentId || this.parentId
    };
    const span = this.langfuse.span(spanParams);
    return new LangfuseSpanInstance(span);
  }

  generation(params: Parameters<Strategy.Tracer.Tracer['generation']>[0]): Strategy.Tracer.Generation {
    // For manual nesting use langfuse.generation() with explicit traceId and parentObservationId
    const genParams = {
      ...params,
      traceId: this.trace.id,
      parentObservationId: params.parentId || this.parentId
    };
    const generation = this.langfuse.generation(genParams);
    return new LangfuseGenerationInstance(generation);
  }

  event(params: Parameters<Strategy.Tracer.Tracer['event']>[0]): void {
    // For manual nesting use langfuse.event() with explicit traceId and parentObservationId
    const eventParams = {
      ...params,
      traceId: this.trace.id,
      parentObservationId: params.parentId || this.parentId
    };
    this.langfuse.event(eventParams);
  }

  score(params: Parameters<Strategy.Tracer.Tracer['score']>[0]): void {
    this.trace.score(params);
  }

  update(params: Parameters<Strategy.Tracer.Tracer['update']>[0]): void {
    this.trace.update(params);
  }

  async flushAsync(): Promise<void> {
    await this.langfuse.flushAsync();
  }
}

class LangfuseSpanInstance implements Strategy.Tracer.Span {
  public readonly id: string;

  constructor(private langfuseSpan: LangfuseSpanClient) {
    // Langfuse automatically generates an ID for the span
    this.id = langfuseSpan.id;
  }

  end(params?: Parameters<Strategy.Tracer.Span['end']>[0]): void {
    this.langfuseSpan.end(params);
  }

  span(params: Parameters<Strategy.Tracer.Tracer['span']>[0]): Strategy.Tracer.Span {
    const span = this.langfuseSpan.span(params);
    return new LangfuseSpanInstance(span);
  }

  generation(params: Parameters<Strategy.Tracer.Tracer['generation']>[0]): Strategy.Tracer.Generation {
    const generation = this.langfuseSpan.generation(params);
    return new LangfuseGenerationInstance(generation);
  }

  event(params: Parameters<Strategy.Tracer.Tracer['event']>[0]): void {
    this.langfuseSpan.event(params);
  }
}

class LangfuseGenerationInstance implements Strategy.Tracer.Generation {
  public readonly id: string;

  constructor(private generation: LangfuseGenerationClient) {
    // Langfuse automatically generates an ID for the generation
    this.id = generation.id;
  }

  end(params?: Parameters<Strategy.Tracer.Generation['end']>[0]): void {
    this.generation.end(params);
  }
}

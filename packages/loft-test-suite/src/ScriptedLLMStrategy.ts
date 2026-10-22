import { InteractiveOutputMessage, Logger, Strategy, Type } from '@moc-global/loft-definitions';
import { z } from 'zod';

import { ScriptedTurnPlayer } from './scriptedTurns';

/** A tool call the scripted model makes. The call id defaults to `<name>:::scripted-<n>`. */
export interface ScriptedToolCall {
  name: string;
  arguments?: Record<string, unknown>;
  callId?: string;
}

/**
 * How a `text` or `toolCalls` turn streams. These fields only take effect when the call has an `onEvent` sink and
 * the turn has `chunks`; without a sink the turn is answered with its `text` at once.
 *
 * @experimental
 */
export interface ScriptedStreaming {
  /** The text in pieces; the pieces must join to the turn's `text`. Each piece is sent as a `text-delta` event. */
  chunks?: string[];
  /** The number of `activity` events sent before the first chunk. */
  activityChunks?: number;
  /** Milliseconds to wait between events (activity and chunks alike). */
  chunkDelayMs?: number;
  /** The call fails with this error after all chunks were sent. */
  failAfterChunks?: Error;
  /** The call hangs after the chunks until it is cancelled through its AbortSignal. */
  waitForAbortAfterChunks?: true;
}

/**
 * One reply of the scripted model:
 * - `text`: a final answer
 * - `toolCalls`: one or more tool calls in one assistant message, with optional text beside them
 * - `error`: the provider call fails with this error
 * - `waitForAbort`: the call hangs until the generate() call is cancelled through its AbortSignal
 *
 * `text` and `toolCalls` replies may also carry the streaming fields of {@link ScriptedStreaming}.
 */
export type ScriptedTurn =
  | ({ text: string } & ScriptedStreaming)
  | ({ toolCalls: ScriptedToolCall[]; text?: string } & ScriptedStreaming)
  | { error: Error }
  | { waitForAbort: true };

/** A reply, or a function that chooses one from what the model was sent. */
export type ScriptedReply = ScriptedTurn | ((call: ScriptedLLMCall) => ScriptedTurn | Promise<ScriptedTurn>);

/** One message of the context window, reduced to what tests assert on. */
export interface ScriptedMessage {
  role: Type.LLM.UnifiedMessageRole;
  text: string;
  toolCalls: Array<{ callId?: string; name: string; arguments?: Record<string, unknown> }>;
  toolResults: Array<{ callId?: string; text: string; isError: boolean }>;
}

/** What the scripted model received on one call. */
export interface ScriptedLLMCall {
  systemMessage: string;
  messages: ScriptedMessage[];
  toolNames: string[];
  modelPreset: Type.LLMManifestProps['modelPreset'];
}

export interface ScriptedResponse {
  text?: string;
  toolCalls: Array<Required<Pick<ScriptedToolCall, 'name' | 'callId'>> & Pick<ScriptedToolCall, 'arguments'>>;
}

type McpTools = Parameters<Strategy.LLM.LoftLLM<ScriptedLLMCall, ScriptedResponse>['formatToLLMRequest']>[4];

const SCRIPT_THE_API =
  'A ScriptedLLMStrategy with a call manager strategy has no replies of its own: script the ScriptedLLMApi instead';

function textOf(parts: ReadonlyArray<{ type: string; text?: string }>): string {
  return parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('');
}

function toScriptedMessage(message: Type.Entity.Message): ScriptedMessage {
  const toolCalls: ScriptedMessage['toolCalls'] = [];
  const toolResults: ScriptedMessage['toolResults'] = [];
  for (const part of message.content) {
    if (part.type === 'tool_call') {
      toolCalls.push({ callId: part.callId, name: part.params.name, arguments: part.params.arguments });
    } else if (part.type === 'tool_result') {
      toolResults.push({ callId: part.callId, text: textOf(part.content), isError: part.isError ?? false });
    }
  }
  return { role: message.role, text: textOf(message.content), toolCalls, toolResults };
}

/**
 * An LLM strategy that answers from a script instead of a provider, so tests of the tool loop, middleware and agents
 * run offline and can assert exact tool calls and history. Each generate() call takes the next reply and records what
 * the model was sent in `calls`. A call after the last reply fails, so a test notices an unexpected extra call.
 */
export class ScriptedLLMStrategy extends Strategy.LLM.AbstractLoftLLM<ScriptedLLMCall, ScriptedResponse> {
  readonly llmName: string;
  readonly calls: ScriptedLLMCall[];
  protected readonly log = new Logger('LLMStrategy:Scripted');
  private readonly player: ScriptedTurnPlayer;

  /**
   * With a `callManagerStrategy`, generate() sends the request through it instead of playing `replies` itself, so the
   * replies belong to the `ScriptedLLMApi` behind the call manager. `calls` still records what this strategy was sent.
   *
   * @throws when the `chunks` of a reply do not join to its `text`, or when replies are given together with a
   * `callManagerStrategy`
   */
  constructor(llmName: string, replies: ScriptedReply[] = [], callManagerStrategy?: Strategy.CallManager) {
    super(callManagerStrategy);
    if (callManagerStrategy && replies.length > 0) throw new Error(SCRIPT_THE_API);
    this.llmName = llmName;
    this.player = new ScriptedTurnPlayer(`ScriptedLLMStrategy "${llmName}"`, replies);
    this.calls = this.player.calls;
  }

  /** Adds replies for later calls. Not available with a call manager strategy: script the `ScriptedLLMApi`. */
  script(...replies: ScriptedReply[]): this {
    if (this.callManagerStrategy) throw new Error(SCRIPT_THE_API);
    this.player.script(...replies);
    return this;
  }

  /** Replies not used yet. Not available with a call manager strategy: ask the `ScriptedLLMApi`. */
  get remainingReplies(): number {
    if (this.callManagerStrategy) throw new Error(SCRIPT_THE_API);
    return this.player.remainingReplies;
  }

  async generate(
    request: Strategy.LLM.LLMRequest<ScriptedLLMCall>,
    options?: Strategy.LLM.CallOptions
  ): Promise<Strategy.LLM.LlmResponse<ScriptedResponse>> {
    if (this.callManagerStrategy) {
      this.calls.push(request.llmBody);
      return super.generate(request, options);
    }
    const body = await this.player.play(request.llmBody, options);
    return { sessionId: request.sessionId, requestType: request.requestType, llmName: this.llmName, llmBody: body };
  }

  async formatToLLMRequest(
    _correlatorIds: string[],
    computedSystemMessage: string,
    modelPreset: Type.LLMManifestProps['modelPreset'],
    messages: Type.Entity.Message[],
    mcpTools?: McpTools
  ): Promise<ScriptedLLMCall> {
    return {
      systemMessage: computedSystemMessage,
      messages: messages.map(toScriptedMessage),
      toolNames: (mcpTools ?? []).map((tool) => tool.name),
      modelPreset
    };
  }

  formatToUnifiedLLMResponse(
    _correlatorIds: string[],
    sessionId: string,
    response: ScriptedResponse,
    llmName: string,
    manifestName: string
  ): Strategy.LLM.UnifiedLLMResponse {
    const content: Type.Entity.FullContentPart[] = [];
    if (response.text) content.push({ type: 'text', text: response.text });
    for (const toolCall of response.toolCalls) {
      content.push({
        type: 'tool_call',
        method: 'tools/call',
        callId: toolCall.callId,
        params: { name: toolCall.name, arguments: toolCall.arguments ?? {} }
      });
    }

    const topChoice = new InteractiveOutputMessage({
      sessionId,
      content,
      role: Type.LLM.UnifiedMessageRole.assistant,
      author: 'assistant',
      llmName,
      manifestName,
      ctx: {},
      llmIgnore: false
    });

    return {
      choices: [topChoice],
      topChoice,
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        model: 'scripted',
        finishReason: response.toolCalls.length > 0 ? 'tool_calls' : 'stop'
      },
      originalResponse: response
    };
  }

  generateModelPresetSchema() {
    return z.object({ model: z.string() }).passthrough();
  }

  generateResponseSchema() {
    return z.object({ text: z.string().optional(), toolCalls: z.array(z.object({ name: z.string() }).passthrough()) });
  }

  async getHealthCheckStatus(): Promise<boolean> {
    return true;
  }
}

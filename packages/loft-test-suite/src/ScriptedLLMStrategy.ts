import { InteractiveOutputMessage, Logger, Strategy, Type } from '@moc-global/loft-definitions';
import { z } from 'zod';

/** A tool call the scripted model makes. The call id defaults to `<name>:::scripted-<n>`. */
export interface ScriptedToolCall {
  name: string;
  arguments?: Record<string, unknown>;
  callId?: string;
}

/**
 * One reply of the scripted model:
 * - `text`: a final answer
 * - `toolCalls`: one or more tool calls in one assistant message, with optional text beside them
 * - `error`: the provider call fails with this error
 * - `waitForAbort`: the call hangs until the generate() call is cancelled through its AbortSignal
 */
export type ScriptedTurn =
  { text: string } | { toolCalls: ScriptedToolCall[]; text?: string } | { error: Error } | { waitForAbort: true };

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
  readonly calls: ScriptedLLMCall[] = [];
  protected readonly log = new Logger('LLMStrategy:Scripted');
  private readonly replies: ScriptedReply[];
  private toolCallCount = 0;

  constructor(llmName: string, replies: ScriptedReply[] = []) {
    super();
    this.llmName = llmName;
    this.replies = [...replies];
  }

  /** Adds replies for later calls. */
  script(...replies: ScriptedReply[]): this {
    this.replies.push(...replies);
    return this;
  }

  /** Replies not used yet. */
  get remainingReplies(): number {
    return this.replies.length;
  }

  async generate(
    request: Strategy.LLM.LLMRequest<ScriptedLLMCall>,
    options?: Strategy.LLM.CallOptions
  ): Promise<Strategy.LLM.LlmResponse<ScriptedResponse>> {
    options?.signal?.throwIfAborted();
    const call = request.llmBody;
    this.calls.push(call);

    const reply = this.replies.shift();
    if (!reply) {
      throw new Error(`ScriptedLLMStrategy "${this.llmName}" has no reply for call ${this.calls.length}`);
    }
    const turn = typeof reply === 'function' ? await reply(call) : reply;

    if ('error' in turn) throw turn.error;
    if ('waitForAbort' in turn) {
      const signal = options?.signal;
      if (!signal) throw new Error('A waitForAbort reply needs a generate() call with an AbortSignal');
      await new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }

    const body: ScriptedResponse =
      'toolCalls' in turn
        ? {
            text: turn.text,
            toolCalls: turn.toolCalls.map((toolCall) => ({
              name: toolCall.name,
              arguments: toolCall.arguments,
              callId: toolCall.callId ?? `${toolCall.name}:::scripted-${++this.toolCallCount}`
            }))
          }
        : { text: 'text' in turn ? turn.text : '', toolCalls: [] };

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

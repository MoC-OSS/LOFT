import { Schema, Type } from '@moc-global/loft-definitions';

/**
 * Conversations that end in tool calls and their results, shared by the LLM adapter tests so every
 * provider is checked against the same inputs. LlmManager stores one tool message per tool result.
 */
export interface ToolChainFixture {
  name: string;
  messages: Type.Entity.Message[];
  /** Call ids in the order the assistant made the calls; each needs exactly one result. */
  callIds: string[];
  /** Text of the failed tool's result, when the fixture has one. */
  errorText?: string;
}

const SESSION_ID = '00000000-0000-4000-8000-000000000001';

function message(
  sequence: number,
  role: Schema.LLM.UnifiedMessageRole,
  content: Type.Entity.FullContentPart[]
): Type.Entity.Message {
  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    sessionId: SESSION_ID,
    sequenceId: String(sequence),
    ctx: {},
    content,
    role,
    author: role,
    llmName: 'test-llm',
    manifestName: 'test-manifest',
    llmIgnore: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z')
  };
}

function toolCall(callId: string, name: string, args: Record<string, unknown>): Type.Entity.FullContentPart {
  return { type: 'tool_call', method: 'tools/call', callId, params: { name, arguments: args } };
}

function toolResult(callId: string, text: string, isError = false): Type.Entity.FullContentPart {
  return { type: 'tool_result', callId, content: [{ type: 'text', text }], isError };
}

// Call ids follow generateToolCallId's `<tool name>:::<random>` format, which the Gemini adapter parses
const WEATHER_CALL = 'get_weather:::a1';
const TIME_CALL = 'get_time:::b2';
const BOOKING_CALL = 'book_table:::c3';

const userAsks = (sequence: number, text: string) =>
  message(sequence, Schema.LLM.UnifiedMessageRole.user, [{ type: 'text', text }]);

export const singleToolCall: ToolChainFixture = {
  name: 'single tool call',
  callIds: [WEATHER_CALL],
  messages: [
    userAsks(1, 'What is the weather in Kyiv?'),
    message(2, Schema.LLM.UnifiedMessageRole.assistant, [toolCall(WEATHER_CALL, 'get_weather', { city: 'Kyiv' })]),
    message(3, Schema.LLM.UnifiedMessageRole.tool, [toolResult(WEATHER_CALL, '18°C, cloudy')])
  ]
};

export const parallelToolCalls: ToolChainFixture = {
  name: 'parallel tool calls',
  callIds: [WEATHER_CALL, TIME_CALL],
  messages: [
    userAsks(1, 'What is the weather and the time in Kyiv?'),
    message(2, Schema.LLM.UnifiedMessageRole.assistant, [
      { type: 'text', text: 'Checking both.' },
      toolCall(WEATHER_CALL, 'get_weather', { city: 'Kyiv' }),
      toolCall(TIME_CALL, 'get_time', { city: 'Kyiv' })
    ]),
    message(3, Schema.LLM.UnifiedMessageRole.tool, [toolResult(WEATHER_CALL, '18°C, cloudy')]),
    message(4, Schema.LLM.UnifiedMessageRole.tool, [toolResult(TIME_CALL, '14:05')])
  ]
};

export const toolCallWithError: ToolChainFixture = {
  name: 'parallel tool calls with one error',
  callIds: [WEATHER_CALL, BOOKING_CALL],
  errorText: 'No table free at 19:00',
  messages: [
    userAsks(1, 'Book a table for 19:00 and tell me the weather.'),
    message(2, Schema.LLM.UnifiedMessageRole.assistant, [
      toolCall(WEATHER_CALL, 'get_weather', { city: 'Kyiv' }),
      toolCall(BOOKING_CALL, 'book_table', { time: '19:00' })
    ]),
    message(3, Schema.LLM.UnifiedMessageRole.tool, [toolResult(WEATHER_CALL, '18°C, cloudy')]),
    message(4, Schema.LLM.UnifiedMessageRole.tool, [toolResult(BOOKING_CALL, 'No table free at 19:00', true)])
  ]
};

export const toolChainFixtures: ToolChainFixture[] = [singleToolCall, parallelToolCalls, toolCallWithError];

/** An assistant tool call without a call id, as a custom repository or an old message may hold. */
export const toolCallWithoutCallId: Type.Entity.Message[] = [
  userAsks(1, 'What is the weather in Kyiv?'),
  message(2, Schema.LLM.UnifiedMessageRole.assistant, [
    { type: 'tool_call', method: 'tools/call', params: { name: 'get_weather', arguments: { city: 'Kyiv' } } }
  ])
];

// A 1x1 transparent PNG
export const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** A user message with text, a base64 image and an image URL. */
export const imageMessage: Type.Entity.Message = message(1, Schema.LLM.UnifiedMessageRole.user, [
  { type: 'text', text: 'What is in these pictures?' },
  { type: 'image', format: Schema.Entity.ImageFormat.BASE64, data: PNG_BASE64, mimeType: 'image/png' },
  { type: 'image', format: Schema.Entity.ImageFormat.URL, url: 'https://example.com/cat.jpg' }
]);

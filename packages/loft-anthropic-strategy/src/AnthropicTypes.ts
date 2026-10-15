import Anthropic from '@anthropic-ai/sdk';

export type AnthropicRequest = Anthropic.MessageCreateParamsNonStreaming;
export type AnthropicStreamRequest = Anthropic.MessageCreateParamsStreaming;
export type AnthropicResponse = Anthropic.Message;
// export type AnthropicStreamResponse = Stream<Anthropic.RawMessageStreamEvent>;
export type AnthropicResponseChunk = Anthropic.RawMessageStreamEvent;

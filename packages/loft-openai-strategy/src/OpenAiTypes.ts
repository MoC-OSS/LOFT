export * as OpenAiLlm from 'openai';

import { ChatCompletionStreamParams } from 'openai/lib/ChatCompletionStream';
import { ChatCompletion, ChatCompletionChunk, ChatCompletionCreateParamsBase } from 'openai/resources/chat/completions';
import { Stream } from 'openai/streaming';

export type OpenAiRequest = ChatCompletionCreateParamsBase;
export type OpenAiStreamRequest = ChatCompletionStreamParams;
export type OpenAiResponse = ChatCompletion;
export type OpenAiStreamResponse = Stream<ChatCompletionChunk>;
export type OpenAiResponseChunk = ChatCompletionChunk;

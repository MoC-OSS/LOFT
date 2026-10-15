import { Strategy } from '@moc-global/loft-definitions';
import { z } from 'zod';

const functionCallSchema = z.object({
  arguments: z.string(),
  name: z.string()
});

const messageToolCallSchema = z.object({
  id: z.string(),
  function: functionCallSchema,
  type: z.literal('function')
});

const functionMessageParamSchema = z.object({
  content: z.string().nullable(),
  name: z.string(),
  role: z.literal('function')
});

// Add schemas for additional parameters
const chatCompletionAudioParamSchema = z
  .object({
    format: z.enum(['wav', 'mp3', 'flac', 'opus', 'pcm16']),
    voice: z
      .enum(['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse'])
      .or(z.string())
  })
  .nullable()
  .optional();

const chatCompletionToolSchema = z.object({
  function: z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.any()).optional()
  }),
  type: z.literal('function')
});

const chatCompletionNamedToolChoiceSchema = z.object({
  function: z.object({
    name: z.string()
  }),
  type: z.literal('function')
});

const chatCompletionToolChoiceSchema = z.enum(['none', 'auto', 'required']).or(chatCompletionNamedToolChoiceSchema);

const chatCompletionPredictionContentSchema = z.object({
  content: z.union([
    z.string(),
    z.array(
      z.object({
        text: z.string(),
        type: z.literal('text')
      })
    )
  ]),
  type: z.literal('content')
});

const responseFormatTextSchema = z.object({
  type: z.literal('text')
});

const responseFormatJSONObjectSchema = z.object({
  type: z.literal('json_object')
});

const responseFormatJSONSchemaSchema = z.object({
  type: z.literal('json_schema'),
  json_schema: z.record(z.any())
});

const responseFormatSchema = z.union([
  responseFormatTextSchema,
  responseFormatJSONObjectSchema,
  responseFormatJSONSchemaSchema
]);

const webSearchOptionsUserLocationSchema = z
  .object({
    approximate: z.object({
      city: z.string().optional(),
      country: z.string().optional(),
      region: z.string().optional(),
      timezone: z.string().optional()
    }),
    type: z.literal('approximate')
  })
  .nullable()
  .optional();

const webSearchOptionsSchema = z
  .object({
    search_context_size: z.enum(['low', 'medium', 'high']).optional(),
    user_location: webSearchOptionsUserLocationSchema
  })
  .optional();

const streamOptionsSchema = z
  .object({
    include_usage: z.boolean().optional()
  })
  .optional();

export class OpenAiValidatingSchemas {
  static responseValidationSchema() {
    const completionUsageSchema = z.object({
      completion_tokens: z.number(),
      prompt_tokens: z.number(),
      total_tokens: z.number()
    });

    const messageSchema = z.object({
      content: z.string().nullable(),
      role: z.literal('assistant'),
      function_call: functionCallSchema.optional(),
      tool_calls: messageToolCallSchema.optional()
    });

    const choiceSchema = z.object({
      finish_reason: z.union([
        z.literal('stop'),
        z.literal('length'),
        z.literal('tool_calls'),
        z.literal('content_filter'),
        z.literal('function_call')
      ]),
      index: z.number(),
      message: messageSchema
    });

    return z.object({
      id: z.string(),
      choices: z.array(choiceSchema),
      created: z.number(),
      model: z.string(),
      object: z.literal('chat.completion'),
      system_fingerprint: z.string().nullable().optional(),
      usage: completionUsageSchema.optional()
    });
  }

  static modelPresetValidationSchema() {
    return z.object({
      model: z.string(),

      functions: z.array(functionMessageParamSchema).optional(),
      function_call: functionCallSchema.optional(),
      temperature: z.number().optional(),
      top_p: z.number().optional(),
      n: z.number().optional(),
      stream: z.boolean().optional(),
      stop: z.array(z.string()).length(4).optional().or(z.string()).optional(),
      max_tokens: z.number().optional(),
      presence_penalty: z.number().optional(),
      frequency_penalty: z.number().optional(),
      logit_bias: z
        .record(z.number())
        .refine(
          (data) => {
            return Object.keys(data).every((k) => !isNaN(+k));
          },
          {
            message: 'All keys must be numbers'
          }
        )
        .optional(),

      audio: chatCompletionAudioParamSchema,
      logprobs: z.boolean().optional(),
      max_completion_tokens: z.number().optional(),
      metadata: z.record(z.string()).optional(),
      modalities: z.array(z.enum(['text', 'audio'])).optional(),
      parallel_tool_calls: z.boolean().optional(),
      prediction: chatCompletionPredictionContentSchema.optional(),
      reasoning_effort: z.enum(['minimal', 'low', 'medium', 'high']).nullable().optional(),
      verbosity: z.enum(['low', 'medium', 'high']).nullable().optional(),
      response_format: responseFormatSchema.optional(),
      seed: z.number().nullable().optional(),
      service_tier: z.enum(['auto', 'default']).nullable().optional(),
      store: z.boolean().nullable().optional(),
      stream_options: streamOptionsSchema,
      tool_choice: chatCompletionToolChoiceSchema.optional(),
      tools: z.array(chatCompletionToolSchema).optional(),
      top_logprobs: z.number().optional(),
      user: z.string().optional(),
      web_search_options: webSearchOptionsSchema
    });
  }

  static generateRequestValidationSchema() {
    const systemMessageParamSchema = z.object({
      content: z.string(),
      role: z.literal('system'),
      name: z.string().optional()
    });

    const userMessageParamSchema = z.object({
      content: z.string(),
      role: z.literal('user'),
      name: z.string().optional()
    });

    const assistantMessageParamSchema = z.object({
      role: z.literal('assistant'),
      content: z.string().optional().nullable(),
      function_call: functionCallSchema.optional(),
      name: z.string().optional(),
      tool_calls: z.array(messageToolCallSchema).optional()
    });

    const toolMessageParamSchema = z.object({
      content: z.string(),
      role: z.literal('tool'),
      tool_call_id: z.string()
    });

    const messageParamSchema = z.union([
      systemMessageParamSchema,
      userMessageParamSchema,
      assistantMessageParamSchema,
      toolMessageParamSchema,
      functionMessageParamSchema
    ]);

    return this.modelPresetValidationSchema().extend({
      messages: z.array(messageParamSchema)
    });
  }

  static completionModelPresetValidationSchema() {
    return z.object({
      model: z.string(),
      best_of: z.number().optional().nullable(),
      echo: z.boolean().optional().nullable(),
      frequency_penalty: z.number().optional().nullable(),
      logit_bias: z.record(z.number()).optional().nullable(),
      logprobs: z.number().optional().nullable(),
      max_tokens: z.number().optional().nullable(),
      n: z.number().optional().nullable(),
      presence_penalty: z.number().optional().nullable(),
      seed: z.number().optional().nullable(),
      stop: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .nullable(),
      stream: z.boolean().optional().nullable(),
      suffix: z.string().optional().nullable(),
      temperature: z.number().optional().nullable(),
      top_p: z.number().optional().nullable(),
      user: z.string().optional()
    });
  }

  static completionRequestValidationSchema() {
    return this.completionModelPresetValidationSchema().extend({
      prompt: z.union([z.string(), z.array(z.string()), z.array(z.number()), z.array(z.array(z.number()))])
    });
  }

  static completionResponseValidationSchema() {
    const logprobsSchema = z.object({
      text_offset: z.array(z.number()).optional(),
      token_logprobs: z.array(z.number()).optional(),
      tokens: z.array(z.string()).optional(),
      top_logprobs: z.array(z.record(z.number())).optional()
    });

    const completionChoiceSchema = z.object({
      finish_reason: z.union([z.literal('stop'), z.literal('length'), z.literal('content_filter')]),
      index: z.number(),
      logprobs: logprobsSchema.nullable(),
      text: z.string()
    });

    const completionUsageSchema = z.object({
      completion_tokens: z.number(),
      prompt_tokens: z.number(),
      total_tokens: z.number()
    });

    return z.object({
      id: z.string(),
      choices: z.array(completionChoiceSchema),
      created: z.number(),
      model: z.string(),
      object: z.literal('text_completion'),
      system_fingerprint: z.string().optional(),
      usage: completionUsageSchema.optional()
    });
  }
}

export const OpenAiRequestBodySchema = z.object({
  sessionId: z.string(),
  llmName: z.string(),
  requestType: z.nativeEnum(Strategy.LLM.LLMRequestType),
  llmBody: OpenAiValidatingSchemas.generateRequestValidationSchema(),
  callContext: z.record(z.any()).optional(),
  priority: z.number().optional()
});

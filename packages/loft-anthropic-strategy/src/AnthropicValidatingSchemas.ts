// adjust according to your actual SDK import
import { z } from 'zod';

/* =====================================================
   Zod Schemas (Fully Compatible with Anthropic.MessageCreateParams omit messages) 
   ===================================================== */

// -----------------------------
// Metadata
// -----------------------------
const MetadataSchema = z
  .object({
    user_id: z.string().nullable().optional()
  })
  .strict();

// -----------------------------
// Model (a string)
// -----------------------------
const ModelSchema = z.string();

// -----------------------------
// Cache Control Schema
// -----------------------------
const cacheControlSchema = z
  .object({
    type: z.literal('ephemeral'),
    ttl: z.enum(['5m', '1h']).optional()
  })
  .nullable()
  .optional();

// Base schema for common fields in all citation types
const baseCitationSchema = z.object({
  cited_text: z.string(),
  document_index: z.number(),
  document_title: z.string().nullable()
});

// Schemas for different citation types
const citationCharLocationSchema = baseCitationSchema.extend({
  type: z.literal('char_location'),
  start_char_index: z.number(),
  end_char_index: z.number()
});

const citationPageLocationSchema = baseCitationSchema.extend({
  type: z.literal('page_location'),
  start_page_number: z.number(),
  end_page_number: z.number()
});

const citationContentBlockLocationSchema = baseCitationSchema.extend({
  type: z.literal('content_block_location'),
  start_block_index: z.number(),
  end_block_index: z.number()
});

// Union schema for TextCitation
const textCitationSchema = z.discriminatedUnion('type', [
  citationCharLocationSchema,
  citationPageLocationSchema,
  citationContentBlockLocationSchema
]);

// Schema for citations array
const citationsArraySchema = z.array(textCitationSchema).nullable().optional();

// Text block
const TextBlockParamSchema = z
  .object({
    type: z.literal('text'),
    text: z.string(),
    cache_control: cacheControlSchema,
    citations: citationsArraySchema
  })
  .strict();

// -----------------------------
// Extended Thinking Configuration
// -----------------------------
// Which types a model accepts depends on the model: Claude Sonnet 5.5 turns thinking off only with between_tools,
// Claude Haiku 5.5 with disabled
const ThinkingDisplaySchema = z.enum(['summarized', 'omitted']).nullable().optional();
const ThinkingConfigEnabledSchema = z
  .object({
    type: z.literal('enabled'),
    budget_tokens: z.number().min(1024, { message: 'Minimum budget_tokens is 1024' }),
    display: ThinkingDisplaySchema
  })
  .strict();
const ThinkingConfigDisabledSchema = z
  .object({
    type: z.literal('disabled')
  })
  .strict();
const ThinkingConfigBetweenToolsSchema = z
  .object({
    type: z.literal('between_tools')
  })
  .strict();
const ThinkingConfigAdaptiveSchema = z
  .object({
    type: z.literal('adaptive'),
    display: ThinkingDisplaySchema
  })
  .strict();
const ThinkingConfigParamSchema = z.discriminatedUnion('type', [
  ThinkingConfigEnabledSchema,
  ThinkingConfigDisabledSchema,
  ThinkingConfigBetweenToolsSchema,
  ThinkingConfigAdaptiveSchema
]);

// -----------------------------
// Tool Choice Configuration
// -----------------------------
const ToolChoiceAutoSchema = z
  .object({
    type: z.literal('auto'),
    disable_parallel_tool_use: z.boolean().optional()
  })
  .strict();
const ToolChoiceAnySchema = z
  .object({
    type: z.literal('any'),
    disable_parallel_tool_use: z.boolean().optional()
  })
  .strict();
const ToolChoiceToolSchema = z
  .object({
    type: z.literal('tool'),
    name: z.string(),
    disable_parallel_tool_use: z.boolean().optional()
  })
  .strict();
const ToolChoiceNoneSchema = z
  .object({
    type: z.literal('none')
  })
  .strict();
const ToolChoiceSchema = z.union([
  ToolChoiceAutoSchema,
  ToolChoiceAnySchema,
  ToolChoiceToolSchema,
  ToolChoiceNoneSchema
]);

// -----------------------------
// Output Configuration
// -----------------------------
const OutputConfigSchema = z
  .object({
    effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).nullable().optional(),
    format: z
      .object({
        type: z.literal('json_schema'),
        schema: z.record(z.string(), z.unknown())
      })
      .strict()
      .nullable()
      .optional()
  })
  .strict();

// -----------------------------
// Tools Definitions
// -----------------------------
// Schema for Tool.InputSchema
const toolInputSchemaSchema = z
  .object({
    type: z.literal('object'),
    properties: z.unknown().nullable().optional()
  })
  .catchall(z.unknown());

// Schema for base Tool
const baseToolSchema = z.object({
  name: z.string(),
  cache_control: cacheControlSchema,
  description: z.string().optional()
});

// Schema for Tool
const toolSchema = baseToolSchema.extend({
  input_schema: toolInputSchemaSchema
});

// Schema for ToolBash20250124
const toolBash20250124Schema = z.object({
  name: z.literal('bash'),
  type: z.literal('bash_20250124'),
  cache_control: cacheControlSchema
});

// Schema for ToolTextEditor20250124
const toolTextEditor20250124Schema = z.object({
  name: z.literal('str_replace_editor'),
  type: z.literal('text_editor_20250124'),
  cache_control: cacheControlSchema
});

// Union schema for tools
const toolUnionSchema = z
  .discriminatedUnion('name', [toolBash20250124Schema, toolTextEditor20250124Schema])
  .or(toolSchema);

// Schema for tools array
const toolsSchema = z.array(toolUnionSchema).optional();

// -----------------------------
// Base Request Schema
// -----------------------------
// Left out: container and diagnostics, which belong to a single request, and workspace_id and user_profile_id, which
// the SDK sends as headers (SDK 0.39 would send them in the body)
const MessageCreateParamsBaseSchema = z
  .object({
    max_tokens: z.number(),
    cache_control: cacheControlSchema,
    inference_geo: z.string().nullable().optional(),
    // messages: z.any(), // don't required in model preset
    model: ModelSchema,
    metadata: MetadataSchema.optional(),
    output_config: OutputConfigSchema.optional(),
    service_tier: z.enum(['auto', 'standard_only']).optional(),
    stop_sequences: z.array(z.string()).optional(),
    system: z.union([z.string(), z.array(TextBlockParamSchema)]).optional(),
    temperature: z.number().optional(),
    thinking: ThinkingConfigParamSchema.optional(),
    tool_choice: ToolChoiceSchema.optional(),
    tools: toolsSchema,
    top_k: z.number().optional(),
    top_p: z.number().optional()
  })
  .strict();

// -----------------------------
// Complete Request Schema (Discriminated by `stream`)
// -----------------------------
// Anthropic.MessageCreateParams is defined as a union of two variants:
// - Non-streaming: stream is absent or false.
// - Streaming: stream === true.
const MessageCreateParamsNonStreamingSchema = MessageCreateParamsBaseSchema.extend({
  stream: z.literal(false).optional()
});
const MessageCreateParamsStreamingSchema = MessageCreateParamsBaseSchema.extend({
  stream: z.literal(true)
});
export const MessageCreateParamsSchema = z.union([
  MessageCreateParamsNonStreamingSchema,
  MessageCreateParamsStreamingSchema
]);

/* =====================================================
   Schema Validation test Function
   ===================================================== */

// function transformToAnthropicRequest<T_LLM_Req>(
//   generalRequest: T_LLM_Req
//   // omit only to pass this test
// ): Omit<Anthropic.MessageCreateParams, 'messages'> {
//   const request = generalRequest as any;
//   const stream = request.stream !== undefined ? request.stream : false;

//   const anthropicRequest = {
//     model: request.model,
//     max_tokens: request.max_tokens || 1024,
//     messages: request.messages || [],
//     system: request.system,
//     temperature: request.temperature,
//     top_p: request.top_p,
//     top_k: request.top_k,
//     stop_sequences: request.stop_sequences || request.stop,
//     tools: request.tools,
//     metadata: request.metadata,
//     stream: stream,
//     tool_choice: request.tool_choice,
//     thinking: request.thinking
//   };

//   return MessageCreateParamsSchema.parse(anthropicRequest);
// }

// /* =====================================================
//    Example Usage
//    ===================================================== */

// const exampleNonStreaming = {
//   model: 'claude-3-7-sonnet-latest',
//   max_tokens: 100,
//   messages: [{ role: 'user', content: 'Hello, Claude' }]
// };

// const exampleStreaming = {
//   model: 'claude-3-7-sonnet-latest',
//   max_tokens: 150,
//   messages: [
//     {
//       role: 'user',
//       content: [{ type: 'text', text: 'Tell me a story.', cache_control: {} }]
//     }
//   ],
//   stream: true
// };

// try {
//   const validatedNonStreaming = transformToAnthropicRequest(exampleNonStreaming);
//   console.log('Non-streaming request is valid:', validatedNonStreaming);

//   const validatedStreaming = transformToAnthropicRequest(exampleStreaming);
//   console.log('Streaming request is valid:', validatedStreaming);
// } catch (error) {
//   console.error('Validation failed:', error);
// }

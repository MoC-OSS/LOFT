import { z } from 'zod';

// Import MCP schemas from separate file
import { ContentBlockSchema } from './MCP_SDK_Types';

/**
 * Schema Hierarchy:
 *
 * FullContentPartSchema
 * ├── type: "text"
 * │   └── text: string
 * ├── type: "image"
 * │   ├── format: "base64" | "url"
 * │   ├── data: string
 * │   └── mimeType?: string
 * ├── type: "audio"
 * │   ├── data: string
 * │   └── mimeType: string
 * ├── type: "resource"
 * │   └── resource
 * │       ├── uri: string
 * │       ├── mimeType?: string
 * │       ├── text: string
 * │       └── (OR)
 * │           blob: string
 * ├── ToolCallContentSchema (extends RequestSchema)
 * │   ├── method: "tools/call"
 * │   ├── callId?: string
 * │   ├── _meta?: { [key: string]: unknown }
 * │   └── params
 * │       ├── _meta?
 * │       │   └── progressToken?: string | number
 * │       ├── name: string
 * │       └── arguments?: { [key: string]: unknown }
 * ├── ToolResultContentSchema (extends ResultSchema)
 *     ├── type: "tool/result"
 *     ├── callId?: string
 *     ├── content: [
 *     │   ├── { type: "text", text: string }
 *     │   ├── { type: "image", data: string, mimeType: string }
 *     │   ├── { type: "audio", data: string, mimeType: string }
 *     │   └── { type: "resource", resource: {...} }
 *     │ ]
 *     └── isError?: boolean
 */

// === TEXT ===
export const TextContentSchema = z
  .object({
    type: z.literal('text'),
    text: z.string(),
    _meta: z.optional(z.object({}).passthrough())
  })
  .passthrough();

// === IMAGE ===
export enum ImageFormat {
  BASE64 = 'base64',
  URL = 'url'
}

// Optional OpenAI parameter for controlling image detail level
export const ImageDetailSchema = z.enum(['auto', 'low', 'high']);

// Unified Image Schema by MCP but extended with format, because MCP supports only BASE64 format
export const ImageContentBase64Schema = z
  .object({
    type: z.literal('image'),
    format: z.literal(ImageFormat.BASE64),
    data: z.string().base64(),
    mimeType: z.string().optional(), // optional for cases like Claude/OpenAI
    detail: ImageDetailSchema.optional(), // OpenAI parameter for controlling image detail level
    _meta: z.optional(z.object({}).passthrough())
  })
  .passthrough();

export const ImageContentUrlSchema = z
  .object({
    type: z.literal('image'),
    format: z.literal(ImageFormat.URL),
    url: z.string(),
    detail: ImageDetailSchema.optional(),
    _meta: z.optional(z.object({}).passthrough())
  })
  .passthrough();

// Define a unified ImageContentSchema to fix linter error
export const ImageContentSchema = z.union([ImageContentBase64Schema, ImageContentUrlSchema]);

// === AUDIO ===
export const AudioContentSchema = z
  .object({
    type: z.literal('audio'),
    data: z.string().base64(), // base64-encoded audio
    mimeType: z.string(), // e.g., "audio/mpeg"
    _meta: z.optional(z.object({}).passthrough())
  })
  .passthrough();

// === EMBEDDED RESOURCES ===
export const ResourceContentsSchema = z
  .object({
    uri: z.string(),
    mimeType: z.string().optional(),
    _meta: z.optional(z.object({}).passthrough())
  })
  .passthrough();

export const TextResourceContentsSchema = ResourceContentsSchema.extend({
  text: z.string()
});

export const BlobResourceContentsSchema = ResourceContentsSchema.extend({
  blob: z.string() // base64-encoded
});

export const EmbeddedResourceSchema = z
  .object({
    type: z.literal('resource'),
    resource: z.union([TextResourceContentsSchema, BlobResourceContentsSchema]),
    _meta: z.optional(z.object({}).passthrough())
  })
  .passthrough();

/* Base Metadata */
/**
 * Base metadata interface for common properties across resources, tools, prompts, and implementations.
 */
export const BaseMetadataSchema = z
  .object({
    /** Intended for programmatic or logical use, but used as a display name in past specs or fallback */
    name: z.string(),
    /**
     * Intended for UI and end-user contexts — optimized to be human-readable and easily understood,
     * even by those unfamiliar with domain-specific terminology.
     *
     * If not provided, the name should be used for display (except for Tool,
     * where `annotations.title` should be given precedence over using `name`,
     * if present).
     */
    title: z.optional(z.string())
  })
  .passthrough();

/**
 * A known resource that the server is capable of reading.
 */
export const ResourceSchema = BaseMetadataSchema.extend({
  /**
   * The URI of this resource.
   */
  uri: z.string(),

  /**
   * A description of what this resource represents.
   *
   * This can be used by clients to improve the LLM's understanding of available resources. It can be thought of like a "hint" to the model.
   */
  description: z.optional(z.string()),

  /**
   * The MIME type of this resource, if known.
   */
  mimeType: z.optional(z.string()),

  /**
   * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
   * for notes on _meta usage.
   */
  _meta: z.optional(z.object({}).passthrough())
});

/**
 * A resource that the server is capable of reading, included in a prompt or tool call result.
 *
 * Note: resource links returned by tools are not guaranteed to appear in the results of `resources/list` requests.
 */
export const ResourceLinkSchema = ResourceSchema.extend({
  type: z.literal('resource_link')
});

// === Designed by MCP CONTENT PARTS  ===
export const BasicContentPartSchema = z.union([
  TextContentSchema,
  ImageContentSchema,
  AudioContentSchema,
  ResourceLinkSchema,
  EmbeddedResourceSchema
]);

// --------------------------------------------------------------------------

/**
 * A progress token, used to associate progress notifications with the original request.
 */
export const ProgressTokenSchema = z.union([z.string(), z.number().int()]);

const BaseRequestParamsSchema = z
  .object({
    _meta: z.optional(
      z
        .object({
          /**
           * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
           */
          progressToken: z.optional(ProgressTokenSchema)
        })
        .passthrough()
    )
  })
  .passthrough();

export const RequestSchema = z.object({
  method: z.string(),
  params: z.optional(BaseRequestParamsSchema)
});

// callId at external side because it's not MCP part, but it's required for tool result
export const ToolCallContentSchema = RequestSchema.extend({
  type: z.literal('tool_call'),
  method: z.literal('tools/call'),
  callId: z.string().optional(), // optional because it's not MCP part, but it's required for tool result
  // Provider data the strategy needs back in the next request; params go to the MCP server, so it is kept outside them
  _meta: z.optional(z.object({}).passthrough()),
  params: BaseRequestParamsSchema.extend({
    name: z.string(),
    arguments: z.optional(z.record(z.unknown()))
  })
});

// ----------------------------------------------------------------------------

export const ResultSchema = z
  .object({
    /**
     * This result property is reserved by the protocol to allow clients and servers to attach additional metadata to their responses.
     */
    _meta: z.optional(z.object({}).passthrough())
  })
  .passthrough();

export const ToolResultContentSchema = ResultSchema.extend({
  type: z.literal('tool_result'), // non MCP property, just for marking tool result
  callId: z.string().optional(), // optional because it's not MCP part, but it's required for tool result
  content: z.array(ContentBlockSchema),
  isError: z.boolean().default(false).optional()
});

// === Designed by MCP CONTENT PARTS & Extended with TOOLS PARTS ===
export const FullContentPartSchema = z.union([BasicContentPartSchema, ToolCallContentSchema, ToolResultContentSchema]);

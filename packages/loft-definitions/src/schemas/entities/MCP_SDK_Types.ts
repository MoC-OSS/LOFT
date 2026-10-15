// "version": "1.15.0" https://github.com/modelcontextprotocol/typescript-sdk/blob/25048b9eaf8410a97833807dba7039f045ba7414/src/types.ts
// Copyright (c) 2024 Anthropic, PBC. Used under the MIT License; the full notice is in this package's NOTICE file.
import { z } from 'zod';

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

/* Resources */
/**
 * The contents of a specific resource or sub-resource.
 */
export const ResourceContentsSchema = z
  .object({
    /**
     * The URI of this resource.
     */
    uri: z.string(),
    /**
     * The MIME type of this resource, if known.
     */
    mimeType: z.optional(z.string()),
    /**
     * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
     * for notes on _meta usage.
     */
    _meta: z.optional(z.object({}).passthrough())
  })
  .passthrough();

export const TextResourceContentsSchema = ResourceContentsSchema.extend({
  /**
   * The text of the item. This must only be set if the item can actually be represented as text (not binary data).
   */
  text: z.string()
});

export const BlobResourceContentsSchema = ResourceContentsSchema.extend({
  /**
   * A base64-encoded string representing the binary data of the item.
   */
  blob: z.string().base64()
});

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
 * Text provided to or from an LLM.
 */
export const TextContentSchema = z
  .object({
    type: z.literal('text'),
    /**
     * The text content of the message.
     */
    text: z.string(),

    /**
     * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
     * for notes on _meta usage.
     */
    _meta: z.optional(z.object({}).passthrough())
  })
  .passthrough();

/**
 * An image provided to or from an LLM.
 */
export const ImageContentSchema = z
  .object({
    type: z.literal('image'),
    /**
     * The base64-encoded image data.
     */
    data: z.string().base64(),
    /**
     * The MIME type of the image. Different providers may support different image types.
     */
    mimeType: z.string(),

    /**
     * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
     * for notes on _meta usage.
     */
    _meta: z.optional(z.object({}).passthrough())
  })
  .passthrough();

/**
 * An Audio provided to or from an LLM.
 */
export const AudioContentSchema = z
  .object({
    type: z.literal('audio'),
    /**
     * The base64-encoded audio data.
     */
    data: z.string().base64(),
    /**
     * The MIME type of the audio. Different providers may support different audio types.
     */
    mimeType: z.string(),

    /**
     * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
     * for notes on _meta usage.
     */
    _meta: z.optional(z.object({}).passthrough())
  })
  .passthrough();

/**
 * The contents of a resource, embedded into a prompt or tool call result.
 */
export const EmbeddedResourceSchema = z
  .object({
    type: z.literal('resource'),
    resource: z.union([TextResourceContentsSchema, BlobResourceContentsSchema]),
    /**
     * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
     * for notes on _meta usage.
     */
    _meta: z.optional(z.object({}).passthrough())
  })
  .passthrough();

/**
 * A resource that the server is capable of reading, included in a prompt or tool call result.
 *
 * Note: resource links returned by tools are not guaranteed to appear in the results of `resources/list` requests.
 */
export const ResourceLinkSchema = ResourceSchema.extend({
  type: z.literal('resource_link')
});

/**
 * A content block that can be used in prompts and tool results.
 */
export const ContentBlockSchema = z.union([
  TextContentSchema,
  ImageContentSchema,
  AudioContentSchema,
  ResourceLinkSchema,
  EmbeddedResourceSchema
]);

/* Resources */

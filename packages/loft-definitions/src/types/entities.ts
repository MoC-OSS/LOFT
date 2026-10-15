import { z } from 'zod';

import { Schema } from '..';

export type Session = z.infer<typeof Schema.Entity.Session>;
export type CreateSession = z.infer<typeof Schema.Entity.CreateSession>;
export type Message = z.infer<typeof Schema.Entity.Message>;
export type CreateMessage = z.infer<typeof Schema.Entity.CreateMessage>;
export type ChunkedMessage = z.infer<typeof Schema.Entity.ChunkedMessage>;
export type ChatHistory = z.infer<typeof Schema.Entity.ChatHistory>;

export type ContextRecord = z.infer<typeof Schema.Entity.ContextRecord>;

export type MessagePatch = z.infer<typeof Schema.Entity.MessagePatch>;
export type CreateMessagePatch = z.infer<typeof Schema.Entity.CreateMessagePatch>;
export const MessagePatchAction = Schema.Entity.MessagePatchAction;

// Content types
export type TextContent = z.infer<typeof Schema.Entity.TextContentSchema>;
export type ImageContentBase64 = z.infer<typeof Schema.Entity.ImageContentBase64Schema>;
export type ImageContentUrl = z.infer<typeof Schema.Entity.ImageContentUrlSchema>;
export type ImageContent = z.infer<typeof Schema.Entity.ImageContentSchema>;
export type AudioContent = z.infer<typeof Schema.Entity.AudioContentSchema>;
export type ResourceContents = z.infer<typeof Schema.Entity.ResourceContentsSchema>;
export type TextResourceContents = z.infer<typeof Schema.Entity.TextResourceContentsSchema>;
export type BlobResourceContents = z.infer<typeof Schema.Entity.BlobResourceContentsSchema>;
export type EmbeddedResource = z.infer<typeof Schema.Entity.EmbeddedResourceSchema>;
export type BasicContentPart = z.infer<typeof Schema.Entity.BasicContentPartSchema>;
export type ToolCallContent = z.infer<typeof Schema.Entity.ToolCallContentSchema>;
export type ToolResultContent = z.infer<typeof Schema.Entity.ToolResultContentSchema>;
export type FullContentPart = z.infer<typeof Schema.Entity.FullContentPartSchema>;

// MCP specific types
// export type MCPTextContent = z.infer<typeof Schema.Entity.MCPTextContentSchema>;
// export type MCPImageContent = z.infer<typeof Schema.Entity.mcpImageContentSchema>;
// export type MCPAudioContent = z.infer<typeof Schema.Entity.MCPAudioContentSchema>;
// export type MCPResourceLink = z.infer<typeof Schema.Entity.MCPResourceLinkSchema>;
// export type MCPEmbeddedResource = z.infer<typeof Schema.Entity.MCPEmbeddedResourceSchema>;
// export type MCPContent = z.infer<typeof Schema.Entity.MCPContent>;
// export type MCPContentBlock = z.infer<typeof Schema.Entity.MCPContentBlockSchema>;

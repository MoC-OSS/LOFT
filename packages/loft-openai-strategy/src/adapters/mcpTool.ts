import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import { ChatCompletionTool } from 'openai/resources/chat/completions';

export function mcpToOpenAITool(mcpTools: ListToolsResult['tools']): Array<ChatCompletionTool> {
  return mcpTools.map((tool) => {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: tool.inputSchema.properties || {},
          required: tool.inputSchema.required || []
        }
      }
    };
  });
}

// export function openAiToMcpTool(
//   openAiTools: Array<ChatCompletionMessageToolCall>
// ): Array<ListToolsResult['tools'][number]> {
//   return openAiTools.map((tool) => {
//     return {
//       name: tool.function.name,
//       inputSchema: {
//         type: 'object',
//         properties: JSON.parse(tool.function.arguments)
//       }
//     };
//   });
// }

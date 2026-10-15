import type Anthropic from '@anthropic-ai/sdk';
import { Type } from '@moc-global/loft-definitions';
import { describe, expect, it } from 'vitest';

import { extractToolCallsFromContent } from '../../adapters/toolRequest';

describe('extractToolCallsFromContent', () => {
  it('turns a tool call from the history into a tool_use block of the request', () => {
    const parts: Type.Entity.FullContentPart[] = [
      { type: 'text', text: 'Let me check.' },
      {
        type: 'tool_call',
        method: 'tools/call',
        callId: 'toolu_1',
        params: { name: 'get_weather', arguments: { city: 'Kyiv' } }
      }
    ];

    const blocks: Anthropic.ToolUseBlockParam[] = extractToolCallsFromContent(parts);

    // caller is optional in a request block; the API fills it in for its own responses
    expect(blocks).toEqual([{ type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Kyiv' } }]);
  });
});

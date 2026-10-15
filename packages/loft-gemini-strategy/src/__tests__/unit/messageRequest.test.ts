import { toolCallWithError, toolChainFixtures } from '@moc-global/loft-test-suite';
import { describe, expect, it } from 'vitest';

import { organizeMessagesForGemini } from '../../gemini/adapters/messageRequest';

describe('organizeMessagesForGemini with tool calls', () => {
  it.each(toolChainFixtures)('answers every function call in one user content: $name', (fixture) => {
    const contents = organizeMessagesForGemini(fixture.messages);
    const toolNames = fixture.callIds.map((callId) => callId.split(':::')[0]);

    expect(contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    expect(contents[1].parts?.filter((p) => p.functionCall).map((p) => p.functionCall?.name)).toEqual(toolNames);
    expect(contents[2].parts?.map((p) => p.functionResponse?.name)).toEqual(toolNames);
  });

  it('puts a failed tool text under the error key', () => {
    const [ok, failed] = organizeMessagesForGemini(toolCallWithError.messages)[2].parts ?? [];

    expect(ok.functionResponse?.response).toEqual({ result: '18°C, cloudy' });
    expect(failed.functionResponse?.response).toEqual({ error: toolCallWithError.errorText });
  });
});

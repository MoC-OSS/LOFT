import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runDemo } from './demo';

test('the demo keeps personal data from the model, history and traces, and blocks the injection attempt', async () => {
  const result = await runDemo();
  const everything = JSON.stringify(result);

  assert.ok(!everything.includes('jane.doe@example.com'), 'the e-mail address leaked');
  assert.ok(!everything.includes('4111 1111 1111 1111'), 'the card number leaked');
  // The traces keep the attack text, for an audit; the model and the history do not
  const conversation = JSON.stringify([result.modelSaw, result.stored, result.blockedReply]);
  assert.ok(!conversation.includes('Ignore all previous instructions'), 'the injection text was kept');
  assert.equal(result.modelSaw.length, 2, 'the model answers the first turn only, in two calls');
  assert.match(result.modelSaw[0][0], /\[REDACTED:EMAIL\]/);
  assert.match(result.modelSaw[1].join('\n'), /\[REDACTED:CARD\]/);
  assert.equal(result.blockedReply, 'Sorry, I cannot help with that message.');
  assert.ok(result.stored.some((line) => line.startsWith('user (llmIgnore): [message removed')));
  assert.ok(result.traces.length > 0);
});

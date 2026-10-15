import 'reflect-metadata';

import { Type } from '@moc-global/loft-definitions';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import crypto from 'crypto';

import { Database, initializeDatabase } from './database';
import { initializeLoft } from './loft';

const MODEL_NAME = 'gpt-4o-mini';
const MANIFEST_NAME = 'my-assistant';
const MAX_MESSAGE_LENGTH = 10000;

// Module-level LOFT instance — cached across warm Lambda invocations.
// Uses a promise-based singleton to prevent duplicate initialization on concurrent cold starts.
let initPromise: Promise<Awaited<ReturnType<typeof initializeLoft>> & { db: Database }> | null = null;

function ensureInitialized() {
  if (!initPromise) {
    initPromise = doInitialize().catch((err) => {
      // Reset so the next invocation retries initialization
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

async function doInitialize() {
  console.log('Cold start: initializing PGLite + LOFT...');
  const db = await initializeDatabase();
  const { loft, loftConstructor } = await initializeLoft(db.pool);
  console.log('LOFT initialized with OpenAI gpt-4o-mini strategy');
  return { loft, loftConstructor, db };
}

function jsonResponse(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  let instance;
  try {
    instance = await ensureInitialized();
  } catch (error) {
    console.error('Initialization failed:', error);
    return jsonResponse(500, { error: 'Internal server error' });
  }

  // Parse request body
  let message: string;
  try {
    if (!event.body) {
      return jsonResponse(400, { error: 'message is required' });
    }
    const body = JSON.parse(event.body) as { message?: string };
    message = body.message ?? '';
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  if (!message.trim()) {
    return jsonResponse(400, { error: 'message is required' });
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return jsonResponse(400, { error: `message must not exceed ${MAX_MESSAGE_LENGTH} characters` });
  }

  const { loft } = instance;
  let sessionId: string | undefined;

  try {
    // Create an ephemeral session for this single-turn request
    const session = await loft.chat.createSession({
      currentLlmName: MODEL_NAME,
      currentManifestName: MANIFEST_NAME,
      ctx: {},
      externalKey: { requestId: crypto.randomUUID() }
    });
    sessionId = session.id;

    // Send the user message and get LLM response
    const result = await loft.chat.generate({
      sessionId,
      directMessages: [
        {
          sessionId,
          content: [{ type: 'text', text: message }],
          role: Type.LLM.UnifiedMessageRole.user,
          author: 'user',
          llmName: MODEL_NAME,
          manifestName: MANIFEST_NAME,
          ctx: {},
          llmIgnore: false
        }
      ]
    });

    // Extract text from the LLM response
    const topChoice = result.messages.llmResponse.topChoice;
    const responseText = topChoice.content
      .filter((part): part is Type.Entity.TextContent => part.type === 'text')
      .map((part) => part.text)
      .join('');

    // Clean up the ephemeral session
    await loft.chat.deleteSession(sessionId);

    return jsonResponse(200, { response: responseText });
  } catch (error) {
    // Clean up orphaned session on failure
    if (sessionId) {
      await loft.chat.deleteSession(sessionId).catch(() => {});
    }
    console.error('Handler error:', error);
    return jsonResponse(500, { error: 'Internal server error' });
  }
}

// Local testing: invoke handler with a mock API Gateway event
if (require.main === module) {
  const mockEvent = {
    body: JSON.stringify({ message: 'What is 2+2?' })
  } as APIGatewayProxyEvent;

  console.log('Running local test with mock API Gateway event...');
  console.log('Request body:', mockEvent.body);
  console.log('');

  handler(mockEvent)
    .then((result) => {
      console.log('Lambda response:');
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('Unexpected error:', err);
      process.exit(1);
    });
}

import { setTimeout as delay } from 'node:timers/promises';

import { Chat } from '@moc-global/loft-definitions';

/** How long the fake order lookup takes, so the `progress` data events are visible in the stream */
const LOOKUP_DELAY_MS = 300;

function textResult(value: unknown): Chat.AdditionalToolResult {
  return { content: [{ type: Chat.AdditionalToolContentType.TEXT, text: JSON.stringify(value) }] };
}

/**
 * Finds an order by its id. The answer is fixed, as this example has no order database. While it works, it sends two
 * `progress` data events to a streaming client; they are shown to the user and never saved to the chat history.
 */
export const lookupOrder: Chat.AdditionalTool = {
  definition: {
    name: 'lookup_order',
    description: 'Looks up an order by its id and returns its status, items and the city it ships to.',
    inputSchema: {
      type: Chat.AdditionalToolSchemaType.OBJECT,
      properties: { orderId: { type: 'string', description: 'The order id, for example A-1001' } },
      required: ['orderId']
    }
  },
  async handler(args, context) {
    const orderId = typeof args.orderId === 'string' ? args.orderId : 'unknown';
    context?.emit('progress', { stage: 'loading' });
    // Stops waiting when the generation is cancelled, for example when the client disconnects
    await delay(LOOKUP_DELAY_MS, undefined, { signal: context?.signal });
    context?.emit('progress', { stage: 'done' });
    return textResult({
      orderId,
      status: 'shipped',
      items: [{ name: 'Ceramic mug', quantity: 2 }],
      shipsTo: 'Lviv'
    });
  }
};

/** Returns the delivery window for a city. The answer is fixed, like the order lookup's. */
export const getDeliveryWindow: Chat.AdditionalTool = {
  definition: {
    name: 'get_delivery_window',
    description: 'Returns the delivery window (dates and hours) for a city.',
    inputSchema: {
      type: Chat.AdditionalToolSchemaType.OBJECT,
      properties: { city: { type: 'string', description: 'The city to deliver to' } },
      required: ['city']
    }
  },
  async handler(args) {
    const city = typeof args.city === 'string' ? args.city : 'unknown';
    return textResult({ city, window: 'Tomorrow, 10:00-14:00' });
  }
};

/** The tools the order assistant may call, passed to every `generate()` call */
export const orderTools: Chat.AdditionalTool[] = [lookupOrder, getDeliveryWindow];

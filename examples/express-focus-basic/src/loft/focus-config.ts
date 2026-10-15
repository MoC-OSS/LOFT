import { Agent } from '@moc-global/loft-definitions';

export const FOCUS_NAME = 'pizza-order';

export const pizzaOrderFocus: Agent.Focus = {
  agentName: FOCUS_NAME,
  prompt: 'Collect pizza order details from the customer through natural conversation',
  fields: [
    {
      key: 'pizza_type',
      type: Agent.FocusFieldType.ENUM,
      required: true,
      values: ['margherita', 'pepperoni', 'hawaiian', 'veggie'],
      description: 'Type of pizza'
    },
    {
      key: 'size',
      type: Agent.FocusFieldType.ENUM,
      required: true,
      values: ['small', 'medium', 'large'],
      description: 'Pizza size'
    },
    {
      key: 'quantity',
      type: Agent.FocusFieldType.NUMBER,
      required: true,
      description: 'Number of pizzas (1-10)',
      validate: (v) => {
        const n = Number(v);
        return n >= 1 && n <= 10 ? true : 'Quantity must be between 1 and 10';
      }
    },
    {
      key: 'delivery_address',
      type: Agent.FocusFieldType.STRING,
      required: true,
      description: 'Delivery address'
    },
    {
      key: 'payment_method',
      type: Agent.FocusFieldType.ENUM,
      required: true,
      values: ['card', 'cash', 'online'],
      description: 'Payment method'
    },
    {
      key: 'special_instructions',
      type: Agent.FocusFieldType.STRING,
      required: false,
      description: 'Any special instructions for the order'
    }
  ],
  onComplete: { type: Agent.FocusActionType.TRANSITION, target: 'done' }
};

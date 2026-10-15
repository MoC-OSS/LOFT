import { Agent, Chat } from '@moc-global/loft-definitions';

import { handleClassifyFocus } from './ClassifyTool';
import { handleConfirmFocus } from './ConfirmTool';
import { handleUpdateFocus } from './UpdateTool';

function buildUpdateSchema(focus: Agent.Focus): Chat.AdditionalTool['definition']['inputSchema'] {
  const properties: Record<string, object> = {};
  for (const field of focus.fields) {
    const prop: Record<string, unknown> = { description: field.description };
    switch (field.type) {
      case Agent.FocusFieldType.STRING:
        prop.type = 'string';
        break;
      case Agent.FocusFieldType.NUMBER:
        prop.type = 'string';
        prop.description = `${field.description} (number as string)`;
        break;
      case Agent.FocusFieldType.BOOLEAN:
        prop.type = 'string';
        prop.description = `${field.description} ("true" or "false")`;
        break;
      case Agent.FocusFieldType.ENUM:
        prop.type = 'string';
        if (field.values) prop.enum = field.values;
        break;
      case Agent.FocusFieldType.DATE:
        prop.type = 'string';
        prop.description = `${field.description} (ISO 8601 date)`;
        break;
    }
    properties[field.key] = prop;
  }

  return {
    type: Chat.AdditionalToolSchemaType.OBJECT,
    properties
  };
}

export function generateFocusTools(
  focus: Agent.Focus,
  focusStateStore: Agent.FocusStateStore,
  sessionId: string
): Chat.AdditionalTool[] {
  const prefix = focus.agentName;

  const updateTool: Chat.AdditionalTool = {
    definition: {
      name: `update_${prefix}_focus`,
      description: `Update focus fields for ${focus.agentName}. Pass one or more field values to validate and store.`,
      inputSchema: buildUpdateSchema(focus)
    },
    handler: (args) => handleUpdateFocus(args, focus, focusStateStore, sessionId)
  };

  const confirmTool: Chat.AdditionalTool = {
    definition: {
      name: `confirm_${prefix}_focus`,
      description: `Get current focus status for ${focus.agentName}. Shows filled fields, missing required fields, and readiness.`,
      inputSchema: { type: Chat.AdditionalToolSchemaType.OBJECT, properties: {} }
    },
    handler: () => handleConfirmFocus(focus, focusStateStore, sessionId)
  };

  const classifyTool: Chat.AdditionalTool = {
    definition: {
      name: `classify_${prefix}_focus`,
      description: `Classify whether user input is related to the focus fields for ${focus.agentName}.`,
      inputSchema: {
        type: Chat.AdditionalToolSchemaType.OBJECT,
        properties: {
          classification: {
            type: 'string',
            description: 'Classification of the user input: ON_FOCUS, OFF_FOCUS, or UNKNOWN',
            enum: ['ON_FOCUS', 'OFF_FOCUS', 'UNKNOWN']
          }
        },
        required: ['classification']
      }
    },
    handler: (args) => handleClassifyFocus(args, focus)
  };

  return [updateTool, confirmTool, classifyTool];
}

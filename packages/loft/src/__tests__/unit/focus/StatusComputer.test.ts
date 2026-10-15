import { Agent } from '@moc-global/loft-definitions';
import { describe, expect, it } from 'vitest';

import { computeFocusStatus } from '../../../focus/StatusComputer';

const baseFocus: Agent.Focus = {
  agentName: 'intake',
  prompt: 'Collect vehicle info',
  fields: [
    { key: 'vehicleType', type: Agent.FocusFieldType.STRING, required: true, description: 'Vehicle type' },
    { key: 'year', type: Agent.FocusFieldType.NUMBER, required: true, description: 'Year' },
    { key: 'color', type: Agent.FocusFieldType.STRING, required: false, description: 'Color', default: 'white' }
  ],
  onComplete: { type: Agent.FocusActionType.TRANSITION, target: 'validator' }
};

describe('computeFocusStatus', () => {
  it('should mark all required as missing when stored is empty', () => {
    const status = computeFocusStatus(baseFocus, {});
    expect(status.agentName).toBe('intake');
    expect(status.missing).toEqual(['vehicleType', 'year']);
    expect(status.ready).toBe(false);
    expect(status.hasData).toBe(true); // color has default
    expect(status.filled).toEqual({ color: 'white' });
  });

  it('should report partial fill correctly', () => {
    const status = computeFocusStatus(baseFocus, { vehicleType: 'car' });
    expect(status.filled).toEqual({ vehicleType: 'car', color: 'white' });
    expect(status.missing).toEqual(['year']);
    expect(status.ready).toBe(false);
    expect(status.hasData).toBe(true);
  });

  it('should be ready when all required fields are filled', () => {
    const status = computeFocusStatus(baseFocus, { vehicleType: 'car', year: 2020 });
    expect(status.filled).toEqual({ vehicleType: 'car', year: 2020, color: 'white' });
    expect(status.missing).toEqual([]);
    expect(status.ready).toBe(true);
    expect(status.hasData).toBe(true);
  });

  it('should use stored value over default', () => {
    const status = computeFocusStatus(baseFocus, { vehicleType: 'car', year: 2020, color: 'red' });
    expect(status.filled.color).toBe('red');
  });

  it('should handle focus with no optional fields', () => {
    const focus: Agent.Focus = {
      agentName: 'simple',
      prompt: 'Collect name',
      fields: [{ key: 'name', type: Agent.FocusFieldType.STRING, required: true, description: 'Name' }],
      onComplete: { type: Agent.FocusActionType.TRANSITION, target: 'done' }
    };
    const status = computeFocusStatus(focus, {});
    expect(status.missing).toEqual(['name']);
    expect(status.hasData).toBe(false);
    expect(status.ready).toBe(false);
  });
});

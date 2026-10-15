import { Agent } from '@moc-global/loft-definitions';
import { describe, expect, it } from 'vitest';

import { FocusRegistry } from '../../../focus/FocusRegistry';

const testFocus: Agent.Focus = {
  agentName: 'intake',
  prompt: 'Collect vehicle info',
  fields: [
    { key: 'vehicleType', type: Agent.FocusFieldType.STRING, required: true, description: 'Vehicle type' },
    { key: 'year', type: Agent.FocusFieldType.NUMBER, required: true, description: 'Model year' }
  ],
  onComplete: { type: Agent.FocusActionType.TRANSITION, target: 'validator' }
};

describe('FocusRegistry', () => {
  it('should register and retrieve a Focus config', () => {
    const registry = new FocusRegistry();
    registry.register('intake', testFocus);

    expect(registry.get('intake')).toEqual(testFocus);
  });

  it('should return undefined for unregistered name', () => {
    const registry = new FocusRegistry();

    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('should throw on duplicate registration', () => {
    const registry = new FocusRegistry();
    registry.register('intake', testFocus);

    expect(() => registry.register('intake', testFocus)).toThrow('Focus "intake" is already registered');
  });

  it('should report has() correctly', () => {
    const registry = new FocusRegistry();

    expect(registry.has('intake')).toBe(false);
    registry.register('intake', testFocus);
    expect(registry.has('intake')).toBe(true);
  });

  it('should throw when agentName contains invalid characters', () => {
    const registry = new FocusRegistry();
    const invalidFocus: Agent.Focus = {
      ...testFocus,
      agentName: 'intake focus'
    };

    expect(() => registry.register('intake', invalidFocus)).toThrow(
      'Focus agentName "intake focus" contains invalid characters.'
    );
  });

  it('should accept agentName with letters, numbers, underscores, and hyphens', () => {
    const registry = new FocusRegistry();
    const validFocus: Agent.Focus = { ...testFocus, agentName: 'intake_focus-v2' };

    expect(() => registry.register('intake', validFocus)).not.toThrow();
  });

  it('should support multiple registrations with different names', () => {
    const registry = new FocusRegistry();
    const otherFocus: Agent.Focus = {
      agentName: 'billing',
      prompt: 'Collect billing info',
      fields: [{ key: 'email', type: Agent.FocusFieldType.STRING, required: true, description: 'Email' }],
      onComplete: { type: Agent.FocusActionType.TRANSITION, target: 'done' }
    };

    registry.register('intake', testFocus);
    registry.register('billing', otherFocus);

    expect(registry.get('intake')).toEqual(testFocus);
    expect(registry.get('billing')).toEqual(otherFocus);
  });
});

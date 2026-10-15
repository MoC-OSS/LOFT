// LoftQueue.test.ts
import { describe, expect, it, vi } from 'vitest';

import { LoftQueue } from '../../strategies';

export const testLoftQueue = (loftQueue: LoftQueue) => {
  describe('LoftQueue Interface Tests', () => {
    it('it should publish and consume a message', async () => {
      await expect(loftQueue.publish('test message 111')).resolves.not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 100)); // Wait for message processing
      const message = await loftQueue.consume();
      expect(message).toBe('test message 111');
    });

    it('should subscribe to messages', async () => {
      const worker = vi.fn().mockImplementation(async () => {});

      await loftQueue.subscribe(worker);
      await loftQueue.publish('test message 222');
      await new Promise((resolve) => setTimeout(resolve, 100)); // Wait for message processing

      expect(worker).toHaveBeenCalledWith('test message 222');
    });
  });
};

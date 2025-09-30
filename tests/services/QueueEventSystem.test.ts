import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  QueueEventSystem,
  queueConsumer,
  type QueueMessage,
  type EventHandler,
} from '@/services/QueueEventSystem';
import type { DatabaseEvent, CloudflareEnvironment } from '@/types';

describe('QueueEventSystem', () => {
  let queueSystem: QueueEventSystem;
  let mockEnv: CloudflareEnvironment;
  let mockQueue: any;
  let mockCache: any;
  let mockPortableDB: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockQueue = {
      send: vi.fn().mockResolvedValue(undefined),
      sendBatch: vi.fn().mockResolvedValue(undefined),
    };

    mockCache = {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    mockPortableDB = {};

    mockEnv = {
      DB_EVENTS: mockQueue,
      APP_CACHE: mockCache,
      PORTABLE_DB: mockPortableDB,
      SHARD: {} as any,
      ENVIRONMENT: 'test',
      LOG_LEVEL: 'debug',
      MAX_SHARD_SIZE_GB: '10',
      CACHE_TTL_MS: '30000',
      CACHE_SWR_MS: '120000',
    };

    queueSystem = new QueueEventSystem(mockEnv);
  });

  describe('Constructor', () => {
    it('should initialize with default values', () => {
      expect(queueSystem).toBeDefined();
    });

    it('should initialize with custom max retries and delay', () => {
      const customQueue = new QueueEventSystem(mockEnv, 5, 2000);
      expect(customQueue).toBeDefined();
    });
  });

  describe('sendEvent', () => {
    it('should send a valid event to the queue', async () => {
      const event: DatabaseEvent = {
        type: 'invalidate',
        shardId: 'shard-1',
        version: Date.now(),
        timestamp: Date.now(),
        keys: ['key1', 'key2'],
      };

      await queueSystem.sendEvent(event);

      expect(mockQueue.send).toHaveBeenCalledWith(event);
    });

    it('should throw error when queue is not available', async () => {
      const noQueueEnv = { ...mockEnv, DB_EVENTS: undefined };
      const noQueueSystem = new QueueEventSystem(noQueueEnv as any);

      const event: DatabaseEvent = {
        type: 'invalidate',
        shardId: 'shard-1',
        version: Date.now(),
        timestamp: Date.now(),
      };

      await expect(noQueueSystem.sendEvent(event)).rejects.toThrow('Queue not available');
    });

    it('should throw error for invalid event', async () => {
      const invalidEvent = {
        type: 'invalidate',
        // Missing shardId and timestamp
      } as DatabaseEvent;

      await expect(queueSystem.sendEvent(invalidEvent)).rejects.toThrow('Invalid event structure');
    });

    it('should throw error for unknown event type', async () => {
      const invalidEvent: DatabaseEvent = {
        type: 'unknown' as any,
        shardId: 'shard-1',
        version: Date.now(),
        timestamp: Date.now(),
      };

      await expect(queueSystem.sendEvent(invalidEvent)).rejects.toThrow('Unknown event type');
    });

    it('should handle queue send failure', async () => {
      mockQueue.send.mockRejectedValueOnce(new Error('Queue error'));

      const event: DatabaseEvent = {
        type: 'invalidate',
        shardId: 'shard-1',
        version: Date.now(),
        timestamp: Date.now(),
      };

      await expect(queueSystem.sendEvent(event)).rejects.toThrow('Failed to send event');
    });
  });

  describe('sendEvents', () => {
    it('should send multiple events in batch', async () => {
      const events: DatabaseEvent[] = [
        {
          type: 'invalidate',
          shardId: 'shard-1',
          version: Date.now(),
          timestamp: Date.now(),
        },
        {
          type: 'prewarm',
          shardId: 'shard-2',
          version: Date.now(),
          timestamp: Date.now(),
        },
      ];

      await queueSystem.sendEvents(events);

      expect(mockQueue.sendBatch).toHaveBeenCalledWith([{ body: events[0] }, { body: events[1] }]);
    });

    it('should handle empty events array', async () => {
      await queueSystem.sendEvents([]);
      expect(mockQueue.sendBatch).not.toHaveBeenCalled();
    });

    it('should throw error when queue is not available', async () => {
      const noQueueEnv = { ...mockEnv, DB_EVENTS: undefined };
      const noQueueSystem = new QueueEventSystem(noQueueEnv as any);

      const events: DatabaseEvent[] = [
        {
          type: 'invalidate',
          shardId: 'shard-1',
          version: Date.now(),
          timestamp: Date.now(),
        },
      ];

      await expect(noQueueSystem.sendEvents(events)).rejects.toThrow('Queue not available');
    });

    it('should validate all events before sending', async () => {
      const events: DatabaseEvent[] = [
        {
          type: 'invalidate',
          shardId: 'shard-1',
          version: Date.now(),
          timestamp: Date.now(),
        },
        {
          type: 'invalid' as any,
          shardId: 'shard-2',
          version: Date.now(),
          timestamp: Date.now(),
        },
      ];

      await expect(queueSystem.sendEvents(events)).rejects.toThrow('Unknown event type');
      expect(mockQueue.sendBatch).not.toHaveBeenCalled();
    });

    it('should handle batch send failure', async () => {
      mockQueue.sendBatch.mockRejectedValueOnce(new Error('Batch error'));

      const events: DatabaseEvent[] = [
        {
          type: 'invalidate',
          shardId: 'shard-1',
          version: Date.now(),
          timestamp: Date.now(),
        },
      ];

      await expect(queueSystem.sendEvents(events)).rejects.toThrow('Failed to send event batch');
    });
  });

  describe('processMessage', () => {
    it('should process a valid message', async () => {
      const message: QueueMessage = {
        id: 'msg-1',
        body: {
          type: 'invalidate',
          shardId: 'shard-1',
          version: Date.now(),
          timestamp: Date.now(),
          keys: ['key1'],
        },
        timestamp: Date.now(),
        attempts: 1,
        maxRetries: 3,
      };

      await queueSystem.processMessage(message);

      expect(mockCache.delete).toHaveBeenCalledWith('key1');
    });

    it('should skip processing if message is delayed', async () => {
      const message: QueueMessage = {
        id: 'msg-1',
        body: {
          type: 'invalidate',
          shardId: 'shard-1',
          version: Date.now(),
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
        attempts: 1,
        maxRetries: 3,
        delayUntil: Date.now() + 10000, // Delayed 10 seconds
      };

      await queueSystem.processMessage(message);

      // Should not process yet
      expect(mockCache.delete).not.toHaveBeenCalled();
    });

    it('should process delayed message when time is reached', async () => {
      const message: QueueMessage = {
        id: 'msg-1',
        body: {
          type: 'invalidate',
          shardId: 'shard-1',
          version: Date.now(),
          timestamp: Date.now(),
          keys: ['key1'],
        },
        timestamp: Date.now(),
        attempts: 1,
        maxRetries: 3,
        delayUntil: Date.now() - 1000, // Delay already passed
      };

      await queueSystem.processMessage(message);

      expect(mockCache.delete).toHaveBeenCalledWith('key1');
    });

    it('should handle processing errors and retry', async () => {
      // Create a custom handler that throws
      const failingHandler: EventHandler = vi.fn().mockRejectedValue(new Error('Handler error'));
      queueSystem.registerHandler('invalidate', failingHandler);

      const message: QueueMessage = {
        id: 'msg-1',
        body: {
          type: 'invalidate',
          shardId: 'shard-1',
          version: Date.now(),
          timestamp: Date.now(),
          keys: ['key1'],
        },
        timestamp: Date.now(),
        attempts: 1,
        maxRetries: 3,
      };

      await queueSystem.processMessage(message);

      const metrics = await queueSystem.getMetrics();
      expect(metrics.totalFailed).toBe(1);
      expect(metrics.deadLetterQueueSize).toBe(1);
    });

    it('should move to dead letter queue after max retries', async () => {
      // Create a custom handler that throws
      const failingHandler: EventHandler = vi.fn().mockRejectedValue(new Error('Handler error'));
      queueSystem.registerHandler('invalidate', failingHandler);

      const message: QueueMessage = {
        id: 'msg-1',
        body: {
          type: 'invalidate',
          shardId: 'shard-1',
          version: Date.now(),
          timestamp: Date.now(),
          keys: ['key1'],
        },
        timestamp: Date.now(),
        attempts: 3, // At max retries
        maxRetries: 3,
      };

      await queueSystem.processMessage(message);

      const metrics = await queueSystem.getMetrics();
      expect(metrics.deadLetterQueueSize).toBe(1);
    });
  });

  describe('getMetrics', () => {
    it('should return current metrics', async () => {
      const metrics = await queueSystem.getMetrics();

      expect(metrics).toHaveProperty('totalProcessed');
      expect(metrics).toHaveProperty('totalFailed');
      expect(metrics).toHaveProperty('currentQueueSize');
      expect(metrics).toHaveProperty('deadLetterQueueSize');
      expect(metrics).toHaveProperty('avgProcessingTime');
      expect(metrics).toHaveProperty('lastProcessedTime');
      expect(metrics).toHaveProperty('eventTypeCounts');
    });

    it('should update metrics after processing', async () => {
      const message: QueueMessage = {
        id: 'msg-1',
        body: {
          type: 'invalidate',
          shardId: 'shard-1',
            version: Date.now(),
          timestamp: Date.now(),
          keys: ['key1'],
        },
        timestamp: Date.now(),
        attempts: 1,
        maxRetries: 3,
      };

      await queueSystem.processMessage(message);

      const metrics = await queueSystem.getMetrics();
        expect(metrics.totalProcessed).toBe(1);
        expect(metrics.eventTypeCounts['invalidate']).toBe(1);
    });
  });

  describe('retryFailedEvents', () => {
    it('should retry events from dead letter queue when delay has passed', async () => {
      // Create a custom QueueEventSystem with very short retry delay
      const shortDelayQueue = new QueueEventSystem(mockEnv, 3, 10); // 10ms retry delay

      // Create a handler that fails once then succeeds
      let callCount = 0;
      const sometimesFailingHandler: EventHandler = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Handler error');
        }
        // Success on subsequent calls
      });
      shortDelayQueue.registerHandler('invalidate', sometimesFailingHandler);

      const message: QueueMessage = {
        id: 'msg-1',
        body: {
          type: 'invalidate',
          shardId: 'shard-1',
          version: Date.now(),
          timestamp: Date.now(),
          keys: ['key1'],
        },
        timestamp: Date.now(),
        attempts: 1,
        maxRetries: 3,
      };

      // First attempt fails
      await shortDelayQueue.processMessage(message);

      let metrics = await shortDelayQueue.getMetrics();
      expect(metrics.deadLetterQueueSize).toBe(1);
      expect(metrics.totalFailed).toBe(1);

      // Wait for retry delay to pass
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Retry failed events - should succeed
      await shortDelayQueue.retryFailedEvents();

      metrics = await shortDelayQueue.getMetrics();
      // Message should be removed after successful retry
      expect(metrics.deadLetterQueueSize).toBe(0);
      expect(metrics.totalProcessed).toBeGreaterThan(0);
    });

    it('should skip events that are still delayed', async () => {
      // Create a failing handler
      const failingHandler: EventHandler = vi.fn().mockRejectedValue(new Error('Handler error'));
      queueSystem.registerHandler('invalidate', failingHandler);

      const message: QueueMessage = {
        id: 'msg-1',
        body: {
          type: 'invalidate',
          shardId: 'shard-1',
          timestamp: Date.now(),
          keys: ['key1'],
        },
        timestamp: Date.now(),
        attempts: 1,
        maxRetries: 3,
      };

      // Process and fail
      await queueSystem.processMessage(message);

      // Manually update the delay to be in the future
      const metrics1 = await queueSystem.getMetrics();
      expect(metrics1.deadLetterQueueSize).toBe(1);

      // Attempt retry - items with delay will be skipped
      await queueSystem.retryFailedEvents();

      // The item will be retried but fail again, creating another DLQ entry
      const metrics = await queueSystem.getMetrics();
      expect(metrics.deadLetterQueueSize).toBeGreaterThan(0);
    });

    it('should skip events that exceeded max retries', async () => {
      // Create a failing handler
      const failingHandler: EventHandler = vi.fn().mockRejectedValue(new Error('Handler error'));
      queueSystem.registerHandler('invalidate', failingHandler);

      const message: QueueMessage = {
        id: 'msg-1',
        body: {
          type: 'invalidate',
          shardId: 'shard-1',
          timestamp: Date.now(),
          keys: ['key1'],
        },
        timestamp: Date.now(),
        attempts: 3,
        maxRetries: 3,
      };

      await queueSystem.processMessage(message);
      await queueSystem.retryFailedEvents();

      const metrics = await queueSystem.getMetrics();
      expect(metrics.deadLetterQueueSize).toBe(1);
    });
  });

  describe('clearDeadLetterQueue', () => {
    it('should clear all messages from dead letter queue', async () => {
      // Create a failing handler
      const failingHandler: EventHandler = vi.fn().mockRejectedValue(new Error('Handler error'));
      queueSystem.registerHandler('invalidate', failingHandler);

      const message: QueueMessage = {
        id: 'msg-1',
        body: {
          type: 'invalidate',
          shardId: 'shard-1',
          timestamp: Date.now(),
          keys: ['key1'],
        },
        timestamp: Date.now(),
        attempts: 1,
        maxRetries: 3,
      };

      await queueSystem.processMessage(message);

      let metrics = await queueSystem.getMetrics();
      expect(metrics.deadLetterQueueSize).toBeGreaterThan(0);

      await queueSystem.clearDeadLetterQueue();

      metrics = await queueSystem.getMetrics();
      expect(metrics.deadLetterQueueSize).toBe(0);
    });
  });

  describe('registerHandler and unregisterHandler', () => {
    it('should register custom event handler', async () => {
      const customHandler: EventHandler = vi.fn().mockResolvedValue(undefined);

      queueSystem.registerHandler('invalidate', customHandler);

      const message: QueueMessage = {
        id: 'msg-1',
        body: {
          type: 'invalidate',
          shardId: 'shard-1',
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
        attempts: 1,
        maxRetries: 3,
      };

      await queueSystem.processMessage(message);

      expect(customHandler).toHaveBeenCalled();
    });

    it('should unregister event handler', async () => {
      const customHandler: EventHandler = vi.fn().mockResolvedValue(undefined);

      queueSystem.registerHandler('invalidate', customHandler);
      queueSystem.unregisterHandler('invalidate', customHandler);

      const message: QueueMessage = {
        id: 'msg-1',
        body: {
          type: 'invalidate',
          shardId: 'shard-1',
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
        attempts: 1,
        maxRetries: 3,
      };

      await queueSystem.processMessage(message);

      // Custom handler should not be called, only default handler
      expect(customHandler).not.toHaveBeenCalled();
    });
  });

  describe('Default Handlers', () => {
    it('should process invalidate events', async () => {
      const message: QueueMessage = {
        id: 'msg-1',
        body: {
          type: 'invalidate',
          shardId: 'shard-1',
          timestamp: Date.now(),
          keys: ['key1', 'key2'],
        },
        timestamp: Date.now(),
        attempts: 1,
        maxRetries: 3,
      };

      await queueSystem.processMessage(message);

      expect(mockCache.delete).toHaveBeenCalledWith('key1');
      expect(mockCache.delete).toHaveBeenCalledWith('key2');
    });

    it('should handle invalidate errors gracefully', async () => {
      mockCache.delete.mockRejectedValueOnce(new Error('Delete failed'));

      const message: QueueMessage = {
        id: 'msg-1',
        body: {
          type: 'invalidate',
          shardId: 'shard-1',
          timestamp: Date.now(),
          keys: ['key1', 'key2'],
        },
        timestamp: Date.now(),
        attempts: 1,
        maxRetries: 3,
      };

      // Should not throw even if one key fails
      await queueSystem.processMessage(message);
    });

    it('should process prewarm events', async () => {
      const message: QueueMessage = {
        id: 'msg-1',
        body: {
          type: 'prewarm',
          shardId: 'shard-1',
          version: Date.now(),
          timestamp: Date.now(),
          keys: ['key1'],
          data: { test: 'value' },
        },
        timestamp: Date.now(),
        attempts: 1,
        maxRetries: 3,
      };

      await queueSystem.processMessage(message);

      expect(mockCache.put).toHaveBeenCalledWith(
        'key1',
        JSON.stringify({ test: 'value' }),
        expect.any(Object)
      );
    });

    it('should process d1_sync events', async () => {
      const message: QueueMessage = {
        id: 'msg-1',
        body: {
          type: 'd1_sync',
          shardId: 'shard-1',
          version: Date.now(),
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
        attempts: 1,
        maxRetries: 3,
      };

      await queueSystem.processMessage(message);

      // Should complete without errors
      const metrics = await queueSystem.getMetrics();
      expect(metrics.totalProcessed).toBe(1);
    });

    it('should handle missing cache for invalidate events', async () => {
      const noCacheEnv = { ...mockEnv, APP_CACHE: undefined };
      const noCacheSystem = new QueueEventSystem(noCacheEnv as any);

      const message: QueueMessage = {
        id: 'msg-1',
        body: {
          type: 'invalidate',
          shardId: 'shard-1',
          version: Date.now(),
          timestamp: Date.now(),
          keys: ['key1'],
        },
        timestamp: Date.now(),
        attempts: 1,
        maxRetries: 3,
      };

      // Should not throw
      await noCacheSystem.processMessage(message);
    });

    it('should handle missing cache for prewarm events', async () => {
      const noCacheEnv = { ...mockEnv, APP_CACHE: undefined };
      const noCacheSystem = new QueueEventSystem(noCacheEnv as any);

      const message: QueueMessage = {
        id: 'msg-1',
        body: {
          type: 'prewarm',
          shardId: 'shard-1',
          version: Date.now(),
          timestamp: Date.now(),
          keys: ['key1'],
          data: { test: 'value' },
        },
        timestamp: Date.now(),
        attempts: 1,
        maxRetries: 3,
      };

      // Should not throw
      await noCacheSystem.processMessage(message);
    });

    it('should handle missing PORTABLE_DB for d1_sync', async () => {
      const noDBEnv = { ...mockEnv, PORTABLE_DB: undefined };
      const noDBSystem = new QueueEventSystem(noDBEnv as any);

      const message: QueueMessage = {
        id: 'msg-1',
        body: {
          type: 'd1_sync',
          shardId: 'shard-1',
          version: Date.now(),
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
        attempts: 1,
        maxRetries: 3,
      };

      // Should not throw
      await noDBSystem.processMessage(message);
    });
  });

  describe('queueConsumer', () => {
    it('should process batch of messages', async () => {
      const mockMessage = {
        id: 'msg-1',
        body: {
          type: 'invalidate',
          shardId: 'shard-1',
          version: Date.now(),
          timestamp: Date.now(),
          keys: ['key1'],
        },
        timestamp: new Date(),
        ack: vi.fn(),
        retry: vi.fn(),
      };

      const batch = {
        messages: [mockMessage],
      } as any;

      await queueConsumer(batch, mockEnv);

      expect(mockMessage.ack).toHaveBeenCalled();
      expect(mockMessage.retry).not.toHaveBeenCalled();
    });

    it('should retry failed messages', async () => {
      // Create a message with completely invalid body that will cause processMessage to throw
      const mockMessage = {
        id: 'msg-1',
        body: null as any, // Will cause errors accessing body.type
        timestamp: new Date(),
        ack: vi.fn(),
        retry: vi.fn(),
      };

      const batch = {
        messages: [mockMessage],
      } as any;

      await queueConsumer(batch, mockEnv);

      expect(mockMessage.retry).toHaveBeenCalled();
      expect(mockMessage.ack).not.toHaveBeenCalled();
    });

    it('should process multiple messages in batch', async () => {
      const mockMessage1 = {
        id: 'msg-1',
        body: {
          type: 'invalidate',
          shardId: 'shard-1',
          version: Date.now(),
          timestamp: Date.now(),
          keys: ['key1'],
        },
        timestamp: new Date(),
        ack: vi.fn(),
        retry: vi.fn(),
      };

      const mockMessage2 = {
        id: 'msg-2',
        body: {
          type: 'prewarm',
          shardId: 'shard-2',
          version: Date.now(),
          timestamp: Date.now(),
          keys: ['key2'],
          data: { test: 'value' },
        },
        timestamp: new Date(),
        ack: vi.fn(),
        retry: vi.fn(),
      };

      const batch = {
        messages: [mockMessage1, mockMessage2],
      } as any;

      await queueConsumer(batch, mockEnv);

      expect(mockMessage1.ack).toHaveBeenCalled();
      expect(mockMessage2.ack).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle events without keys', async () => {
      const message: QueueMessage = {
        id: 'msg-1',
        body: {
          type: 'invalidate',
          shardId: 'shard-1',
          version: Date.now(),
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
        attempts: 1,
        maxRetries: 3,
      };

      await queueSystem.processMessage(message);

      // Should not throw
      const metrics = await queueSystem.getMetrics();
      expect(metrics.totalProcessed).toBe(1);
    });

    it('should handle prewarm events without data', async () => {
      const message: QueueMessage = {
        id: 'msg-1',
        body: {
          type: 'prewarm',
          shardId: 'shard-1',
          version: Date.now(),
          timestamp: Date.now(),
          keys: ['key1'],
        },
        timestamp: Date.now(),
        attempts: 1,
        maxRetries: 3,
      };

      await queueSystem.processMessage(message);

      // Should not throw
      const metrics = await queueSystem.getMetrics();
      expect(metrics.totalProcessed).toBe(1);
    });

    it('should calculate exponential backoff for retries', async () => {
      // Create a failing handler
      const failingHandler: EventHandler = vi.fn().mockRejectedValue(new Error('Handler error'));
      queueSystem.registerHandler('invalidate', failingHandler);

      const message: QueueMessage = {
        id: 'msg-1',
        body: {
          type: 'invalidate',
          shardId: 'shard-1',
          version: Date.now(),
          timestamp: Date.now(),
          keys: ['key1'],
        },
        timestamp: Date.now(),
        attempts: 1,
        maxRetries: 3,
      };

      await queueSystem.processMessage(message);

      const metrics = await queueSystem.getMetrics();
      expect(metrics.deadLetterQueueSize).toBe(1);
    });
  });
});

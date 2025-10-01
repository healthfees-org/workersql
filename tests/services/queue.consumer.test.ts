import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockEnvironment } from '../../tests/vitest.setup';
import { queueConsumer } from '../../src/services/QueueEventSystem';
import type { DatabaseEvent, CloudflareEnvironment } from '../../src/types';

type TestMessage = {
  id: string;
  body: DatabaseEvent;
  timestamp: Date;
  ack: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
};

function makeBatch(messages: TestMessage[]) {
  return { messages } as unknown as MessageBatch;
}

describe('Queue consumer - cache invalidation', () => {
  let env: CloudflareEnvironment;

  beforeEach(() => {
    env = createMockEnvironment();
    // Reset mocks
    vi.clearAllMocks();
  });

  it('invalidates by prefix in batch and marks idempotency', async () => {
    // Arrange: two invalidation events for different tables
    const ev1: DatabaseEvent = {
      type: 'invalidate',
      shardId: 'shard_0',
      version: Date.now(),
      timestamp: Date.now(),
      keys: ['tenantA:users'],
    };
    const ev2: DatabaseEvent = {
      type: 'invalidate',
      shardId: 'shard_0',
      version: Date.now(),
      timestamp: Date.now(),
      keys: ['tenantA:orders'],
    };

    const m1: TestMessage = {
      id: 'm1',
      body: ev1,
      timestamp: new Date(),
      ack: vi.fn(),
      retry: vi.fn(),
    };
    const m2: TestMessage = {
      id: 'm2',
      body: ev2,
      timestamp: new Date(),
      ack: vi.fn(),
      retry: vi.fn(),
    };

    // Mock KV list to return keys for each prefix used by CacheService.deleteByPattern
    const kv = env.APP_CACHE as any;
    kv.list = vi.fn().mockImplementation(async ({ prefix }: { prefix?: string }) => {
      const keys: string[] = [];
      if (prefix?.startsWith('tenantA:q:users:')) {
        keys.push('tenantA:q:users:abc', 'tenantA:q:users:def');
      }
      if (prefix?.startsWith('tenantA:q:orders:')) {
        keys.push('tenantA:q:orders:xyz');
      }
      return { keys: keys.map((name) => ({ name })) };
    });
    kv.delete = vi.fn().mockResolvedValue(undefined);
    kv.get = vi.fn().mockResolvedValue(null); // no idempotency yet
    kv.put = vi.fn().mockResolvedValue(undefined);

    // Act
    await queueConsumer(makeBatch([m1, m2]), env);

    // Assert: deletes called for discovered keys
    expect(kv.list).toHaveBeenCalledTimes(2);
    expect(kv.delete).toHaveBeenCalledWith('tenantA:q:users:abc');
    expect(kv.delete).toHaveBeenCalledWith('tenantA:q:users:def');
    expect(kv.delete).toHaveBeenCalledWith('tenantA:q:orders:xyz');
    // Idempotency markers created
    expect(kv.put).toHaveBeenCalledWith(expect.stringContaining('q:processed:m1'), '1', {
      expirationTtl: 600,
    });
    expect(kv.put).toHaveBeenCalledWith(expect.stringContaining('q:processed:m2'), '1', {
      expirationTtl: 600,
    });
    // Ack called, no retries
    expect(m1.ack).toHaveBeenCalled();
    expect(m2.ack).toHaveBeenCalled();
    expect(m1.retry).not.toHaveBeenCalled();
    expect(m2.retry).not.toHaveBeenCalled();
  });

  it('skips already processed messages (idempotent)', async () => {
    const ev: DatabaseEvent = {
      type: 'invalidate',
      shardId: 'shard_1',
      version: Date.now(),
      timestamp: Date.now(),
      keys: ['tenantB:users'],
    };
    const msg: TestMessage = {
      id: 'seen-msg',
      body: ev,
      timestamp: new Date(),
      ack: vi.fn(),
      retry: vi.fn(),
    };

    const kv = env.APP_CACHE as any;
    kv.get = vi.fn().mockImplementation(async (key: string) => {
      // Return seen marker for this message id
      return key.includes('seen-msg') ? '1' : null;
    });
    kv.list = vi.fn().mockResolvedValue({ keys: [] });
    kv.put = vi.fn().mockResolvedValue(undefined);

    await queueConsumer(makeBatch([msg]), env);

    // No deletes performed because message was already processed
    expect(kv.list).not.toHaveBeenCalled();
    expect(kv.put).toHaveBeenCalledTimes(1); // still marks processed (again) when finalizing
    expect(msg.ack).toHaveBeenCalled();
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it('handles malformed events gracefully without throwing', async () => {
    const badBody = { type: 'unknown', shardId: '', version: 0, timestamp: Date.now() } as unknown;
    const badMsg = {
      id: 'bad1',
      body: badBody,
      timestamp: new Date(),
      ack: vi.fn(),
      retry: vi.fn(),
    } as unknown as TestMessage;

    const kv = env.APP_CACHE as any;
    kv.get = vi.fn().mockResolvedValue(null);
    kv.list = vi.fn().mockResolvedValue({ keys: [] });
    kv.put = vi.fn().mockResolvedValue(undefined);

    await expect(queueConsumer(makeBatch([badMsg]), env)).resolves.not.toThrow();
    expect(badMsg.ack).toHaveBeenCalled();
  });
});

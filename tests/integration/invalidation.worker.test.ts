/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, it, expect } from 'vitest';
import { SELF, env } from 'cloudflare:test';

// Integration: ensure gateway exposes queue() handler and DO/gateway produce events.

describe('Event-driven cache invalidation (Workers runtime)', () => {
  it('exposes queue() handler and processes a batch', async () => {
    // Sanity: queue handler exists via runtime
    expect(typeof (SELF as any).queue).toBeDefined();

    // Simulate a queue batch with two invalidate events
    const msgs = [
      {
        id: 'e1',
        timestamp: new Date(),
        body: {
          type: 'invalidate',
          shardId: 'shard_0',
          version: Date.now(),
          timestamp: Date.now(),
          keys: ['tenantX:users'],
        },
        ack: () => void 0,
        retry: () => void 0,
      },
      {
        id: 'e2',
        timestamp: new Date(),
        body: {
          type: 'invalidate',
          shardId: 'shard_0',
          version: Date.now(),
          timestamp: Date.now(),
          keys: ['tenantX:orders'],
        },
        ack: () => void 0,
        retry: () => void 0,
      },
    ];

    // Populate some cache entries under those prefixes
    const E: any = env as unknown as any;
    await E.APP_CACHE.put(
      'tenantX:q:users:abc',
      JSON.stringify({
        foo: 1,
        freshUntil: 1,
        swrUntil: 2,
        version: 3,
        shardId: 's',
      })
    );
    await E.APP_CACHE.put(
      'tenantX:q:orders:def',
      JSON.stringify({
        foo: 2,
        freshUntil: 1,
        swrUntil: 2,
        version: 3,
        shardId: 's',
      })
    );

    const envForQueue = { APP_CACHE: (env as any).APP_CACHE };
    await (SELF as any).queue({ messages: msgs }, envForQueue, {} as any);

    // Validate keys removed
    const list = await E.APP_CACHE.list({ prefix: 'tenantX:q:' });
    const names = (list.keys as Array<{ name: string }>).map((k) => k.name);
    expect(names).not.toContain('tenantX:q:users:abc');
    expect(names).not.toContain('tenantX:q:orders:def');
  });
});

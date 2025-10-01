import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShardSplitService } from '@/services/ShardSplitService';
import type { ConfigService } from '@/services/ConfigService';
import type { RoutingPolicy } from '@/types';
import { RoutingVersionManager } from '@/services/RoutingVersionManager';
import {
  InMemoryKV,
  createConfigService,
  createEnv,
  createExecutionContextRecorder,
  createNamespace,
  seedRoutingPolicy,
} from '../helpers/shardSplitTestUtils';

type ExportBatch = {
  rows: Array<{ rowid: number; data: Record<string, unknown> }>;
  nextCursor: number | null;
};

function createSuccessfulBackfillNamespace(
  exportQueues: Map<string, ExportBatch[]>
): DurableObjectNamespace {
  const sourceStub = {
    fetch: vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const { pathname } = new URL(request.url);
      const body =
        request.method !== 'GET' ? ((await request.json()) as Record<string, unknown>) : {};

      if (pathname === '/admin/export') {
        const tenantId = body['tenantId'] as string;
        const table = body['table'] as string;
        const key = `${tenantId}:${table}`;
        const queue = exportQueues.get(key) ?? [];
        const nextBatch = queue.shift() ?? { rows: [], nextCursor: null };
        exportQueues.set(key, queue);
        return new Response(
          JSON.stringify({ success: true, rows: nextBatch.rows, nextCursor: nextBatch.nextCursor }),
          { status: 200 }
        );
      }

      if (pathname === '/admin/events') {
        return new Response(JSON.stringify({ success: true, events: [] }), { status: 200 });
      }

      return new Response('not-found', { status: 404 });
    }),
    connect: vi.fn(),
  } as unknown as DurableObjectStub;

  const targetStub = {
    fetch: vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const { pathname } = new URL(request.url);
      if (pathname === '/admin/import') {
        await request.json();
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }),
    connect: vi.fn(),
  } as unknown as DurableObjectStub;

  return createNamespace({
    'shard-a': sourceStub,
    'shard-b': targetStub,
  });
}

describe('ShardSplitService', () => {
  let kv: InMemoryKV;
  let configService: ConfigService;
  let policy: RoutingPolicy;

  beforeEach(() => {
    vi.spyOn(RoutingVersionManager.prototype, 'validatePolicyCompatibility').mockResolvedValue(
      true
    );
  });

  beforeEach(async () => {
    kv = new InMemoryKV();
    configService = createConfigService();
    policy = {
      version: 1,
      tenants: {
        alpha: 'shard-a',
        beta: 'shard-a',
      },
      ranges: [],
    };
    await seedRoutingPolicy(kv, policy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('plans a split when tenants match the source shard', async () => {
    const env = createEnv(kv);
    const service = new ShardSplitService(env, configService);
    await service.initialize();

    const plan = await service.planSplit({
      sourceShard: 'shard-a',
      targetShard: 'shard-b',
      tenantIds: ['alpha', 'beta'],
      description: 'split test shard',
    });

    expect(plan.id).toBeTruthy();
    expect(plan.phase).toBe('planning');
    expect(plan.backfill?.status).toBe('pending');
    expect(plan.tail?.status).toBe('pending');

    const persisted = await kv.get(`shard_split:plan:${plan.id}`, 'json');
    expect(persisted).not.toBeNull();
  });

  it('rejects split planning when tenants are not on the source shard', async () => {
    policy.tenants = { gamma: 'shard-x' };
    await seedRoutingPolicy(kv, policy);
    const env = createEnv(kv);
    const service = new ShardSplitService(env, configService);
    await service.initialize();

    await expect(
      service.planSplit({
        sourceShard: 'shard-a',
        targetShard: 'shard-b',
        tenantIds: ['gamma'],
      })
    ).rejects.toThrow('Tenants not routed to source shard shard-a');
  });

  it('starts dual write and clears prior error state', async () => {
    const env = createEnv(kv);
    const service = new ShardSplitService(env, configService);
    await service.initialize();

    const plan = await service.planSplit({
      sourceShard: 'shard-a',
      targetShard: 'shard-b',
      tenantIds: ['alpha'],
    });

    plan.backfill!.status = 'failed';
    plan.backfill!.startedAt = 1;
    plan.backfill!.completedAt = 2;
    plan.tail!.status = 'failed';
    plan.tail!.startedAt = 3;
    plan.tail!.completedAt = 4;
    plan.errorMessage = 'boom';

    const updated = await service.startDualWrite({ splitId: plan.id });

    expect(updated.phase).toBe('dual_write');
    expect(updated.dualWriteStartedAt).toBeGreaterThan(0);
    expect(updated.backfill?.status).toBe('pending');
    expect(updated.backfill?.startedAt).toBeUndefined();
    expect(updated.backfill?.completedAt).toBeUndefined();
    expect(updated.tail?.status).toBe('pending');
    expect(updated.tail?.startedAt).toBeUndefined();
    expect(updated.tail?.completedAt).toBeUndefined();
    expect(updated.errorMessage).toBeUndefined();
  });

  it('rejects backfill when not in dual write phase', async () => {
    const env = createEnv(kv);
    const service = new ShardSplitService(env, configService);
    await service.initialize();

    const plan = await service.planSplit({
      sourceShard: 'shard-a',
      targetShard: 'shard-b',
      tenantIds: ['alpha'],
    });

    await expect(service.runBackfill({ splitId: plan.id })).rejects.toThrow(
      'Backfill requires dual-write phase'
    );
  });

  it('runs backfill and updates plan status with execution context', async () => {
    const exportQueues = new Map<string, ExportBatch[]>();
    exportQueues.set('alpha:users', [
      {
        rows: [
          { rowid: 1, data: { id: 1, tenant_id: 'alpha', name: 'User A' } },
          { rowid: 2, data: { id: 2, tenant_id: 'alpha', name: 'User B' } },
        ],
        nextCursor: 2,
      },
      {
        rows: [{ rowid: 3, data: { id: 3, tenant_id: 'alpha', name: 'User C' } }],
        nextCursor: null,
      },
      {
        rows: [],
        nextCursor: null,
      },
    ]);

    const namespace = createSuccessfulBackfillNamespace(exportQueues);
    const env = createEnv(kv, namespace);
    const service = new ShardSplitService(env, configService);
    await service.initialize();

    const plan = await service.planSplit({
      sourceShard: 'shard-a',
      targetShard: 'shard-b',
      tenantIds: ['alpha'],
    });

    await service.startDualWrite({ splitId: plan.id });

    const { ctx, waitUntilPromises } = createExecutionContextRecorder();
    const immediatePlan = await service.runBackfill({ splitId: plan.id, ctx });
    expect(immediatePlan.backfill?.status).toBe('running');

    await Promise.all(waitUntilPromises);

    const updatedPlan = await service.getPlan(plan.id);
    expect(updatedPlan).not.toBeNull();
    expect(updatedPlan!.phase).toBe('tailing');
    expect(updatedPlan!.backfill?.status).toBe('completed');
    expect(updatedPlan!.backfill?.totalRowsCopied).toBe(3);
  });

  it('marks backfill as failed when export endpoint errors', async () => {
    const namespace = createNamespace({
      'shard-a': {
        fetch: vi.fn(async (input: RequestInfo, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          const { pathname } = new URL(request.url);
          if (pathname === '/admin/export') {
            return new Response('boom', { status: 500 });
          }
          return new Response(JSON.stringify({ success: true, events: [] }), { status: 200 });
        }),
        connect: vi.fn(),
      } as unknown as DurableObjectStub,
      'shard-b': {
        fetch: vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })),
        connect: vi.fn(),
      } as unknown as DurableObjectStub,
    });

    const env = createEnv(kv, namespace);
    const service = new ShardSplitService(env, configService);
    await service.initialize();

    const plan = await service.planSplit({
      sourceShard: 'shard-a',
      targetShard: 'shard-b',
      tenantIds: ['alpha'],
    });

    await service.startDualWrite({ splitId: plan.id });
    const { ctx, waitUntilPromises } = createExecutionContextRecorder();

    await service.runBackfill({ splitId: plan.id, ctx });
    await Promise.all(waitUntilPromises);

    const failedPlan = await service.getPlan(plan.id);
    expect(failedPlan?.backfill?.status).toBe('failed');
    expect(failedPlan?.errorMessage).toContain('Failed to export rows');
  });

  it('marks tail replay as failed when target shard rejects mutation', async () => {
    const namespace = createNamespace({
      'shard-a': {
        fetch: vi.fn(async (input: RequestInfo, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          const { pathname } = new URL(request.url);
          if (pathname === '/admin/events') {
            return new Response(
              JSON.stringify({
                success: true,
                events: [
                  {
                    id: 1,
                    ts: Date.now(),
                    type: 'mutation',
                    payload: {
                      tenantId: 'alpha',
                      sql: 'INSERT INTO users (id) VALUES (1)',
                    },
                  },
                ],
              }),
              { status: 200 }
            );
          }
          return new Response(JSON.stringify({ success: true, rows: [], nextCursor: null }), {
            status: 200,
          });
        }),
        connect: vi.fn(),
      } as unknown as DurableObjectStub,
      'shard-b': {
        fetch: vi.fn(async () => new Response('nope', { status: 500 })),
        connect: vi.fn(),
      } as unknown as DurableObjectStub,
    });

    const env = createEnv(kv, namespace);
    const service = new ShardSplitService(env, configService);
    await service.initialize();

    const plan = await service.planSplit({
      sourceShard: 'shard-a',
      targetShard: 'shard-b',
      tenantIds: ['alpha'],
    });

    await service.startDualWrite({ splitId: plan.id });
    plan.phase = 'tailing';
    plan.tail!.status = 'pending';
    plan.dualWriteStartedAt = Date.now();

    await expect(service.replayTail({ splitId: plan.id })).rejects.toThrow(
      'Failed to apply tail event'
    );

    const failedPlan = await service.getPlan(plan.id);
    expect(failedPlan?.tail?.status).toBe('failed');
    expect(failedPlan?.errorMessage).toContain('Failed to apply tail event');
  });

  it('resolves read and write shards respecting active split phases', async () => {
    const env = createEnv(kv);
    const service = new ShardSplitService(env, configService);
    await service.initialize();

    const plan = await service.planSplit({
      sourceShard: 'shard-a',
      targetShard: 'shard-b',
      tenantIds: ['alpha'],
    });

    expect(service.resolveReadShard('alpha', 'shard-a')).toBe('shard-a');
    expect(service.resolveWriteShards('alpha', 'shard-a')).toEqual(['shard-a']);

    await service.startDualWrite({ splitId: plan.id });
    expect(new Set(service.resolveWriteShards('alpha', 'shard-a'))).toEqual(
      new Set(['shard-a', 'shard-b'])
    );

    plan.phase = 'completed';
    expect(service.resolveReadShard('alpha', 'shard-a')).toBe('shard-b');
    expect(service.resolveWriteShards('alpha', 'shard-a')).toEqual(['shard-b']);
  });

  it('performs cutover and rollback lifecycle updates', async () => {
    const env = createEnv(kv);
    const service = new ShardSplitService(env, configService);
    await service.initialize();

    const plan = await service.planSplit({
      sourceShard: 'shard-a',
      targetShard: 'shard-b',
      tenantIds: ['alpha'],
    });

    plan.phase = 'cutover_pending';
    plan.tail!.status = 'caught_up';
    plan.dualWriteStartedAt = Date.now();

    const completed = await service.cutover({ splitId: plan.id });
    expect(completed.phase).toBe('completed');
    expect(completed.routingVersionCutover).toBeGreaterThan(policy.version);

    const currentVersion = await kv.get('routing:current_version', 'text');
    expect(currentVersion).toBe(String(completed.routingVersionCutover));

    const rolledBack = await service.rollback({ splitId: plan.id });
    expect(rolledBack.phase).toBe('rolled_back');
    expect(rolledBack.backfill?.status).toBe('pending');
    expect(rolledBack.tail?.status).toBe('pending');

    const versionAfterRollback = await kv.get('routing:current_version', 'text');
    expect(versionAfterRollback).toBe(String(plan.routingVersionAtStart));
  });

  it('produces metrics for each plan', async () => {
    const env = createEnv(kv);
    const service = new ShardSplitService(env, configService);
    await service.initialize();

    const plan = await service.planSplit({
      sourceShard: 'shard-a',
      targetShard: 'shard-b',
      tenantIds: ['alpha'],
    });

    const metrics = service.getMetrics();
    expect(metrics).toHaveLength(1);
    expect(metrics[0]?.splitId).toBe(plan.id);
    expect(metrics[0]?.backfillStatus).toBe('pending');
    expect(metrics[0]?.tailStatus).toBe('pending');
  });
});

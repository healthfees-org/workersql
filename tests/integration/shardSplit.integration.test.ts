import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ShardSplitService } from '@/services/ShardSplitService';
import type { RoutingPolicy } from '@/types';
import {
  InMemoryKV,
  createConfigService,
  createEnv,
  createExecutionContextRecorder,
  createNamespace,
  seedRoutingPolicy,
} from '../helpers/shardSplitTestUtils';

interface TailEvent {
  id: number;
  ts: number;
  type: string;
  payload: {
    tenantId: string;
    sql: string;
    params?: unknown[];
  };
}

type ExportBatch = {
  rows: Array<{ rowid: number; data: Record<string, unknown> }>;
  nextCursor: number | null;
};

describe('ShardSplitService integration', () => {
  let kv: InMemoryKV;
  let policy: RoutingPolicy;

  beforeEach(async () => {
    kv = new InMemoryKV();
    policy = {
      version: 1,
      tenants: {
        alpha: 'shard-a',
      },
      ranges: [],
    };
    await seedRoutingPolicy(kv, policy);
  });

  it('executes full shard split lifecycle', async () => {
    const exportQueues = new Map<string, ExportBatch[]>();
    exportQueues.set('alpha:users', [
      {
        rows: [
          { rowid: 1, data: { id: 1, tenant_id: 'alpha', name: 'User A' } },
          { rowid: 2, data: { id: 2, tenant_id: 'alpha', name: 'User B' } },
        ],
        nextCursor: null,
      },
      {
        rows: [],
        nextCursor: null,
      },
    ]);

    const tailEvents: TailEvent[] = [
      {
        id: 10,
        ts: Date.now(),
        type: 'mutation',
        payload: {
          tenantId: 'alpha',
          sql: 'INSERT INTO users (id, tenant_id, name) VALUES (3, "alpha", "User C")',
          params: [],
        },
      },
      {
        id: 11,
        ts: Date.now(),
        type: 'mutation',
        payload: {
          tenantId: 'alpha',
          sql: 'CREATE TABLE tenant_alpha_audit (id INTEGER PRIMARY KEY)',
        },
      },
      {
        id: 12,
        ts: Date.now(),
        type: 'mutation',
        payload: {
          tenantId: 'beta',
          sql: 'INSERT INTO users (id) VALUES (1)',
        },
      },
      {
        id: 13,
        ts: Date.now(),
        type: 'mutation',
        payload: {
          tenantId: 'alpha',
          sql: 'SELECT * FROM users',
        },
      },
    ];

    let eventsServed = false;

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
            JSON.stringify({
              success: true,
              rows: nextBatch.rows,
              nextCursor: nextBatch.nextCursor,
            }),
            { status: 200 }
          );
        }

        if (pathname === '/admin/events') {
          if (eventsServed) {
            return new Response(JSON.stringify({ success: true, events: [] }), { status: 200 });
          }
          eventsServed = true;
          const afterId = typeof body['afterId'] === 'number' ? (body['afterId'] as number) : 0;
          const events = tailEvents.filter((event) => event.id > afterId);
          return new Response(JSON.stringify({ success: true, events }), { status: 200 });
        }

        return new Response('not-found', { status: 404 });
      }),
      connect: vi.fn(),
    } as unknown as DurableObjectStub;

    const imports: ExportBatch[] = [];
    const mutations: Array<{ endpoint: string; payload: unknown }> = [];

    const targetStub = {
      fetch: vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const { pathname } = new URL(request.url);
        if (pathname === '/admin/import') {
          const payload = (await request.json()) as ExportBatch & { table: string };
          imports.push({ rows: payload.rows, nextCursor: payload.nextCursor });
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        if (pathname === '/mutation' || pathname === '/ddl') {
          const payload = await request.json();
          mutations.push({ endpoint: pathname, payload });
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }),
      connect: vi.fn(),
    } as unknown as DurableObjectStub;

    const namespace = createNamespace({
      'shard-a': sourceStub,
      'shard-b': targetStub,
    });

    const env = createEnv(kv, namespace);
    const configService = createConfigService();
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

    const afterBackfill = await service.getPlan(plan.id);
    expect(afterBackfill).not.toBeNull();
    expect(afterBackfill!.phase).toBe('tailing');
    expect(afterBackfill!.backfill?.status).toBe('completed');
    expect(imports.reduce((count, batch) => count + batch.rows.length, 0)).toBe(2);

    const afterTail = await service.replayTail({ splitId: plan.id });
    expect(afterTail.phase).toBe('cutover_pending');
    expect(afterTail.tail?.status).toBe('caught_up');
    expect(mutations).toHaveLength(2);
    expect(mutations[0]?.endpoint).toBe('/mutation');
    expect(mutations[1]?.endpoint).toBe('/ddl');

    const completed = await service.cutover({ splitId: plan.id });
    expect(completed.phase).toBe('completed');
    expect(completed.routingVersionCutover).toBeGreaterThan(policy.version);

    const updatedPolicy = (await kv.get(
      `routing:policy:v${completed.routingVersionCutover}`,
      'json'
    )) as unknown as RoutingPolicy;
    expect(updatedPolicy.tenants['alpha']).toBe('shard-b');
  });
});

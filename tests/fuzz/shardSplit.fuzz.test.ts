import { describe, it, expect } from 'vitest';
import { ShardSplitService } from '@/services/ShardSplitService';
import type { RoutingPolicy } from '@/types';
import {
  InMemoryKV,
  createConfigService,
  createEnv,
  seedRoutingPolicy,
} from '../helpers/shardSplitTestUtils';

function createRng(seed: number): () => number {
  let state = seed % 2147483647;
  if (state <= 0) {
    state += 2147483646;
  }
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

describe('Shard split fuzz tests', () => {
  const basePolicy: RoutingPolicy = {
    version: 1,
    tenants: {
      alpha: 'shard-a',
      beta: 'shard-a',
      gamma: 'shard-gamma',
      delta: 'shard-delta',
    },
    ranges: [],
  };

  it('validates tenant assignments across randomized inputs', async () => {
    const rng = createRng(1337);
    const tenantPool = Object.keys(basePolicy.tenants);

    for (let i = 0; i < 32; i += 1) {
      const kv = new InMemoryKV();
      await seedRoutingPolicy(kv, basePolicy);
      const service = new ShardSplitService(createEnv(kv), createConfigService());
      await service.initialize();

      const length = Math.max(1, Math.floor(rng() * tenantPool.length) + 1);
      const picks: string[] = [];
      for (let idx = 0; idx < length; idx += 1) {
        const randomIndex = Math.floor(rng() * tenantPool.length) % tenantPool.length;
        const tenant = tenantPool[randomIndex]!;
        picks.push(tenant);
      }

      const expectReject = picks.some((tenantId) => basePolicy.tenants[tenantId] !== 'shard-a');
      if (expectReject) {
        await expect(
          service.planSplit({
            sourceShard: 'shard-a',
            targetShard: 'shard-b',
            tenantIds: picks,
          })
        ).rejects.toThrow();
      } else {
        const plan = await service.planSplit({
          sourceShard: 'shard-a',
          targetShard: 'shard-b',
          tenantIds: picks,
        });
        expect(plan.tenantIds).toEqual([...new Set(picks)].sort());
      }
    }
  });
});

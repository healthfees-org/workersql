import { describe, it, expect, beforeEach } from 'vitest';
import { ShardSplitService } from '@/services/ShardSplitService';
import type { RoutingPolicy } from '@/types';
import {
  InMemoryKV,
  createConfigService,
  createEnv,
  seedRoutingPolicy,
} from '../helpers/shardSplitTestUtils';

describe('Shard split smoke test', () => {
  let kv: InMemoryKV;
  let policy: RoutingPolicy;

  beforeEach(async () => {
    kv = new InMemoryKV();
    policy = {
      version: 1,
      tenants: {},
      ranges: [],
    };
    await seedRoutingPolicy(kv, policy);
  });

  it('instantiates service and exposes empty plan list', async () => {
    const env = createEnv(kv);
    const service = new ShardSplitService(env, createConfigService());
    await service.initialize();

    const plans = service.listPlans();
    expect(Array.isArray(plans)).toBe(true);
    expect(plans).toHaveLength(0);
  });
});

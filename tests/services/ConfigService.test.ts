import { describe, it, expect, beforeEach } from 'vitest';
import { ConfigService } from '@/services/ConfigService';
import type { Env, AuthContext } from '@/types';

describe('ConfigService', () => {
  let configService: ConfigService;
  let mockEnv: Env;
  let mockAuthContext: AuthContext;

  beforeEach(() => {
    mockEnv = {
      APP_CACHE: {} as KVNamespace,
      DB_EVENTS: {} as Queue,
      SHARD: {} as DurableObjectNamespace,
      PORTABLE_DB: {} as D1Database,
      ENVIRONMENT: 'test',
      LOG_LEVEL: 'debug',
      MAX_SHARD_SIZE_GB: '10',
      CACHE_TTL_MS: '30000',
      CACHE_SWR_MS: '120000',
    };

    mockAuthContext = {
      tenantId: 'test-tenant',
      userId: 'test-user',
      permissions: ['read', 'write'],
      tokenHash: 'test-hash',
    };

    configService = new ConfigService(mockEnv, mockAuthContext);
  });

  describe('getTablePolicy', () => {
    it('should return policy for existing table', async () => {
      const policy = await configService.getTablePolicy('users');

      expect(policy).toBeDefined();
      expect(policy.pk).toBe('id');
      expect(policy.shardBy).toBe('tenant_id');
      expect(policy.cache.mode).toBe('bounded');
    });

    it('should throw error for non-existent table', async () => {
      await expect(configService.getTablePolicy('nonexistent')).rejects.toThrow(
        'No policy found for table: nonexistent'
      );
    });
  });

  describe('getTablePolicies', () => {
    it('should return all table policies', async () => {
      const policies = await configService.getTablePolicies();

      expect(policies).toBeDefined();
      // Access via bracket notation due to index signature
      expect(policies['users']).toBeDefined();
      expect(policies['posts']).toBeDefined();
      expect(policies['sessions']).toBeDefined();
    });

    it('should cache policies after first load', async () => {
      const policies1 = await configService.getTablePolicies();
      const policies2 = await configService.getTablePolicies();

      expect(policies1).toBe(policies2); // Same reference due to caching
    });
  });

  describe('getRoutingPolicy', () => {
    it('should return routing policy', async () => {
      const policy = await configService.getRoutingPolicy();

      expect(policy).toBeDefined();
      expect(policy.version).toBe(1);
      expect(policy.tenants).toBeDefined();
      expect(policy.ranges).toBeDefined();
      expect(policy.ranges).toHaveLength(2);
    });
  });

  describe('resolveShardId', () => {
    it('should resolve shard by tenant ID', async () => {
      const shardId = await configService.resolveShardId('users', undefined, 'demo');
      expect(shardId).toBe('shard-demo');
    });

    it('should resolve shard by hash for non-tenant data', async () => {
      const shardId = await configService.resolveShardId('global_data', 'some-key');
      expect(shardId).toMatch(/shard-range-[01]/);
    });

    it('should use default shard when no routing criteria match', async () => {
      const shardId = await configService.resolveShardId('unknown_table');
      expect(shardId).toBe('shard-range-0');
    });
  });

  describe('validateConfig', () => {
    it('should validate correct configuration', async () => {
      const result = await configService.validateConfig();

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('clearCache', () => {
    it('should clear configuration cache', async () => {
      // Load initial data
      await configService.getTablePolicies();

      // Clear cache
      configService.clearCache();

      // Should reload on next access
      const policies = await configService.getTablePolicies();
      expect(policies).toBeDefined();
    });
  });
});

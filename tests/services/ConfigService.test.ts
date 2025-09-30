import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigService } from '@/services/ConfigService';
import type { Env, AuthContext } from '@/types';

describe('ConfigService', () => {
  let configService: ConfigService;
  let mockEnv: Env;
  let mockAuthContext: AuthContext;

  beforeEach(() => {
    const mockKV = {
      get: vi.fn(),
      put: vi.fn().mockResolvedValue(undefined),
    };

    mockEnv = {
      APP_CACHE: mockKV as unknown as KVNamespace,
      DB_EVENTS: {} as Queue,
      SHARD: {} as DurableObjectNamespace,
      PORTABLE_DB: {} as D1Database,
      ENVIRONMENT: 'test',
      LOG_LEVEL: 'debug',
      MAX_SHARD_SIZE_GB: '10',
      CACHE_TTL_MS: '30000',
      CACHE_SWR_MS: '120000',
    };

    // Mock KV responses
    mockKV.get.mockImplementation((key: string) => {
      if (key === 'config:table-policies:users') {
        return Promise.resolve(
          `{"primary_key": "id", "shard_by": "tenant_id", "cache": {"mode": "bounded", "ttl_ms": 30000, "swr_ms": 120000, "always_strong_columns": ["role", "permissions", "balance"]}}`
        );
      }
      if (key === 'config:table-policies:orders') {
        return Promise.resolve(
          `{"primary_key": "order_id", "shard_by": "user_id", "cache": {"mode": "strong", "ttl_ms": 60000, "swr_ms": 300000}}`
        );
      }
      if (key === 'config:table-policies:posts') {
        return Promise.resolve(
          `{"primary_key": "id", "shard_by": "tenant_id", "cache": {"mode": "bounded", "ttl_ms": 15000, "swr_ms": 60000}}`
        );
      }
      if (key === 'config:table-policies:sessions') {
        return Promise.resolve(
          `{"primary_key": "id", "shard_by": "user_id", "cache": {"mode": "strong", "ttl_ms": 0, "swr_ms": 0}}`
        );
      }
      if (key === 'config:routing-policy') {
        return Promise.resolve(
          `{"version": 1, "tenants": {"demo": "shard-demo", "test": "shard-test"}, "ranges": [{"prefix": "00..7f", "shard": "shard-range-0"}, {"prefix": "80..ff", "shard": "shard-range-1"}]}`
        );
      }
      return Promise.resolve(null);
    });

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

  describe('updateTablePolicy', () => {
    it('should update table policy in KV and clear cache', async () => {
      const yamlContent = `{"primary_key": "id", "shard_by": "tenant_id", "cache": {"mode": "strong", "ttl_ms": 0, "swr_ms": 0}}`;

      await configService.updateTablePolicy('users', yamlContent);

      expect(mockEnv.APP_CACHE.put).toHaveBeenCalledWith(
        'config:table-policies:users',
        yamlContent
      );
    });

    it('should throw error for invalid YAML', async () => {
      const invalidYaml = 'invalid: yaml: content: ['; // Invalid JSON

      await expect(configService.updateTablePolicy('users', invalidYaml)).rejects.toThrow();
    });
  });

  describe('updateRoutingPolicy', () => {
    it('should update routing policy in KV and clear cache', async () => {
      const yamlContent = `{"version": 2, "tenants": {"new-tenant": "shard-new"}, "ranges": [{"prefix": "00..ff", "shard": "shard-all"}]}`;

      await configService.updateRoutingPolicy(yamlContent);

      expect(mockEnv.APP_CACHE.put).toHaveBeenCalledWith('config:routing-policy', yamlContent);
    });

    it('should throw error for invalid YAML', async () => {
      const invalidYaml = 'version: not-a-number';

      await expect(configService.updateRoutingPolicy(invalidYaml)).rejects.toThrow();
    });
  });
});

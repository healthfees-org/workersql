import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CacheService } from '@/services/CacheService';

describe('CacheService', () => {
  let cacheService;
  let mockEnv;
  let mockAuthContext;
  let mockKVNamespace;

  beforeEach(() => {
    mockKVNamespace = {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    };
    mockEnv = {
      APP_CACHE: mockKVNamespace,
      DB_EVENTS: {},
      SHARD: {},
      PORTABLE_DB: {},
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
    cacheService = new CacheService(mockEnv, mockAuthContext);
  });
  describe('get', () => {
    it('should return null for cache miss', async () => {
      mockKVNamespace.get.mockResolvedValue(null);
      const result = await cacheService.get('test-key');
      expect(result).toBeNull();
      expect(mockKVNamespace.get).toHaveBeenCalledWith('test-key');
    });
    it('should return cache entry for cache hit', async () => {
      const mockEntry = {
        data: { id: 1, name: 'test' },
        version: 1,
        freshUntil: Date.now() + 30000,
        swrUntil: Date.now() + 120000,
        shardId: 'shard-1',
      };
      mockKVNamespace.get.mockResolvedValue(JSON.stringify(mockEntry));
      const result = await cacheService.get('test-key');
      expect(result).toEqual(mockEntry);
    });
    it('should handle invalid JSON gracefully', async () => {
      mockKVNamespace.get.mockResolvedValue('invalid-json');
      mockKVNamespace.delete.mockResolvedValue();
      const result = await cacheService.get('test-key');
      expect(result).toBeNull();
      expect(mockKVNamespace.delete).toHaveBeenCalledWith('test-key');
    });
  });
  describe('set', () => {
    it('should store cache entry with correct format', async () => {
      mockKVNamespace.put.mockResolvedValue();
      const data = { id: 1, name: 'test' };
      await cacheService.set('test-key', data, 1, 'shard-1', 30000, 120000);
      expect(mockKVNamespace.put).toHaveBeenCalledWith(
        'test-key',
        expect.stringContaining('"data":{"id":1,"name":"test"}'),
        expect.objectContaining({
          expirationTtl: expect.any(Number),
        })
      );
    });
    it('should use default TTL values when not provided', async () => {
      mockKVNamespace.put.mockResolvedValue();
      await cacheService.set('test-key', {}, 1, 'shard-1');
      expect(mockKVNamespace.put).toHaveBeenCalled();
    });
  });
  describe('delete', () => {
    it('should delete cache entry', async () => {
      mockKVNamespace.delete.mockResolvedValue();
      await cacheService.delete('test-key');
      expect(mockKVNamespace.delete).toHaveBeenCalledWith('test-key');
    });
  });
  describe('deleteMany', () => {
    it('should delete multiple cache entries', async () => {
      mockKVNamespace.delete.mockResolvedValue();
      const keys = ['key1', 'key2', 'key3'];
      await cacheService.deleteMany(keys);
      expect(mockKVNamespace.delete).toHaveBeenCalledTimes(3);
      keys.forEach((key) => {
        expect(mockKVNamespace.delete).toHaveBeenCalledWith(key);
      });
    });
  });
  describe('cache freshness checks', () => {
    it('should correctly identify fresh entries', () => {
      const entry = {
        data: {},
        version: 1,
        freshUntil: Date.now() + 10000, // 10 seconds in future
        swrUntil: Date.now() + 60000, // 1 minute in future
        shardId: 'shard-1',
      };
      expect(cacheService.isFresh(entry)).toBe(true);
      expect(cacheService.isStaleButRevalidatable(entry)).toBe(false);
      expect(cacheService.isExpired(entry)).toBe(false);
    });
    it('should correctly identify stale but revalidatable entries', () => {
      const entry = {
        data: {},
        version: 1,
        freshUntil: Date.now() - 10000, // 10 seconds ago
        swrUntil: Date.now() + 50000, // 50 seconds in future
        shardId: 'shard-1',
      };
      expect(cacheService.isFresh(entry)).toBe(false);
      expect(cacheService.isStaleButRevalidatable(entry)).toBe(true);
      expect(cacheService.isExpired(entry)).toBe(false);
    });
    it('should correctly identify expired entries', () => {
      const entry = {
        data: {},
        version: 1,
        freshUntil: Date.now() - 70000, // 70 seconds ago
        swrUntil: Date.now() - 10000, // 10 seconds ago
        shardId: 'shard-1',
      };
      expect(cacheService.isFresh(entry)).toBe(false);
      expect(cacheService.isStaleButRevalidatable(entry)).toBe(false);
      expect(cacheService.isExpired(entry)).toBe(true);
    });
  });
  describe('key generation', () => {
    it('should create entity key', () => {
      const key = cacheService.createEntityKey('users', '123');
      expect(key).toBe('t:users:id:123');
    });
    it('should create index key', () => {
      const key = cacheService.createIndexKey('users', 'email', 'test@example.com');
      expect(key).toBe('idx:users:email:test@example.com');
    });
    it('should create query key', async () => {
      const key = await cacheService.createQueryKey('users', 'SELECT * FROM users WHERE id = ?', [
        123,
      ]);
      expect(key).toMatch(/^q:users:[a-f0-9]+$/);
    });
  });
  describe('warmCache', () => {
    it('should warm cache with multiple entries', async () => {
      mockKVNamespace.put.mockResolvedValue();
      const entries = [
        { key: 'key1', data: { id: 1 }, version: 1, shardId: 'shard-1' },
        { key: 'key2', data: { id: 2 }, version: 1, shardId: 'shard-1' },
      ];
      await cacheService.warmCache(entries);
      expect(mockKVNamespace.put).toHaveBeenCalledTimes(2);
    });
  });
});
//# sourceMappingURL=CacheService.test.js.map

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CacheService } from '@/services/CacheService';
import type { Env, CacheEntry } from '@/types';

describe('CacheService', () => {
  let cacheService: CacheService;
  let mockEnv: Env;
  let mockKVNamespace: any;
  let getMock: any;

  beforeEach(() => {
    getMock = vi.fn();

    mockKVNamespace = {
      get: getMock as any,
      put: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
      getWithMetadata: vi.fn(),
    };

    mockEnv = {
      APP_CACHE: mockKVNamespace,
      DB_EVENTS: {} as Queue,
      SHARD: {} as DurableObjectNamespace,
      PORTABLE_DB: {} as D1Database,
      ENVIRONMENT: 'test',
      LOG_LEVEL: 'debug',
      MAX_SHARD_SIZE_GB: '10',
      CACHE_TTL_MS: '30000',
      CACHE_SWR_MS: '120000',
    };

    cacheService = new CacheService(mockEnv);
  });

  describe('get', () => {
    it('should return null for cache miss', async () => {
      getMock.mockResolvedValue(null as any);

      const result = await cacheService.get('test-key');

      expect(result).toBeNull();
      expect(mockKVNamespace.get).toHaveBeenCalledWith('test-key', 'json');
    });

    it('should return cache entry for cache hit', async () => {
      const mockEntry: CacheEntry = {
        data: { id: 1, name: 'test' },
        version: 1,
        freshUntil: Date.now() + 30000,
        swrUntil: Date.now() + 120000,
        shardId: 'shard-1',
      };

      getMock.mockResolvedValue(mockEntry as any);

      const result = await cacheService.get('test-key');

      expect(result).toEqual(mockEntry);
    });

    it('should handle invalid JSON gracefully', async () => {
      getMock.mockResolvedValue('invalid-json' as any);
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
      await cacheService.set('test-key', data, {
        ttlMs: 30000,
        swrMs: 120000,
        version: 1,
        shardId: 'shard-1',
      });

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

      await cacheService.set('test-key', {});

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

  describe('cache freshness checks', () => {
    it('should correctly identify fresh entries', () => {
      const entry: CacheEntry = {
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
      const entry: CacheEntry = {
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
      const entry: CacheEntry = {
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
});

import { describe, it, expect, vi } from 'vitest';
import { CacheService } from '../../src/services/CacheService';
import { createMockEnvironment } from '../vitest.setup';

describe('CacheService (Vitest)', () => {
  describe('basic functionality', () => {
    it('should create cache service with mock environment', () => {
      const mockEnv = createMockEnvironment();
      const cacheService = new CacheService(mockEnv);

      expect(cacheService).toBeDefined();
      expect(cacheService).toBeInstanceOf(CacheService);
    });

    it('should handle cache miss gracefully', async () => {
      const mockEnv = createMockEnvironment();
      vi.mocked(mockEnv.APP_CACHE.get).mockResolvedValue(null as any);

      const cacheService = new CacheService(mockEnv);
      const result = await cacheService.get('test-key');

      expect(result).toBeNull();
      expect(mockEnv.APP_CACHE.get).toHaveBeenCalledWith('test-key', 'json');
    });

    it('should handle cache hit correctly', async () => {
      const mockEnv = createMockEnvironment();
      const testData = {
        data: 'test',
        version: 1,
        freshUntil: Date.now() + 1000,
        swrUntil: Date.now() + 2000,
        shardId: 'test-shard',
      };
      vi.mocked(mockEnv.APP_CACHE.get).mockResolvedValue(testData as any);

      const cacheService = new CacheService(mockEnv);
      const result = await cacheService.get('test-key');

      expect(result).toEqual(testData);
      expect(mockEnv.APP_CACHE.get).toHaveBeenCalledWith('test-key', 'json');
    });

    it('should set cache entry', async () => {
      const mockEnv = createMockEnvironment();
      vi.mocked(mockEnv.APP_CACHE.put).mockResolvedValue(undefined);

      const cacheService = new CacheService(mockEnv);
      await cacheService.set('test-key', { foo: 'bar' }, { ttlMs: 1000, swrMs: 2000 });

      expect(mockEnv.APP_CACHE.put).toHaveBeenCalled();
    });
  });

  describe('key generation', () => {
    it('should create entity key correctly', () => {
      const mockEnv = createMockEnvironment();
      const cacheService = new CacheService(mockEnv);

      const key = cacheService.createEntityKey('users', '123');
      expect(key).toBe('t:users:id:123');
    });

    it('should create index key correctly', () => {
      const mockEnv = createMockEnvironment();
      const cacheService = new CacheService(mockEnv);

      const key = cacheService.createIndexKey('users', 'email', 'test@example.com');
      expect(key).toBe('idx:users:email:test@example.com');
    });

    it('should create query key with hash', async () => {
      const mockEnv = createMockEnvironment();
      const cacheService = new CacheService(mockEnv);

      const key = await cacheService.createQueryKey('users', 'SELECT * FROM users', ['test']);
      expect(key).toMatch(/^q:users:[a-f0-9]+$/);
    });
  });

  describe('freshness checks', () => {
    it('should identify fresh entries correctly', () => {
      const mockEnv = createMockEnvironment();
      const cacheService = new CacheService(mockEnv);

      const entry = {
        data: 'test',
        version: 1,
        freshUntil: Date.now() + 1000,
        swrUntil: Date.now() + 2000,
        shardId: 'test-shard',
      };

      expect(cacheService.isFresh(entry)).toBe(true);
    });

    it('should identify stale but revalidatable entries correctly', () => {
      const mockEnv = createMockEnvironment();
      const cacheService = new CacheService(mockEnv);

      const entry = {
        data: 'test',
        version: 1,
        freshUntil: Date.now() - 1000,
        swrUntil: Date.now() + 1000,
        shardId: 'test-shard',
      };

      expect(cacheService.isFresh(entry)).toBe(false);
      expect(cacheService.isStaleButRevalidatable(entry)).toBe(true);
    });

    it('should identify expired entries correctly', () => {
      const mockEnv = createMockEnvironment();
      const cacheService = new CacheService(mockEnv);

      const entry = {
        data: 'test',
        version: 1,
        freshUntil: Date.now() - 2000,
        swrUntil: Date.now() - 1000,
        shardId: 'test-shard',
      };

      expect(cacheService.isFresh(entry)).toBe(false);
      expect(cacheService.isStaleButRevalidatable(entry)).toBe(false);
      expect(cacheService.isExpired(entry)).toBe(true);
    });
  });
});

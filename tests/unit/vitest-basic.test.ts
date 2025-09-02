import { describe, it, expect, beforeEach } from 'vitest';
import { CacheService } from '../../src/services/CacheService';
import { createMockEnvironment } from '../vitest.setup';

describe('CacheService (Vitest)', () => {
  let cacheService: CacheService;
  let mockEnv: ReturnType<typeof createMockEnvironment>;

  beforeEach(() => {
    mockEnv = createMockEnvironment();
    cacheService = new CacheService(mockEnv);
  });

  describe('createQueryKey', () => {
    it('should create a valid query key', async () => {
      const key = await cacheService.createQueryKey('users', 'SELECT * FROM users', ['param1']);
      expect(key).toMatch(/^q:users:[a-f0-9]+$/);
    });

    it('should create different keys for different queries', async () => {
      const key1 = await cacheService.createQueryKey('users', 'SELECT * FROM users', []);
      const key2 = await cacheService.createQueryKey('orders', 'SELECT * FROM orders', []);
      expect(key1).not.toBe(key2);
    });
  });

  describe('createEntityKey', () => {
    it('should create a valid entity key', () => {
      const key = cacheService.createEntityKey('users', '123');
      expect(key).toBe('t:users:id:123');
    });
  });

  describe('createIndexKey', () => {
    it('should create a valid index key', () => {
      const key = cacheService.createIndexKey('users', 'email', 'test@example.com');
      expect(key).toBe('idx:users:email:test@example.com');
    });
  });
});

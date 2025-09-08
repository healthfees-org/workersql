import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { ConnectionManager } from '@/services/ConnectionManager';

describe('ConnectionManager - Connection Pooling', () => {
  let cm: ConnectionManager;
  let originalWebSocket: any;

  // Provide a minimal global WebSocket for Node/Jest environment
  class FakeWebSocket {
    static OPEN = 1;
    static CLOSED = 3;
    readyState = FakeWebSocket.OPEN;
    url: string;
    private listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
    constructor(url: string) {
      this.url = url;
    }
    addEventListener(event: string, handler: (...args: unknown[]) => void) {
      (this.listeners[event] ||= []).push(handler);
    }
    close() {
      this.readyState = FakeWebSocket.CLOSED;
      (this.listeners['close'] || []).forEach((h) => h());
    }
  }

  beforeAll(() => {
    originalWebSocket = (global as any).WebSocket;
    (global as any).WebSocket = FakeWebSocket as any;
  });

  afterAll(() => {
    (global as any).WebSocket = originalWebSocket;
  });

  beforeEach(() => {
    cm = new ConnectionManager(1000, 3); // 1 second TTL, max 3 connections per shard
  });

  afterEach(() => {
    cm.destroy();
  });

  describe('Connection Pool Management', () => {
    it('creates connection pool when first session binds to shard', () => {
      cm.bindSession('sess1', 'tenantA', 'shard_1');
      const stats = cm.getPoolStats('shard_1');
      expect(stats).toEqual({
        active: 0,
        idle: 0,
        waiting: 0,
        max: 3,
      });
    });

    it('handles multiple shards independently', () => {
      cm.bindSession('sess1', 'tenantA', 'shard_1');
      cm.bindSession('sess2', 'tenantB', 'shard_2');

      expect(cm.getPoolStats('shard_1')).toBeDefined();
      expect(cm.getPoolStats('shard_2')).toBeDefined();
      // Change state in shard_1 to verify independence
      const pool1 = (cm as any).connectionPools.get('shard_1');
      pool1.activeConnections = 1;
      expect(cm.getPoolStats('shard_1')).not.toEqual(cm.getPoolStats('shard_2'));
    });

    it('tracks connection counts correctly', () => {
      cm.bindSession('sess1', 'tenantA', 'shard_1');
      cm.bindSession('sess2', 'tenantA', 'shard_1');
      cm.bindSession('sess3', 'tenantA', 'shard_1');

      expect(cm.getShardConnections('shard_1')).toBe(3);
    });
  });

  describe('Connection Acquisition', () => {
    let mockWebSocket: any;

    beforeEach(() => {
      // Mock WebSocket
      mockWebSocket = {
        readyState: WebSocket.OPEN,
        close: vi.fn(),
        addEventListener: vi.fn(),
      } as any;

      // Mock the createNewConnection method
      vi.spyOn(cm as any, 'createNewConnection').mockReturnValue(mockWebSocket);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('acquires connection from pool when available', async () => {
      cm.bindSession('sess1', 'tenantA', 'shard_1');

      // Simulate having an idle connection
      const pool = (cm as any).connectionPools.get('shard_1');
      pool.idleConnections.push(mockWebSocket);

      const conn = await cm.acquireConnection('shard_1');
      expect(conn).toBe(mockWebSocket);
      expect(pool.activeConnections).toBe(1);
      expect(pool.idleConnections).toHaveLength(0);
    });

    it('creates new connection when pool is empty', async () => {
      cm.bindSession('sess1', 'tenantA', 'shard_1');

      const conn = await cm.acquireConnection('shard_1');
      expect(conn).toBe(mockWebSocket);
      expect((cm as any).createNewConnection).toHaveBeenCalledWith('shard_1');
    });

    it('returns null for non-existent shard', async () => {
      const conn = await cm.acquireConnection('nonexistent');
      expect(conn).toBeNull();
    });
  });

  describe('Connection Release', () => {
    let mockWebSocket: any;

    beforeEach(() => {
      mockWebSocket = {
        readyState: WebSocket.OPEN,
        close: vi.fn(),
        addEventListener: vi.fn(),
      } as any;
    });

    it('releases connection back to pool when valid', () => {
      cm.bindSession('sess1', 'tenantA', 'shard_1');
      const pool = (cm as any).connectionPools.get('shard_1');

      cm.releaseConnection('shard_1', mockWebSocket);
      expect(pool.idleConnections).toContain(mockWebSocket);
      expect(pool.activeConnections).toBe(0);
    });

    it('does not return invalid connection to pool', () => {
      cm.bindSession('sess1', 'tenantA', 'shard_1');
      const pool = (cm as any).connectionPools.get('shard_1');

      const invalidWebSocket = {
        readyState: WebSocket.CLOSED,
        close: vi.fn(),
        addEventListener: vi.fn(),
      } as any;

      cm.releaseConnection('shard_1', invalidWebSocket);
      expect(pool.idleConnections).not.toContain(invalidWebSocket);
    });

    it('handles release for non-existent shard gracefully', () => {
      expect(() => cm.releaseConnection('nonexistent', mockWebSocket)).not.toThrow();
    });
  });

  describe('Pool Statistics', () => {
    it('provides accurate pool statistics', () => {
      cm.bindSession('sess1', 'tenantA', 'shard_1');
      const pool = (cm as any).connectionPools.get('shard_1');

      // Simulate some connections
      pool.activeConnections = 2;
      pool.idleConnections = [{ readyState: WebSocket.OPEN } as WebSocket];
      pool.waitingQueue = [vi.fn(), vi.fn()];

      const stats = cm.getPoolStats('shard_1');
      expect(stats).toEqual({
        active: 2,
        idle: 1,
        waiting: 2,
        max: 3,
      });
    });
  });

  describe('Connection Cleanup', () => {
    it('closes idle connections during cleanup', () => {
      cm.bindSession('sess1', 'tenantA', 'shard_1');
      const pool = (cm as any).connectionPools.get('shard_1');

      const mockConn = { readyState: WebSocket.OPEN, close: vi.fn() } as any;
      pool.idleConnections.push(mockConn);

      cm.cleanup();

      expect(mockConn.close).toHaveBeenCalled();
      expect(pool.idleConnections).toHaveLength(0);
    });

    it('removes invalid idle connections', () => {
      cm.bindSession('sess1', 'tenantA', 'shard_1');
      const pool = (cm as any).connectionPools.get('shard_1');

      const validConn = { readyState: (global as any).WebSocket.OPEN } as WebSocket;
      const invalidConn = { readyState: WebSocket.CLOSED } as WebSocket;

      pool.idleConnections.push(validConn, invalidConn);
      pool.activeConnections = 1;

      cm.cleanup();

      // After cleanup, invalid connections are removed and valid ones were closed and cleared
      expect(pool.idleConnections).not.toContain(invalidConn);
      expect(pool.activeConnections).toBe(0);
    });
  });
});

/**
 * Tests for Connection Pool
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ConnectionPool } from '../src/connection-pool.js';

describe('ConnectionPool', () => {
  let pool: ConnectionPool;

  afterEach(async () => {
    if (pool) {
      await pool.close();
    }
  });

  describe('initialization', () => {
    it('should create pool with default options', () => {
      pool = new ConnectionPool({
        apiEndpoint: 'https://api.test.com/v1',
        apiKey: 'test-key',
      });

      const stats = pool.getStats();
      expect(stats.minConnections).toBe(1);
      expect(stats.maxConnections).toBe(10);
      expect(stats.total).toBeGreaterThanOrEqual(1);
    });

    it('should create pool with custom options', () => {
      pool = new ConnectionPool({
        apiEndpoint: 'https://api.test.com/v1',
        apiKey: 'test-key',
        minConnections: 3,
        maxConnections: 20,
      });

      const stats = pool.getStats();
      expect(stats.minConnections).toBe(3);
      expect(stats.maxConnections).toBe(20);
      expect(stats.total).toBeGreaterThanOrEqual(3);
    });

    it('should initialize minimum connections', () => {
      pool = new ConnectionPool({
        apiEndpoint: 'https://api.test.com/v1',
        apiKey: 'test-key',
        minConnections: 5,
      });

      const stats = pool.getStats();
      expect(stats.total).toBe(5);
      expect(stats.idle).toBe(5);
      expect(stats.active).toBe(0);
    });
  });

  describe('acquire and release', () => {
    beforeEach(() => {
      pool = new ConnectionPool({
        apiEndpoint: 'https://api.test.com/v1',
        apiKey: 'test-key',
        minConnections: 2,
        maxConnections: 5,
      });
    });

    it('should acquire a connection', async () => {
      const conn = await pool.acquire();
      expect(conn).toBeDefined();
      expect(conn.id).toBeDefined();
      expect(conn.instance).toBeDefined();

      const stats = pool.getStats();
      expect(stats.active).toBe(1);
      expect(stats.idle).toBe(1);
    });

    it('should release a connection', async () => {
      const conn = await pool.acquire();
      const connId = conn.id;

      pool.release(connId);

      const stats = pool.getStats();
      expect(stats.active).toBe(0);
      expect(stats.idle).toBe(2);
    });

    it('should reuse released connections', async () => {
      const conn1 = await pool.acquire();
      const conn1Id = conn1.id;
      pool.release(conn1Id);

      const conn2 = await pool.acquire();
      expect(conn2.id).toBe(conn1Id);
    });

    it('should create new connections up to max', async () => {
      const conns = [];
      for (let i = 0; i < 5; i++) {
        conns.push(await pool.acquire());
      }

      const stats = pool.getStats();
      expect(stats.total).toBe(5);
      expect(stats.active).toBe(5);
      expect(stats.idle).toBe(0);

      // Clean up
      conns.forEach(c => pool.release(c.id));
    });

    it('should wait for connection when pool is exhausted', async () => {
      // Acquire all connections
      const conns = [];
      for (let i = 0; i < 5; i++) {
        conns.push(await pool.acquire());
      }

      // Try to acquire another - should timeout
      const acquirePromise = pool.acquire();

      // Release one connection after a delay
      setTimeout(() => {
        pool.release(conns[0].id);
      }, 100);

      const conn = await acquirePromise;
      expect(conn).toBeDefined();

      // Clean up
      conns.slice(1).forEach(c => pool.release(c.id));
      pool.release(conn.id);
    }, 10000);
  });

  describe('statistics', () => {
    beforeEach(() => {
      pool = new ConnectionPool({
        apiEndpoint: 'https://api.test.com/v1',
        apiKey: 'test-key',
        minConnections: 2,
        maxConnections: 10,
      });
    });

    it('should track total connections', async () => {
      const stats1 = pool.getStats();
      expect(stats1.total).toBe(2);

      await pool.acquire();
      await pool.acquire();
      await pool.acquire();

      const stats2 = pool.getStats();
      expect(stats2.total).toBe(3);
    });

    it('should track active and idle connections', async () => {
      const conn1 = await pool.acquire();
      const conn2 = await pool.acquire();

      const stats1 = pool.getStats();
      expect(stats1.active).toBe(2);
      expect(stats1.idle).toBe(0);

      pool.release(conn1.id);

      const stats2 = pool.getStats();
      expect(stats2.active).toBe(1);
      expect(stats2.idle).toBe(1);

      pool.release(conn2.id);
    });
  });

  describe('health checks', () => {
    it('should remove idle connections after timeout', async () => {
      pool = new ConnectionPool({
        apiEndpoint: 'https://api.test.com/v1',
        apiKey: 'test-key',
        minConnections: 2,
        maxConnections: 10,
        idleTimeout: 500, // 500ms
        healthCheckInterval: 200, // Check every 200ms
      });

      // Create extra connections
      const conn1 = await pool.acquire();
      const conn2 = await pool.acquire();
      const conn3 = await pool.acquire();

      pool.release(conn1.id);
      pool.release(conn2.id);
      pool.release(conn3.id);

      const stats1 = pool.getStats();
      expect(stats1.total).toBe(3);

      // Wait for health check to remove idle connections
      await new Promise(resolve => setTimeout(resolve, 1000));

      const stats2 = pool.getStats();
      // Should keep minimum connections
      expect(stats2.total).toBe(2);
    }, 10000);
  });

  describe('close', () => {
    it('should close all connections', async () => {
      pool = new ConnectionPool({
        apiEndpoint: 'https://api.test.com/v1',
        apiKey: 'test-key',
        minConnections: 3,
      });

      const stats1 = pool.getStats();
      expect(stats1.total).toBe(3);

      await pool.close();

      const stats2 = pool.getStats();
      expect(stats2.total).toBe(0);
    });

    it('should prevent acquiring connections after close', async () => {
      pool = new ConnectionPool({
        apiEndpoint: 'https://api.test.com/v1',
        apiKey: 'test-key',
      });

      await pool.close();

      await expect(pool.acquire()).rejects.toThrow('Connection pool is closed');
    });
  });
});

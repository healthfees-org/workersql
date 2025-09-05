import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConnectionManager } from '../../src/services/ConnectionManager';

describe('ConnectionManager', () => {
  let cm: ConnectionManager;

  beforeEach(() => {
    cm = new ConnectionManager(1000, 5); // 1 second TTL, max 5 connections per shard
  });

  afterEach(() => {
    cm.destroy();
  });

  describe('Session Management', () => {
    it('binds and retrieves sessions', () => {
      cm.bindSession('sess1', 'tenantA', 'shard_1');
      const s = cm.getSession('sess1');
      expect(s?.tenantId).toBe('tenantA');
      expect(s?.shardId).toBe('shard_1');
      expect(s?.isInTransaction).toBe(false);
      expect(s?.connectionState).toBe('active');
      expect(cm.getShardConnections('shard_1')).toBe(1);
    });

    it('binds session with transaction', () => {
      cm.bindSession('sess1', 'tenantA', 'shard_1', 'tx_123');
      const s = cm.getSession('sess1');
      expect(s?.transactionId).toBe('tx_123');
      expect(s?.isInTransaction).toBe(true);
    });

    it('updates existing session when binding again', () => {
      cm.bindSession('sess1', 'tenantA', 'shard_1');
      cm.bindSession('sess1', 'tenantA', 'shard_1', 'tx_123');
      const s = cm.getSession('sess1');
      expect(s?.transactionId).toBe('tx_123');
      expect(s?.isInTransaction).toBe(true);
      expect(cm.getShardConnections('shard_1')).toBe(1); // Should not increment
    });

    it('releases sessions and decrements counts', () => {
      cm.bindSession('sess1', 'tenantA', 'shard_1');
      cm.releaseSession('sess1');
      expect(cm.getSession('sess1')).toBeUndefined();
      expect(cm.getShardConnections('shard_1')).toBe(0);
    });

    it('does not release session if in transaction', () => {
      cm.bindSession('sess1', 'tenantA', 'shard_1', 'tx_123');
      cm.releaseSession('sess1');
      expect(cm.getSession('sess1')).toBeDefined();
      expect(cm.getSession('sess1')?.connectionState).toBe('idle');
    });
  });

  describe('Transaction Management', () => {
    it('starts transaction successfully', () => {
      cm.bindSession('sess1', 'tenantA', 'shard_1');
      const success = cm.startTransaction('sess1', 'tx_123');
      expect(success).toBe(true);
      const s = cm.getSession('sess1');
      expect(s?.transactionId).toBe('tx_123');
      expect(s?.isInTransaction).toBe(true);
      expect(s?.connectionState).toBe('active');
    });

    it('fails to start transaction for non-existent session', () => {
      const success = cm.startTransaction('nonexistent', 'tx_123');
      expect(success).toBe(false);
    });

    it('ends transaction successfully', () => {
      cm.bindSession('sess1', 'tenantA', 'shard_1', 'tx_123');
      const success = cm.endTransaction('sess1');
      expect(success).toBe(true);
      const s = cm.getSession('sess1');
      expect(s?.transactionId).toBeUndefined();
      expect(s?.isInTransaction).toBe(false);
      expect(s?.connectionState).toBe('idle');
    });

    it('fails to end transaction for non-existent session', () => {
      const success = cm.endTransaction('nonexistent');
      expect(success).toBe(false);
    });

    it('fails to end transaction if not in transaction', () => {
      cm.bindSession('sess1', 'tenantA', 'shard_1');
      const success = cm.endTransaction('sess1');
      expect(success).toBe(false);
    });
  });

  describe('Connection Pooling', () => {
    it('initializes connection pool for new shard', () => {
      cm.bindSession('sess1', 'tenantA', 'shard_1');
      const stats = cm.getPoolStats('shard_1');
      expect(stats).toEqual({
        active: 0,
        idle: 0,
        waiting: 0,
        max: 5,
      });
    });

    it('returns null for non-existent shard pool', () => {
      const stats = cm.getPoolStats('nonexistent');
      expect(stats).toBeNull();
    });

    it('tracks active sessions', () => {
      cm.bindSession('sess1', 'tenantA', 'shard_1');
      cm.bindSession('sess2', 'tenantA', 'shard_1');
      const active = cm.getActiveSessions();
      expect(active).toHaveLength(2);
      expect(active.every((s) => s.connectionState === 'active')).toBe(true);
    });

    it('tracks transaction sessions', () => {
      cm.bindSession('sess1', 'tenantA', 'shard_1', 'tx_123');
      cm.bindSession('sess2', 'tenantA', 'shard_1');
      const txSessions = cm.getTransactionSessions();
      expect(txSessions).toHaveLength(1);
      expect(txSessions[0].transactionId).toBe('tx_123');
    });
  });

  describe('Cleanup', () => {
    it('cleans up stale sessions', async () => {
      cm.bindSession('s1', 't', 'shard_2');
      await new Promise((r) => setTimeout(r, 1100)); // Wait longer than 1 second TTL
      cm.cleanup();
      expect(cm.getSession('s1')).toBeUndefined();
      expect(cm.getShardConnections('shard_2')).toBe(0);
    });

    it('does not cleanup sessions in transaction', async () => {
      cm.bindSession('s1', 't', 'shard_2', 'tx_123');
      await new Promise((r) => setTimeout(r, 15));
      cm.cleanup();
      expect(cm.getSession('s1')).toBeDefined();
    });

    it('handles constructor with custom TTL', () => {
      const customCm = new ConnectionManager(5000, 10);
      expect(customCm).toBeDefined();
      customCm.destroy();
    });

    it('updates lastSeen when getting session', async () => {
      cm.bindSession('sess1', 'tenantA', 'shard_1');
      const initialInfo = cm.getSession('sess1');
      const initialLastSeen = initialInfo?.lastSeen;

      // Wait a bit and get session again
      await new Promise((resolve) => setTimeout(resolve, 1));
      const updatedInfo = cm.getSession('sess1');
      expect(updatedInfo?.lastSeen).toBeGreaterThan(initialLastSeen || 0);
    });

    it('handles session cleanup with exact TTL', async () => {
      const fastCm = new ConnectionManager(50); // 50ms TTL
      fastCm.bindSession('sess1', 'tenantA', 'shard_1');

      // Wait exactly the TTL time
      await new Promise((r) => setTimeout(r, 60));

      fastCm.cleanup();
      expect(fastCm.getSession('sess1')).toBeUndefined();
      expect(fastCm.getShardConnections('shard_1')).toBe(0);
      fastCm.destroy();
    });
  });
});

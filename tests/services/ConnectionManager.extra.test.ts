import { describe, it, expect } from 'vitest';
import { ConnectionManager } from '@/services/ConnectionManager';

describe('ConnectionManager (extras)', () => {
  it('getShardConnections returns 0 for unknown shard', () => {
    const cm = new ConnectionManager(1000);
    expect(cm.getShardConnections('does_not_exist')).toBe(0);
  });

  it('releaseSession on unknown id is a no-op', () => {
    const cm = new ConnectionManager(1000);
    cm.bindSession('s1', 't', 'shard_1');
    expect(cm.getShardConnections('shard_1')).toBe(1);
    cm.releaseSession('unknown');
    expect(cm.getShardConnections('shard_1')).toBe(1);
  });

  it('getSession for unknown id returns undefined', () => {
    const cm = new ConnectionManager(1000);
    expect(cm.getSession('none')).toBeUndefined();
  });

  it('handles multiple sessions on same shard', () => {
    const cm = new ConnectionManager(1000);
    cm.bindSession('s1', 't', 'shard_1');
    cm.bindSession('s2', 't', 'shard_1');
    expect(cm.getShardConnections('shard_1')).toBe(2);
    cm.releaseSession('s1');
    expect(cm.getShardConnections('shard_1')).toBe(1);
    cm.releaseSession('s2');
    expect(cm.getShardConnections('shard_1')).toBe(0);
  });

  it('getSession updates lastSeen timestamp for existing session', () => {
    const cm = new ConnectionManager(1000);
    const beforeTime = Date.now();

    // Bind session
    cm.bindSession('s1', 't', 'shard_1');

    // Call getSession and verify it returns a session with updated lastSeen
    const retrieved = cm.getSession('s1');
    expect(retrieved).toBeDefined();
    expect(retrieved?.lastSeen).toBeGreaterThanOrEqual(beforeTime);
    expect(retrieved?.tenantId).toBe('t');
    expect(retrieved?.shardId).toBe('shard_1');
  });

  it('cleanup removes stale sessions and decrements connection counts', async () => {
    const cm = new ConnectionManager(10); // Very short TTL
    cm.bindSession('s1', 't', 'shard_1');
    cm.bindSession('s2', 't', 'shard_2');

    expect(cm.getShardConnections('shard_1')).toBe(1);
    expect(cm.getShardConnections('shard_2')).toBe(1);

    // Wait for sessions to become stale
    await new Promise((r) => setTimeout(r, 20));
    cm.cleanup();
    expect(cm.getSession('s1')).toBeUndefined();
    expect(cm.getSession('s2')).toBeUndefined();
    expect(cm.getShardConnections('shard_1')).toBe(0);
    expect(cm.getShardConnections('shard_2')).toBe(0);
  });
});

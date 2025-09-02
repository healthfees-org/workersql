import { describe, it, expect } from '@jest/globals';
import { ConnectionManager } from '../../src/services/ConnectionManager';

describe('ConnectionManager', () => {
  it('binds and retrieves sessions', () => {
    const cm = new ConnectionManager(1000);
    cm.bindSession('sess1', 'tenantA', 'shard_1');
    const s = cm.getSession('sess1');
    expect(s?.tenantId).toBe('tenantA');
    expect(s?.shardId).toBe('shard_1');
    expect(cm.getShardConnections('shard_1')).toBe(1);
  });

  it('releases sessions and decrements counts', () => {
    const cm = new ConnectionManager(1000);
    cm.bindSession('sess1', 'tenantA', 'shard_1');
    cm.releaseSession('sess1');
    expect(cm.getSession('sess1')).toBeUndefined();
    expect(cm.getShardConnections('shard_1')).toBe(0);
  });

  it('cleans up stale sessions', async () => {
    const cm = new ConnectionManager(10);
    cm.bindSession('s1', 't', 'shard_2');
    await new Promise((r) => setTimeout(r, 15));
    cm.cleanup();
    expect(cm.getSession('s1')).toBeUndefined();
    expect(cm.getShardConnections('shard_2')).toBe(0);
  });

  it('handles constructor with custom TTL', () => {
    const cm = new ConnectionManager(5000);
    expect(cm).toBeDefined();
  });

  it('updates lastSeen when getting session', async () => {
    const cm = new ConnectionManager(1000);
    cm.bindSession('sess1', 'tenantA', 'shard_1');
    const initialInfo = cm.getSession('sess1');
    const initialLastSeen = initialInfo?.lastSeen;

    // Wait a bit and get session again
    await new Promise((resolve) => setTimeout(resolve, 1));
    const updatedInfo = cm.getSession('sess1');
    expect(updatedInfo?.lastSeen).toBeGreaterThan(initialLastSeen || 0);
  });

  it('handles session cleanup with exact TTL', async () => {
    const cm = new ConnectionManager(50); // 50ms TTL
    cm.bindSession('sess1', 'tenantA', 'shard_1');

    // Wait exactly the TTL time
    await new Promise((r) => setTimeout(r, 60));

    cm.cleanup();
    expect(cm.getSession('sess1')).toBeUndefined();
    expect(cm.getShardConnections('shard_1')).toBe(0);
  });
});

import { describe, it, expect } from '@jest/globals';
import { ConnectionManager } from '../../src/services/ConnectionManager';

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
});

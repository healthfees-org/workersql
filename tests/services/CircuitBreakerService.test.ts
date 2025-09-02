import { describe, it, expect } from '@jest/globals';
import { CircuitBreakerService } from '../../src/services/CircuitBreakerService';

describe('CircuitBreakerService', () => {
  it('executes successfully when closed', async () => {
    const cb = new CircuitBreakerService({ failureThreshold: 2, windowMs: 1000, cooldownMs: 200 });
    const res = await cb.execute('shard_1', async () => 'ok');
    expect(res).toBe('ok');
    expect(cb.getState('shard_1')).toBe('closed');
  });

  it('opens after failures and blocks until cooldown', async () => {
    const cb = new CircuitBreakerService({ failureThreshold: 2, windowMs: 1000, cooldownMs: 100 });
    const failing = async () => {
      throw new Error('boom');
    };
    await expect(cb.execute('shard_x', failing)).rejects.toThrow('boom');
    await expect(cb.execute('shard_x', failing)).rejects.toThrow('boom');
    // Now circuit should be open
    expect(cb.getState('shard_x')).toBe('open');
    await expect(cb.execute('shard_x', async () => 'ok')).rejects.toThrow(/Circuit open/);

    // Wait for cooldown and then a success should close it
    await new Promise((r) => setTimeout(r, 120));
    const out = await cb.execute('shard_x', async () => 'ok');
    expect(out).toBe('ok');
    expect(cb.getState('shard_x')).toBe('closed');
  });

  it('re-opens on failure in half-open', async () => {
    const cb = new CircuitBreakerService({ failureThreshold: 1, windowMs: 1000, cooldownMs: 50 });
    // trip it open
    await expect(
      cb.execute('shard_z', async () => {
        throw new Error('fail');
      })
    ).rejects.toThrow('fail');
    expect(cb.getState('shard_z')).toBe('open');

    await new Promise((r) => setTimeout(r, 60));
    // half-open trial fails -> open again
    await expect(
      cb.execute('shard_z', async () => {
        throw new Error('fail2');
      })
    ).rejects.toThrow('fail2');
    expect(cb.getState('shard_z')).toBe('open');
  });
});

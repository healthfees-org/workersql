import { describe, it, expect } from '@jest/globals';
import { CircuitBreakerService } from '../../src/services/CircuitBreakerService';

describe('CircuitBreakerService (extras)', () => {
  it('isOpen returns false when closed and toggles true when open', async () => {
    const cb = new CircuitBreakerService({
      failureThreshold: 1,
      windowMs: 1000,
      cooldownMs: 100000,
    });
    expect(cb.isOpen('k')).toBe(false);
    await expect(
      cb.execute('k', async () => {
        throw new Error('x');
      })
    ).rejects.toThrow('x');
    expect(cb.getState('k')).toBe('open');
    expect(cb.isOpen('k')).toBe(true);
  });

  it('half-open allows success and closes', async () => {
    const cb = new CircuitBreakerService({ failureThreshold: 1, windowMs: 1000, cooldownMs: 50 });
    // open it
    await expect(
      cb.execute('half', async () => {
        throw new Error('fail');
      })
    ).rejects.toThrow();
    expect(cb.getState('half')).toBe('open');
    // wait for cooldown, then success triggers close
    await new Promise((r) => setTimeout(r, 60));
    const res = await cb.execute('half', async () => 'ok');
    expect(res).toBe('ok');
    expect(cb.getState('half')).toBe('closed');
  });
});

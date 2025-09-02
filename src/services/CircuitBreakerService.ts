/*
 * CircuitBreakerService
 * Simple per-shard circuit breaker with sliding window failure tracking.
 */
export type BreakerState = 'closed' | 'open' | 'half_open';

interface BreakerStats {
  state: BreakerState;
  failures: number[]; // timestamps (ms) of failures
  lastOpenedAt?: number;
}

export interface CircuitBreakerOptions {
  failureThreshold: number; // number of failures in window to open breaker
  windowMs: number; // sliding window duration
  cooldownMs: number; // time to remain open before trying half-open
  halfOpenMaxAttempts: number; // number of trial calls in half-open
}

const DEFAULT_OPTS: CircuitBreakerOptions = {
  failureThreshold: 5,
  windowMs: 30_000,
  cooldownMs: 15_000,
  halfOpenMaxAttempts: 1,
};

export class CircuitBreakerService {
  private breakers = new Map<string, BreakerStats>();
  private opts: CircuitBreakerOptions;

  constructor(opts?: Partial<CircuitBreakerOptions>) {
    this.opts = { ...DEFAULT_OPTS, ...(opts || {}) };
  }

  getState(key: string): BreakerState {
    return this.ensure(key).state;
  }

  isOpen(key: string): boolean {
    const b = this.ensure(key);
    if (b.state === 'open') {
      if (b.lastOpenedAt && Date.now() - b.lastOpenedAt > this.opts.cooldownMs) {
        // Move to half-open after cooldown
        b.state = 'half_open';
        b.failures = [];
        return false;
      }
      return true;
    }
    return false;
  }

  async execute<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const b = this.ensure(key);

    if (this.isOpen(key)) {
      throw new Error(`Circuit open for ${key}`);
    }

    try {
      const res = await fn();
      // On success in half-open, close breaker
      if (b.state === 'half_open') {
        b.state = 'closed';
        b.failures = [];
      }
      return res;
    } catch (err) {
      this.recordFailure(key);
      throw err;
    }
  }

  private recordFailure(key: string): void {
    const b = this.ensure(key);
    const now = Date.now();
    // Evict old failures outside window
    b.failures = b.failures.filter((t) => now - t <= this.opts.windowMs);
    b.failures.push(now);

    if (b.state === 'half_open') {
      // Any failure in half-open re-opens the circuit
      b.state = 'open';
      b.lastOpenedAt = now;
      return;
    }

    if (b.failures.length >= this.opts.failureThreshold) {
      b.state = 'open';
      b.lastOpenedAt = now;
    }
  }

  private ensure(key: string): BreakerStats {
    let b = this.breakers.get(key);
    if (!b) {
      b = { state: 'closed', failures: [] };
      this.breakers.set(key, b);
    }
    return b;
  }
}

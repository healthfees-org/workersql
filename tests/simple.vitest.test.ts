import { describe, it, expect } from 'vitest';

describe('Basic Vitest Test', () => {
  it('should work with basic assertions', () => {
    expect(1 + 1).toBe(2);
    expect('hello').toBe('hello');
    expect(true).toBe(true);
  });

  it('should work with async tests', async () => {
    const result = await Promise.resolve(42);
    expect(result).toBe(42);
  });
});

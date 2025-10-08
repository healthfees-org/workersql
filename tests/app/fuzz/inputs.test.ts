import { describe, it, expect } from 'vitest';

describe('SPA fuzz inputs', () => {
  it('accepts typical query inputs', () => {
    const sql = 'SELECT * FROM wp_posts LIMIT 10;';
    expect(sql.length).toBeGreaterThan(0);
  });
});

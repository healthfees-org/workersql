import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

describe('Auth and Backup endpoints', () => {
  it('GET /auth/me unauthenticated returns authenticated: false', async () => {
    const res = await SELF.fetch('http://localhost:8787//auth/me');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { authenticated: boolean };
    expect(body.authenticated).toBe(false);
  });

  it('POST /admin/backup/r2 requires admin', async () => {
    const res = await SELF.fetch('http://localhost:8787//admin/backup/r2', { method: 'POST' });
    expect([401, 403]).toContain(res.status);
  });
});

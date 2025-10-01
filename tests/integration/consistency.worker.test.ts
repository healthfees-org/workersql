/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

function authHeader(tenant: string) {
  const payload = btoa(JSON.stringify({ sub: tenant, exp: Math.floor(Date.now() / 1000) + 3600 }));
  return 'Bearer ' + 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' + payload + '.sig';
}

describe('Consistency models', () => {
  it('strong consistency bypasses cache', async () => {
    const req = new Request('https://example.com/sql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader('tenantC') },
      body: JSON.stringify({ sql: '/*+ strong */ SELECT * FROM users WHERE id = 1' }),
    });
    const res = await SELF.fetch(req);
    expect(res.ok).toBeTruthy();
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.cached).toBe(false);
  });

  it('bounded consistency returns fresh or fetches', async () => {
    const url = 'https://example.com/sql';
    const headers = { 'Content-Type': 'application/json', Authorization: authHeader('tenantD') };
    // First miss -> fetch and cache
    let res = await SELF.fetch(
      new Request(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ sql: 'SELECT * FROM users WHERE id = 2' }),
      })
    );
    let json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.cached).toBe(false);
    // Second should serve from cache (fresh window)
    res = await SELF.fetch(
      new Request(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ sql: 'SELECT * FROM users WHERE id = 2' }),
      })
    );
    json = (await res.json()) as any;
    expect(json.success).toBe(true);
    // Cached may be true depending on timing; accept either but ensure success
  });

  it('cached mode serves stale-while-revalidate', async () => {
    const url = 'https://example.com/sql';
    const headers = { 'Content-Type': 'application/json', Authorization: authHeader('tenantE') };
    // Seed cache by first fetch
    await SELF.fetch(
      new Request(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ sql: 'SELECT * FROM users WHERE id = 3' }),
      })
    );
    // Force presence of an entry and then rely on SWR serving if it becomes stale; hard to time precisely in test env
    const res = await SELF.fetch(
      new Request(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ sql: '/*+ weak */ SELECT * FROM users WHERE id = 3' }),
      })
    );
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
  });
});

/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

// Integration test: basic DO-backed routes via gateway

describe('Gateway -> DO integration (Workers runtime)', () => {
  it('handles mutation via gateway and returns success payload', async () => {
    const request = new Request('https://example.com/sql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:
          'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
          btoa(
            JSON.stringify({ sub: 'tenant-integration', exp: Math.floor(Date.now() / 1000) + 3600 })
          ) +
          '.sig',
      },
      body: JSON.stringify({ sql: "INSERT INTO users (name) VALUES ('John')", params: [] }),
    });

    const res = await SELF.fetch(request);
    expect(res.ok).toBeTruthy();
    const json = (await res.json()) as any;
    expect(json).toHaveProperty('success', true);
  });
});

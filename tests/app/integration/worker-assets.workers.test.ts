import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

// This test runs in the Workers runtime via @cloudflare/vitest-pool-workers (workers project)
// It asserts that the worker serves index.html from assets, and that a referenced asset is retrievable

describe('Worker serves SPA assets', () => {
  it('GET / returns index.html with CSP headers', async () => {
    const res = await SELF.fetch('http://localhost:8787//');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/<html/i);
    // Security headers should be present
    expect(
      res.headers.get('content-security-policy') || res.headers.get('Content-Security-Policy')
    ).toBeTruthy();
  });

  it('fetches a referenced asset under /assets', async () => {
    const index = await (await SELF.fetch('http://localhost:8787//')).text();
    const match = index.match(/<script[^>]+src="(\/assets\/[^"]+)"/);
    if (!match) {
      // If index does not reference assets (unlikely), skip
      expect(match).not.toBeNull();
      return;
    }
    const assetUrl = 'http://localhost:8787/' + match[1];
    const assetRes = await SELF.fetch(assetUrl);
    expect(assetRes.status).toBe(200);
    const ctype = assetRes.headers.get('content-type') || '';
    expect(ctype).toMatch(/(javascript|text|css|application)\//);
  });
});

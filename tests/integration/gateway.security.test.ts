import { describe, it, expect } from 'vitest';
import GatewayModule from '@/gateway';

const mkEnv = () =>
  ({
    APP_CACHE: { get: async () => null, put: async () => {} } as unknown as KVNamespace,
    DB_EVENTS: { send: async () => {} } as unknown as Queue,
    SHARD: {
      idFromName: () => ({ toString: () => 'id' }),
      get: () => ({ fetch: async () => new Response(JSON.stringify({ success: true, data: {} })) }),
    } as unknown as DurableObjectNamespace,
    PORTABLE_DB: {} as D1Database,
    ENVIRONMENT: 'test',
    LOG_LEVEL: 'info',
    MAX_SHARD_SIZE_GB: '10',
    CACHE_TTL_MS: '30000',
    CACHE_SWR_MS: '120000',
    ENFORCE_HTTPS: 'true',
  }) as unknown as import('@/types').CloudflareEnvironment;

describe('Gateway network security', () => {
  it('blocks non-HTTPS when ENFORCE_HTTPS=true', async () => {
    const env = mkEnv();
    const url = 'http://example.com/sql';
    const res = await GatewayModule.fetch(
      new Request(url, { method: 'POST', body: JSON.stringify({ sql: 'SELECT 1' }) }),
      env,
      { waitUntil() {} } as any
    );
    expect(res.status).toBe(400);
  });

  it('blocks disallowed country', async () => {
    const env = mkEnv();
    (env as any).ALLOW_COUNTRIES = 'US';
    const req = new Request('https://example.com/sql', {
      method: 'POST',
      body: JSON.stringify({ sql: 'SELECT 1' }),
    });
    (req as any).cf = { country: 'CA' };
    const res = await GatewayModule.fetch(req, env, { waitUntil() {} } as any);
    expect(res.status).toBe(451);
  });

  it('blocks blocked IP', async () => {
    const env = mkEnv();
    (env as any).BLOCK_IPS = '1.2.3.4';
    const req = new Request('https://example.com/sql', {
      method: 'POST',
      body: JSON.stringify({ sql: 'SELECT 1' }),
    });
    const headers = new Headers(req.headers);
    headers.set('CF-Connecting-IP', '1.2.3.4');
    const res = await GatewayModule.fetch(new Request(req, { headers }), env, {
      waitUntil() {},
    } as any);
    expect(res.status).toBe(403);
  });
});

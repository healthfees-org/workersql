import { describe, it, expect } from 'vitest';
import { EdgeSQLGateway } from '../../../src/gateway';

describe('HTML security headers', () => {
  it('generates CSP for HTML', () => {
    const gw = new EdgeSQLGateway(
      {
        APP_CACHE: {
          get: async () => null,
          put: async () => void 0,
          list: async () => ({ keys: [] }),
        } as any,
        DB_EVENTS: { send: async () => void 0 } as any,
        SHARD: { idFromName: () => ({}) as any, get: () => ({}) as any } as any,
        PORTABLE_DB: {} as any,
        ENVIRONMENT: 'test',
        LOG_LEVEL: 'debug',
        MAX_SHARD_SIZE_GB: '1',
        CACHE_TTL_MS: '1000',
        CACHE_SWR_MS: '2000',
      } as any,
      {
        waitUntil: (promise: Promise<unknown>) => {
          // Mock waitUntil - just await the promise
          void promise;
        },
      } as any
    );
    const headers = gw.getHtmlSecurityHeaders();
    expect(headers['Content-Security-Policy']).toContain("default-src 'self'");
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
  });
});

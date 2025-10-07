import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ComplianceService } from '@/services/ComplianceService';

const mkEnv = () =>
  ({
    APP_CACHE: {} as KVNamespace,
    DB_EVENTS: {} as Queue,
    SHARD: {} as DurableObjectNamespace,
    PORTABLE_DB: {} as D1Database,
    ENVIRONMENT: 'test',
    LOG_LEVEL: 'info',
    MAX_SHARD_SIZE_GB: '10',
    CACHE_TTL_MS: '30000',
    CACHE_SWR_MS: '120000',
    CLOUDFLARE_ACCOUNT_ID: 'acct',
    CLOUDFLARE_API_TOKEN: 'token',
  }) as unknown as import('@/types').CloudflareEnvironment;

describe('ComplianceService', () => {
  const origFetch = globalThis.fetch;
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = origFetch as any;
    vi.restoreAllMocks();
  });

  it('generates summary with numeric totals', async () => {
    const env = mkEnv();
    const svc = new ComplianceService(env);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ events: 5, success: 4, failure: 1, denied: 0 }] }),
    } as any);

    const since = Date.now() - 3600_000;
    const until = Date.now();
    const summary = await svc.generateSummary({ tenantId: 't1', since, until });
    expect(summary.tenantId).toBe('t1');
    expect(summary.totals.events).toBe(5);
    expect(summary.totals.success).toBe(4);
    expect(summary.totals.failure).toBe(1);
    expect(summary.totals.denied).toBe(0);
  });

  it('handles empty/failed queries gracefully', async () => {
    const env = mkEnv();
    const svc = new ComplianceService(env);
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false } as any);
    const since = Date.now() - 3600_000;
    const until = Date.now();
    const summary = await svc.generateSummary({ tenantId: 't2', since, until });
    expect(summary.totals.events).toBe(0);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { AuditLoggingService } from '@/services/AuditLoggingService';
import type { CloudflareEnvironment } from '@/types';

const mkEnv = (overrides: Partial<CloudflareEnvironment> = {}): CloudflareEnvironment =>
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
    DATA_ENCRYPTION_ENABLED: 'true',
    JWT_SECRET: 's',
    ...overrides,
  }) as CloudflareEnvironment;

describe('AuditLoggingService R2 encrypted persistence', () => {
  it('persists encrypted buffer to R2', async () => {
    const put = vi.fn(async () => {});
    const list = vi.fn(async () => ({ objects: [] }));
    const bucket = { put, list } as unknown as R2Bucket;
    const env = mkEnv({ AUDIT_LOGS_BUCKET: bucket });
    const svc = new AuditLoggingService(env);
    // force flush by exceeding buffer size threshold
    // reduce internal buffer size via casting for test determinism
    (svc as any).bufferSize = 1;
    await svc['logEvent'](
      { tenantId: 't', permissions: [], tokenHash: '', userId: 'u' },
      'test',
      'res',
      'POST',
      'success'
    );
    expect(put).toHaveBeenCalled();
    const args = put.mock.calls[0] as unknown[];
    expect(String(args[0])).toContain('.enc');
  });
});

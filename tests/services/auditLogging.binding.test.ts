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
    ...overrides,
  }) as CloudflareEnvironment;

describe('AuditLoggingService with Analytics Engine binding', () => {
  it('uses writeDataPoint when binding is present', async () => {
    const write = vi.fn();
    const env = mkEnv({
      AUDIT_LOGS: { writeDataPoint: write } as unknown as AnalyticsEngineDataset,
    });
    const svc = new AuditLoggingService(env);
    await svc.logDatabaseOperation(
      { tenantId: 't', permissions: [], tokenHash: '', userId: 'u' },
      'SELECT',
      'users',
      'success'
    );
    expect(write).toHaveBeenCalled();
  });
});

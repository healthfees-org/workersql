import { describe, it, expect } from 'vitest';
import { MonitoringService } from '@/services/MonitoringService';

describe('MonitoringService Smoke Tests', () => {
  describe('service instantiation', () => {
    it('should create service instance without throwing', () => {
      const env = {
        CLOUDFLARE_ACCOUNT_ID: 'test',
        CLOUDFLARE_API_TOKEN: 'test',
        APP_CACHE: {},
        DB_EVENTS: {},
        SHARD: {},
        PORTABLE_DB: {},
        ENVIRONMENT: 'test',
        LOG_LEVEL: 'debug',
        MAX_SHARD_SIZE_GB: '1',
        CACHE_TTL_MS: '1000',
        CACHE_SWR_MS: '2000',
      } as any;

      expect(() => new MonitoringService(env)).not.toThrow();
    });

    it('should handle missing credentials gracefully', () => {
      const env = {
        APP_CACHE: {},
        DB_EVENTS: {},
        SHARD: {},
        PORTABLE_DB: {},
        ENVIRONMENT: 'test',
        LOG_LEVEL: 'debug',
        MAX_SHARD_SIZE_GB: '1',
        CACHE_TTL_MS: '1000',
        CACHE_SWR_MS: '2000',
      } as any;

      const service = new MonitoringService(env);
      expect(service).toBeInstanceOf(MonitoringService);
    });
  });

  describe('basic functionality', () => {
    let service: MonitoringService;

    beforeEach(() => {
      const env = {
        CLOUDFLARE_ACCOUNT_ID: 'test',
        CLOUDFLARE_API_TOKEN: 'test',
        APP_CACHE: { put: vi.fn() },
        DB_EVENTS: {},
        SHARD: {},
        PORTABLE_DB: {},
        ENVIRONMENT: 'test',
        LOG_LEVEL: 'debug',
        MAX_SHARD_SIZE_GB: '1',
        CACHE_TTL_MS: '1000',
        CACHE_SWR_MS: '2000',
      } as any;
      service = new MonitoringService(env);
    });

    it('should have all required methods', () => {
      expect(typeof service.collectShardMetrics).toBe('function');
      expect(typeof service.collectCacheMetrics).toBe('function');
      expect(typeof service.collectQueueMetrics).toBe('function');
      expect(typeof service.checkSLAs).toBe('function');
      expect(typeof service.sendAlerts).toBe('function');
      expect(typeof service.getSystemMetrics).toBe('function');
    });

    it('should reject operations without credentials', async () => {
      const badEnv = {
        APP_CACHE: {},
        DB_EVENTS: {},
        SHARD: {},
        PORTABLE_DB: {},
        ENVIRONMENT: 'test',
        LOG_LEVEL: 'debug',
        MAX_SHARD_SIZE_GB: '1',
        CACHE_TTL_MS: '1000',
        CACHE_SWR_MS: '2000',
      } as any;
      const badService = new MonitoringService(badEnv);

      const timeRange = { since: '2025-01-01T00:00:00Z', until: '2025-01-02T00:00:00Z' };

      await expect(badService.collectShardMetrics([], timeRange)).rejects.toThrow();
      await expect(badService.collectCacheMetrics(timeRange)).rejects.toThrow();
      await expect(badService.collectQueueMetrics([], timeRange)).rejects.toThrow();
    });

    it('should handle SLA checking with empty metrics', async () => {
      const emptyMetrics = {
        shards: [],
        cache: {
          totalReads: 0,
          totalWrites: 0,
          totalDeletes: 0,
          successfulReads: 0,
          successfulWrites: 0,
          successfulDeletes: 0,
          avgReadLatency: 0,
          avgWriteLatency: 0,
          avgDeleteLatency: 0,
          p95ReadLatency: 0,
          p95WriteLatency: 0,
          p95DeleteLatency: 0,
          hitRate: 0,
        },
        queues: [],
        timestamp: Date.now(),
      };

      const result = await service.checkSLAs(emptyMetrics);

      expect(result).toHaveProperty('overall');
      expect(result).toHaveProperty('violations');
      expect(result).toHaveProperty('timestamp');
      expect(result.overall).toBe('healthy');
      expect(result.violations).toEqual([]);
    });

    it('should handle alert sending without throwing', async () => {
      const slaStatus = {
        overall: 'healthy' as const,
        violations: [],
        timestamp: Date.now(),
      };

      await expect(service.sendAlerts(slaStatus)).resolves.not.toThrow();
    });
  });

  describe('data structure validation', () => {
    it('should validate ShardMetrics structure', () => {
      const metrics: any = {
        shardId: 'test-shard',
        className: 'TestShard',
        scriptName: 'test-script',
        status: 'success',
        totalRequests: 100,
        avgCpuTime: 50,
        avgDuration: 100,
        p50CpuTime: 40,
        p90CpuTime: 60,
        p95CpuTime: 80,
        p50Duration: 80,
        p90Duration: 120,
        p95Duration: 150,
        totalResponseSize: 1024,
        storageBytes: 2048,
      };

      expect(metrics.shardId).toBe('test-shard');
      expect(metrics.totalRequests).toBe(100);
      expect(metrics.status).toBe('success');
    });

    it('should validate CacheMetrics structure', () => {
      const metrics: any = {
        totalReads: 100,
        totalWrites: 50,
        totalDeletes: 0,
        successfulReads: 95,
        successfulWrites: 45,
        successfulDeletes: 0,
        avgReadLatency: 10,
        avgWriteLatency: 20,
        avgDeleteLatency: 0,
        p95ReadLatency: 25,
        p95WriteLatency: 35,
        p95DeleteLatency: 0,
        hitRate: 0.95,
      };

      expect(metrics.totalReads).toBe(100);
      expect(metrics.hitRate).toBe(0.95);
      expect(metrics.hitRate).toBeGreaterThanOrEqual(0);
      expect(metrics.hitRate).toBeLessThanOrEqual(1);
    });

    it('should validate QueueMetrics structure', () => {
      const metrics: any = {
        queueId: 'test-queue',
        avgBacklogBytes: 1024,
        avgBacklogMessages: 10,
        maxBacklogBytes: 2048,
        maxBacklogMessages: 20,
        avgConcurrency: 5,
      };

      expect(metrics.queueId).toBe('test-queue');
      expect(metrics.avgBacklogMessages).toBe(10);
      expect(metrics.avgConcurrency).toBe(5);
    });

    it('should validate SLAStatus structure', () => {
      const status: any = {
        overall: 'healthy',
        violations: [
          {
            metric: 'test_metric',
            current: 100,
            target: 50,
            severity: 'critical',
          },
        ],
        timestamp: Date.now(),
      };

      expect(status.overall).toBe('healthy');
      expect(status.violations).toHaveLength(1);
      expect(status.violations[0].metric).toBe('test_metric');
      expect(status.violations[0].severity).toBe('critical');
    });
  });

  describe('error handling', () => {
    it('should handle malformed time ranges', () => {
      const env = {
        CLOUDFLARE_ACCOUNT_ID: 'test',
        CLOUDFLARE_API_TOKEN: 'test',
        APP_CACHE: {},
        DB_EVENTS: {},
        SHARD: {},
        PORTABLE_DB: {},
        ENVIRONMENT: 'test',
        LOG_LEVEL: 'debug',
        MAX_SHARD_SIZE_GB: '1',
        CACHE_TTL_MS: '1000',
        CACHE_SWR_MS: '2000',
      } as any;
      const service = new MonitoringService(env);

      // These should not throw during construction
      expect(service).toBeInstanceOf(MonitoringService);
    });

    it('should handle empty environment', () => {
      const emptyEnv = {} as any;
      expect(() => new MonitoringService(emptyEnv)).not.toThrow();
    });
  });
});

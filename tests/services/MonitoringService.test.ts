import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { MonitoringService } from '@/services/MonitoringService';

// Mock fetch globally
global.fetch = vi.fn();

describe('MonitoringService', () => {
  let monitoringService: MonitoringService;
  let mockEnv: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockEnv = {
      CLOUDFLARE_ACCOUNT_ID: 'test-account-id',
      CLOUDFLARE_API_TOKEN: 'test-api-token',
      APP_CACHE: {
        put: vi.fn(),
      },
      DB_EVENTS: {},
      SHARD: {},
      PORTABLE_DB: {},
      RATE_LIMITER: {},
      VECTORIZE_INDEX: {},
      AI: {},
      R2_BUCKET: {},
      HYPERDRIVE: {},
    };

    monitoringService = new MonitoringService(mockEnv);
  });

  describe('constructor', () => {
    it('should initialize with account ID and API token from env', () => {
      expect((monitoringService as any).accountId).toBe('test-account-id');
      expect((monitoringService as any).apiToken).toBe('test-api-token');
    });

    it('should handle missing environment variables', () => {
      const emptyEnv = {
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
      const service = new MonitoringService(emptyEnv);
      expect((service as any).accountId).toBeUndefined();
      expect((service as any).apiToken).toBeUndefined();
    });
  });

  describe('collectShardMetrics', () => {
    const timeRange = { since: '2025-01-01T00:00:00Z', until: '2025-01-02T00:00:00Z' };

    it('should throw error when account credentials are missing', async () => {
      const emptyEnv = {
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
      const service = new MonitoringService(emptyEnv);
      await expect(service.collectShardMetrics([], timeRange)).rejects.toThrow(
        'Cloudflare account ID and API token required for shard metrics'
      );
    });

    it('should collect shard metrics successfully', async () => {
      const mockResponse = {
        data: {
          viewer: {
            accounts: [
              {
                durableObjectsInvocationsAdaptiveGroups: [
                  {
                    dimensions: {
                      scriptName: 'test-script',
                      durableObjectClass: 'TestShard',
                      durableObjectId: 'shard-1',
                      status: 'success',
                    },
                    sum: { requests: 100, responseBodySize: 1024 },
                    avg: { cpuTime: 50, duration: 100 },
                    quantiles: {
                      cpuTimeP50: 40,
                      cpuTimeP90: 60,
                      cpuTimeP99: 80,
                      durationP50: 80,
                      durationP90: 120,
                      durationP99: 150,
                    },
                  },
                ],
                durableObjectsStorageGroups: [
                  {
                    dimensions: {
                      scriptName: 'test-script',
                      durableObjectClass: 'TestShard',
                      durableObjectId: 'shard-1',
                    },
                    max: { storedBytes: 2048 },
                  },
                ],
              },
            ],
          },
        },
      };

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await monitoringService.collectShardMetrics([], timeRange);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        shardId: 'shard-1',
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
      });
    });

    it('should filter shards by provided IDs', async () => {
      const mockResponse = {
        data: {
          viewer: {
            accounts: [
              {
                durableObjectsInvocationsAdaptiveGroups: [
                  {
                    dimensions: {
                      scriptName: 'test-script',
                      durableObjectClass: 'TestShard',
                      durableObjectId: 'shard-1',
                      status: 'success',
                    },
                    sum: { requests: 100, responseBodySize: 1024 },
                    avg: { cpuTime: 50, duration: 100 },
                    quantiles: {
                      cpuTimeP50: 40,
                      cpuTimeP90: 60,
                      cpuTimeP99: 80,
                      durationP50: 80,
                      durationP90: 120,
                      durationP99: 150,
                    },
                  },
                  {
                    dimensions: {
                      scriptName: 'test-script',
                      durableObjectClass: 'TestShard',
                      durableObjectId: 'shard-2',
                      status: 'success',
                    },
                    sum: { requests: 50, responseBodySize: 512 },
                    avg: { cpuTime: 25, duration: 50 },
                    quantiles: {
                      cpuTimeP50: 20,
                      cpuTimeP90: 30,
                      cpuTimeP99: 40,
                      durationP50: 40,
                      durationP90: 60,
                      durationP99: 75,
                    },
                  },
                ],
              },
            ],
          },
        },
      };

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await monitoringService.collectShardMetrics(['shard-1'], timeRange);

      expect(result).toHaveLength(1);
      expect(result[0]?.shardId).toBe('shard-1');
    });

    it('should handle GraphQL errors', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      });

      await expect(monitoringService.collectShardMetrics([], timeRange)).rejects.toThrow(
        'GraphQL query failed: 400 Bad Request'
      );
    });
  });

  describe('collectCacheMetrics', () => {
    const timeRange = { since: '2025-01-01T00:00:00Z', until: '2025-01-02T00:00:00Z' };

    it('should throw error when account credentials are missing', async () => {
      const emptyEnv = {
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
      const service = new MonitoringService(emptyEnv);
      await expect(service.collectCacheMetrics(timeRange)).rejects.toThrow(
        'Cloudflare account ID and API token required for cache metrics'
      );
    });

    it('should collect cache metrics successfully', async () => {
      const mockResponse = {
        data: {
          viewer: {
            accounts: [
              {
                kvOperationsAdaptiveGroups: [
                  {
                    dimensions: { operation: 'read', status: 'success', namespaceId: 'ns1' },
                    sum: { requests: 100 },
                    avg: { duration: 10 },
                    quantiles: { durationP50: 8, durationP90: 15, durationP99: 20 },
                  },
                  {
                    dimensions: { operation: 'write', status: 'success', namespaceId: 'ns1' },
                    sum: { requests: 50 },
                    avg: { duration: 20 },
                    quantiles: { durationP50: 15, durationP90: 25, durationP99: 30 },
                  },
                ],
              },
            ],
          },
        },
      };

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await monitoringService.collectCacheMetrics(timeRange);

      expect(result).toEqual({
        totalReads: 100,
        totalWrites: 50,
        totalDeletes: 0,
        successfulReads: 100,
        successfulWrites: 50,
        successfulDeletes: 0,
        avgReadLatency: 10,
        avgWriteLatency: 20,
        avgDeleteLatency: 0,
        p95ReadLatency: 20,
        p95WriteLatency: 30,
        p95DeleteLatency: 0,
        hitRate: 1,
      });
    });
  });

  describe('collectQueueMetrics', () => {
    const timeRange = { since: '2025-01-01T00:00:00Z', until: '2025-01-02T00:00:00Z' };

    it('should throw error when account credentials are missing', async () => {
      const emptyEnv = {
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
      const service = new MonitoringService(emptyEnv);
      await expect(service.collectQueueMetrics([], timeRange)).rejects.toThrow(
        'Cloudflare account ID and API token required for queue metrics'
      );
    });

    it('should collect queue metrics successfully', async () => {
      const mockResponse = {
        data: {
          viewer: {
            accounts: [
              {
                queuesBacklogAdaptiveGroups: [
                  {
                    dimensions: { queueID: 'queue-1' },
                    avg: { bytes: 1024, messages: 10 },
                    max: { bytes: 2048, messages: 20 },
                  },
                ],
                queueConsumerMetricsAdaptiveGroups: [
                  {
                    dimensions: { queueID: 'queue-1' },
                    avg: { concurrency: 5 },
                  },
                ],
              },
            ],
          },
        },
      };

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await monitoringService.collectQueueMetrics([], timeRange);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        queueId: 'queue-1',
        avgBacklogBytes: 1024,
        avgBacklogMessages: 10,
        maxBacklogBytes: 2048,
        maxBacklogMessages: 20,
        avgConcurrency: 5,
      });
    });
  });

  describe('checkSLAs', () => {
    it('should return healthy status when all metrics are within limits', async () => {
      const metrics: any = {
        shards: [
          {
            shardId: 'shard-1',
            className: 'Test',
            scriptName: 'test',
            status: 'success',
            totalRequests: 100,
            avgCpuTime: 50,
            avgDuration: 50,
            p50CpuTime: 40,
            p90CpuTime: 60,
            p95CpuTime: 80,
            p50Duration: 40,
            p90Duration: 60,
            p95Duration: 50,
            totalResponseSize: 1024,
          },
        ],
        cache: {
          totalReads: 100,
          totalWrites: 50,
          totalDeletes: 0,
          successfulReads: 98,
          successfulWrites: 50,
          successfulDeletes: 0,
          avgReadLatency: 10,
          avgWriteLatency: 20,
          avgDeleteLatency: 0,
          p95ReadLatency: 20,
          p95WriteLatency: 30,
          p95DeleteLatency: 0,
          hitRate: 0.98,
        },
        queues: [
          {
            queueId: 'queue-1',
            avgBacklogBytes: 1024,
            avgBacklogMessages: 500,
            maxBacklogBytes: 2048,
            maxBacklogMessages: 1000,
            avgConcurrency: 5,
          },
        ],
        timestamp: Date.now(),
      };

      const result = await monitoringService.checkSLAs(metrics);

      expect(result.overall).toBe('healthy');
      expect(result.violations).toHaveLength(0);
    });

    it('should detect cache hit rate violations', async () => {
      const metrics: any = {
        shards: [],
        cache: {
          totalReads: 100,
          totalWrites: 50,
          totalDeletes: 0,
          successfulReads: 85,
          successfulWrites: 50,
          successfulDeletes: 0,
          avgReadLatency: 10,
          avgWriteLatency: 20,
          avgDeleteLatency: 0,
          p95ReadLatency: 20,
          p95WriteLatency: 30,
          p95DeleteLatency: 0,
          hitRate: 0.85,
        },
        queues: [],
        timestamp: Date.now(),
      };

      const result = await monitoringService.checkSLAs(metrics);

      expect(result.overall).toBe('warning');
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]?.metric).toBe('cache_hit_rate');
    });

    it('should detect queue backlog violations', async () => {
      const metrics: any = {
        shards: [],
        cache: {
          totalReads: 100,
          totalWrites: 50,
          totalDeletes: 0,
          successfulReads: 95,
          successfulWrites: 50,
          successfulDeletes: 0,
          avgReadLatency: 10,
          avgWriteLatency: 20,
          avgDeleteLatency: 0,
          p95ReadLatency: 20,
          p95WriteLatency: 30,
          p95DeleteLatency: 0,
          hitRate: 0.95,
        },
        queues: [
          {
            queueId: 'queue-1',
            avgBacklogBytes: 1024,
            avgBacklogMessages: 1500,
            maxBacklogBytes: 2048,
            maxBacklogMessages: 2000,
            avgConcurrency: 5,
          },
        ],
        timestamp: Date.now(),
      };

      const result = await monitoringService.checkSLAs(metrics);

      expect(result.overall).toBe('critical');
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]?.metric).toBe('queue_backlog_queue-1');
    });

    it('should detect shard latency violations', async () => {
      const metrics: any = {
        shards: [
          {
            shardId: 'shard-1',
            className: 'Test',
            scriptName: 'test',
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
          },
        ],
        cache: {
          totalReads: 100,
          totalWrites: 50,
          totalDeletes: 0,
          successfulReads: 95,
          successfulWrites: 50,
          successfulDeletes: 0,
          avgReadLatency: 10,
          avgWriteLatency: 20,
          avgDeleteLatency: 0,
          p95ReadLatency: 20,
          p95WriteLatency: 30,
          p95DeleteLatency: 0,
          hitRate: 0.95,
        },
        queues: [],
        timestamp: Date.now(),
      };

      const result = await monitoringService.checkSLAs(metrics);

      expect(result.overall).toBe('warning');
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]?.metric).toBe('shard_latency_shard-1');
    });
  });

  describe('sendAlerts', () => {
    it('should not send alerts when no violations exist', async () => {
      const slaStatus = {
        overall: 'healthy' as const,
        violations: [],
        timestamp: Date.now(),
      };

      await monitoringService.sendAlerts(slaStatus);

      expect(mockEnv.APP_CACHE.put).not.toHaveBeenCalled();
    });

    it('should store alert history in cache when violations exist', async () => {
      const slaStatus = {
        overall: 'critical' as const,
        violations: [{ metric: 'test', current: 100, target: 50, severity: 'critical' as const }],
        timestamp: Date.now(),
      };

      await monitoringService.sendAlerts(slaStatus);

      expect(mockEnv.APP_CACHE.put).toHaveBeenCalledWith(
        expect.stringMatching(/^alerts:\d+$/),
        JSON.stringify(slaStatus),
        { expirationTtl: 60 * 60 * 24 * 7 }
      );
    });
  });

  describe('getSystemMetrics', () => {
    it('should collect all system metrics', async () => {
      // Mock all the individual metric collection methods
      const mockShardMetrics = [
        {
          shardId: 'shard-1',
          className: 'TestShard',
          scriptName: 'test',
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
        },
      ];
      const mockCacheMetrics = {
        totalReads: 100,
        totalWrites: 50,
        totalDeletes: 0,
        successfulReads: 100,
        successfulWrites: 50,
        successfulDeletes: 0,
        avgReadLatency: 10,
        avgWriteLatency: 20,
        avgDeleteLatency: 0,
        p95ReadLatency: 20,
        p95WriteLatency: 30,
        p95DeleteLatency: 0,
        hitRate: 1,
      };
      const mockQueueMetrics = [
        {
          queueId: 'queue-1',
          avgBacklogBytes: 1024,
          avgBacklogMessages: 10,
          maxBacklogBytes: 2048,
          maxBacklogMessages: 20,
          avgConcurrency: 5,
        },
      ];

      vi.spyOn(monitoringService, 'collectShardMetrics').mockResolvedValue(mockShardMetrics);
      vi.spyOn(monitoringService, 'collectCacheMetrics').mockResolvedValue(mockCacheMetrics);
      vi.spyOn(monitoringService, 'collectQueueMetrics').mockResolvedValue(mockQueueMetrics);

      const result = await monitoringService.getSystemMetrics({
        since: '2025-01-01T00:00:00Z',
        until: '2025-01-02T00:00:00Z',
      });

      expect(result.shards).toEqual(mockShardMetrics);
      expect(result.cache).toEqual(mockCacheMetrics);
      expect(result.queues).toEqual(mockQueueMetrics);
      expect(typeof result.timestamp).toBe('number');
    });
  });

  describe('private methods', () => {
    describe('queryGraphQL', () => {
      it('should make successful GraphQL request', async () => {
        const mockResponse = { data: { test: 'data' } };
        (global.fetch as Mock).mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        });

        const result = await (monitoringService as any).queryGraphQL('query { test }', {});

        expect(result).toEqual(mockResponse);
        expect(global.fetch).toHaveBeenCalledWith('https://api.cloudflare.com/client/v4/graphql', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer test-api-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: 'query { test }', variables: {} }),
        });
      });

      it('should handle GraphQL request failures', async () => {
        (global.fetch as Mock).mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        });

        await expect((monitoringService as any).queryGraphQL('query { test }', {})).rejects.toThrow(
          'GraphQL query failed: 500 Internal Server Error'
        );
      });
    });

    describe('processShardMetrics', () => {
      it('should process empty data gracefully', () => {
        const result = (monitoringService as any).processShardMetrics({}, []);
        expect(result).toEqual([]);
      });

      it('should process invocation metrics without storage metrics', () => {
        const data = {
          durableObjectsInvocationsAdaptiveGroups: [
            {
              dimensions: {
                scriptName: 'test-script',
                durableObjectClass: 'TestShard',
                durableObjectId: 'shard-1',
                status: 'success',
              },
              sum: { requests: 100, responseBodySize: 1024 },
              avg: { cpuTime: 50, duration: 100 },
              quantiles: {
                cpuTimeP50: 40,
                cpuTimeP90: 60,
                cpuTimeP99: 80,
                durationP50: 80,
                durationP90: 120,
                durationP99: 150,
              },
            },
          ],
        };

        const result = (monitoringService as any).processShardMetrics(data, []);

        expect(result).toHaveLength(1);
        expect(result[0].storageBytes).toBeUndefined();
      });
    });

    describe('processCacheMetrics', () => {
      it('should process empty data gracefully', () => {
        const result = (monitoringService as any).processCacheMetrics({});
        expect(result).toEqual({
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
        });
      });

      it('should calculate hit rate correctly', () => {
        const data = {
          kvOperationsAdaptiveGroups: [
            {
              dimensions: { operation: 'read', status: 'success', namespaceId: 'ns1' },
              sum: { requests: 80 },
              avg: { duration: 10 },
              quantiles: { durationP50: 8, durationP90: 15, durationP99: 20 },
            },
            {
              dimensions: { operation: 'read', status: 'error', namespaceId: 'ns1' },
              sum: { requests: 20 },
              avg: { duration: 5 },
              quantiles: { durationP50: 4, durationP90: 7, durationP99: 10 },
            },
          ],
        };

        const result = (monitoringService as any).processCacheMetrics(data);

        expect(result.totalReads).toBe(100);
        expect(result.successfulReads).toBe(80);
        expect(result.hitRate).toBe(0.8);
      });
    });

    describe('processQueueMetrics', () => {
      it('should process empty data gracefully', () => {
        const result = (monitoringService as any).processQueueMetrics({}, []);
        expect(result).toEqual([]);
      });

      it('should filter queues by ID', () => {
        const data = {
          queuesBacklogAdaptiveGroups: [
            {
              dimensions: { queueID: 'queue-1' },
              avg: { bytes: 1024, messages: 10 },
              max: { bytes: 2048, messages: 20 },
            },
            {
              dimensions: { queueID: 'queue-2' },
              avg: { bytes: 512, messages: 5 },
              max: { bytes: 1024, messages: 10 },
            },
          ],
          queueConsumerMetricsAdaptiveGroups: [
            { dimensions: { queueID: 'queue-1' }, avg: { concurrency: 5 } },
          ],
        };

        const result = (monitoringService as any).processQueueMetrics(data, ['queue-1']);

        expect(result).toHaveLength(1);
        expect(result[0].queueId).toBe('queue-1');
      });
    });
  });
});

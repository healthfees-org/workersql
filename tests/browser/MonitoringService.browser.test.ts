import { test, expect } from '@playwright/test';
import { MonitoringService } from '@/services/MonitoringService';

// Mock browser-compatible fetch
const mockFetch = (response: any) => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(response),
  });
};

test.describe('MonitoringService Browser Tests', () => {
  let monitoringService: MonitoringService;
  let mockEnv: any;

  test.beforeEach(() => {
    mockEnv = {
      CLOUDFLARE_ACCOUNT_ID: 'test-account-id',
      CLOUDFLARE_API_TOKEN: 'test-api-token',
      APP_CACHE: {
        put: vi.fn(),
        get: vi.fn(),
      },
      DB_EVENTS: {},
      SHARD: {},
      PORTABLE_DB: {},
      ENVIRONMENT: 'test',
      LOG_LEVEL: 'debug',
      MAX_SHARD_SIZE_GB: '1',
      CACHE_TTL_MS: '1000',
      CACHE_SWR_MS: '2000',
    };

    monitoringService = new MonitoringService(mockEnv);
  });

  test('should initialize MonitoringService in browser environment', () => {
    expect(monitoringService).toBeDefined();
    expect(typeof monitoringService.collectCacheMetrics).toBe('function');
    expect(typeof monitoringService.collectShardMetrics).toBe('function');
    expect(typeof monitoringService.collectQueueMetrics).toBe('function');
    expect(typeof monitoringService.checkSLAs).toBe('function');
    expect(typeof monitoringService.sendAlerts).toBe('function');
    expect(typeof monitoringService.getSystemMetrics).toBe('function');
  });

  test('should collect cache metrics with browser-compatible fetch', async () => {
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
              ],
            },
          ],
        },
      },
    };

    mockFetch(mockResponse);

    const timeRange = { since: '2025-01-01T00:00:00Z', until: '2025-01-02T00:00:00Z' };
    const metrics = await monitoringService.collectCacheMetrics(timeRange);

    expect(metrics).toBeDefined();
    expect(metrics.totalReads).toBeGreaterThan(0);
    expect(typeof metrics.hitRate).toBe('number');
    expect(metrics.hitRate).toBeGreaterThanOrEqual(0);
    expect(metrics.hitRate).toBeLessThanOrEqual(1);
  });

  test('should collect shard metrics in browser environment', async () => {
    const mockResponse = {
      data: {
        viewer: {
          accounts: [
            {
              durableObjectsInvocationsAdaptiveGroups: [
                {
                  dimensions: {
                    scriptName: 'test-script',
                    durableObjectClass: 'TableShard',
                    durableObjectId: 'shard-1',
                  },
                  sum: { requests: 50 },
                  avg: { duration: 25 },
                  quantiles: { durationP50: 20, durationP90: 40, durationP99: 60 },
                },
              ],
              durableObjectsStorageGroups: [
                {
                  dimensions: { durableObjectId: 'shard-1' },
                  max: { storageBytes: 1000000 },
                },
              ],
            },
          ],
        },
      },
    };

    mockFetch(mockResponse);

    const timeRange = { since: '2025-01-01T00:00:00Z', until: '2025-01-02T00:00:00Z' };
    const metrics = await monitoringService.collectShardMetrics(['shard-1'], timeRange);

    expect(metrics).toBeDefined();
    expect(Array.isArray(metrics)).toBe(true);
    expect(metrics.length).toBeGreaterThan(0);
    expect(metrics[0]).toHaveProperty('shardId');
    expect(metrics[0]).toHaveProperty('totalRequests');
    expect(metrics[0]).toHaveProperty('avgDuration');
  });

  test('should collect queue metrics in browser environment', async () => {
    const mockResponse = {
      data: {
        viewer: {
          accounts: [
            {
              queuesBacklogAdaptiveGroups: [
                {
                  dimensions: { queueId: 'queue-1' },
                  max: { backlogMessages: 10 },
                },
              ],
              queueConsumerMetricsAdaptiveGroups: [
                {
                  dimensions: { queueId: 'queue-1' },
                  sum: { messagesProcessed: 100 },
                  avg: { processingDuration: 5 },
                },
              ],
            },
          ],
        },
      },
    };

    mockFetch(mockResponse);

    const timeRange = { since: '2025-01-01T00:00:00Z', until: '2025-01-02T00:00:00Z' };
    const metrics = await monitoringService.collectQueueMetrics(['queue-1'], timeRange);

    expect(metrics).toBeDefined();
    expect(Array.isArray(metrics)).toBe(true);
    expect(metrics.length).toBeGreaterThan(0);
    expect(metrics[0]).toHaveProperty('queueId');
    expect(metrics[0]).toHaveProperty('avgBacklogMessages');
    expect(metrics[0]).toHaveProperty('messagesProcessed');
  });

  test('should check SLAs and return valid status in browser', async () => {
    const systemMetrics = {
      shards: [
        {
          shardId: 'shard-1',
          className: 'TableShard',
          scriptName: 'worker-script',
          status: 'success',
          totalRequests: 100,
          avgCpuTime: 10,
          avgDuration: 25,
          p50CpuTime: 8,
          p90CpuTime: 15,
          p95CpuTime: 20,
          p50Duration: 20,
          p90Duration: 40,
          p95Duration: 50,
          totalResponseSize: 10000,
          storageBytes: 500000,
        },
      ],
      cache: {
        totalReads: 1000,
        totalWrites: 500,
        totalDeletes: 10,
        successfulReads: 950,
        successfulWrites: 480,
        successfulDeletes: 10,
        avgReadLatency: 15,
        avgWriteLatency: 25,
        avgDeleteLatency: 5,
        p95ReadLatency: 40,
        p95WriteLatency: 60,
        p95DeleteLatency: 15,
        hitRate: 0.95,
      },
      queues: [
        {
          queueId: 'queue-1',
          avgBacklogBytes: 1000,
          avgBacklogMessages: 5,
          maxBacklogBytes: 2000,
          maxBacklogMessages: 10,
          avgConcurrency: 2,
        },
      ],
      timestamp: Date.now(),
    };

    const slaStatus = await monitoringService.checkSLAs(systemMetrics);

    expect(slaStatus).toBeDefined();
    expect(slaStatus).toHaveProperty('overall');
    expect(['healthy', 'warning', 'critical']).toContain(slaStatus.overall);
    expect(slaStatus).toHaveProperty('violations');
    expect(Array.isArray(slaStatus.violations)).toBe(true);
    expect(slaStatus).toHaveProperty('timestamp');
  });

  test('should send alerts in browser environment', async () => {
    const slaStatus = {
      overall: 'warning' as const,
      violations: [
        {
          metric: 'shard_latency',
          current: 150,
          target: 100,
          severity: 'warning' as const,
        },
      ],
      timestamp: Date.now(),
    };

    // Mock successful alert sending
    mockFetch({ success: true });

    await expect(monitoringService.sendAlerts(slaStatus)).resolves.not.toThrow();
  });

  test('should get system metrics in browser environment', async () => {
    const mockResponse = {
      data: {
        viewer: {
          accounts: [
            {
              kvOperationsAdaptiveGroups: [
                {
                  dimensions: { operation: 'read', status: 'success' },
                  sum: { requests: 100 },
                  avg: { duration: 10 },
                },
              ],
              durableObjectsInvocationsAdaptiveGroups: [
                {
                  dimensions: { durableObjectId: 'shard-1' },
                  sum: { requests: 50 },
                  avg: { duration: 25 },
                },
              ],
              queuesBacklogAdaptiveGroups: [
                {
                  dimensions: { queueId: 'queue-1' },
                  max: { backlogMessages: 5 },
                },
              ],
            },
          ],
        },
      },
    };

    mockFetch(mockResponse);

    const timeRange = { since: '2025-01-01T00:00:00Z', until: '2025-01-02T00:00:00Z' };
    const metrics = await monitoringService.getSystemMetrics(timeRange);

    expect(metrics).toBeDefined();
    expect(metrics).toHaveProperty('shards');
    expect(metrics).toHaveProperty('cache');
    expect(metrics).toHaveProperty('queues');
    expect(metrics).toHaveProperty('timestamp');
    expect(Array.isArray(metrics.shards)).toBe(true);
    expect(typeof metrics.cache).toBe('object');
    expect(Array.isArray(metrics.queues)).toBe(true);
  });

  test('should handle network errors gracefully in browser', async () => {
    // Mock network failure
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const timeRange = { since: '2025-01-01T00:00:00Z', until: '2025-01-02T00:00:00Z' };

    await expect(monitoringService.collectCacheMetrics(timeRange)).rejects.toThrow('Network error');
  });

  test('should handle API errors gracefully in browser', async () => {
    // Mock API error response
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({ error: 'API Error' }),
    });

    const timeRange = { since: '2025-01-01T00:00:00Z', until: '2025-01-02T00:00:00Z' };

    await expect(monitoringService.collectCacheMetrics(timeRange)).rejects.toThrow();
  });

  test('should handle malformed API responses in browser', async () => {
    // Mock malformed response
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ invalid: 'response' }),
    });

    const timeRange = { since: '2025-01-01T00:00:00Z', until: '2025-01-02T00:00:00Z' };

    const metrics = await monitoringService.collectCacheMetrics(timeRange);

    // Should return default/empty metrics for malformed responses
    expect(metrics).toBeDefined();
    expect(metrics.totalReads).toBe(0);
  });

  test('should work with browser storage APIs', async () => {
    // Test that the service can work with browser-like storage
    const mockStorage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };

    // Simulate browser localStorage
    Object.defineProperty(window, 'localStorage', {
      value: mockStorage,
      writable: true,
    });

    // Service should still work normally
    const timeRange = { since: '2025-01-01T00:00:00Z', until: '2025-01-02T00:00:00Z' };
    mockFetch({
      data: {
        viewer: {
          accounts: [
            {
              kvOperationsAdaptiveGroups: [],
            },
          ],
        },
      },
    });

    const metrics = await monitoringService.collectCacheMetrics(timeRange);
    expect(metrics).toBeDefined();
  });

  test('should handle browser timeout scenarios', async () => {
    // Mock slow response that might timeout in browser
    global.fetch = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                ok: true,
                json: () =>
                  Promise.resolve({
                    data: {
                      viewer: {
                        accounts: [
                          {
                            kvOperationsAdaptiveGroups: [
                              {
                                dimensions: { operation: 'read' },
                                sum: { requests: 1 },
                              },
                            ],
                          },
                        ],
                      },
                    },
                  }),
              }),
            100
          ); // Short delay to simulate network latency
        })
    );

    const timeRange = { since: '2025-01-01T00:00:00Z', until: '2025-01-02T00:00:00Z' };
    const metrics = await monitoringService.collectCacheMetrics(timeRange);

    expect(metrics).toBeDefined();
    expect(metrics.totalReads).toBeGreaterThan(0);
  });
});

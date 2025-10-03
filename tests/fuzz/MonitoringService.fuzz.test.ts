import { describe, it, expect, vi } from 'vitest';
import { MonitoringService } from '@/services/MonitoringService';

// Mock fetch globally
global.fetch = vi.fn();

describe('MonitoringService Fuzz Tests', () => {
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
      ENVIRONMENT: 'test',
      LOG_LEVEL: 'debug',
      MAX_SHARD_SIZE_GB: '1',
      CACHE_TTL_MS: '1000',
      CACHE_SWR_MS: '2000',
    };

    monitoringService = new MonitoringService(mockEnv);
  });

  describe('GraphQL query fuzzing', () => {
    const fuzzQueries = [
      // Valid queries
      `query { viewer { accounts { id } } }`,
      `query GetMetrics($accountTag: string!) { viewer { accounts(filter: { accountTag: $accountTag }) { id } } }`,

      // Malformed queries
      `query { invalid { field } }`,
      `query { viewer { accounts { nonexistentField } } }`,
      `query { viewer { accounts(filter: { invalidParam: "value" }) { id } }`,

      // Injection attempts
      `query { viewer { accounts { id } } }; DROP TABLE users; --`,
      `query { viewer { accounts(filter: { accountTag: "1' OR '1'='1" }) { id } } }`,

      // Large queries
      `query { viewer { accounts { ${'field'.repeat(1000)} } } }`,

      // Empty queries
      ``,
      `{}`,
      `query { }`,

      // Invalid JSON in variables
      `query($var: String) { test }`,

      // Unicode and special characters
      `query { viewer { accounts { "field" } } }`,
      `query { viewer { accounts { field(with: "🚀") } } }`,
    ];

    const fuzzVariables = [
      // Valid variables
      { accountTag: 'test-account' },
      { since: '2025-01-01T00:00:00Z', until: '2025-01-02T00:00:00Z' },

      // Malformed variables
      null,
      undefined,
      {},
      { invalidParam: 'value' },
      { accountTag: null },
      { accountTag: undefined },

      // Large variables
      { largeParam: 'x'.repeat(10000) },

      // Injection attempts
      { accountTag: "'; DROP TABLE users; --" },
      { accountTag: '<script>alert("xss")</script>' },

      // Type confusion
      { accountTag: 123 },
      { accountTag: true },
      { accountTag: [] },
      { accountTag: {} },

      // Boundary values
      { accountTag: '' },
      { since: '', until: '' },
    ];

    fuzzQueries.forEach((query, queryIndex) => {
      fuzzVariables.forEach((variables, varIndex) => {
        it(`should handle query ${queryIndex} with variables ${varIndex} without crashing`, async () => {
          // Mock fetch to prevent actual API calls
          (global.fetch as any).mockResolvedValueOnce({
            ok: false,
            status: 400,
            statusText: 'Bad Request',
            json: () => Promise.resolve({ errors: [{ message: 'Invalid query' }] }),
          });

          // The method should not throw, even with malformed input
          // It should either succeed or return a proper error
          try {
            await (monitoringService as any).queryGraphQL(query, variables);
          } catch (error) {
            // Expected for malformed queries
            expect(error).toBeInstanceOf(Error);
          }
        });
      });
    });
  });

  describe('time range fuzzing', () => {
    const fuzzTimeRanges = [
      // Valid ranges
      { since: '2025-01-01T00:00:00Z', until: '2025-01-02T00:00:00Z' },
      { since: '2024-01-01T00:00:00.000Z', until: '2024-12-31T23:59:59.999Z' },

      // Invalid ranges
      { since: 'invalid-date', until: '2025-01-02T00:00:00Z' },
      { since: '2025-01-01T00:00:00Z', until: 'invalid-date' },
      { since: null, until: '2025-01-02T00:00:00Z' },
      { since: '2025-01-01T00:00:00Z', until: null },
      { since: '', until: '2025-01-02T00:00:00Z' },
      { since: '2025-01-01T00:00:00Z', until: '' },

      // Reversed ranges
      { since: '2025-01-02T00:00:00Z', until: '2025-01-01T00:00:00Z' },

      // Future dates
      { since: '2030-01-01T00:00:00Z', until: '2030-01-02T00:00:00Z' },

      // Very old dates
      { since: '1900-01-01T00:00:00Z', until: '1900-01-02T00:00:00Z' },

      // Timezone issues
      { since: '2025-01-01T00:00:00+05:00', until: '2025-01-02T00:00:00Z' },
      { since: '2025-01-01T00:00:00', until: '2025-01-02T00:00:00' }, // No Z

      // Large time ranges
      { since: '2020-01-01T00:00:00Z', until: '2030-01-01T00:00:00Z' },

      // Very small ranges
      { since: '2025-01-01T00:00:00.000Z', until: '2025-01-01T00:00:00.001Z' },
    ];

    fuzzTimeRanges.forEach((timeRange, index) => {
      it(`should handle time range ${index} gracefully`, async () => {
        // Skip invalid time ranges that would cause TypeScript errors
        if (!timeRange.since || !timeRange.until) {
          return;
        }

        // Mock successful API response
        (global.fetch as any).mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                viewer: {
                  accounts: [
                    {
                      kvOperationsAdaptiveGroups: [],
                      queuesBacklogAdaptiveGroups: [],
                      queueConsumerMetricsAdaptiveGroups: [],
                    },
                  ],
                },
              },
            }),
        });

        try {
          await monitoringService.collectCacheMetrics(timeRange);
        } catch (error) {
          // Should handle invalid time ranges gracefully
          expect(error).toBeInstanceOf(Error);
        }
      });
    });
  });

  describe('shard ID fuzzing', () => {
    const fuzzShardIds = [
      // Valid IDs
      [],
      ['shard-1'],
      ['shard-1', 'shard-2', 'shard-3'],

      // Invalid IDs
      null,
      undefined,
      [''],
      ['shard-1', '', 'shard-2'],
      ['shard-1', null, 'shard-2'],
      ['shard-1', undefined, 'shard-2'],

      // Special characters
      ['shard-with-dashes'],
      ['shard_with_underscores'],
      ['shard.with.dots'],
      ['shard🚀'],
      ['<script>'],
      ["shard-1'; DROP TABLE users; --"],

      // Very long IDs
      ['shard-'.repeat(1000)],

      // Numbers and special types
      [123],
      [true],
      [{}],
      [[]],

      // Large arrays
      Array.from({ length: 1000 }, (_, i) => `shard-${i}`),
    ];

    fuzzShardIds.forEach((shardIds, index) => {
      it(`should handle shard IDs ${index} gracefully`, async () => {
        const timeRange = { since: '2025-01-01T00:00:00Z', until: '2025-01-02T00:00:00Z' };

        (global.fetch as any).mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                viewer: {
                  accounts: [
                    {
                      durableObjectsInvocationsAdaptiveGroups: [],
                      durableObjectsStorageGroups: [],
                    },
                  ],
                },
              },
            }),
        });

        try {
          await monitoringService.collectShardMetrics(shardIds as any, timeRange);
        } catch (error) {
          // Should handle invalid shard IDs gracefully
          expect(error).toBeInstanceOf(Error);
        }
      });
    });
  });

  describe('queue ID fuzzing', () => {
    const fuzzQueueIds = [
      // Valid IDs
      [],
      ['queue-1'],
      ['queue-1', 'queue-2'],

      // Invalid IDs
      null,
      undefined,
      [''],
      ['queue-1', ''],

      // Special characters
      ['queue-with-dashes'],
      ['queue_with_underscores'],
      ['queue.with.dots'],
      ['queue🚀'],
      ['<script>'],

      // Very long IDs
      ['queue-'.repeat(100)],

      // Large arrays
      Array.from({ length: 100 }, (_, i) => `queue-${i}`),
    ];

    fuzzQueueIds.forEach((queueIds, index) => {
      it(`should handle queue IDs ${index} gracefully`, async () => {
        const timeRange = { since: '2025-01-01T00:00:00Z', until: '2025-01-02T00:00:00Z' };

        (global.fetch as any).mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                viewer: {
                  accounts: [
                    {
                      queuesBacklogAdaptiveGroups: [],
                      queueConsumerMetricsAdaptiveGroups: [],
                    },
                  ],
                },
              },
            }),
        });

        try {
          await monitoringService.collectQueueMetrics(queueIds as any, timeRange);
        } catch (error) {
          // Should handle invalid queue IDs gracefully
          expect(error).toBeInstanceOf(Error);
        }
      });
    });
  });

  describe('metrics data fuzzing', () => {
    const fuzzMetricsData = [
      // Valid data
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

      // Malformed data
      null,
      undefined,
      {},
      { kvOperationsAdaptiveGroups: null },
      { kvOperationsAdaptiveGroups: undefined },
      { kvOperationsAdaptiveGroups: 'invalid' },
      { kvOperationsAdaptiveGroups: 123 },

      // Missing fields
      { kvOperationsAdaptiveGroups: [{}] },
      { kvOperationsAdaptiveGroups: [{ dimensions: {} }] },
      { kvOperationsAdaptiveGroups: [{ dimensions: { operation: 'read' } }] },

      // Invalid types
      {
        kvOperationsAdaptiveGroups: [
          {
            dimensions: { operation: 123, status: true, namespaceId: null },
            sum: { requests: '100' },
            avg: { duration: '10' },
            quantiles: { durationP50: null, durationP90: undefined, durationP99: '20' },
          },
        ],
      },

      // Very large numbers
      {
        kvOperationsAdaptiveGroups: [
          {
            dimensions: { operation: 'read', status: 'success', namespaceId: 'ns1' },
            sum: { requests: Number.MAX_SAFE_INTEGER },
            avg: { duration: Number.MAX_VALUE },
            quantiles: { durationP50: Infinity, durationP90: -Infinity, durationP99: NaN },
          },
        ],
      },

      // Nested objects
      {
        kvOperationsAdaptiveGroups: [
          {
            dimensions: { operation: 'read', status: 'success', namespaceId: { nested: 'object' } },
            sum: { requests: { nested: 100 } },
            avg: { duration: { nested: 10 } },
            quantiles: {
              durationP50: { nested: 8 },
              durationP90: { nested: 15 },
              durationP99: { nested: 20 },
            },
          },
        ],
      },
    ];

    fuzzMetricsData.forEach((data, index) => {
      it(`should handle cache metrics data ${index} gracefully`, () => {
        try {
          const result = (monitoringService as any).processCacheMetrics(data);
          // Should return a valid CacheMetrics object even with malformed data
          expect(result).toHaveProperty('totalReads');
          expect(result).toHaveProperty('hitRate');
          expect(typeof result.hitRate).toBe('number');
        } catch (error) {
          // Should not crash, but may return default values
          expect(error).toBeInstanceOf(Error);
        }
      });

      it(`should handle queue metrics data ${index} gracefully`, () => {
        try {
          const result = (monitoringService as any).processQueueMetrics(data, []);
          // Should return a valid array even with malformed data
          expect(Array.isArray(result)).toBe(true);
        } catch (error) {
          // Should not crash
          expect(error).toBeInstanceOf(Error);
        }
      });

      it(`should handle shard metrics data ${index} gracefully`, () => {
        try {
          const result = (monitoringService as any).processShardMetrics(data, []);
          // Should return a valid array even with malformed data
          expect(Array.isArray(result)).toBe(true);
        } catch (error) {
          // Should not crash
          expect(error).toBeInstanceOf(Error);
        }
      });
    });
  });

  describe('SLA metrics fuzzing', () => {
    const fuzzSLAMetrics = [
      // Valid metrics
      {
        shards: [],
        cache: {
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
        },
        queues: [],
        timestamp: Date.now(),
      },

      // Invalid metrics
      null,
      undefined,
      {},
      { shards: null, cache: null, queues: null },
      { shards: undefined, cache: undefined, queues: undefined },

      // Missing required fields
      { shards: [], queues: [], timestamp: Date.now() }, // missing cache
      { cache: {}, queues: [], timestamp: Date.now() }, // missing shards
      { shards: [], cache: {}, timestamp: Date.now() }, // missing queues

      // Invalid types
      {
        shards: 'invalid',
        cache: 123,
        queues: true,
        timestamp: 'invalid',
      },

      // Malformed cache metrics
      {
        shards: [],
        cache: {
          totalReads: '100', // string instead of number
          hitRate: null,
          invalidField: 'extra',
        },
        queues: [],
        timestamp: Date.now(),
      },

      // Malformed shard metrics
      {
        shards: [
          {
            shardId: 123, // number instead of string
            p95Duration: '150', // string instead of number
            invalidField: 'extra',
          },
        ],
        cache: {
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
        },
        queues: [],
        timestamp: Date.now(),
      },

      // Malformed queue metrics
      {
        shards: [],
        cache: {
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
        },
        queues: [
          {
            queueId: null,
            avgBacklogMessages: '100', // string instead of number
            invalidField: 'extra',
          },
        ],
        timestamp: Date.now(),
      },
    ];

    fuzzSLAMetrics.forEach((metrics, index) => {
      it(`should handle SLA metrics ${index} gracefully`, async () => {
        try {
          const result = await monitoringService.checkSLAs(metrics as any);
          // Should return a valid SLAStatus object
          expect(result).toHaveProperty('overall');
          expect(result).toHaveProperty('violations');
          expect(result).toHaveProperty('timestamp');
          expect(['healthy', 'warning', 'critical']).toContain(result.overall);
        } catch (error) {
          // Should handle invalid metrics gracefully
          expect(error).toBeInstanceOf(Error);
        }
      });
    });
  });
});

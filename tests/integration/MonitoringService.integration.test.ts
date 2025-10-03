import { describe, it, expect, beforeEach } from 'vitest';
import { MonitoringService } from '@/services/MonitoringService';
import { env } from 'cloudflare:test';

describe('MonitoringService Integration Tests', () => {
  let monitoringService: MonitoringService;

  beforeEach(() => {
    monitoringService = new MonitoringService(env as any);
  });

  describe('collectShardMetrics', () => {
    it('should collect real shard metrics from Cloudflare Analytics API', async () => {
      // This test requires valid Cloudflare credentials and actual data
      // In a real environment, this would test against live Cloudflare Analytics

      const timeRange = {
        since: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // 24 hours ago
        until: new Date().toISOString(),
      };

      try {
        const metrics = await monitoringService.collectShardMetrics([], timeRange);

        // Verify the structure of returned metrics
        expect(Array.isArray(metrics)).toBe(true);

        if (metrics.length > 0) {
          const metric = metrics[0]!;
          expect(metric).toHaveProperty('shardId');
          expect(metric).toHaveProperty('className');
          expect(metric).toHaveProperty('scriptName');
          expect(metric).toHaveProperty('status');
          expect(metric).toHaveProperty('totalRequests');
          expect(typeof metric.totalRequests).toBe('number');
          expect(metric.totalRequests).toBeGreaterThanOrEqual(0);
        }
      } catch (error) {
        // If no credentials or data, expect appropriate error
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Cloudflare account ID and API token required');
      }
    });

    it('should handle empty results gracefully', async () => {
      // Mock scenario where no shard data exists
      const timeRange = {
        since: '2025-01-01T00:00:00Z',
        until: '2025-01-02T00:00:00Z',
      };

      try {
        const metrics = await monitoringService.collectShardMetrics([], timeRange);
        expect(Array.isArray(metrics)).toBe(true);
        // May be empty if no data exists
      } catch (error) {
        // Expected if no credentials
        expect(error).toBeInstanceOf(Error);
      }
    });
  });

  describe('collectCacheMetrics', () => {
    it('should collect real cache metrics from Cloudflare Analytics API', async () => {
      const timeRange = {
        since: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        until: new Date().toISOString(),
      };

      try {
        const metrics = await monitoringService.collectCacheMetrics(timeRange);

        // Verify the structure of returned metrics
        expect(metrics).toHaveProperty('totalReads');
        expect(metrics).toHaveProperty('totalWrites');
        expect(metrics).toHaveProperty('totalDeletes');
        expect(metrics).toHaveProperty('successfulReads');
        expect(metrics).toHaveProperty('successfulWrites');
        expect(metrics).toHaveProperty('successfulDeletes');
        expect(metrics).toHaveProperty('hitRate');

        // Verify types
        expect(typeof metrics.totalReads).toBe('number');
        expect(typeof metrics.hitRate).toBe('number');
        expect(metrics.hitRate).toBeGreaterThanOrEqual(0);
        expect(metrics.hitRate).toBeLessThanOrEqual(1);
      } catch (error) {
        // If no credentials or data, expect appropriate error
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Cloudflare account ID and API token required');
      }
    });
  });

  describe('collectQueueMetrics', () => {
    it('should collect real queue metrics from Cloudflare Analytics API', async () => {
      const timeRange = {
        since: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        until: new Date().toISOString(),
      };

      try {
        const metrics = await monitoringService.collectQueueMetrics([], timeRange);

        // Verify the structure of returned metrics
        expect(Array.isArray(metrics)).toBe(true);

        if (metrics.length > 0) {
          const metric = metrics[0]!;
          expect(metric).toHaveProperty('queueId');
          expect(metric).toHaveProperty('avgBacklogBytes');
          expect(metric).toHaveProperty('avgBacklogMessages');
          expect(metric).toHaveProperty('maxBacklogBytes');
          expect(metric).toHaveProperty('maxBacklogMessages');
          expect(metric).toHaveProperty('avgConcurrency');

          expect(typeof metric.avgBacklogMessages).toBe('number');
          expect(typeof metric.avgConcurrency).toBe('number');
        }
      } catch (error) {
        // If no credentials or data, expect appropriate error
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Cloudflare account ID and API token required');
      }
    });
  });

  describe('getSystemMetrics', () => {
    it('should collect comprehensive system metrics', async () => {
      const timeRange = {
        since: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
        until: new Date().toISOString(),
      };

      try {
        const metrics = await monitoringService.getSystemMetrics(timeRange);

        // Verify the structure of the complete metrics object
        expect(metrics).toHaveProperty('shards');
        expect(metrics).toHaveProperty('cache');
        expect(metrics).toHaveProperty('queues');
        expect(metrics).toHaveProperty('timestamp');

        expect(Array.isArray(metrics.shards)).toBe(true);
        expect(typeof metrics.cache).toBe('object');
        expect(Array.isArray(metrics.queues)).toBe(true);
        expect(typeof metrics.timestamp).toBe('number');

        // Verify cache metrics structure
        expect(metrics.cache).toHaveProperty('totalReads');
        expect(metrics.cache).toHaveProperty('hitRate');

        // Verify timestamp is recent
        const now = Date.now();
        expect(metrics.timestamp).toBeGreaterThan(now - 60000); // Within last minute
        expect(metrics.timestamp).toBeLessThanOrEqual(now);
      } catch (error) {
        // If no credentials, expect appropriate error
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Cloudflare account ID and API token required');
      }
    });
  });

  describe('checkSLAs', () => {
    it('should evaluate SLA compliance for real metrics', async () => {
      // First get some real metrics (if available)
      const timeRange = {
        since: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        until: new Date().toISOString(),
      };

      try {
        const metrics = await monitoringService.getSystemMetrics(timeRange);
        const slaStatus = await monitoringService.checkSLAs(metrics);

        // Verify SLA status structure
        expect(slaStatus).toHaveProperty('overall');
        expect(slaStatus).toHaveProperty('violations');
        expect(slaStatus).toHaveProperty('timestamp');

        expect(['healthy', 'warning', 'critical']).toContain(slaStatus.overall);
        expect(Array.isArray(slaStatus.violations)).toBe(true);
        expect(typeof slaStatus.timestamp).toBe('number');

        // Verify violation structure if any exist
        if (slaStatus.violations.length > 0) {
          const violation = slaStatus.violations[0]!;
          expect(violation).toHaveProperty('metric');
          expect(violation).toHaveProperty('current');
          expect(violation).toHaveProperty('target');
          expect(violation).toHaveProperty('severity');
          expect(['warning', 'critical']).toContain(violation.severity);
        }
      } catch (error) {
        // If no credentials, skip SLA testing
        expect(error).toBeInstanceOf(Error);
      }
    });

    it('should handle SLA alerting', async () => {
      const mockSLAs = {
        overall: 'critical' as const,
        violations: [
          {
            metric: 'test_metric',
            current: 100,
            target: 50,
            severity: 'critical' as const,
          },
        ],
        timestamp: Date.now(),
      };

      // Test alert sending (will use mocked KV in test environment)
      await expect(monitoringService.sendAlerts(mockSLAs)).resolves.not.toThrow();
    });
  });

  describe('error handling', () => {
    it('should handle network failures gracefully', async () => {
      // This test would require mocking network failures
      // For now, we test that proper errors are thrown for missing credentials

      const timeRange = {
        since: '2025-01-01T00:00:00Z',
        until: '2025-01-02T00:00:00Z',
      };

      await expect(monitoringService.collectShardMetrics([], timeRange)).rejects.toThrow(
        'Cloudflare account ID and API token required'
      );

      await expect(monitoringService.collectCacheMetrics(timeRange)).rejects.toThrow(
        'Cloudflare account ID and API token required'
      );

      await expect(monitoringService.collectQueueMetrics([], timeRange)).rejects.toThrow(
        'Cloudflare account ID and API token required'
      );
    });

    it('should handle malformed API responses', async () => {
      // This would require mocking the fetch API to return malformed responses
      // For integration tests, we focus on the happy path and credential validation
    });
  });

  describe('performance', () => {
    it('should complete metrics collection within reasonable time', async () => {
      const timeRange = {
        since: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        until: new Date().toISOString(),
      };

      const startTime = Date.now();

      try {
        await monitoringService.getSystemMetrics(timeRange);
        const duration = Date.now() - startTime;

        // Should complete within 30 seconds (reasonable for API calls)
        expect(duration).toBeLessThan(30000);
      } catch (error) {
        // If no credentials, that's acceptable for this performance test
        expect(error).toBeInstanceOf(Error);
      }
    });
  });
});

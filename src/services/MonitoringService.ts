import { CloudflareEnvironment } from '../types';

/**
 * Monitoring and Observability Service
 *
 * Provides comprehensive monitoring capabilities for:
 * - Per-shard metrics collection (Durable Objects)
 * - SLO/SLA tracking and alerting
 * - Cache hit/miss rate monitoring (KV operations)
 * - Queue lag and backlog monitoring
 */
export class MonitoringService {
  private env: CloudflareEnvironment;
  private accountId: string;
  private apiToken: string;

  constructor(env: CloudflareEnvironment) {
    this.env = env;
    this.accountId = env.CLOUDFLARE_ACCOUNT_ID || '';
    this.apiToken = env.CLOUDFLARE_API_TOKEN || '';
  }

  /**
   * Collect per-shard metrics using Durable Objects GraphQL API
   */
  async collectShardMetrics(
    shardIds: string[],
    timeRange: { since: string; until: string }
  ): Promise<ShardMetrics[]> {
    if (!this.accountId || !this.apiToken) {
      throw new Error('Cloudflare account ID and API token required for shard metrics');
    }

    const query = `
      query GetShardMetrics($accountTag: string!, $since: Time!, $until: Time!, $limit: Int!) {
        viewer {
          accounts(filter: { accountTag: $accountTag }) {
            durableObjectsInvocationsAdaptiveGroups(
              filter: { datetime_geq: $since, datetime_leq: $until }
              limit: $limit
            ) {
              dimensions {
                scriptName
                durableObjectClass
                durableObjectId
                status
              }
              sum {
                requests
                responseBodySize
              }
              avg {
                cpuTime
                duration
              }
              quantiles {
                cpuTimeP50
                cpuTimeP90
                cpuTimeP99
                durationP50
                durationP90
                durationP99
              }
            }
            durableObjectsStorageGroups(
              filter: { datetime_geq: $since, datetime_leq: $until }
              limit: $limit
            ) {
              dimensions {
                scriptName
                durableObjectClass
                durableObjectId
              }
              max {
                storedBytes
              }
            }
          }
        }
      }
    `;

    const variables = {
      accountTag: this.accountId,
      since: timeRange.since,
      until: timeRange.until,
      limit: 10000,
    };

    const response = await this.queryGraphQL(query, variables);

    return this.processShardMetrics(response.data.viewer.accounts[0] || {}, shardIds);
  }

  /**
   * Collect cache hit/miss rate metrics using KV operations GraphQL API
   */
  async collectCacheMetrics(timeRange: { since: string; until: string }): Promise<CacheMetrics> {
    if (!this.accountId || !this.apiToken) {
      throw new Error('Cloudflare account ID and API token required for cache metrics');
    }

    const query = `
      query GetCacheMetrics($accountTag: string!, $since: Time!, $until: Time!, $limit: Int!) {
        viewer {
          accounts(filter: { accountTag: $accountTag }) {
            kvOperationsAdaptiveGroups(
              filter: { datetime_geq: $since, datetime_leq: $until }
              limit: $limit
            ) {
              dimensions {
                operation
                status
                namespaceId
              }
              sum {
                requests
              }
              avg {
                duration
              }
              quantiles {
                durationP50
                durationP90
                durationP99
              }
            }
          }
        }
      }
    `;

    const variables = {
      accountTag: this.accountId,
      since: timeRange.since,
      until: timeRange.until,
      limit: 10000,
    };

    const response = await this.queryGraphQL(query, variables);

    return this.processCacheMetrics(response.data.viewer.accounts[0] || {});
  }

  /**
   * Collect queue lag and backlog metrics using Queues GraphQL API
   */
  async collectQueueMetrics(
    queueIds: string[],
    timeRange: { since: string; until: string }
  ): Promise<QueueMetrics[]> {
    if (!this.accountId || !this.apiToken) {
      throw new Error('Cloudflare account ID and API token required for queue metrics');
    }

    const query = `
      query GetQueueMetrics($accountTag: string!, $since: Time!, $until: Time!, $limit: Int!) {
        viewer {
          accounts(filter: { accountTag: $accountTag }) {
            queuesBacklogAdaptiveGroups(
              filter: { datetime_geq: $since, datetime_leq: $until }
              limit: $limit
            ) {
              dimensions {
                queueID
              }
              avg {
                bytes
                messages
              }
              max {
                bytes
                messages
              }
            }
            queueConsumerMetricsAdaptiveGroups(
              filter: { datetime_geq: $since, datetime_leq: $until }
              limit: $limit
            ) {
              dimensions {
                queueID
              }
              avg {
                concurrency
              }
            }
          }
        }
      }
    `;

    const variables = {
      accountTag: this.accountId,
      since: timeRange.since,
      until: timeRange.until,
      limit: 10000,
    };

    const response = await this.queryGraphQL(query, variables);

    return this.processQueueMetrics(response.data.viewer.accounts[0] || {}, queueIds);
  }

  /**
   * Check SLO/SLA compliance and trigger alerts
   */
  async checkSLAs(metrics: SystemMetrics): Promise<SLAStatus> {
    const slaStatus: SLAStatus = {
      overall: 'healthy',
      violations: [],
      timestamp: Date.now(),
    };

    // Check cache hit rate SLO (target: 95%)
    if (metrics.cache && metrics.cache.hitRate < 0.95) {
      slaStatus.violations.push({
        metric: 'cache_hit_rate',
        current: metrics.cache.hitRate,
        target: 0.95,
        severity: 'warning',
      });
    }

    // Check queue backlog SLO (target: < 1000 messages)
    if (metrics.queues) {
      for (const queue of metrics.queues) {
        if (queue.avgBacklogMessages > 1000) {
          slaStatus.violations.push({
            metric: `queue_backlog_${queue.queueId}`,
            current: queue.avgBacklogMessages,
            target: 1000,
            severity: 'critical',
          });
        }
      }
    }

    // Check shard performance SLO (target: P95 latency < 100ms)
    if (metrics.shards) {
      for (const shard of metrics.shards) {
        if (shard.p95Duration > 100) {
          slaStatus.violations.push({
            metric: `shard_latency_${shard.shardId}`,
            current: shard.p95Duration,
            target: 100,
            severity: 'warning',
          });
        }
      }
    }

    // Determine overall status
    if (slaStatus.violations.some((v) => v.severity === 'critical')) {
      slaStatus.overall = 'critical';
    } else if (slaStatus.violations.some((v) => v.severity === 'warning')) {
      slaStatus.overall = 'warning';
    }

    return slaStatus;
  }

  /**
   * Send alerts for SLA violations
   */
  async sendAlerts(slaStatus: SLAStatus): Promise<void> {
    if (slaStatus.violations.length === 0) {
      return;
    }

    // In a real implementation, this would integrate with Cloudflare Notifications
    // or external alerting systems like PagerDuty, Slack, etc.

    console.warn('SLA Violations detected:', slaStatus.violations);

    // Store alert history in KV for dashboard display
    const alertKey = `alerts:${Date.now()}`;
    await this.env.APP_CACHE.put(alertKey, JSON.stringify(slaStatus), {
      expirationTtl: 60 * 60 * 24 * 7, // 7 days
    });
  }

  /**
   * Get comprehensive system metrics
   */
  async getSystemMetrics(timeRange: { since: string; until: string }): Promise<SystemMetrics> {
    const [shardMetrics, cacheMetrics, queueMetrics] = await Promise.all([
      this.collectShardMetrics([], timeRange), // Empty array gets all shards
      this.collectCacheMetrics(timeRange),
      this.collectQueueMetrics([], timeRange), // Empty array gets all queues
    ]);

    return {
      shards: shardMetrics,
      cache: cacheMetrics,
      queues: queueMetrics,
      timestamp: Date.now(),
    };
  }

  private async queryGraphQL(
    query: string,
    variables: Record<string, unknown>
  ): Promise<GraphQLResponse> {
    const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`GraphQL query failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  private processShardMetrics(data: Record<string, unknown>, shardIds: string[]): ShardMetrics[] {
    const metrics: ShardMetrics[] = [];

    // Process invocation metrics
    const invocations = data['durableObjectsInvocationsAdaptiveGroups'] as
      | Array<{
          dimensions: {
            scriptName: string;
            durableObjectClass: string;
            durableObjectId: string;
            status: string;
          };
          sum: {
            requests: number;
            responseBodySize: number;
          };
          avg: {
            cpuTime: number;
            duration: number;
          };
          quantiles: {
            cpuTimeP50: number;
            cpuTimeP90: number;
            cpuTimeP99: number;
            durationP50: number;
            durationP90: number;
            durationP99: number;
          };
        }>
      | undefined;

    if (invocations) {
      for (const group of invocations) {
        const { dimensions, sum, avg, quantiles } = group;

        // Filter by requested shard IDs if specified
        if (shardIds.length > 0 && !shardIds.includes(dimensions.durableObjectId)) {
          continue;
        }

        metrics.push({
          shardId: dimensions.durableObjectId,
          className: dimensions.durableObjectClass,
          scriptName: dimensions.scriptName,
          status: dimensions.status,
          totalRequests: sum.requests,
          avgCpuTime: avg.cpuTime,
          avgDuration: avg.duration,
          p50CpuTime: quantiles.cpuTimeP50,
          p90CpuTime: quantiles.cpuTimeP90,
          p95CpuTime: quantiles.cpuTimeP99,
          p50Duration: quantiles.durationP50,
          p90Duration: quantiles.durationP90,
          p95Duration: quantiles.durationP99,
          totalResponseSize: sum.responseBodySize,
        });
      }
    }

    // Process storage metrics
    const storage = data['durableObjectsStorageGroups'] as
      | Array<{
          dimensions: {
            scriptName: string;
            durableObjectClass: string;
            durableObjectId: string;
          };
          max: {
            storedBytes: number;
          };
        }>
      | undefined;

    if (storage) {
      for (const group of storage) {
        const { dimensions, max } = group;

        const existing = metrics.find((m) => m.shardId === dimensions.durableObjectId);
        if (existing) {
          existing.storageBytes = max.storedBytes;
        }
      }
    }

    return metrics;
  }

  private processCacheMetrics(data: Record<string, unknown>): CacheMetrics {
    const metrics: CacheMetrics = {
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
    };

    const kvOperations = data['kvOperationsAdaptiveGroups'] as
      | Array<{
          dimensions: {
            operation: string;
            status: string;
            namespaceId: string;
          };
          sum: {
            requests: number;
          };
          avg: {
            duration: number;
          };
          quantiles: {
            durationP50: number;
            durationP90: number;
            durationP99: number;
          };
        }>
      | undefined;

    if (kvOperations) {
      let totalReadLatency = 0;
      let totalWriteLatency = 0;
      let totalDeleteLatency = 0;
      let readCount = 0;
      let writeCount = 0;
      let deleteCount = 0;

      for (const group of kvOperations) {
        const { dimensions, sum, avg, quantiles } = group;

        switch (dimensions.operation) {
          case 'read':
            metrics.totalReads += sum.requests;
            if (dimensions.status === 'success') {
              metrics.successfulReads += sum.requests;
            }
            totalReadLatency += avg.duration * sum.requests;
            readCount += sum.requests;
            if (quantiles.durationP99 > metrics.p95ReadLatency) {
              metrics.p95ReadLatency = quantiles.durationP99;
            }
            break;
          case 'write':
            metrics.totalWrites += sum.requests;
            if (dimensions.status === 'success') {
              metrics.successfulWrites += sum.requests;
            }
            totalWriteLatency += avg.duration * sum.requests;
            writeCount += sum.requests;
            if (quantiles.durationP99 > metrics.p95WriteLatency) {
              metrics.p95WriteLatency = quantiles.durationP99;
            }
            break;
          case 'delete':
            metrics.totalDeletes += sum.requests;
            if (dimensions.status === 'success') {
              metrics.successfulDeletes += sum.requests;
            }
            totalDeleteLatency += avg.duration * sum.requests;
            deleteCount += sum.requests;
            if (quantiles.durationP99 > metrics.p95DeleteLatency) {
              metrics.p95DeleteLatency = quantiles.durationP99;
            }
            break;
        }
      }

      // Calculate averages
      if (readCount > 0) {
        metrics.avgReadLatency = totalReadLatency / readCount;
      }
      if (writeCount > 0) {
        metrics.avgWriteLatency = totalWriteLatency / writeCount;
      }
      if (deleteCount > 0) {
        metrics.avgDeleteLatency = totalDeleteLatency / deleteCount;
      }

      // Calculate hit rate (successful reads / total reads)
      if (metrics.totalReads > 0) {
        metrics.hitRate = metrics.successfulReads / metrics.totalReads;
      }
    }

    return metrics;
  }

  private processQueueMetrics(data: Record<string, unknown>, queueIds: string[]): QueueMetrics[] {
    const metrics: QueueMetrics[] = [];

    // Process backlog metrics
    if (data['queuesBacklogAdaptiveGroups']) {
      for (const group of data['queuesBacklogAdaptiveGroups'] as Array<{
        dimensions: { queueID: string };
        avg: { bytes: number; messages: number };
        max: { bytes: number; messages: number };
      }>) {
        const { dimensions, avg, max } = group;

        // Filter by requested queue IDs if specified
        if (queueIds.length > 0 && !queueIds.includes(dimensions.queueID)) {
          continue;
        }

        metrics.push({
          queueId: dimensions.queueID,
          avgBacklogBytes: avg.bytes,
          avgBacklogMessages: avg.messages,
          maxBacklogBytes: max.bytes,
          maxBacklogMessages: max.messages,
          avgConcurrency: 0, // Will be filled from consumer metrics
        });
      }
    }

    // Process consumer concurrency metrics
    if (data['queueConsumerMetricsAdaptiveGroups']) {
      for (const group of data['queueConsumerMetricsAdaptiveGroups'] as Array<{
        dimensions: { queueID: string };
        avg: { concurrency: number };
      }>) {
        const { dimensions, avg } = group;

        const existing = metrics.find((m) => m.queueId === dimensions.queueID);
        if (existing) {
          existing.avgConcurrency = avg.concurrency;
        }
      }
    }

    return metrics;
  }
}

// Type definitions
export interface ShardMetrics {
  shardId: string;
  className: string;
  scriptName: string;
  status: string;
  totalRequests: number;
  avgCpuTime: number;
  avgDuration: number;
  p50CpuTime: number;
  p90CpuTime: number;
  p95CpuTime: number;
  p50Duration: number;
  p90Duration: number;
  p95Duration: number;
  totalResponseSize: number;
  storageBytes?: number;
}

export interface CacheMetrics {
  totalReads: number;
  totalWrites: number;
  totalDeletes: number;
  successfulReads: number;
  successfulWrites: number;
  successfulDeletes: number;
  avgReadLatency: number;
  avgWriteLatency: number;
  avgDeleteLatency: number;
  p95ReadLatency: number;
  p95WriteLatency: number;
  p95DeleteLatency: number;
  hitRate: number;
}

export interface QueueMetrics {
  queueId: string;
  avgBacklogBytes: number;
  avgBacklogMessages: number;
  maxBacklogBytes: number;
  maxBacklogMessages: number;
  avgConcurrency: number;
}

export interface SystemMetrics {
  shards: ShardMetrics[];
  cache: CacheMetrics;
  queues: QueueMetrics[];
  timestamp: number;
}

export interface SLAStatus {
  overall: 'healthy' | 'warning' | 'critical';
  violations: SLAViolation[];
  timestamp: number;
}

export interface SLAViolation {
  metric: string;
  current: number;
  target: number;
  severity: 'warning' | 'critical';
}

interface GraphQLResponse {
  data: {
    viewer: {
      accounts: Array<{
        durableObjectsInvocationsAdaptiveGroups?: Array<{
          dimensions: {
            scriptName: string;
            durableObjectClass: string;
            durableObjectId: string;
            status: string;
          };
          sum: {
            requests: number;
            responseBodySize: number;
          };
          avg: {
            cpuTime: number;
            duration: number;
          };
          quantiles: {
            cpuTimeP50: number;
            cpuTimeP90: number;
            cpuTimeP99: number;
            durationP50: number;
            durationP90: number;
            durationP99: number;
          };
        }>;
        durableObjectsStorageGroups?: Array<{
          dimensions: {
            scriptName: string;
            durableObjectClass: string;
            durableObjectId: string;
          };
          max: {
            storedBytes: number;
          };
        }>;
        kvOperationsAdaptiveGroups?: Array<{
          dimensions: {
            operation: string;
            status: string;
            namespaceId: string;
          };
          sum: {
            requests: number;
          };
          avg: {
            duration: number;
          };
          quantiles: {
            durationP50: number;
            durationP90: number;
            durationP99: number;
          };
        }>;
        queuesBacklogAdaptiveGroups?: Array<{
          dimensions: {
            queueID: string;
          };
          avg: {
            bytes: number;
            messages: number;
          };
          max: {
            bytes: number;
            messages: number;
          };
        }>;
        queueConsumerMetricsAdaptiveGroups?: Array<{
          dimensions: {
            queueID: string;
          };
          avg: {
            concurrency: number;
          };
        }>;
      }>;
    };
  };
  errors?: Array<{
    message: string;
    locations?: Array<{
      line: number;
      column: number;
    }>;
    path?: string[];
  }>;
}

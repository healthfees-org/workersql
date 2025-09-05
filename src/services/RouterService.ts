import {
  QueryRequest,
  RoutingPolicy,
  TablePolicy,
  CloudflareEnvironment,
  EdgeSQLError,
} from '../types';
import { TablePolicyParser } from './TablePolicyParser';
import { RoutingVersionManager } from './RoutingVersionManager';

/**
 * RouterService - Handles intelligent routing of SQL queries to appropriate shards
 *
 * Features:
 * - Tenant-based routing
 * - Table-based sharding strategies
 * - Load balancing across shards
 * - Capacity-aware routing
 * - Routing policy management
 */
export interface IRouterService {
  /**
   * Route a query to the appropriate shard
   */
  routeQuery(query: QueryRequest, tenantId: string): Promise<ShardTarget>;

  /**
   * Get routing policy for a tenant
   */
  getRoutingPolicy(tenantId: string): Promise<RoutingPolicy>;

  /**
   * Update routing policy
   */
  updateRoutingPolicy(policy: RoutingPolicy): Promise<void>;

  /**
   * Get table policy for routing decisions
   */
  getTablePolicy(tableName: string): Promise<TablePolicy>;

  /**
   * Find optimal shard for new tenant/table
   */
  findOptimalShard(tenantId: string, tableName: string): Promise<string>;

  /**
   * Check shard health and capacity
   */
  getShardHealth(shardId: string): Promise<ShardHealth>;

  /**
   * Get all available shards
   */
  getAvailableShards(): Promise<string[]>;

  /**
   * Rebalance shards based on capacity and load
   */
  rebalanceShards(): Promise<RebalanceResult>;
}

/**
 * Shard target information
 */
export interface ShardTarget {
  shardId: string;
  namespace: DurableObjectNamespace;
  durableObjectId: DurableObjectId;
  routingReason: string;
  loadBalanceWeight: number;
}

/**
 * Shard health metrics
 */
export interface ShardHealth {
  shardId: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  capacityUsedBytes: number;
  capacityMaxBytes: number;
  capacityUtilization: number;
  activeConnections: number;
  avgResponseTime: number;
  errorRate: number;
  lastHealthCheck: number;
}

/**
 * Rebalancing result
 */
export interface RebalanceResult {
  success: boolean;
  movedTenants: Array<{
    tenantId: string;
    fromShard: string;
    toShard: string;
    reason: string;
  }>;
  errors: string[];
  executionTime: number;
}

/**
 * Shard health response from Durable Object
 */
interface ShardHealthResponse {
  sizeBytes?: number;
  connections?: number;
}

/**
 * Routing strategy options
 */
export enum RoutingStrategy {
  TENANT_HASH = 'tenant_hash',
  TABLE_HASH = 'table_hash',
  ROUND_ROBIN = 'round_robin',
  CAPACITY_AWARE = 'capacity_aware',
  CUSTOM = 'custom',
}

/**
 * RouterService implementation
 */
export class RouterService implements IRouterService {
  private routingPolicies: Map<string, RoutingPolicy> = new Map();
  private tablePolicies: Map<string, TablePolicy> = new Map();
  private shardHealth: Map<string, ShardHealth> = new Map();
  private lastHealthCheck: number = 0;
  private policyParser: TablePolicyParser;
  private versionManager: RoutingVersionManager;

  constructor(
    private env: CloudflareEnvironment,
    private defaultStrategy: RoutingStrategy = RoutingStrategy.TENANT_HASH
  ) {
    this.policyParser = new TablePolicyParser();
    this.versionManager = new RoutingVersionManager(env);
    this.initializeDefaultPolicies();
  }

  /**
   * Route a query to the appropriate shard
   */
  async routeQuery(query: QueryRequest, tenantId: string): Promise<ShardTarget> {
    const tableName = this.extractTableName(query.sql);

    // Get routing policy for tenant
    const routingPolicy = await this.getRoutingPolicy(tenantId);
    const tablePolicy = await this.getTablePolicy(tableName);

    // Check if tenant has explicit shard assignment
    if (routingPolicy.tenants[tenantId]) {
      const shardId = routingPolicy.tenants[tenantId];
      return this.createShardTarget(shardId, 'explicit_tenant_assignment');
    }

    // Check for table-specific routing
    const shardId = await this.routeByStrategy(
      tenantId,
      tableName,
      tablePolicy,
      query.hints?.shardKey
    );

    return this.createShardTarget(shardId, `strategy_${this.defaultStrategy}`);
  }

  /**
   * Get routing policy for a tenant
   */
  async getRoutingPolicy(tenantId: string): Promise<RoutingPolicy> {
    // Check cache first
    if (this.routingPolicies.has(tenantId)) {
      return this.routingPolicies.get(tenantId)!;
    }

    // Try to get current version from version manager
    try {
      const currentVersion = await this.versionManager.getCurrentVersion();
      const policy = await this.versionManager.getPolicyByVersion(currentVersion);

      if (policy) {
        this.routingPolicies.set(tenantId, policy);
        return policy;
      }
    } catch (error) {
      console.warn('Version manager not available, falling back to KV storage:', error);
    }

    // Fallback to KV storage
    const policyKey = `routing:tenant:${tenantId}`;
    const storedPolicy = (await this.env.APP_CACHE.get(policyKey, 'json')) as RoutingPolicy;

    if (storedPolicy) {
      this.routingPolicies.set(tenantId, storedPolicy);
      return storedPolicy;
    }

    // Return default policy
    const defaultPolicy: RoutingPolicy = {
      version: 1,
      tenants: {},
      ranges: [],
    };

    this.routingPolicies.set(tenantId, defaultPolicy);
    return defaultPolicy;
  }

  /**
   * Update routing policy with versioning
   */
  async updateRoutingPolicy(policy: RoutingPolicy, description?: string): Promise<void> {
    // Use version manager for atomic updates
    await this.versionManager.updateCurrentPolicy(policy, description);

    // Clear local cache
    this.routingPolicies.clear();
  }

  /**
   * Get routing policy version history
   */
  async getPolicyVersions(): Promise<any[]> {
    return this.versionManager.listVersions();
  }

  /**
   * Rollback routing policy to specific version
   */
  async rollbackPolicyToVersion(version: number): Promise<boolean> {
    const success = await this.versionManager.rollbackToVersion(version);
    if (success) {
      // Clear local cache to force reload
      this.routingPolicies.clear();
    }
    return success;
  }

  /**
   * Get policy diff between versions
   */
  async getPolicyDiff(fromVersion: number, toVersion: number): Promise<any> {
    return this.versionManager.getPolicyDiff(fromVersion, toVersion);
  }

  /**
   * Get table policy for routing decisions
   */
  async getTablePolicy(tableName: string): Promise<TablePolicy> {
    // Check cache first
    if (this.tablePolicies.has(tableName)) {
      return this.tablePolicies.get(tableName)!;
    }

    // Try to load from KV storage as YAML
    const yamlKey = `table:policy:yaml:${tableName}`;
    const yamlContent = await this.env.APP_CACHE.get(yamlKey, 'text');

    if (yamlContent) {
      try {
        const policy = await this.policyParser.parseTablePolicy(yamlContent, tableName);
        this.tablePolicies.set(tableName, policy);
        return policy;
      } catch (error) {
        console.warn(`Failed to parse YAML policy for ${tableName}, falling back to JSON:`, error);
      }
    }

    // Fallback to JSON storage
    const jsonKey = `table:policy:${tableName}`;
    const storedPolicy = (await this.env.APP_CACHE.get(jsonKey, 'json')) as TablePolicy;

    if (storedPolicy) {
      this.tablePolicies.set(tableName, storedPolicy);
      return storedPolicy;
    }

    // Return default policy
    const defaultPolicy: TablePolicy = {
      pk: 'id',
      cache: {
        mode: 'bounded',
        ttlMs: 60000,
        swrMs: 300000,
      },
    };

    this.tablePolicies.set(tableName, defaultPolicy);
    return defaultPolicy;
  }

  /**
   * Find optimal shard for new tenant/table
   */
  async findOptimalShard(_tenantId: string, _tableName: string): Promise<string> {
    await this.refreshShardHealth();

    const availableShards = await this.getAvailableShards();
    const healthyShards = availableShards.filter((shardId) => {
      const health = this.shardHealth.get(shardId);
      return health?.status === 'healthy' && health.capacityUtilization < 0.8;
    });

    if (healthyShards.length === 0) {
      throw new EdgeSQLError('No healthy shards available', 'NO_HEALTHY_SHARDS');
    }

    // Find shard with lowest capacity utilization
    const firstShard = healthyShards[0];
    if (!firstShard) {
      throw new EdgeSQLError('No healthy shards available', 'NO_HEALTHY_SHARDS');
    }

    let optimalShard: string = firstShard;
    let lowestUtilization = this.shardHealth.get(optimalShard)!.capacityUtilization;

    for (const shardId of healthyShards) {
      const health = this.shardHealth.get(shardId)!;
      if (health.capacityUtilization < lowestUtilization) {
        optimalShard = shardId;
        lowestUtilization = health.capacityUtilization;
      }
    }

    return optimalShard;
  }

  /**
   * Check shard health and capacity
   */
  async getShardHealth(shardId: string): Promise<ShardHealth> {
    // Check if we need to refresh health data
    const now = Date.now();
    if (now - this.lastHealthCheck > 30000) {
      // 30 seconds
      await this.refreshShardHealth();
    }

    const health = this.shardHealth.get(shardId);
    if (!health) {
      throw new EdgeSQLError(`Shard ${shardId} not found`, 'SHARD_NOT_FOUND');
    }

    return health;
  }

  /**
   * Get all available shards
   */
  async getAvailableShards(): Promise<string[]> {
    // Get shard list from environment or configuration
    const shardCount = parseInt(this.env.MAX_SHARD_SIZE_GB) || 4; // Default to 4 shards
    const shards: string[] = [];

    for (let i = 0; i < shardCount; i++) {
      shards.push(`shard_${i}`);
    }

    return shards;
  }

  /**
   * Rebalance shards based on capacity and load
   */
  async rebalanceShards(): Promise<RebalanceResult> {
    const startTime = Date.now();
    const result: RebalanceResult = {
      success: true,
      movedTenants: [],
      errors: [],
      executionTime: 0,
    };

    try {
      await this.refreshShardHealth();

      // TODO: Implement actual tenant migration logic
      // const shards = await this.getAvailableShards();
      // const overloadedShards = shards.filter(shardId => {
      //   const health = this.shardHealth.get(shardId);
      //   return health && health.capacityUtilization > 0.9;
      // });

      // const underutilizedShards = shards.filter(shardId => {
      //   const health = this.shardHealth.get(shardId);
      //   return health && health.capacityUtilization < 0.5;
      // });

      // TODO: Implement tenant migration logic
      // For now, just return success with no moves

      result.executionTime = Date.now() - startTime;
      return result;
    } catch (error) {
      result.success = false;
      result.errors.push(error instanceof Error ? error.message : 'Unknown error');
      result.executionTime = Date.now() - startTime;
      return result;
    }
  }

  /**
   * Route by strategy
   */
  private async routeByStrategy(
    tenantId: string,
    tableName: string,
    tablePolicy: TablePolicy,
    shardKey?: string
  ): Promise<string> {
    const key = shardKey || tablePolicy.shardBy || tenantId;

    switch (this.defaultStrategy) {
      case RoutingStrategy.TENANT_HASH:
        return this.hashRoute(tenantId);

      case RoutingStrategy.TABLE_HASH:
        return this.hashRoute(`${tenantId}:${tableName}`);

      case RoutingStrategy.CAPACITY_AWARE:
        return await this.findOptimalShard(tenantId, tableName);

      case RoutingStrategy.ROUND_ROBIN:
        return this.roundRobinRoute();

      default:
        return this.hashRoute(key);
    }
  }

  /**
   * Hash-based routing
   */
  private hashRoute(key: string): string {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    const shardCount = 4; // TODO: Get from configuration
    const shardIndex = Math.abs(hash) % shardCount;
    return `shard_${shardIndex}`;
  }

  /**
   * Round-robin routing
   */
  private roundRobinRoute(): string {
    const shardCount = 4; // TODO: Get from configuration
    const shardIndex = Date.now() % shardCount;
    return `shard_${shardIndex}`;
  }

  /**
   * Create shard target object
   */
  private createShardTarget(shardId: string, routingReason: string): ShardTarget {
    return {
      shardId,
      namespace: this.env.SHARD,
      durableObjectId: this.env.SHARD.idFromName(shardId),
      routingReason,
      loadBalanceWeight: 1.0,
    };
  }

  /**
   * Extract table name from SQL
   */
  private extractTableName(sql: string): string {
    const match = sql.match(
      /(?:FROM|INTO|UPDATE|CREATE TABLE|ALTER TABLE|DROP TABLE)\s+`?(\w+)`?/i
    );
    return match?.[1] || 'unknown';
  }

  /**
   * Refresh shard health data
   */
  private async refreshShardHealth(): Promise<void> {
    const shards = await this.getAvailableShards();

    for (const shardId of shards) {
      try {
        const shard = this.env.SHARD.get(this.env.SHARD.idFromName(shardId));
        const response = await shard.fetch(new Request('https://internal/health'));
        const healthData = (await response.json()) as ShardHealthResponse;

        const health: ShardHealth = {
          shardId,
          status: response.ok ? 'healthy' : 'unhealthy',
          capacityUsedBytes: healthData.sizeBytes || 0,
          capacityMaxBytes: parseInt(this.env.MAX_SHARD_SIZE_GB) * 1024 * 1024 * 1024,
          capacityUtilization:
            (healthData.sizeBytes || 0) /
            (parseInt(this.env.MAX_SHARD_SIZE_GB) * 1024 * 1024 * 1024),
          activeConnections: healthData.connections || 0,
          avgResponseTime: 50, // TODO: Calculate actual response time
          errorRate: 0, // TODO: Calculate actual error rate
          lastHealthCheck: Date.now(),
        };

        this.shardHealth.set(shardId, health);
      } catch (error) {
        console.error(`Health check failed for shard ${shardId}:`, error);

        const health: ShardHealth = {
          shardId,
          status: 'unhealthy',
          capacityUsedBytes: 0,
          capacityMaxBytes: parseInt(this.env.MAX_SHARD_SIZE_GB) * 1024 * 1024 * 1024,
          capacityUtilization: 1.0, // Mark as full to avoid routing
          activeConnections: 0,
          avgResponseTime: 0,
          errorRate: 1.0,
          lastHealthCheck: Date.now(),
        };

        this.shardHealth.set(shardId, health);
      }
    }

    this.lastHealthCheck = Date.now();
  }

  /**
   * Initialize default policies
   */
  private initializeDefaultPolicies(): void {
    // Set up default table policies for common tables
    const defaultTablePolicy: TablePolicy = {
      pk: 'id',
      cache: {
        mode: 'bounded',
        ttlMs: 60000,
        swrMs: 300000,
      },
    };

    this.tablePolicies.set('users', defaultTablePolicy);
    this.tablePolicies.set('orders', defaultTablePolicy);
    this.tablePolicies.set('products', defaultTablePolicy);
  }
}

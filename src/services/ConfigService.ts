import { BaseService } from './BaseService';
import {
  CloudflareEnvironment,
  RoutingPolicy,
  TablePolicy,
  AuthContext,
  EdgeSQLError,
} from '../types';

/**
 * Configuration service for managing table policies and routing configuration
 */
export class ConfigService extends BaseService {
  private cachedTablePolicies?: Record<string, TablePolicy>;
  private cachedRoutingPolicy?: RoutingPolicy;
  private cacheExpiry?: number;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(env: CloudflareEnvironment, authContext?: AuthContext) {
    super(env, authContext);
  }

  /**
   * Get table policy for a specific table
   */
  async getTablePolicy(tableName: string): Promise<TablePolicy> {
    const policies = await this.getTablePolicies();
    const policy = policies[tableName];

    if (!policy) {
      throw new EdgeSQLError(`No policy found for table: ${tableName}`, 'TABLE_POLICY_NOT_FOUND');
    }

    return policy;
  }

  /**
   * Get all table policies
   */
  async getTablePolicies(): Promise<Record<string, TablePolicy>> {
    if (this.isCacheValid() && this.cachedTablePolicies) {
      return this.cachedTablePolicies;
    }

    try {
      // In a real implementation, this would fetch from KV or a configuration service
      // For now, return default policies
      const defaultPolicies = this.getDefaultTablePolicies();

      this.cachedTablePolicies = defaultPolicies;
      this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;

      this.log('info', 'Table policies loaded', {
        tableCount: Object.keys(defaultPolicies).length,
      });

      return defaultPolicies;
    } catch (error) {
      this.log('error', 'Failed to load table policies', { error: (error as Error).message });
      throw new EdgeSQLError('Failed to load table policies', 'CONFIG_LOAD_ERROR');
    }
  }

  /**
   * Get routing policy for shard resolution
   */
  async getRoutingPolicy(): Promise<RoutingPolicy> {
    if (this.isCacheValid() && this.cachedRoutingPolicy) {
      return this.cachedRoutingPolicy;
    }

    try {
      // In a real implementation, this would fetch from KV or a configuration service
      const defaultPolicy = this.getDefaultRoutingPolicy();

      this.cachedRoutingPolicy = defaultPolicy;
      this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;

      this.log('info', 'Routing policy loaded', { version: defaultPolicy.version });

      return defaultPolicy;
    } catch (error) {
      this.log('error', 'Failed to load routing policy', { error: (error as Error).message });
      throw new EdgeSQLError('Failed to load routing policy', 'CONFIG_LOAD_ERROR');
    }
  }

  /**
   * Determine shard ID for a given table and shard key
   */
  async resolveShardId(tableName: string, shardKey?: string, tenantId?: string): Promise<string> {
    await this.getTablePolicy(tableName);
    const routingPolicy = await this.getRoutingPolicy();

    // Tenant-based routing takes precedence
    if (tenantId && routingPolicy.tenants[tenantId]) {
      return routingPolicy.tenants[tenantId];
    }

    // Hash-based routing for non-tenant data
    if (shardKey) {
      const hash = await this.hashString(shardKey);
      const hashPrefix = hash.substring(0, 2);

      const range = routingPolicy.ranges.find((r) => {
        const [start, end] = r.prefix.split('..');
        if (start && end) {
          return hashPrefix >= start && hashPrefix <= end;
        }
        return false;
      });

      if (range) {
        return range.shard;
      }
    }

    // Default shard fallback
    const defaultShard = routingPolicy.ranges[0]?.shard || 'shard-default';

    this.log('warn', 'Using default shard routing', {
      tableName,
      shardKey,
      tenantId,
      defaultShard,
    });

    return defaultShard;
  }

  /**
   * Validate configuration integrity
   */
  async validateConfig(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    try {
      const tablePolicies = await this.getTablePolicies();
      const routingPolicy = await this.getRoutingPolicy();

      // Validate table policies
      for (const [tableName, policy] of Object.entries(tablePolicies)) {
        if (!policy.pk) {
          errors.push(`Table ${tableName} missing primary key definition`);
        }

        if (policy.cache.ttlMs <= 0) {
          errors.push(`Table ${tableName} has invalid cache TTL`);
        }

        if (policy.cache.swrMs <= policy.cache.ttlMs) {
          errors.push(`Table ${tableName} SWR time must be greater than TTL`);
        }
      }

      // Validate routing policy
      if (routingPolicy.version <= 0) {
        errors.push('Routing policy version must be positive');
      }

      if (routingPolicy.ranges.length === 0) {
        errors.push('Routing policy must define at least one range');
      }

      return { valid: errors.length === 0, errors };
    } catch (error) {
      errors.push(`Configuration validation failed: ${(error as Error).message}`);
      return { valid: false, errors };
    }
  }

  /**
   * Clear configuration cache (useful for testing or forced updates)
   */
  clearCache(): void {
    delete this.cachedTablePolicies;
    delete this.cachedRoutingPolicy;
    delete this.cacheExpiry;
    this.log('info', 'Configuration cache cleared');
  }

  /**
   * Get default cache TTL from environment or return default
   */
  getCacheTTL(): number {
    return this.env.DEFAULT_CACHE_TTL ? parseInt(this.env.DEFAULT_CACHE_TTL, 10) : 60000;
  }

  /**
   * Get default cache SWR from environment or return default
   */
  getCacheSWR(): number {
    return this.env.DEFAULT_CACHE_SWR ? parseInt(this.env.DEFAULT_CACHE_SWR, 10) : 300000;
  }

  /**
   * Get shard count from environment or return default
   */
  getShardCount(): number {
    return this.env.SHARD_COUNT ? parseInt(this.env.SHARD_COUNT, 10) : 2;
  }

  /**
   * Check if cache is still valid
   */
  private isCacheValid(): boolean {
    return this.cacheExpiry !== undefined && Date.now() < this.cacheExpiry;
  }

  /**
   * Get default table policies (in production, load from external config)
   */
  private getDefaultTablePolicies(): Record<string, TablePolicy> {
    return {
      users: {
        pk: 'id',
        shardBy: 'tenant_id',
        cache: {
          mode: 'bounded',
          ttlMs: 30000,
          swrMs: 120000,
          alwaysStrongColumns: ['role', 'permissions', 'balance'],
        },
      },
      posts: {
        pk: 'id',
        shardBy: 'tenant_id',
        cache: {
          mode: 'bounded',
          ttlMs: 15000,
          swrMs: 60000,
        },
      },
      sessions: {
        pk: 'id',
        shardBy: 'user_id',
        cache: {
          mode: 'strong',
          ttlMs: 0,
          swrMs: 0,
        },
      },
    };
  }

  /**
   * Get default routing policy (in production, load from external config)
   */
  private getDefaultRoutingPolicy(): RoutingPolicy {
    return {
      version: 1,
      tenants: {
        // Tenant-specific shard assignments would be populated here
        demo: 'shard-demo',
        test: 'shard-test',
      },
      ranges: [
        {
          prefix: '00..7f',
          shard: 'shard-range-0',
        },
        {
          prefix: '80..ff',
          shard: 'shard-range-1',
        },
      ],
    };
  }
}

import { BaseService } from './BaseService';
import { TablePolicyParser } from './TablePolicyParser';
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
  private readonly tablePolicyParser = new TablePolicyParser();

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
      const policies: Record<string, TablePolicy> = {};

      // Load table policies from KV
      const tableNames = ['users', 'orders', 'posts', 'sessions']; // Known tables, in production could be dynamic

      for (const tableName of tableNames) {
        const key = `config:table-policies:${tableName}`;
        const yamlContent = await this.env.APP_CACHE.get(key);

        if (yamlContent) {
          const policy = await this.tablePolicyParser.parseTablePolicy(yamlContent, tableName);
          policies[tableName] = policy;
        } else {
          // Fallback to default if not found
          this.log('warn', `Table policy not found in KV for ${tableName}, using default`);
          policies[tableName] = this.tablePolicyParser.getDefaultTablePolicy();
        }
      }

      this.cachedTablePolicies = policies;
      this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;

      this.log('info', 'Table policies loaded', {
        tableCount: Object.keys(policies).length,
      });

      return policies;
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
      const key = 'config:routing-policy';
      const yamlContent = await this.env.APP_CACHE.get(key);

      let policy: RoutingPolicy;
      if (yamlContent) {
        policy = await this.tablePolicyParser.parseRoutingPolicy(yamlContent);
      } else {
        // Fallback to default
        this.log('warn', 'Routing policy not found in KV, using default');
        policy = this.tablePolicyParser.getDefaultRoutingPolicy();
      }

      this.cachedRoutingPolicy = policy;
      this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;

      this.log('info', 'Routing policy loaded', { version: policy.version });

      return policy;
    } catch (error) {
      this.log('error', 'Failed to load routing policy', { error: (error as Error).message });
      throw new EdgeSQLError('Failed to load routing policy', 'CONFIG_LOAD_ERROR');
    }
  }

  /**
   * Determine shard ID for a given table and shard key
   */
  async resolveShardId(tableName: string, shardKey?: string, tenantId?: string): Promise<string> {
    // Attempt to load table policy; if missing, continue with routing defaults
    try {
      await this.getTablePolicy(tableName);
    } catch {
      this.log('warn', 'No table policy found; falling back to routing defaults', { tableName });
    }
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

        // For strong cache mode, ttl/swr may be zero; for others enforce TTL>0 and SWR>TTL
        if (policy.cache.mode !== 'strong') {
          if (policy.cache.ttlMs <= 0) {
            errors.push(`Table ${tableName} has invalid cache TTL`);
          }
          if (policy.cache.swrMs <= policy.cache.ttlMs) {
            errors.push(`Table ${tableName} SWR time must be greater than TTL`);
          }
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
   * Update table policy for a specific table
   */
  async updateTablePolicy(tableName: string, yamlContent: string): Promise<void> {
    try {
      // Validate the YAML by parsing it
      await this.tablePolicyParser.parseTablePolicy(yamlContent, tableName);

      // Store in KV
      const key = `config:table-policies:${tableName}`;
      await this.env.APP_CACHE.put(key, yamlContent);

      // Clear cache to force reload
      this.clearCache();

      this.log('info', 'Table policy updated', { tableName });
    } catch (error) {
      this.log('error', 'Failed to update table policy', {
        tableName,
        error: (error as Error).message,
      });
      throw new EdgeSQLError('Failed to update table policy', 'CONFIG_UPDATE_ERROR');
    }
  }

  /**
   * Update routing policy
   */
  async updateRoutingPolicy(yamlContent: string): Promise<void> {
    try {
      // Validate the YAML by parsing it
      await this.tablePolicyParser.parseRoutingPolicy(yamlContent);

      // Store in KV
      const key = 'config:routing-policy';
      await this.env.APP_CACHE.put(key, yamlContent);

      // Clear cache to force reload
      this.clearCache();

      this.log('info', 'Routing policy updated');
    } catch (error) {
      this.log('error', 'Failed to update routing policy', { error: (error as Error).message });
      throw new EdgeSQLError('Failed to update routing policy', 'CONFIG_UPDATE_ERROR');
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
}

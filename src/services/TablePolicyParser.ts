import { TablePolicy, RoutingPolicy, EdgeSQLError } from '../types';
import { parse as parseYaml } from 'yaml';

/**
 * TablePolicyParser - Parses YAML configuration files for table policies
 *
 * Supports:
 * - YAML-based table policy definitions
 * - Environment variable substitution
 * - Policy validation and defaults
 * - Versioned policy management
 */
export interface ITablePolicyParser {
  /**
   * Parse table policy from YAML string
   */
  parseTablePolicy(yamlContent: string, tableName: string): Promise<TablePolicy>;

  /**
   * Parse routing policy from YAML string
   */
  parseRoutingPolicy(yamlContent: string): Promise<RoutingPolicy>;

  /**
   * Validate table policy structure
   */
  validateTablePolicy(policy: TablePolicy): boolean;

  /**
   * Validate routing policy structure
   */
  validateRoutingPolicy(policy: RoutingPolicy): boolean;

  /**
   * Get default table policy
   */
  getDefaultTablePolicy(): TablePolicy;

  /**
   * Get default routing policy
   */
  getDefaultRoutingPolicy(): RoutingPolicy;
}

/**
 * YAML Table Policy Schema
 */
export interface YamlTablePolicy {
  primary_key?: string;
  shard_by?: string;
  cache?: {
    mode?: 'strong' | 'bounded' | 'cached';
    ttl_ms?: number;
    swr_ms?: number;
    always_strong_columns?: string[];
  };
  routing?: {
    strategy?: 'tenant_hash' | 'table_hash' | 'custom';
    shard_key?: string;
  };
}

/**
 * YAML Routing Policy Schema
 */
export interface YamlRoutingPolicy {
  version?: number;
  tenants?: Record<string, string>;
  ranges?: Array<{
    prefix: string;
    shard: string;
  }>;
  defaults?: {
    shard_count?: number;
    strategy?: string;
  };
}

/**
 * TablePolicyParser implementation
 */
export class TablePolicyParser implements ITablePolicyParser {
  private yamlParser: any = null;

  constructor() {
    // Initialize YAML parser synchronously for immediate availability
    this.initializeYamlParserSync();
  }

  /**
   * Parse table policy from YAML string
   */
  async parseTablePolicy(yamlContent: string, tableName: string): Promise<TablePolicy> {
    try {
      if (!this.yamlParser) {
        throw new EdgeSQLError('YAML parser not available', 'YAML_PARSER_UNAVAILABLE');
      }

      const yamlData = this.yamlParser.parse(yamlContent) as YamlTablePolicy;

      // Apply environment variable substitution
      const processedData = this.substituteEnvironmentVariables(yamlData);

      // Convert to TablePolicy format
      const cacheConfig = processedData.cache || {};
      const policy: TablePolicy = {
        pk: processedData.primary_key || 'id',
        ...(processedData.shard_by && { shardBy: processedData.shard_by }),
        cache: {
          mode: cacheConfig.mode || 'bounded',
          ttlMs: 'ttl_ms' in cacheConfig ? cacheConfig.ttl_ms : 60000,
          swrMs: 'swr_ms' in cacheConfig ? cacheConfig.swr_ms : 300000,
          ...('always_strong_columns' in cacheConfig && {
            alwaysStrongColumns: cacheConfig.always_strong_columns,
          }),
        },
      };

      // Validate the policy
      if (!this.validateTablePolicy(policy)) {
        throw new EdgeSQLError(`Invalid table policy for ${tableName}`, 'INVALID_TABLE_POLICY');
      }

      return policy;
    } catch (error) {
      if (error instanceof EdgeSQLError) {
        throw error;
      }
      throw new EdgeSQLError(
        `Failed to parse table policy for ${tableName}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'TABLE_POLICY_PARSE_ERROR'
      );
    }
  }

  /**
   * Parse routing policy from YAML string
   */
  async parseRoutingPolicy(yamlContent: string): Promise<RoutingPolicy> {
    try {
      if (!this.yamlParser) {
        throw new EdgeSQLError('YAML parser not available', 'YAML_PARSER_UNAVAILABLE');
      }

      const yamlData = this.yamlParser.parse(yamlContent) as YamlRoutingPolicy;

      // Apply environment variable substitution
      const processedData = this.substituteEnvironmentVariables(yamlData);

      // Convert to RoutingPolicy format
      const policy: RoutingPolicy = {
        version: processedData.version || 1,
        tenants: processedData.tenants || {},
        ranges: processedData.ranges || [],
      };

      // Validate the policy
      if (!this.validateRoutingPolicy(policy)) {
        throw new EdgeSQLError('Invalid routing policy', 'INVALID_ROUTING_POLICY');
      }

      return policy;
    } catch (error) {
      if (error instanceof EdgeSQLError) {
        throw error;
      }
      throw new EdgeSQLError(
        `Failed to parse routing policy: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'ROUTING_POLICY_PARSE_ERROR'
      );
    }
  }

  /**
   * Validate table policy structure
   */
  validateTablePolicy(policy: TablePolicy): boolean {
    // Validate primary key
    if (!policy.pk || typeof policy.pk !== 'string') {
      return false;
    }

    // Validate cache policy
    if (!policy.cache) {
      return false;
    }

    const { mode, ttlMs, swrMs } = policy.cache;
    if (!['strong', 'bounded', 'cached'].includes(mode)) {
      return false;
    }

    if (typeof ttlMs !== 'number' || ttlMs < 0) {
      return false;
    }

    if (typeof swrMs !== 'number' || swrMs < 0) {
      return false;
    }

    return true;
  }

  /**
   * Validate routing policy structure
   */
  validateRoutingPolicy(policy: RoutingPolicy): boolean {
    // Validate version
    if (!policy.version || policy.version < 1) {
      return false;
    }

    // Validate tenants mapping
    if (policy.tenants && typeof policy.tenants !== 'object') {
      return false;
    }

    // Validate ranges
    if (!Array.isArray(policy.ranges)) {
      return false;
    }

    if (policy.ranges) {
      for (const range of policy.ranges) {
        if (!range.prefix || !range.shard) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Get default table policy
   */
  getDefaultTablePolicy(): TablePolicy {
    return {
      pk: 'id',
      cache: {
        mode: 'bounded',
        ttlMs: 60000,
        swrMs: 300000,
      },
    };
  }

  /**
   * Get default routing policy
   */
  getDefaultRoutingPolicy(): RoutingPolicy {
    return {
      version: 1,
      tenants: {},
      ranges: [],
    };
  }

  /**
   * Initialize YAML parser synchronously
   */
  private initializeYamlParserSync(): void {
    try {
      // Test seam: allow forcing fallback in tests without affecting production
      if ((globalThis as any).__FORCE_YAML_IMPORT_FAIL) {
        throw new Error('Forced yaml import failure');
      }

      // Use the actual yaml package for parsing
      this.yamlParser = {
        parse: (content: string) => {
          try {
            return parseYaml(content);
          } catch (yamlError) {
            // If YAML parsing fails, try JSON as fallback
            try {
              return JSON.parse(content);
            } catch {
              throw new Error('YAML parsing requires valid YAML or JSON content');
            }
          }
        },
      };
    } catch (_error) {
      console.warn('YAML parser initialization failed, using basic fallback');
      this.yamlParser = {
        parse: (content: string) => {
          try {
            return JSON.parse(content);
          } catch {
            throw new Error('YAML parsing requires yaml package or valid JSON');
          }
        },
      };
    }
  }

  /**
   * Substitute environment variables in YAML data
   */
  private substituteEnvironmentVariables<T>(data: T): T {
    if (typeof data === 'string') {
      // Replace ${VAR_NAME} or $VAR_NAME with environment variables
      return data.replace(/\$\{([^}]+)\}|\$([A-Z_][A-Z0-9_]*)/g, (match) => {
        // In Cloudflare Workers, environment variables are not available via process.env
        // We'll return the original match since env vars should be handled at the Worker level
        return match;
      }) as T;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.substituteEnvironmentVariables(item)) as T;
    }

    if (data && typeof data === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(data)) {
        result[key] = this.substituteEnvironmentVariables(value);
      }
      return result;
    }

    return data;
  }
}

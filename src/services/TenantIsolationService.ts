import { EdgeSQLError } from '../types';
import { BaseService } from './BaseService';
import type { CloudflareEnvironment, AuthContext } from '../types';

/**
 * Tenant isolation enforcement service
 * Ensures strict data separation between tenants
 */
export class TenantIsolationService extends BaseService {
  constructor(env: CloudflareEnvironment) {
    super(env);
  }

  /**
   * Validate tenant access for SQL operations
   */
  validateTenantIsolationAccess(authContext: AuthContext, requestedTenantId?: string): void {
    if (!authContext.tenantId) {
      throw new EdgeSQLError('No tenant context available', 'TENANT_NO_CONTEXT');
    }

    // If specific tenant is requested, verify it matches auth context
    if (requestedTenantId && requestedTenantId !== authContext.tenantId) {
      this.log('warn', 'Cross-tenant access attempt blocked', {
        authTenantId: authContext.tenantId,
        requestedTenantId,
        userId: authContext.userId,
      });

      throw new EdgeSQLError(
        'Access denied: insufficient tenant permissions',
        'TENANT_ACCESS_DENIED'
      );
    }
  }

  /**
   * Add tenant isolation to SQL queries
   * Automatically injects tenant filtering conditions
   */
  enforceTenantIsolation(sql: string, authContext: AuthContext): string {
    if (!authContext.tenantId) {
      throw new EdgeSQLError(
        'Tenant context required for SQL execution',
        'TENANT_CONTEXT_REQUIRED'
      );
    }

    const upperSQL = sql.trim().toUpperCase();

    if (upperSQL.startsWith('SELECT')) {
      return this.addTenantFilterToSelect(sql, authContext.tenantId);
    } else if (upperSQL.startsWith('UPDATE')) {
      return this.addTenantFilterToUpdate(sql, authContext.tenantId);
    } else if (upperSQL.startsWith('DELETE')) {
      return this.addTenantFilterToDelete(sql, authContext.tenantId);
    } else if (upperSQL.startsWith('INSERT')) {
      return this.addTenantFieldToInsert(sql, authContext.tenantId);
    }

    // For DDL operations, validate table naming convention
    if (this.isDDLOperation(upperSQL)) {
      this.validateTenantTableNaming(sql, authContext.tenantId);
    }

    return sql;
  }

  /**
   * Add tenant filter to SELECT queries
   */
  private addTenantFilterToSelect(sql: string, tenantId: string): string {
    // Simple implementation - in production, use proper SQL parser
    const whereIndex = sql.toLowerCase().indexOf(' where ');

    if (whereIndex !== -1) {
      // Add tenant condition to existing WHERE clause
      const beforeWhere = sql.substring(0, whereIndex + 7); // Include ' WHERE '
      const afterWhere = sql.substring(whereIndex + 7);
      return `${beforeWhere}tenant_id = '${this.escapeSqlString(tenantId)}' AND (${afterWhere})`;
    } else {
      // Add WHERE clause with tenant condition
      const fromMatch = sql.toLowerCase().match(/\s+from\s+(\w+)/);
      if (fromMatch) {
        const orderByIndex = sql.toLowerCase().indexOf(' order by');
        const limitIndex = sql.toLowerCase().indexOf(' limit');
        const groupByIndex = sql.toLowerCase().indexOf(' group by');

        // Find the insertion point (before ORDER BY, LIMIT, or GROUP BY)
        let insertionPoint = sql.length;
        [orderByIndex, limitIndex, groupByIndex].forEach((index) => {
          if (index !== -1 && index < insertionPoint) {
            insertionPoint = index;
          }
        });

        const beforeInsertion = sql.substring(0, insertionPoint);
        const afterInsertion = sql.substring(insertionPoint);

        return `${beforeInsertion} WHERE tenant_id = '${this.escapeSqlString(tenantId)}'${afterInsertion}`;
      }
    }

    this.log('warn', 'Could not add tenant isolation to SELECT query', { sql });
    return sql;
  }

  /**
   * Add tenant filter to UPDATE queries
   */
  private addTenantFilterToUpdate(sql: string, tenantId: string): string {
    const whereIndex = sql.toLowerCase().indexOf(' where ');

    if (whereIndex !== -1) {
      // Add tenant condition to existing WHERE clause
      const beforeWhere = sql.substring(0, whereIndex + 7);
      const afterWhere = sql.substring(whereIndex + 7);
      return `${beforeWhere}tenant_id = '${this.escapeSqlString(tenantId)}' AND (${afterWhere})`;
    } else {
      // Add WHERE clause with tenant condition
      return `${sql} WHERE tenant_id = '${this.escapeSqlString(tenantId)}'`;
    }
  }

  /**
   * Add tenant filter to DELETE queries
   */
  private addTenantFilterToDelete(sql: string, tenantId: string): string {
    const whereIndex = sql.toLowerCase().indexOf(' where ');

    if (whereIndex !== -1) {
      // Add tenant condition to existing WHERE clause
      const beforeWhere = sql.substring(0, whereIndex + 7);
      const afterWhere = sql.substring(whereIndex + 7);
      return `${beforeWhere}tenant_id = '${this.escapeSqlString(tenantId)}' AND (${afterWhere})`;
    } else {
      // Add WHERE clause with tenant condition
      return `${sql} WHERE tenant_id = '${this.escapeSqlString(tenantId)}'`;
    }
  }

  /**
   * Add tenant field to INSERT queries
   */
  private addTenantFieldToInsert(sql: string, tenantId: string): string {
    // Match INSERT INTO table (columns) VALUES (values)
    const insertMatch = sql.match(/INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);

    if (insertMatch) {
      const [, table, columns, values] = insertMatch;

      // Check if tenant_id is already present
      if (columns && columns.toLowerCase().includes('tenant_id')) {
        return sql; // Already has tenant_id
      }

      // Add tenant_id to columns and values
      const newColumns = `${columns}, tenant_id`;
      const newValues = `${values}, '${this.escapeSqlString(tenantId)}'`;

      return sql.replace(
        insertMatch[0],
        `INSERT INTO ${table} (${newColumns}) VALUES (${newValues})`
      );
    }

    // Handle INSERT without column specification
    const simpleInsertMatch = sql.match(/INSERT\s+INTO\s+(\w+)\s+VALUES\s*\(([^)]+)\)/i);
    if (simpleInsertMatch) {
      this.log(
        'warn',
        'INSERT without column specification detected - cannot add tenant isolation',
        { sql }
      );
    }

    return sql;
  }

  /**
   * Check if operation is DDL
   */
  private isDDLOperation(sql: string): boolean {
    const ddlKeywords = ['CREATE', 'ALTER', 'DROP', 'TRUNCATE'];
    return ddlKeywords.some((keyword) => sql.startsWith(keyword));
  }

  /**
   * Validate tenant table naming convention
   */
  private validateTenantTableNaming(sql: string, tenantId: string): void {
    // Extract table name from DDL
    const tableMatch = sql.match(
      /(?:CREATE|ALTER|DROP)\s+TABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(\w+)/i
    );

    if (tableMatch) {
      const tableName = tableMatch[1];

      // Enforce tenant prefix in table names for some operations
      if (tableName && sql.toUpperCase().startsWith('CREATE TABLE')) {
        if (!tableName.startsWith(`${tenantId}_`) && !this.isSystemTable(tableName)) {
          this.log('warn', 'Table name should include tenant prefix', {
            tableName,
            tenantId,
            suggestedName: `${tenantId}_${tableName}`,
          });
        }
      }
    }
  }

  /**
   * Check if table is a system table that doesn't need tenant prefix
   */
  private isSystemTable(tableName: string): boolean {
    const systemTables = ['migrations', 'schema_versions', 'system_config'];
    return systemTables.includes(tableName.toLowerCase());
  }

  /**
   * Escape SQL string to prevent injection
   */
  private escapeSqlString(value: string): string {
    return value.replace(/'/g, "''");
  }

  /**
   * Generate tenant-specific cache key
   */
  generateTenantCacheKey(tenantId: string, baseKey: string): string {
    return `tenant:${tenantId}:${baseKey}`;
  }

  /**
   * Validate that shard assignment matches tenant
   */
  validateShardTenantMapping(shardId: string, tenantId: string): void {
    // Implement shard-tenant validation logic
    // This would typically check against a tenant-shard mapping table

    // Simple hash-based validation for now
    const expectedShard = this.calculateTenantShard(tenantId);

    if (shardId !== expectedShard) {
      throw new EdgeSQLError(
        `Tenant ${tenantId} should not access shard ${shardId}`,
        'TENANT_SHARD_MISMATCH'
      );
    }
  }

  /**
   * Calculate expected shard for tenant
   */
  private calculateTenantShard(tenantId: string): string {
    // Use same hash algorithm as routing service
    let hash = 0;
    for (let i = 0; i < tenantId.length; i++) {
      const char = tenantId.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    const shardCount = parseInt(this.env.SHARD_COUNT || '4');
    const shardIndex = Math.abs(hash) % shardCount;

    return `shard_${shardIndex}`;
  }

  /**
   * Validate cross-tenant operation request
   */
  validateCrossTenantOperation(
    authContext: AuthContext,
    operation: string,
    targetTenantIds: string[]
  ): void {
    // Only allow cross-tenant operations for specific roles
    const allowedRoles = ['super_admin', 'system_admin'];
    const hasPermission = authContext.permissions.some((permission) =>
      allowedRoles.includes(permission)
    );

    if (!hasPermission) {
      throw new EdgeSQLError(
        'Cross-tenant operations require administrative privileges',
        'TENANT_CROSS_ACCESS_DENIED'
      );
    }

    this.log('info', 'Cross-tenant operation authorized', {
      operation,
      authTenantId: authContext.tenantId,
      targetTenantIds,
      userId: authContext.userId,
    });
  }

  /**
   * Audit tenant access attempt
   */
  auditTenantAccess(
    authContext: AuthContext,
    operation: string,
    resource: string,
    success: boolean,
    details?: Record<string, unknown>
  ): void {
    const auditLog = {
      timestamp: new Date().toISOString(),
      tenantId: authContext.tenantId,
      userId: authContext.userId,
      operation,
      resource,
      success,
      details,
    };

    // In production, this would be sent to an audit logging system
    this.log('info', 'Tenant access audit', auditLog);

    // Could also store in KV for compliance requirements
    if (this.env.ENVIRONMENT === 'production') {
      const auditKey = `audit:${authContext.tenantId}:${Date.now()}:${Math.random()}`;
      // Fire and forget - don't block on audit logging
      this.env.APP_CACHE.put(auditKey, JSON.stringify(auditLog), {
        expirationTtl: 86400 * 30, // 30 days retention
      }).catch((error) => {
        this.log('warn', 'Failed to store audit log', { error });
      });
    }
  }
}

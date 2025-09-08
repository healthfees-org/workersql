import { EdgeSQLError } from '../types';
import { BaseService } from './BaseService';
import type { CloudflareEnvironment, AuthContext } from '../types';

/**
 * Role-Based Access Control system with JSON schema-based permissions
 */

// RBAC Data Model Schema
export interface RBACSchema {
  version: string;
  roles: Record<string, Role>;
  permissions: Record<string, Permission>;
  resources: Record<string, Resource>;
  policies: Policy[];
}

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  inherits?: string[]; // Role inheritance
  metadata?: Record<string, unknown>;
}

export interface Permission {
  id: string;
  name: string;
  description: string;
  action: string; // e.g., 'read', 'write', 'delete', 'admin'
  resource: string; // Resource type or specific resource
  conditions?: Condition[];
}

export interface Resource {
  id: string;
  type: string; // e.g., 'table', 'database', 'tenant'
  name: string;
  attributes?: Record<string, unknown>;
}

export interface Policy {
  id: string;
  name: string;
  effect: 'allow' | 'deny';
  subjects: string[]; // Role IDs or user IDs
  actions: string[];
  resources: string[];
  conditions?: Condition[];
}

export interface Condition {
  field: string;
  operator: 'eq' | 'ne' | 'in' | 'not_in' | 'contains' | 'starts_with' | 'regex';
  value: unknown;
}

export interface AccessRequest {
  action: string;
  resource: string;
  context?: Record<string, unknown>;
}

export interface AccessDecision {
  allowed: boolean;
  reason: string;
  appliedPolicies: string[];
  conditions?: string[];
}

/**
 * RBAC Service for permission management and access control
 */
export class RBACService extends BaseService {
  private schemaCache: Map<string, RBACSchema> = new Map();

  constructor(env: CloudflareEnvironment) {
    super(env);
  }

  /**
   * Load RBAC schema from KV storage or default configuration
   */
  async loadSchema(tenantId: string): Promise<RBACSchema> {
    const cacheKey = `rbac_schema_${tenantId}`;

    // Check cache first
    if (this.schemaCache.has(cacheKey)) {
      return this.schemaCache.get(cacheKey)!;
    }

    try {
      // Load from KV storage
      const schemaData = await this.env.APP_CACHE.get(`rbac:schema:${tenantId}`, 'json');

      if (schemaData) {
        const schema = schemaData as RBACSchema;
        this.validateSchema(schema);
        this.schemaCache.set(cacheKey, schema);
        return schema;
      }
    } catch (error) {
      this.log('warn', 'Failed to load RBAC schema from KV, using default', { tenantId, error });
    }

    // Fallback to default schema
    const defaultSchema = this.getDefaultSchema();
    this.schemaCache.set(cacheKey, defaultSchema);
    return defaultSchema;
  }

  /**
   * Check if user has permission for specific action on resource
   */
  async checkPermission(authContext: AuthContext, request: AccessRequest): Promise<AccessDecision> {
    try {
      const schema = await this.loadSchema(authContext.tenantId);

      // Get all user roles (including inherited)
      const userRoles = await this.resolveUserRoles(authContext, schema);

      // Get all permissions for user roles
      const userPermissions = this.resolveRolePermissions(userRoles, schema);

      // Evaluate policies
      const decision = this.evaluatePolicies(authContext, request, userPermissions, schema);

      this.log('info', 'Access decision made', {
        tenantId: authContext.tenantId,
        userId: authContext.userId,
        action: request.action,
        resource: request.resource,
        allowed: decision.allowed,
        reason: decision.reason,
      });

      return decision;
    } catch (error) {
      this.log('error', 'Permission check failed', { error: (error as Error).message });

      // Fail closed - deny access on error
      return {
        allowed: false,
        reason: 'Permission check failed',
        appliedPolicies: [],
      };
    }
  }

  /**
   * Get all roles for user including inherited roles
   */
  private async resolveUserRoles(authContext: AuthContext, schema: RBACSchema): Promise<Role[]> {
    const userRoleIds = authContext.permissions; // Assuming permissions contain role IDs
    const resolvedRoles: Role[] = [];
    const visited = new Set<string>();

    const resolveRole = (roleId: string): void => {
      if (visited.has(roleId)) {
        return;
      }
      visited.add(roleId);

      const role = schema.roles[roleId];
      if (role) {
        resolvedRoles.push(role);

        // Resolve inherited roles
        if (role.inherits) {
          role.inherits.forEach((inheritedRoleId) => {
            resolveRole(inheritedRoleId);
          });
        }
      }
    };

    userRoleIds.forEach((roleId) => resolveRole(roleId));

    return resolvedRoles;
  }

  /**
   * Get all permissions for given roles
   */
  private resolveRolePermissions(roles: Role[], schema: RBACSchema): Permission[] {
    const permissions: Permission[] = [];
    const permissionIds = new Set<string>();

    roles.forEach((role) => {
      role.permissions.forEach((permissionId) => {
        if (!permissionIds.has(permissionId)) {
          const permission = schema.permissions[permissionId];
          if (permission) {
            permissions.push(permission);
            permissionIds.add(permissionId);
          }
        }
      });
    });

    return permissions;
  }

  /**
   * Evaluate policies to make access decision
   */
  private evaluatePolicies(
    authContext: AuthContext,
    request: AccessRequest,
    permissions: Permission[],
    schema: RBACSchema
  ): AccessDecision {
    const appliedPolicies: string[] = [];
    const conditions: string[] = [];

    // Check direct permissions first
    const hasDirectPermission = permissions.some((permission) => {
      const actionMatch = permission.action === request.action || permission.action === '*';
      const resourceMatch = this.matchResource(permission.resource, request.resource);

      if (actionMatch && resourceMatch) {
        // Evaluate conditions if present
        if (permission.conditions) {
          const conditionsMet = this.evaluateConditions(
            permission.conditions,
            authContext,
            request
          );
          if (conditionsMet.success) {
            conditions.push(...conditionsMet.messages);
            return true;
          }
          conditions.push(...conditionsMet.messages);
          return false;
        }
        return true;
      }
      return false;
    });

    if (hasDirectPermission) {
      return {
        allowed: true,
        reason: 'Direct permission granted',
        appliedPolicies,
        conditions,
      };
    }

    // Evaluate explicit policies
    for (const policy of schema.policies) {
      if (this.policyApplies(policy, authContext, request)) {
        appliedPolicies.push(policy.id);

        // Evaluate policy conditions
        if (policy.conditions) {
          const conditionResult = this.evaluateConditions(policy.conditions, authContext, request);
          conditions.push(...conditionResult.messages);

          if (!conditionResult.success) {
            continue;
          }
        }

        if (policy.effect === 'deny') {
          return {
            allowed: false,
            reason: `Access denied by policy: ${policy.name}`,
            appliedPolicies,
            conditions,
          };
        }

        if (policy.effect === 'allow') {
          return {
            allowed: true,
            reason: `Access granted by policy: ${policy.name}`,
            appliedPolicies,
            conditions,
          };
        }
      }
    }

    // Default deny
    return {
      allowed: false,
      reason: 'No matching permissions or policies found',
      appliedPolicies,
      conditions,
    };
  }

  /**
   * Check if policy applies to current request
   */
  private policyApplies(policy: Policy, authContext: AuthContext, request: AccessRequest): boolean {
    // Check if user/role is subject of policy
    const subjectMatch = policy.subjects.some((subject) => {
      return authContext.permissions.includes(subject) || authContext.userId === subject;
    });

    if (!subjectMatch) {
      return false;
    }

    // Check action match
    const actionMatch = policy.actions.includes(request.action) || policy.actions.includes('*');
    if (!actionMatch) {
      return false;
    }

    // Check resource match
    const resourceMatch = policy.resources.some((resource) =>
      this.matchResource(resource, request.resource)
    );

    return resourceMatch;
  }

  /**
   * Match resource patterns
   */
  private matchResource(pattern: string, resource: string): boolean {
    if (pattern === '*') {
      return true;
    }
    if (pattern === resource) {
      return true;
    }

    // Support wildcard patterns
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(resource);
    }

    return false;
  }

  /**
   * Evaluate conditions
   */
  private evaluateConditions(
    conditions: Condition[],
    authContext: AuthContext,
    request: AccessRequest
  ): { success: boolean; messages: string[] } {
    const messages: string[] = [];

    for (const condition of conditions) {
      const contextValue = this.getContextValue(condition.field, authContext, request);
      const result = this.evaluateCondition(condition, contextValue);

      messages.push(
        `Condition ${condition.field} ${condition.operator} ${condition.value}: ${result}`
      );

      if (!result) {
        return { success: false, messages };
      }
    }

    return { success: true, messages };
  }

  /**
   * Get value from context for condition evaluation
   */
  private getContextValue(
    field: string,
    authContext: AuthContext,
    request: AccessRequest
  ): unknown {
    // Support dot notation for nested fields
    const parts = field.split('.');
    let value: Record<string, unknown> | AuthContext | AccessRequest = {
      auth: authContext,
      request: request,
      context: request.context || {},
    };

    for (const part of parts) {
      if (typeof value === 'object' && value !== null && part in value) {
        value = (value as Record<string, unknown>)[part] as Record<string, unknown>;
      } else {
        return undefined;
      }
    }

    return value;
  }

  /**
   * Evaluate single condition
   */
  private evaluateCondition(condition: Condition, value: unknown): boolean {
    switch (condition.operator) {
      case 'eq':
        return value === condition.value;
      case 'ne':
        return value !== condition.value;
      case 'in':
        return Array.isArray(condition.value) && condition.value.includes(value);
      case 'not_in':
        return Array.isArray(condition.value) && !condition.value.includes(value);
      case 'contains':
        return (
          typeof value === 'string' &&
          typeof condition.value === 'string' &&
          value.includes(condition.value)
        );
      case 'starts_with':
        return (
          typeof value === 'string' &&
          typeof condition.value === 'string' &&
          value.startsWith(condition.value)
        );
      case 'regex':
        return (
          typeof value === 'string' &&
          typeof condition.value === 'string' &&
          new RegExp(condition.value).test(value)
        );
      default:
        return false;
    }
  }

  /**
   * Validate RBAC schema structure
   */
  private validateSchema(schema: RBACSchema): void {
    if (!schema.version || !schema.roles || !schema.permissions) {
      throw new EdgeSQLError('Invalid RBAC schema structure', 'RBAC_INVALID_SCHEMA');
    }

    // Additional validation can be added here
  }

  /**
   * Get default RBAC schema for new tenants
   */
  private getDefaultSchema(): RBACSchema {
    return {
      version: '1.0',
      roles: {
        admin: {
          id: 'admin',
          name: 'Administrator',
          description: 'Full system access',
          permissions: ['admin_all'],
        },
        user: {
          id: 'user',
          name: 'Standard User',
          description: 'Basic read/write access',
          permissions: ['read_own_data', 'write_own_data'],
        },
        readonly: {
          id: 'readonly',
          name: 'Read Only',
          description: 'Read-only access',
          permissions: ['read_own_data'],
        },
      },
      permissions: {
        admin_all: {
          id: 'admin_all',
          name: 'Admin All',
          description: 'All administrative permissions',
          action: '*',
          resource: '*',
        },
        read_own_data: {
          id: 'read_own_data',
          name: 'Read Own Data',
          description: 'Read access to own data',
          action: 'read',
          resource: '*',
          conditions: [
            {
              field: 'auth.tenantId',
              operator: 'eq',
              value: '{{tenant_id}}',
            },
          ],
        },
        write_own_data: {
          id: 'write_own_data',
          name: 'Write Own Data',
          description: 'Write access to own data',
          action: 'write',
          resource: '*',
          conditions: [
            {
              field: 'auth.tenantId',
              operator: 'eq',
              value: '{{tenant_id}}',
            },
          ],
        },
      },
      resources: {
        tables: {
          id: 'tables',
          type: 'database',
          name: 'Database Tables',
        },
      },
      policies: [
        {
          id: 'default_deny',
          name: 'Default Deny',
          effect: 'deny',
          subjects: ['*'],
          actions: ['*'],
          resources: ['*'],
        },
      ],
    };
  }

  /**
   * Update RBAC schema for tenant
   */
  async updateSchema(tenantId: string, schema: RBACSchema): Promise<void> {
    this.validateSchema(schema);

    await this.env.APP_CACHE.put(
      `rbac:schema:${tenantId}`,
      JSON.stringify(schema),
      { expirationTtl: 86400 } // 24 hours
    );

    // Clear cache
    this.schemaCache.delete(`rbac_schema_${tenantId}`);

    this.log('info', 'RBAC schema updated', { tenantId, version: schema.version });
  }
}

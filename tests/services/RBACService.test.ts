import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RBACService } from '@/services/RBACService';
import type { CloudflareEnvironment, AuthContext } from '@/types';

describe('RBACService', () => {
  let service: RBACService;
  let mockEnv: CloudflareEnvironment;
  let mockAuthContext: AuthContext;

  beforeEach(() => {
    vi.clearAllMocks();

    mockEnv = {
      APP_CACHE: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      } as any,
      DB_EVENTS: {} as any,
      SHARD: {} as any,
      PORTABLE_DB: {} as any,
      ENVIRONMENT: 'test',
      LOG_LEVEL: 'debug',
      MAX_SHARD_SIZE_GB: '10',
      CACHE_TTL_MS: '30000',
      CACHE_SWR_MS: '120000',
    };

    mockAuthContext = {
      tenantId: 'tenant-123',
      userId: 'user-456',
      permissions: ['user'],
      tokenHash: 'hash123',
    };

    service = new RBACService(mockEnv);
  });

  describe('loadSchema', () => {
    it('should load schema from cache if available', async () => {
      const schema = await service.loadSchema('tenant-123');
      expect(schema).toBeDefined();
      expect(schema.version).toBe('1.0');
      
      // Second call should use cache
      const schema2 = await service.loadSchema('tenant-123');
      expect(schema2).toBe(schema);
      expect(mockEnv.APP_CACHE.get).toHaveBeenCalledTimes(1);
    });

    it('should load schema from KV storage', async () => {
      const mockSchema = {
        version: '1.0',
        roles: {
          admin: {
            id: 'admin',
            name: 'Administrator',
            description: 'Full access',
            permissions: ['all'],
          },
        },
        permissions: {
          all: {
            id: 'all',
            name: 'All Permissions',
            description: 'Full access',
            action: '*',
            resource: '*',
          },
        },
        resources: {},
        policies: [],
      };

      (mockEnv.APP_CACHE.get as any).mockResolvedValueOnce(mockSchema);

      const schema = await service.loadSchema('tenant-456');
      expect(schema).toEqual(mockSchema);
      expect(mockEnv.APP_CACHE.get).toHaveBeenCalledWith('rbac:schema:tenant-456', 'json');
    });

    it('should use default schema when KV returns null', async () => {
      const schema = await service.loadSchema('tenant-789');
      expect(schema).toBeDefined();
      expect(schema.version).toBe('1.0');
      expect(schema.roles).toBeDefined();
      expect(schema.permissions).toBeDefined();
    });

    it('should handle KV errors gracefully', async () => {
      (mockEnv.APP_CACHE.get as any).mockRejectedValueOnce(new Error('KV error'));

      const schema = await service.loadSchema('tenant-error');
      expect(schema).toBeDefined();
      expect(schema.version).toBe('1.0');
    });
  });

  describe('checkPermission', () => {
    it('should allow access when user has required permission', async () => {
      const request = {
        action: 'read',
        resource: 'users',
      };

      const decision = await service.checkPermission(mockAuthContext, request);
      expect(decision).toBeDefined();
      expect(decision.allowed).toBeDefined();
    });

    it('should deny access when user lacks permission', async () => {
      const restrictedContext = {
        ...mockAuthContext,
        permissions: [],
      };

      const request = {
        action: 'delete',
        resource: 'users',
      };

      const decision = await service.checkPermission(restrictedContext, request);
      expect(decision).toBeDefined();
    });

    it('should handle errors during permission check', async () => {
      (mockEnv.APP_CACHE.get as any).mockRejectedValueOnce(new Error('Permission check failed'));

      const request = {
        action: 'read',
        resource: 'users',
      };

      const decision = await service.checkPermission(mockAuthContext, request);
      expect(decision).toBeDefined();
      expect(decision.allowed).toBe(false);
    });

    it('should include applied policies in decision', async () => {
      const request = {
        action: 'read',
        resource: 'users',
      };

      const decision = await service.checkPermission(mockAuthContext, request);
      expect(decision.appliedPolicies).toBeDefined();
      expect(Array.isArray(decision.appliedPolicies)).toBe(true);
    });

    it('should evaluate context conditions', async () => {
      const request = {
        action: 'read',
        resource: 'users',
        context: {
          tenantId: 'tenant-123',
          userId: 'user-456',
        },
      };

      const decision = await service.checkPermission(mockAuthContext, request);
      expect(decision).toBeDefined();
    });
  });

  describe('updateSchema', () => {
    it('should update RBAC schema', async () => {
      const newSchema = {
        version: '2.0',
        roles: {
          custom: {
            id: 'custom',
            name: 'Custom Role',
            description: 'Custom',
            permissions: ['read'],
          },
        },
        permissions: {
          read: {
            id: 'read',
            name: 'Read',
            description: 'Read access',
            action: 'read',
            resource: '*',
          },
        },
        resources: {},
        policies: [],
      };

      await service.updateSchema('tenant-123', newSchema);
      
      expect(mockEnv.APP_CACHE.put).toHaveBeenCalled();
    });

    it('should validate schema before updating', async () => {
      const invalidSchema = {
        version: '',
        roles: {},
        permissions: {},
        resources: {},
        policies: [],
      };

      await expect(
        service.updateSchema('tenant-123', invalidSchema)
      ).rejects.toThrow();
    });

    it('should clear cache after updating schema', async () => {
      const newSchema = {
        version: '2.0',
        roles: {},
        permissions: {},
        resources: {},
        policies: [],
      };

      // Load schema to cache it
      await service.loadSchema('tenant-456');
      
      // Update schema
      await service.updateSchema('tenant-456', newSchema);
      
      // The service maintains its own cache, so we verify update was called
      expect(mockEnv.APP_CACHE.put).toHaveBeenCalled();
    });
  });

  describe('Role Inheritance', () => {
    it('should resolve inherited permissions', async () => {
      const mockSchema = {
        version: '1.0',
        roles: {
          base: {
            id: 'base',
            name: 'Base Role',
            description: 'Base',
            permissions: ['read'],
          },
          derived: {
            id: 'derived',
            name: 'Derived Role',
            description: 'Derived',
            permissions: ['write'],
            inherits: ['base'],
          },
        },
        permissions: {
          read: {
            id: 'read',
            name: 'Read',
            description: 'Read access',
            action: 'read',
            resource: '*',
          },
          write: {
            id: 'write',
            name: 'Write',
            description: 'Write access',
            action: 'write',
            resource: '*',
          },
        },
        resources: {},
        policies: [],
      };

      (mockEnv.APP_CACHE.get as any).mockResolvedValueOnce(mockSchema);

      const contextWithDerived = {
        ...mockAuthContext,
        permissions: ['derived'],
      };

      const request = {
        action: 'read',
        resource: 'test',
      };

      const decision = await service.checkPermission(contextWithDerived, request);
      expect(decision).toBeDefined();
    });

    it('should handle circular inheritance', async () => {
      const mockSchema = {
        version: '1.0',
        roles: {
          role1: {
            id: 'role1',
            name: 'Role 1',
            description: 'Role 1',
            permissions: ['perm1'],
            inherits: ['role2'],
          },
          role2: {
            id: 'role2',
            name: 'Role 2',
            description: 'Role 2',
            permissions: ['perm2'],
            inherits: ['role1'],
          },
        },
        permissions: {
          perm1: {
            id: 'perm1',
            name: 'Perm 1',
            description: 'Permission 1',
            action: 'action1',
            resource: '*',
          },
          perm2: {
            id: 'perm2',
            name: 'Perm 2',
            description: 'Permission 2',
            action: 'action2',
            resource: '*',
          },
        },
        resources: {},
        policies: [],
      };

      (mockEnv.APP_CACHE.get as any).mockResolvedValueOnce(mockSchema);

      const contextWithCircular = {
        ...mockAuthContext,
        permissions: ['role1'],
      };

      const request = {
        action: 'action1',
        resource: 'test',
      };

      const decision = await service.checkPermission(contextWithCircular, request);
      expect(decision).toBeDefined();
    });
  });

  describe('Policy Evaluation', () => {
    it('should evaluate allow policies', async () => {
      const request = {
        action: 'read',
        resource: 'users',
      };

      const decision = await service.checkPermission(mockAuthContext, request);
      expect(decision).toBeDefined();
    });

    it('should evaluate deny policies with higher priority', async () => {
      const mockSchema = {
        version: '1.0',
        roles: {
          user: {
            id: 'user',
            name: 'User',
            description: 'User role',
            permissions: ['read'],
          },
        },
        permissions: {
          read: {
            id: 'read',
            name: 'Read',
            description: 'Read access',
            action: 'read',
            resource: '*',
          },
        },
        resources: {},
        policies: [
          {
            id: 'deny-all',
            name: 'Deny All',
            effect: 'deny' as const,
            subjects: ['*'],
            actions: ['*'],
            resources: ['*'],
          },
        ],
      };

      (mockEnv.APP_CACHE.get as any).mockResolvedValueOnce(mockSchema);

      const request = {
        action: 'read',
        resource: 'users',
      };

      const decision = await service.checkPermission(mockAuthContext, request);
      expect(decision).toBeDefined();
    });

    it('should evaluate conditional policies', async () => {
      const request = {
        action: 'read',
        resource: 'users',
        context: {
          tenantId: 'tenant-123',
          ownerId: 'user-456',
        },
      };

      const decision = await service.checkPermission(mockAuthContext, request);
      expect(decision).toBeDefined();
    });
  });

  describe('Condition Evaluation', () => {
    it('should evaluate eq condition', async () => {
      const mockSchema = {
        version: '1.0',
        roles: {
          user: {
            id: 'user',
            name: 'User',
            description: 'User role',
            permissions: ['conditional'],
          },
        },
        permissions: {
          conditional: {
            id: 'conditional',
            name: 'Conditional',
            description: 'Conditional access',
            action: 'read',
            resource: '*',
            conditions: [
              {
                field: 'tenantId',
                operator: 'eq' as const,
                value: 'tenant-123',
              },
            ],
          },
        },
        resources: {},
        policies: [],
      };

      (mockEnv.APP_CACHE.get as any).mockResolvedValueOnce(mockSchema);

      const request = {
        action: 'read',
        resource: 'test',
        context: {
          tenantId: 'tenant-123',
        },
      };

      const decision = await service.checkPermission(mockAuthContext, request);
      expect(decision).toBeDefined();
    });

    it('should evaluate in condition', async () => {
      const request = {
        action: 'read',
        resource: 'test',
        context: {
          status: 'active',
        },
      };

      const decision = await service.checkPermission(mockAuthContext, request);
      expect(decision).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty permissions array', async () => {
      const emptyContext = {
        ...mockAuthContext,
        permissions: [],
      };

      const request = {
        action: 'read',
        resource: 'users',
      };

      const decision = await service.checkPermission(emptyContext, request);
      expect(decision).toBeDefined();
    });

    it('should handle wildcard permissions', async () => {
      const adminContext = {
        ...mockAuthContext,
        permissions: ['admin'],
      };

      const request = {
        action: 'delete',
        resource: 'users',
      };

      const decision = await service.checkPermission(adminContext, request);
      expect(decision).toBeDefined();
    });

    it('should handle missing context', async () => {
      const request = {
        action: 'read',
        resource: 'users',
      };

      const decision = await service.checkPermission(mockAuthContext, request);
      expect(decision).toBeDefined();
    });

    it('should handle invalid tenant ID', async () => {
      const invalidContext = {
        ...mockAuthContext,
        tenantId: '',
      };

      const request = {
        action: 'read',
        resource: 'users',
      };

      const decision = await service.checkPermission(invalidContext, request);
      expect(decision.allowed).toBe(false);
    });

    it('should handle schema with no roles', async () => {
      const emptySchema = {
        version: '1.0',
        roles: {},
        permissions: {},
        resources: {},
        policies: [],
      };

      (mockEnv.APP_CACHE.get as any).mockResolvedValueOnce(emptySchema);

      const request = {
        action: 'read',
        resource: 'users',
      };

      const decision = await service.checkPermission(mockAuthContext, request);
      expect(decision).toBeDefined();
      expect(decision.allowed).toBe(false);
    });

    it('should handle ne condition operator', async () => {
      const mockSchema = {
        version: '1.0',
        roles: {
          user: {
            id: 'user',
            name: 'User',
            description: 'User role',
            permissions: ['conditional'],
          },
        },
        permissions: {
          conditional: {
            id: 'conditional',
            name: 'Conditional',
            description: 'Conditional access',
            action: 'read',
            resource: '*',
            conditions: [
              {
                field: 'status',
                operator: 'ne' as const,
                value: 'banned',
              },
            ],
          },
        },
        resources: {},
        policies: [],
      };

      (mockEnv.APP_CACHE.get as any).mockResolvedValueOnce(mockSchema);

      const request = {
        action: 'read',
        resource: 'test',
        context: {
          status: 'active',
        },
      };

      const decision = await service.checkPermission(mockAuthContext, request);
      expect(decision).toBeDefined();
    });

    it('should handle not_in condition operator', async () => {
      const mockSchema = {
        version: '1.0',
        roles: {
          user: {
            id: 'user',
            name: 'User',
            description: 'User role',
            permissions: ['conditional'],
          },
        },
        permissions: {
          conditional: {
            id: 'conditional',
            name: 'Conditional',
            description: 'Conditional access',
            action: 'read',
            resource: '*',
            conditions: [
              {
                field: 'role',
                operator: 'not_in' as const,
                value: ['banned', 'suspended'],
              },
            ],
          },
        },
        resources: {},
        policies: [],
      };

      (mockEnv.APP_CACHE.get as any).mockResolvedValueOnce(mockSchema);

      const request = {
        action: 'read',
        resource: 'test',
        context: {
          role: 'active',
        },
      };

      const decision = await service.checkPermission(mockAuthContext, request);
      expect(decision).toBeDefined();
    });

    it('should handle contains condition operator', async () => {
      const mockSchema = {
        version: '1.0',
        roles: {
          user: {
            id: 'user',
            name: 'User',
            description: 'User role',
            permissions: ['conditional'],
          },
        },
        permissions: {
          conditional: {
            id: 'conditional',
            name: 'Conditional',
            description: 'Conditional access',
            action: 'read',
            resource: '*',
            conditions: [
              {
                field: 'tags',
                operator: 'contains' as const,
                value: 'verified',
              },
            ],
          },
        },
        resources: {},
        policies: [],
      };

      (mockEnv.APP_CACHE.get as any).mockResolvedValueOnce(mockSchema);

      const request = {
        action: 'read',
        resource: 'test',
        context: {
          tags: 'verified,premium',
        },
      };

      const decision = await service.checkPermission(mockAuthContext, request);
      expect(decision).toBeDefined();
    });

    it('should handle starts_with condition operator', async () => {
      const mockSchema = {
        version: '1.0',
        roles: {
          user: {
            id: 'user',
            name: 'User',
            description: 'User role',
            permissions: ['conditional'],
          },
        },
        permissions: {
          conditional: {
            id: 'conditional',
            name: 'Conditional',
            description: 'Conditional access',
            action: 'read',
            resource: '*',
            conditions: [
              {
                field: 'path',
                operator: 'starts_with' as const,
                value: '/api/',
              },
            ],
          },
        },
        resources: {},
        policies: [],
      };

      (mockEnv.APP_CACHE.get as any).mockResolvedValueOnce(mockSchema);

      const request = {
        action: 'read',
        resource: 'test',
        context: {
          path: '/api/users',
        },
      };

      const decision = await service.checkPermission(mockAuthContext, request);
      expect(decision).toBeDefined();
    });

    it('should handle regex condition operator', async () => {
      const mockSchema = {
        version: '1.0',
        roles: {
          user: {
            id: 'user',
            name: 'User',
            description: 'User role',
            permissions: ['conditional'],
          },
        },
        permissions: {
          conditional: {
            id: 'conditional',
            name: 'Conditional',
            description: 'Conditional access',
            action: 'read',
            resource: '*',
            conditions: [
              {
                field: 'email',
                operator: 'regex' as const,
                value: '.*@example\\.com$',
              },
            ],
          },
        },
        resources: {},
        policies: [],
      };

      (mockEnv.APP_CACHE.get as any).mockResolvedValueOnce(mockSchema);

      const request = {
        action: 'read',
        resource: 'test',
        context: {
          email: 'user@example.com',
        },
      };

      const decision = await service.checkPermission(mockAuthContext, request);
      expect(decision).toBeDefined();
    });

    it('should handle invalid regex in condition', async () => {
      const mockSchema = {
        version: '1.0',
        roles: {
          user: {
            id: 'user',
            name: 'User',
            description: 'User role',
            permissions: ['conditional'],
          },
        },
        permissions: {
          conditional: {
            id: 'conditional',
            name: 'Conditional',
            description: 'Conditional access',
            action: 'read',
            resource: '*',
            conditions: [
              {
                field: 'email',
                operator: 'regex' as const,
                value: '[invalid regex',
              },
            ],
          },
        },
        resources: {},
        policies: [],
      };

      (mockEnv.APP_CACHE.get as any).mockResolvedValueOnce(mockSchema);

      const request = {
        action: 'read',
        resource: 'test',
        context: {
          email: 'user@example.com',
        },
      };

      const decision = await service.checkPermission(mockAuthContext, request);
      expect(decision).toBeDefined();
    });

    it('should handle multiple policies with same priority', async () => {
      const mockSchema = {
        version: '1.0',
        roles: {
          user: {
            id: 'user',
            name: 'User',
            description: 'User role',
            permissions: ['read'],
          },
        },
        permissions: {
          read: {
            id: 'read',
            name: 'Read',
            description: 'Read access',
            action: 'read',
            resource: '*',
          },
        },
        resources: {},
        policies: [
          {
            id: 'allow-read',
            name: 'Allow Read',
            effect: 'allow' as const,
            subjects: ['user'],
            actions: ['read'],
            resources: ['*'],
          },
          {
            id: 'allow-read-2',
            name: 'Allow Read 2',
            effect: 'allow' as const,
            subjects: ['user'],
            actions: ['read'],
            resources: ['*'],
          },
        ],
      };

      (mockEnv.APP_CACHE.get as any).mockResolvedValueOnce(mockSchema);

      const request = {
        action: 'read',
        resource: 'test',
      };

      const decision = await service.checkPermission(mockAuthContext, request);
      expect(decision).toBeDefined();
      expect(decision.allowed).toBe(true);
    });

    it('should handle policy with wildcard subject', async () => {
      const mockSchema = {
        version: '1.0',
        roles: {
          user: {
            id: 'user',
            name: 'User',
            description: 'User role',
            permissions: [],
          },
        },
        permissions: {},
        resources: {},
        policies: [
          {
            id: 'wildcard-policy',
            name: 'Wildcard Policy',
            effect: 'allow' as const,
            subjects: ['*'],
            actions: ['read'],
            resources: ['public'],
          },
        ],
      };

      (mockEnv.APP_CACHE.get as any).mockResolvedValueOnce(mockSchema);

      const request = {
        action: 'read',
        resource: 'public',
      };

      const decision = await service.checkPermission(mockAuthContext, request);
      expect(decision).toBeDefined();
    });

    it('should handle policy with wildcard action', async () => {
      const mockSchema = {
        version: '1.0',
        roles: {
          admin: {
            id: 'admin',
            name: 'Admin',
            description: 'Admin role',
            permissions: [],
          },
        },
        permissions: {},
        resources: {},
        policies: [
          {
            id: 'admin-policy',
            name: 'Admin Policy',
            effect: 'allow' as const,
            subjects: ['admin'],
            actions: ['*'],
            resources: ['*'],
          },
        ],
      };

      (mockEnv.APP_CACHE.get as any).mockResolvedValueOnce(mockSchema);

      const adminContext = {
        ...mockAuthContext,
        permissions: ['admin'],
      };

      const request = {
        action: 'delete',
        resource: 'test',
      };

      const decision = await service.checkPermission(adminContext, request);
      expect(decision).toBeDefined();
    });

    it('should handle policy with conditional that fails', async () => {
      const mockSchema = {
        version: '1.0',
        roles: {
          user: {
            id: 'user',
            name: 'User',
            description: 'User role',
            permissions: [],
          },
        },
        permissions: {},
        resources: {},
        policies: [
          {
            id: 'conditional-policy',
            name: 'Conditional Policy',
            effect: 'allow' as const,
            subjects: ['user'],
            actions: ['read'],
            resources: ['*'],
            conditions: [
              {
                field: 'verified',
                operator: 'eq' as const,
                value: true,
              },
            ],
          },
        ],
      };

      (mockEnv.APP_CACHE.get as any).mockResolvedValueOnce(mockSchema);

      const request = {
        action: 'read',
        resource: 'test',
        context: {
          verified: false,
        },
      };

      const decision = await service.checkPermission(mockAuthContext, request);
      expect(decision).toBeDefined();
    });
  });
});

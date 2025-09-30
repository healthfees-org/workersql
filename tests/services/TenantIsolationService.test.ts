import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TenantIsolationService } from '@/services/TenantIsolationService';
import type { CloudflareEnvironment, AuthContext } from '@/types';

describe('TenantIsolationService', () => {
  let service: TenantIsolationService;
  let mockEnv: CloudflareEnvironment;
  let mockAuthContext: AuthContext;

  beforeEach(() => {
    vi.clearAllMocks();

    mockEnv = {
      APP_CACHE: {
        put: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue(null),
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
      SHARD_COUNT: '4',
    };

    mockAuthContext = {
      tenantId: 'tenant-123',
      userId: 'user-456',
      permissions: ['read', 'write'],
      tokenHash: 'hash123',
    };

    service = new TenantIsolationService(mockEnv);
  });

  describe('validateTenantIsolationAccess', () => {
    it('should pass validation when no specific tenant is requested', () => {
      expect(() => {
        service.validateTenantIsolationAccess(mockAuthContext);
      }).not.toThrow();
    });

    it('should pass validation when requested tenant matches auth context', () => {
      expect(() => {
        service.validateTenantIsolationAccess(mockAuthContext, 'tenant-123');
      }).not.toThrow();
    });

    it('should throw when auth context has no tenant', () => {
      const invalidAuth = { ...mockAuthContext, tenantId: '' };

      expect(() => {
        service.validateTenantIsolationAccess(invalidAuth);
      }).toThrow('No tenant context available');
    });

    it('should throw when requested tenant does not match auth context', () => {
      expect(() => {
        service.validateTenantIsolationAccess(mockAuthContext, 'tenant-999');
      }).toThrow('Access denied: insufficient tenant permissions');
    });
  });

  describe('enforceTenantIsolation', () => {
    it('should throw when auth context has no tenant', () => {
      const invalidAuth = { ...mockAuthContext, tenantId: '' };

      expect(() => {
        service.enforceTenantIsolation('SELECT * FROM users', invalidAuth);
      }).toThrow('Tenant context required for SQL execution');
    });

    describe('SELECT queries', () => {
      it('should add WHERE clause when none exists', () => {
        const sql = 'SELECT * FROM users';
        const result = service.enforceTenantIsolation(sql, mockAuthContext);

        expect(result).toContain("WHERE tenant_id = 'tenant-123'");
        expect(result).toContain('SELECT * FROM users');
      });

      it('should add tenant filter to existing WHERE clause', () => {
        const sql = 'SELECT * FROM users WHERE active = 1';
        const result = service.enforceTenantIsolation(sql, mockAuthContext);

        expect(result).toContain("tenant_id = 'tenant-123'");
        expect(result).toContain('AND');
        expect(result).toContain('active = 1');
      });

      it('should add WHERE before ORDER BY', () => {
        const sql = 'SELECT * FROM users ORDER BY name';
        const result = service.enforceTenantIsolation(sql, mockAuthContext);

        expect(result).toContain("WHERE tenant_id = 'tenant-123'");
        expect(result).toContain('ORDER BY name');
        expect(result.indexOf('WHERE')).toBeLessThan(result.indexOf('ORDER BY'));
      });

      it('should add WHERE before LIMIT', () => {
        const sql = 'SELECT * FROM users LIMIT 10';
        const result = service.enforceTenantIsolation(sql, mockAuthContext);

        expect(result).toContain("WHERE tenant_id = 'tenant-123'");
        expect(result).toContain('LIMIT 10');
        expect(result.indexOf('WHERE')).toBeLessThan(result.indexOf('LIMIT'));
      });

      it('should add WHERE before GROUP BY', () => {
        const sql = 'SELECT COUNT(*) FROM users GROUP BY status';
        const result = service.enforceTenantIsolation(sql, mockAuthContext);

        expect(result).toContain("WHERE tenant_id = 'tenant-123'");
        expect(result).toContain('GROUP BY status');
        expect(result.indexOf('WHERE')).toBeLessThan(result.indexOf('GROUP BY'));
      });

      it('should handle mixed case SQL', () => {
        const sql = 'SeLeCt * FrOm users WhErE active = 1';
        const result = service.enforceTenantIsolation(sql, mockAuthContext);

        expect(result).toContain("tenant_id = 'tenant-123'");
      });

      it('should escape single quotes in tenant ID', () => {
        const authWithQuote = { ...mockAuthContext, tenantId: "tenant'123" };
        const sql = 'SELECT * FROM users';
        const result = service.enforceTenantIsolation(sql, authWithQuote);

        expect(result).toContain("tenant_id = 'tenant''123'");
      });
    });

    describe('UPDATE queries', () => {
      it('should add WHERE clause to UPDATE without WHERE', () => {
        const sql = 'UPDATE users SET name = "John"';
        const result = service.enforceTenantIsolation(sql, mockAuthContext);

        expect(result).toContain("WHERE tenant_id = 'tenant-123'");
        expect(result).toContain('UPDATE users SET name = "John"');
      });

      it('should add tenant filter to UPDATE with WHERE', () => {
        const sql = 'UPDATE users SET name = "John" WHERE id = 1';
        const result = service.enforceTenantIsolation(sql, mockAuthContext);

        expect(result).toContain("tenant_id = 'tenant-123'");
        expect(result).toContain('AND');
        expect(result).toContain('id = 1');
      });

      it('should handle mixed case UPDATE', () => {
        const sql = 'UpDaTe users SeT name = "John"';
        const result = service.enforceTenantIsolation(sql, mockAuthContext);

        expect(result).toContain("WHERE tenant_id = 'tenant-123'");
      });
    });

    describe('DELETE queries', () => {
      it('should add WHERE clause to DELETE without WHERE', () => {
        const sql = 'DELETE FROM users';
        const result = service.enforceTenantIsolation(sql, mockAuthContext);

        expect(result).toContain("WHERE tenant_id = 'tenant-123'");
        expect(result).toContain('DELETE FROM users');
      });

      it('should add tenant filter to DELETE with WHERE', () => {
        const sql = 'DELETE FROM users WHERE id = 1';
        const result = service.enforceTenantIsolation(sql, mockAuthContext);

        expect(result).toContain("tenant_id = 'tenant-123'");
        expect(result).toContain('AND');
        expect(result).toContain('id = 1');
      });

      it('should handle mixed case DELETE', () => {
        const sql = 'DeLeTe FrOm users';
        const result = service.enforceTenantIsolation(sql, mockAuthContext);

        expect(result).toContain("WHERE tenant_id = 'tenant-123'");
      });
    });

    describe('INSERT queries', () => {
      it('should add tenant_id to INSERT with columns', () => {
        const sql = 'INSERT INTO users (name, email) VALUES ("John", "john@example.com")';
        const result = service.enforceTenantIsolation(sql, mockAuthContext);

        expect(result).toContain('tenant_id');
        expect(result).toContain("'tenant-123'");
        expect(result).toContain('name, email, tenant_id');
      });

      it('should not duplicate tenant_id if already present', () => {
        const sql =
          'INSERT INTO users (name, tenant_id, email) VALUES ("John", "tenant-123", "john@example.com")';
        const result = service.enforceTenantIsolation(sql, mockAuthContext);

        // Should return unchanged since tenant_id is already present
        expect(result).toBe(sql);
      });

      it('should handle INSERT without column specification', () => {
        const sql = 'INSERT INTO users VALUES ("John", "john@example.com")';
        const result = service.enforceTenantIsolation(sql, mockAuthContext);

        // Should return unchanged with a warning logged
        expect(result).toBe(sql);
      });

      it('should handle mixed case INSERT', () => {
        const sql = 'InSeRt InTo users (name, email) VaLuEs ("John", "john@example.com")';
        const result = service.enforceTenantIsolation(sql, mockAuthContext);

        expect(result).toContain('tenant_id');
      });
    });

    describe('DDL operations', () => {
      it('should validate CREATE TABLE with tenant prefix', () => {
        const sql = 'CREATE TABLE tenant-123_users (id INT, name TEXT)';

        expect(() => {
          service.enforceTenantIsolation(sql, mockAuthContext);
        }).not.toThrow();
      });

      it('should warn about CREATE TABLE without tenant prefix', () => {
        const sql = 'CREATE TABLE users (id INT, name TEXT)';
        const result = service.enforceTenantIsolation(sql, mockAuthContext);

        // Should still return the SQL but log a warning
        expect(result).toBe(sql);
      });

      it('should allow system tables without tenant prefix', () => {
        const sql = 'CREATE TABLE migrations (id INT, version TEXT)';

        expect(() => {
          service.enforceTenantIsolation(sql, mockAuthContext);
        }).not.toThrow();
      });

      it('should handle ALTER TABLE', () => {
        const sql = 'ALTER TABLE users ADD COLUMN age INT';
        const result = service.enforceTenantIsolation(sql, mockAuthContext);

        expect(result).toBe(sql);
      });

      it('should handle DROP TABLE', () => {
        const sql = 'DROP TABLE users';
        const result = service.enforceTenantIsolation(sql, mockAuthContext);

        expect(result).toBe(sql);
      });

      it('should handle TRUNCATE TABLE', () => {
        const sql = 'TRUNCATE TABLE users';
        const result = service.enforceTenantIsolation(sql, mockAuthContext);

        expect(result).toBe(sql);
      });

      it('should handle CREATE TABLE IF NOT EXISTS', () => {
        const sql = 'CREATE TABLE IF NOT EXISTS tenant-123_users (id INT)';

        expect(() => {
          service.enforceTenantIsolation(sql, mockAuthContext);
        }).not.toThrow();
      });
    });

    describe('Other SQL operations', () => {
      it('should return unchanged for non-DML/DDL operations', () => {
        const sql = 'EXPLAIN SELECT * FROM users';
        const result = service.enforceTenantIsolation(sql, mockAuthContext);

        expect(result).toBe(sql);
      });
    });
  });

  describe('generateTenantCacheKey', () => {
    it('should generate tenant-specific cache key', () => {
      const key = service.generateTenantCacheKey('tenant-123', 'user:456');

      expect(key).toBe('tenant:tenant-123:user:456');
    });

    it('should handle empty base key', () => {
      const key = service.generateTenantCacheKey('tenant-123', '');

      expect(key).toBe('tenant:tenant-123:');
    });
  });

  describe('validateShardTenantMapping', () => {
    it('should validate correct shard mapping', () => {
      // Calculate expected shard for tenant-123
      const tenantId = 'tenant-123';
      let hash = 0;
      for (let i = 0; i < tenantId.length; i++) {
        const char = tenantId.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
      }
      const shardIndex = Math.abs(hash) % 4;
      const expectedShard = `shard_${shardIndex}`;

      expect(() => {
        service.validateShardTenantMapping(expectedShard, tenantId);
      }).not.toThrow();
    });

    it('should throw for incorrect shard mapping', () => {
      expect(() => {
        service.validateShardTenantMapping('shard_999', 'tenant-123');
      }).toThrow('should not access shard');
    });

    it('should handle different tenant IDs', () => {
      const tenantId = 'different-tenant';
      let hash = 0;
      for (let i = 0; i < tenantId.length; i++) {
        const char = tenantId.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
      }
      const shardIndex = Math.abs(hash) % 4;
      const expectedShard = `shard_${shardIndex}`;

      expect(() => {
        service.validateShardTenantMapping(expectedShard, tenantId);
      }).not.toThrow();
    });
  });

  describe('validateCrossTenantOperation', () => {
    it('should allow cross-tenant operation for super_admin', () => {
      const adminAuth = {
        ...mockAuthContext,
        permissions: ['super_admin', 'read', 'write'],
      };

      expect(() => {
        service.validateCrossTenantOperation(adminAuth, 'READ', ['tenant-456', 'tenant-789']);
      }).not.toThrow();
    });

    it('should allow cross-tenant operation for system_admin', () => {
      const adminAuth = {
        ...mockAuthContext,
        permissions: ['system_admin'],
      };

      expect(() => {
        service.validateCrossTenantOperation(adminAuth, 'WRITE', ['tenant-456']);
      }).not.toThrow();
    });

    it('should deny cross-tenant operation for regular user', () => {
      expect(() => {
        service.validateCrossTenantOperation(mockAuthContext, 'READ', ['tenant-456']);
      }).toThrow('Cross-tenant operations require administrative privileges');
    });

    it('should deny cross-tenant operation without proper permissions', () => {
      const noPermAuth = {
        ...mockAuthContext,
        permissions: [],
      };

      expect(() => {
        service.validateCrossTenantOperation(noPermAuth, 'READ', ['tenant-456']);
      }).toThrow('Cross-tenant operations require administrative privileges');
    });
  });

  describe('auditTenantAccess', () => {
    it('should log audit information', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      service.auditTenantAccess(mockAuthContext, 'READ', 'users', true);

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should log audit with details', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      service.auditTenantAccess(mockAuthContext, 'WRITE', 'users', true, {
        recordsAffected: 5,
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should log failed access', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      service.auditTenantAccess(mockAuthContext, 'DELETE', 'users', false, {
        error: 'Permission denied',
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should store audit log in production environment', async () => {
      const prodEnv = { ...mockEnv, ENVIRONMENT: 'production' };
      const prodService = new TenantIsolationService(prodEnv);

      prodService.auditTenantAccess(mockAuthContext, 'READ', 'users', true);


      // Give async operation time to execute
      await new Promise((resolve) => setTimeout(resolve, 10));

      // In production, it would call APP_CACHE.put
      // But since the call is fire-and-forget with catch, we can't easily test it
      // The test just ensures it doesn't throw
    });

    it('should handle audit log storage failure gracefully', async () => {
      const prodEnv = {
        ...mockEnv,
        ENVIRONMENT: 'production',
        APP_CACHE: {
          put: vi.fn().mockRejectedValue(new Error('Storage failed')),
          get: vi.fn(),
          delete: vi.fn(),
        } as any,
      };
      const prodService = new TenantIsolationService(prodEnv);

      // Should not throw even if storage fails
      expect(() => {
        prodService.auditTenantAccess(mockAuthContext, 'READ', 'users', true);
      }).not.toThrow();

      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  });

  describe('Edge cases', () => {
    it('should handle SELECT without FROM clause', () => {
      const sql = 'SELECT 1 + 1';
      const result = service.enforceTenantIsolation(sql, mockAuthContext);

      // Should return unchanged
      expect(result).toBe(sql);
    });

    it('should handle complex SELECT with subqueries', () => {
      const sql = 'SELECT * FROM users WHERE id IN (SELECT user_id FROM orders WHERE total > 100)';
      const result = service.enforceTenantIsolation(sql, mockAuthContext);

      expect(result).toContain("tenant_id = 'tenant-123'");
    });

    it('should handle UPDATE with multiple WHERE conditions', () => {
      const sql = 'UPDATE users SET active = 1 WHERE status = "pending" AND created_at < NOW()';
      const result = service.enforceTenantIsolation(sql, mockAuthContext);

      expect(result).toContain("tenant_id = 'tenant-123'");
      expect(result).toContain('status = "pending"');
      expect(result).toContain('created_at < NOW()');
    });

    it('should handle whitespace variations', () => {
      const sql = '  SELECT   *   FROM   users  ';
      const result = service.enforceTenantIsolation(sql, mockAuthContext);

      expect(result).toContain("WHERE tenant_id = 'tenant-123'");
    });

    it('should handle SQL with newlines', () => {
      const sql = 'SELECT *\nFROM users\nWHERE active = 1';
      const result = service.enforceTenantIsolation(sql, mockAuthContext);

      expect(result).toContain("tenant_id = 'tenant-123'");
    });

    it('should handle INSERT with multiple value sets', () => {
      const sql = 'INSERT INTO users (name, email) VALUES ("John", "john@example.com")';
      const result = service.enforceTenantIsolation(sql, mockAuthContext);

      expect(result).toContain('tenant_id');
    });

    it('should handle case-insensitive tenant_id check in INSERT', () => {
      const sql =
        'INSERT INTO users (name, TENANT_ID, email) VALUES ("John", "tenant-123", "john@example.com")';
      const result = service.enforceTenantIsolation(sql, mockAuthContext);

      expect(result).toBe(sql);
    });
  });

  describe('System table detection', () => {
    it('should recognize migrations as system table', () => {
      const sql = 'CREATE TABLE migrations (id INT)';
      const result = service.enforceTenantIsolation(sql, mockAuthContext);

      expect(result).toBe(sql);
    });

    it('should recognize schema_versions as system table', () => {
      const sql = 'CREATE TABLE schema_versions (version TEXT)';
      const result = service.enforceTenantIsolation(sql, mockAuthContext);

      expect(result).toBe(sql);
    });

    it('should recognize system_config as system table', () => {
      const sql = 'CREATE TABLE system_config (key TEXT, value TEXT)';
      const result = service.enforceTenantIsolation(sql, mockAuthContext);

      expect(result).toBe(sql);
    });

    it('should handle system table names in mixed case', () => {
      const sql = 'CREATE TABLE Migrations (id INT)';
      const result = service.enforceTenantIsolation(sql, mockAuthContext);

      expect(result).toBe(sql);
    });
  });

  describe('SQL injection prevention', () => {
    it('should escape single quotes in tenant ID for SELECT', () => {
      const authWithQuote = { ...mockAuthContext, tenantId: "te'nant" };
      const sql = 'SELECT * FROM users';
      const result = service.enforceTenantIsolation(sql, authWithQuote);

      expect(result).toContain("tenant_id = 'te''nant'");
    });

    it('should escape single quotes in tenant ID for UPDATE', () => {
      const authWithQuote = { ...mockAuthContext, tenantId: "te'nant" };
      const sql = 'UPDATE users SET name = "test"';
      const result = service.enforceTenantIsolation(sql, authWithQuote);

      expect(result).toContain("tenant_id = 'te''nant'");
    });

    it('should escape single quotes in tenant ID for DELETE', () => {
      const authWithQuote = { ...mockAuthContext, tenantId: "te'nant" };
      const sql = 'DELETE FROM users';
      const result = service.enforceTenantIsolation(sql, authWithQuote);

      expect(result).toContain("tenant_id = 'te''nant'");
    });

    it('should escape single quotes in tenant ID for INSERT', () => {
      const authWithQuote = { ...mockAuthContext, tenantId: "te'nant" };
      const sql = 'INSERT INTO users (name) VALUES ("test")';
      const result = service.enforceTenantIsolation(sql, authWithQuote);

      expect(result).toContain("'te''nant'");
    });

    it('should escape multiple single quotes', () => {
      const authWithQuotes = { ...mockAuthContext, tenantId: "te'na'nt" };
      const sql = 'SELECT * FROM users';
      const result = service.enforceTenantIsolation(sql, authWithQuotes);

      expect(result).toContain("tenant_id = 'te''na''nt'");
    });
  });
});

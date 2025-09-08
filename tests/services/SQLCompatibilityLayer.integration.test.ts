import { describe, it, expect, beforeEach } from 'vitest';
import { SQLCompatibilityService } from '@/services/SQLCompatibilityService';
import type { CloudflareEnvironment } from '@/types';

describe('SQL Compatibility Layer Integration', () => {
  let sqlCompatibility: SQLCompatibilityService;
  let mockEnv: CloudflareEnvironment;

  beforeEach(() => {
    mockEnv = {
      APP_CACHE: {} as any,
      DB_EVENTS: {} as any,
      SHARD: {} as any,
      PORTABLE_DB: {} as any,
      ENVIRONMENT: 'test',
      LOG_LEVEL: 'debug',
      MAX_SHARD_SIZE_GB: '10',
      CACHE_TTL_MS: '30000',
      CACHE_SWR_MS: '120000',
    };

    sqlCompatibility = new SQLCompatibilityService(mockEnv);
  });

  describe('End-to-End SQL Transpilation', () => {
    it('should handle complex MySQL queries with multiple features', () => {
      const complexQuery = `
        /*+ strong */
        SELECT
          CONCAT(u.first_name, ' ', u.last_name) as full_name,
          YEAR(u.created_at) as signup_year,
          NOW() as current_time,
          LENGTH(u.email) as email_length
        FROM users u
        WHERE u.status = 'active'
          AND YEAR(u.created_at) >= 2020
          AND LENGTH(u.email) > 5
        LIMIT 10, 20
      `;

      const result = sqlCompatibility.transpileSQL(complexQuery);

      // Check hints
      expect(result.hints.consistency).toBe('strong');

      // Check function transpilation
      expect(result.sql).toContain("u.first_name || ' ' || u.last_name");
      expect(result.sql).toContain("STRFTIME('%Y', u.created_at)");
      expect(result.sql).toContain("DATETIME('now')");
      expect(result.sql).toContain('LENGTH(u.email)');

      // Check LIMIT conversion
      expect(result.sql).toContain('LIMIT 20 OFFSET 10');

      // Check that hint is removed
      expect(result.sql).not.toContain('/*+ strong */');
    });

    it('should handle DDL with data type conversion', () => {
      const ddlQuery = `
        CREATE TABLE users (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          email VARCHAR(255) NOT NULL UNIQUE,
          name TEXT,
          age TINYINT UNSIGNED,
          balance DECIMAL(10,2),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          is_active BOOLEAN DEFAULT TRUE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `;

      const result = sqlCompatibility.transpileSQL(ddlQuery);

      // Check data type conversions
      expect(result.sql).toContain('id INTEGER AUTOINCREMENT PRIMARY KEY');
      expect(result.sql).toContain('email TEXT NOT NULL UNIQUE');
      expect(result.sql).toContain('name TEXT');
      expect(result.sql).toContain('age INTEGER');
      expect(result.sql).toContain('balance REAL');
      expect(result.sql).toContain('created_at TEXT DEFAULT CURRENT_TIMESTAMP');
      expect(result.sql).toContain('is_active INTEGER DEFAULT TRUE');

      // Check MySQL-specific clauses are removed
      expect(result.sql).not.toContain('ENGINE=InnoDB');
      expect(result.sql).not.toContain('DEFAULT CHARSET=utf8mb4');
    });

    it('should handle transaction statements', () => {
      const transactions = [
        { input: 'START TRANSACTION', expected: 'BEGIN TRANSACTION' },
        { input: 'BEGIN', expected: 'BEGIN TRANSACTION' },
        { input: 'COMMIT', expected: 'COMMIT' },
        { input: 'ROLLBACK', expected: 'ROLLBACK' },
      ];

      transactions.forEach(({ input, expected }) => {
        const result = sqlCompatibility.transpileSQL(input);
        expect(result.sql).toBe(expected);
      });
    });

    it('should handle prepared statements with parameter binding', () => {
      const sql = 'SELECT * FROM users WHERE id = ? AND name = ? AND email LIKE ?';
      const params = [1, 'John', '%@example.com'];

      const result = sqlCompatibility.prepareStatement(sql, params);

      expect(result.sql).toBe(sql);
      expect(result.params).toEqual(params);
    });

    it('should correctly identify statement types', () => {
      const testCases = [
        { sql: 'SELECT * FROM users', type: 'SELECT' },
        { sql: 'INSERT INTO users VALUES (1)', type: 'INSERT' },
        { sql: 'UPDATE users SET name = "test"', type: 'UPDATE' },
        { sql: 'DELETE FROM users WHERE id = 1', type: 'DELETE' },
        { sql: 'CREATE TABLE test (id INTEGER)', type: 'DDL' },
        { sql: 'ALTER TABLE users ADD COLUMN age INTEGER', type: 'DDL' },
        { sql: 'DROP TABLE users', type: 'DDL' },
      ];

      testCases.forEach(({ sql, type }) => {
        expect(sqlCompatibility.getStatementType(sql)).toBe(type);
      });
    });

    it('should extract table names correctly', () => {
      const testCases = [
        { sql: 'SELECT * FROM users WHERE id = 1', table: 'users' },
        { sql: 'INSERT INTO posts (title) VALUES ("Hello")', table: 'posts' },
        { sql: 'UPDATE orders SET status = "done"', table: 'orders' },
        { sql: 'DELETE FROM logs WHERE id = 1', table: 'logs' },
        { sql: 'CREATE TABLE products (id INTEGER)', table: 'products' },
        { sql: 'ALTER TABLE settings ADD COLUMN theme TEXT', table: 'settings' },
      ];

      testCases.forEach(({ sql, table }) => {
        const result = sqlCompatibility.transpileSQL(sql);
        expect(result.sql.toLowerCase()).toContain(table.toLowerCase());
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty SQL gracefully', () => {
      const result = sqlCompatibility.transpileSQL('');
      expect(result.sql).toBe('');
      expect(result.hints).toEqual({});
    });

    it('should handle whitespace-only SQL', () => {
      const result = sqlCompatibility.transpileSQL('   \n\t   ');
      expect(result.sql).toBe('');
      expect(result.hints).toEqual({});
    });

    it('should handle malformed SQL without crashing', () => {
      const malformedSQL = 'SELECT * FROM';
      const result = sqlCompatibility.transpileSQL(malformedSQL);
      expect(result.sql).toBeDefined();
    });

    it('should handle very long SQL queries', () => {
      const longSQL = 'SELECT ' + 'column'.repeat(1000) + ' FROM test_table';
      const result = sqlCompatibility.transpileSQL(longSQL);
      expect(result.sql).toBeDefined();
      expect(result.sql.length).toBeGreaterThan(0);
    });

    it('should handle queries with many parameters', () => {
      const sql = 'SELECT * FROM users WHERE ' + 'id = ? OR '.repeat(50) + 'id = ?';
      const params = Array.from({ length: 51 }, (_, i) => i);
      const result = sqlCompatibility.prepareStatement(sql, params);
      expect(result.params).toHaveLength(51);
    });

    it('should handle nested function calls', () => {
      const sql = 'SELECT UPPER(CONCAT(first_name, " ", last_name)) FROM users';
      const result = sqlCompatibility.transpileSQL(sql);
      expect(result.sql).toContain('UPPER(first_name || " " || last_name)');
    });

    it('should handle complex WHERE clauses', () => {
      const sql = `
        SELECT * FROM users
        WHERE LENGTH(email) > 5
          AND YEAR(created_at) = 2023
          AND LOWER(name) LIKE ?
          AND status IN ('active', 'pending')
      `;
      const result = sqlCompatibility.transpileSQL(sql);
      expect(result.sql).toContain('LENGTH(email) > 5');
      expect(result.sql).toContain("STRFTIME('%Y', created_at) = 2023");
      expect(result.sql).toContain('LOWER(name)');
    });
  });

  describe('Performance and Compatibility', () => {
    it('should maintain query structure for compatible syntax', () => {
      const compatibleSQL = `
        SELECT u.id, u.name, p.title
        FROM users u
        JOIN posts p ON u.id = p.user_id
        WHERE u.active = 1
        ORDER BY u.created_at DESC
        LIMIT 10
      `;
      const result = sqlCompatibility.transpileSQL(compatibleSQL);
      expect(result.sql).toContain('JOIN posts p ON u.id = p.user_id');
      expect(result.sql).toContain('ORDER BY u.created_at DESC');
      expect(result.sql).toContain('LIMIT 10');
    });

    it('should handle subqueries correctly', () => {
      const sql = 'SELECT * FROM users WHERE id IN (SELECT user_id FROM posts WHERE published = 1)';
      const result = sqlCompatibility.transpileSQL(sql);
      expect(result.sql).toBe(sql); // Subqueries are compatible
    });

    it('should handle UNION operations', () => {
      const sql = 'SELECT name FROM users UNION SELECT name FROM admins';
      const result = sqlCompatibility.transpileSQL(sql);
      expect(result.sql).toBe(sql); // UNION is compatible
    });
  });
});

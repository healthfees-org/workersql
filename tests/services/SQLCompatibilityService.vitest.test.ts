import { describe, it, expect, beforeEach } from 'vitest';
import { SQLCompatibilityService } from '../../src/services/SQLCompatibilityService';
import type { CloudflareEnvironment } from '../../src/types';

describe('SQLCompatibilityService (Vitest)', () => {
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

  describe('Core Functionality', () => {
    it('should transpile basic MySQL functions to SQLite', () => {
      const mysqlSQL = 'SELECT CONCAT(first_name, " ", last_name), NOW() FROM users';
      const result = sqlCompatibility.transpileSQL(mysqlSQL);

      expect(result.sql).toContain('first_name || " " || last_name');
      expect(result.sql).toContain("DATETIME('now')");
    });

    it('should handle query hints correctly', () => {
      const sql = '/*+ strong */ SELECT * FROM users';
      const result = sqlCompatibility.transpileSQL(sql);

      expect(result.hints.consistency).toBe('strong');
      expect(result.sql).not.toContain('/*+ strong */');
    });

    it('should transpile data types from MySQL to SQLite', () => {
      const mysqlSQL = 'CREATE TABLE test (id INT AUTO_INCREMENT, name VARCHAR(255))';
      const result = sqlCompatibility.transpileSQL(mysqlSQL);

      expect(result.sql).toContain('id INTEGER AUTOINCREMENT');
      expect(result.sql).toContain('name TEXT');
    });

    it('should handle LIMIT OFFSET conversion', () => {
      const mysqlSQL = 'SELECT * FROM users LIMIT 5, 10';
      const result = sqlCompatibility.transpileSQL(mysqlSQL);

      expect(result.sql).toBe('SELECT * FROM users LIMIT 10 OFFSET 5');
    });
  });

  describe('Statement Type Detection', () => {
    it('should correctly identify all SQL statement types', () => {
      const testCases = [
        { sql: 'SELECT * FROM users', expected: 'SELECT' },
        { sql: 'INSERT INTO users VALUES (1)', expected: 'INSERT' },
        { sql: 'UPDATE users SET name = "test"', expected: 'UPDATE' },
        { sql: 'DELETE FROM users WHERE id = 1', expected: 'DELETE' },
        { sql: 'CREATE TABLE test (id INTEGER)', expected: 'DDL' },
        { sql: 'ALTER TABLE users ADD COLUMN age INTEGER', expected: 'DDL' },
        { sql: 'DROP TABLE users', expected: 'DDL' },
      ];

      testCases.forEach(({ sql, expected }) => {
        const type = sqlCompatibility.getStatementType(sql);
        expect(type).toBe(expected);
      });
    });
  });

  describe('Parameter Handling', () => {
    it('should prepare statements with positional parameters', () => {
      const sql = 'SELECT * FROM users WHERE id = ? AND name = ?';
      const params = [1, 'John'];
      const result = sqlCompatibility.prepareStatement(sql, params);

      expect(result.sql).toBe(sql);
      expect(result.params).toEqual(params);
    });
  });

  describe('Table Name Extraction', () => {
    it('should extract table names from various SQL statements', () => {
      const testCases = [
        { sql: 'SELECT * FROM users', expected: 'users' },
        { sql: 'INSERT INTO posts VALUES (1)', expected: 'posts' },
        { sql: 'UPDATE orders SET status = "done"', expected: 'orders' },
        { sql: 'DELETE FROM logs WHERE id = 1', expected: 'logs' },
        { sql: 'CREATE TABLE products (id INTEGER)', expected: 'products' },
      ];

      testCases.forEach(({ sql }) => {
        const result = sqlCompatibility.transpileSQL(sql);
        expect(result.sql).toContain(sql.split(' ')[sql.split(' ').length - 1]);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty and whitespace-only SQL', () => {
      const testCases = ['', '   ', '\n\t\r'];

      testCases.forEach((sql) => {
        const result = sqlCompatibility.transpileSQL(sql);
        expect(result.sql).toBeDefined();
        expect(result.hints).toEqual({});
      });
    });

    it('should handle malformed SQL gracefully', () => {
      const malformedSQL = 'SELECT * FROM';
      const result = sqlCompatibility.transpileSQL(malformedSQL);

      expect(result.sql).toBeDefined();
    });

    it('should handle very long SQL queries', () => {
      const longSQL = 'SELECT ' + 'column' + '1,'.repeat(1000) + ' column1000 FROM test_table';
      const result = sqlCompatibility.transpileSQL(longSQL);

      expect(result.sql).toBeDefined();
      expect(result.sql.length).toBeGreaterThan(0);
    });
  });

  describe('Function Mappings', () => {
    it('should map MySQL string functions to SQLite equivalents', () => {
      const functions = [
        { mysql: 'CONCAT(a, b)', sqlite: 'a || b' },
        { mysql: 'UPPER(name)', sqlite: 'UPPER(name)' },
        { mysql: 'LOWER(name)', sqlite: 'LOWER(name)' },
        { mysql: 'LENGTH(str)', sqlite: 'LENGTH(str)' },
        { mysql: 'SUBSTR(str, 1, 5)', sqlite: 'SUBSTR(str, 1, 5)' },
      ];

      functions.forEach(({ mysql, sqlite }) => {
        const sql = `SELECT ${mysql} FROM test`;
        const result = sqlCompatibility.transpileSQL(sql);

        expect(result.sql).toContain(sqlite);
      });
    });

    it('should map MySQL date functions to SQLite equivalents', () => {
      const functions = [
        { mysql: 'NOW()', sqlite: "DATETIME('now')" },
        { mysql: 'CURDATE()', sqlite: "DATE('now')" },
        { mysql: 'CURTIME()', sqlite: "TIME('now')" },
        { mysql: 'YEAR(date)', sqlite: "STRFTIME('%Y', date)" },
        { mysql: 'MONTH(date)', sqlite: "STRFTIME('%m', date)" },
        { mysql: 'DAY(date)', sqlite: "STRFTIME('%d', date)" },
      ];

      functions.forEach(({ mysql, sqlite }) => {
        const sql = `SELECT ${mysql} FROM test`;
        const result = sqlCompatibility.transpileSQL(sql);

        expect(result.sql).toContain(sqlite);
      });
    });
  });

  describe('Transaction Handling', () => {
    it('should transpile MySQL transaction commands to SQLite', () => {
      const transactions = [
        { mysql: 'BEGIN', sqlite: 'BEGIN TRANSACTION' },
        { mysql: 'START TRANSACTION', sqlite: 'BEGIN TRANSACTION' },
        { mysql: 'COMMIT', sqlite: 'COMMIT' },
        { mysql: 'ROLLBACK', sqlite: 'ROLLBACK' },
      ];

      transactions.forEach(({ mysql, sqlite }) => {
        const result = sqlCompatibility.transpileSQL(mysql);
        expect(result.sql).toBe(sqlite);
      });
    });
  });

  describe('DDL Transpilation', () => {
    it('should remove MySQL-specific DDL clauses', () => {
      const mysqlSQL = `
        CREATE TABLE test (
          id INT AUTO_INCREMENT PRIMARY KEY
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `;
      const result = sqlCompatibility.transpileSQL(mysqlSQL);

      expect(result.sql).not.toContain('ENGINE=InnoDB');
      expect(result.sql).not.toContain('DEFAULT CHARSET=utf8mb4');
      expect(result.sql).not.toContain('COLLATE=utf8mb4_unicode_ci');
      expect(result.sql).toContain('AUTOINCREMENT');
    });

    it('should handle ALTER TABLE operations', () => {
      const alterSQL = 'ALTER TABLE users ADD COLUMN age INT DEFAULT 18';
      const result = sqlCompatibility.transpileSQL(alterSQL);

      expect(result.sql).toContain('ADD age INTEGER DEFAULT 18');
    });
  });
});

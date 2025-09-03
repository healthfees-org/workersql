import { SQLCompatibilityService } from '../../src/services/SQLCompatibilityService';
import type { CloudflareEnvironment, QueryHints } from '../../src/types';

describe('SQLCompatibilityService', () => {
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

  describe('transpileSQL', () => {
    it('should transpile basic SELECT query without changes', () => {
      const sql = 'SELECT * FROM users WHERE id = 1';
      const result = sqlCompatibility.transpileSQL(sql);

      expect(result.sql).toBe(sql);
      expect(result.hints).toEqual({});
    });

    it('should transpile MySQL CONCAT to SQLite concatenation', () => {
      const mysqlSQL = 'SELECT CONCAT(first_name, " ", last_name) FROM users';
      const result = sqlCompatibility.transpileSQL(mysqlSQL);

      expect(result.sql).toBe('SELECT first_name || " " || last_name FROM users');
    });

    it('should transpile MySQL NOW() to SQLite datetime', () => {
      const mysqlSQL = 'SELECT NOW()';
      const result = sqlCompatibility.transpileSQL(mysqlSQL);

      expect(result.sql).toBe("SELECT DATETIME('now')");
    });

    it('should transpile MySQL data types to SQLite equivalents', () => {
      const mysqlSQL = 'CREATE TABLE test (id INT AUTO_INCREMENT, name VARCHAR(255), data TEXT)';
      const result = sqlCompatibility.transpileSQL(mysqlSQL);

      expect(result.sql).toContain('id INTEGER AUTOINCREMENT');
      expect(result.sql).toContain('name TEXT');
      expect(result.sql).toContain('data TEXT');
    });

    it('should handle LIMIT with OFFSET syntax', () => {
      const mysqlSQL = 'SELECT * FROM users LIMIT 10, 20';
      const result = sqlCompatibility.transpileSQL(mysqlSQL);

      expect(result.sql).toBe('SELECT * FROM users LIMIT 20 OFFSET 10');
    });

    it('should parse strong consistency hint', () => {
      const sql = '/*+ strong */ SELECT * FROM users';
      const result = sqlCompatibility.transpileSQL(sql);

      expect(result.sql).toBe('SELECT * FROM users');
      expect(result.hints.consistency).toBe('strong');
    });

    it('should parse bounded consistency hint', () => {
      const sql = '/*+ bounded=1500 */ SELECT * FROM users';
      const result = sqlCompatibility.transpileSQL(sql);

      expect(result.sql).toBe('SELECT * FROM users');
      expect(result.hints.consistency).toBe('bounded');
      expect(result.hints.boundedMs).toBe(1500);
    });

    it('should parse weak consistency hint', () => {
      const sql = '/*+ weak */ SELECT * FROM users';
      const result = sqlCompatibility.transpileSQL(sql);

      expect(result.sql).toBe('SELECT * FROM users');
      expect(result.hints.consistency).toBe('cached');
    });

    it('should transpile transaction statements', () => {
      const mysqlSQL = 'START TRANSACTION';
      const result = sqlCompatibility.transpileSQL(mysqlSQL);

      expect(result.sql).toBe('BEGIN TRANSACTION');
    });

    it('should handle complex queries with multiple functions', () => {
      const mysqlSQL =
        'SELECT CONCAT(UPPER(name), " - ", YEAR(created_at)) FROM users WHERE LENGTH(email) > 5';
      const result = sqlCompatibility.transpileSQL(mysqlSQL);

      expect(result.sql).toContain('UPPER(name) || " - " || STRFTIME(\'%Y\', created_at)');
      expect(result.sql).toContain('LENGTH(email) > 5');
    });
  });

  describe('parseQueryHints', () => {
    it('should return empty hints for queries without hints', () => {
      const sql = 'SELECT * FROM users';
      const result = sqlCompatibility.transpileSQL(sql);

      expect(result.hints).toEqual({});
    });

    it('should handle multiple hints (last one wins)', () => {
      const sql = '/*+ weak */ /*+ strong */ SELECT * FROM users';
      const result = sqlCompatibility.transpileSQL(sql);

      expect(result.hints.consistency).toBe('strong');
    });

    it('should handle malformed hints gracefully', () => {
      const sql = '/*+ invalid */ SELECT * FROM users';
      const result = sqlCompatibility.transpileSQL(sql);

      expect(result.sql).toBe('SELECT * FROM users');
      expect(result.hints).toEqual({});
    });
  });

  describe('transpileDDL', () => {
    it('should transpile CREATE TABLE with MySQL types', () => {
      const mysqlSQL = `
        CREATE TABLE users (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          email VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          is_active BOOLEAN DEFAULT TRUE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `;
      const result = sqlCompatibility.transpileSQL(mysqlSQL);

      expect(result.sql).toContain('id INTEGER AUTOINCREMENT PRIMARY KEY');
      expect(result.sql).toContain('email TEXT NOT NULL');
      expect(result.sql).toContain('created_at TEXT DEFAULT CURRENT_TIMESTAMP');
      expect(result.sql).toContain('is_active INTEGER DEFAULT TRUE');
      expect(result.sql).not.toContain('ENGINE=InnoDB');
      expect(result.sql).not.toContain('DEFAULT CHARSET=utf8mb4');
    });

    it('should handle ALTER TABLE ADD COLUMN', () => {
      const mysqlSQL = 'ALTER TABLE users ADD COLUMN age INT DEFAULT 0';
      const result = sqlCompatibility.transpileSQL(mysqlSQL);

      expect(result.sql).toBe('ALTER TABLE users ADD age INTEGER DEFAULT 0');
    });

    it('should handle CREATE INDEX', () => {
      const mysqlSQL = 'CREATE INDEX idx_users_email ON users (email)';
      const result = sqlCompatibility.transpileSQL(mysqlSQL);

      expect(result.sql).toBe('CREATE INDEX idx_users_email ON users (email)');
    });

    it('should handle DROP TABLE', () => {
      const mysqlSQL = 'DROP TABLE users';
      const result = sqlCompatibility.transpileSQL(mysqlSQL);

      expect(result.sql).toBe('DROP TABLE users');
    });
  });

  describe('transpileDML', () => {
    it('should transpile INSERT with MySQL functions', () => {
      const mysqlSQL = "INSERT INTO users (name, created_at) VALUES (CONCAT('User', '1'), NOW())";
      const result = sqlCompatibility.transpileSQL(mysqlSQL);

      expect(result.sql).toContain(
        "INSERT INTO users (name, created_at) VALUES ('User' || '1', DATETIME('now'))"
      );
    });

    it('should transpile UPDATE with MySQL functions', () => {
      const mysqlSQL = "UPDATE users SET updated_at = NOW(), name = CONCAT(name, '_updated')";
      const result = sqlCompatibility.transpileSQL(mysqlSQL);

      expect(result.sql).toContain("updated_at = DATETIME('now')");
      expect(result.sql).toContain("name = name || '_updated'");
    });

    it('should transpile DELETE with LIMIT', () => {
      const mysqlSQL = 'DELETE FROM users WHERE status = "inactive" LIMIT 10';
      const result = sqlCompatibility.transpileSQL(mysqlSQL);

      expect(result.sql).toBe('DELETE FROM users WHERE status = "inactive" LIMIT 10');
    });
  });

  describe('prepareStatement', () => {
    it('should handle positional parameters', () => {
      const sql = 'SELECT * FROM users WHERE id = ? AND name = ?';
      const params = [1, 'John'];
      const result = sqlCompatibility.prepareStatement(sql, params);

      expect(result.sql).toBe(sql);
      expect(result.params).toEqual(params);
    });

    it('should handle named parameters (basic conversion)', () => {
      const sql = 'SELECT * FROM users WHERE id = :id AND name = :name';
      const params = [1, 'John'];
      const result = sqlCompatibility.prepareStatement(sql, params);

      expect(result.sql).toBe(sql);
      expect(result.params).toEqual(params);
    });

    it('should handle mixed parameter styles', () => {
      const sql = 'SELECT * FROM users WHERE id = ? AND name = :name';
      const params = [1, 'John'];
      const result = sqlCompatibility.prepareStatement(sql, params);

      expect(result.sql).toBe(sql);
      expect(result.params).toEqual([1, 'John']);
    });
  });

  describe('validateSQL', () => {
    it('should not throw for valid SQL', () => {
      const sql = 'SELECT * FROM users WHERE id = 1';
      expect(() => sqlCompatibility.transpileSQL(sql)).not.toThrow();
    });

    it('should handle potentially unsupported features gracefully', () => {
      const sql = 'LOCK TABLES users READ';
      expect(() => sqlCompatibility.transpileSQL(sql)).not.toThrow();
    });
  });

  describe('extractTableName', () => {
    it('should extract table name from SELECT', () => {
      const sql = 'SELECT * FROM users WHERE id = 1';
      const result = sqlCompatibility.transpileSQL(sql);

      expect(result.sql).toContain('FROM users');
    });

    it('should extract table name from INSERT', () => {
      const sql = 'INSERT INTO users (name) VALUES ("John")';
      const result = sqlCompatibility.transpileSQL(sql);

      expect(result.sql).toContain('INTO users');
    });

    it('should extract table name from UPDATE', () => {
      const sql = 'UPDATE users SET name = "John" WHERE id = 1';
      const result = sqlCompatibility.transpileSQL(sql);

      expect(result.sql).toContain('UPDATE users');
    });

    it('should extract table name from DELETE', () => {
      const sql = 'DELETE FROM users WHERE id = 1';
      const result = sqlCompatibility.transpileSQL(sql);

      expect(result.sql).toContain('FROM users');
    });

    it('should extract table name from CREATE TABLE', () => {
      const sql = 'CREATE TABLE users (id INTEGER PRIMARY KEY)';
      const result = sqlCompatibility.transpileSQL(sql);

      expect(result.sql).toContain('CREATE TABLE users');
    });
  });

  describe('getStatementType', () => {
    it('should identify SELECT statements', () => {
      const sql = 'SELECT * FROM users';
      const type = sqlCompatibility.getStatementType(sql);

      expect(type).toBe('SELECT');
    });

    it('should identify INSERT statements', () => {
      const sql = 'INSERT INTO users (name) VALUES ("John")';
      const type = sqlCompatibility.getStatementType(sql);

      expect(type).toBe('INSERT');
    });

    it('should identify UPDATE statements', () => {
      const sql = 'UPDATE users SET name = "John"';
      const type = sqlCompatibility.getStatementType(sql);

      expect(type).toBe('UPDATE');
    });

    it('should identify DELETE statements', () => {
      const sql = 'DELETE FROM users WHERE id = 1';
      const type = sqlCompatibility.getStatementType(sql);

      expect(type).toBe('DELETE');
    });

    it('should identify DDL statements', () => {
      const sql = 'CREATE TABLE users (id INTEGER)';
      const type = sqlCompatibility.getStatementType(sql);

      expect(type).toBe('DDL');
    });

    it('should identify ALTER statements as DDL', () => {
      const sql = 'ALTER TABLE users ADD COLUMN age INTEGER';
      const type = sqlCompatibility.getStatementType(sql);

      expect(type).toBe('DDL');
    });

    it('should identify DROP statements as DDL', () => {
      const sql = 'DROP TABLE users';
      const type = sqlCompatibility.getStatementType(sql);

      expect(type).toBe('DDL');
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle empty SQL gracefully', () => {
      const sql = '';
      const result = sqlCompatibility.transpileSQL(sql);

      expect(result.sql).toBe('');
      expect(result.hints).toEqual({});
    });

    it('should handle SQL with only whitespace', () => {
      const sql = '   \n\t   ';
      const result = sqlCompatibility.transpileSQL(sql);

      expect(result.sql).toBe('');
      expect(result.hints).toEqual({});
    });

    it('should handle malformed function calls', () => {
      const sql = 'SELECT CONCAT(name, FROM users';
      const result = sqlCompatibility.transpileSQL(sql);

      // Should not crash, but may not transpile perfectly
      expect(result.sql).toBeDefined();
    });

    it('should handle nested function calls', () => {
      const sql = 'SELECT UPPER(CONCAT(first_name, " ", last_name)) FROM users';
      const result = sqlCompatibility.transpileSQL(sql);

      expect(result.sql).toContain('UPPER(first_name || " " || last_name)');
    });

    it('should handle complex WHERE clauses with functions', () => {
      const sql = 'SELECT * FROM users WHERE LENGTH(email) > 5 AND YEAR(created_at) = 2023';
      const result = sqlCompatibility.transpileSQL(sql);

      expect(result.sql).toContain('LENGTH(email) > 5');
      expect(result.sql).toContain("STRFTIME('%Y', created_at) = 2023");
    });

    it('should handle JOIN queries', () => {
      const sql = 'SELECT u.name, p.title FROM users u JOIN posts p ON u.id = p.user_id';
      const result = sqlCompatibility.transpileSQL(sql);

      expect(result.sql).toBe(sql); // JOIN syntax is compatible
    });

    it('should handle subqueries', () => {
      const sql = 'SELECT * FROM users WHERE id IN (SELECT user_id FROM posts)';
      const result = sqlCompatibility.transpileSQL(sql);

      expect(result.sql).toBe(sql); // Subquery syntax is compatible
    });

    it('should handle UNION queries', () => {
      const sql = 'SELECT name FROM users UNION SELECT name FROM admins';
      const result = sqlCompatibility.transpileSQL(sql);

      expect(result.sql).toBe(sql); // UNION syntax is compatible
    });
  });

  describe('performance and large queries', () => {
    it('should handle large SQL queries', () => {
      const largeSQL = 'SELECT ' + 'col1, '.repeat(100) + 'col1 FROM users';
      const result = sqlCompatibility.transpileSQL(largeSQL);

      expect(result.sql).toBeDefined();
      expect(result.sql.length).toBeGreaterThan(0);
    });

    it('should handle queries with many parameters', () => {
      const sql = 'SELECT * FROM users WHERE ' + 'id = ? OR '.repeat(50) + 'id = ?';
      const params = Array.from({ length: 51 }, (_, i) => i);
      const result = sqlCompatibility.prepareStatement(sql, params);

      expect(result.params).toHaveLength(51);
    });
  });
});

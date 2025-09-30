import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SQLSecurityService } from '@/services/SQLSecurityService';
import type { CloudflareEnvironment } from '@/types';

describe('SQLSecurityService', () => {
  let service: SQLSecurityService;
  let mockEnv: CloudflareEnvironment;

  beforeEach(() => {
    vi.clearAllMocks();

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

    service = new SQLSecurityService(mockEnv);
  });

  describe('validateSQL', () => {
    it('should validate safe SQL queries', () => {
      const sql = 'SELECT * FROM users WHERE id = 1';
      expect(() => service.validateSQL(sql)).not.toThrow();
    });

    it('should throw for empty SQL', () => {
      expect(() => service.validateSQL('')).toThrow('Invalid SQL query');
    });

    it('should throw for non-string SQL', () => {
      expect(() => service.validateSQL(null as any)).toThrow('Invalid SQL query');
    });

    it('should throw for SQL that is too short', () => {
      expect(() => service.validateSQL('SE')).toThrow('SQL query too short');
    });

    it('should throw for SQL that is too long', () => {
      const longSQL = 'SELECT * FROM users WHERE ' + 'id = 1 AND '.repeat(1000) + 'id = 1';
      expect(() => service.validateSQL(longSQL)).toThrow('SQL query too long');
    });

    it('should detect UNION injection', () => {
      const sql = "SELECT * FROM users WHERE id = 1 UNION SELECT password FROM admins";
      expect(() => service.validateSQL(sql)).toThrow();
    });

    it('should detect OR 1=1 injection', () => {
      const sql = "SELECT * FROM users WHERE username = 'admin' OR 1=1";
      expect(() => service.validateSQL(sql)).toThrow();
    });

    it('should detect DROP TABLE injection', () => {
      const sql = "SELECT * FROM users; DROP TABLE users";
      expect(() => service.validateSQL(sql)).toThrow();
    });

    it('should detect DELETE injection', () => {
      const sql = "SELECT * FROM users; DELETE FROM users";
      expect(() => service.validateSQL(sql)).toThrow();
    });

    it('should validate SQL with parameters', () => {
      const sql = 'SELECT * FROM users WHERE id = ? AND name = ?';
      const params = [1, 'John'];
      expect(() => service.validateSQL(sql, params)).not.toThrow();
    });

    it('should validate SQL with null parameters', () => {
      const sql = 'SELECT * FROM users WHERE deleted_at = ?';
      const params = [null];
      expect(() => service.validateSQL(sql, params)).not.toThrow();
    });

    it('should validate SQL with boolean parameters', () => {
      const sql = 'SELECT * FROM users WHERE active = ?';
      const params = [true];
      expect(() => service.validateSQL(sql, params)).not.toThrow();
    });

    it('should validate SQL with Date parameters', () => {
      const sql = 'SELECT * FROM users WHERE created_at > ?';
      const params = [new Date()];
      expect(() => service.validateSQL(sql, params)).not.toThrow();
    });

    it('should throw for invalid parameter types', () => {
      const sql = 'SELECT * FROM users WHERE data = ?';
      const params = [{ invalid: 'object' }];
      expect(() => service.validateSQL(sql, params)).toThrow('Invalid parameter type');
    });
  });

  describe('sanitizeSQL', () => {
    it('should remove single-line comments', () => {
      const sql = 'SELECT * FROM users -- this is a comment';
      const sanitized = service.sanitizeSQL(sql);
      expect(sanitized).not.toContain('--');
      expect(sanitized).toContain('SELECT * FROM users');
    });

    it('should remove multi-line comments', () => {
      const sql = 'SELECT * /* comment */ FROM users';
      const sanitized = service.sanitizeSQL(sql);
      expect(sanitized).not.toContain('/*');
      expect(sanitized).not.toContain('*/');
      expect(sanitized).toContain('SELECT *');
      expect(sanitized).toContain('FROM users');
    });

    it('should remove MySQL hash comments', () => {
      const sql = 'SELECT * FROM users # this is a comment';
      const sanitized = service.sanitizeSQL(sql);
      expect(sanitized).not.toContain('#');
      expect(sanitized).toContain('SELECT * FROM users');
    });

    it('should normalize whitespace', () => {
      const sql = 'SELECT   *    FROM   users';
      const sanitized = service.sanitizeSQL(sql);
      expect(sanitized).toBe('SELECT * FROM users');
    });

    it('should handle newlines and tabs', () => {
      const sql = 'SELECT\t*\nFROM\nusers';
      const sanitized = service.sanitizeSQL(sql);
      expect(sanitized).toBe('SELECT * FROM users');
    });

    it('should remove multiple comment types', () => {
      const sql = 'SELECT * -- comment1\nFROM users /* comment2 */ WHERE id = 1';
      const sanitized = service.sanitizeSQL(sql);
      expect(sanitized).not.toContain('--');
      expect(sanitized).not.toContain('/*');
      expect(sanitized).toContain('SELECT *');
      expect(sanitized).toContain('FROM users');
    });
  });

  describe('escapeString', () => {
    it('should escape single quotes', () => {
      const escaped = service.escapeString("O'Brien");
      expect(escaped).toBe("O''Brien");
    });

    it('should escape multiple single quotes', () => {
      const escaped = service.escapeString("It's O'Brien's");
      expect(escaped).toBe("It''s O''Brien''s");
    });

    it('should return empty string unchanged', () => {
      const escaped = service.escapeString('');
      expect(escaped).toBe('');
    });

    it('should return normal string unchanged', () => {
      const escaped = service.escapeString('normal string');
      expect(escaped).toBe('normal string');
    });

    it('should throw for non-string values', () => {
      expect(() => service.escapeString(123 as any)).toThrow('Can only escape string values');
    });
  });

  describe('buildSafeSQL', () => {
    it('should build SQL with named parameters', () => {
      const template = 'SELECT * FROM users WHERE id = :id AND name = :name';
      const params = { id: 1, name: 'John' };
      const sql = service.buildSafeSQL(template, params);
      expect(sql).toContain('id = 1');
      expect(sql).toContain("name = 'John'");
    });

    it('should escape string parameters', () => {
      const template = 'SELECT * FROM users WHERE name = :name';
      const params = { name: "O'Brien" };
      const sql = service.buildSafeSQL(template, params);
      expect(sql).toContain("name = 'O''Brien'");
    });

    it('should handle null parameters', () => {
      const template = 'SELECT * FROM users WHERE deleted_at = :deleted';
      const params = { deleted: null };
      const sql = service.buildSafeSQL(template, params);
      expect(sql).toContain('deleted_at = NULL');
    });

    it('should handle boolean parameters', () => {
      const template = 'SELECT * FROM users WHERE active = :active';
      const params = { active: true };
      const sql = service.buildSafeSQL(template, params);
      expect(sql).toContain('active = 1');
    });

    it('should handle numeric parameters', () => {
      const template = 'SELECT * FROM users WHERE age = :age';
      const params = { age: 25 };
      const sql = service.buildSafeSQL(template, params);
      expect(sql).toContain('age = 25');
    });

    it('should replace multiple occurrences of the same parameter', () => {
      const template = 'SELECT * FROM users WHERE id = :id OR parent_id = :id';
      const params = { id: 1 };
      const sql = service.buildSafeSQL(template, params);
      expect(sql).toBe('SELECT * FROM users WHERE id = 1 OR parent_id = 1');
    });

    it('should handle undefined values as NULL', () => {
      const template = 'SELECT * FROM users WHERE optional_field = :field';
      const params = { field: undefined };
      const sql = service.buildSafeSQL(template, params);
      expect(sql).toContain('= NULL');
    });

    it('should handle Date parameters', () => {
      const template = 'SELECT * FROM users WHERE created_at = :date';
      const date = new Date('2024-01-01T00:00:00Z');
      const params = { date };
      const sql = service.buildSafeSQL(template, params);
      expect(sql).toContain('created_at =');
    });

    it('should handle zero as a number', () => {
      const template = 'SELECT * FROM users WHERE count = :count';
      const params = { count: 0 };
      const sql = service.buildSafeSQL(template, params);
      expect(sql).toContain('count = 0');
    });

    it('should handle negative numbers', () => {
      const template = 'SELECT * FROM users WHERE balance = :balance';
      const params = { balance: -100 };
      const sql = service.buildSafeSQL(template, params);
      expect(sql).toContain('balance = -100');
    });

    it('should handle false boolean', () => {
      const template = 'SELECT * FROM users WHERE active = :active';
      const params = { active: false };
      const sql = service.buildSafeSQL(template, params);
      expect(sql).toContain('active = 0');
    });
  });

  describe('isReadOnlyQuery', () => {
    it('should recognize SELECT as read-only', () => {
      expect(service.isReadOnlyQuery('SELECT * FROM users')).toBe(true);
    });

    it('should recognize SHOW as read-only', () => {
      expect(service.isReadOnlyQuery('SHOW TABLES')).toBe(true);
    });

    it('should recognize DESCRIBE as read-only', () => {
      expect(service.isReadOnlyQuery('DESCRIBE users')).toBe(true);
    });

    it('should recognize DESC as read-only', () => {
      expect(service.isReadOnlyQuery('DESC users')).toBe(true);
    });

    it('should recognize EXPLAIN as read-only', () => {
      expect(service.isReadOnlyQuery('EXPLAIN SELECT * FROM users')).toBe(true);
    });

    it('should reject INSERT as not read-only', () => {
      expect(service.isReadOnlyQuery('INSERT INTO users VALUES (1, "John")')).toBe(false);
    });

    it('should reject UPDATE as not read-only', () => {
      expect(service.isReadOnlyQuery('UPDATE users SET name = "Jane"')).toBe(false);
    });

    it('should reject DELETE as not read-only', () => {
      expect(service.isReadOnlyQuery('DELETE FROM users')).toBe(false);
    });

    it('should reject CREATE as not read-only', () => {
      expect(service.isReadOnlyQuery('CREATE TABLE users (id INT)')).toBe(false);
    });

    it('should reject DROP as not read-only', () => {
      expect(service.isReadOnlyQuery('DROP TABLE users')).toBe(false);
    });

    it('should handle lowercase queries', () => {
      expect(service.isReadOnlyQuery('select * from users')).toBe(true);
    });

    it('should handle queries with leading whitespace', () => {
      expect(service.isReadOnlyQuery('  SELECT * FROM users')).toBe(true);
    });
  });

  describe('Injection Detection', () => {
    it('should detect EXEC injection', () => {
      const sql = "SELECT * FROM users WHERE id = EXEC('malicious code')";
      expect(() => service.validateSQL(sql)).toThrow();
    });

    it('should detect hex encoding injection', () => {
      const sql = "SELECT * FROM users WHERE name = 0x61646D696E";
      expect(() => service.validateSQL(sql)).toThrow();
    });

    it('should detect CHAR function abuse', () => {
      const sql = "SELECT * FROM users WHERE name = CHAR(65)";
      expect(() => service.validateSQL(sql)).toThrow();
    });

    it('should detect WAITFOR DELAY attacks', () => {
      const sql = "SELECT * FROM users; WAITFOR DELAY '00:00:05'";
      expect(() => service.validateSQL(sql)).toThrow();
    });

    it('should detect BENCHMARK attacks', () => {
      const sql = "SELECT * FROM users WHERE id = BENCHMARK(5000000, SHA1('test'))";
      expect(() => service.validateSQL(sql)).toThrow();
    });

    it('should detect SLEEP attacks', () => {
      const sql = "SELECT * FROM users WHERE id = SLEEP(5)";
      expect(() => service.validateSQL(sql)).toThrow();
    });

    it('should detect LOAD_FILE attacks', () => {
      const sql = "SELECT LOAD_FILE('/etc/passwd')";
      expect(() => service.validateSQL(sql)).toThrow();
    });

    it('should detect INTO OUTFILE attacks', () => {
      const sql = "SELECT * INTO OUTFILE '/tmp/output.txt' FROM users";
      expect(() => service.validateSQL(sql)).toThrow();
    });

    it('should detect @@version enumeration', () => {
      const sql = "SELECT @@version";
      expect(() => service.validateSQL(sql)).toThrow();
    });

    it('should detect information_schema access', () => {
      const sql = "SELECT * FROM information_schema.tables";
      expect(() => service.validateSQL(sql)).toThrow();
    });
  });

  describe('Parameter Validation', () => {
    it('should validate string parameters for length', () => {
      const sql = 'SELECT * FROM users WHERE name = ?';
      const longString = 'a'.repeat(10001);
      const params = [longString];
      expect(() => service.validateSQL(sql, params)).toThrow();
    });

    it('should validate numeric parameters for special values', () => {
      const sql = 'SELECT * FROM users WHERE id = ?';
      const params = [Infinity];
      expect(() => service.validateSQL(sql, params)).toThrow();
    });

    it('should validate numeric parameters for NaN', () => {
      const sql = 'SELECT * FROM users WHERE id = ?';
      const params = [NaN];
      expect(() => service.validateSQL(sql, params)).toThrow();
    });

    it('should accept valid string parameters', () => {
      const sql = 'SELECT * FROM users WHERE name = ?';
      const params = ['John'];
      expect(() => service.validateSQL(sql, params)).not.toThrow();
    });

    it('should accept valid numeric parameters', () => {
      const sql = 'SELECT * FROM users WHERE id = ?';
      const params = [123];
      expect(() => service.validateSQL(sql, params)).not.toThrow();
    });

    it('should accept negative numbers', () => {
      const sql = 'SELECT * FROM users WHERE balance = ?';
      const params = [-100];
      expect(() => service.validateSQL(sql, params)).not.toThrow();
    });

    it('should accept decimal numbers', () => {
      const sql = 'SELECT * FROM users WHERE balance = ?';
      const params = [123.45];
      expect(() => service.validateSQL(sql, params)).not.toThrow();
    });
  });

  describe('Quote and Parenthesis Validation', () => {
    it('should detect unbalanced single quotes', () => {
      const sql = "SELECT * FROM users WHERE name = 'John";
      expect(() => service.validateSQL(sql)).toThrow();
    });

    it('should detect unbalanced double quotes', () => {
      const sql = 'SELECT * FROM users WHERE name = "John';
      expect(() => service.validateSQL(sql)).toThrow();
    });

    it('should detect unbalanced parentheses - missing closing', () => {
      const sql = 'SELECT * FROM users WHERE id IN (1, 2, 3';
      expect(() => service.validateSQL(sql)).toThrow();
    });

    it('should detect unbalanced parentheses - missing opening', () => {
      const sql = 'SELECT * FROM users WHERE id IN 1, 2, 3)';
      expect(() => service.validateSQL(sql)).toThrow();
    });

    it('should accept balanced quotes and parentheses', () => {
      const sql = "SELECT * FROM users WHERE name = 'John' AND id IN (1, 2, 3)";
      expect(() => service.validateSQL(sql)).not.toThrow();
    });

    it('should handle nested parentheses', () => {
      const sql = 'SELECT * FROM users WHERE id IN (SELECT id FROM (SELECT * FROM admins))';
      expect(() => service.validateSQL(sql)).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle SQL with escaped quotes in strings', () => {
      const sql = "SELECT * FROM users WHERE name = 'O''Brien'";
      expect(() => service.validateSQL(sql)).not.toThrow();
    });

    it('should handle SQL with backticks', () => {
      const sql = 'SELECT * FROM `users` WHERE `id` = 1';
      expect(() => service.validateSQL(sql)).not.toThrow();
    });

    it('should handle SQL with various whitespace', () => {
      const sql = '  SELECT  \n  *  \t  FROM   users  ';
      expect(() => service.validateSQL(sql)).not.toThrow();
    });

    it('should handle complex WHERE clauses', () => {
      const sql = 'SELECT * FROM users WHERE (age > 18 AND status = "active") OR (premium = 1)';
      expect(() => service.validateSQL(sql)).not.toThrow();
    });

    it('should handle JOINs', () => {
      const sql = 'SELECT u.*, p.* FROM users u JOIN profiles p ON u.id = p.user_id';
      expect(() => service.validateSQL(sql)).not.toThrow();
    });

    it('should handle subqueries', () => {
      const sql = 'SELECT * FROM users WHERE id IN (SELECT user_id FROM orders WHERE total > 100)';
      expect(() => service.validateSQL(sql)).not.toThrow();
    });

    it('should handle CASE statements', () => {
      const sql = 'SELECT CASE WHEN age > 18 THEN "adult" ELSE "minor" END FROM users';
      expect(() => service.validateSQL(sql)).not.toThrow();
    });

    it('should handle ORDER BY and LIMIT', () => {
      const sql = 'SELECT * FROM users ORDER BY created_at DESC LIMIT 10';
      expect(() => service.validateSQL(sql)).not.toThrow();
    });

    it('should handle GROUP BY and HAVING', () => {
      const sql = 'SELECT status, COUNT(*) FROM users GROUP BY status HAVING COUNT(*) > 5';
      expect(() => service.validateSQL(sql)).not.toThrow();
    });

    it('should detect script injection in comments', () => {
      const sql = "SELECT * FROM users WHERE id = 1 -- <script>alert('xss')</script>";
      expect(() => service.validateSQL(sql)).toThrow();
    });

    it('should handle Date values in buildSafeSQL', () => {
      const template = 'SELECT * FROM users WHERE created_at > :date';
      const params = { date: new Date('2024-01-01') };
      const sql = service.buildSafeSQL(template, params);
      expect(sql).toContain('created_at >');
    });

    it('should handle array parameters as error', () => {
      const sql = 'SELECT * FROM users WHERE id IN (?)';
      const params = [[1, 2, 3]];
      expect(() => service.validateSQL(sql, params)).toThrow('Invalid parameter type');
    });

    it('should validate extremely long parameter string', () => {
      const sql = 'SELECT * FROM users WHERE data = ?';
      const longParam = 'x'.repeat(10001);
      const params = [longParam];
      expect(() => service.validateSQL(sql, params)).toThrow();
    });

    it('should detect stacked queries with semicolon', () => {
      const sql = 'SELECT * FROM users WHERE id = 1; DELETE FROM users';
      expect(() => service.validateSQL(sql)).toThrow();
    });

    it('should detect concatenation injection patterns', () => {
      const sql = "SELECT * FROM users WHERE name = 'admin' + ' OR 1=1'";
      expect(() => service.validateSQL(sql)).toThrow();
    });

    it('should accept valid aggregate functions', () => {
      const sql = 'SELECT COUNT(*), AVG(age), MAX(salary) FROM users';
      expect(() => service.validateSQL(sql)).not.toThrow();
    });

    it('should accept valid BETWEEN operator', () => {
      const sql = 'SELECT * FROM users WHERE age BETWEEN 18 AND 65';
      expect(() => service.validateSQL(sql)).not.toThrow();
    });
  });
});

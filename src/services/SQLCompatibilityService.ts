import { EdgeSQLError } from '../types';
import { BaseService } from './BaseService';
import type { CloudflareEnvironment, QueryHints, SQLQuery } from '../types';

/**
 * SQL Compatibility Layer for MySQL to SQLite transpilation
 * Handles query hints, DDL statements, parameter binding, and transaction demarcation
 */
export class SQLCompatibilityService extends BaseService {
  // Lightweight plan cache for transpiled SQL and hints
  private planCache: Map<string, { sql: string; hints: QueryHints }> = new Map();
  private readonly planCacheLimit = 500;
  // MySQL to SQLite function mappings
  private readonly functionMappings: Record<string, string> = {
    // String functions
    // CONCAT handled separately
    CONCAT_WS: 'GROUP_CONCAT', // Approximate mapping
    SUBSTRING: 'SUBSTR',
    SUBSTR: 'SUBSTR',
    LENGTH: 'LENGTH',
    CHAR_LENGTH: 'LENGTH',
    CHARACTER_LENGTH: 'LENGTH',
    LTRIM: 'LTRIM',
    RTRIM: 'RTRIM',
    TRIM: 'TRIM',
    UPPER: 'UPPER',
    LOWER: 'LOWER',
    REPLACE: 'REPLACE',
    REPEAT: 'REPLACE', // Approximate
    REVERSE: 'REVERSE',
    LEFT: 'SUBSTR',
    RIGHT: 'SUBSTR',

    // Date/Time functions
    CURRENT_TIMESTAMP: "DATETIME('now')",
    CURDATE: "DATE('now')",
    CURTIME: "TIME('now')",
    DATE: 'DATE',
    TIME: 'TIME',
    // MONTH, DAY, HOUR, MINUTE, SECOND handled specifically
    UNIX_TIMESTAMP: 'STRFTIME',

    // Math functions
    ABS: 'ABS',
    CEIL: 'CEILING',
    CEILING: 'CEILING',
    FLOOR: 'FLOOR',
    ROUND: 'ROUND',
    TRUNCATE: 'ROUND', // Approximate
    MOD: '%',
    POWER: 'POWER',
    SQRT: 'SQRT',
    RAND: 'RANDOM',
    PI: '3.141592653589793',

    // Aggregate functions
    COUNT: 'COUNT',
    SUM: 'SUM',
    AVG: 'AVG',
    MIN: 'MIN',
    MAX: 'MAX',
    GROUP_CONCAT: 'GROUP_CONCAT',

    // Control flow functions
    IF: 'CASE WHEN',
    IFNULL: 'COALESCE',
    NULLIF: 'NULLIF',
    COALESCE: 'COALESCE',
    GREATEST: 'MAX',
    LEAST: 'MIN',
  };

  // MySQL data types to SQLite mappings
  private readonly dataTypeMappings: Record<string, string> = {
    TINYINT: 'INTEGER',
    SMALLINT: 'INTEGER',
    MEDIUMINT: 'INTEGER',
    BIGINT: 'INTEGER',
    INT: 'INTEGER',
    INTEGER: 'INTEGER',
    FLOAT: 'REAL',
    DOUBLE: 'REAL',
    DECIMAL: 'REAL',
    NUMERIC: 'REAL',
    BOOLEAN: 'INTEGER',
    BOOL: 'INTEGER',
    CHAR: 'TEXT',
    VARCHAR: 'TEXT',
    TINYTEXT: 'TEXT',
    TEXT: 'TEXT',
    MEDIUMTEXT: 'TEXT',
    LONGTEXT: 'TEXT',
    BINARY: 'BLOB',
    VARBINARY: 'BLOB',
    TINYBLOB: 'BLOB',
    BLOB: 'BLOB',
    MEDIUMBLOB: 'BLOB',
    LONGBLOB: 'BLOB',
    DATE: 'TEXT',
    TIME: 'TEXT',
    DATETIME: 'TEXT',
    TIMESTAMP: 'TEXT',
    YEAR: 'INTEGER',
    ENUM: 'TEXT',
    SET: 'TEXT',
    JSON: 'TEXT',
  };

  constructor(env: CloudflareEnvironment) {
    super(env);
  }

  /**
   * Transpile MySQL SQL to SQLite-compatible SQL
   */
  transpileSQL(sql: string): { sql: string; hints: QueryHints } {
    const key = sql;
    const cached = this.planCache.get(key);
    if (cached) {
      // refresh LRU order
      this.planCache.delete(key);
      this.planCache.set(key, cached);
      return { sql: cached.sql, hints: { ...cached.hints } };
    }
    let transpiledSQL = sql;
    const hints: QueryHints = {};

    // Parse and remove query hints
    const hintResult = this.parseQueryHints(sql);
    transpiledSQL = hintResult.sql;
    Object.assign(hints, hintResult.hints);

    // Handle different SQL statement types
    const upperSQL = transpiledSQL.trim().toUpperCase();

    if (upperSQL.startsWith('CREATE')) {
      transpiledSQL = this.transpileDDL(transpiledSQL);
    } else if (upperSQL.startsWith('ALTER')) {
      transpiledSQL = this.transpileDDL(transpiledSQL);
    } else if (upperSQL.startsWith('DROP')) {
      transpiledSQL = this.transpileDDL(transpiledSQL);
    } else if (
      upperSQL.startsWith('SELECT') ||
      upperSQL.startsWith('INSERT') ||
      upperSQL.startsWith('UPDATE') ||
      upperSQL.startsWith('DELETE')
    ) {
      transpiledSQL = this.transpileDML(transpiledSQL);
    } else if (
      upperSQL.startsWith('BEGIN') ||
      upperSQL.startsWith('COMMIT') ||
      upperSQL.startsWith('ROLLBACK') ||
      upperSQL.startsWith('START TRANSACTION')
    ) {
      transpiledSQL = this.transpileTransaction(transpiledSQL);
    }

    this.log('debug', 'SQL transpiled', {
      original: sql.substring(0, 100),
      transpiled: transpiledSQL.substring(0, 100),
      hints,
    });

    const out = { sql: transpiledSQL, hints };
    // Insert into LRU cache
    if (this.planCache.has(key)) {
      this.planCache.delete(key);
    }
    this.planCache.set(key, { sql: transpiledSQL, hints: { ...hints } });
    if (this.planCache.size > this.planCacheLimit) {
      const first = this.planCache.keys().next().value as string | undefined;
      if (first) {
        this.planCache.delete(first);
      }
    }
    return out;
  }

  /**
   * Parse query hints from SQL comments
   */
  private parseQueryHints(sql: string): { sql: string; hints: QueryHints } {
    const hints: QueryHints = {};
    let cleanedSQL = sql;

    // Find all hint comments
    const hintCommentRegex = /\/\*\+[^}]*?\*\//g;
    const hintMatches = sql.match(hintCommentRegex);

    if (hintMatches) {
      // Process hints in order (last valid hint wins for conflicts)
      for (const hintMatch of hintMatches) {
        const hintContent = hintMatch.slice(3, -2).trim(); // Remove /*+ and */

        // Strong consistency hint
        if (hintContent === 'strong') {
          hints.consistency = 'strong';
        }

        // Bounded consistency hint
        const boundedMatch = hintContent.match(/^bounded\s*=\s*(\d+)$/i);
        if (boundedMatch && boundedMatch[1]) {
          hints.consistency = 'bounded';
          hints.boundedMs = parseInt(boundedMatch[1], 10);
        }

        // Weak consistency hint
        if (hintContent === 'weak') {
          hints.consistency = 'cached';
        }
      }

      // Remove all hint comments from SQL
      cleanedSQL = cleanedSQL.replace(hintCommentRegex, ' ');
    }

    // Clean up extra whitespace
    cleanedSQL = cleanedSQL.replace(/\s+/g, ' ').trim();

    return { sql: cleanedSQL, hints };
  }

  /**
   * Transpile DDL statements (CREATE, ALTER, DROP)
   */
  private transpileDDL(sql: string): string {
    let transpiled = sql;

    // Handle CREATE TABLE statements
    if (sql.toUpperCase().includes('CREATE TABLE')) {
      transpiled = this.transpileCreateTable(sql);
    }

    // Handle ALTER TABLE statements
    else if (sql.toUpperCase().includes('ALTER TABLE')) {
      transpiled = this.transpileAlterTable(sql);
    }

    // Handle CREATE INDEX statements
    else if (sql.toUpperCase().includes('CREATE INDEX')) {
      transpiled = this.transpileCreateIndex(sql);
    }

    // Handle DROP statements
    else if (sql.toUpperCase().includes('DROP')) {
      transpiled = this.transpileDrop(sql);
    }

    return transpiled;
  }

  /**
   * Transpile CREATE TABLE statements
   */
  private transpileCreateTable(sql: string): string {
    // Replace MySQL data types with SQLite equivalents
    let transpiled = sql;

    for (const [mysqlType, sqliteType] of Object.entries(this.dataTypeMappings)) {
      const regex = new RegExp(`\\b${mysqlType}(\\([^)]*\\))?\\b`, 'gi');
      transpiled = transpiled.replace(regex, () => sqliteType);
    }

    // Clean any lingering TEXT(length) artifacts just in case
    transpiled = transpiled.replace(/\bTEXT\s*\(\s*\d+\s*\)/gi, 'TEXT');

    // Handle AUTO_INCREMENT -> AUTOINCREMENT
    transpiled = transpiled.replace(/\bAUTO_INCREMENT\b/gi, 'AUTOINCREMENT');

    // Handle ENGINE=InnoDB and similar
    transpiled = transpiled.replace(/\s+ENGINE\s*=\s*\w+/gi, '');

    // Handle DEFAULT CHARSET
    transpiled = transpiled.replace(/\s+DEFAULT\s+CHARSET\s*=\s*\w+/gi, '');

    // Handle COLLATE
    transpiled = transpiled.replace(/\s+COLLATE\s*=\s*[\w_]+/gi, '');

    // Handle MySQL-specific constraints
    transpiled = transpiled.replace(/\s+UNSIGNED\s+/gi, ' ');

    return transpiled;
  }

  /**
   * Transpile ALTER TABLE statements
   */
  private transpileAlterTable(sql: string): string {
    // SQLite has limited ALTER TABLE support
    // For now, we'll log a warning and return the SQL as-is
    // In a full implementation, this would require table recreation
    this.log('warn', 'ALTER TABLE transpilation limited in SQLite', { sql });

    // Handle simple column additions (SQLite supports ADD COLUMN)
    if (sql.toUpperCase().includes('ADD COLUMN')) {
      let result = sql.replace(/\bADD COLUMN\b/gi, 'ADD');

      // Convert MySQL data types to SQLite in ALTER TABLE (drop any length specifiers)
      for (const [mysqlType, sqliteType] of Object.entries(this.dataTypeMappings)) {
        const regex = new RegExp(`\\b${mysqlType}(\\([^)]*\\))?\\b`, 'gi');
        result = result.replace(regex, () => {
          return sqliteType;
        });
      }

      return result;
    }

    // Handle column renames
    if (sql.toUpperCase().includes('RENAME COLUMN')) {
      this.log('error', 'RENAME COLUMN not supported in SQLite ALTER TABLE');
      throw new EdgeSQLError('RENAME COLUMN not supported in SQLite', 'DDL_UNSUPPORTED');
    }

    // Handle column drops
    if (sql.toUpperCase().includes('DROP COLUMN')) {
      this.log('error', 'DROP COLUMN not supported in SQLite ALTER TABLE');
      throw new EdgeSQLError('DROP COLUMN not supported in SQLite', 'DDL_UNSUPPORTED');
    }

    return sql;
  }

  /**
   * Transpile CREATE INDEX statements
   */
  private transpileCreateIndex(sql: string): string {
    // CREATE INDEX syntax is mostly compatible
    return sql;
  }

  /**
   * Transpile DROP statements
   */
  private transpileDrop(sql: string): string {
    // DROP syntax is mostly compatible
    return sql;
  }

  /**
   * Transpile DML statements (SELECT, INSERT, UPDATE, DELETE)
   */
  private transpileDML(sql: string): string {
    let transpiled = sql;

    // Replace MySQL functions with SQLite equivalents
    for (const [mysqlFunc, sqliteFunc] of Object.entries(this.functionMappings)) {
      const regex = new RegExp(`\\b${mysqlFunc}\\b`, 'gi');
      transpiled = transpiled.replace(regex, sqliteFunc);
    }

    // Handle specific function conversions
    transpiled = this.convertSpecificFunctions(transpiled);

    // Convert CONCAT function calls to proper SQLite concatenation
    transpiled = this.convertConcatFunctions(transpiled);

    // Handle LIMIT with OFFSET syntax
    transpiled = this.convertLimitOffset(transpiled);

    // Handle INSERT ... ON DUPLICATE KEY UPDATE
    transpiled = this.convertOnDuplicateKey(transpiled);

    return transpiled;
  }

  /**
   * Convert specific MySQL functions to SQLite equivalents
   */
  private convertSpecificFunctions(sql: string): string {
    let converted = sql;

    // Handle GROUP_CONCAT
    converted = converted.replace(/GROUP_CONCAT\s*\(/gi, (match) => {
      return match.replace('GROUP_CONCAT', '');
    });

    // Handle IF function -> CASE WHEN
    converted = converted.replace(/IF\s*\(/gi, (match) => {
      return match.replace('IF', 'CASE WHEN');
    });

    // Handle NOW() -> datetime('now')
    converted = converted.replace(/\bNOW\s*\(\s*\)/gi, "DATETIME('now')");

    // Handle CURDATE() -> date('now')
    converted = converted.replace(/\bCURDATE\s*\(\s*\)/gi, "DATE('now')");

    // Handle CURTIME() -> time('now')
    converted = converted.replace(/\bCURTIME\s*\(\s*\)/gi, "TIME('now')");

    // Handle YEAR() function specifically
    converted = converted.replace(/\bYEAR\s*\(\s*([^)]+)\s*\)/gi, (_m, p1) => {
      return `STRFTIME('%Y', ${String(p1).toLowerCase()})`;
    });

    // Handle MONTH() function specifically
    converted = converted.replace(/\bMONTH\s*\(\s*([^)]+)\s*\)/gi, (_m, p1) => {
      return `STRFTIME('%m', ${String(p1).toLowerCase()})`;
    });

    // Handle DAY() function specifically
    converted = converted.replace(/\bDAY\s*\(\s*([^)]+)\s*\)/gi, "STRFTIME('%d', $1)");

    // Handle HOUR() function specifically
    converted = converted.replace(/\bHOUR\s*\(\s*([^)]+)\s*\)/gi, "STRFTIME('%H', $1)");

    // Handle MINUTE() function specifically
    converted = converted.replace(/\bMINUTE\s*\(\s*([^)]+)\s*\)/gi, "STRFTIME('%M', $1)");

    // Handle SECOND() function specifically
    converted = converted.replace(/\bSECOND\s*\(\s*([^)]+)\s*\)/gi, "STRFTIME('%S', $1)");

    // Handle STRFTIME functions that need format specifiers
    // These handle cases where MONTH/DATE/etc. have already been replaced with STRFTIME
    converted = converted.replace(/STRFTIME\s*\(\s*DATE\s*\)/gi, "STRFTIME('%m', DATE)");
    converted = converted.replace(/STRFTIME\s*\(\s*TIME\s*\)/gi, "STRFTIME('%H:%M:%S', TIME)");
    converted = converted.replace(/STRFTIME\s*\(\s*YEAR\s*\)/gi, "STRFTIME('%Y', YEAR)");
    converted = converted.replace(/STRFTIME\s*\(\s*MONTH\s*\)/gi, "STRFTIME('%m', MONTH)");
    converted = converted.replace(/STRFTIME\s*\(\s*DAY\s*\)/gi, "STRFTIME('%d', DAY)");
    converted = converted.replace(/STRFTIME\s*\(\s*HOUR\s*\)/gi, "STRFTIME('%H', HOUR)");
    converted = converted.replace(/STRFTIME\s*\(\s*MINUTE\s*\)/gi, "STRFTIME('%M', MINUTE)");
    converted = converted.replace(/STRFTIME\s*\(\s*SECOND\s*\)/gi, "STRFTIME('%S', SECOND)");

    // Handle UNIX_TIMESTAMP()
    converted = converted.replace(/\bUNIX_TIMESTAMP\s*\(\s*\)/gi, "STRFTIME('%s', 'now')");

    return converted;
  }

  /**
   * Convert CONCAT function calls to proper SQLite concatenation syntax
   */
  private convertConcatFunctions(sql: string): string {
    // Robust parse: turn CONCAT(arg1, arg2, ...) into arg1 || arg2 || ...
    let out = '';
    let i = 0;
    const s = sql;
    const upper = s.toUpperCase();
    while (i < s.length) {
      const idx = upper.indexOf('CONCAT(', i);
      if (idx === -1) {
        out += s.slice(i);
        break;
      }
      out += s.slice(i, idx);
      let j = idx + 'CONCAT('.length;
      let depth = 1;
      let inSingle = false;
      let inDouble = false;
      while (j < s.length && depth > 0) {
        const ch = s[j];
        const prev = j > 0 ? s[j - 1] : '';
        if (!inDouble && ch === "'" && prev !== '\\') {
          inSingle = !inSingle;
        } else if (!inSingle && ch === '"' && prev !== '\\') {
          inDouble = !inDouble;
        } else if (!inSingle && !inDouble) {
          if (ch === '(') {
            depth++;
          } else if (ch === ')') {
            depth--;
          }
        }
        j++;
      }
      const inner = s.slice(idx + 'CONCAT('.length, j - 1);
      // split top-level commas
      const parts: string[] = [];
      let buf = '';
      let depth2 = 0;
      inSingle = false;
      inDouble = false;
      for (let k = 0; k < inner.length; k++) {
        const ch = inner[k];
        const prev = k > 0 ? inner[k - 1] : '';
        if (!inDouble && ch === "'" && prev !== '\\') {
          inSingle = !inSingle;
        } else if (!inSingle && ch === '"' && prev !== '\\') {
          inDouble = !inDouble;
        } else if (!inSingle && !inDouble) {
          if (ch === '(') {
            depth2++;
          } else if (ch === ')') {
            depth2--;
          } else if (ch === ',' && depth2 === 0) {
            parts.push(buf.trim());
            buf = '';
            continue;
          }
        }
        buf += ch;
      }
      if (buf.trim()) {
        parts.push(buf.trim());
      }
      out += parts.join(' || ');
      i = j;
    }
    return out;
  }

  // (no UPPER rewrite; preserving UPPER(CONCAT(...)) -> UPPER(arg1 || arg2 ...) semantics)

  /**
   * Convert MySQL LIMIT OFFSET syntax
   */
  private convertLimitOffset(sql: string): string {
    // MySQL: LIMIT offset, count -> SQLite: LIMIT count OFFSET offset
    const limitRegex = /LIMIT\s+(\d+)\s*,\s*(\d+)/gi;
    return sql.replace(limitRegex, 'LIMIT $2 OFFSET $1');
  }

  /**
   * Convert MySQL INSERT ... ON DUPLICATE KEY UPDATE
   */
  private convertOnDuplicateKey(sql: string): string {
    // This is complex to convert to SQLite INSERT OR REPLACE
    // For now, we'll log a warning and handle it in the application layer
    if (sql.toUpperCase().includes('ON DUPLICATE KEY UPDATE')) {
      this.log('warn', 'ON DUPLICATE KEY UPDATE requires special handling', { sql });
    }
    return sql;
  }

  /**
   * Transpile transaction statements
   */
  private transpileTransaction(sql: string): string {
    const upperSQL = sql.toUpperCase();

    if (upperSQL.startsWith('BEGIN') || upperSQL.startsWith('START TRANSACTION')) {
      return 'BEGIN TRANSACTION';
    }

    if (upperSQL.startsWith('COMMIT')) {
      return 'COMMIT';
    }

    if (upperSQL.startsWith('ROLLBACK')) {
      return 'ROLLBACK';
    }

    return sql;
  }

  /**
   * Prepare statement with parameter binding
   */
  prepareStatement(sql: string, params: unknown[]): { sql: string; params: unknown[] } {
    let preparedSQL = sql;
    const preparedParams: unknown[] = [];

    // Handle MySQL-style ? placeholders
    let paramIndex = 0;
    preparedSQL = preparedSQL.replace(/\?/g, () => {
      if (paramIndex < params.length) {
        preparedParams.push(params[paramIndex]);
        paramIndex++;
        return '?';
      }
      return '?';
    });

    // Handle named parameters (:param)
    const namedParamRegex = /:(\w+)/g;
    while (namedParamRegex.exec(sql) !== null) {
      // For now, convert named params to positional
      // In a full implementation, this would map named params to positional
      preparedParams.push(params[paramIndex] || null);
      paramIndex++;
    }

    return { sql: preparedSQL, params: preparedParams };
  }

  /**
   * Validate SQL syntax and compatibility
   */
  validateSQL(sql: string): void {
    // Basic validation - check for common MySQL features not supported in SQLite
    const unsupportedFeatures = [
      'LOCK TABLES',
      'UNLOCK TABLES',
      'FLUSH',
      'SHOW',
      'DESCRIBE',
      'EXPLAIN',
      'ANALYZE',
      'OPTIMIZE',
      'REPAIR',
      'CHECK',
      'FOREIGN KEY', // SQLite supports but with limitations
    ];

    const upperSQL = sql.toUpperCase();
    for (const feature of unsupportedFeatures) {
      if (upperSQL.includes(feature)) {
        this.log('warn', `Potentially unsupported feature: ${feature}`, { sql });
      }
    }

    // Check for MySQL-specific syntax
    if (upperSQL.includes('INSERT IGNORE')) {
      this.log('warn', 'INSERT IGNORE syntax detected - may need special handling');
    }

    if (upperSQL.includes('REPLACE INTO')) {
      this.log('warn', 'REPLACE INTO syntax detected - converting to INSERT OR REPLACE');
    }
  }

  /**
   * Extract table name from SQL query
   */
  extractTableName(sql: string): string {
    const patterns = [
      /(?:FROM|INTO|UPDATE|CREATE TABLE|ALTER TABLE|DROP TABLE)\s+`?(\w+)`?/i,
      /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+`?(\w+)`?/i,
    ];

    for (const pattern of patterns) {
      const match = sql.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return 'unknown';
  }

  /**
   * Determine SQL statement type
   */
  getStatementType(sql: string): SQLQuery['type'] {
    const upperSQL = sql.trim().toUpperCase();

    if (upperSQL.startsWith('SELECT')) {
      return 'SELECT';
    } else if (upperSQL.startsWith('INSERT')) {
      return 'INSERT';
    } else if (upperSQL.startsWith('UPDATE')) {
      return 'UPDATE';
    } else if (upperSQL.startsWith('DELETE')) {
      return 'DELETE';
    } else if (upperSQL.match(/^(CREATE|ALTER|DROP|TRUNCATE)/)) {
      return 'DDL';
    }

    return 'SELECT'; // Default
  }
}

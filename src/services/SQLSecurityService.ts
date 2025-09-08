import { EdgeSQLError } from '../types';
import { BaseService } from './BaseService';
import type { CloudflareEnvironment } from '../types';

/**
 * SQL injection prevention patterns and validation
 */
export class SQLSecurityService extends BaseService {
  // Dangerous SQL keywords that require special handling
  private readonly dangerousKeywords = [
    'UNION',
    'DROP',
    'DELETE',
    'INSERT',
    'UPDATE',
    'CREATE',
    'ALTER',
    'EXEC',
    'EXECUTE',
    'SCRIPT',
    'DECLARE',
    'CURSOR',
    'FETCH',
    'BULK',
    'OPENROWSET',
    'OPENDATASOURCE',
    'sp_',
    'xp_',
  ];

  // SQL comment patterns
  private readonly commentPatterns = [
    /--.*$/gm, // Single line comments
    /\/\*[\s\S]*?\*\//g, // Multi-line comments
    /#.*$/gm, // MySQL hash comments
  ];

  // Suspicious SQL patterns that might indicate injection attempts
  private readonly suspiciousPatterns = [
    /(\bUNION\b.*\bSELECT\b)/i, // Union-based injection
    /('\s*OR\s*'\s*=\s*')/i, // Boolean-based injection
    /('\s*OR\s+1\s*=\s*1)/i, // Classic OR 1=1
    /(;\s*DROP\s+TABLE)/i, // Table dropping
    /(;\s*DELETE\s+FROM)/i, // Delete statements
    /(EXEC\s*\()/i, // Dynamic execution
    /(<script>)/i, // Script injection
    /('\s*\+\s*')/, // String concatenation
    /(0x[0-9a-f]+)/i, // Hex encoding
    /(CHAR\s*\(\s*\d+\s*\))/i, // Character function abuse
    /(CONVERT\s*\([^)]*,\s*[^)]*\))/i, // Convert function abuse
    /(WAITFOR\s+DELAY)/i, // Time delay attacks
    /(BENCHMARK\s*\()/i, // MySQL benchmark function
    /(SLEEP\s*\()/i, // Sleep function attacks
    /(LOAD_FILE\s*\()/i, // File reading attempts
    /(INTO\s+OUTFILE)/i, // File writing attempts
    /(@@version)/i, // Version detection
    /(@@servername)/i, // Server name detection
    /(information_schema)/i, // Schema enumeration
    /(pg_sleep)/i, // PostgreSQL sleep
    /(dbms_pipe\.receive_message)/i, // Oracle delay
  ];

  // Allowed SQL operators and functions for validation
  // Note: These arrays are defined for future use in whitelist validation
  // private readonly allowedOperators = [
  //   '=',
  //   '!=',
  //   '<>',
  //   '<',
  //   '>',
  //   '<=',
  //   '>=',
  //   'LIKE',
  //   'IN',
  //   'NOT IN',
  //   'IS NULL',
  //   'IS NOT NULL',
  //   'BETWEEN',
  //   'AND',
  //   'OR',
  //   'NOT',
  // ];

  // private readonly allowedFunctions = [
  //   'COUNT',
  //   'SUM',
  //   'AVG',
  //   'MIN',
  //   'MAX',
  //   'LENGTH',
  //   'UPPER',
  //   'LOWER',
  //   'SUBSTR',
  //   'SUBSTRING',
  //   'TRIM',
  //   'LTRIM',
  //   'RTRIM',
  //   'CONCAT',
  //   'COALESCE',
  //   'NULLIF',
  //   'CASE',
  //   'WHEN',
  //   'THEN',
  //   'ELSE',
  //   'END',
  //   'CAST',
  //   'DATE',
  //   'TIME',
  //   'DATETIME',
  //   'NOW',
  //   'CURRENT_TIMESTAMP',
  // ];

  constructor(env: CloudflareEnvironment) {
    super(env);
  }

  /**
   * Validate SQL query for injection attempts
   */
  validateSQL(sql: string, params?: unknown[]): void {
    if (!sql || typeof sql !== 'string') {
      throw new EdgeSQLError('Invalid SQL query', 'SQL_INVALID_QUERY');
    }

    // Basic validation
    this.validateBasicSQLStructure(sql);

    // Check for suspicious patterns
    this.detectSuspiciousPatterns(sql);

    // Validate parameters if provided
    if (params) {
      this.validateParameters(params);
    }

    // Check for SQL injection signatures
    this.detectInjectionSignatures(sql);

    // Validate against whitelist patterns
    this.validateWhitelistPatterns(sql);

    this.log('debug', 'SQL validation passed', {
      sqlLength: sql.length,
      paramCount: params?.length || 0,
    });
  }

  /**
   * Sanitize SQL query by removing dangerous elements
   */
  sanitizeSQL(sql: string): string {
    let sanitized = sql;

    // Remove comments (potential hiding places for injection)
    this.commentPatterns.forEach((pattern) => {
      sanitized = sanitized.replace(pattern, '');
    });

    // Normalize whitespace
    sanitized = sanitized.replace(/\s+/g, ' ').trim();

    // Remove dangerous characters in certain contexts
    sanitized = this.removeDangerousCharacters(sanitized);

    return sanitized;
  }

  /**
   * Escape SQL string values to prevent injection
   */
  escapeString(value: string): string {
    if (typeof value !== 'string') {
      throw new EdgeSQLError('Can only escape string values', 'SQL_ESCAPE_TYPE_ERROR');
    }

    // Escape single quotes by doubling them
    return value.replace(/'/g, "''");
  }

  /**
   * Validate parameterized query parameters
   */
  validateParameters(params: unknown[]): void {
    for (let i = 0; i < params.length; i++) {
      const param = params[i];

      // Check parameter type
      if (typeof param === 'string') {
        this.validateStringParameter(param, i);
      } else if (typeof param === 'number') {
        this.validateNumericParameter(param, i);
      } else if (param === null || param === undefined) {
        // Null values are acceptable
        continue;
      } else if (typeof param === 'boolean') {
        // Boolean values are acceptable
        continue;
      } else if (param instanceof Date) {
        // Date objects are acceptable
        continue;
      } else {
        throw new EdgeSQLError(
          `Invalid parameter type at index ${i}: ${typeof param}`,
          'SQL_INVALID_PARAM_TYPE'
        );
      }
    }
  }

  /**
   * Generate safe SQL with parameterized values
   */
  buildSafeSQL(template: string, params: Record<string, unknown>): string {
    let sql = template;

    // Replace named parameters with escaped values
    for (const [key, value] of Object.entries(params)) {
      const placeholder = `:${key}`;
      if (sql.includes(placeholder)) {
        const escapedValue = this.escapeParameterValue(value);
        sql = sql.replace(new RegExp(placeholder, 'g'), escapedValue);
      }
    }

    // Validate the resulting SQL
    this.validateSQL(sql);

    return sql;
  }

  /**
   * Check if SQL query is a read-only operation
   */
  isReadOnlyQuery(sql: string): boolean {
    const upperSQL = sql.trim().toUpperCase();

    // Allow SELECT, SHOW, DESCRIBE, EXPLAIN queries
    const readOnlyKeywords = ['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN'];

    return readOnlyKeywords.some((keyword) => upperSQL.startsWith(keyword));
  }

  /**
   * Validate basic SQL structure
   */
  private validateBasicSQLStructure(sql: string): void {
    // Check for minimum length
    if (sql.length < 3) {
      throw new EdgeSQLError('SQL query too short', 'SQL_TOO_SHORT');
    }

    // Check for maximum length
    if (sql.length > 10000) {
      throw new EdgeSQLError('SQL query too long', 'SQL_TOO_LONG');
    }

    // Check for balanced quotes
    this.validateBalancedQuotes(sql);

    // Check for balanced parentheses
    this.validateBalancedParentheses(sql);
  }

  /**
   * Detect suspicious SQL patterns
   */
  private detectSuspiciousPatterns(sql: string): void {
    for (const pattern of this.suspiciousPatterns) {
      if (pattern.test(sql)) {
        this.log('warn', 'Suspicious SQL pattern detected', {
          pattern: pattern.source,
          sql: sql.substring(0, 100) + '...',
        });

        throw new EdgeSQLError(
          'Potentially malicious SQL pattern detected',
          'SQL_SUSPICIOUS_PATTERN'
        );
      }
    }
  }

  /**
   * Detect common SQL injection signatures
   */
  private detectInjectionSignatures(sql: string): void {
    const upperSQL = sql.toUpperCase();

    // Check for multiple statements (semicolon outside of quotes)
    const statements = this.splitStatements(sql);
    if (statements.length > 1) {
      throw new EdgeSQLError('Multiple SQL statements not allowed', 'SQL_MULTIPLE_STATEMENTS');
    }

    // Check for dangerous keyword combinations
    this.dangerousKeywords.forEach((keyword) => {
      if (upperSQL.includes(keyword)) {
        // Allow certain keywords in specific contexts
        if (!this.isKeywordAllowedInContext(keyword)) {
          throw new EdgeSQLError(
            `Dangerous keyword '${keyword}' detected`,
            'SQL_DANGEROUS_KEYWORD'
          );
        }
      }
    });
  }

  /**
   * Validate against whitelist patterns
   */
  private validateWhitelistPatterns(sql: string): void {
    // For production, implement strict whitelist validation
    if (this.env.ENVIRONMENT === 'production') {
      // Only allow specific SQL patterns
      const allowedPatterns = [
        /^SELECT\s+.*\s+FROM\s+\w+(\s+WHERE\s+.*)?(\s+ORDER\s+BY\s+.*)?(\s+LIMIT\s+\d+)?$/i,
        /^INSERT\s+INTO\s+\w+\s*\([^)]+\)\s+VALUES\s*\([^)]+\)$/i,
        /^UPDATE\s+\w+\s+SET\s+.*(\s+WHERE\s+.*)?$/i,
        /^DELETE\s+FROM\s+\w+(\s+WHERE\s+.*)?$/i,
      ];

      const hasValidPattern = allowedPatterns.some((pattern) => pattern.test(sql));

      if (!hasValidPattern) {
        throw new EdgeSQLError(
          'SQL query does not match allowed patterns',
          'SQL_PATTERN_NOT_ALLOWED'
        );
      }
    }
  }

  /**
   * Validate string parameters for injection attempts
   */
  private validateStringParameter(param: string, index: number): void {
    // Check for SQL injection in string parameters
    this.suspiciousPatterns.forEach((pattern) => {
      if (pattern.test(param)) {
        throw new EdgeSQLError(
          `Suspicious pattern in parameter ${index}: ${param}`,
          'SQL_PARAM_INJECTION'
        );
      }
    });

    // Check for excessive length
    if (param.length > 1000) {
      throw new EdgeSQLError(`Parameter ${index} exceeds maximum length`, 'SQL_PARAM_TOO_LONG');
    }
  }

  /**
   * Validate numeric parameters
   */
  private validateNumericParameter(param: number, index: number): void {
    // Check for NaN or Infinity
    if (!isFinite(param)) {
      throw new EdgeSQLError(`Invalid numeric parameter at index ${index}`, 'SQL_INVALID_NUMBER');
    }

    // Check for reasonable range
    if (Math.abs(param) > Number.MAX_SAFE_INTEGER) {
      throw new EdgeSQLError(
        `Numeric parameter ${index} out of safe range`,
        'SQL_NUMBER_OUT_OF_RANGE'
      );
    }
  }

  /**
   * Escape parameter value based on type
   */
  private escapeParameterValue(value: unknown): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }

    if (typeof value === 'string') {
      return `'${this.escapeString(value)}'`;
    }

    if (typeof value === 'number') {
      if (!isFinite(value)) {
        throw new EdgeSQLError('Invalid numeric value', 'SQL_INVALID_NUMBER');
      }
      return value.toString();
    }

    if (typeof value === 'boolean') {
      return value ? '1' : '0';
    }

    if (value instanceof Date) {
      return `'${value.toISOString()}'`;
    }

    throw new EdgeSQLError(
      `Cannot escape parameter of type ${typeof value}`,
      'SQL_UNSUPPORTED_TYPE'
    );
  }

  /**
   * Remove dangerous characters from SQL
   */
  private removeDangerousCharacters(sql: string): string {
    // Remove null bytes and other control characters
    return sql
      .split('')
      .filter((char) => {
        const code = char.charCodeAt(0);
        return code >= 32 && code !== 127; // Keep printable characters only
      })
      .join('');
  }

  /**
   * Validate balanced quotes in SQL
   */
  private validateBalancedQuotes(sql: string): void {
    let inString = false;
    let stringChar = '';

    for (let i = 0; i < sql.length; i++) {
      const char = sql[i];

      if (!inString) {
        if (char === "'") {
          inString = true;
          stringChar = "'";
        } else if (char === '"') {
          inString = true;
          stringChar = '"';
        }
      } else {
        if (char === stringChar) {
          // Check for escaped quote
          if (i + 1 < sql.length && sql[i + 1] === stringChar) {
            i++; // Skip escaped quote
          } else {
            inString = false;
            stringChar = '';
          }
        }
      }
    }

    if (inString) {
      throw new EdgeSQLError('Unbalanced quotes in SQL', 'SQL_UNBALANCED_QUOTES');
    }
  }

  /**
   * Validate balanced parentheses
   */
  private validateBalancedParentheses(sql: string): void {
    let count = 0;

    for (const char of sql) {
      if (char === '(') {
        count++;
      } else if (char === ')') {
        count--;
        if (count < 0) {
          throw new EdgeSQLError('Unbalanced parentheses in SQL', 'SQL_UNBALANCED_PARENS');
        }
      }
    }

    if (count !== 0) {
      throw new EdgeSQLError('Unbalanced parentheses in SQL', 'SQL_UNBALANCED_PARENS');
    }
  }

  /**
   * Split SQL into statements
   */
  private splitStatements(sql: string): string[] {
    const statements: string[] = [];
    let current = '';
    let inString = false;
    let stringChar = '';

    for (let i = 0; i < sql.length; i++) {
      const char = sql[i];

      if (!inString) {
        if (char === "'" || char === '"') {
          inString = true;
          stringChar = char;
        } else if (char === ';') {
          if (current.trim()) {
            statements.push(current.trim());
            current = '';
          }
          continue;
        }
      } else {
        if (char === stringChar) {
          // Check for escaped quote
          if (i + 1 < sql.length && sql[i + 1] === stringChar) {
            current += char;
            i++; // Skip escaped quote
          } else {
            inString = false;
            stringChar = '';
          }
        }
      }

      current += char;
    }

    if (current.trim()) {
      statements.push(current.trim());
    }

    return statements;
  }

  /**
   * Check if keyword is allowed in context
   */
  private isKeywordAllowedInContext(keyword: string): boolean {
    switch (keyword.toUpperCase()) {
      case 'UPDATE':
      case 'DELETE':
      case 'INSERT':
        // Allow in normal DML operations
        return true;
      case 'DROP':
      case 'CREATE':
      case 'ALTER':
        // Only allow DDL in development/staging
        return this.env.ENVIRONMENT !== 'production';
      default:
        return false;
    }
  }
}

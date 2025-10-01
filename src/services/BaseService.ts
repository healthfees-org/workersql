import { Env, AuthContext, EdgeSQLError } from '../types';

/**
 * Base service class providing common functionality for all services
 */
export abstract class BaseService {
  protected env: Env;
  protected authContext?: AuthContext;

  constructor(env: Env, authContext?: AuthContext) {
    this.env = env;
    // With exactOptionalPropertyTypes enabled, avoid explicitly assigning
    // undefined to optional properties; only set when defined.
    if (authContext !== undefined) {
      this.authContext = authContext;
    }
  }

  /**
   * Log a message with appropriate level and context
   */
  protected log(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    meta?: Record<string, unknown>
  ): void {
    const logLevel = this.env.LOG_LEVEL || 'info';
    const shouldLog = this.shouldLog(level, logLevel);

    if (shouldLog) {
      const logEntry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        tenantId: this.authContext?.tenantId,
        ...meta,
      };

      // In production, this would go to a proper logging service
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(logEntry));
    }
  }

  /**
   * Determine if a log message should be output based on log level
   */
  private shouldLog(messageLevel: string, configLevel: string): boolean {
    const levels = ['debug', 'info', 'warn', 'error'];
    const messageIndex = levels.indexOf(messageLevel);
    const configIndex = levels.indexOf(configLevel);
    return messageIndex >= configIndex;
  }

  /**
   * Generate a unique ID for tracking operations
   */
  protected generateId(): string {
    return crypto.randomUUID();
  }

  /**
   * Validate tenant access for the current operation
   */
  protected validateTenantAccess(tenantId: string): void {
    if (!this.authContext) {
      throw new EdgeSQLError('Authentication required', 'AUTH_REQUIRED');
    }

    if (this.authContext.tenantId !== tenantId) {
      throw new EdgeSQLError('Tenant access denied', 'TENANT_ACCESS_DENIED');
    }
  }

  /**
   * Safely parse JSON with error handling
   */
  protected safeJsonParse<T>(jsonString: string, defaultValue: T): T {
    try {
      return JSON.parse(jsonString) as T;
    } catch {
      this.log('warn', 'Failed to parse JSON, using default value', { jsonString });
      return defaultValue;
    }
  }

  /**
   * Create a cache key following our standard patterns
   */
  protected createCacheKey(
    type: 'entity' | 'index' | 'query',
    table: string,
    identifier: string
  ): string {
    const prefix = {
      entity: 't',
      index: 'idx',
      query: 'q',
    }[type];

    return `${prefix}:${table}:${identifier}`;
  }

  /**
   * Hash a string for consistent key generation
   */
  protected async hashString(input: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Measure execution time of an operation
   */
  protected async measureTime<T>(
    operation: () => Promise<T>
  ): Promise<{ result: T; timeMs: number }> {
    const start = Date.now();
    const result = await operation();
    const timeMs = Date.now() - start;
    return { result, timeMs };
  }

  /**
   * Retry an operation with exponential backoff
   */
  protected async retryWithBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelayMs: number = 100
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        if (attempt === maxRetries) {
          break;
        }

        const delayMs = baseDelayMs * Math.pow(2, attempt);
        await this.sleep(delayMs);

        this.log('warn', `Retry attempt ${attempt + 1} after ${delayMs}ms`, {
          error: lastError.message,
        });
      }
    }

    throw lastError!;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

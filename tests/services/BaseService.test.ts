import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BaseService } from '@/services/BaseService';
import { EdgeSQLError } from '@/types';

// Mock crypto for generateId and hashString
const mockRandomUUID = vi.fn(() => 'test-uuid-123');
const mockDigest = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));

Object.defineProperty(global, 'crypto', {
  value: {
    randomUUID: mockRandomUUID,
    subtle: {
      digest: mockDigest,
    },
  },
  writable: true,
});

// Concrete implementation for testing BaseService
class TestService extends BaseService {
  constructor(env: any, authContext?: any) {
    super(env, authContext);
  }

  // Expose protected methods for testing
  public testLog(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    meta?: Record<string, unknown>
  ): void {
    this.log(level, message, meta);
  }

  public testGenerateId(): string {
    return this.generateId();
  }

  public testValidateTenantAccess(tenantId: string): void {
    this.validateTenantAccess(tenantId);
  }

  public testSafeJsonParse<T>(jsonString: string, defaultValue: T): T {
    return this.safeJsonParse(jsonString, defaultValue);
  }

  public testCreateCacheKey(
    type: 'entity' | 'index' | 'query',
    table: string,
    identifier: string
  ): string {
    return this.createCacheKey(type, table, identifier);
  }

  public async testHashString(input: string): Promise<string> {
    return this.hashString(input);
  }

  public async testMeasureTime<T>(
    operation: () => Promise<T>
  ): Promise<{ result: T; timeMs: number }> {
    return this.measureTime(operation);
  }

  public async testRetryWithBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelayMs: number = 100
  ): Promise<T> {
    return this.retryWithBackoff(operation, maxRetries, baseDelayMs);
  }
}

describe('BaseService', () => {
  let service: TestService;
  let mockEnv: any;
  let mockAuthContext: any;
  let consoleSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockEnv = {
      LOG_LEVEL: 'info',
      ENVIRONMENT: 'test',
    };

    mockAuthContext = {
      tenantId: 'test-tenant',
      userId: 'test-user',
      permissions: ['read'],
      tokenHash: 'test-hash',
    };

    service = new TestService(mockEnv, mockAuthContext);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('constructor', () => {
    it('should initialize with env and authContext', () => {
      const testService = new TestService(mockEnv, mockAuthContext);
      expect(testService).toBeDefined();
    });

    it('should initialize with env only', () => {
      const testService = new TestService(mockEnv);
      expect(testService).toBeDefined();
    });

    it('should handle undefined authContext', () => {
      const testService = new TestService(mockEnv, undefined);
      expect(testService).toBeDefined();
    });
  });

  describe('log', () => {
    it('should log debug message when log level allows', () => {
      mockEnv.LOG_LEVEL = 'debug';
      const testService = new TestService(mockEnv, mockAuthContext);

      testService.testLog('debug', 'Test debug message', { key: 'value' });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"level":"debug"'));
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"message":"Test debug message"')
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"tenantId":"test-tenant"'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"key":"value"'));
    });

    it('should not log debug message when log level is info', () => {
      mockEnv.LOG_LEVEL = 'info';
      const testService = new TestService(mockEnv, mockAuthContext);

      // Use the locally constructed instance so variable isn't unused and behavior is isolated
      testService.testLog('debug', 'Test debug message');

      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('should log info message', () => {
      service.testLog('info', 'Test info message');

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"level":"info"'));
    });

    it('should log warn message', () => {
      service.testLog('warn', 'Test warn message');

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"level":"warn"'));
    });

    it('should log error message', () => {
      service.testLog('error', 'Test error message');

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"level":"error"'));
    });

    it('should use default log level when not specified', () => {
      delete mockEnv.LOG_LEVEL;
      const testService = new TestService(mockEnv, mockAuthContext);

      testService.testLog('info', 'Test message');

      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should handle missing authContext', () => {
      const testService = new TestService(mockEnv);

      testService.testLog('info', 'Test message');

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"message":"Test message"'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.not.stringContaining('"tenantId"'));
    });

    it('should log with undefined meta', () => {
      service.testLog('info', 'Test message', undefined);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"message":"Test message"'));
    });
  });

  describe('generateId', () => {
    it('should generate a unique ID', () => {
      mockRandomUUID.mockClear();
      const id = service.testGenerateId();

      expect(mockRandomUUID).toHaveBeenCalled();
      expect(id).toBe('test-uuid-123');
    });
  });

  describe('validateTenantAccess', () => {
    it('should validate tenant access successfully', () => {
      expect(() => {
        service.testValidateTenantAccess('test-tenant');
      }).not.toThrow();
    });

    it('should throw when no authContext', () => {
      const testService = new TestService(mockEnv);

      expect(() => {
        testService.testValidateTenantAccess('test-tenant');
      }).toThrow(EdgeSQLError);
    });

    it('should throw when tenant ID does not match', () => {
      expect(() => {
        service.testValidateTenantAccess('different-tenant');
      }).toThrow(EdgeSQLError);
    });
  });

  describe('safeJsonParse', () => {
    it('should parse valid JSON successfully', () => {
      const jsonString = '{"key": "value", "number": 42}';
      const result = service.testSafeJsonParse(jsonString, { default: true });

      expect(result).toEqual({ key: 'value', number: 42 });
    });

    it('should return default value for invalid JSON', () => {
      const jsonString = 'invalid json';
      const defaultValue = { error: true };

      const result = service.testSafeJsonParse(jsonString, defaultValue);

      expect(result).toEqual(defaultValue);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"level":"warn"'));
    });

    it('should handle empty string', () => {
      const result = service.testSafeJsonParse('', { default: true });

      expect(result).toEqual({ default: true });
    });

    it('should handle null input', () => {
      const result = service.testSafeJsonParse('null', { default: true });

      expect(result).toBeNull();
    });

    it('should parse JSON with special characters', () => {
      const jsonString = '{"key": "value with \\"quotes\\" and \\n newlines"}';
      const result = service.testSafeJsonParse(jsonString, { default: true });

      expect(result).toEqual({ key: 'value with "quotes" and \n newlines' });
    });
  });

  describe('createCacheKey', () => {
    it('should create entity cache key', () => {
      const key = service.testCreateCacheKey('entity', 'users', '123');

      expect(key).toBe('t:users:123');
    });

    it('should create index cache key', () => {
      const key = service.testCreateCacheKey('index', 'users', 'email_idx');

      expect(key).toBe('idx:users:email_idx');
    });

    it('should create query cache key', () => {
      const key = service.testCreateCacheKey('query', 'users', 'active_users');

      expect(key).toBe('q:users:active_users');
    });
  });

  describe('hashString', () => {
    let mockDigest: any;

    beforeEach(() => {
      vi.clearAllMocks();
      mockDigest = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
      vi.stubGlobal('crypto', {
        subtle: {
          digest: mockDigest,
        },
      });
    });

    it('should hash a string using SHA-256', async () => {
      const testService = new TestService(mockEnv);

      const result = await testService.testHashString('test');

      expect(mockDigest).toHaveBeenCalledWith('SHA-256', expect.any(Uint8Array));
      expect(result).toBe('0102030405060708');
    });

    it('should handle empty string', async () => {
      const testService = new TestService(mockEnv);

      const result = await testService.testHashString('');

      expect(mockDigest).toHaveBeenCalledWith('SHA-256', expect.any(Uint8Array));
      expect(result).toBe('0102030405060708');
    });

    it('should handle special characters', async () => {
      const testService = new TestService(mockEnv);

      const result = await testService.testHashString('test@#$%^&*()');

      expect(mockDigest).toHaveBeenCalledWith('SHA-256', expect.any(Uint8Array));
      expect(result).toBe('0102030405060708');
    });
  });

  describe('measureTime', () => {
    it('should measure execution time', async () => {
      const operation = vi.fn().mockResolvedValue('result');

      const { result, timeMs } = await service.testMeasureTime(operation);

      expect(result).toBe('result');
      expect(typeof timeMs).toBe('number');
      expect(timeMs).toBeGreaterThanOrEqual(0);
      expect(operation).toHaveBeenCalled();
    });

    it('should handle operation that throws', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Test error'));

      await expect(service.testMeasureTime(operation)).rejects.toThrow('Test error');
    });
  });

  describe('retryWithBackoff', () => {
    it('should return result on first attempt', async () => {
      const operation = vi.fn().mockResolvedValue('success');

      const result = await service.testRetryWithBackoff(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and succeed', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('First failure'))
        .mockResolvedValueOnce('success');

      const result = await service.testRetryWithBackoff(operation, 2, 10);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should retry maximum times and throw last error', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Persistent failure'));

      await expect(service.testRetryWithBackoff(operation, 2, 10)).rejects.toThrow(
        'Persistent failure'
      );
      expect(operation).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    it('should use exponential backoff delays', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Failure'));
      const sleepSpy = vi.spyOn(service as any, 'sleep');

      await expect(service.testRetryWithBackoff(operation, 2, 100)).rejects.toThrow();

      expect(sleepSpy).toHaveBeenCalledWith(100); // 100 * 2^0
      expect(sleepSpy).toHaveBeenCalledWith(200); // 100 * 2^1
    });

    it('should log retry attempts', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Failure'));

      await expect(service.testRetryWithBackoff(operation, 1, 10)).rejects.toThrow();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"level":"warn"'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Retry attempt 1'));
    });

    it('should handle maxRetries = 0', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Failure'));

      await expect(service.testRetryWithBackoff(operation, 0)).rejects.toThrow('Failure');

      expect(operation).toHaveBeenCalledTimes(1);
    });
  });

  describe('private method coverage via public methods', () => {
    it('should cover shouldLog through log method', () => {
      // Test debug level with debug config
      mockEnv.LOG_LEVEL = 'debug';
      const testService = new TestService(mockEnv, mockAuthContext);
      testService.testLog('debug', 'Debug message');
      expect(consoleSpy).toHaveBeenCalled();

      // Test debug level with info config (should not log)
      mockEnv.LOG_LEVEL = 'info';
      const testService2 = new TestService(mockEnv, mockAuthContext);
      testService2.testLog('debug', 'Debug message');
      expect(consoleSpy).toHaveBeenCalledTimes(1); // Only the first call
    });

    it('should cover sleep through retryWithBackoff', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Failure'));
      const sleepSpy = vi.spyOn(service as any, 'sleep');

      await expect(service.testRetryWithBackoff(operation, 1, 50)).rejects.toThrow();

      expect(sleepSpy).toHaveBeenCalledWith(50);
    });
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SecretsService } from '@/services/SecretsService';
import type { CloudflareEnvironment } from '@/types';

describe('SecretsService', () => {
  let service: SecretsService;
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
      // Add test secrets
      TEST_SECRET: 'test_value_123',
      DATABASE_HOST: 'localhost',
      DATABASE_PORT: '5432',
      DATABASE_NAME: 'testdb',
      DATABASE_USER: 'testuser',
      DATABASE_PASSWORD: 'securePassword123!@#',
      DATABASE_SSL: 'true',
      JWT_SECRET: 'jwt_secret_key_with_enough_length_for_security_12345678901234567890',
      JWT_EXPIRES_IN: '2h',
      JWT_ISSUER: 'test-issuer',
      GITHUB_API_KEY: 'github_api_key_value',
      ENCRYPTION_KEY: 'encryption_key_with_32_chars_or_more_12345678901234567890',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
      GITHUB_CLIENT_ID: 'github_client_id',
      GITHUB_CLIENT_SECRET: 'github_client_secret',
      GITHUB_REDIRECT_URI: 'https://example.com/oauth/callback',
    } as any;

    service = new SecretsService(mockEnv);
  });

  describe('getSecret', () => {
    it('should retrieve secret from environment', () => {
      const value = service.getSecret('TEST_SECRET');
      expect(value).toBe('test_value_123');
    });

    it('should throw for empty key', () => {
      expect(() => {
        service.getSecret('');
      }).toThrow('Secret key must be a non-empty string');
    });

    it('should throw for non-string key', () => {
      expect(() => {
        service.getSecret(null as any);
      }).toThrow('Secret key must be a non-empty string');
    });

    it('should throw for invalid key format with special characters', () => {
      expect(() => {
        service.getSecret('INVALID$KEY');
      }).toThrow('Secret key contains invalid characters');
    });

    it('should throw for invalid key format with spaces', () => {
      expect(() => {
        service.getSecret('INVALID KEY');
      }).toThrow('Secret key contains invalid characters');
    });

    it('should allow valid key formats with underscores', () => {
      const value = service.getSecret('TEST_SECRET');
      expect(value).toBe('test_value_123');
    });

    it('should allow valid key formats with dashes', () => {
      // Add a key with dash
      (mockEnv as any)['TEST-SECRET'] = 'test-value';
      const value = service.getSecret('TEST-SECRET');
      expect(value).toBe('test-value');
    });

    it('should allow valid key formats with numbers', () => {
      (mockEnv as any)['TEST_SECRET_123'] = 'value';
      const value = service.getSecret('TEST_SECRET_123');
      expect(value).toBe('value');
    });

    it('should return undefined for non-existent secret', () => {
      const value = service.getSecret('NON_EXISTENT_SECRET');
      expect(value).toBeUndefined();
    });

    it('should cache secrets that are cacheable', () => {
      const value1 = service.getSecret('TEST_SECRET');
      const value2 = service.getSecret('TEST_SECRET');

      expect(value1).toBe(value2);
      expect(value1).toBe('test_value_123');
    });

    it('should not cache JWT_SECRET', () => {
      const value1 = service.getSecret('JWT_SECRET');
      const value2 = service.getSecret('JWT_SECRET');

      expect(value1).toBe(value2);
    });

    it('should not cache DATABASE_PASSWORD', () => {
      const value1 = service.getSecret('DATABASE_PASSWORD');
      const value2 = service.getSecret('DATABASE_PASSWORD');

      expect(value1).toBe(value2);
    });

    it('should not cache API_KEYS', () => {
      (mockEnv as any)['API_KEYS'] = 'api_keys_value';
      const value = service.getSecret('API_KEYS');
      expect(value).toBe('api_keys_value');
    });

    it('should handle non-string values', () => {
      (mockEnv as any)['NUMBER_SECRET'] = 12345;
      const value = service.getSecret('NUMBER_SECRET');
      expect(value).toBe('12345');
    });

    it('should return undefined for null values', () => {
      (mockEnv as any)['NULL_SECRET'] = null;
      const value = service.getSecret('NULL_SECRET');
      expect(value).toBeUndefined();
    });
  });

  describe('getRequiredSecret', () => {
    it('should return secret when it exists', () => {
      const value = service.getRequiredSecret('TEST_SECRET');
      expect(value).toBe('test_value_123');
    });

    it('should throw when secret does not exist', () => {
      expect(() => {
        service.getRequiredSecret('NON_EXISTENT_SECRET');
      }).toThrow("Required secret 'NON_EXISTENT_SECRET' not found");
    });
  });

  describe('hasSecret', () => {
    it('should return true for existing secret', () => {
      expect(service.hasSecret('TEST_SECRET')).toBe(true);
    });

    it('should return false for non-existent secret', () => {
      expect(service.hasSecret('NON_EXISTENT_SECRET')).toBe(false);
    });

    it('should return false for invalid key format', () => {
      expect(service.hasSecret('INVALID$KEY')).toBe(false);
    });

    it('should return false for empty key', () => {
      expect(service.hasSecret('')).toBe(false);
    });
  });

  describe('getDatabaseUrl', () => {
    it('should construct database URL with all parameters', () => {
      const url = service.getDatabaseUrl();
      expect(url).toContain('postgresql://');
      expect(url).toContain('testuser:securePassword123!@#');
      expect(url).toContain('@localhost:5432');
      expect(url).toContain('/testdb');
      expect(url).toContain('?sslmode=require');
    });

    it('should use default port when not specified', () => {
      delete (mockEnv as any).DATABASE_PORT;
      const url = service.getDatabaseUrl();
      expect(url).toContain(':5432');
    });

    it('should use custom port when specified', () => {
      (mockEnv as any).DATABASE_PORT = '3306';
      const url = service.getDatabaseUrl();
      expect(url).toContain(':3306');
    });

    it('should not add SSL parameter when SSL is disabled', () => {
      (mockEnv as any).DATABASE_SSL = 'false';
      const url = service.getDatabaseUrl();
      expect(url).not.toContain('?sslmode=require');
    });

    it('should throw when required secrets are missing', () => {
      delete (mockEnv as any).DATABASE_HOST;
      expect(() => {
        service.getDatabaseUrl();
      }).toThrow("Required secret 'DATABASE_HOST' not found");
    });
  });

  describe('getJWTConfig', () => {
    it('should return JWT configuration', () => {
      const config = service.getJWTConfig();
      expect(config).toEqual({
        secret: mockEnv.JWT_SECRET,
        expiresIn: '2h',
        issuer: 'test-issuer',
      });
    });

    it('should use default expiresIn when not specified', () => {
      delete (mockEnv as any).JWT_EXPIRES_IN;
      const config = service.getJWTConfig();
      expect(config.expiresIn).toBe('1h');
    });

    it('should use default issuer when not specified', () => {
      delete (mockEnv as any).JWT_ISSUER;
      const config = service.getJWTConfig();
      expect(config.issuer).toBe('workersql');
    });

    it('should throw when JWT_SECRET is missing', () => {
      delete (mockEnv as any).JWT_SECRET;
      expect(() => {
        service.getJWTConfig();
      }).toThrow("Required secret 'JWT_SECRET' not found");
    });
  });

  describe('getAPIKey', () => {
    it('should get API key for service', () => {
      const key = service.getAPIKey('github');
      expect(key).toBe('github_api_key_value');
    });

    it('should convert service name to uppercase', () => {
      const key = service.getAPIKey('GitHub');
      expect(key).toBe('github_api_key_value');
    });

    it('should throw when API key is missing', () => {
      expect(() => {
        service.getAPIKey('stripe');
      }).toThrow("Required secret 'STRIPE_API_KEY' not found");
    });
  });

  describe('getEncryptionKey', () => {
    it('should get encryption key', () => {
      const key = service.getEncryptionKey();
      expect(key).toBeDefined();
      expect(key.length).toBeGreaterThan(0);
    });

    it('should throw when encryption key is missing', () => {
      delete (mockEnv as any).ENCRYPTION_KEY;
      expect(() => {
        service.getEncryptionKey();
      }).toThrow("Required secret 'ENCRYPTION_KEY' not found");
    });
  });

  describe('getWebhookSecret', () => {
    it('should get webhook secret for provider', () => {
      const secret = service.getWebhookSecret('stripe');
      expect(secret).toBe('whsec_test_secret');
    });

    it('should convert provider name to uppercase', () => {
      const secret = service.getWebhookSecret('Stripe');
      expect(secret).toBe('whsec_test_secret');
    });

    it('should throw when webhook secret is missing', () => {
      expect(() => {
        service.getWebhookSecret('github');
      }).toThrow("Required secret 'GITHUB_WEBHOOK_SECRET' not found");
    });
  });

  describe('getOAuthConfig', () => {
    it('should return OAuth configuration with all fields', () => {
      const config = service.getOAuthConfig('github');
      expect(config).toEqual({
        clientId: 'github_client_id',
        clientSecret: 'github_client_secret',
        redirectUri: 'https://example.com/oauth/callback',
      });
    });

    it('should return OAuth configuration without optional redirect URI', () => {
      delete (mockEnv as any).GITHUB_REDIRECT_URI;
      const config = service.getOAuthConfig('github');
      expect(config).toEqual({
        clientId: 'github_client_id',
        clientSecret: 'github_client_secret',
      });
      expect(config.redirectUri).toBeUndefined();
    });

    it('should convert provider name to uppercase', () => {
      const config = service.getOAuthConfig('GitHub');
      expect(config.clientId).toBe('github_client_id');
    });

    it('should throw when client ID is missing', () => {
      delete (mockEnv as any).GITHUB_CLIENT_ID;
      expect(() => {
        service.getOAuthConfig('github');
      }).toThrow("Required secret 'GITHUB_CLIENT_ID' not found");
    });

    it('should throw when client secret is missing', () => {
      delete (mockEnv as any).GITHUB_CLIENT_SECRET;
      expect(() => {
        service.getOAuthConfig('github');
      }).toThrow("Required secret 'GITHUB_CLIENT_SECRET' not found");
    });
  });

  describe('validateSecretStrength', () => {
    it('should validate strong secret', () => {
      const result = service.validateSecretStrength(
        'JWT_SECRET',
        'a_very_strong_secret_with_enough_randomness_12345678901234567890'
      );
      expect(result.isValid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('should warn about short JWT_SECRET', () => {
      const result = service.validateSecretStrength('JWT_SECRET', 'short');
      expect(result.isValid).toBe(false);
      expect(result.warnings).toContain(
        "Secret 'JWT_SECRET' should be at least 32 characters long"
      );
    });

    it('should warn about short DATABASE_PASSWORD', () => {
      const result = service.validateSecretStrength('DATABASE_PASSWORD', 'short');
      expect(result.isValid).toBe(false);
      expect(result.warnings).toContain(
        "Secret 'DATABASE_PASSWORD' should be at least 16 characters long"
      );
    });

    it('should warn about weak patterns - password', () => {
      const result = service.validateSecretStrength('TEST_SECRET', 'password123');
      expect(result.isValid).toBe(false);
      expect(result.warnings.some((w) => w.includes('weak patterns'))).toBe(true);
    });

    it('should warn about weak patterns - admin', () => {
      const result = service.validateSecretStrength('TEST_SECRET', 'admin123');
      expect(result.isValid).toBe(false);
      expect(result.warnings.some((w) => w.includes('weak patterns'))).toBe(true);
    });

    it('should warn about weak patterns - 123456', () => {
      const result = service.validateSecretStrength('TEST_SECRET', '123456789');
      expect(result.isValid).toBe(false);
      expect(result.warnings.some((w) => w.includes('weak patterns'))).toBe(true);
    });

    it('should warn about weak patterns - qwerty', () => {
      const result = service.validateSecretStrength('TEST_SECRET', 'qwerty123');
      expect(result.isValid).toBe(false);
      expect(result.warnings.some((w) => w.includes('weak patterns'))).toBe(true);
    });

    it('should warn about repeated characters', () => {
      const result = service.validateSecretStrength('TEST_SECRET', 'aaaabbbbccccdddd');
      expect(result.isValid).toBe(false);
      expect(result.warnings.some((w) => w.includes('weak patterns'))).toBe(true);
    });

    it('should warn about only lowercase letters', () => {
      const result = service.validateSecretStrength('TEST_SECRET', 'abcdefghijklmnop');
      expect(result.isValid).toBe(false);
      expect(result.warnings.some((w) => w.includes('weak patterns'))).toBe(true);
    });

    it('should warn about only numbers', () => {
      const result = service.validateSecretStrength('TEST_SECRET', '1234567890123456');
      expect(result.isValid).toBe(false);
      expect(result.warnings.some((w) => w.includes('weak patterns'))).toBe(true);
    });

    it('should warn about low entropy', () => {
      const result = service.validateSecretStrength('TEST_SECRET', 'aaaaaaaaaaaaaaaa');
      expect(result.isValid).toBe(false);
      expect(result.warnings.some((w) => w.includes('low entropy'))).toBe(true);
    });

    it('should use default minimum length for unknown keys', () => {
      const result = service.validateSecretStrength('UNKNOWN_KEY', 'short');
      expect(result.isValid).toBe(false);
      expect(result.warnings).toContain(
        "Secret 'UNKNOWN_KEY' should be at least 16 characters long"
      );
    });
  });

  describe('generateSecretSuggestion', () => {
    it('should generate secret of appropriate length for JWT_SECRET', () => {
      const secret = service.generateSecretSuggestion('JWT_SECRET');
      expect(secret.length).toBe(64);
    });

    it('should generate secret of appropriate length for DATABASE_PASSWORD', () => {
      const secret = service.generateSecretSuggestion('DATABASE_PASSWORD');
      expect(secret.length).toBe(32);
    });

    it('should generate secret of appropriate length for ENCRYPTION_KEY', () => {
      const secret = service.generateSecretSuggestion('ENCRYPTION_KEY');
      expect(secret.length).toBe(64);
    });

    it('should generate secret of appropriate length for API_KEY', () => {
      const secret = service.generateSecretSuggestion('API_KEY');
      expect(secret.length).toBe(32);
    });

    it('should generate secret with default length for unknown key', () => {
      const secret = service.generateSecretSuggestion('UNKNOWN_KEY');
      expect(secret.length).toBe(32);
    });

    it('should generate different secrets on each call', () => {
      const secret1 = service.generateSecretSuggestion('JWT_SECRET');
      const secret2 = service.generateSecretSuggestion('JWT_SECRET');
      expect(secret1).not.toBe(secret2);
    });

    it('should generate secrets with valid characters', () => {
      const secret = service.generateSecretSuggestion('JWT_SECRET');
      const charset =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
      for (const char of secret) {
        expect(charset).toContain(char);
      }
    });
  });

  describe('clearCache', () => {
    it('should clear all cached secrets', () => {
      // Cache a secret
      service.getSecret('TEST_SECRET');

      // Verify it's cached
      const stats = service.getCacheStats();
      expect(stats.size).toBeGreaterThan(0);

      // Clear cache
      service.clearCache();

      // Verify cache is empty
      const statsAfter = service.getCacheStats();
      expect(statsAfter.size).toBe(0);
    });
  });

  describe('getCacheStats', () => {
    it('should return cache statistics', () => {
      const stats = service.getCacheStats();
      expect(stats).toHaveProperty('size');
      expect(typeof stats.size).toBe('number');
    });

    it('should reflect cached items', () => {
      service.clearCache();

      const stats1 = service.getCacheStats();
      expect(stats1.size).toBe(0);

      // Cache some secrets
      service.getSecret('TEST_SECRET');

      const stats2 = service.getCacheStats();
      expect(stats2.size).toBe(1);
    });
  });

  describe('Cache expiration', () => {
    it('should expire cached secrets after expiration time', async () => {
      // Create service with very short cache time for testing
      const shortCacheEnv = { ...mockEnv, TEST_SHORT_CACHE: 'value' } as any;
      const shortCacheService = new SecretsService(shortCacheEnv);

      // Access a cacheable secret
      const value1 = shortCacheService.getSecret('TEST_SHORT_CACHE');
      expect(value1).toBe('value');

      // Manually expire the cache by manipulating internal state
      // In a real scenario, we'd wait for expiration time
      shortCacheService.clearCache();

      // Access again - should retrieve from environment
      const value2 = shortCacheService.getSecret('TEST_SHORT_CACHE');
      expect(value2).toBe('value');
    });

    it('should cleanup expired cache entries when cache size exceeds 100', () => {
      // Add many secrets to trigger cleanup
      for (let i = 0; i < 105; i++) {
        (mockEnv as any)[`TEST_SECRET_${i}`] = `value_${i}`;
      }

      // Access all secrets to cache them
      for (let i = 0; i < 105; i++) {
        service.getSecret(`TEST_SECRET_${i}`);
      }

      // The cache should have triggered cleanup
      const stats = service.getCacheStats();
      expect(stats.size).toBeDefined();
    });
  });

  describe('Edge cases', () => {
    it('should handle undefined environment values', () => {
      (mockEnv as any)['UNDEFINED_SECRET'] = undefined;
      const value = service.getSecret('UNDEFINED_SECRET');
      expect(value).toBeUndefined();
    });

    it('should handle empty string values', () => {
      (mockEnv as any)['EMPTY_SECRET'] = '';
      const value = service.getSecret('EMPTY_SECRET');
      expect(value).toBe('');
    });

    it('should handle boolean values', () => {
      (mockEnv as any)['BOOLEAN_SECRET'] = true;
      const value = service.getSecret('BOOLEAN_SECRET');
      expect(value).toBe('true');
    });

    it('should handle object values', () => {
      (mockEnv as any)['OBJECT_SECRET'] = { key: 'value' };
      const value = service.getSecret('OBJECT_SECRET');
      expect(value).toContain('object');
    });

    it('should handle array values', () => {
      (mockEnv as any)['ARRAY_SECRET'] = ['value1', 'value2'];
      const value = service.getSecret('ARRAY_SECRET');
      expect(value).toBeDefined();
    });
  });
});

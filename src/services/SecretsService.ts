import { EdgeSQLError } from '../types';
import { BaseService } from './BaseService';
import type { CloudflareEnvironment } from '../types';

/**
 * Secrets management via Cloudflare Worker bindings
 * Provides secure access to environment variables and Worker secrets
 */
export class SecretsService extends BaseService {
  // Cache for frequently accessed secrets to reduce binding calls
  private secretsCache = new Map<string, { value: string; expires: number }>();
  private readonly cacheExpirationTime = 5 * 60 * 1000; // 5 minutes

  // List of secret keys that should never be cached
  private readonly noCacheSecrets = ['JWT_SECRET', 'DATABASE_PASSWORD', 'API_KEYS'];

  constructor(env: CloudflareEnvironment) {
    super(env);
  }

  /**
   * Get secret value from Worker bindings
   */
  getSecret(key: string): string | undefined {
    if (!key || typeof key !== 'string') {
      throw new EdgeSQLError('Secret key must be a non-empty string', 'SECRETS_INVALID_KEY');
    }

    // Validate key format (alphanumeric, underscore, dash only)
    if (!/^[A-Z0-9_-]+$/i.test(key)) {
      throw new EdgeSQLError(
        'Secret key contains invalid characters',
        'SECRETS_INVALID_KEY_FORMAT'
      );
    }

    // Check cache first (if caching is allowed for this secret)
    if (!this.noCacheSecrets.includes(key)) {
      const cached = this.getCachedSecret(key);
      if (cached !== null) {
        return cached;
      }
    }

    // Get from environment bindings
    const value = this.getFromEnvironment(key);

    if (value !== undefined) {
      // Cache the secret if allowed
      if (!this.noCacheSecrets.includes(key)) {
        this.cacheSecret(key, value);
      }

      this.log('debug', 'Secret retrieved', { key, cached: false });
      return value;
    }

    this.log('warn', 'Secret not found', { key });
    return undefined;
  }

  /**
   * Get required secret (throws if not found)
   */
  getRequiredSecret(key: string): string {
    const value = this.getSecret(key);

    if (value === undefined) {
      throw new EdgeSQLError(`Required secret '${key}' not found`, 'SECRETS_REQUIRED_NOT_FOUND');
    }

    return value;
  }

  /**
   * Check if secret exists
   */
  hasSecret(key: string): boolean {
    try {
      return this.getSecret(key) !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * Get database connection string with proper secret handling
   */
  getDatabaseUrl(): string {
    const dbHost = this.getRequiredSecret('DATABASE_HOST');
    const dbPort = this.getSecret('DATABASE_PORT') || '5432';
    const dbName = this.getRequiredSecret('DATABASE_NAME');
    const dbUser = this.getRequiredSecret('DATABASE_USER');
    const dbPassword = this.getRequiredSecret('DATABASE_PASSWORD');
    const dbSsl = this.getSecret('DATABASE_SSL') || 'true';

    // Construct connection URL
    const sslParam = dbSsl === 'true' ? '?sslmode=require' : '';
    return `postgresql://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${dbName}${sslParam}`;
  }

  /**
   * Get JWT configuration
   */
  getJWTConfig(): { secret: string; expiresIn: string; issuer: string } {
    return {
      secret: this.getRequiredSecret('JWT_SECRET'),
      expiresIn: this.getSecret('JWT_EXPIRES_IN') || '1h',
      issuer: this.getSecret('JWT_ISSUER') || 'workersql',
    };
  }

  /**
   * Get API key for external service
   */
  getAPIKey(service: string): string {
    const keyName = `${service.toUpperCase()}_API_KEY`;
    return this.getRequiredSecret(keyName);
  }

  /**
   * Get encryption key for data at rest
   */
  getEncryptionKey(): string {
    return this.getRequiredSecret('ENCRYPTION_KEY');
  }

  /**
   * Get webhook secret for signature verification
   */
  getWebhookSecret(provider: string): string {
    const secretName = `${provider.toUpperCase()}_WEBHOOK_SECRET`;
    return this.getRequiredSecret(secretName);
  }

  /**
   * Get OAuth configuration
   */
  getOAuthConfig(provider: string): {
    clientId: string;
    clientSecret: string;
    redirectUri?: string;
  } {
    const providerUpper = provider.toUpperCase();
    const redirectUri = this.getSecret(`${providerUpper}_REDIRECT_URI`);

    return {
      clientId: this.getRequiredSecret(`${providerUpper}_CLIENT_ID`),
      clientSecret: this.getRequiredSecret(`${providerUpper}_CLIENT_SECRET`),
      ...(redirectUri && { redirectUri }),
    };
  }

  /**
   * Validate secret format and strength
   */
  validateSecretStrength(key: string, value: string): { isValid: boolean; warnings: string[] } {
    const warnings: string[] = [];

    // Check minimum length requirements
    const minLengths: Record<string, number> = {
      JWT_SECRET: 32,
      DATABASE_PASSWORD: 16,
      ENCRYPTION_KEY: 32,
      API_KEY: 24,
    };

    const requiredLength = minLengths[key] || 16;
    if (value.length < requiredLength) {
      warnings.push(`Secret '${key}' should be at least ${requiredLength} characters long`);
    }

    // Check for common weak patterns
    if (this.isWeakSecret(value)) {
      warnings.push(`Secret '${key}' appears to use weak patterns`);
    }

    // Check for proper entropy
    if (this.hasLowEntropy(value)) {
      warnings.push(`Secret '${key}' has low entropy and may be predictable`);
    }

    return {
      isValid: warnings.length === 0,
      warnings,
    };
  }

  /**
   * Rotate secret (for development/testing purposes)
   */
  generateSecretSuggestion(key: string): string {
    const lengths: Record<string, number> = {
      JWT_SECRET: 64,
      DATABASE_PASSWORD: 32,
      ENCRYPTION_KEY: 64,
      API_KEY: 32,
    };

    const length = lengths[key] || 32;
    return this.generateRandomString(length);
  }

  /**
   * Clear secrets cache
   */
  clearCache(): void {
    this.secretsCache.clear();
    this.log('debug', 'Secrets cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; hitRate?: number } {
    return {
      size: this.secretsCache.size,
    };
  }

  /**
   * Get secret from environment with type checking
   */
  private getFromEnvironment(key: string): string | undefined {
    // Access environment variable through Cloudflare bindings
    const value = (this.env as any)[key];

    if (value === undefined || value === null) {
      return undefined;
    }

    if (typeof value !== 'string') {
      this.log('warn', 'Secret value is not a string', { key, type: typeof value });
      return String(value);
    }

    return value;
  }

  /**
   * Cache secret value
   */
  private cacheSecret(key: string, value: string): void {
    const expires = Date.now() + this.cacheExpirationTime;
    this.secretsCache.set(key, { value, expires });

    // Cleanup expired entries periodically
    if (this.secretsCache.size > 100) {
      this.cleanupExpiredCache();
    }
  }

  /**
   * Get cached secret value
   */
  private getCachedSecret(key: string): string | null {
    const cached = this.secretsCache.get(key);

    if (!cached) {
      return null;
    }

    if (Date.now() > cached.expires) {
      this.secretsCache.delete(key);
      return null;
    }

    this.log('debug', 'Secret retrieved from cache', { key });
    return cached.value;
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupExpiredCache(): void {
    const now = Date.now();
    const expired: string[] = [];

    for (const [key, cached] of this.secretsCache.entries()) {
      if (now > cached.expires) {
        expired.push(key);
      }
    }

    expired.forEach((key) => this.secretsCache.delete(key));

    if (expired.length > 0) {
      this.log('debug', 'Cleaned up expired secrets from cache', { count: expired.length });
    }
  }

  /**
   * Check if secret uses weak patterns
   */
  private isWeakSecret(value: string): boolean {
    const weakPatterns = [
      /^password\d*$/i,
      /^admin\d*$/i,
      /^secret\d*$/i,
      /^123456/,
      /^qwerty/i,
      /^letmein/i,
      /^welcome/i,
      /^monkey/i,
      /^dragon/i,
      /(.)\1{3,}/, // Repeated characters
      /^[a-z]+$/, // Only lowercase letters
      /^\d+$/, // Only numbers
    ];

    return weakPatterns.some((pattern) => pattern.test(value));
  }

  /**
   * Check if secret has low entropy
   */
  private hasLowEntropy(value: string): boolean {
    // Simple entropy calculation
    const charCounts = new Map<string, number>();

    for (const char of value) {
      charCounts.set(char, (charCounts.get(char) || 0) + 1);
    }

    // Calculate Shannon entropy
    let entropy = 0;
    const length = value.length;

    for (const count of charCounts.values()) {
      const probability = count / length;
      entropy -= probability * Math.log2(probability);
    }

    // Consider entropy < 3.0 as low for secrets
    return entropy < 3.0;
  }

  /**
   * Generate cryptographically secure random string
   */
  private generateRandomString(length: number): string {
    const charset =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
    const randomValues = new Uint8Array(length);
    crypto.getRandomValues(randomValues);

    let result = '';
    for (let i = 0; i < length; i++) {
      const randomIndex = randomValues[i];
      if (randomIndex !== undefined) {
        result += charset[randomIndex % charset.length];
      }
    }

    return result;
  }
}

import { CacheEntry, CacheError, CloudflareEnvironment } from '../types';

/**
 * CacheService - KV-based cache layer for global read performance
 *
 * Critical role in EdgeSQL architecture:
 * 1. Provides sub-100ms global reads via Workers KV
 * 2. Implements TTL/SWR pattern for freshness control
 * 3. Handles cache key patterns: entity, index, query
 * 4. Supports event-driven invalidation from Queue system
 * 5. Never authoritative - KV is cache only, DO is source of truth
 */
export class CacheService {
  private kv: KVNamespace;
  private defaultTTLMs: number = 60000; // 1 minute
  private defaultSWRMs: number = 300000; // 5 minutes

  constructor(env: CloudflareEnvironment) {
    this.kv = env.APP_CACHE;

    if (!this.kv) {
      throw new CacheError('KV namespace not available', 'KV_UNAVAILABLE');
    }
  }

  /**
   * Get cache entry with metadata
   * Returns null for miss, expired, or invalid entries
   */
  async get<T = unknown>(key: string): Promise<CacheEntry<T> | null> {
    try {
      const value = await this.kv.get(key, 'json');

      if (!value) {
        return null; // Cache miss
      }

      const entry = value as CacheEntry<T>;

      // Validate entry structure
      if (!this.isValidCacheEntry(entry)) {
        await this.delete(key); // Clean up invalid entry
        return null;
      }

      // Check if entry is expired (beyond SWR window)
      if (this.isExpired(entry)) {
        await this.delete(key); // Clean up expired entry
        return null;
      }

      return entry;
    } catch (error) {
      console.error('Cache get operation failed:', error);
      return null; // Fail gracefully - cache is not authoritative
    }
  }

  /**
   * Set cache entry with TTL/SWR windows
   */
  async set<T = unknown>(
    key: string,
    data: T,
    options?: {
      ttlMs?: number;
      swrMs?: number;
      version?: number;
      shardId?: string;
    }
  ): Promise<void> {
    try {
      const now = Date.now();
      const ttlMs = options?.ttlMs ?? this.defaultTTLMs;
      const swrMs = options?.swrMs ?? this.defaultSWRMs;

      const entry: CacheEntry<T> = {
        data,
        version: options?.version ?? now,
        freshUntil: now + ttlMs,
        swrUntil: now + swrMs,
        shardId: options?.shardId ?? 'unknown',
      };

      // KV expiration should be longer than SWR window
      const kvExpirationTtl = Math.ceil((swrMs + 60000) / 1000); // +1min buffer, in seconds

      await this.kv.put(key, JSON.stringify(entry), {
        expirationTtl: kvExpirationTtl,
      });
    } catch (error) {
      console.error('Cache set operation failed:', error);
      // Don't throw - cache failures shouldn't break the app
    }
  }

  /**
   * Delete cache entry
   */
  async delete(key: string): Promise<void> {
    try {
      await this.kv.delete(key);
    } catch (error) {
      console.error('Cache delete operation failed:', error);
      // Don't throw - cache failures shouldn't break the app
    }
  }

  /**
   * Delete multiple keys matching pattern
   * Note: KV doesn't support pattern deletion natively
   * This is a placeholder for proper pattern-based invalidation
   */
  async deleteByPattern(pattern: string): Promise<void> {
    console.warn('Pattern-based deletion not implemented in KV:', pattern);

    // In production, this would be implemented via:
    // 1. Key registry in separate KV namespace
    // 2. Queue-based invalidation with explicit key lists
    // 3. Cache versioning strategy
    // 4. Tag-based invalidation system
  }

  /**
   * Check if cache entry is fresh (within TTL)
   */
  isFresh<T>(entry: CacheEntry<T>): boolean {
    return Date.now() < entry.freshUntil;
  }

  /**
   * Check if cache entry is stale but within SWR window
   */
  isStaleButRevalidatable<T>(entry: CacheEntry<T>): boolean {
    const now = Date.now();
    return now >= entry.freshUntil && now < entry.swrUntil;
  }

  /**
   * Check if cache entry is expired (beyond SWR)
   */
  isExpired<T>(entry: CacheEntry<T>): boolean {
    return Date.now() >= entry.swrUntil;
  }

  /**
   * Create cache key for entity access: t:<table>:id:<pk>
   */
  createEntityKey(table: string, id: string | number): string {
    return `t:${table}:id:${id}`;
  }

  /**
   * Create cache key for index access: idx:<table>:<col>:<val>
   */
  createIndexKey(table: string, column: string, value: string | number): string {
    return `idx:${table}:${column}:${value}`;
  }

  /**
   * Create cache key for query materialization: q:<table>:<hash>
   */
  async createQueryKey(table: string, sql: string, params: unknown[]): Promise<string> {
    const queryString = `${sql}:${JSON.stringify(params)}`;
    const hash = await this.hashString(queryString);
    return `q:${table}:${hash}`;
  }

  /**
   * Validate cache entry structure
   */
  private isValidCacheEntry<T>(entry: unknown): entry is CacheEntry<T> {
    if (!entry || typeof entry !== 'object') {
      return false;
    }

    const e = entry as any;
    return (
      typeof e.version === 'number' &&
      typeof e.freshUntil === 'number' &&
      typeof e.swrUntil === 'number' &&
      typeof e.shardId === 'string' &&
      e.data !== undefined
    );
  }

  /**
   * Simple string hashing for cache keys
   */
  private async hashString(input: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .substring(0, 16);
  }

  /**
   * Get cache statistics for monitoring
   */
  async getStats(): Promise<{
    namespace: string;
    estimatedKeys: number;
    lastAccess: number;
  }> {
    // KV doesn't provide native stats
    // In production, implement via separate metrics collection
    return {
      namespace: 'APP_CACHE',
      estimatedKeys: 0, // Would track separately
      lastAccess: Date.now(),
    };
  }
}

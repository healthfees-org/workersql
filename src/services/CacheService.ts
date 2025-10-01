import { CacheEntry, CacheError, CloudflareEnvironment } from '../types';

export class CacheService {
  private kv: KVNamespace;
  private defaultTTLMs = 60000;
  private defaultSWRMs = 300000;

  constructor(env: CloudflareEnvironment) {
    this.kv = env.APP_CACHE;
    if (!this.kv) {
      throw new CacheError('KV namespace not available', 'KV_UNAVAILABLE');
    }
  }

  async get<T = unknown>(key: string): Promise<CacheEntry<T> | null> {
    try {
      // Read from KV as JSON to satisfy tests; still handle string fallback
      const raw = (await (
        this.kv.get as unknown as (
          k: string,
          type?: 'text' | 'json' | 'arrayBuffer' | 'stream'
        ) => Promise<unknown>
      )(key, 'json')) as unknown;
      if (!raw) {
        return null;
      }

      let parsed: unknown;
      if (typeof raw === 'string') {
        try {
          parsed = JSON.parse(raw);
        } catch {
          await this.delete(key);
          return null;
        }
      } else if (typeof raw === 'object' && raw !== null) {
        parsed = raw;
      } else {
        return null;
      }

      const entry = parsed as CacheEntry<T>;
      if (!this.isValidCacheEntry(entry)) {
        await this.delete(key);
        return null;
      }
      if (this.isExpired(entry)) {
        await this.delete(key);
        return null;
      }
      return entry;
    } catch {
      return null;
    }
  }

  async set<T = unknown>(
    key: string,
    data: T,
    versionOrOptions?:
      | number
      | { ttlMs?: number; swrMs?: number; version?: number; shardId?: string },
    shardId?: string,
    ttlMs?: number,
    swrMs?: number
  ): Promise<void> {
    try {
      const now = Date.now();
      let version: number | undefined;
      let ttl = this.defaultTTLMs;
      let swr = this.defaultSWRMs;
      let shard = 'unknown';

      if (typeof versionOrOptions === 'number') {
        version = versionOrOptions;
        if (typeof shardId === 'string') {
          shard = shardId;
        }
        if (typeof ttlMs === 'number') {
          ttl = ttlMs;
        }
        if (typeof swrMs === 'number') {
          swr = swrMs;
        }
      } else if (typeof versionOrOptions === 'object' && versionOrOptions !== null) {
        version = versionOrOptions.version;
        if (typeof versionOrOptions.shardId === 'string') {
          shard = versionOrOptions.shardId;
        }
        if (typeof versionOrOptions.ttlMs === 'number') {
          ttl = versionOrOptions.ttlMs;
        }
        if (typeof versionOrOptions.swrMs === 'number') {
          swr = versionOrOptions.swrMs;
        }
      }

      const entry: CacheEntry<T> = {
        data,
        version: version ?? now,
        freshUntil: now + ttl,
        swrUntil: now + swr,
        shardId: shard,
      };

      const kvExpirationTtl = Math.ceil((swr + 60000) / 1000);
      await this.kv.put(key, JSON.stringify(entry), { expirationTtl: kvExpirationTtl });
    } catch {
      // ignore cache set errors
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.kv.delete(key);
    } catch {
      // ignore cache delete errors
    }
  }

  async deleteByPattern(pattern: string): Promise<void> {
    try {
      // Support simple prefix pattern with optional trailing '*'
      const star = pattern.indexOf('*');
      const prefix = star >= 0 ? pattern.slice(0, star) : pattern;
      const list = await (
        this.kv.list as unknown as (opts?: { prefix?: string }) => Promise<{
          keys: { name: string }[];
        }>
      )({ prefix });
      const names = list.keys.map((k) => k.name).filter((n) => n.startsWith(prefix));
      await this.deleteMany(names);
    } catch {
      // ignore
    }
  }

  async deleteMany(keys: string[]): Promise<void> {
    await Promise.all(keys.map((k) => this.delete(k)));
  }

  async warmCache<T = unknown>(
    entries: Array<{
      key: string;
      data: T;
      version?: number;
      shardId?: string;
      ttlMs?: number;
      swrMs?: number;
    }>
  ): Promise<void> {
    await Promise.all(
      entries.map(async (e) => {
        const opts: { ttlMs?: number; swrMs?: number; version?: number; shardId?: string } = {};
        if (typeof e.version === 'number') {
          opts.version = e.version;
        }
        if (typeof e.shardId === 'string') {
          opts.shardId = e.shardId;
        }
        if (typeof e.ttlMs === 'number') {
          opts.ttlMs = e.ttlMs;
        }
        if (typeof e.swrMs === 'number') {
          opts.swrMs = e.swrMs;
        }
        await this.set(e.key, e.data, opts);
      })
    );
  }

  isFresh<T>(entry: CacheEntry<T>): boolean {
    return Date.now() < entry.freshUntil;
  }

  isStaleButRevalidatable<T>(entry: CacheEntry<T>): boolean {
    const now = Date.now();
    return now >= entry.freshUntil && now < entry.swrUntil;
  }

  isExpired<T>(entry: CacheEntry<T>): boolean {
    return Date.now() >= entry.swrUntil;
  }

  createEntityKey(table: string, id: string | number): string {
    return `t:${table}:id:${id}`;
  }

  createIndexKey(table: string, column: string, value: string | number): string {
    return `idx:${table}:${column}:${value}`;
  }

  async createQueryKey(table: string, sql: string, params: unknown[]): Promise<string> {
    const queryString = `${sql}:${JSON.stringify(params)}`;
    const hash = await this.hashString(queryString);
    return `q:${table}:${hash}`;
  }

  async createNamespacedQueryKey(
    tenantId: string,
    table: string,
    sql: string,
    params: unknown[]
  ): Promise<string> {
    const q = await this.createQueryKey(table, sql, params);
    return `${tenantId}:${q}`;
  }

  async getMaterialized<T = unknown>(
    tenantId: string,
    table: string,
    sql: string,
    params: unknown[]
  ): Promise<CacheEntry<T> | null> {
    const key = await this.createNamespacedQueryKey(tenantId, table, sql, params);
    return this.get<T>(key);
  }

  async setMaterialized<T = unknown>(
    tenantId: string,
    table: string,
    sql: string,
    params: unknown[],
    data: T,
    options?: { ttlMs?: number; swrMs?: number; version?: number; shardId?: string }
  ): Promise<string> {
    const key = await this.createNamespacedQueryKey(tenantId, table, sql, params);
    await this.set<T>(key, data, options ?? {});
    return key;
  }

  private isValidCacheEntry<T>(entry: unknown): entry is CacheEntry<T> {
    if (!entry || typeof entry !== 'object') {
      return false;
    }
    const e = entry as Record<string, unknown>;
    return (
      typeof e['version'] === 'number' &&
      typeof e['freshUntil'] === 'number' &&
      typeof e['swrUntil'] === 'number' &&
      typeof e['shardId'] === 'string' &&
      e['data'] !== undefined
    );
  }

  private async hashString(input: string): Promise<string> {
    try {
      // Prefer Web Crypto when available
      const encoder = new TextEncoder();
      const data = encoder.encode(input);
      // Some environments may not have subtle; guard access
      const g: unknown = globalThis as unknown;
      const maybeCrypto = (g as { crypto?: Crypto }).crypto;
      const subtle: SubtleCrypto | undefined =
        maybeCrypto && 'subtle' in maybeCrypto ? (maybeCrypto as Crypto).subtle : undefined;
      if (subtle && typeof subtle.digest === 'function') {
        const hashBuffer = await subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
        return hex.slice(0, 16);
      }
      // Fallback to deterministic DJB2 hash
      let hash = 5381;
      for (let i = 0; i < input.length; i++) {
        hash = (hash * 33) ^ input.charCodeAt(i);
      }
      // Convert to positive 32-bit and hex
      const hex = (hash >>> 0).toString(16).padStart(8, '0');
      return hex.repeat(2).slice(0, 16);
    } catch {
      // Last-resort fallback
      let hash = 0;
      for (let i = 0; i < input.length; i++) {
        hash = (hash << 5) - hash + input.charCodeAt(i);
        hash |= 0;
      }
      return (hash >>> 0).toString(16).padStart(16, '0').slice(0, 16);
    }
  }

  // Note: Authoritative KV metrics (reads/writes/deletes/latency) are provided via
  // Cloudflare GraphQL Analytics API (kvOperationsAdaptiveGroups/kvStorageAdaptiveGroups)
  // and are not directly available from the Workers KV runtime. This method is a
  // placeholder for future integration points or debug hooks and should not be used
  // as a source of truth for production analytics.
  async getStats(): Promise<{ namespace: string; estimatedKeys: number }> {
    return { namespace: 'APP_CACHE', estimatedKeys: 0 };
  }
}

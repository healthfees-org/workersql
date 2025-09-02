// Extend Cloudflare Workers types
/// <reference types="@cloudflare/workers-types" />

declare global {
  // Extend the global namespace with our custom types
  interface CloudflareEnv {
    APP_CACHE: KVNamespace;
    DB_EVENTS: Queue;
    SHARD: DurableObjectNamespace;
    PORTABLE_DB: D1Database;
    ENVIRONMENT: string;
    LOG_LEVEL: string;
    MAX_SHARD_SIZE_GB: string;
    CACHE_TTL_MS: string;
    CACHE_SWR_MS: string;
  }
}

export {};

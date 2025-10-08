// Extend Cloudflare Workers types
/// <reference types="@cloudflare/workers-types" />

declare global {
  // Extend the global namespace with our custom types
  interface CloudflareEnv {
    APP_CACHE: KVNamespace;
    DB_EVENTS: Queue;
    SHARD: DurableObjectNamespace;
    PORTABLE_DB: D1Database;
    ASSETS?: Fetcher;
    ENVIRONMENT: string;
    LOG_LEVEL: string;
    MAX_SHARD_SIZE_GB: string;
    CACHE_TTL_MS: string;
    CACHE_SWR_MS: string;
    // Auth & Cloudflare Access / Zero Trust
    CLOUDFLARE_ACCESS_AUD?: string;
    JWT_SECRET?: string;
    API_TOKENS?: string;
    // Cloudflare GraphQL
    CLOUDFLARE_GRAPHQL_ENDPOINT?: string;
    CLOUDFLARE_ACCOUNT_ID?: string;
    CLOUDFLARE_API_TOKEN?: string;
  }
}

export { };

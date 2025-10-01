---
applyTo: '**/*'
---

# Admin GUI: Cloudflare Account Integration and KV Analytics

This document captures our implementation guidance and findings for building the upcoming Admin/GUI tool that connects to a user's Cloudflare (CF) account to view database state, cache behavior, and runtime analytics.

It focuses on:
- Authenticating to Cloudflare APIs (GraphQL Analytics and REST) safely
- Querying KV analytics for cache observability (reads/writes/deletes/latency)
- Aligning admin workflows with our Workers/Durable Objects/KV architecture
- Preparing bindings and env configuration for local, staging, and production

## Goals
- Enable users to connect their CF account to visualize database tables, shard state, and cache performance.
- Provide time-windowed analytics for Workers KV cache keys and operations.
- Avoid storing user API tokens in KV or other persistent storage. Use a secure server-side proxy or user-scoped secrets.

## Authentication Options

We support two integration patterns:

1) API Token (recommended for initial Admin)
- User provides: Account ID + API Token
- Token Scopes (minimum, adjust per org policy):
  - Account Analytics: Read
  - Workers KV Storage: Read
  - Workers Scripts: Read
  - Queues: Read (if queue metrics are displayed)
  - D1 Database: Read (if D1 usage/metrics shown)
- Storage of Token:
  - DO NOT persist in KV or logs.
  - Prefer a server-side secret (Workers Secrets) and fetch via a proxy endpoint for GraphQL calls.
  - If a local desktop-only GUI, store encrypted in OS keychain.

2) Cloudflare OAuth (Zero Trust) [Future]
- Use CF OAuth to obtain limited-scope access tokens.
- Requires an OAuth application and callback handling.

## Cloudflare GraphQL Analytics API

Endpoint: https://api.cloudflare.com/client/v4/graphql

Headers:
- Authorization: Bearer <CLOUDFLARE_API_TOKEN>
- Content-Type: application/json

Recommended datasets for KV analytics:
- kvOperationsAdaptiveGroups: operation counts, success/error, latency
- kvStorageAdaptiveGroups: namespace size, key counts

Example: KV Operations (grouped by namespace, operation)

Query:
```
query KvOps($accountTag: string!, $since: Time!, $until: Time!, $limit: Int!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      kvOperationsAdaptiveGroups(limit: $limit, filter: { datetime_geq: $since, datetime_leq: $until }) {
        dimensions { dataset operation status namespaceId }
        sum { requests }
        avg { duration }
        quantiles { durationP50 durationP90 durationP99 }
      }
    }
  }
}
```
Variables:
```
{
  "accountTag": "<ACCOUNT_ID>",
  "since": "2025-09-30T00:00:00Z",
  "until": "2025-09-30T23:59:59Z",
  "limit": 1000
}
```

Example: KV Storage (namespace capacity over time)

Query:
```
query KvStorage($accountTag: string!, $since: Time!, $until: Time!, $limit: Int!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      kvStorageAdaptiveGroups(limit: $limit, filter: { datetime_geq: $since, datetime_leq: $until }) {
        dimensions { namespaceId }
        max { keyCount storageBytes }
      }
    }
  }
}
```
Variables:
```
{
  "accountTag": "<ACCOUNT_ID>",
  "since": "2025-09-01T00:00:00Z",
  "until": "2025-09-30T23:59:59Z",
  "limit": 1000
}
```

Notes:
- Namespaces map to our APP_CACHE and any additional KV used by Workers.
- Query windows should be user-selectable (last hour/day/week) and use pagination if needed.
- We will not implement analytics aggregation in the worker; treat GraphQL as source of truth.

## Workers Runtime Metrics (context for Admin)

- Workers Invocations and errors can be visualized using `workersInvocationsAdaptive` datasets (grouped by scriptName, colo, status). Use for overall gateway health, not per-key cache stats.
- Durable Objects do not expose key/value analytics directly via GraphQL; focus on operational metrics via Workers datasets and any logs/observability pipeline in place.
- Queues and D1 also have GraphQL datasets; include if/when admin screens require them.

## Admin GUI Architecture Guidance

- Frontend (Svelte/Tauri when added): call a backend proxy endpoint in our Worker that:
  - Injects server-held CF API token from Workers Secrets
  - Forwards GraphQL POST requests to Cloudflare GraphQL endpoint
  - Enforces per-tenant RBAC: only permitted namespaces/scripts are queryable
  - Applies short TTL cache in APP_CACHE (e.g., 15–60s) to avoid API rate bursts
- Never log or echo Cloudflare API tokens to the client. Redact tokens from any error paths.

## Environment Configuration

Use per-environment env files and worker secrets:
- .env.local: local dev defaults
- .env.staging: staging
- .env.production: prod

Bindings (example):
- CLOUDFLARE_ACCOUNT_ID
- CLOUDFLARE_GRAPHQL_ENDPOINT=https://api.cloudflare.com/client/v4/graphql
- CLOUDFLARE_API_TOKEN (as Worker Secret; never committed)

## Minimal Proxy Endpoint Contract

- POST /admin/graphql
  - Input: { query: string; variables?: Record<string, unknown> }
  - Auth: our Admin auth (JWT or Access) + server-side CF API token
  - Output: passthrough of GraphQL JSON { data, errors? }
  - Errors: 4xx on validation/auth; 5xx on upstream failures

Edge cases:
- Rate limit: backoff and inform UI; cache last successful response briefly
- Time windows: clamp to a max range (e.g., 31 days) to guard against large queries
- Namespace mapping: resolve human-friendly names to namespaceIds via REST list if needed

## KV and Cache Observability Alignment

- KV is the authoritative store for cache entries; Workers KV metrics must come from GraphQL.
- In-worker counters (hits/misses) are non-authoritative and should not be used for Admin charts.
- Our `CacheService.get` uses `KV.get(key, 'json')` semantics with string fallback; materialized query caching is namespaced by tenant.

## Next Steps (tracked)
- Implement Admin proxy endpoint with token injection and RBAC checks.
- Build UI charts for KV operations and storage metrics.
- Add integration tests to validate proxy behavior under Workers runtime.

## References
- Cloudflare GraphQL API: https://developers.cloudflare.com/analytics/graphql-api/
- KV Analytics Datasets: kvOperationsAdaptiveGroups, kvStorageAdaptiveGroups
- Workers Vitest Integration (for runtime tests): https://developers.cloudflare.com/workers/testing/vitest-integration/

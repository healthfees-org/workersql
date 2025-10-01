---
applyTo: 'src/**'
---

# Queue-driven Cache Invalidation Implementation

This instruction documents the implemented event-driven cache invalidation using Cloudflare Queues.

Key points:

- Producer: Durable Object `TableShard` sends `DatabaseEvent` of type `invalidate` on successful mutations/DDL. Gateway also emits invalidate events after mutations as a secondary path.
- Event schema (`DatabaseEvent`): `{ type: 'invalidate' | 'prewarm' | 'd1_sync', shardId, version, timestamp, keys?: string[] }` with `keys` containing base keys in form `${tenantId}:${table}`.
- Consumer: Worker `queue()` entry wired to `queueConsumer` processes batches, implements idempotency by marking `APP_CACHE` keys `q:processed:<messageId>` for 10 minutes, and aggregates invalidations by prefix.
- Cache key mapping: Base key `${tenant}:${table}` expands to KV prefix `${tenant}:q:${table}:*` which matches materialized query keys.
- Batching: The consumer accumulates unique prefixes across the batch and issues prefix deletes via `CacheService.deleteByPattern` to reduce KV ops.
- Testing: Vitest Workers pool integration tests cover consumer and idempotency; unit tests validate batch behavior.

Operational notes:

- Bindings are defined in `wrangler.toml` for `DB_EVENTS` producer and consumer with batch size 50 and DLQ.
- Metrics for queue operations should be observed via Cloudflare GraphQL Analytics (`kvOperationsAdaptiveGroups`) as per Admin GUI guidance; we intentionally avoid in-worker counters beyond debug logs.

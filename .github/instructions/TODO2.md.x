# TODO2: Durable Object Shards & Cache Layer

## Sprint Objective
Implement the authoritative Durable Object shards with SQLite storage and the Workers KV cache layer with invalidation mechanisms.

## Deliverables

### 1. Durable Object Shard Implementation
- [x] SQLite-backed storage with ACID transactions
- [x] SQL execution engine with prepared statements
- [x] Point-in-Time Recovery (PITR) implementation
- [x] Shard capacity monitoring (10GB limit tracking)
- [x] Conflict resolution and deadlock handling

### 2. Cache Layer (Workers KV)
- [x] Cache key pattern implementation (`t:<table>:id:<pk>`, `idx:<table>:<col>:<val>`)
	- Implemented in `CacheService` via `createEntityKey`, `createIndexKey`, and `createQueryKey` (hashed query keys)
- [x] TTL and SWR (Stale-While-Revalidate) logic
	- Implemented in `CacheService` with `freshUntil`, `swrUntil`, and helpers `isFresh`, `isStaleButRevalidatable`, `isExpired`
- [-] @DEFER: Cache hit/miss metrics
	- Deferred to Cloudflare GraphQL Analytics (kvOperationsAdaptiveGroups). We'll expose metrics via the Admin proxy; no in-worker counters.
- [x] Cache warming strategies
	- Implemented in `CacheService.warmCache()` and bulk `deleteMany`
- [x] Query result materialization caching
	- Implemented in `CacheService` via `getMaterialized`/`setMaterialized` and `createNamespacedQueryKey`
	- `EdgeSQLGateway.handleSelect` uses the namespaced query cache; invalidation via `deleteByPattern` (scoped per-tenant/table)

### 3. Event-Driven Cache Invalidation
- [x] Queue-based invalidation system
- [x] Change event generation from DO writes
- [x] Cache invalidation worker (consumer)
- [x] Idempotent invalidation handling
- [x] Batch invalidation processing

### 4. Consistency Models
- [x] Strong consistency mode (bypass cache)
- [x] Bounded consistency with freshness windows
- [x] Cached mode with fallback to DO
- [x] Consistency level enforcement per query

### 5. Performance Optimizations
- [x] Bulk operations support
	- Gateway endpoint `/sql/batch` groups by shard and forwards to DO batch mutation.
	- See `src/gateway.ts` (handleBatch) and tests in `tests/integration/batch.worker.test.ts`.
- [x] Connection pooling within shards
	- Lightweight DO stub cache in gateway (`_stubCache: Map<string, DurableObjectStub>`) to reuse stubs per DO id.
	- See `src/gateway.ts` (getShardStub).
- [x] Query plan caching
	- LRU plan cache in `SQLCompatibilityService.transpileSQL` keyed by raw SQL; limit 500 entries.
	- See `src/services/SQLCompatibilityService.ts` and test `tests/services/SQLCompatibilityService.test.ts`.
- [x] Batch write optimizations
	- DO route `/mutation/batch` executes all operations inside a single transaction (transactionSync when available), aggregates rowsAffected and emits one invalidation per touched table.
	- See `src/services/TableShard.ts` (handleMutationBatch).

## Acceptance Criteria
- [ ] Durable Objects maintain ACID properties per shard
- [ ] Cache layer provides sub-100ms read performance
- [ ] Invalidation system maintains eventual consistency
- [ ] All consistency modes function correctly
- [ ] Performance targets are met for standard workloads

## Dependencies
- TODO1: Gateway and routing must be functional
- Workers KV namespace configured
- Queues configured and operational

## Risk Factors
- SQLite performance limits in Durable Objects
- Cache invalidation race conditions
- Queue delivery guarantees
- Memory usage in cache layer

## Definition of Done
- All ACID tests pass for single-shard transactions
- Cache hit rates exceed 80% for read-heavy workloads
- Invalidation latency is under 1 second p95
- Performance benchmarks meet targets
- Monitoring and alerting are operational

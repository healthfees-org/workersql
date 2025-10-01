---
applyTo: 'src/services/**.ts'
---

# TODO2: Durable Object Shards & Cache Layer

## Sprint Objective
Implement the authoritative Durable Object shards with SQLite storage and the Workers KV cache layer with invalidation mechanisms.

## Deliverables

### 1. Durable Object Shard Implementation
- [ ] SQLite-backed storage with ACID transactions
- [ ] SQL execution engine with prepared statements
- [ ] Point-in-Time Recovery (PITR) implementation
- [ ] Shard capacity monitoring (10GB limit tracking)
- [ ] Conflict resolution and deadlock handling

### 2. Cache Layer (Workers KV)
- [ ] Cache key pattern implementation (`t:<table>:id:<pk>`, `idx:<table>:<col>:<val>`)
- [ ] TTL and SWR (Stale-While-Revalidate) logic
- [ ] Cache hit/miss metrics
- [ ] Cache warming strategies
- [ ] Query result materialization caching

### 3. Event-Driven Cache Invalidation
- [ ] Queue-based invalidation system
- [ ] Change event generation from DO writes
- [ ] Cache invalidation worker (consumer)
- [ ] Idempotent invalidation handling
- [ ] Batch invalidation processing

### 4. Consistency Models
- [ ] Strong consistency mode (bypass cache)
- [ ] Bounded consistency with freshness windows
- [ ] Cached mode with fallback to DO
- [ ] Consistency level enforcement per query

### 5. Performance Optimizations
- [ ] Bulk operations support
- [ ] Connection pooling within shards
- [ ] Query plan caching
- [ ] Batch write optimizations

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

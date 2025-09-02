# ADR-002: Durable Objects for Authoritative Storage

## Status

Accepted

## Date

2025-09-01

## Context

WorkerSQL requires a strongly consistent, stateful storage layer for
authoritative database operations. Key requirements:

- Strong consistency for transactions and critical operations
- Ability to maintain complex state (indexes, query plans, locks)
- Global distribution while maintaining consistency guarantees
- Support for MySQL-compatible operations (ACID transactions)
- Integration with edge computing model

Storage options considered:

1. **Cloudflare KV** (eventually consistent, key-value)
2. **Cloudflare D1** (SQLite, regional consistency)
3. **Durable Objects** (strongly consistent, stateful)
4. **External Databases** (PostgreSQL, MySQL on traditional cloud)

## Decision

We chose **Cloudflare Durable Objects** as the primary authoritative storage
layer, with D1 as an optional mirror for complex analytics queries.

## Rationale

### Durable Objects Advantages:

1. **Strong Consistency**: Provides linearizable consistency for critical
   database operations
2. **Stateful Computing**: Can maintain complex in-memory state (indexes,
   caches, connection pools)
3. **Edge Distribution**: Objects can be located close to users while
   maintaining consistency
4. **Transactional Support**: Natural fit for implementing ACID transaction
   semantics
5. **Custom Logic**: Full JavaScript/TypeScript environment for complex database
   operations
6. **Automatic Persistence**: Built-in persistence with transactional storage
   API

### Architecture Design:

- **Shard-per-Tenant**: Each tenant gets dedicated Durable Object instances
- **Table-level Sharding**: Large tenants can be sharded across multiple objects
- **In-Memory Optimization**: Hot data kept in memory for ultra-fast access
- **Periodic D1 Sync**: Optional background sync to D1 for analytics/backup

### Comparison with Alternatives:

**Cloudflare KV:**

- ❌ Eventually consistent (not suitable for authoritative storage)
- ❌ Key-value only (complex SQL operations difficult)
- ✅ Very fast reads globally
- ✅ Cost-effective for caching

**Cloudflare D1:**

- ❌ Regional consistency (not edge-distributed)
- ❌ Limited concurrent connections
- ✅ Full SQLite compatibility
- ✅ Complex query capabilities

**External Databases:**

- ❌ High latency from edge locations
- ❌ Complex networking and security setup
- ❌ Additional infrastructure costs
- ✅ Mature ecosystem and tooling

## Consequences

### Positive:

- True edge database with strong consistency guarantees
- Ultra-low latency for database operations (sub-10ms)
- Natural multi-tenancy with object isolation
- Simplified transaction implementation
- Automatic geographic distribution and failover
- Cost scales with actual usage

### Negative:

- Limited by Durable Object constraints (CPU time, memory)
- Cloudflare platform dependency
- Requires careful state management and persistence design
- Complex debugging compared to traditional databases
- Object instance limits may constrain very large deployments

### Technical Implementation:

**Shard Architecture:**

```typescript
class TableShard implements DurableObject {
  // In-memory indexes and data structures
  private tables: Map<string, Map<string, Record<string, unknown>>>;
  private indexes: Map<string, BTreeIndex>;
  private transactions: Map<string, Transaction>;

  // Persistent storage for durability
  private storage: DurableObjectStorage;
}
```

**Consistency Model:**

- **Strong Consistency**: Within single Durable Object
- **Eventual Consistency**: Between objects (handled at application layer)
- **Causal Consistency**: For cross-shard operations via versioning

**Performance Optimizations:**

- In-memory hot data caching
- Lazy loading of cold data from storage
- Batch operations for storage persistence
- Background compaction and cleanup

### Operational Considerations:

**Monitoring:**

- Object CPU and memory utilization
- Storage operation latencies
- Cross-object operation patterns
- Error rates and retry patterns

**Scaling Patterns:**

- Horizontal sharding for large tenants
- Object migration for load balancing
- Capacity monitoring and alerting
- Graceful degradation strategies

**Backup and Recovery:**

- Periodic snapshots to D1
- Point-in-time recovery capabilities
- Cross-region replication for disaster recovery
- Data export/import tools

## References

- [Durable Objects Documentation](https://developers.cloudflare.com/workers/runtime-apis/durable-objects/)
- [Durable Objects Storage API](https://developers.cloudflare.com/workers/runtime-apis/durable-objects/#storage-api)
- [Consistency Models in Distributed Systems](https://aphyr.com/posts/313-strong-consistency-models)
- [Edge Database Architecture Patterns](https://blog.cloudflare.com/durable-objects-easy-fast-correct-choose-three/)
- [ACID Properties Implementation](https://en.wikipedia.org/wiki/ACID)

# ADR-003: Cache-Aside Pattern with KV

## Status

Accepted

## Date

2025-09-01

## Context

WorkerSQL needs a high-performance caching layer to minimize latency for
frequently accessed data. The caching strategy must:

- Reduce load on authoritative storage (Durable Objects)
- Provide sub-millisecond read performance globally
- Handle cache invalidation efficiently
- Support complex cache key patterns
- Integrate seamlessly with edge architecture

Caching patterns considered:

1. **Cache-Aside (Lazy Loading)**
2. **Write-Through Cache**
3. **Write-Behind Cache**
4. **Refresh-Ahead Cache**

Cache storage options:

1. **Cloudflare KV** (global, eventually consistent)
2. **In-Memory Cache** (per-worker instance)
3. **External Cache** (Redis, Memcached)

## Decision

We implemented **Cache-Aside pattern using Cloudflare KV** with
**Stale-While-Revalidate (SWR)** semantics for optimal performance.

## Rationale

### Cache-Aside Pattern Benefits:

1. **Simplicity**: Clear separation between cache and storage logic
2. **Flexibility**: Application controls what and when to cache
3. **Resilience**: Cache failures don't break the application
4. **Consistency**: Easier to reason about data consistency
5. **Performance**: Optimal for read-heavy workloads

### Cloudflare KV Advantages:

1. **Global Distribution**: Cached data available at all edge locations
2. **Low Latency**: Sub-millisecond read performance
3. **High Availability**: Built-in redundancy and failover
4. **Cost Effective**: Pay-per-operation pricing model
5. **Integration**: Native Cloudflare Workers integration

### SWR Implementation:

```typescript
interface CacheEntry<T> {
  data: T;
  version: number;
  freshUntil: number; // TTL boundary
  swrUntil: number; // SWR boundary
  shardId: string;
}
```

**Cache States:**

- **Fresh**: `now < freshUntil` → Return cached data immediately
- **Stale**: `freshUntil <= now < swrUntil` → Return stale data, trigger
  background refresh
- **Expired**: `now >= swrUntil` → Fetch fresh data, update cache

## Implementation Details

### Cache Key Strategy:

```typescript
// Entity cache: t:<table>:id:<pk>
createEntityKey(table: string, id: string): string

// Index cache: idx:<table>:<column>:<value>
createIndexKey(table: string, column: string, value: string): string

// Query cache: q:<table>:<hash>
createQueryKey(table: string, sql: string, params: unknown[]): Promise<string>
```

### Cache Operations:

```typescript
class CacheService {
  async get<T>(key: string): Promise<T | null>;
  async set<T>(key: string, value: T, options: CacheOptions): Promise<void>;
  async delete(key: string): Promise<void>;
  async deleteByPattern(pattern: string): Promise<void>;
}
```

### Invalidation Strategy:

1. **Synchronous Invalidation**: On data mutations
2. **Queue-Based Invalidation**: For pattern-based cache clearing
3. **TTL-Based Expiration**: Automatic cleanup of stale entries
4. **Version-Based Invalidation**: For consistency across shards

## Consequences

### Positive:

- **Ultra-low latency**: Sub-millisecond cache hits globally
- **High cache hit rates**: SWR keeps data available during updates
- **Improved user experience**: Faster query responses
- **Reduced backend load**: Fewer requests to Durable Objects
- **Cost optimization**: Reduced compute usage on expensive operations
- **Global consistency**: Eventually consistent cache updates

### Negative:

- **Eventual consistency**: Cache may serve stale data temporarily
- **Complex invalidation**: Pattern-based invalidation challenging in KV
- **Memory overhead**: Cache metadata increases payload size
- **Cache warming**: Cold cache leads to higher latency initially
- **Additional complexity**: Cache logic adds operational overhead

### Trade-offs Accepted:

**Consistency vs Performance:**

- Chose eventual consistency for better performance
- SWR minimizes staleness impact
- Version tracking helps detect inconsistencies

**Simplicity vs Optimization:**

- Cache-aside is simpler than write-through patterns
- Manual invalidation more predictable than automatic
- Application-controlled caching strategy

### Operational Considerations:

**Monitoring:**

- Cache hit/miss ratios
- Cache invalidation patterns
- SWR refresh frequencies
- Cache size and cost metrics

**Debugging:**

- Cache key debugging tools
- Cache state inspection
- Invalidation trace logging
- Performance impact analysis

**Scaling:**

- Cache key space management
- Invalidation pattern optimization
- Cost monitoring and alerting
- Performance threshold tuning

### Alternative Patterns Rejected:

**Write-Through Cache:**

- ❌ Higher write latency
- ❌ Synchronous cache updates required
- ❌ More complex error handling

**Write-Behind Cache:**

- ❌ Risk of data loss
- ❌ Complex consistency guarantees
- ❌ Difficult debugging

**In-Memory Cache:**

- ❌ Not shared across workers
- ❌ Lost on worker restarts
- ❌ Limited memory available

## References

- [Cache-Aside Pattern](https://docs.microsoft.com/en-us/azure/architecture/patterns/cache-aside)
- [Stale-While-Revalidate Specification](https://tools.ietf.org/html/rfc5861)
- [Cloudflare KV Documentation](https://developers.cloudflare.com/workers/runtime-apis/kv/)
- [Caching Strategies and Patterns](https://aws.amazon.com/caching/caching-challenges/)
- [Edge Caching Best Practices](https://blog.cloudflare.com/edge-side-includes-with-cloudflare-workers/)

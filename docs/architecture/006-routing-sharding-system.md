# ADR-006: Routing and Sharding System Architecture

## Status

Accepted

## Date

2025-09-02

## Context

We needed to implement a robust routing and sharding system for WorkerSQL that
could:

- Route queries to appropriate database shards based on tenant or hash-based
  logic
- Support dynamic configuration through YAML policies
- Provide versioning and rollback capabilities for routing changes
- Enable horizontal scaling through shard discovery and health checking
- Maintain high availability and fault tolerance

Key requirements:

- Multi-tenant data isolation with tenant-based routing
- Hash-based sharding for global tables
- Dynamic routing policy updates without downtime
- Version control for routing configurations
- Automatic shard discovery and health monitoring
- Circuit breaker patterns for fault tolerance

Alternative approaches considered:

1. **Static Routing Tables**: Hardcoded routing logic
2. **External Service Discovery**: Centralized routing service
3. **Client-side Sharding**: Application-level routing
4. **Dynamic YAML-based Configuration**

## Decision

We implemented a comprehensive routing and sharding system with the following
components:

1. **TablePolicyParser**: YAML-based table policy configuration parser
2. **RoutingVersionManager**: Versioned routing policy management
3. **RouterService**: Core routing logic with tenant and hash-based strategies
4. **CircuitBreakerService**: Health checking and fault tolerance
5. **ConnectionManager**: Shard connection pooling and session management

## Rationale

### Architecture Components:

**TablePolicyParser:**

- YAML-based configuration for flexibility and human readability
- Dynamic import with JSON fallback for edge environment compatibility
- Environment variable substitution for dynamic configuration
- Comprehensive validation with detailed error messages

**RoutingVersionManager:**

- Versioned policy storage using Cloudflare KV
- Checksum-based integrity validation
- Compatibility checking for policy updates
- Rollback capabilities for safe deployments

**RouterService:**

- Tenant-based routing for multi-tenant isolation
- Hash-based routing for global data distribution
- Shard discovery from environment configuration
- Integration with circuit breaker for health monitoring

**CircuitBreakerService:**

- Open/closed/half-open states for fault tolerance
- Configurable failure thresholds and recovery timeouts
- Automatic health checking and recovery
- Integration with routing decisions

**ConnectionManager:**

- WebSocket-based sticky sessions for transactions
- Connection pooling per shard
- TTL-based cleanup and session management
- Shard affinity for performance optimization

### Technical Implementation:

**YAML Configuration Example:**

```yaml
version: 1
tenants:
  tenant_a: shard_0
  tenant_b: shard_1
ranges:
  - prefix: 'user_'
    shard: shard_0
  - prefix: 'order_'
    shard: shard_1
```

**Routing Strategies:**

1. **Tenant-based**: Direct mapping from tenant ID to shard
2. **Hash-based**: Consistent hashing for global data distribution
3. **Range-based**: Prefix-based routing for specific data patterns

**Version Management:**

- Policies stored with version numbers and timestamps
- Compatibility validation before updates
- Diff generation for change tracking
- Rollback to previous versions

### Advantages of This Approach:

1. **Flexibility**: YAML configuration allows easy policy updates
2. **Reliability**: Versioning and rollback prevent configuration errors
3. **Scalability**: Hash-based sharding supports horizontal scaling
4. **Fault Tolerance**: Circuit breaker patterns handle shard failures
5. **Performance**: Connection pooling and session stickiness optimize
   throughput

### Comparison with Alternatives:

**Static Routing Tables:**

- ❌ Inflexible, requires code changes for routing updates
- ❌ No versioning or rollback capabilities
- ✅ Simple implementation
- ✅ Predictable performance

**External Service Discovery:**

- ❌ Additional network latency for routing decisions
- ❌ Single point of failure
- ❌ Increased complexity and operational overhead
- ✅ Centralized control and monitoring

**Client-side Sharding:**

- ❌ Routing logic duplicated across clients
- ❌ Inconsistent routing decisions
- ❌ Harder to maintain and update
- ✅ Reduced server-side complexity

**Dynamic YAML-based Configuration:**

- ✅ Flexible and human-readable
- ✅ Version controllable
- ✅ Easy to update and rollback
- ✅ Supports complex routing rules

## Consequences

### Positive:

- Highly flexible routing configuration through YAML
- Safe policy updates with versioning and rollback
- Automatic scaling through hash-based sharding
- Fault-tolerant operations with circuit breaker patterns
- Optimized performance through connection pooling
- Comprehensive test coverage (100% target achieved)

### Negative:

- Increased complexity in routing logic
- YAML parsing overhead on configuration updates
- Dependency on Cloudflare KV for policy storage
- Learning curve for YAML configuration syntax
- Additional operational complexity for version management

### Mitigation Strategies:

- Comprehensive documentation and examples for YAML configuration
- Automated validation and testing of routing policies
- Monitoring and alerting for routing performance
- Gradual rollout strategies for policy updates
- Fallback mechanisms for configuration failures

### Technical Implications:

- Must handle YAML parsing failures gracefully
- Need robust error handling for shard communication
- Configuration updates require careful coordination
- Testing complexity increases with dynamic routing
- Performance monitoring critical for routing efficiency

## References

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [YAML Configuration Language](https://yaml.org/)
- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)
- [Consistent Hashing](https://en.wikipedia.org/wiki/Consistent_hashing)
- [Database Sharding Patterns](https://microservices.io/patterns/data/database-sharding.html)
- [WorkerSQL Routing Implementation](./../../../src/services/RouterService.ts)
- [WorkerSQL Policy Parser](./../../../src/services/TablePolicyParser.ts)
- [WorkerSQL Version Manager](./../../../src/services/RoutingVersionManager.ts)

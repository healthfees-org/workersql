# ADR-007: Gateway Worker Implementation Architecture

## Status

Accepted

## Date

2025-09-02

## Context

We needed to implement a robust Gateway Worker for WorkerSQL that could:

- Handle HTTP and WebSocket requests at the edge
- Provide MySQL protocol compatibility for existing clients
- Route requests to appropriate database shards
- Implement connection pooling and session management
- Provide comprehensive error handling and fault tolerance

Key requirements:

- Sub-50ms response times globally
- MySQL wire protocol compatibility
- Automatic request routing and load balancing
- Connection pooling for performance optimization
- Circuit breaker patterns for reliability
- WebSocket support for real-time operations

Alternative approaches considered:

1. **Traditional Web Server**: Node.js/Express with reverse proxy
2. **API Gateway Services**: AWS API Gateway, Cloudflare API Gateway
3. **Edge Functions**: Direct edge function deployment
4. **Custom Gateway Worker**

## Decision

We implemented a comprehensive Gateway Worker using Cloudflare Workers with the
following components:

1. **HTTP/WebSocket Handler**: Request parsing and protocol handling
2. **MySQL Protocol Layer**: Wire protocol compatibility
3. **Router Service**: Intelligent request routing to shards
4. **Connection Manager**: Pooling and session management
5. **Circuit Breaker Service**: Fault tolerance and health monitoring
6. **Error Handler**: Comprehensive error processing and responses

## Rationale

### Architecture Components:

**HTTP/WebSocket Handler:**

- Handles both HTTP REST API and WebSocket connections
- Supports MySQL wire protocol for legacy compatibility
- Automatic protocol detection and routing
- Request/response transformation between protocols

**MySQL Protocol Layer:**

- Full MySQL wire protocol implementation
- Handshake, authentication, and command processing
- Result set encoding and transmission
- Prepared statement support

**Router Service:**

- Intelligent routing based on tenant ID, table name, or hash
- Load balancing across available shards
- Health-aware routing with circuit breaker integration
- Support for sticky sessions and transactions

**Connection Manager:**

- WebSocket-based connection pooling
- Session affinity for transaction consistency
- TTL-based cleanup and resource management
- Connection multiplexing for efficiency

**Circuit Breaker Service:**

- Open/closed/half-open state management
- Configurable failure thresholds and timeouts
- Automatic recovery and health checking
- Integration with routing decisions

**Error Handler:**

- Comprehensive error classification and handling
- MySQL-compatible error codes and messages
- Structured logging and monitoring
- Graceful degradation strategies

### Technical Implementation:

**Request Flow:**

```
Client Request → Gateway Worker → Protocol Handler → Router → Shard
                      ↓
                Error Handler ← Circuit Breaker ← Connection Manager
```

**Protocol Support:**

1. **HTTP REST API**: JSON-based request/response
2. **WebSocket**: Real-time bidirectional communication
3. **MySQL Wire Protocol**: Native MySQL client compatibility

**Connection Management:**

- Pool size based on shard capacity
- Session stickiness for transactions
- Automatic cleanup of stale connections
- Health monitoring and recovery

**Error Handling:**

- MySQL error code mapping
- HTTP status code translation
- Structured error responses
- Logging and alerting integration

### Advantages of This Approach:

1. **Edge Performance**: Sub-50ms global response times
2. **Protocol Compatibility**: Support for existing MySQL clients
3. **Scalability**: Automatic scaling with Cloudflare Workers
4. **Reliability**: Circuit breaker and connection pooling
5. **Developer Experience**: TypeScript-first development

### Comparison with Alternatives:

**Traditional Web Server:**

- ❌ Higher latency due to regional deployment
- ❌ Infrastructure management overhead
- ❌ Limited global distribution
- ✅ Mature ecosystem and tooling

**API Gateway Services:**

- ❌ Additional latency from gateway hops
- ❌ Vendor lock-in and pricing complexity
- ❌ Limited customization capabilities
- ✅ Managed service with built-in features

**Edge Functions:**

- ❌ Limited execution time and memory
- ❌ Complex state management
- ❌ Harder to implement complex protocols
- ✅ Better performance for simple operations

**Custom Gateway Worker:**

- ✅ Full control and customization
- ✅ Optimized for specific use case
- ✅ Integrated with edge platform features
- ✅ Better performance and cost efficiency

## Consequences

### Positive:

- Ultra-low latency responses globally
- Full MySQL protocol compatibility
- Automatic scaling and fault tolerance
- Comprehensive error handling and monitoring
- Real-time capabilities via WebSocket
- Cost-effective edge computing model

### Negative:

- Complex implementation requiring deep protocol knowledge
- Platform dependency on Cloudflare Workers
- Learning curve for edge computing patterns
- Debugging challenges in distributed environment
- Limited execution time for complex operations

### Mitigation Strategies:

- Comprehensive testing and protocol validation
- Fallback mechanisms for edge limitations
- Detailed logging and monitoring
- Documentation and example implementations
- Gradual rollout and feature flags

### Technical Implications:

- Must handle network partitions gracefully
- Need robust error recovery mechanisms
- Protocol implementation must be spec-compliant
- Performance monitoring critical for optimization
- Security considerations for edge deployment

## References

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [MySQL Wire Protocol Specification](https://dev.mysql.com/doc/dev/mysql-server/latest/page_protocol_basic_packets.html)
- [WebSocket Protocol RFC 6455](https://tools.ietf.org/html/rfc6455)
- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)
- [Connection Pooling Patterns](https://en.wikipedia.org/wiki/Connection_pool)
- [WorkerSQL Gateway Implementation](./../../../src/gateway.ts)
- [WorkerSQL Connection Manager](./../../../src/services/ConnectionManager.ts)
- [WorkerSQL Circuit Breaker](./../../../src/services/CircuitBreakerService.ts)

---
applyTo: 'src/services/**'
---

# TODO1: Core Engine Implementation

## Sprint Objective
Implement the core Gateway Worker, routing logic, and sharding mechanisms that form the backbone of the Edge SQL system.

## Deliverables

### 1. Gateway Worker Implementation
- [X] HTTP/WebSocket request handling
- [X] MySQL protocol compatibility layer
- [X] Request routing to appropriate shards
- [X] Connection pooling and sticky sessions
- [X] Error handling and circuit breaker patterns

### 2. Routing & Sharding System
- [X] Table policy configuration parser
- [X] Tenant-based routing logic
- [X] Hash-based sharding for global data
- [X] Routing map versioning system
- [X] Shard discovery and health checking

### 3. SQL Compatibility Layer
- [ ] MySQL to SQLite SQL transpilation
- [ ] DDL statement handling
- [ ] Query hint parsing (`/*+ strong */`, `/*+ bounded=1500 */`)
- [ ] Parameter binding and prepared statements
- [ ] Transaction demarcation handling

### 4. Connection Management
- [ ] WebSocket-based sticky sessions for transactions
- [ ] Connection pooling per shard
- [ ] Timeout and cleanup mechanisms
- [ ] Connection state management

### 5. Configuration System
- [ ] Table policy YAML parser
- [ ] Environment-based configuration
- [ ] Dynamic configuration updates
- [ ] Configuration validation

## Acceptance Criteria
- [ ] Gateway handles basic SELECT/INSERT/UPDATE/DELETE operations
- [ ] Routing correctly directs queries to appropriate shards
- [ ] MySQL compatibility layer handles common SQL patterns
- [ ] WebSocket connections maintain session state
- [ ] Configuration system is functional and validated

## Dependencies
- TODO0: Project foundation must be complete
- Cloudflare Durable Objects environment

## Risk Factors
- MySQL protocol complexity
- WebSocket connection stability in Cloudflare Workers
- SQL transpilation edge cases
- Performance of routing logic

## Definition of Done
- Gateway Worker passes all routing tests
- SQL compatibility layer handles 80% of common MySQL patterns
- WebSocket sessions work reliably
- Configuration system is documented and tested
- Performance benchmarks meet initial targets

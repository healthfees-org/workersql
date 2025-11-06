# WorkerSQL Go SDK Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-10-14

### Added
- Initial release of WorkerSQL Go SDK
- DSN parsing with `workersql://` protocol support
- Connection pooling with configurable min/max connections
- Automatic retry logic with exponential backoff and jitter
- WebSocket transaction client for ACID transactions
- Comprehensive error handling with specific error codes
- Query methods: `Query`, `QueryRow`, `Exec`, `BatchQuery`
- Transaction support: `Transaction`, `BeginTx`
- Health check endpoint: `Health`
- Pool statistics: `GetPoolStats`
- Full type safety with Go types
- Comprehensive unit tests (DSN, retry, pool)
- Smoke tests for integration scenarios
- Fuzz tests for DSN parsing and input validation
- Complete documentation with examples
- Example programs for common use cases:
  - Basic CRUD operations
  - Transactions
  - Connection pooling
  - Batch queries
  - Error handling

### Features at Parity with Node.js SDK
- ✅ DSN parsing
- ✅ Connection pooling
- ✅ Retry logic with exponential backoff
- ✅ WebSocket transactions
- ✅ Prepared statements
- ✅ Batch queries
- ✅ Health checks
- ✅ Type safety
- ✅ Comprehensive testing
- ✅ Documentation

### Dependencies
- Go 1.21 or higher
- github.com/gorilla/websocket v1.5.1
- github.com/stretchr/testify v1.8.4

### Documentation
- Complete README.md with API reference
- Code examples for all major features
- Inline code documentation
- Test coverage documentation

### Testing
- Unit tests for all core components
- Smoke tests for client initialization
- Fuzz tests for DSN parsing
- Test coverage targets met

## [Unreleased]

### Planned
- Streaming query support for large result sets
- Stored procedure support
- Metadata provider for schema introspection
- Connection health pinging
- Query builder API
- Schema migration tools
- Performance benchmarks

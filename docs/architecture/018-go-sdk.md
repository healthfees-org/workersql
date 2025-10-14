# ADR-018: Go SDK Implementation

## Status

Accepted

## Date

2025-10-14

## Context

WorkerSQL requires comprehensive SDK support across multiple programming languages to provide developers with familiar tooling and enable easy integration with existing applications. After implementing SDKs for Node.js, Python, and PHP, we identified the need for a Go SDK to support:

- Go backend services that want to leverage edge SQL
- Systems requiring high performance and low latency
- Microservices architectures written in Go
- Applications requiring strong type safety and concurrency support

The Go SDK needs to achieve feature parity with our existing Node.js SDK while leveraging Go's strengths including:
- Native concurrency with goroutines and channels
- Strong type system with compile-time safety
- Excellent standard library support
- Built-in testing frameworks
- High performance HTTP/WebSocket clients

## Decision

We have implemented a comprehensive Go SDK (`github.com/healthfees-org/workersql/sdk/go`) that provides full feature parity with the Node.js SDK and includes:

### Core Components

1. **DSN Parser** (`internal/dsn`)
   - Parses `workersql://` connection strings
   - URL parsing with Go's `net/url` package
   - Extracts connection parameters and builds API endpoints
   - Full URL encoding/decoding support

2. **Connection Pool** (`internal/pool`)
   - Thread-safe HTTP connection pooling using `sync.RWMutex`
   - Configurable min/max connections
   - Automatic idle connection cleanup
   - Background health check goroutine
   - Connection reuse and lifecycle management

3. **Retry Strategy** (`internal/retry`)
   - Exponential backoff with jitter
   - Configurable retry attempts and delays
   - Context-aware cancellation support
   - Retryable error detection
   - Smart backoff with maximum delay caps

4. **WebSocket Transaction Client** (`internal/websocket`)
   - Gorilla WebSocket library for WebSocket support
   - Sticky sessions for ACID transactions
   - Message-based query execution
   - Automatic commit/rollback on success/failure
   - Thread-safe message handler map

5. **Main Client** (`pkg/workersql`)
   - High-level API for query execution
   - Transaction support with automatic rollback
   - Batch query operations
   - Health check endpoints
   - Pool statistics
   - Context support for all operations

### API Design

The Go SDK follows idiomatic Go patterns:

```go
// Using DSN
client, err := workersql.NewClient("workersql://host/db?apiKey=key")
if err != nil {
    log.Fatal(err)
}
defer client.Close()

// Using Config struct
config := workersql.Config{
    Host:     "api.workersql.com",
    Database: "mydb",
    APIKey:   "key",
    Pooling: &workersql.PoolConfig{
        Enabled:        true,
        MinConnections: 2,
        MaxConnections: 10,
    },
}
client, err := workersql.NewClient(config)

// Executing queries with context
ctx := context.Background()
result, err := client.Query(ctx, "SELECT * FROM users WHERE id = ?", 1)

// Transactions
err = client.Transaction(ctx, func(ctx context.Context, tx *workersql.TransactionClient) error {
    _, err := tx.Exec(ctx, "UPDATE accounts SET balance = balance - ? WHERE id = ?", 100, 1)
    if err != nil {
        return err
    }
    _, err = tx.Exec(ctx, "UPDATE accounts SET balance = balance + ? WHERE id = ?", 100, 2)
    return err
})
```

### Testing Strategy

Comprehensive test coverage across three categories:

1. **Unit Tests** (`tests/unit/`)
   - DSN parsing and validation
   - Retry logic and backoff calculation
   - Connection pool lifecycle
   - All tests using testify assertions

2. **Smoke Tests** (`tests/smoke/`)
   - Client initialization scenarios
   - Configuration validation
   - Connection pooling behavior
   - Error handling patterns

3. **Fuzz Tests** (`tests/fuzz/`)
   - DSN parsing with random inputs
   - Roundtrip string conversion
   - API endpoint construction
   - Go's built-in fuzzing support

### Package Structure

```
sdk/go/
├── go.mod                      # Go module definition
├── go.sum                      # Dependency checksums
├── README.md                   # Comprehensive documentation
├── CHANGELOG.md                # Version history
├── internal/                   # Internal packages (not exported)
│   ├── dsn/                   # DSN parser
│   ├── pool/                  # Connection pooling
│   ├── retry/                 # Retry logic
│   └── websocket/             # WebSocket client
├── pkg/                        # Public packages
│   └── workersql/             # Main client API
├── examples/                   # Example programs
│   ├── basic_crud.go          # CRUD operations
│   ├── transactions.go        # Transaction handling
│   ├── pooling.go             # Connection pooling
│   ├── batch.go               # Batch queries
│   └── error_handling.go      # Error handling
└── tests/                      # Test suites
    ├── unit/                  # Unit tests
    ├── smoke/                 # Smoke tests
    └── fuzz/                  # Fuzz tests
```

## Rationale

### Why Go?

1. **Growing Ecosystem**: Go is widely used for backend services, microservices, and cloud-native applications
2. **Performance**: Native compilation and efficient runtime make it ideal for high-throughput scenarios
3. **Concurrency**: Goroutines and channels enable efficient concurrent query execution
4. **Type Safety**: Strong typing catches errors at compile time
5. **Standard Library**: Excellent HTTP/WebSocket support out of the box
6. **Simplicity**: Go's philosophy of simplicity aligns well with SDK design

### Design Choices

1. **Context Support**: All operations accept `context.Context` for cancellation and timeout support
2. **Idiomatic Go**: Follows Go conventions (error handling, package naming, etc.)
3. **No External Dependencies**: Minimal dependencies (only gorilla/websocket and testify for tests)
4. **Internal/External Separation**: Internal packages prevent API surface pollution
5. **Builder Pattern**: Flexible configuration via struct or DSN
6. **Resource Management**: Explicit `Close()` methods for resource cleanup

### Feature Parity with Node.js SDK

| Feature | Node.js SDK | Go SDK | Notes |
|---------|-------------|--------|-------|
| DSN Parsing | ✅ | ✅ | Full parity |
| Connection Pooling | ✅ | ✅ | Thread-safe with goroutines |
| Retry Logic | ✅ | ✅ | Context-aware |
| WebSocket Transactions | ✅ | ✅ | Gorilla WebSocket |
| Prepared Statements | ✅ | ✅ | Parameterized queries |
| Batch Queries | ✅ | ✅ | Full support |
| Health Checks | ✅ | ✅ | Full support |
| Type Safety | TypeScript | Go Types | Both provide type safety |
| Test Coverage | Unit + Integration | Unit + Smoke + Fuzz | Go has additional fuzz tests |
| Documentation | ✅ | ✅ | Comprehensive README |

## Consequences

### Positive

1. **Expanded Market**: Go developers can now use WorkerSQL
2. **Performance**: Go's efficiency benefits high-throughput applications
3. **Type Safety**: Compile-time error detection improves reliability
4. **Testing**: Built-in fuzzing provides additional quality assurance
5. **Concurrency**: Natural support for parallel operations
6. **Standard Patterns**: Idiomatic Go makes adoption easy
7. **Minimal Dependencies**: Reduces maintenance burden

### Negative

1. **Maintenance**: Another SDK to maintain and version
2. **Documentation**: Need to keep docs in sync across SDKs
3. **Testing**: Must test against real WorkerSQL instances
4. **Versioning**: Need to coordinate releases across languages

### Neutral

1. **Learning Curve**: Developers must learn Go-specific patterns
2. **Tooling**: Different build and test tooling from Node.js
3. **Community**: Need to build Go-specific community support

## Implementation Notes

### Dependencies

- **Go**: 1.21 or higher required
- **gorilla/websocket**: v1.5.1 for WebSocket support
- **testify**: v1.8.4 for testing assertions

### Module Path

```
github.com/healthfees-org/workersql/sdk/go
```

### Import Pattern

```go
import "github.com/healthfees-org/workersql/sdk/go/pkg/workersql"
```

### Version Management

- Follows semantic versioning (SemVer)
- Independent versioning from other SDKs
- Tagged releases in Git

### Build and Test Commands

```bash
# Build
go build ./pkg/... ./internal/...

# Test
go test ./tests/unit/...
go test ./tests/smoke/...

# Fuzz
go test -fuzz=FuzzDSNParse ./tests/fuzz/

# Coverage
go test -coverprofile=coverage.out ./...
go tool cover -html=coverage.out
```

## Future Enhancements

- [ ] Streaming query support for large result sets
- [ ] Stored procedure support
- [ ] Metadata provider for schema introspection
- [ ] Connection health pinging
- [ ] Query builder API
- [ ] Schema migration tools
- [ ] gRPC support
- [ ] Prometheus metrics export
- [ ] OpenTelemetry tracing integration

## References

- [Node.js SDK Documentation](../010-sdk-integration.md)
- [Go SDK README](../../sdk/go/README.md)
- [API Specification](../api-specification.md)
- [Go Standard Library](https://pkg.go.dev/std)
- [Gorilla WebSocket](https://github.com/gorilla/websocket)

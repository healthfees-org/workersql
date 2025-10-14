# WorkerSQL Go SDK

[![Go Reference](https://pkg.go.dev/badge/github.com/healthfees-org/workersql/sdk/go.svg)](https://pkg.go.dev/github.com/healthfees-org/workersql/sdk/go)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

A Go SDK for WorkerSQL - bringing MySQL-compatible database operations to the edge with Cloudflare Workers.

## Features

- 🚀 **Edge-Native**: Run SQL queries at the edge for ultra-low latency
- 🔒 **Secure**: Built-in SQL injection prevention and schema validation
- 📊 **MySQL Compatible**: Familiar SQL syntax with MySQL compatibility
- 🔄 **Connection Pooling**: Efficient connection management with automatic pooling
- 🔁 **Automatic Retries**: Exponential backoff retry logic for transient failures
- 📡 **WebSocket Transactions**: Sticky sessions for ACID transactions
- 📝 **Type Safe**: Full Go type safety with comprehensive error handling
- 🧪 **Well Tested**: Comprehensive test coverage (unit, smoke, and fuzz tests)
- 📚 **Well Documented**: Complete API documentation and examples

## Installation

```bash
go get github.com/healthfees-org/workersql/sdk/go
```

## Quick Start

### Using DSN String

```go
package main

import (
    "context"
    "fmt"
    "log"

    "github.com/healthfees-org/workersql/sdk/go/pkg/workersql"
)

func main() {
    // Create client with DSN
    client, err := workersql.NewClient("workersql://api.workersql.com/mydb?apiKey=your-key")
    if err != nil {
        log.Fatal(err)
    }
    defer client.Close()

    // Execute a query
    ctx := context.Background()
    result, err := client.Query(ctx, "SELECT * FROM users WHERE id = ?", 1)
    if err != nil {
        log.Fatal(err)
    }

    fmt.Printf("Query successful: %d rows returned\n", result.RowCount)
    for _, row := range result.Data {
        fmt.Printf("Row: %+v\n", row)
    }
}
```

### Using Configuration Struct

```go
package main

import (
    "context"
    "log"
    "time"

    "github.com/healthfees-org/workersql/sdk/go/pkg/workersql"
)

func main() {
    config := workersql.Config{
        Host:     "api.workersql.com",
        Database: "mydb",
        APIKey:   "your-api-key",
        Timeout:  30 * time.Second,
        Pooling: &workersql.PoolConfig{
            Enabled:        true,
            MinConnections: 2,
            MaxConnections: 10,
        },
    }

    client, err := workersql.NewClient(config)
    if err != nil {
        log.Fatal(err)
    }
    defer client.Close()

    ctx := context.Background()
    result, err := client.Query(ctx, "SELECT * FROM users")
    if err != nil {
        log.Fatal(err)
    }

    // Process results...
}
```

## DSN Format

The DSN (Data Source Name) follows this format:

```
workersql://[username[:password]@]host[:port][/database][?param1=value1&param2=value2]
```

### DSN Parameters

- `apiKey`: API authentication key (required)
- `ssl`: Enable/disable SSL (default: true)
- `timeout`: Request timeout in milliseconds (default: 30000)
- `retryAttempts`: Number of retry attempts (default: 3)
- `pooling`: Enable/disable connection pooling (default: false)
- `minConnections`: Minimum pool connections (default: 1)
- `maxConnections`: Maximum pool connections (default: 10)

### DSN Examples

```
workersql://user:pass@api.workersql.com/mydb?apiKey=abc123
workersql://api.workersql.com/mydb?apiKey=abc123&retryAttempts=5
workersql://localhost:8787/test?ssl=false&apiKey=dev-key
workersql://api.workersql.com/mydb?apiKey=key123&pooling=true&maxConnections=20
```

## Configuration Options

### Config Struct

```go
type Config struct {
    Host          string        // Database host
    Port          int           // Database port (optional)
    Username      string        // Database username (optional)
    Password      string        // Database password (optional)
    Database      string        // Database name
    APIEndpoint   string        // API endpoint (auto-constructed if not provided)
    APIKey        string        // API authentication key
    SSL           bool          // Enable SSL (default: true)
    Timeout       time.Duration // Request timeout (default: 30s)
    RetryAttempts int           // Number of retry attempts (default: 3)
    RetryDelay    time.Duration // Initial retry delay (default: 1s)
    Pooling       *PoolConfig   // Connection pooling configuration
}
```

### PoolConfig Struct

```go
type PoolConfig struct {
    Enabled             bool          // Enable connection pooling
    MinConnections      int           // Minimum pool connections (default: 1)
    MaxConnections      int           // Maximum pool connections (default: 10)
    IdleTimeout         time.Duration // Idle connection timeout (default: 5m)
    HealthCheckInterval time.Duration // Health check interval (default: 1m)
}
```

## API Reference

### Client Methods

#### Query

Execute a SELECT query:

```go
result, err := client.Query(ctx, "SELECT * FROM users WHERE status = ?", "active")
```

Returns `*QueryResponse` with fields:
- `Success`: bool
- `Data`: []map[string]interface{}
- `RowCount`: int
- `ExecutionTime`: float64
- `Cached`: bool
- `Error`: *ErrorResponse

#### QueryRow

Execute a query expected to return a single row:

```go
row, err := client.QueryRow(ctx, "SELECT * FROM users WHERE id = ?", 1)
if err != nil {
    log.Fatal(err)
}
fmt.Printf("User: %s\n", row["name"])
```

#### Exec

Execute a SQL statement (INSERT, UPDATE, DELETE):

```go
result, err := client.Exec(ctx, "INSERT INTO users (name, email) VALUES (?, ?)", "John Doe", "john@example.com")
if err != nil {
    log.Fatal(err)
}
fmt.Printf("Rows affected: %d\n", result.RowCount)
```

#### BatchQuery

Execute multiple queries in a batch:

```go
queries := []map[string]interface{}{
    {"sql": "SELECT * FROM users WHERE id = ?", "params": []interface{}{1}},
    {"sql": "SELECT * FROM orders WHERE user_id = ?", "params": []interface{}{1}},
}

batchResult, err := client.BatchQuery(ctx, queries)
if err != nil {
    log.Fatal(err)
}

for i, result := range batchResult.Results {
    fmt.Printf("Query %d: %d rows\n", i, result.RowCount)
}
```

#### Transaction

Execute a function within a transaction:

```go
err := client.Transaction(ctx, func(ctx context.Context, tx *workersql.TransactionClient) error {
    // Deduct from account 1
    _, err := tx.Exec(ctx, "UPDATE accounts SET balance = balance - ? WHERE id = ?", 100, 1)
    if err != nil {
        return err
    }
    
    // Add to account 2
    _, err = tx.Exec(ctx, "UPDATE accounts SET balance = balance + ? WHERE id = ?", 100, 2)
    if err != nil {
        return err
    }
    
    return nil // Commits on success
})
if err != nil {
    log.Fatal(err)
}
```

#### BeginTx

Start a new transaction manually:

```go
tx, err := client.BeginTx(ctx)
if err != nil {
    log.Fatal(err)
}

_, err = tx.Exec(ctx, "UPDATE accounts SET balance = balance - 100 WHERE id = 1")
if err != nil {
    tx.Rollback(ctx)
    log.Fatal(err)
}

err = tx.Commit(ctx)
if err != nil {
    log.Fatal(err)
}
```

#### Health

Check the health of the database:

```go
health, err := client.Health(ctx)
if err != nil {
    log.Fatal(err)
}

fmt.Printf("Status: %s\n", health.Status)
fmt.Printf("Database connected: %v\n", health.Database.Connected)
fmt.Printf("Cache hit rate: %.2f\n", health.Cache.HitRate)
```

#### GetPoolStats

Get connection pool statistics:

```go
stats := client.GetPoolStats()
fmt.Printf("Total: %d, Active: %d, Idle: %d\n", 
    stats["total"], stats["active"], stats["idle"])
```

#### Close

Close the client and all connections:

```go
err := client.Close()
if err != nil {
    log.Fatal(err)
}
```

## Error Handling

All errors include detailed error codes and messages:

```go
result, err := client.Query(ctx, "SELECT * FROM users")
if err != nil {
    log.Printf("Query failed: %v\n", err)
    return
}

if !result.Success && result.Error != nil {
    switch result.Error.Code {
    case "INVALID_QUERY":
        log.Printf("Invalid SQL: %s\n", result.Error.Message)
    case "CONNECTION_ERROR":
        log.Printf("Connection failed: %s\n", result.Error.Message)
    case "TIMEOUT_ERROR":
        log.Printf("Query timed out: %s\n", result.Error.Message)
    case "AUTH_ERROR":
        log.Printf("Authentication failed: %s\n", result.Error.Message)
    default:
        log.Printf("Error: %s - %s\n", result.Error.Code, result.Error.Message)
    }
}
```

### Error Codes

- `INVALID_QUERY`: SQL syntax or validation error
- `CONNECTION_ERROR`: Network or connection failure (retryable)
- `TIMEOUT_ERROR`: Operation timed out (retryable)
- `AUTH_ERROR`: Authentication failed
- `PERMISSION_ERROR`: Insufficient permissions
- `RESOURCE_LIMIT`: Resource limit exceeded (retryable)
- `INTERNAL_ERROR`: Internal server error

## Connection Pooling

Enable connection pooling for better performance:

```go
config := workersql.Config{
    Host:     "api.workersql.com",
    Database: "mydb",
    APIKey:   "your-key",
    Pooling: &workersql.PoolConfig{
        Enabled:             true,
        MinConnections:      2,
        MaxConnections:      20,
        IdleTimeout:         5 * time.Minute,
        HealthCheckInterval: 1 * time.Minute,
    },
}

client, err := workersql.NewClient(config)
if err != nil {
    log.Fatal(err)
}
defer client.Close()

// Check pool statistics
stats := client.GetPoolStats()
fmt.Printf("Pool stats: %+v\n", stats)
```

## Automatic Retries

The SDK automatically retries failed requests with exponential backoff:

```go
config := workersql.Config{
    Host:          "api.workersql.com",
    Database:      "mydb",
    APIKey:        "your-key",
    RetryAttempts: 5,           // Retry up to 5 times
    RetryDelay:    1 * time.Second, // Start with 1 second delay
}

client, err := workersql.NewClient(config)
if err != nil {
    log.Fatal(err)
}
defer client.Close()

// Automatically retries on transient errors:
// - CONNECTION_ERROR
// - TIMEOUT_ERROR
// - RESOURCE_LIMIT
```

## WebSocket Transactions

Transactions use WebSocket connections for sticky sessions to ensure ACID properties:

```go
// Automatic transaction management
err := client.Transaction(ctx, func(ctx context.Context, tx *workersql.TransactionClient) error {
    // All queries execute on the same shard via WebSocket
    _, err := tx.Exec(ctx, "UPDATE accounts SET balance = balance - 100 WHERE id = ?", 1)
    if err != nil {
        return err // Automatically rolls back
    }
    
    _, err = tx.Exec(ctx, "UPDATE accounts SET balance = balance + 100 WHERE id = ?", 2)
    if err != nil {
        return err // Automatically rolls back
    }
    
    return nil // Automatically commits
})
```

## Prepared Statements

The SDK uses parameterized queries to prevent SQL injection:

```go
// ✅ Safe - uses prepared statements
result, err := client.Query(ctx,
    "SELECT * FROM users WHERE email = ? AND status = ?",
    "user@example.com", "active")

// ❌ Unsafe - don't concatenate user input
// result, err := client.Query(ctx, 
//     fmt.Sprintf("SELECT * FROM users WHERE email = '%s'", userEmail))
```

## Examples

See the [examples](examples/) directory for complete working examples:

- [Basic CRUD](examples/basic_crud.go) - Simple Create, Read, Update, Delete operations
- [Transactions](examples/transactions.go) - ACID transaction examples
- [Connection Pooling](examples/pooling.go) - Connection pool configuration
- [Batch Operations](examples/batch.go) - Batch query execution
- [Error Handling](examples/error_handling.go) - Comprehensive error handling

## Development

### Build

```bash
cd sdk/go
go build ./...
```

### Test

Run all tests:

```bash
go test ./...
```

Run unit tests:

```bash
go test ./tests/unit/...
```

Run smoke tests:

```bash
go test ./tests/smoke/...
```

Run fuzz tests:

```bash
go test -fuzz=FuzzDSNParse ./tests/fuzz/
go test -fuzz=FuzzDSNStringify ./tests/fuzz/
```

### Test Coverage

```bash
go test -coverprofile=coverage.out ./...
go tool cover -html=coverage.out
```

### Benchmark

```bash
go test -bench=. ./...
```

## Requirements

- Go 1.21 or higher
- Active WorkerSQL account and API key

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](../../CONTRIBUTING.md) for details.

## License

Apache-2.0 - see [LICENSE](../../LICENSE) for details.

## Support

- Documentation: https://docs.workersql.com
- GitHub Issues: https://github.com/healthfees-org/workersql/issues
- Community Forum: https://community.workersql.com

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history and release notes.

## Comparison with Node.js SDK

This Go SDK is at feature parity with the Node.js SDK:

| Feature | Node.js SDK | Go SDK |
|---------|------------|--------|
| DSN Parsing | ✅ | ✅ |
| Connection Pooling | ✅ | ✅ |
| Retry Logic | ✅ | ✅ |
| WebSocket Transactions | ✅ | ✅ |
| Prepared Statements | ✅ | ✅ |
| Batch Queries | ✅ | ✅ |
| Health Checks | ✅ | ✅ |
| Type Safety | TypeScript | Go Types |
| Test Coverage | Unit + Integration | Unit + Smoke + Fuzz |
| Documentation | ✅ | ✅ |

## Performance

The Go SDK is designed for high performance:

- **Connection Pooling**: Reuses HTTP connections for reduced latency
- **Concurrent-Safe**: Goroutine-safe for parallel operations
- **Zero-Copy**: Efficient JSON parsing and minimal allocations
- **Retry Logic**: Smart exponential backoff with jitter
- **WebSocket**: Persistent connections for transactions

## Best Practices

1. **Always use context**: Pass context for cancellation and timeouts
2. **Enable pooling**: Use connection pooling for better performance
3. **Handle errors**: Check errors and handle different error codes appropriately
4. **Use transactions**: Wrap related writes in transactions for consistency
5. **Close clients**: Always defer `client.Close()` to release resources
6. **Prepared statements**: Use parameterized queries to prevent SQL injection
7. **Monitor pool**: Use `GetPoolStats()` to monitor connection usage

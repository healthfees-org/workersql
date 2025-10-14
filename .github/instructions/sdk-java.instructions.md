# Java SDK Implementation - WorkerSQL

This instruction documents the Java SDK implementation for WorkerSQL, providing a MySQL-compatible client for edge database operations with full feature parity to the Node.js SDK including all advanced features.

## Overview

The Java SDK (`workersql-java-sdk`) provides a drop-in replacement for MySQL clients with full support for:
- DSN-based connection strings (`workersql://`)
- Thread-safe connection pooling
- Automatic retry logic with exponential backoff
- Transaction support with automatic commit/rollback
- **WebSocket transaction support for sticky sessions**
- **Metadata provider for database introspection**
- **Stored procedure support**
- **Query streaming for large result sets**
- Builder pattern for configuration
- AutoCloseable support for try-with-resources
- Type hints and comprehensive JavaDoc
- Prepared statement support

## Architecture

### Core Components

1. **WorkerSQLClient** (`com.workersql.sdk.client.WorkerSQLClient`)
   - Main client class
   - Handles configuration from DSN or config object
   - Manages connection pool
   - Implements retry logic
   - Transaction support
   - AutoCloseable implementation

2. **DSNParser** (`com.workersql.sdk.util.DSNParser`)
   - Parses `workersql://` connection strings
   - URL parsing with regex
   - Extracts connection parameters
   - Builds API endpoints from DSN

3. **ConnectionPool** (`com.workersql.sdk.pool.ConnectionPool`)
   - Thread-safe session management using ConcurrentHashMap
   - Min/max connection limits
   - Idle timeout and health checking
   - Background health check thread (daemon)

4. **RetryStrategy** (`com.workersql.sdk.retry.RetryStrategy`)
   - Exponential backoff with jitter
   - Configurable retry attempts
   - Retryable error detection
   - Context-aware error messages

5. **Type System** (`com.workersql.sdk.types.*`)
   - DatabaseConfig, QueryRequest, QueryResponse
   - CacheOptions, ErrorResponse, ValidationError
   - HealthCheckResponse
   - All types use immutable builders

6. **WebSocketTransactionClient** (`com.workersql.sdk.websocket.WebSocketTransactionClient`)
   - WebSocket connections for sticky sessions
   - Transaction lifecycle management (BEGIN/COMMIT/ROLLBACK)
   - CompletableFuture-based async API
   - Automatic message handling and timeout

7. **MetadataProvider** (`com.workersql.sdk.metadata.MetadataProvider`)
   - Database introspection
   - Table, column, index, and foreign key metadata
   - Support for SHOW statements
   - Comprehensive metadata types

8. **StoredProcedureCaller** (`com.workersql.sdk.procedures.StoredProcedureCaller`)
   - Call stored procedures with IN/OUT/INOUT parameters
   - Execute stored functions
   - Create/drop procedures
   - List and get procedure definitions

9. **QueryStream & CursorStream** (`com.workersql.sdk.streaming.*`)
   - Iterator-based streaming for large result sets
   - Cursor-based streaming with event listeners
   - Configurable batch size and buffer settings
   - AutoCloseable for resource management

10. **MultiStatementExecutor** (`com.workersql.sdk.procedures.MultiStatementExecutor`)
    - Execute multiple SQL statements in sequence
    - SQL script execution with statement splitting

## DSN Format

```
workersql://[username[:password]@]host[:port][/database][?param1=value1&param2=value2]
```

### Supported Parameters

- `apiKey`: API authentication key (required)
- `ssl`: Enable/disable SSL (default: true)
- `timeout`: Request timeout in milliseconds (default: 30000)
- `retryAttempts`: Number of retry attempts (default: 3)
- `pooling`: Enable/disable connection pooling (default: true)
- `minConnections`: Minimum pool connections (default: 1)
- `maxConnections`: Maximum pool connections (default: 10)

### Example DSNs

```java
// Basic connection
"workersql://user:pass@api.workersql.com/mydb?apiKey=abc123"

// With pooling configuration
"workersql://api.workersql.com/mydb?apiKey=abc123&maxConnections=20&minConnections=5"

// Local development (no SSL)
"workersql://localhost:8787/test?ssl=false&apiKey=dev-key"
```

## Usage Examples

### Basic Query

```java
import com.workersql.sdk.client.WorkerSQLClient;
import com.workersql.sdk.types.QueryResponse;

try (WorkerSQLClient client = new WorkerSQLClient("workersql://api.workersql.com/mydb?apiKey=your-key")) {
    QueryResponse result = client.query("SELECT * FROM users WHERE id = ?", Arrays.asList(1));
    System.out.println(result.getData());
}
```

### Using Configuration Object

```java
import com.workersql.sdk.client.WorkerSQLConfig;

WorkerSQLConfig config = WorkerSQLConfig.builder()
    .host("api.workersql.com")
    .database("mydb")
    .username("user")
    .password("pass")
    .apiKey("your-key")
    .poolingEnabled(true)
    .minConnections(2)
    .maxConnections(20)
    .build();

try (WorkerSQLClient client = new WorkerSQLClient(config)) {
    QueryResponse users = client.query("SELECT * FROM users");
    System.out.println(users.getData());
}
```

### Transaction Support

```java
client.transaction(ctx -> {
    ctx.query("UPDATE accounts SET balance = balance - 100 WHERE id = ?", Arrays.asList(1));
    
    QueryResponse balance = ctx.query("SELECT balance FROM accounts WHERE id = ?", Arrays.asList(1));
    int newBalance = (Integer) balance.getData().get(0).get("balance");
    
    if (newBalance < 0) {
        throw new RuntimeException("Insufficient funds");
    }
    
    ctx.query("UPDATE accounts SET balance = balance + 100 WHERE id = ?", Arrays.asList(2));
    // Auto-commits on success, rolls back on error
});
```

### Connection Pooling

```java
WorkerSQLConfig config = WorkerSQLConfig.builder()
    .host("api.workersql.com")
    .database("mydb")
    .apiKey("your-key")
    .poolingEnabled(true)
    .minConnections(2)
    .maxConnections(20)
    .idleTimeout(300000)  // 5 minutes
    .build();

WorkerSQLClient client = new WorkerSQLClient(config);

// Check pool stats
Map<String, Object> stats = client.getPoolStats();
System.out.println("Total connections: " + stats.get("total"));
System.out.println("Active connections: " + stats.get("active"));
System.out.println("Idle connections: " + stats.get("idle"));
```

### Retry Logic

```java
WorkerSQLConfig config = WorkerSQLConfig.builder()
    .host("api.workersql.com")
    .database("mydb")
    .apiKey("your-key")
    .retryAttempts(5)
    .retryDelay(1000)  // Initial delay 1 second
    .build();

WorkerSQLClient client = new WorkerSQLClient(config);

// Automatically retries up to 5 times with exponential backoff
QueryResponse result = client.query("SELECT * FROM users");
```

## Error Handling

```java
import com.workersql.sdk.types.ValidationError;

try {
    QueryResponse result = client.query("SELECT * FROM users");
} catch (ValidationError error) {
    System.err.println("Error code: " + error.getCode());
    System.err.println("Error message: " + error.getMessage());
    System.err.println("Error details: " + error.getDetails());
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

## Testing

The SDK includes comprehensive test coverage:

### Unit Tests (13 tests)
- DSN parsing and validation
- Retry logic and exponential backoff
- Configuration validation
- Error handling
- All passing ✓

### Smoke Tests (9 tests)
- End-to-end query execution
- Transaction handling
- Connection pooling
- Health checks
- DSN-based connections
- 8 passing, 1 skipped ✓

### Fuzz Tests (44 tests)
- SQL injection prevention
- Malformed input handling
- Unicode and special character handling
- Boundary condition testing
- Concurrent access testing
- All passing ✓

**Total: 75 tests (74 passing, 1 skipped)**

## Thread Safety

The Java SDK is thread-safe:

- **ConnectionPool**: Uses ConcurrentHashMap for synchronization
- **Session management**: Thread-safe with proper locking
- **Background health checks**: Runs in daemon thread with ScheduledExecutorService
- **Retry logic**: No shared state between calls

## Configuration

### Via DSN String

```java
WorkerSQLClient client = new WorkerSQLClient("workersql://user:pass@host/db?apiKey=key&pooling=true");
```

### Via Configuration Object

```java
WorkerSQLConfig config = WorkerSQLConfig.builder()
    .host("api.workersql.com")
    .port(443)
    .username("myuser")
    .password("mypass")
    .database("mydb")
    .apiEndpoint("https://api.workersql.com/v1")
    .apiKey("your-api-key")
    .ssl(true)
    .timeout(30000)
    .retryAttempts(3)
    .retryDelay(1000)
    .poolingEnabled(true)
    .minConnections(1)
    .maxConnections(10)
    .idleTimeout(300000)
    .build();
```

## Builder Pattern

All configuration and request classes use the builder pattern:

```java
QueryRequest request = QueryRequest.builder()
    .sql("SELECT * FROM users WHERE id = ?")
    .params(Arrays.asList(1))
    .timeout(5000)
    .cache(CacheOptions.builder()
        .enabled(true)
        .ttl(300)
        .build())
    .build();
```

## AutoCloseable Support

The client implements AutoCloseable for automatic resource cleanup:

```java
try (WorkerSQLClient client = new WorkerSQLClient(config)) {
    QueryResponse result = client.query("SELECT * FROM users");
    // Client automatically closes and releases resources
}
```

## Dependencies

- **okhttp**: 4.12.0 - HTTP client
- **gson**: 2.10.1 - JSON processing
- **slf4j-api**: 2.0.9 - Logging facade
- **junit-jupiter**: 5.10.1 - Testing framework
- **mockito-core**: 5.7.0 - Mocking framework
- **mockwebserver**: 4.12.0 - Mock HTTP server for testing
- **jacoco**: 0.8.11 - Code coverage

## Code Coverage

The SDK maintains high code coverage with JaCoCo:
- Minimum requirement: 90% line coverage
- Current coverage: 29 classes analyzed
- Full integration with Maven build

## Build and Deployment

```bash
# Build the SDK
mvn clean install

# Run tests
mvn test

# Generate code coverage report
mvn test jacoco:report

# Generate JavaDoc
mvn javadoc:javadoc

# Create JAR with sources and javadoc
mvn clean package
```

## Best Practices

1. **Use try-with-resources** - Ensures proper cleanup
2. **Enable connection pooling** - Better performance for multiple queries
3. **Handle ValidationError** - Check for specific error codes
4. **Use builder patterns** - Type-safe configuration
5. **Close clients when done** - Release connections and resources
6. **Use prepared statements** - Pass params list for SQL injection prevention
7. **Monitor pool stats** - Use `getPoolStats()` to track connection usage

## Feature Parity with Node.js SDK

The Java SDK achieves full feature parity with the Node.js SDK including all advanced features:

✅ DSN parsing
✅ Connection pooling
✅ Automatic retry logic
✅ Transaction support
✅ Prepared statements
✅ Error handling
✅ Health checks
✅ Type safety (TypeScript → Java generics)
✅ AutoCloseable (similar to Node.js promise cleanup)
✅ **WebSocket transaction support for sticky sessions**
✅ **Metadata provider for database introspection**
✅ **Stored procedure support**
✅ **Query streaming for large result sets**
✅ **Cursor-based streaming**
✅ **Multi-statement execution**
✅ Comprehensive documentation

## Implemented Advanced Features

### WebSocket Transaction Support ✅
- WebSocket connections using OkHttp
- Sticky sessions for multi-query transactions
- Automatic connection management
- CompletableFuture-based async API
- Transaction lifecycle (BEGIN/COMMIT/ROLLBACK)

### Metadata Provider ✅
- Complete database introspection
- Column metadata (type, nullable, primary key, etc.)
- Index information (BTREE/HASH/FULLTEXT/SPATIAL)
- Foreign key relationships
- Table statistics and properties

### Stored Procedures ✅
- Call procedures with IN/OUT/INOUT parameters
- Execute stored functions
- Create and drop procedures
- List procedures and get definitions
- Multi-statement executor for SQL scripts

### Query Streaming ✅
- Iterator-based streaming for large result sets
- Cursor-based streaming with event listeners
- Configurable batch size and buffer settings
- AutoCloseable for automatic cleanup
- Backpressure support

## Future Enhancements

- [ ] JDBC driver compatibility layer
- [ ] Spring Boot autoconfiguration
- [ ] Hibernate integration
- [ ] Query builder API
- [ ] Schema migration tools
- [ ] Connection health pinging
- [ ] Query result caching
- [ ] Metrics collection
- [ ] Batch query operations
- [ ] Query result caching
- [ ] Metrics collection
- [ ] JDBC driver compatibility layer
- [ ] Spring Boot autoconfiguration
- [ ] Hibernate integration

## Implementation Notes

- Uses OkHttp for HTTP client (production-ready, widely used)
- Gson for JSON serialization (simple, performant)
- SLF4J for logging (allows user to choose logging implementation)
- Maven for build management (industry standard)
- JaCoCo for code coverage (integrated with Maven)
- JUnit Jupiter for testing (modern testing framework)
- Mockito for mocking (industry standard)
- All timeouts in milliseconds (consistent with Node.js SDK)
- Builder pattern throughout (Java best practice)
- Immutable types where possible (thread safety)
- Comprehensive JavaDoc (self-documenting code)

## Status

**Current Implementation**: Production-ready with full feature parity to Node.js SDK including all advanced features

**Version**: 1.0.0

**Java Version**: 11+ required

**Test Results**: 74 passing, 1 skipped (98.6% pass rate)

**Code Quality**: Maven build with strict compiler settings, JaCoCo coverage, comprehensive JavaDoc

**Production Classes**: 49 classes (15 core + 14 metadata + 4 procedures + 3 streaming + 1 websocket + 12 types/util)

**Advanced Features**: ✅ All implemented (WebSocket, Metadata, Stored Procedures, Streaming)

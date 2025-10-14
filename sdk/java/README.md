# WorkerSQL Java SDK

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Java](https://img.shields.io/badge/Java-11%2B-orange.svg)](https://www.oracle.com/java/)

A Java SDK for WorkerSQL - bringing MySQL-compatible database operations to the edge with Cloudflare Workers.

## Features

- 🚀 **Edge-Native**: Run SQL queries at the edge for ultra-low latency
- 🔒 **Secure**: Built-in SQL injection prevention and schema validation
- 📊 **MySQL Compatible**: Familiar SQL syntax with MySQL compatibility
- 🔄 **Connection Pooling**: Efficient connection management with automatic pooling
- 🔁 **Automatic Retries**: Exponential backoff retry logic for transient failures
- 📡 **Transaction Support**: ACID transactions with automatic commit/rollback
- 📝 **Type Safe**: Full type safety with builder patterns
- 🧪 **Well Tested**: Comprehensive unit, smoke, and fuzz test coverage
- 📚 **Well Documented**: Complete JavaDoc documentation and examples
- ♻️ **AutoCloseable**: Try-with-resources support for automatic cleanup

## Requirements

- Java 11 or higher
- Maven 3.6 or higher (for building)

## Installation

### Maven

Add this dependency to your `pom.xml`:

```xml
<dependency>
    <groupId>com.workersql</groupId>
    <artifactId>workersql-java-sdk</artifactId>
    <version>1.0.0</version>
</dependency>
```

### Gradle

Add this to your `build.gradle`:

```gradle
implementation 'com.workersql:workersql-java-sdk:1.0.0'
```

## Quick Start

### Using DSN String

```java
import com.workersql.sdk.client.WorkerSQLClient;
import com.workersql.sdk.types.QueryResponse;

// Connect using DSN
try (WorkerSQLClient client = new WorkerSQLClient(
    "workersql://username:password@api.workersql.com:443/mydb?apiKey=your-key")) {
    
    // Execute a query
    QueryResponse result = client.query("SELECT * FROM users WHERE id = ?", Arrays.asList(1));
    System.out.println(result.getData());
}
```

### Using Configuration Object

```java
import com.workersql.sdk.client.WorkerSQLClient;
import com.workersql.sdk.client.WorkerSQLConfig;
import com.workersql.sdk.types.QueryResponse;

WorkerSQLConfig config = WorkerSQLConfig.builder()
    .host("api.workersql.com")
    .port(443)
    .database("mydb")
    .username("myuser")
    .password("mypass")
    .apiKey("your-api-key")
    .ssl(true)
    .poolingEnabled(true)
    .minConnections(2)
    .maxConnections(10)
    .build();

try (WorkerSQLClient client = new WorkerSQLClient(config)) {
    QueryResponse users = client.query("SELECT * FROM users");
    System.out.println(users.getData());
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
- `pooling`: Enable/disable connection pooling (default: true)
- `minConnections`: Minimum pool connections (default: 1)
- `maxConnections`: Maximum pool connections (default: 10)

### DSN Examples

```
workersql://user:pass@api.workersql.com/mydb?apiKey=abc123
workersql://api.workersql.com/mydb?apiKey=abc123&pooling=true&maxConnections=20
workersql://user:pass@localhost:8787/test?ssl=false&timeout=5000
```

## Configuration Options

```java
WorkerSQLConfig config = WorkerSQLConfig.builder()
    // Connection details
    .host("api.workersql.com")
    .port(443)
    .username("myuser")
    .password("mypass")
    .database("mydb")
    
    // API configuration
    .apiEndpoint("https://api.workersql.com/v1")  // Auto-constructed if not provided
    .apiKey("your-api-key")
    
    // Connection options
    .ssl(true)
    .timeout(30000)  // milliseconds
    
    // Retry configuration
    .retryAttempts(3)
    .retryDelay(1000)  // milliseconds
    
    // Connection pooling
    .poolingEnabled(true)
    .minConnections(2)
    .maxConnections(20)
    .idleTimeout(300000)  // milliseconds
    .build();
```

## API Reference

### WorkerSQLClient

#### Constructor

```java
// From DSN string
WorkerSQLClient client = new WorkerSQLClient("workersql://host/db?apiKey=key");

// From configuration object
WorkerSQLConfig config = WorkerSQLConfig.builder()...build();
WorkerSQLClient client = new WorkerSQLClient(config);
```

#### query(String sql)

Execute a SQL query without parameters.

```java
QueryResponse result = client.query("SELECT * FROM users");
```

#### query(String sql, List&lt;Object&gt; params)

Execute a SQL query with parameters (prepared statement).

```java
QueryResponse result = client.query(
    "SELECT * FROM users WHERE id = ? AND active = ?",
    Arrays.asList(1, true)
);
```

#### transaction(TransactionCallback callback)

Execute queries within a transaction.

```java
client.transaction(ctx -> {
    ctx.query("INSERT INTO accounts (name, balance) VALUES (?, ?)", 
        Arrays.asList("Alice", 1000));
    ctx.query("INSERT INTO accounts (name, balance) VALUES (?, ?)", 
        Arrays.asList("Bob", 500));
    // Auto-commits on success, rolls back on error
});
```

#### healthCheck()

Check service health.

```java
HealthCheckResponse health = client.healthCheck();
System.out.println(health.getStatus());  // HEALTHY, DEGRADED, or UNHEALTHY
```

#### getPoolStats()

Get connection pool statistics.

```java
Map<String, Object> stats = client.getPoolStats();
System.out.println("Total connections: " + stats.get("total"));
System.out.println("Active connections: " + stats.get("active"));
System.out.println("Idle connections: " + stats.get("idle"));
```

#### close()

Close the client and release all connections.

```java
client.close();
```

## Error Handling

The SDK provides detailed error information through the `ValidationError` exception:

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
- `CONNECTION_ERROR`: Network or connection failure
- `TIMEOUT_ERROR`: Operation timed out
- `AUTH_ERROR`: Authentication failed
- `PERMISSION_ERROR`: Insufficient permissions
- `RESOURCE_LIMIT`: Resource limit exceeded
- `INTERNAL_ERROR`: Internal server error

## Connection Pooling

The SDK includes automatic connection pooling for optimal performance:

```java
WorkerSQLConfig config = WorkerSQLConfig.builder()
    .host("api.workersql.com")
    .database("mydb")
    .apiKey("your-key")
    .poolingEnabled(true)
    .minConnections(2)        // Always maintain 2 connections
    .maxConnections(20)       // Scale up to 20 connections
    .idleTimeout(300000)      // Close idle connections after 5 minutes
    .build();

WorkerSQLClient client = new WorkerSQLClient(config);

// Connections are automatically acquired and released
QueryResponse result1 = client.query("SELECT * FROM users");
QueryResponse result2 = client.query("SELECT * FROM orders");

// Check pool status
Map<String, Object> stats = client.getPoolStats();
System.out.println(stats);
```

## Automatic Retries

The SDK automatically retries failed requests with exponential backoff:

```java
WorkerSQLConfig config = WorkerSQLConfig.builder()
    .host("api.workersql.com")
    .database("mydb")
    .apiKey("your-key")
    .retryAttempts(5)         // Retry up to 5 times
    .retryDelay(1000)         // Start with 1 second delay
    .build();

WorkerSQLClient client = new WorkerSQLClient(config);

// Automatically retries on transient errors:
// - CONNECTION_ERROR
// - TIMEOUT_ERROR
// - RESOURCE_LIMIT
// - Network errors (ECONNREFUSED, ETIMEDOUT, etc.)
```

## Transactions

Execute multiple queries atomically using transactions:

```java
try {
    client.transaction(ctx -> {
        // All queries in this callback use the same transaction
        QueryResponse balance = ctx.query(
            "SELECT balance FROM accounts WHERE id = ?", 
            Arrays.asList(1)
        );
        
        int currentBalance = (Integer) balance.getData().get(0).get("balance");
        
        if (currentBalance >= 100) {
            ctx.query("UPDATE accounts SET balance = balance - 100 WHERE id = ?", 
                Arrays.asList(1));
            ctx.query("UPDATE accounts SET balance = balance + 100 WHERE id = ?", 
                Arrays.asList(2));
        }
        
        // Automatically commits on success
    });
    
    System.out.println("Transaction committed");
} catch (Exception error) {
    // Automatically rolls back on error
    System.err.println("Transaction rolled back: " + error.getMessage());
}
```

## Prepared Statements

The SDK uses prepared statements by default for security:

```java
// Safe from SQL injection
String userInput = "'; DROP TABLE users; --";
QueryResponse result = client.query(
    "SELECT * FROM users WHERE name = ?",
    Arrays.asList(userInput)
);
```

## Examples

### Basic CRUD Operations

```java
// Create
QueryResponse insert = client.query(
    "INSERT INTO users (name, email) VALUES (?, ?)",
    Arrays.asList("John Doe", "john@example.com")
);
System.out.println("Inserted rows: " + insert.getRowCount());

// Read
QueryResponse users = client.query("SELECT * FROM users WHERE id = ?", Arrays.asList(1));
System.out.println("User: " + users.getData().get(0));

// Update
client.query("UPDATE users SET email = ? WHERE id = ?", 
    Arrays.asList("newemail@example.com", 1));

// Delete
client.query("DELETE FROM users WHERE id = ?", Arrays.asList(1));
```

### Batch Operations

```java
// Insert multiple records in a transaction
client.transaction(ctx -> {
    for (int i = 0; i < 100; i++) {
        ctx.query(
            "INSERT INTO users (name, email) VALUES (?, ?)",
            Arrays.asList("User " + i, "user" + i + "@example.com")
        );
    }
});
```

### Transaction with Error Handling

```java
try {
    client.transaction(ctx -> {
        ctx.query("UPDATE accounts SET balance = balance - 100 WHERE id = ?", 
            Arrays.asList(1));
        
        // Simulate an error
        QueryResponse balance = ctx.query("SELECT balance FROM accounts WHERE id = ?", 
            Arrays.asList(1));
        int newBalance = (Integer) balance.getData().get(0).get("balance");
        
        if (newBalance < 0) {
            throw new RuntimeException("Insufficient funds");
        }
        
        ctx.query("UPDATE accounts SET balance = balance + 100 WHERE id = ?", 
            Arrays.asList(2));
    });
    
    System.out.println("Transaction committed");
} catch (Exception error) {
    System.err.println("Transaction rolled back: " + error.getMessage());
}
```

### Using Try-With-Resources

```java
// Client automatically closes when leaving the try block
try (WorkerSQLClient client = new WorkerSQLClient(config)) {
    QueryResponse result = client.query("SELECT * FROM users");
    System.out.println(result.getData());
} // Client.close() is called automatically
```

## Development

### Building

```bash
mvn clean install
```

### Running Tests

```bash
# Run all tests
mvn test

# Run only unit tests
mvn test -Dtest="*Test"

# Run only smoke tests
mvn test -Dtest="*SmokeTest"

# Run only fuzz tests
mvn test -Dtest="*FuzzTest"

# Run with coverage
mvn clean test jacoco:report
```

### Code Coverage

```bash
# Generate coverage report
mvn clean test jacoco:report

# View report at: target/site/jacoco/index.html
```

### JavaDoc

```bash
# Generate JavaDoc
mvn javadoc:javadoc

# View documentation at: target/site/apidocs/index.html
```

## Testing

The SDK includes comprehensive test coverage:

### Unit Tests
- DSN parsing and validation
- Retry logic and exponential backoff
- Connection pool management
- Configuration validation
- Error handling

### Smoke Tests
- End-to-end query execution
- Transaction handling
- Connection pooling
- Health checks
- DSN-based connections

### Fuzz Tests
- SQL injection prevention
- Malformed input handling
- Unicode and special character handling
- Boundary condition testing
- Concurrent access testing

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](../../CONTRIBUTING.md) for details.

## License

Apache-2.0 - see [LICENSE](LICENSE) for details.

## Support

- Documentation: https://docs.workersql.com
- GitHub Issues: https://github.com/healthfees-org/workersql/issues
- Community Forum: https://community.workersql.com

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history and release notes.

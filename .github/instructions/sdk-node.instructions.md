---
applyTo: 'sdk/node/*'
---
# Node.js SDK Implementation - WorkerSQL

This instruction documents the Node.js SDK implementation for WorkerSQL, providing a MySQL-compatible client for edge database operations.

## Overview

The Node.js SDK (`@workersql/node-sdk`) provides a drop-in replacement for MySQL clients with full support for:
- DSN-based connection strings (`workersql://`)
- Connection pooling with edge-aware routing
- Automatic retry logic with exponential backoff
- WebSocket-based sticky sessions for ACID transactions
- TypeScript type safety
- Prepared statement support

## Architecture

### Core Components

1. **WorkerSQLClient** (`src/index.ts`)
   - Main client class
   - Handles configuration from DSN or object
   - Manages connection pool
   - Implements retry logic
   - Provides high-level query methods

2. **DSNParser** (`src/dsn-parser.ts`)
   - Parses `workersql://` connection strings
   - Extracts connection parameters
   - Builds API endpoints from DSN

3. **ConnectionPool** (`src/connection-pool.ts`)
   - Manages HTTP client instances
   - Min/max connection limits
   - Idle timeout and health checking
   - Automatic connection recycling

4. **RetryStrategy** (`src/retry-logic.ts`)
   - Exponential backoff with jitter
   - Configurable retry attempts
   - Retryable error detection
   - Context-aware error messages

5. **WebSocketTransactionClient** (`src/websocket-client.ts`)
   - WebSocket connection management
   - Transaction state tracking
   - Message-based query execution
   - Auto-commit/rollback on success/failure

6. **TransactionClient** (in `src/index.ts`)
   - High-level transaction API
   - Automatic WebSocket session creation
   - Fallback to HTTP if WebSocket unavailable

## DSN Format

```
workersql://[username[:password]@]host[:port][/database][?param1=value1&param2=value2]
```

### Supported Parameters

- `apiKey`: API authentication key
- `ssl`: Enable/disable SSL (default: true)
- `timeout`: Request timeout in milliseconds (default: 30000)
- `retryAttempts`: Number of retry attempts (default: 3)
- `pooling`: Enable/disable connection pooling (default: true)
- `minConnections`: Minimum pool connections (default: 1)
- `maxConnections`: Maximum pool connections (default: 10)

### Example DSNs

```typescript
// Basic connection
'workersql://user:pass@api.workersql.com/mydb?apiKey=abc123'

// With pooling configuration
'workersql://api.workersql.com/mydb?apiKey=abc123&maxConnections=20&minConnections=5'

// Local development (no SSL)
'workersql://localhost:8787/test?ssl=false&apiKey=dev-key'
```

## Usage Examples

### Basic Query

```typescript
import { WorkerSQLClient } from '@workersql/node-sdk';

const client = new WorkerSQLClient('workersql://api.workersql.com/mydb?apiKey=your-key');

const result = await client.query('SELECT * FROM users WHERE id = ?', [1]);
console.log(result.data);

await client.close();
```

### Connection Pooling

```typescript
const client = new WorkerSQLClient({
  host: 'api.workersql.com',
  database: 'mydb',
  apiKey: 'your-key',
  pooling: {
    enabled: true,
    minConnections: 2,
    maxConnections: 20,
    idleTimeout: 300000 // 5 minutes
  }
});

// Connections are automatically acquired and released
const users = await client.query('SELECT * FROM users');
const orders = await client.query('SELECT * FROM orders');

// Check pool stats
console.log(client.getPoolStats());
// { total: 2, active: 0, idle: 2, minConnections: 2, maxConnections: 20 }
```

### Transactions with WebSocket

```typescript
await client.transaction(async (txn) => {
  // All queries execute on same shard via WebSocket
  await txn.query('UPDATE accounts SET balance = balance - 100 WHERE id = ?', [1]);
  await txn.query('UPDATE accounts SET balance = balance + 100 WHERE id = ?', [2]);
  // Auto-commits on success, rolls back on error
});
```

### Retry Logic

```typescript
// Automatically retries on transient errors
const client = new WorkerSQLClient({
  host: 'api.workersql.com',
  database: 'mydb',
  apiKey: 'your-key',
  retryAttempts: 5,
  retryDelay: 1000
});

// Will retry up to 5 times with exponential backoff
const result = await client.query('SELECT * FROM users');
```

## Error Handling

```typescript
import { WorkerSQLClient, ValidationError } from '@workersql/node-sdk';

try {
  const result = await client.query('SELECT * FROM users');
} catch (error) {
  if (error instanceof ValidationError) {
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
    console.error('Error details:', error.details);
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

## Configuration

### Via DSN String

```typescript
const client = new WorkerSQLClient('workersql://user:pass@host/db?apiKey=key&pooling=true');
```

### Via Configuration Object

```typescript
const client = new WorkerSQLClient({
  // Connection details
  host: 'api.workersql.com',
  port: 443,
  username: 'myuser',
  password: 'mypass',
  database: 'mydb',
  
  // API configuration
  apiEndpoint: 'https://api.workersql.com/v1',  // Auto-constructed if not provided
  apiKey: 'your-api-key',
  
  // Connection options
  ssl: true,
  timeout: 30000,
  
  // Retry configuration
  retryAttempts: 3,
  retryDelay: 1000,
  
  // Connection pooling
  pooling: {
    enabled: true,
    minConnections: 1,
    maxConnections: 10,
    idleTimeout: 300000
  }
});
```

## Testing

The SDK includes comprehensive tests:
- Unit tests for each component
- Integration tests with mock servers
- Transaction behavior tests
- Retry logic tests
- Connection pool tests

## Dependencies

- `axios`: HTTP client
- `ws`: WebSocket client (for Node.js)

## Type Safety

Full TypeScript support with type definitions:

```typescript
import type {
  QueryResponse,
  BatchQueryResponse,
  HealthCheckResponse,
  ParsedDSN
} from '@workersql/node-sdk';
```

## Best Practices

1. **Always use DSN or config object** - Don't hardcode credentials
2. **Enable connection pooling** - Better performance for multiple queries
3. **Use transactions for related writes** - Ensures consistency
4. **Handle errors gracefully** - Check for ValidationError
5. **Close clients when done** - Release connections and resources
6. **Use prepared statements** - Pass params array for SQL injection prevention
7. **Monitor pool stats** - Use `getPoolStats()` to track connection usage

## Implementation Notes

- Connection pool is thread-safe (uses async/await properly)
- WebSocket connections are created on-demand for transactions
- Retry logic includes jitter to prevent thundering herd
- All timeouts are configurable
- DSN parser is RFC-3986 compliant
- Type exports use `export type` for isolatedModules compatibility

## Future Enhancements

- [ ] Connection health pinging
- [ ] Query result caching
- [ ] Metrics collection
- [ ] Query builder API
- [ ] Migration helpers
- [ ] Schema introspection

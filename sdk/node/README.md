# WorkerSQL Node.js SDK

[![npm version](https://badge.fury.io/js/%40workersql%2Fnode-sdk.svg)](https://www.npmjs.com/package/@workersql/node-sdk)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

A Node.js SDK for WorkerSQL - bringing MySQL-compatible database operations to the edge with Cloudflare Workers.

## Features

- 🚀 **Edge-Native**: Run SQL queries at the edge for ultra-low latency
- 🔒 **Secure**: Built-in SQL injection prevention and schema validation
- 📊 **MySQL Compatible**: Familiar SQL syntax with MySQL compatibility
- 🔄 **Connection Pooling**: Efficient connection management with automatic pooling
- 🔁 **Automatic Retries**: Exponential backoff retry logic for transient failures
- 📡 **WebSocket Transactions**: Sticky sessions for ACID transactions
- 📝 **Type Safe**: Full TypeScript support with type definitions
- 🧪 **Well Tested**: Comprehensive test coverage
- 📚 **Well Documented**: Complete API documentation and examples

## Installation

```bash
npm install @workersql/node-sdk
```

## Quick Start

### Using DSN String

```typescript
import { WorkerSQLClient } from '@workersql/node-sdk';

// Connect using DSN
const client = new WorkerSQLClient('workersql://username:password@api.workersql.com:443/mydb?apiKey=your-key');

// Execute a query
const result = await client.query('SELECT * FROM users WHERE id = ?', [1]);
console.log(result.data);

// Close the connection
await client.close();
```

### Using Configuration Object

```typescript
import { WorkerSQLClient } from '@workersql/node-sdk';

const client = new WorkerSQLClient({
  host: 'api.workersql.com',
  port: 443,
  database: 'mydb',
  username: 'myuser',
  password: 'mypass',
  apiKey: 'your-api-key',
  ssl: true,
  pooling: {
    enabled: true,
    minConnections: 2,
    maxConnections: 10
  }
});

// Execute queries
const users = await client.query('SELECT * FROM users');
console.log(users.data);

await client.close();
```

## DSN Format

The DSN (Data Source Name) follows this format:

```
workersql://[username[:password]@]host[:port][/database][?param1=value1&param2=value2]
```

### DSN Parameters

- `apiKey`: API authentication key
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

```typescript
interface WorkerSQLClientConfig {
  // Connection details
  host: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  
  // API configuration
  apiEndpoint?: string;  // Auto-constructed from host/port if not provided
  apiKey?: string;
  
  // Connection options
  ssl?: boolean;         // Default: true
  timeout?: number;      // Default: 30000ms
  
  // Retry configuration
  retryAttempts?: number;  // Default: 3
  retryDelay?: number;     // Default: 1000ms
  
  // Connection pooling
  pooling?: {
    enabled?: boolean;          // Default: true
    minConnections?: number;    // Default: 1
    maxConnections?: number;    // Default: 10
    idleTimeout?: number;       // Default: 300000ms (5 min)
  };
  
  // Or use DSN string
  dsn?: string;
}
```

## API Reference

### WorkerSQLClient

#### query(sql, params?, options?)

Execute a single SQL query.

```typescript
const result = await client.query(
  'SELECT * FROM users WHERE age > ?',
  [18],
  { timeout: 5000 }
);

console.log(result.data);      // Query results
console.log(result.rowCount);  // Number of rows
console.log(result.cached);    // Whether result was cached
```

#### batchQuery(queries, options?)

Execute multiple queries in batch.

```typescript
const results = await client.batchQuery([
  { sql: 'INSERT INTO users (name, email) VALUES (?, ?)', params: ['John', 'john@example.com'] },
  { sql: 'INSERT INTO users (name, email) VALUES (?, ?)', params: ['Jane', 'jane@example.com'] }
], {
  transaction: true,
  stopOnError: true
});
```

#### transaction(callback)

Execute queries within a transaction using WebSocket sticky sessions.

```typescript
await client.transaction(async (txn) => {
  await txn.query('INSERT INTO accounts (name, balance) VALUES (?, ?)', ['Alice', 1000]);
  await txn.query('INSERT INTO accounts (name, balance) VALUES (?, ?)', ['Bob', 500]);
  // Auto-commits on success, rolls back on error
});
```

#### healthCheck()

Check service health.

```typescript
const health = await client.healthCheck();
console.log(health.status);  // 'healthy' | 'degraded' | 'unhealthy'
```

#### getPoolStats()

Get connection pool statistics.

```typescript
const stats = client.getPoolStats();
console.log(stats.total);    // Total connections
console.log(stats.active);   // Active connections
console.log(stats.idle);     // Idle connections
```

#### close()

Close the client and release all connections.

```typescript
await client.close();
```

## Error Handling

The SDK provides detailed error information through the `ValidationError` class:

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
- `CONNECTION_ERROR`: Network or connection failure
- `TIMEOUT_ERROR`: Operation timed out
- `AUTH_ERROR`: Authentication failed
- `PERMISSION_ERROR`: Insufficient permissions
- `RESOURCE_LIMIT`: Resource limit exceeded
- `INTERNAL_ERROR`: Internal server error

## Connection Pooling

The SDK includes automatic connection pooling for optimal performance:

```typescript
const client = new WorkerSQLClient({
  host: 'api.workersql.com',
  database: 'mydb',
  apiKey: 'your-key',
  pooling: {
    enabled: true,
    minConnections: 2,    // Always maintain 2 connections
    maxConnections: 20,   // Scale up to 20 connections
    idleTimeout: 300000   // Close idle connections after 5 minutes
  }
});

// Connections are automatically acquired and released
const result1 = await client.query('SELECT * FROM users');
const result2 = await client.query('SELECT * FROM orders');

// Check pool status
console.log(client.getPoolStats());
```

## Automatic Retries

The SDK automatically retries failed requests with exponential backoff:

```typescript
const client = new WorkerSQLClient({
  host: 'api.workersql.com',
  database: 'mydb',
  apiKey: 'your-key',
  retryAttempts: 5,    // Retry up to 5 times
  retryDelay: 1000     // Start with 1 second delay
});

// Automatically retries on transient errors:
// - CONNECTION_ERROR
// - TIMEOUT_ERROR
// - RESOURCE_LIMIT
// - Network errors (ECONNREFUSED, ETIMEDOUT, etc.)
```

## WebSocket Transactions

For ACID transactions, the SDK uses WebSocket connections to maintain sticky sessions:

```typescript
// WebSocket transactions are enabled by default
await client.transaction(async (txn) => {
  // All queries in this callback use the same WebSocket connection
  // ensuring they execute on the same shard
  
  const balance = await txn.query('SELECT balance FROM accounts WHERE id = ?', [1]);
  
  if (balance.data[0].balance >= 100) {
    await txn.query('UPDATE accounts SET balance = balance - 100 WHERE id = ?', [1]);
    await txn.query('UPDATE accounts SET balance = balance + 100 WHERE id = ?', [2]);
  }
  
  // Automatically commits on success
  // Automatically rolls back on error
});
```

## Prepared Statements

The SDK uses parameterized queries to prevent SQL injection:

```typescript
// ✅ Safe - uses prepared statements
await client.query(
  'SELECT * FROM users WHERE email = ? AND status = ?',
  ['user@example.com', 'active']
);

// ❌ Unsafe - don't concatenate user input
// await client.query(`SELECT * FROM users WHERE email = '${userEmail}'`);
```

## TypeScript Support

The SDK is written in TypeScript and includes full type definitions:

```typescript
import { 
  WorkerSQLClient, 
  QueryResponse, 
  BatchQueryResponse,
  HealthCheckResponse,
  ValidationError 
} from '@workersql/node-sdk';

const client: WorkerSQLClient = new WorkerSQLClient({
  host: 'api.workersql.com',
  database: 'mydb',
  apiKey: 'your-key'
});

const result: QueryResponse = await client.query('SELECT * FROM users');
const health: HealthCheckResponse = await client.healthCheck();
```

## Examples

### Basic CRUD Operations

```typescript
// Create
const insert = await client.query(
  'INSERT INTO users (name, email) VALUES (?, ?)',
  ['John Doe', 'john@example.com']
);
console.log('Inserted ID:', insert.data);

// Read
const users = await client.query('SELECT * FROM users WHERE id = ?', [1]);
console.log('User:', users.data[0]);

// Update
await client.query('UPDATE users SET email = ? WHERE id = ?', ['newemail@example.com', 1]);

// Delete
await client.query('DELETE FROM users WHERE id = ?', [1]);
```

### Batch Operations

```typescript
const queries = [
  { sql: 'INSERT INTO logs (message) VALUES (?)', params: ['Log 1'] },
  { sql: 'INSERT INTO logs (message) VALUES (?)', params: ['Log 2'] },
  { sql: 'INSERT INTO logs (message) VALUES (?)', params: ['Log 3'] }
];

const results = await client.batchQuery(queries, {
  transaction: false,
  stopOnError: false
});

console.log(`${results.results.filter(r => r.success).length} queries succeeded`);
```

### Transaction with Error Handling

```typescript
try {
  await client.transaction(async (txn) => {
    await txn.query('UPDATE accounts SET balance = balance - 100 WHERE id = ?', [1]);
    
    // Simulate an error
    const balance = await txn.query('SELECT balance FROM accounts WHERE id = ?', [1]);
    if (balance.data[0].balance < 0) {
      throw new Error('Insufficient funds');
    }
    
    await txn.query('UPDATE accounts SET balance = balance + 100 WHERE id = ?', [2]);
  });
  
  console.log('Transaction committed');
} catch (error) {
  console.error('Transaction rolled back:', error);
}
```

## Development

```bash
# Install dependencies
npm install

# Build the SDK
npm run build

# Run tests
npm test

# Run linter
npm run lint

# Format code
npm run format
```

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

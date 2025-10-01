# SDK Integration Architecture

## Overview

WorkerSQL provides production-ready client SDKs for Node.js, Python, and PHP that offer MySQL-compatible interfaces for edge database operations. These SDKs provide drop-in replacement capabilities for existing MySQL drivers while adding edge-specific features like connection pooling, automatic retries, and WebSocket-based transactions.

## Design Principles

### 1. MySQL Compatibility

All SDKs maintain API compatibility with standard MySQL clients:
- **Node.js**: Compatible with `mysql2/promise` API patterns
- **Python**: Compatible with `mysql-connector-python` patterns
- **PHP**: Compatible with PDO and MySQLi interfaces

### 2. Edge-Aware Architecture

- Connection pooling optimized for edge latency patterns
- Automatic retry logic with exponential backoff
- WebSocket sticky sessions for ACID transactions
- Smart routing based on DSN parameters

### 3. Zero-Config Experience

- DSN-based connection strings (`workersql://`)
- Sensible defaults for all parameters
- Auto-construction of API endpoints from host/port
- Optional explicit configuration for advanced use cases

## Common Features Across SDKs

### DSN Parsing

All SDKs support standardized connection strings:

```
workersql://[username[:password]@]host[:port][/database][?param1=value1&param2=value2]
```

**Parameters:**
- `apiKey`: API authentication key
- `ssl`: Enable/disable SSL (default: true)
- `timeout`: Request timeout in milliseconds (default: 30000)
- `retryAttempts`: Number of retry attempts (default: 3)
- `pooling`: Enable/disable connection pooling (default: true)
- `minConnections`: Minimum pool connections (default: 1)
- `maxConnections`: Maximum pool connections (default: 10)

### Connection Pooling

Efficient connection management with:
- Configurable min/max connections
- Idle timeout for unused connections
- Automatic health checking
- Thread/concurrency safe implementation
- Connection reuse for better performance

### Automatic Retry Logic

Intelligent retry mechanism:
- Exponential backoff with jitter
- Retryable error detection (CONNECTION_ERROR, TIMEOUT_ERROR, RESOURCE_LIMIT)
- Configurable max attempts and delays
- Context-aware error messages
- Non-retryable errors fail immediately

### Error Handling

Consistent error model across all SDKs:

**Error Codes:**
- `INVALID_QUERY`: SQL syntax or validation error
- `CONNECTION_ERROR`: Network or connection failure
- `TIMEOUT_ERROR`: Operation timed out
- `AUTH_ERROR`: Authentication failed
- `PERMISSION_ERROR`: Insufficient permissions
- `RESOURCE_LIMIT`: Resource limit exceeded
- `INTERNAL_ERROR`: Internal server error

### Prepared Statements

SQL injection prevention through parameterized queries:
- Positional parameters (?)
- Type-safe parameter binding
- Automatic escaping
- Validation before execution

## SDK-Specific Features

### Node.js SDK (@workersql/node-sdk)

**Unique Features:**
- Full TypeScript support with type definitions
- WebSocket transaction client for sticky sessions
- Axios-based HTTP client with interceptors
- Promise-based async API
- ES modules support

**Installation:**
```bash
npm install @workersql/node-sdk
```

**Basic Usage:**
```typescript
import { WorkerSQLClient } from '@workersql/node-sdk';

const client = new WorkerSQLClient('workersql://api.workersql.com/mydb?apiKey=key');
const result = await client.query('SELECT * FROM users WHERE id = ?', [1]);
await client.close();
```

**Transaction Support:**
```typescript
await client.transaction(async (txn) => {
  await txn.query('UPDATE accounts SET balance = balance - 100 WHERE id = ?', [1]);
  await txn.query('UPDATE accounts SET balance = balance + 100 WHERE id = ?', [2]);
});
```

### Python SDK (workersql-python-sdk)

**Unique Features:**
- Type hints with Pydantic validation
- Context manager support (`with` statement)
- Thread-safe connection pooling
- Requests-based HTTP client
- Dataclass-based response models

**Installation:**
```bash
pip install workersql-python-sdk
```

**Basic Usage:**
```python
from workersql_client import WorkerSQLClient

with WorkerSQLClient(dsn='workersql://api.workersql.com/mydb?apiKey=key') as client:
    result = client.query("SELECT * FROM users WHERE id = ?", [1])
    print(result.data)
```

**Connection Pooling:**
```python
client = WorkerSQLClient(config={
    "host": "api.workersql.com",
    "database": "mydb",
    "api_key": "your-key",
    "pooling": {
        "enabled": True,
        "min_connections": 2,
        "max_connections": 20
    }
})

# Connections automatically managed
stats = client.get_pool_stats()
print(f"Active: {stats['active']}, Idle: {stats['idle']}")
```

### PHP SDK (workersql-php)

**Note:** PHP SDK implementation is planned but not yet complete.

**Planned Features:**
- PDO-compatible interface
- MySQLi-compatible interface
- Composer package
- PSR-4 autoloading
- PHP 7.4+ support

**Planned Installation:**
```bash
composer require workersql/php-sdk
```

**Planned Usage:**
```php
use WorkerSQL\Client;

$client = new Client('workersql://api.workersql.com/mydb?apiKey=key');
$result = $client->query('SELECT * FROM users WHERE id = ?', [1]);
$client->close();
```

## Integration Patterns

### Drop-in Replacement

**Node.js (replacing mysql2):**
```typescript
// Before
import mysql from 'mysql2/promise';
const pool = mysql.createPool('mysql://user:pass@host/db');

// After
import { WorkerSQLClient } from '@workersql/node-sdk';
const pool = new WorkerSQLClient('workersql://user:pass@host/db?apiKey=key');
```

**Python (replacing mysql-connector):**
```python
# Before
import mysql.connector
conn = mysql.connector.connect(host='host', database='db', user='user', password='pass')

# After  
from workersql_client import WorkerSQLClient
conn = WorkerSQLClient(dsn='workersql://user:pass@host/db?apiKey=key')
```

### Framework Integration

**Express.js (Node.js):**
```typescript
import express from 'express';
import { WorkerSQLClient } from '@workersql/node-sdk';

const app = express();
const db = new WorkerSQLClient(process.env.DATABASE_DSN!);

app.get('/users/:id', async (req, res) => {
  const result = await db.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
  res.json(result.data[0]);
});
```

**Flask (Python):**
```python
from flask import Flask, jsonify
from workersql_client import WorkerSQLClient
import os

app = Flask(__name__)
db = WorkerSQLClient(dsn=os.environ['DATABASE_DSN'])

@app.route('/users/<int:user_id>')
def get_user(user_id):
    result = db.query("SELECT * FROM users WHERE id = ?", [user_id])
    return jsonify(result.data[0])
```

## Performance Considerations

### Connection Pooling Benefits

- **Reduced Latency**: Reuse existing connections instead of creating new ones
- **Better Throughput**: Handle more concurrent requests
- **Resource Efficiency**: Limit total connections to the service
- **Automatic Management**: Idle timeout and health checking

### Retry Strategy Tuning

```typescript
// High-availability configuration
const client = new WorkerSQLClient({
  host: 'api.workersql.com',
  database: 'mydb',
  apiKey: 'your-key',
  retryAttempts: 5,        // More attempts
  retryDelay: 500,         // Faster initial retry
  timeout: 60000,          // Longer timeout
  pooling: {
    maxConnections: 50     // More connections
  }
});
```

### Transaction Optimization

Use WebSocket transactions for:
- Multi-statement ACID operations
- Operations requiring shard affinity
- Complex business logic needing consistency

Avoid WebSocket transactions for:
- Single read queries
- Independent write operations
- High-volume read operations

## Security Best Practices

### 1. API Key Management

```typescript
// ✅ Good - use environment variables
const client = new WorkerSQLClient(process.env.DATABASE_DSN!);

// ❌ Bad - hardcoded credentials
const client = new WorkerSQLClient('workersql://host/db?apiKey=secret123');
```

### 2. SQL Injection Prevention

```typescript
// ✅ Good - parameterized query
await client.query('SELECT * FROM users WHERE email = ?', [userEmail]);

// ❌ Bad - string concatenation
await client.query(`SELECT * FROM users WHERE email = '${userEmail}'`);
```

### 3. Connection String Protection

- Store DSN in environment variables
- Use secrets management systems
- Rotate API keys regularly
- Use least-privilege API keys

## Monitoring and Observability

### Pool Statistics

```typescript
const stats = client.getPoolStats();
console.log({
  total: stats.total,
  active: stats.active,
  idle: stats.idle
});

// Alert if pool is saturated
if (stats.active >= stats.maxConnections * 0.9) {
  console.warn('Connection pool approaching capacity');
}
```

### Error Tracking

```typescript
import { ValidationError } from '@workersql/node-sdk';

try {
  const result = await client.query('SELECT * FROM users');
} catch (error) {
  if (error instanceof ValidationError) {
    // Log structured error data
    logger.error('Query failed', {
      code: error.code,
      message: error.message,
      details: error.details
    });
  }
}
```

### Performance Metrics

Track key metrics:
- Query execution time
- Connection pool utilization
- Retry attempt counts
- Error rates by code
- Cache hit rates

## Testing Strategies

### Unit Testing

```typescript
import { WorkerSQLClient } from '@workersql/node-sdk';
import { describe, it, expect } from 'vitest';

describe('Database queries', () => {
  it('should fetch user by ID', async () => {
    const client = new WorkerSQLClient(process.env.TEST_DATABASE_DSN!);
    const result = await client.query('SELECT * FROM users WHERE id = ?', [1]);
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    await client.close();
  });
});
```

### Integration Testing

Use test databases:
```
workersql://localhost:8787/test?ssl=false&apiKey=test-key
```

Mock HTTP responses for unit tests:
```typescript
import nock from 'nock';

nock('https://api.workersql.com')
  .post('/v1/query')
  .reply(200, {
    success: true,
    data: [{ id: 1, name: 'Test User' }]
  });
```

## Migration Guide

### From MySQL

1. **Update connection strings:**
   ```
   mysql://user:pass@host/db
   →
   workersql://user:pass@host/db?apiKey=key
   ```

2. **Update client initialization:**
   Replace MySQL client with WorkerSQL client

3. **Test query compatibility:**
   Most MySQL queries work as-is

4. **Handle edge cases:**
   - Check for unsupported MySQL features
   - Adjust transaction patterns if needed
   - Update error handling

### From Other Cloud Databases

Similar process:
1. Update connection configuration
2. Replace client library
3. Test query compatibility
4. Adjust for any API differences

## Troubleshooting

### Connection Issues

```typescript
// Enable debug logging
process.env.LOG_LEVEL = 'debug';

// Check connection
const health = await client.healthCheck();
console.log('Health:', health.status);

// Verify DSN
import { DSNParser } from '@workersql/node-sdk';
const parsed = DSNParser.parse(process.env.DATABASE_DSN!);
console.log('Parsed DSN:', parsed);
```

### Pool Exhaustion

```typescript
// Increase max connections
const client = new WorkerSQLClient({
  host: 'api.workersql.com',
  database: 'mydb',
  apiKey: 'key',
  pooling: {
    maxConnections: 50  // Increase from default 10
  }
});

// Or disable pooling temporarily
const client = new WorkerSQLClient({
  host: 'api.workersql.com',
  database: 'mydb',
  apiKey: 'key',
  pooling: { enabled: false }
});
```

### Retry Failures

```typescript
// Adjust retry settings
const client = new WorkerSQLClient({
  host: 'api.workersql.com',
  database: 'mydb',
  apiKey: 'key',
  retryAttempts: 5,
  retryDelay: 2000
});
```

## Future Enhancements

- [ ] Query builder API
- [ ] Schema migration tools
- [ ] ORM integration (TypeORM, Prisma, SQLAlchemy)
- [ ] Query result caching
- [ ] Distributed tracing support
- [ ] Metrics collection
- [ ] Connection health pinging
- [ ] Read replica support
- [ ] Batch operation optimization

## References

- [Node.js SDK Documentation](../../sdk/node/README.md)
- [Python SDK Documentation](../../sdk/python/README.md)
- [API Specification](../api-specification.md)
- [SQL Compatibility Layer](./008-sql-compatibility-layer.md)
- [Connection Management](./009-connection-management.md)

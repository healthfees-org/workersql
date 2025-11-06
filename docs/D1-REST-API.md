# D1 REST API Integration

This document describes the implementation of D1 database management using Cloudflare's REST API instead of the Workers binding API.

## Overview

The `D1Service` provides a comprehensive interface to Cloudflare D1 databases using the official REST API endpoints documented at https://developers.cloudflare.com/api/resources/d1/.

## Why REST API Instead of Workers Binding?

The D1 Workers Binding API (e.g., `env.PORTABLE_DB.prepare().bind().run()`) is designed for runtime data plane operations within Workers. However, for control plane operations and programmatic database management, the REST API provides:

1. **Management Operations**: Create, list, and delete databases programmatically
2. **Cross-Environment Access**: Manage databases from any environment with API credentials
3. **Audit and Control**: Better tracking and control over database operations
4. **Flexibility**: Access from any runtime, not just Workers
5. **Batch Operations**: Efficient bulk operations via REST API

## Architecture

### D1Service Class

Location: `src/services/D1Service.ts`

The service extends `BaseService` and provides:
- Database CRUD operations
- SQL query execution via REST API
- Batch query support
- Shard-to-D1 synchronization
- Retry logic with exponential backoff
- Comprehensive error handling

### Key Methods

#### Database Management

```typescript
// List all databases in account
await d1Service.listDatabases(): Promise<D1Database[]>

// Create a new database
await d1Service.createDatabase(name: string, location?: string): Promise<D1Database>

// Get database information
await d1Service.getDatabaseInfo(databaseId: string): Promise<D1Database>

// Delete a database
await d1Service.deleteDatabase(databaseId: string): Promise<void>

// Ensure database exists (create if needed)
await d1Service.ensureDatabase(name: string): Promise<D1Database>
```

#### Query Operations

```typescript
// Execute single query
await d1Service.query(
  databaseId: string,
  sql: string,
  params?: unknown[]
): Promise<D1QueryResult>

// Execute batch queries
await d1Service.batch(
  databaseId: string,
  queries: Array<{ sql: string; params?: unknown[] }>
): Promise<D1QueryResult[]>

// Sync shard operations to D1
await d1Service.syncShardToD1(
  databaseId: string,
  shardId: string,
  operations: Array<{ sql: string; params?: unknown[] }>
): Promise<void>
```

## Configuration

### Environment Variables

Required environment variables for D1 REST API access:

```bash
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_API_TOKEN=your_api_token
PORTABLE_DB_ID=your_d1_database_id
```

### wrangler.toml Configuration

```toml
[vars]
# D1 REST API Configuration
CLOUDFLARE_ACCOUNT_ID = "your_account_id_here"
CLOUDFLARE_API_TOKEN = "your_api_token_here"
PORTABLE_DB_ID = "your_d1_database_id_here"

# D1 binding (for reference, but operations use REST API)
[[d1_databases]]
binding = "PORTABLE_DB"
database_name = "portable-mirror"
database_id = "your_d1_database_id_here"
```

### Getting API Credentials

1. **Account ID**: Found in Cloudflare Dashboard → Workers & Pages → Account Details
2. **API Token**: Create at https://dash.cloudflare.com/profile/api-tokens
   - Required permissions: Account.D1 = Edit
3. **Database ID**: Get from `wrangler d1 list` or Dashboard → D1

## Integration with QueueEventSystem

The `QueueEventSystem` has been updated to use `D1Service` for the `d1_sync` event handler:

```typescript
// D1 sync handler - uses REST API
this.registerHandler('d1_sync', async (event: DatabaseEvent) => {
  const d1Service = new D1Service(this.env);
  const databaseId = envVars['PORTABLE_DB_ID'] || '';
  
  const operations = event.payload ? 
    JSON.parse(event.payload).operations : 
    undefined;

  if (operations && operations.length > 0) {
    await d1Service.syncShardToD1(databaseId, event.shardId, operations);
  }
});
```

### Event Payload Structure

```typescript
{
  type: 'd1_sync',
  shardId: 'shard-1',
  version: 1234567890,
  timestamp: 1234567890,
  payload: JSON.stringify({
    operations: [
      { sql: 'INSERT INTO table (col) VALUES (?)', params: ['value'] },
      { sql: 'UPDATE table SET col = ? WHERE id = ?', params: ['value', 1] }
    ]
  })
}
```

## Usage Examples

### Creating a Database

```typescript
const d1Service = new D1Service(env);

// Create with auto location
const db = await d1Service.createDatabase('my-database');

// Create with specific location
const db = await d1Service.createDatabase('my-database', 'weur');
console.log(`Created database: ${db.uuid}`);
```

### Executing Queries

```typescript
const d1Service = new D1Service(env);

// Simple SELECT
const result = await d1Service.query(
  'database-id',
  'SELECT * FROM users WHERE active = ?',
  [true]
);
console.log(`Found ${result.results.length} users`);

// INSERT with auto-increment
const insertResult = await d1Service.query(
  'database-id',
  'INSERT INTO users (name, email) VALUES (?, ?)',
  ['John Doe', 'john@example.com']
);
console.log(`Inserted row ID: ${insertResult.meta.last_row_id}`);
```

### Batch Operations

```typescript
const d1Service = new D1Service(env);

const operations = [
  { sql: 'INSERT INTO logs (message) VALUES (?)', params: ['Log 1'] },
  { sql: 'INSERT INTO logs (message) VALUES (?)', params: ['Log 2'] },
  { sql: 'INSERT INTO logs (message) VALUES (?)', params: ['Log 3'] },
];

const results = await d1Service.batch('database-id', operations);

const totalInserted = results.reduce((sum, r) => sum + r.meta.rows_written, 0);
console.log(`Inserted ${totalInserted} rows`);
```

### Shard Synchronization

```typescript
const d1Service = new D1Service(env);

// Operations from a Durable Object shard
const shardOperations = [
  { sql: 'INSERT INTO events (type, data) VALUES (?, ?)', params: ['mutation', 'data1'] },
  { sql: 'INSERT INTO events (type, data) VALUES (?, ?)', params: ['mutation', 'data2'] },
];

await d1Service.syncShardToD1(
  'database-id',
  'shard-1',
  shardOperations
);
```

## Testing

### Unit Tests

Location: `tests/services/D1Service.test.ts`

Coverage:
- ✅ List databases
- ✅ Create database (with and without location)
- ✅ Get database info
- ✅ Delete database
- ✅ Query execution
- ✅ Batch operations
- ✅ Sync operations
- ✅ Ensure database
- ✅ Configuration validation
- ✅ Error handling

### Integration Tests

Location: `tests/services/D1Service.integration.test.ts`

Coverage:
- ✅ QueueEventSystem integration
- ✅ D1 sync event handling
- ✅ Batch efficiency
- ✅ Error scenarios

### Running Tests

```bash
# Run all tests
npm test

# Run D1Service tests only
npm test -- D1Service

# Run with coverage
npm run test:coverage
```

## Best Practices

### 1. Use Batch Operations

For multiple operations, use `batch()` instead of individual `query()` calls:

```typescript
// ❌ Inefficient
for (const item of items) {
  await d1Service.query(dbId, 'INSERT INTO table VALUES (?)', [item]);
}

// ✅ Efficient
await d1Service.batch(dbId, items.map(item => ({
  sql: 'INSERT INTO table VALUES (?)',
  params: [item]
})));
```

### 2. Handle Errors Gracefully

```typescript
try {
  await d1Service.query(dbId, sql, params);
} catch (error) {
  if (error instanceof EdgeSQLError) {
    console.error(`D1 Error: ${error.code} - ${error.message}`);
  }
  // Implement fallback or retry logic
}
```

### 3. Use Parameters for SQL Injection Prevention

```typescript
// ❌ SQL Injection Risk
await d1Service.query(dbId, `SELECT * FROM users WHERE id = ${userId}`);

// ✅ Safe with parameters
await d1Service.query(dbId, 'SELECT * FROM users WHERE id = ?', [userId]);
```

### 4. Monitor Query Performance

```typescript
const result = await d1Service.query(dbId, sql, params);
console.log(`Query executed in ${result.meta.duration}ms`);
console.log(`Rows read: ${result.meta.rows_read}`);
console.log(`Rows written: ${result.meta.rows_written}`);
```

## REST API Endpoints Used

All endpoints are at: `https://api.cloudflare.com/client/v4`

- `GET /accounts/{account_id}/d1/database` - List databases
- `POST /accounts/{account_id}/d1/database` - Create database
- `GET /accounts/{account_id}/d1/database/{database_id}` - Get database info
- `DELETE /accounts/{account_id}/d1/database/{database_id}` - Delete database
- `POST /accounts/{account_id}/d1/database/{database_id}/query` - Execute query/batch

## Security Considerations

### API Token Storage

1. **Never commit tokens to repository**
   - Use `.env` files (gitignored)
   - Use Wrangler secrets: `wrangler secret put CLOUDFLARE_API_TOKEN`
   - Use Workers Secrets in production

2. **Principle of Least Privilege**
   - Create tokens with minimal required permissions
   - Use separate tokens for different environments
   - Rotate tokens regularly

3. **Token Scoping**
   - Scope tokens to specific accounts
   - Limit to D1 operations only
   - Set expiration dates when possible

### Network Security

The service implements:
- HTTPS for all API calls
- Retry logic with exponential backoff
- Timeout handling
- Error sanitization (no token leaks in logs)

## Performance Considerations

### Batch Size

- REST API supports batching multiple queries
- Optimal batch size: 50-100 queries
- Larger batches may hit timeout limits

### Caching

- D1Service doesn't implement caching (handled by CacheService)
- Use CacheService for frequently accessed data
- D1 should be used for source of truth and analytics

### Rate Limits

Cloudflare API has rate limits:
- Enterprise: 1200 requests/5 minutes
- Others: Varies by plan

D1Service implements retry logic to handle rate limits gracefully.

## Migration Notes

### From Workers Binding to REST API

**Before (Workers Binding):**
```typescript
const result = await env.PORTABLE_DB
  .prepare('SELECT * FROM users WHERE id = ?')
  .bind(userId)
  .run();
```

**After (REST API via D1Service):**
```typescript
const d1Service = new D1Service(env);
const result = await d1Service.query(
  env.PORTABLE_DB_ID,
  'SELECT * FROM users WHERE id = ?',
  [userId]
);
```

### When to Use Each Approach

**Use Workers Binding (`env.PORTABLE_DB`) when:**
- Running queries within a Worker request handler
- Need sub-millisecond latency
- Simple, single-query operations

**Use REST API (`D1Service`) when:**
- Managing databases (create, delete, list)
- Batch operations
- Syncing data between systems
- Control plane operations
- Need detailed metadata and statistics

## Troubleshooting

### Common Issues

1. **Missing API Token**
   ```
   Error: CLOUDFLARE_API_TOKEN environment variable is required
   ```
   Solution: Set the `CLOUDFLARE_API_TOKEN` environment variable

2. **Invalid Database ID**
   ```
   Error: Failed to execute D1 query: Database not found
   ```
   Solution: Verify `PORTABLE_DB_ID` matches your D1 database ID

3. **Permission Denied**
   ```
   Error: Failed to list D1 databases: Not authorized
   ```
   Solution: Ensure API token has D1 Edit permissions

4. **Rate Limit Exceeded**
   ```
   Error: Rate limit exceeded
   ```
   Solution: Implement exponential backoff (already built into D1Service)

## References

- [Cloudflare D1 REST API Documentation](https://developers.cloudflare.com/api/resources/d1/)
- [Cloudflare D1 Best Practices](https://developers.cloudflare.com/d1/best-practices/)
- [Cloudflare API Authentication](https://developers.cloudflare.com/fundamentals/api/get-started/)
- [Cloudflare D1 Query API](https://developers.cloudflare.com/d1/best-practices/query-d1/)

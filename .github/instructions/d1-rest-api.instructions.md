---
applyTo: 'src/services/**'
---

# D1 Database Management via REST API

## Objective
All D1 database operations must use the Cloudflare REST API (https://developers.cloudflare.com/api/resources/d1/) instead of direct Workers binding API calls.

## Key Points

### D1Service Implementation
- Location: `src/services/D1Service.ts`
- Extends `BaseService` for consistency
- Implements full CRUD operations for D1 databases
- Uses official Cloudflare REST API endpoints
- Includes retry logic with exponential backoff
- Comprehensive error handling with `EdgeSQLError`

### REST API Operations

#### Database Management (Control Plane)
- **Create**: `POST /accounts/{account_id}/d1/database`
- **List**: `GET /accounts/{account_id}/d1/database`
- **Info**: `GET /accounts/{account_id}/d1/database/{database_id}`
- **Delete**: `DELETE /accounts/{account_id}/d1/database/{database_id}`

#### Query Operations (Data Plane)
- **Query**: `POST /accounts/{account_id}/d1/database/{database_id}/query`
- **Batch**: Same endpoint with array of queries

### Configuration Requirements

Required environment variables in `wrangler.toml`:
```toml
[vars]
CLOUDFLARE_ACCOUNT_ID = "your_account_id"
CLOUDFLARE_API_TOKEN = "your_api_token"
PORTABLE_DB_ID = "your_d1_database_id"
```

### Integration Points

1. **QueueEventSystem** (`src/services/QueueEventSystem.ts`)
   - `d1_sync` event handler uses `D1Service.syncShardToD1()`
   - Receives operations from shards via queue events
   - Batches operations for efficiency

2. **TableShard** (potential future integration)
   - Can emit `d1_sync` events with operation payloads
   - Operations include SQL and parameters

### Usage Pattern

```typescript
// Initialize service
const d1Service = new D1Service(env);

// Create/ensure database
const db = await d1Service.ensureDatabase('database-name');

// Execute queries
const result = await d1Service.query(db.uuid, 'SELECT * FROM table', []);

// Batch operations
await d1Service.batch(db.uuid, [
  { sql: 'INSERT INTO table VALUES (?)', params: [value1] },
  { sql: 'INSERT INTO table VALUES (?)', params: [value2] },
]);

// Sync from shard
await d1Service.syncShardToD1(db.uuid, 'shard-1', operations);
```

### Best Practices

1. **Always use parameters** for SQL injection prevention
   ```typescript
   // ✅ Correct
   await d1Service.query(dbId, 'SELECT * FROM users WHERE id = ?', [userId]);
   
   // ❌ Wrong
   await d1Service.query(dbId, `SELECT * FROM users WHERE id = ${userId}`);
   ```

2. **Batch operations** when possible
   ```typescript
   // ✅ Efficient
   await d1Service.batch(dbId, operations);
   
   // ❌ Inefficient
   for (const op of operations) {
     await d1Service.query(dbId, op.sql, op.params);
   }
   ```

3. **Handle errors** gracefully
   ```typescript
   try {
     await d1Service.query(dbId, sql, params);
   } catch (error) {
     if (error instanceof EdgeSQLError) {
       // Handle specific error codes
     }
   }
   ```

4. **Monitor performance** using metadata
   ```typescript
   const result = await d1Service.query(dbId, sql, params);
   console.log('Duration:', result.meta.duration);
   console.log('Rows read:', result.meta.rows_read);
   console.log('Rows written:', result.meta.rows_written);
   ```

### When NOT to Use D1Service

Do NOT use `D1Service` for:
- Real-time query operations within Worker request handlers (use Workers Binding API)
- Operations requiring sub-millisecond latency
- Simple single queries that don't need management features

The Workers Binding API (`env.PORTABLE_DB`) should be used for runtime data plane operations where low latency is critical.

### Testing

All D1Service operations must have:
- Unit tests mocking fetch API
- Integration tests with QueueEventSystem
- Error handling test cases
- Configuration validation tests

See:
- `tests/services/D1Service.test.ts`
- `tests/services/D1Service.integration.test.ts`

### Security

1. **API Token Management**
   - Never commit tokens to repository
   - Use Wrangler secrets in production
   - Rotate tokens regularly
   - Scope tokens to D1 operations only

2. **Error Handling**
   - Sanitize error messages (no token leaks)
   - Use structured logging
   - Implement retry logic for transient failures

3. **Validation**
   - Validate all inputs before API calls
   - Check configuration on service initialization
   - Use TypeScript types for compile-time safety

### Monitoring

Log key operations:
- Database creation/deletion
- Query execution time
- Batch operation counts
- Sync operation status
- API errors and retries

### Future Enhancements

Planned improvements:
- [ ] Connection pooling for REST API calls
- [ ] Query result caching
- [ ] Metrics collection and dashboards
- [ ] Schema migration support
- [ ] Backup and restore via REST API

### Documentation

See comprehensive guide: `docs/D1-REST-API.md`

### Alignment with Cloudflare Patterns

This implementation follows Cloudflare best practices:
- Uses official REST API endpoints
- Implements retry logic with exponential backoff
- Leverages Workers environment for configuration
- Integrates with Cloudflare Queues for async operations
- Uses proper TypeScript types from @cloudflare/workers-types
- Follows Workers runtime constraints and patterns

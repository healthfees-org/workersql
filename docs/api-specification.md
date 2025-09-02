# WorkerSQL API Specification

## Overview

WorkerSQL provides a MySQL-compatible HTTP API for edge database operations.
This specification defines the RESTful API endpoints, request/response formats,
authentication, and error handling.

**Base URL**: `https://api.workersql.com` **API Version**: `v1` **Protocol**:
HTTPS only **Authentication**: JWT Bearer tokens

## Authentication

### Bearer Token Authentication

All API requests require a valid JWT bearer token in the Authorization header:

```http
Authorization: Bearer <jwt_token>
```

### Token Structure

```json
{
  "iss": "workersql.com",
  "sub": "tenant_id",
  "aud": "workersql-api",
  "exp": 1693526400,
  "iat": 1693440000,
  "permissions": ["read", "write", "ddl"],
  "tenant_id": "tenant_12345",
  "user_id": "user_67890"
}
```

### Token Endpoints

#### Obtain Access Token

```http
POST /auth/token
Content-Type: application/json

{
  "client_id": "string",
  "client_secret": "string",
  "grant_type": "client_credentials",
  "scope": "read write ddl"
}
```

**Response:**

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "read write ddl"
}
```

## Core API Endpoints

### Query Execution

#### Execute SQL Query

Execute a SQL query against the edge database.

```http
POST /v1/query
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**

```json
{
  "sql": "SELECT * FROM users WHERE active = ?",
  "params": [true],
  "hints": {
    "consistency": "strong|bounded|cached",
    "boundedMs": 5000,
    "shardKey": "tenant_12345",
    "cacheTtl": 300000
  },
  "transactionId": "txn_abc123"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "rows": [
      {
        "id": 1,
        "name": "John Doe",
        "email": "john@example.com",
        "active": true,
        "created_at": "2025-09-01T10:00:00Z"
      }
    ],
    "rowsAffected": 1,
    "insertId": null,
    "metadata": {
      "fromCache": false,
      "shardId": "shard_0",
      "executionTimeMs": 15,
      "version": 12345
    }
  },
  "cached": false,
  "executionTime": 15
}
```

#### Batch Query Execution

Execute multiple SQL queries in a single request.

```http
POST /v1/query/batch
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**

```json
{
  "queries": [
    {
      "id": "query1",
      "sql": "SELECT COUNT(*) FROM users",
      "params": []
    },
    {
      "id": "query2",
      "sql": "SELECT * FROM orders WHERE user_id = ?",
      "params": [123]
    }
  ],
  "transactionId": "txn_abc123"
}
```

### Transaction Management

#### Begin Transaction

```http
POST /v1/transactions
Authorization: Bearer <token>
Content-Type: application/json

{
  "isolationLevel": "READ_COMMITTED"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "transactionId": "txn_abc123",
    "isolationLevel": "READ_COMMITTED",
    "startTime": "2025-09-01T10:00:00Z"
  }
}
```

#### Commit Transaction

```http
POST /v1/transactions/{transactionId}/commit
Authorization: Bearer <token>
```

#### Rollback Transaction

```http
POST /v1/transactions/{transactionId}/rollback
Authorization: Bearer <token>
```

### Schema Management

#### Get Database Schema

```http
GET /v1/schema
Authorization: Bearer <token>
```

#### Create Table

```http
POST /v1/schema/tables
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "products",
  "columns": [
    {
      "name": "id",
      "type": "INT",
      "primaryKey": true,
      "autoIncrement": true
    },
    {
      "name": "name",
      "type": "VARCHAR(255)",
      "nullable": false
    },
    {
      "name": "price",
      "type": "DECIMAL(10,2)",
      "nullable": false
    }
  ],
  "indexes": [
    {
      "name": "idx_name",
      "columns": ["name"],
      "unique": false
    }
  ]
}
```

### Cache Management

#### Clear Cache

```http
DELETE /v1/cache
Authorization: Bearer <token>
```

#### Clear Table Cache

```http
DELETE /v1/cache/tables/{tableName}
Authorization: Bearer <token>
```

#### Get Cache Statistics

```http
GET /v1/cache/stats
Authorization: Bearer <token>
```

### Health and Monitoring

#### Health Check

```http
GET /v1/health
```

**Response:**

```json
{
  "status": "healthy",
  "timestamp": "2025-09-01T10:00:00Z",
  "version": "1.0.0",
  "shards": {
    "total": 4,
    "healthy": 4,
    "degraded": 0,
    "failed": 0
  }
}
```

#### Metrics

```http
GET /v1/metrics
Authorization: Bearer <token>
```

**Response:**

```json
{
  "queries": {
    "total": 1000000,
    "success": 999500,
    "errors": 500,
    "avgLatencyMs": 12.5
  },
  "cache": {
    "hits": 750000,
    "misses": 250000,
    "hitRate": 0.75
  },
  "shards": [
    {
      "id": "shard_0",
      "status": "healthy",
      "connections": 45,
      "sizeBytes": 1073741824
    }
  ]
}
```

## Error Handling

### Error Response Format

```json
{
  "success": false,
  "error": {
    "code": "INVALID_SQL",
    "message": "Syntax error in SQL statement",
    "details": "Unexpected token 'FORM' at line 1, column 14",
    "timestamp": "2025-09-01T10:00:00Z",
    "requestId": "req_12345",
    "sqlState": "42000"
  }
}
```

### Error Codes

| Code                      | HTTP Status | Description                       |
| ------------------------- | ----------- | --------------------------------- |
| `INVALID_SQL`             | 400         | SQL syntax error                  |
| `UNAUTHORIZED`            | 401         | Invalid or missing authentication |
| `FORBIDDEN`               | 403         | Insufficient permissions          |
| `TABLE_NOT_FOUND`         | 404         | Referenced table does not exist   |
| `CONSTRAINT_VIOLATION`    | 409         | Database constraint violated      |
| `SHARD_CAPACITY_EXCEEDED` | 413         | Shard storage limit reached       |
| `RATE_LIMITED`            | 429         | Request rate limit exceeded       |
| `INTERNAL_ERROR`          | 500         | Unexpected server error           |
| `SERVICE_UNAVAILABLE`     | 503         | Service temporarily unavailable   |

## Rate Limiting

### Rate Limit Headers

```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1693526400
X-RateLimit-Retry-After: 60
```

### Rate Limit Tiers

- **Free Tier**: 1,000 requests/hour
- **Pro Tier**: 100,000 requests/hour
- **Enterprise**: Custom limits

## Data Types

### Supported MySQL Types

- **Numeric**: `TINYINT`, `SMALLINT`, `MEDIUMINT`, `INT`, `BIGINT`, `DECIMAL`,
  `FLOAT`, `DOUBLE`
- **String**: `CHAR`, `VARCHAR`, `BINARY`, `VARBINARY`, `BLOB`, `TEXT`
- **Date/Time**: `DATE`, `TIME`, `DATETIME`, `TIMESTAMP`, `YEAR`
- **JSON**: `JSON`
- **Boolean**: `BOOLEAN` (alias for `TINYINT(1)`)

### Type Mapping

```json
{
  "INT": "number",
  "VARCHAR": "string",
  "DECIMAL": "string",
  "DATETIME": "string (ISO 8601)",
  "BOOLEAN": "boolean",
  "JSON": "object"
}
```

## Query Hints

### Consistency Levels

- **`strong`**: Linearizable consistency (default for mutations)
- **`bounded`**: Bounded staleness with configurable max staleness
- **`cached`**: Eventually consistent, cache-preferred (default for queries)

### Cache Control

- **`cacheTtl`**: Cache time-to-live in milliseconds
- **`cacheBypass`**: Skip cache lookup, fetch from authoritative storage
- **`cacheOnly`**: Return cached data only, fail if not cached

### Sharding Hints

- **`shardKey`**: Override automatic shard selection
- **`preferredShard`**: Suggest shard for query execution
- **`crossShard`**: Allow cross-shard operations

## SDK Integration

### JavaScript/TypeScript

```typescript
import { WorkerSQL } from '@workersql/client';

const db = new WorkerSQL({
  apiKey: 'your-api-key',
  baseUrl: 'https://api.workersql.com',
});

const result = await db.query('SELECT * FROM users WHERE id = ?', [123]);
```

### Python

```python
from workersql import Client

db = Client(api_key='your-api-key')
result = db.query('SELECT * FROM users WHERE id = %s', [123])
```

### PHP

```php
<?php
use WorkerSQL\Client;

$db = new Client(['api_key' => 'your-api-key']);
$result = $db->query('SELECT * FROM users WHERE id = ?', [123]);
```

## WebSocket API (Real-time)

### Connection

```javascript
const ws = new WebSocket('wss://api.workersql.com/v1/ws');
ws.send(
  JSON.stringify({
    type: 'auth',
    token: 'bearer-token',
  })
);
```

### Subscribe to Changes

```javascript
ws.send(
  JSON.stringify({
    type: 'subscribe',
    table: 'users',
    filter: 'active = true',
  })
);
```

## Changelog

### v1.0.0 (2025-09-01)

- Initial API specification
- Core query execution endpoints
- Transaction management
- Authentication and authorization
- Cache management
- Health monitoring

---

_Last updated: September 1, 2025_ _API Version: 1.0.0_

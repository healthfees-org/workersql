# Python SDK Implementation - WorkerSQL

This instruction documents the Python SDK implementation for WorkerSQL, providing a MySQL-compatible client for edge database operations.

## Overview

The Python SDK (`workersql-python-sdk`) provides a drop-in replacement for MySQL clients with full support for:
- DSN-based connection strings (`workersql://`)
- Thread-safe connection pooling
- Automatic retry logic with exponential backoff
- Context manager support (`with` statement)
- Type hints and Pydantic validation
- Prepared statement support

## Architecture

### Core Components

1. **WorkerSQLClient** (`workersql_client/workersql_client.py`)
   - Main client class
   - Handles configuration from DSN or dict
   - Manages connection pool
   - Implements retry logic
   - Context manager support

2. **DSNParser** (`workersql_client/dsn_parser.py`)
   - Parses `workersql://` connection strings
   - URL parsing with urllib
   - Extracts connection parameters
   - Builds API endpoints from DSN

3. **ConnectionPool** (`workersql_client/connection_pool.py`)
   - Thread-safe session management
   - Min/max connection limits
   - Idle timeout and health checking
   - Background health check thread

4. **RetryStrategy** (`workersql_client/retry_logic.py`)
   - Exponential backoff with jitter
   - Configurable retry attempts
   - Retryable error detection
   - Time-based delays

5. **SchemaValidator** (in `workersql_client.py`)
   - JSON schema validation
   - Request/response validation
   - SQL sanitization
   - Type checking

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

```python
# Basic connection
'workersql://user:pass@api.workersql.com/mydb?apiKey=abc123'

# With pooling configuration
'workersql://api.workersql.com/mydb?apiKey=abc123&maxConnections=20&minConnections=5'

# Local development (no SSL)
'workersql://localhost:8787/test?ssl=false&apiKey=dev-key'
```

## Usage Examples

### Basic Query

```python
from workersql_client import WorkerSQLClient

client = WorkerSQLClient(dsn='workersql://api.workersql.com/mydb?apiKey=your-key')

result = client.query("SELECT * FROM users WHERE id = ?", [1])
print(result.data)

client.close()
```

### Context Manager

```python
from workersql_client import WorkerSQLClient

with WorkerSQLClient(dsn='workersql://api.workersql.com/mydb?apiKey=key') as client:
    users = client.query("SELECT * FROM users")
    print(users.data)
    # Automatically closed
```

### Connection Pooling

```python
from workersql_client import WorkerSQLClient

client = WorkerSQLClient(config={
    "host": "api.workersql.com",
    "database": "mydb",
    "api_key": "your-key",
    "pooling": {
        "enabled": True,
        "min_connections": 2,
        "max_connections": 20,
        "idle_timeout": 300.0
    }
})

# Connections are automatically acquired and released
users = client.query("SELECT * FROM users")
orders = client.query("SELECT * FROM orders")

# Check pool stats
print(client.get_pool_stats())
# {'total': 2, 'active': 0, 'idle': 2, 'min_connections': 2, 'max_connections': 20}
```

### Retry Logic

```python
# Automatically retries on transient errors
client = WorkerSQLClient(config={
    "host": "api.workersql.com",
    "database": "mydb",
    "api_key": "your-key",
    "retry_attempts": 5,
    "retry_delay": 1.0
})

# Will retry up to 5 times with exponential backoff
result = client.query("SELECT * FROM users")
```

## Error Handling

```python
from workersql_client import WorkerSQLClient, ValidationError

client = WorkerSQLClient(dsn='workersql://api.workersql.com/mydb?apiKey=key')

try:
    result = client.query("SELECT * FROM users")
except ValidationError as error:
    print(f"Error code: {error.code}")
    print(f"Error message: {error.message}")
    print(f"Error details: {error.details}")
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

```python
client = WorkerSQLClient(dsn='workersql://user:pass@host/db?apiKey=key&pooling=true')
```

### Via Configuration Dict

```python
client = WorkerSQLClient(config={
    # Connection details
    "host": "api.workersql.com",
    "port": 443,
    "username": "myuser",
    "password": "mypass",
    "database": "mydb",

    # API configuration
    "api_endpoint": "https://api.workersql.com/v1",  # Auto-constructed if not provided
    "api_key": "your-api-key",

    # Connection options
    "ssl": True,
    "timeout": 30000,

    # Retry configuration
    "retry_attempts": 3,
    "retry_delay": 1.0,

    # Connection pooling
    "pooling": {
        "enabled": True,
        "min_connections": 1,
        "max_connections": 10,
        "idle_timeout": 300.0
    }
})
```

## Thread Safety

The Python SDK is thread-safe:

- **ConnectionPool**: Uses `threading.RLock` for synchronization
- **Session management**: Thread-safe with proper locking
- **Background health checks**: Runs in daemon thread
- **Retry logic**: No shared state between calls

Example multi-threaded usage:

```python
import threading
from workersql_client import WorkerSQLClient

client = WorkerSQLClient(dsn='workersql://api.workersql.com/mydb?apiKey=key')

def worker():
    result = client.query("SELECT * FROM users")
    print(f"Thread {threading.current_thread().name}: {len(result.data)} rows")

threads = [threading.Thread(target=worker) for _ in range(10)]
for t in threads:
    t.start()
for t in threads:
    t.join()

client.close()
```

## Type Hints

Full type hint support:

```python
from typing import List, Dict, Any, Optional
from workersql_client import (
    WorkerSQLClient,
    QueryResponse,
    BatchQueryResponse,
    HealthCheckResponse,
    ValidationError
)

def get_users(client: WorkerSQLClient, ids: List[int]) -> List[Dict[str, Any]]:
    result: QueryResponse = client.query(
        "SELECT * FROM users WHERE id IN (?)",
        ids
    )
    return result.data or []
```

## Dataclass Models

Response models use dataclasses:

```python
from dataclasses import dataclass
from typing import Optional, List, Dict, Any

@dataclass
class QueryResponse:
    success: bool
    data: Optional[List[Dict[str, Any]]] = None
    row_count: Optional[int] = None
    execution_time: Optional[float] = None
    cached: bool = False
    error: Optional[ErrorResponse] = None
```

## Best Practices

1. **Use context managers** - Ensures proper cleanup
2. **Enable connection pooling** - Better performance for multiple queries
3. **Handle errors gracefully** - Check for ValidationError
4. **Use type hints** - Better IDE support and type checking
5. **Close clients when done** - Release connections and resources
6. **Use prepared statements** - Pass params list for SQL injection prevention
7. **Monitor pool stats** - Use `get_pool_stats()` to track connection usage

## Implementation Notes

- Uses `requests` library for HTTP client
- Thread-safe with `threading.RLock`
- Background health check thread (daemon)
- DSN parsing with `urllib.parse`
- Retry logic uses `time.sleep` for delays
- Connection pool maintains min connections
- Idle connections cleaned up automatically
- All timeouts in seconds (not milliseconds like Node.js)

## Dependencies

- `requests`: HTTP client
- `jsonschema`: Schema validation
- `urllib.parse`: DSN parsing (stdlib)
- `threading`: Thread safety (stdlib)
- `dataclasses`: Response models (stdlib)

## Testing

The SDK includes comprehensive tests:
- Unit tests for each component
- Thread safety tests
- Retry logic tests
- Connection pool tests
- DSN parsing tests

## Future Enhancements

- [ ] WebSocket transaction support
- [ ] Async/await support with httpx
- [ ] Query result caching
- [ ] Metrics collection
- [ ] SQLAlchemy dialect
- [ ] Django ORM support
- [ ] Schema migration helpers

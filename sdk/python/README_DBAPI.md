# DB-API 2.0 (PEP 249) Compatibility for Python SDK

This document describes the DB-API 2.0 compliant interface for the WorkerSQL Python SDK, enabling drop-in replacement for Django, SQLAlchemy, and other Python database frameworks.

## Overview

The WorkerSQL Python SDK now includes a full DB-API 2.0 (PEP 249) compliant interface:

- **Module**: `workersql_client.dbapi`
- **API Level**: 2.0
- **Thread Safety**: Level 2 (threads may share module and connections)
- **Parameter Style**: qmark (`?` placeholders)

## Installation

```python
from workersql_client.dbapi import connect

# Create connection
conn = connect(dsn='workersql://user:pass@api.workersql.com/mydb?apiKey=abc123')
```

## Usage with Django

Update `settings.py`:

```python
DATABASES = {
    'default': {
        'ENGINE': 'workersql_client.dbapi.django',  # Custom backend
        'DSN': 'workersql://user:pass@api.workersql.com/mydb?apiKey=your-key',
    }
}
```

Create custom Django backend at `workersql_client/dbapi/django/__init__.py`:

```python
from django.db.backends.base.base import BaseDatabaseWrapper
from workersql_client.dbapi import connect

class DatabaseWrapper(BaseDatabaseWrapper):
    vendor = 'workersql'

    def get_connection_params(self):
        return {'dsn': self.settings_dict['DSN']}

    def get_new_connection(self, conn_params):
        return connect(**conn_params)

    def init_connection_state(self):
        pass

    def create_cursor(self, name=None):
        return self.connection.cursor()
```

## Usage with SQLAlchemy

```python
from sqlalchemy import create_engine
from sqlalchemy.dialects import registry

# Register WorkerSQL dialect
registry.register("workersql", "workersql_client.dbapi.sqlalchemy", "WorkerSQLDialect")

# Create engine
engine = create_engine('workersql://user:pass@api.workersql.com/mydb?apiKey=key')

# Use as normal
from sqlalchemy.orm import Session
with Session(engine) as session:
    result = session.execute("SELECT * FROM users WHERE id = ?", [1])
    user = result.fetchone()
```

## Connection API

### Module Functions

- `connect(dsn: str, **kwargs) -> Connection` - Create database connection

### Connection Class

```python
class Connection:
    def close() -> None
    def commit() -> None
    def rollback() -> None
    def cursor() -> Cursor
    @property closed -> bool
```

### Context Manager Support

```python
with connect(dsn='workersql://...') as conn:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM users WHERE id = ?", [1])
        user = cur.fetchone()
    conn.commit()
```

## Cursor API

### Cursor Properties

- `description`: Column descriptions (7-tuple per column)
- `rowcount`: Number of rows affected/returned
- `arraysize`: Rows to fetch with fetchmany() (default 1)
- `lastrowid`: Last insert ID

### Cursor Methods

```python
class Cursor:
    def execute(operation: str, parameters: Optional[List] = None) -> Cursor
    def executemany(operation: str, seq_of_parameters: List[List]) -> Cursor
    def fetchone() -> Optional[Tuple]
    def fetchmany(size: Optional[int] = None) -> List[Tuple]
    def fetchall() -> List[Tuple]
    def close() -> None
    def setinputsizes(sizes: List) -> None  # No-op
    def setoutputsize(size: int, column: Optional[int] = None) -> None  # No-op
```

### Iterator Protocol

```python
cursor.execute("SELECT * FROM users")
for row in cursor:
    print(row)
```

## Exception Hierarchy

```
Exception
└── Error
    ├── InterfaceError
    └── DatabaseError
        ├── DataError
        ├── OperationalError
        ├── IntegrityError
        ├── InternalError
        ├── ProgrammingError
        └── NotSupportedError
```

## Transaction Support

```python
conn = connect(dsn='workersql://...')
conn.commit()  # Auto-commit mode by default

# Explicit transactions
with conn:
    cursor = conn.cursor()
    cursor.execute("UPDATE accounts SET balance = balance - ? WHERE id = ?", [100, 1])
    cursor.execute("UPDATE accounts SET balance = balance + ? WHERE id = ?", [100, 2])
    # Auto-commits on success, rolls back on exception
```

## Type Mapping

| Python Type | SQL Type | Notes |
|-------------|----------|-------|
| str | VARCHAR/TEXT | UTF-8 encoded |
| int | INTEGER/BIGINT | Signed 64-bit |
| float | DOUBLE | IEEE 754 double |
| bool | BOOLEAN | 0/1 in SQL |
| bytes | BLOB | Binary data |
| None | NULL | SQL NULL |
| datetime | DATETIME | ISO 8601 format |
| date | DATE | ISO 8601 format |

## Flask-SQLAlchemy Integration

```python
from flask import Flask
from flask_sqlalchemy import SQLAlchemy

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'workersql://user:pass@api.workersql.com/mydb?apiKey=key'
db = SQLAlchemy(app)

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)

# Use as normal
@app.route('/users/<int:user_id>')
def get_user(user_id):
    user = User.query.get_or_404(user_id)
    return {'username': user.username, 'email': user.email}
```

## Thread Safety

The DB-API 2.0 implementation is thread-safe at level 2:

```python
import threading
from workersql_client.dbapi import connect

conn = connect(dsn='workersql://...')

def worker():
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE id = ?", [1])
    user = cursor.fetchone()
    print(user)

threads = [threading.Thread(target=worker) for _ in range(10)]
for t in threads:
    t.start()
for t in threads:
    t.join()

conn.close()
```

## Limitations

1. **No Native Protocol**: Uses HTTP API instead of PostgreSQL wire protocol
2. **Batch Transactions**: Transactions queued and executed as batch
3. **Limited Metadata**: description provides basic column info only
4. **Stored Procedures**: callproc() not supported
5. **Named Parameters**: Not supported (use positional ? only)

## Performance Considerations

- **Connection Pooling**: Handled by underlying WorkerSQLClient
- **Prepared Statements**: Cached on client side
- **Transactions**: Batched for single network round-trip
- **Edge Caching**: Queries benefit from edge cache when appropriate

## Testing

Run DB-API compliance tests:

```bash
pytest tests/test_dbapi_compliance.py
```

## Best Practices

1. **Use Context Managers**: Ensures proper cleanup
2. **Parameterized Queries**: Always use ? placeholders for security
3. **Connection Pooling**: Reuse connections across requests
4. **Error Handling**: Catch specific exception types
5. **Type Conversions**: Be explicit with datetime/date conversions

## Example: Complete CRUD Application

```python
from workersql_client.dbapi import connect, IntegrityError

class UserRepository:
    def __init__(self, dsn: str):
        self.dsn = dsn

    def create_user(self, username: str, email: str) -> int:
        with connect(dsn=self.dsn) as conn:
            cursor = conn.cursor()
            try:
                cursor.execute(
                    "INSERT INTO users (username, email) VALUES (?, ?)",
                    [username, email]
                )
                conn.commit()
                return cursor.lastrowid
            except IntegrityError:
                raise ValueError("User already exists")

    def get_user(self, user_id: int) -> Optional[dict]:
        with connect(dsn=self.dsn) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id, username, email FROM users WHERE id = ?", [user_id])
            row = cursor.fetchone()
            if row:
                return {'id': row[0], 'username': row[1], 'email': row[2]}
            return None

    def update_user(self, user_id: int, username: str, email: str) -> bool:
        with connect(dsn=self.dsn) as conn:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE users SET username = ?, email = ? WHERE id = ?",
                [username, email, user_id]
            )
            conn.commit()
            return cursor.rowcount > 0

    def delete_user(self, user_id: int) -> bool:
        with connect(dsn=self.dsn) as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM users WHERE id = ?", [user_id])
            conn.commit()
            return cursor.rowcount > 0

# Usage
repo = UserRepository(dsn='workersql://user:pass@api.workersql.com/mydb?apiKey=key')
user_id = repo.create_user('john_doe', 'john@example.com')
user = repo.get_user(user_id)
print(user)
```

## Future Enhancements

- [ ] Async DB-API support (PEP 249 extension)
- [ ] Connection pool statistics
- [ ] Query result streaming
- [ ] Named parameter support (:name style)
- [ ] Prepared statement caching improvements

## Support

For issues or questions:
- GitHub: https://github.com/healthfees-org/workersql
- Documentation: /docs/architecture/010-sdk-integration.md

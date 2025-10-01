# MySQL Compatibility Layer for PHP SDK

This document describes the PDO and MySQLi compatibility layers for the WorkerSQL PHP SDK, enabling drop-in replacement for WordPress, Laravel, and other PHP applications.

## Overview

The WorkerSQL PHP SDK now includes two MySQL compatibility layers:

1. **PDO Driver** (`WorkerSQL\PDO\WorkerSQLPDO`) - PDO-compatible interface
2. **MySQLi Driver** (`WorkerSQL\MySQLi\WorkerSQLMySQLi`) - MySQLi-compatible interface

Both layers wrap the WorkerSQL HTTP client and provide familiar MySQL interfaces while operating over the edge network.

## PDO Compatibility

### Installation

```php
<?php
use WorkerSQL\PDO\WorkerSQLPDO;

// Create connection
$pdo = new WorkerSQLPDO('workersql://user:pass@api.workersql.com/mydb?apiKey=abc123');
```

### Usage with WordPress

Update `wp-config.php`:

```php
<?php
// Before (standard MySQL)
// define( 'DB_NAME', 'database_name_here' );
// define( 'DB_USER', 'username_here' );
// define( 'DB_PASSWORD', 'password_here' );
// define( 'DB_HOST', 'localhost' );

// After (WorkerSQL)
define( 'DB_DSN', 'workersql://user:pass@api.workersql.com/wordpress?apiKey=your-key' );

// Create custom db.php drop-in
// File: wp-content/db.php
require_once ABSPATH . 'vendor/autoload.php';
use WorkerSQL\PDO\WorkerSQLPDO;

class wpdb extends wpdb {
    public function db_connect( $allow_bail = true ) {
        $this->dbh = new WorkerSQLPDO(DB_DSN);
        return true;
    }
}
```

### PDO Methods Supported

- `prepare(string $query): WorkerSQLPDOStatement` - Prepare a statement
- `exec(string $query): int` - Execute and return affected rows
- `query(string $query): WorkerSQLPDOStatement` - Execute and return statement
- `beginTransaction(): bool` - Start transaction
- `commit(): bool` - Commit transaction
- `rollBack(): bool` - Rollback transaction
- `lastInsertId(): string` - Get last insert ID
- `getAttribute(int $attribute): mixed` - Get attribute
- `setAttribute(int $attribute, mixed $value): bool` - Set attribute
- `quote(string $string): string` - Quote string

### PDOStatement Methods Supported

- `execute(?array $params = null): bool` - Execute prepared statement
- `fetch(?int $mode = null): mixed` - Fetch next row
- `fetchAll(?int $mode = null): array` - Fetch all rows
- `fetchColumn(int $column = 0): mixed` - Fetch single column
- `fetchObject(?string $class = "stdClass"): object|false` - Fetch as object
- `rowCount(): int` - Get affected row count
- `columnCount(): int` - Get column count

## MySQLi Compatibility

### Installation

```php
<?php
use WorkerSQL\MySQLi\WorkerSQLMySQLi;

// Create connection
$mysqli = new WorkerSQLMySQLi('workersql://user:pass@api.workersql.com/mydb?apiKey=abc123');
```

### Usage with WordPress

WordPress can use MySQLi via the wpdb abstraction. Update the db.php drop-in:

```php
<?php
// File: wp-content/db.php
require_once ABSPATH . 'vendor/autoload.php';
use WorkerSQL\MySQLi\WorkerSQLMySQLi;

class wpdb extends wpdb {
    public function db_connect( $allow_bail = true ) {
        $this->dbh = new WorkerSQLMySQLi(DB_DSN);
        $this->use_mysqli = true;
        return true;
    }
}
```

### MySQLi Methods Supported

- `query(string $query): WorkerSQLMySQLiResult|bool` - Execute query
- `prepare(string $query): WorkerSQLMySQLiStmt|false` - Prepare statement
- `real_query(string $query): bool` - Execute query (no result)
- `begin_transaction(): bool` - Start transaction
- `commit(): bool` - Commit transaction
- `rollback(): bool` - Rollback transaction
- `real_escape_string(string $string): string` - Escape string
- `insert_id(): int|string` - Get last insert ID
- `affected_rows(): int|string` - Get affected rows
- `errno(): int` - Get error number
- `error(): string` - Get error message
- `close(): bool` - Close connection

### MySQLi Statement Methods

- `bind_param(string $types, mixed ...$vars): bool` - Bind parameters
- `execute(): bool` - Execute prepared statement
- `get_result(): WorkerSQLMySQLiResult|false` - Get result set
- `affected_rows(): int` - Get affected rows
- `insert_id(): int` - Get last insert ID
- `close(): bool` - Close statement

### MySQLi Result Methods

- `fetch_assoc(): ?array` - Fetch as associative array
- `fetch_array(): ?array` - Fetch as both numeric and associative
- `fetch_object(string $class = "stdClass"): ?object` - Fetch as object
- `fetch_all(int $mode = MYSQLI_ASSOC): array` - Fetch all rows
- `num_rows(): int` - Get row count
- `free(): void` - Free result memory

## Transaction Support

Both PDO and MySQLi support transactions via batch queries:

```php
// PDO Example
$pdo->beginTransaction();
try {
    $stmt = $pdo->prepare("UPDATE accounts SET balance = balance - ? WHERE id = ?");
    $stmt->execute([100, 1]);
    
    $stmt = $pdo->prepare("UPDATE accounts SET balance = balance + ? WHERE id = ?");
    $stmt->execute([100, 2]);
    
    $pdo->commit();
} catch (Exception $e) {
    $pdo->rollBack();
    throw $e;
}

// MySQLi Example
$mysqli->begin_transaction();
try {
    $stmt = $mysqli->prepare("UPDATE accounts SET balance = balance - ? WHERE id = ?");
    $stmt->bind_param("ii", 100, 1);
    $stmt->execute();
    
    $stmt = $mysqli->prepare("UPDATE accounts SET balance = balance + ? WHERE id = ?");
    $stmt->bind_param("ii", 100, 2);
    $stmt->execute();
    
    $mysqli->commit();
} catch (Exception $e) {
    $mysqli->rollback();
    throw $e;
}
```

## Laravel Integration

Update `config/database.php`:

```php
'connections' => [
    'workersql' => [
        'driver' => 'workersql_pdo',
        'dsn' => env('WORKERSQL_DSN'),
        'prefix' => '',
        'prefix_indexes' => true,
    ],
],

// In AppServiceProvider.php
use WorkerSQL\PDO\WorkerSQLPDO;

public function register()
{
    $this->app->bind('db.connector.workersql_pdo', function ($app, $config) {
        return new WorkerSQLPDO($config['dsn']);
    });
}
```

## Limitations

1. **No Native Protocol**: Uses HTTP API instead of MySQL wire protocol
2. **Batch Transactions**: Transactions are queued and executed as batch
3. **Limited Metadata**: Some PDO/MySQLi metadata methods return limited info
4. **Stored Procedures**: Not supported
5. **Multi-Query**: Not supported in single call

## Performance Considerations

- **Connection Pooling**: Not yet implemented (planned)
- **Prepared Statements**: Cached on client side
- **Transactions**: Batched for single network round-trip
- **Edge Caching**: Queries benefit from edge cache when appropriate

## Testing

Run compatibility tests:

```bash
composer test:pdo
composer test:mysqli
```

## Future Enhancements

- [ ] Connection pooling support
- [ ] Async query execution
- [ ] Streaming result sets for large queries
- [ ] Enhanced transaction isolation levels
- [ ] Stored procedure support via HTTP endpoints

## Support

For issues or questions:
- GitHub: https://github.com/healthfees-org/workersql
- Documentation: /docs/architecture/010-sdk-integration.md

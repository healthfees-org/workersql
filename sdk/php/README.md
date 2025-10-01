# WorkerSQL PHP SDK

PHP SDK for WorkerSQL - bringing MySQL-compatible database operations to the edge with Cloudflare Workers.

## Features

- 🚀 **Edge-Native**: Run SQL queries at the edge for ultra-low latency
- 🔒 **Secure**: Built-in SQL injection prevention and schema validation
- 📊 **MySQL Compatible**: Familiar SQL syntax with MySQL compatibility
- 🔄 **PDO Compatible**: Drop-in replacement for PDO
- 🧪 **Well Tested**: Comprehensive test coverage with PHPUnit
- 📚 **Well Documented**: Complete API documentation and examples

## Installation

### With Composer

```bash
composer require workersql/php-sdk
```

### From Source

```bash
git clone https://github.com/healthfees-org/workersql.git
cd workersql/sdk/php
composer install
```

## Quick Start

### Using PDO-Compatible Interface

```php
<?php
require 'vendor/autoload.php';

use WorkerSQL\PDO\Connection;

// Create connection with DSN
$pdo = new Connection(
    'workersql://user:pass@api.workersql.com/mydb?apiKey=your-api-key'
);

// Execute a query
$stmt = $pdo->prepare('SELECT * FROM users WHERE id = ?');
$stmt->execute([1]);
$user = $stmt->fetch(PDO::FETCH_ASSOC);

print_r($user);
```

### Using Native Client

```php
<?php
require 'vendor/autoload.php';

use WorkerSQL\Client;

// Create client
$client = new Client([
    'api_endpoint' => 'https://api.workersql.com',
    'api_key' => 'your-api-key',
    'host' => 'localhost',
    'database' => 'mydb',
]);

// Execute query
$result = $client->query('SELECT * FROM users WHERE id = ?', [1]);
print_r($result);

$client->close();
```

## Configuration

```php
$config = [
    'api_endpoint' => 'https://api.workersql.com',
    'api_key' => 'your-api-key',
    'host' => 'localhost',
    'database' => 'mydb',
    'retry_attempts' => 3,
    'retry_delay' => 1.0,
    'timeout' => 30,
    'log_level' => 'info', // debug, info, warn, error
];
```

## API Reference

### WorkerSQL\Client

#### `query(string $sql, array $params = [], array $options = []): array`

Execute a single SQL query.

```php
$result = $client->query(
    'SELECT * FROM users WHERE active = ?',
    [true],
    ['timeout' => 5000]
);
```

#### `batchQuery(array $queries, array $options = []): array`

Execute multiple queries in batch.

```php
$results = $client->batchQuery([
    ['sql' => 'SELECT * FROM users', 'params' => []],
    ['sql' => 'SELECT * FROM orders', 'params' => []],
], ['transaction' => true]);
```

#### `healthCheck(): array`

Check service health.

```php
$health = $client->healthCheck();
echo $health['status']; // "healthy"
```

### WorkerSQL\PDO\Connection

PDO-compatible connection class.

#### Methods

- `prepare(string $statement): Statement`
- `query(string $statement): Statement`
- `exec(string $statement): int`
- `beginTransaction(): bool`
- `commit(): bool`
- `rollBack(): bool`
- `lastInsertId(): string`

## Examples

### Transaction Support

```php
$pdo = new Connection('workersql://localhost/mydb?apiKey=key');

$pdo->beginTransaction();

try {
    $pdo->exec("INSERT INTO users (name) VALUES ('John')");
    $pdo->exec("INSERT INTO logs (message) VALUES ('User created')");
    
    $pdo->commit();
} catch (Exception $e) {
    $pdo->rollBack();
    throw $e;
}
```

### Prepared Statements

```php
$stmt = $pdo->prepare('INSERT INTO users (name, email) VALUES (?, ?)');
$stmt->execute(['John Doe', 'john@example.com']);

$userId = $pdo->lastInsertId();
echo "Created user with ID: $userId";
```

### Batch Operations

```php
$client = new Client(['api_endpoint' => 'https://api.workersql.com']);

$results = $client->batchQuery([
    ['sql' => 'INSERT INTO users (name) VALUES (?)', 'params' => ['Alice']],
    ['sql' => 'INSERT INTO users (name) VALUES (?)', 'params' => ['Bob']],
    ['sql' => 'SELECT * FROM users'],
], ['transaction' => true]);
```

## Development

### Running Tests

```bash
composer test
```

### Code Style

```bash
composer lint
```

### Static Analysis

```bash
composer analyze
```

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for details.

## License

Apache License 2.0

## Support

- [Documentation](https://docs.workersql.com)
- [GitHub Issues](https://github.com/healthfees-org/workersql/issues)
- [Email Support](mailto:developers@healthfees.org)

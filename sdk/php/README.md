# WorkerSQL PHP SDK

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

A PHP SDK for WorkerSQL - bringing MySQL-compatible database operations to the edge with Cloudflare Workers.

## Features

- 🚀 **Edge-Native**: Run SQL queries at the edge for ultra-low latency
- 🔒 **Secure**: Built-in SQL injection prevention and schema validation
- 📊 **MySQL Compatible**: Familiar SQL syntax with MySQL compatibility
- 🔁 **Automatic Retries**: Exponential backoff retry logic for transient failures
- 📝 **PSR-4 Compliant**: Modern PHP with autoloading
- 🧪 **Well Tested**: Comprehensive test coverage with PHPUnit
- 📚 **Well Documented**: Complete API documentation and examples

## Installation

```bash
composer require workersql/php-sdk
```

## Quick Start

### Using DSN String

```php
<?php

require 'vendor/autoload.php';

use WorkerSQL\Client;

// Connect using DSN
$client = new Client('workersql://username:password@api.workersql.com:443/mydb?apiKey=your-key');

// Execute a query
$result = $client->query('SELECT * FROM users WHERE id = ?', [1]);
print_r($result['data']);

// Close the connection
$client->close();
```

### Using Configuration Array

```php
<?php

use WorkerSQL\Client;

$client = new Client([
    'host' => 'api.workersql.com',
    'port' => 443,
    'database' => 'mydb',
    'username' => 'myuser',
    'password' => 'mypass',
    'api_key' => 'your-api-key',
    'ssl' => true,
]);

// Execute queries
$users = $client->query('SELECT * FROM users');
print_r($users['data']);

$client->close();
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

### DSN Examples

```
workersql://user:pass@api.workersql.com/mydb?apiKey=abc123
workersql://api.workersql.com/mydb?apiKey=abc123&retryAttempts=5
workersql://localhost:8787/test?ssl=false&apiKey=dev-key
```

## Configuration Options

```php
$client = new Client([
    // Connection details
    'host' => 'api.workersql.com',
    'port' => 443,
    'username' => 'myuser',
    'password' => 'mypass',
    'database' => 'mydb',
    
    // API configuration
    'api_endpoint' => 'https://api.workersql.com/v1',  // Auto-constructed if not provided
    'api_key' => 'your-api-key',
    
    // Connection options
    'ssl' => true,
    'timeout' => 30000,  // milliseconds
    
    // Retry configuration
    'retry_attempts' => 3,
    'retry_delay' => 1.0,  // seconds
]);
```

## API Reference

### Client

#### query(string $sql, array $params = [], ?array $options = null): array

Execute a single SQL query.

```php
$result = $client->query(
    'SELECT * FROM users WHERE age > ?',
    [18],
    ['timeout' => 5000]
);

print_r($result['data']);      // Query results
print_r($result['rowCount']);  // Number of rows
print_r($result['cached']);    // Whether result was cached
```

#### batchQuery(array $queries, ?array $options = null): array

Execute multiple queries in batch.

```php
$results = $client->batchQuery([
    ['sql' => 'INSERT INTO users (name, email) VALUES (?, ?)', 'params' => ['John', 'john@example.com']],
    ['sql' => 'INSERT INTO users (name, email) VALUES (?, ?)', 'params' => ['Jane', 'jane@example.com']]
], [
    'transaction' => true,
    'stopOnError' => true
]);
```

#### healthCheck(): array

Check service health.

```php
$health = $client->healthCheck();
print_r($health['status']);  // 'healthy' | 'degraded' | 'unhealthy'
```

#### close(): void

Close the client connection.

```php
$client->close();
```

## Error Handling

The SDK provides detailed error information through the `ValidationException` class:

```php
use WorkerSQL\Client;
use WorkerSQL\ValidationException;

try {
    $result = $client->query('SELECT * FROM users');
} catch (ValidationException $e) {
    echo 'Error code: ' . $e->getCode() . PHP_EOL;
    echo 'Error message: ' . $e->getMessage() . PHP_EOL;
    print_r($e->getDetails());
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

## Automatic Retries

The SDK automatically retries failed requests with exponential backoff:

```php
$client = new Client([
    'host' => 'api.workersql.com',
    'database' => 'mydb',
    'api_key' => 'your-key',
    'retry_attempts' => 5,    // Retry up to 5 times
    'retry_delay' => 1.0      // Start with 1 second delay
]);

// Automatically retries on transient errors:
// - CONNECTION_ERROR
// - TIMEOUT_ERROR
// - RESOURCE_LIMIT
// - Network errors (connection refused, timeout, etc.)
```

## Prepared Statements

The SDK uses parameterized queries to prevent SQL injection:

```php
// ✅ Safe - uses prepared statements
$result = $client->query(
    'SELECT * FROM users WHERE email = ? AND status = ?',
    ['user@example.com', 'active']
);

// ❌ Unsafe - don't concatenate user input
// $result = $client->query("SELECT * FROM users WHERE email = '{$userEmail}'");
```

## Examples

### Basic CRUD Operations

```php
// Create
$insert = $client->query(
    'INSERT INTO users (name, email) VALUES (?, ?)',
    ['John Doe', 'john@example.com']
);
print_r($insert['data']);

// Read
$users = $client->query('SELECT * FROM users WHERE id = ?', [1]);
print_r($users['data'][0]);

// Update
$client->query('UPDATE users SET email = ? WHERE id = ?', ['newemail@example.com', 1]);

// Delete
$client->query('DELETE FROM users WHERE id = ?', [1]);
```

### Batch Operations

```php
$queries = [
    ['sql' => 'INSERT INTO logs (message) VALUES (?)', 'params' => ['Log 1']],
    ['sql' => 'INSERT INTO logs (message) VALUES (?)', 'params' => ['Log 2']],
    ['sql' => 'INSERT INTO logs (message) VALUES (?)', 'params' => ['Log 3']]
];

$results = $client->batchQuery($queries, [
    'transaction' => false,
    'stopOnError' => false
]);

$successCount = count(array_filter($results['results'], fn($r) => $r['success']));
echo "{$successCount} queries succeeded" . PHP_EOL;
```

## Development

```bash
# Install dependencies
composer install

# Run tests
composer test

# Run static analysis
composer phpstan

# Check code style
composer cs:check

# Fix code style
composer cs:fix
```

## Requirements

- PHP 7.4 or higher
- ext-json
- Guzzle HTTP client

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

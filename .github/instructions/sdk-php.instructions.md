# PHP SDK Implementation - WorkerSQL

This instruction documents the PHP SDK implementation for WorkerSQL, providing a MySQL-compatible client for edge database operations.

## Overview

The PHP SDK (`workersql/php-sdk`) provides a drop-in replacement for MySQL clients with support for:
- DSN-based connection strings (`workersql://`)
- Automatic retry logic with exponential backoff
- PSR-4 autoloading
- Guzzle HTTP client
- PHP 7.4+ compatibility
- Prepared statement support

## Architecture

### Core Components

1. **Client** (`src/Client.php`)
   - Main client class
   - Handles configuration from DSN or array
   - Manages HTTP client
   - Implements retry logic
   - Provides high-level query methods

2. **DSNParser** (`src/DSNParser.php`)
   - Parses `workersql://` connection strings
   - Uses PHP's `parse_url` function
   - Extracts connection parameters
   - Builds API endpoints from DSN

3. **RetryStrategy** (`src/RetryStrategy.php`)
   - Exponential backoff with jitter
   - Configurable retry attempts
   - Retryable error detection
   - Uses `usleep` for delays

4. **ValidationException** (`src/ValidationException.php`)
   - Custom exception with error codes
   - Detailed error information
   - Extends base Exception class

## DSN Format

```
workersql://[username[:password]@]host[:port][/database][?param1=value1&param2=value2]
```

### Supported Parameters

- `apiKey`: API authentication key
- `ssl`: Enable/disable SSL (default: true)
- `timeout`: Request timeout in milliseconds (default: 30000)
- `retryAttempts`: Number of retry attempts (default: 3)

### Example DSNs

```php
// Basic connection
'workersql://user:pass@api.workersql.com/mydb?apiKey=abc123'

// With retry configuration
'workersql://api.workersql.com/mydb?apiKey=abc123&retryAttempts=5'

// Local development (no SSL)
'workersql://localhost:8787/test?ssl=false&apiKey=dev-key'
```

## Usage Examples

### Basic Query

```php
use WorkerSQL\Client;

$client = new Client('workersql://api.workersql.com/mydb?apiKey=your-key');

$result = $client->query("SELECT * FROM users WHERE id = ?", [1]);
print_r($result['data']);

$client->close();
```

### Configuration Array

```php
use WorkerSQL\Client;

$client = new Client([
    'host' => 'api.workersql.com',
    'database' => 'mydb',
    'api_key' => 'your-key',
    'ssl' => true,
    'retry_attempts' => 3,
]);

$users = $client->query('SELECT * FROM users');
print_r($users['data']);
```

### Retry Logic

```php
// Automatically retries on transient errors
$client = new Client([
    'host' => 'api.workersql.com',
    'database' => 'mydb',
    'api_key' => 'your-key',
    'retry_attempts' => 5,
    'retry_delay' => 1.0
]);

// Will retry up to 5 times with exponential backoff
$result = $client->query('SELECT * FROM users');
```

## Error Handling

```php
use WorkerSQL\Client;
use WorkerSQL\ValidationException;

$client = new Client('workersql://api.workersql.com/mydb?apiKey=key');

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
- `CONNECTION_ERROR`: Network or connection failure (retryable)
- `TIMEOUT_ERROR`: Operation timed out (retryable)
- `AUTH_ERROR`: Authentication failed
- `PERMISSION_ERROR`: Insufficient permissions
- `RESOURCE_LIMIT`: Resource limit exceeded (retryable)
- `INTERNAL_ERROR`: Internal server error

## Configuration

### Via DSN String

```php
$client = new Client('workersql://user:pass@host/db?apiKey=key&retryAttempts=5');
```

### Via Configuration Array

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

## PSR-4 Autoloading

The SDK follows PSR-4 autoloading standards:

```json
{
    "autoload": {
        "psr-4": {
            "WorkerSQL\\": "src/"
        }
    }
}
```

Usage:
```php
require 'vendor/autoload.php';

use WorkerSQL\Client;
use WorkerSQL\DSNParser;
use WorkerSQL\RetryStrategy;
use WorkerSQL\ValidationException;
```

## Dependencies

- **php**: >=7.4
- **ext-json**: JSON extension
- **guzzlehttp/guzzle**: ^7.5 - HTTP client

## Development Dependencies

- **phpunit/phpunit**: ^9.5 - Testing framework
- **phpstan/phpstan**: ^1.9 - Static analysis
- **squizlabs/php_codesniffer**: ^3.7 - Code style checker

## Testing

### Running Tests

```bash
# Install dependencies
composer install

# Run tests
composer test

# Run tests with coverage
composer test:coverage

# Run static analysis
composer phpstan

# Check code style
composer cs:check

# Fix code style
composer cs:fix
```

### Test Structure

```
tests/
├── Unit/
│   ├── ClientTest.php
│   ├── DSNParserTest.php
│   ├── RetryStrategyTest.php
│   └── ValidationExceptionTest.php
└── Integration/
    └── EndToEndTest.php
```

## Best Practices

1. **Use DSN or config array** - Don't hardcode credentials
2. **Handle errors gracefully** - Check for ValidationException
3. **Use prepared statements** - Pass params array for SQL injection prevention
4. **Close clients when done** - Release connections and resources
5. **Follow PSR-12** - Code style standards
6. **Type hint everything** - Use PHP 7.4+ type declarations
7. **Document public APIs** - Use PHPDoc blocks

## Implementation Notes

- Uses Guzzle HTTP client for requests
- DSN parsing with PHP's `parse_url`
- Retry logic uses `usleep` for delays (microseconds)
- All timeouts in milliseconds (converted to seconds for Guzzle)
- Error codes stored as exception code
- Jitter uses `rand()` for randomization

## Future Enhancements

- [ ] PDO-compatible interface
- [ ] MySQLi-compatible interface
- [ ] Connection pooling
- [ ] Transaction support
- [ ] Query builder API
- [ ] Schema migration helpers
- [ ] Async support with ReactPHP/Amp
- [ ] Laravel service provider
- [ ] Symfony bundle

## Status

**Current Implementation**: Basic client with DSN parsing and retry logic

**Remaining Work**:
- PDO compatibility layer
- MySQLi compatibility layer
- Connection pooling
- Transaction support
- Comprehensive tests
- Documentation improvements

## Notes

The PHP SDK provides a foundation for MySQL-compatible operations but is still under development. Core features like DSN parsing, retry logic, and basic query execution are implemented. Advanced features like connection pooling, PDO/MySQLi compatibility, and transaction support are planned for future releases.

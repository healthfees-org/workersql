# WorkerSQL Python SDK

[![PyPI version](https://badge.fury.io/py/workersql-python-sdk.svg)](https://pypi.org/project/workersql-python-sdk/)
[![Python versions](https://img.shields.io/pypi/pyversions/workersql-python-sdk)](https://pypi.org/project/workersql-python-sdk/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

A Python SDK for WorkerSQL - bringing MySQL-compatible database operations to the edge with Cloudflare Workers.

## Features

- 🚀 **Edge-Native**: Run SQL queries at the edge for ultra-low latency
- 🔒 **Secure**: Built-in SQL injection prevention and schema validation
- 📊 **MySQL Compatible**: Familiar SQL syntax with MySQL compatibility
- 🔄 **Async Support**: Modern async/await support with httpx
- 📝 **Type Safe**: Full type hints and Pydantic validation
- 🧪 **Well Tested**: Comprehensive test coverage with pytest
- 📚 **Well Documented**: Complete API documentation and examples

## Installation

### From PyPI (Recommended)

```bash
pip install workersql-python-sdk
```

### From Source

```bash
git clone https://github.com/healthfees-org/workersql.git
cd workersql/sdk/python
pip install -e .
```

### Development Installation

```bash
git clone https://github.com/healthfees-org/workersql.git
cd workersql/sdk/python
pip install -e ".[dev]"
```

## Quick Start

```python
from workersql_client import WorkerSQLClient

# Initialize client
config = {
    "api_endpoint": "https://your-workersql-endpoint.com/api",
    "host": "your-database-host",
    "username": "your-username",
    "password": "your-password",
    "database": "your-database",
}

with WorkerSQLClient(config) as client:
    # Execute a simple query
    result = client.query("SELECT * FROM users WHERE id = ?", [1])
    print(f"User: {result.data}")

    # Execute batch queries
    queries = [
        {"sql": "INSERT INTO users (name, email) VALUES (?, ?)", "params": ["John Doe", "john@example.com"]},
        {"sql": "SELECT * FROM users WHERE email = ?", "params": ["john@example.com"]},
    ]
    batch_result = client.batch_query(queries)
    print(f"Batch result: {batch_result}")
```

## Configuration

### Environment Variables

Create a `.env` file in your project root:

```env
WORKERSQL_API_ENDPOINT=https://your-endpoint.com/api
WORKERSQL_API_KEY=your-api-key
WORKERSQL_HOST=your-database-host
WORKERSQL_USERNAME=your-username
WORKERSQL_PASSWORD=your-password
WORKERSQL_DATABASE=your-database
WORKERSQL_SSL=true
WORKERSQL_TIMEOUT=30000
```

### Programmatic Configuration

```python
from workersql_client import WorkerSQLClient

config = {
    "api_endpoint": "https://your-endpoint.com/api",
    "api_key": "your-api-key",  # Optional
    "host": "localhost",
    "username": "user",
    "password": "password",
    "database": "mydb",
    "port": 3306,
    "ssl": True,
    "timeout": 30000,
    "retry_attempts": 3,
    "retry_delay": 1.0,
}
```

## API Reference

### WorkerSQLClient

#### Methods

- `query(sql, params=None, timeout=None, cache=None)` - Execute a single SQL query
- `batch_query(queries, transaction=False, stop_on_error=True)` - Execute multiple queries
- `health_check()` - Check service health
- `close()` - Close the client connection

#### Query Parameters

- `sql`: SQL query string
- `params`: Query parameters (list)
- `timeout`: Query timeout in milliseconds (default: 30000)
- `cache`: Cache options (optional)

#### Cache Options

```python
cache_options = {
    "enabled": True,
    "ttl": 300,  # seconds
    "key": "custom-cache-key"  # optional
}
```

## Error Handling

```python
from workersql_client import WorkerSQLClient, ValidationError

try:
    with WorkerSQLClient(config) as client:
        result = client.query("SELECT * FROM invalid_table")
except ValidationError as e:
    print(f"Validation error: {e.code} - {e.message}")
except Exception as e:
    print(f"Unexpected error: {e}")
```

## Async Support

```python
import asyncio
import httpx
from workersql_client import WorkerSQLClient

async def async_query():
    # Using httpx for async HTTP requests
    async with httpx.AsyncClient() as http_client:
        # Configure client to use async HTTP client
        config["http_client"] = http_client
        client = WorkerSQLClient(config)

        result = await client.query_async("SELECT * FROM users")
        print(f"Async result: {result}")

asyncio.run(async_query())
```

## Schema Validation

The SDK includes built-in schema validation using JSON Schema:

```python
from workersql_client import SchemaValidator

# Validate query request
request = {
    "sql": "SELECT * FROM users",
    "params": [],
    "timeout": 30000
}

try:
    validated = SchemaValidator.validate_query_request(request)
    print("Request is valid!")
except ValidationError as e:
    print(f"Invalid request: {e}")
```

## Development

### Running Tests

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=workersql_client

# Run specific test file
pytest tests/test_client.py
```

### Code Quality

```bash
# Format code
black .

# Sort imports
isort .

# Type checking
mypy .

# Linting
ruff check .

# Security scanning
bandit -r .
```

### Building Documentation

```bash
pip install -e ".[docs]"
sphinx-build docs _build/html
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

## Support

- 📖 [Documentation](https://workersql.readthedocs.io/)
- 🐛 [Issue Tracker](https://github.com/healthfees-org/workersql/issues)
- 💬 [Discussions](https://github.com/healthfees-org/workersql/discussions)

## Changelog

See [CHANGELOG.md](https://github.com/healthfees-org/workersql/blob/main/CHANGELOG.md) for release notes.

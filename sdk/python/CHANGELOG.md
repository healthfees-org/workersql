# Changelog

All notable changes to WorkerSQL Python SDK will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-09-01

### Added
- Initial release of WorkerSQL Python SDK
- Full MySQL-compatible SQL query execution at the edge
- Schema validation using JSON Schema
- Built-in SQL injection prevention
- Type-safe data models with Pydantic
- Comprehensive error handling and validation
- Context manager support for automatic connection cleanup
- Batch query execution with transaction support
- Health check functionality
- Caching support with TTL and custom keys
- Async HTTP support with httpx
- Complete test suite with pytest
- Full type hints and IDE support
- Modern Python packaging with pyproject.toml
- Development tools configuration (mypy, black, ruff, etc.)

### Features
- 🚀 **Edge-Native**: Run SQL queries at the edge for ultra-low latency
- 🔒 **Secure**: Built-in SQL injection prevention and schema validation
- 📊 **MySQL Compatible**: Familiar SQL syntax with MySQL compatibility
- 🔄 **Async Support**: Modern async/await support with httpx
- 📝 **Type Safe**: Full type hints and Pydantic validation
- 🧪 **Well Tested**: Comprehensive test coverage with pytest
- 📚 **Well Documented**: Complete API documentation and examples

### Dependencies
- requests>=2.31.0
- jsonschema>=4.19.0
- typing-extensions>=4.7.0
- types-requests>=2.31.0
- types-jsonschema>=4.19.0
- pydantic>=2.5.0
- httpx>=0.25.0
- aiofiles>=23.2.1
- python-dotenv>=1.0.0

### Development Dependencies
- pytest>=7.4.0
- pytest-cov>=4.1.0
- pytest-asyncio>=0.21.0
- black>=23.7.0
- isort>=5.12.0
- mypy>=1.5.0
- bandit>=1.7.5
- pre-commit>=3.3.0
- ruff>=0.1.0
- sphinx>=7.0.0
- sphinx-rtd-theme>=1.3.0
- myst-parser>=2.0.0

### API
- `WorkerSQLClient` - Main client class for database operations
- `SchemaValidator` - JSON schema validation utilities
- `ValidationError` - Custom exception for validation errors
- `DatabaseConfig` - Database configuration dataclass
- `QueryRequest` - Query request dataclass
- `QueryResponse` - Query response dataclass
- `BatchQueryRequest` - Batch query request dataclass
- `BatchQueryResponse` - Batch query response dataclass
- `HealthCheckResponse` - Health check response dataclass

### Examples
```python
from workersql_client import WorkerSQLClient

config = {
    "api_endpoint": "https://your-endpoint.com/api",
    "host": "localhost",
    "username": "user",
    "password": "password",
    "database": "mydb",
}

with WorkerSQLClient(config) as client:
    result = client.query("SELECT * FROM users WHERE id = ?", [1])
    print(f"User: {result.data}")
```

### Security
- SQL injection prevention through parameterized queries
- Input validation using JSON Schema
- Secure connection handling
- Environment variable support for sensitive data

### Performance
- Connection pooling with requests Session
- Efficient JSON serialization with dataclasses
- Minimal memory footprint
- Optimized for edge computing environments

### Compatibility
- Python 3.8+
- MySQL-compatible SQL syntax
- Cloudflare Workers runtime compatible
- Cross-platform support (Windows, macOS, Linux)

---

## Types of changes
- `Added` for new features
- `Changed` for changes in existing functionality
- `Deprecated` for soon-to-be removed features
- `Removed` for now removed features
- `Fixed` for any bug fixes
- `Security` in case of vulnerabilities

## Contributing
Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct, and the process for submitting pull requests.

## Versioning
We use [SemVer](http://semver.org/) for versioning. For the versions available, see the [tags on this repository](https://github.com/healthfees-org/workersql/tags).

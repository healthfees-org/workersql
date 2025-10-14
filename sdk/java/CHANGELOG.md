# Changelog

All notable changes to the WorkerSQL Java SDK will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-01-14

### Added
- Initial release of WorkerSQL Java SDK
- DSN-based connection string parsing
- Connection pooling with configurable min/max connections
- Automatic retry logic with exponential backoff
- Transaction support with automatic commit/rollback
- Prepared statement support for SQL injection prevention
- Health check endpoint
- Comprehensive error handling with ValidationError
- Builder pattern for configuration
- AutoCloseable support for try-with-resources
- Full type safety with generics
- Comprehensive unit tests
- Smoke tests for end-to-end validation
- Fuzz tests for security validation
- JavaDoc documentation
- 90%+ code coverage requirement

### Features
- Edge-native MySQL-compatible database operations
- Secure built-in SQL injection prevention
- Connection pool management with health checking
- Configurable retry strategies
- Support for complex transactions
- Pool statistics monitoring

### Dependencies
- Java 11+ required
- OkHttp 4.12.0 for HTTP client
- Gson 2.10.1 for JSON processing
- SLF4J 2.0.9 for logging
- JUnit Jupiter 5.10.1 for testing
- Mockito 5.7.0 for mocking
- JaCoCo 0.8.11 for code coverage

## [Unreleased]

### Planned
- WebSocket transaction support for sticky sessions
- Metadata provider for database introspection
- Stored procedure support
- Query streaming for large result sets
- Batch query operations
- Connection health pinging
- Query result caching
- Metrics collection

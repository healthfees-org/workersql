# SQL Compatibility Layer

## Overview

The SQL Compatibility Layer is a critical component of the Edge SQL system that
enables seamless MySQL-to-SQLite transpilation. It handles the translation of
MySQL syntax, functions, and features to their SQLite equivalents while
maintaining full compatibility with the MySQL protocol.

## Architecture

### Core Components

1. **SQLCompatibilityService**: Main service class that orchestrates the
   transpilation process
2. **Function Mappings**: Dictionary of MySQL-to-SQLite function translations
3. **Data Type Mappings**: MySQL-to-SQLite data type conversions
4. **Query Hint Parser**: Extracts and processes query hints for consistency
   control
5. **DDL Transpiler**: Handles CREATE, ALTER, DROP statements
6. **DML Transpiler**: Processes SELECT, INSERT, UPDATE, DELETE statements
7. **Transaction Handler**: Manages transaction demarcation statements

### Integration Points

- **Gateway Worker**: Intercepts incoming SQL requests and applies transpilation
- **Router Service**: Receives transpiled queries with extracted hints
- **Shard Layer**: Executes SQLite-compatible queries
- **Cache Service**: Uses hints for consistency control

## Features

### 1. MySQL to SQLite SQL Transpilation

#### Function Mappings

```typescript
// String functions
CONCAT(a, b) → a || b
UPPER(text) → UPPER(text)
LOWER(text) → LOWER(text)
LENGTH(str) → LENGTH(str)
SUBSTR(str, start, len) → SUBSTR(str, start, len)

// Date/Time functions
NOW() → DATETIME('now')
CURDATE() → DATE('now')
YEAR(date) → STRFTIME('%Y', date)
MONTH(date) → STRFTIME('%m', date)
DAY(date) → STRFTIME('%d', date)

// Math functions
ABS(num) → ABS(num)
ROUND(num) → ROUND(num)
CEIL(num) → CEILING(num)
FLOOR(num) → FLOOR(num)
```

#### Data Type Conversions

```sql
-- MySQL → SQLite
INT → INTEGER
BIGINT → INTEGER
VARCHAR(n) → TEXT
TINYINT → INTEGER
FLOAT → REAL
DOUBLE → REAL
DECIMAL → REAL
BOOLEAN → INTEGER
TIMESTAMP → TEXT
DATETIME → TEXT
AUTO_INCREMENT → AUTOINCREMENT
```

#### Syntax Conversions

```sql
-- LIMIT with OFFSET
LIMIT 10, 20 → LIMIT 20 OFFSET 10

-- Transaction commands
START TRANSACTION → BEGIN TRANSACTION
BEGIN → BEGIN TRANSACTION
```

### 2. DDL Statement Handling

#### CREATE TABLE Transpilation

```sql
-- Input (MySQL)
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Output (SQLite)
CREATE TABLE users (
  id INTEGER AUTOINCREMENT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

#### Supported DDL Operations

- ✅ CREATE TABLE with full syntax support
- ⚠️ ALTER TABLE (limited - ADD COLUMN supported, others logged)
- ✅ CREATE INDEX
- ✅ DROP TABLE/INDEX
- ✅ TRUNCATE TABLE

### 3. Query Hint Parsing

#### Supported Hints

```sql
/*+ strong */     -- Forces strong consistency (bypasses cache)
/*+ bounded=1500 */ -- Allows bounded staleness (1500ms)
/*+ weak */        -- Allows cached results (default)
```

#### Hint Processing

1. Parse hint comments from SQL
2. Extract consistency requirements
3. Remove hints from SQL text
4. Pass hints to routing layer
5. Apply consistency controls in cache layer

### 4. Parameter Binding and Prepared Statements

#### Positional Parameters

```sql
-- Input
SELECT * FROM users WHERE id = ? AND name = ?

-- Processing
- Maintains ? placeholders
- Validates parameter count
- Passes parameters unchanged
```

#### Named Parameters (Basic Support)

```sql
-- Input
SELECT * FROM users WHERE id = :id AND name = :name

-- Processing
- Converts to positional parameters
- Maintains parameter order
- Logs conversion for debugging
```

### 5. Transaction Demarcation Handling

#### Supported Commands

```sql
START TRANSACTION → BEGIN TRANSACTION
BEGIN → BEGIN TRANSACTION
COMMIT → COMMIT
ROLLBACK → ROLLBACK
```

## Implementation Details

### Transpilation Pipeline

1. **Input Validation**: Check SQL length and basic structure
2. **Hint Extraction**: Parse and remove query hints
3. **Statement Classification**: Determine SQL statement type
4. **Function Mapping**: Replace MySQL functions with SQLite equivalents
5. **Syntax Conversion**: Handle MySQL-specific syntax differences
6. **Parameter Processing**: Validate and prepare parameters
7. **Output Generation**: Return transpiled SQL with metadata

### Error Handling

#### Graceful Degradation

- Invalid SQL syntax logged but processing continues
- Unsupported features logged with warnings
- Malformed queries return original SQL where possible

#### Validation Checks

- SQL injection pattern detection
- Balanced quotes and parentheses
- Maximum query length limits
- Parameter type validation

### Performance Considerations

#### Optimization Strategies

- Lazy transpilation (only when needed)
- Function mapping caching
- Minimal string operations
- Efficient regex patterns

#### Memory Management

- Streaming processing for large queries
- Garbage collection of temporary objects
- Bounded parameter arrays

## Testing Strategy

### Unit Tests

- Function mapping accuracy
- Data type conversion correctness
- Hint parsing reliability
- Parameter binding validation

### Integration Tests

- End-to-end query transpilation
- Gateway integration
- Router service interaction
- Cache consistency control

### Edge Case Coverage

- Very long SQL queries
- Complex nested functions
- Malformed SQL handling
- Unicode character support
- Special character escaping

### Performance Tests

- Transpilation speed benchmarks
- Memory usage monitoring
- Large query handling
- Concurrent request processing

## Monitoring and Observability

### Metrics Collected

- Transpilation success/failure rates
- Query complexity metrics
- Function usage statistics
- Performance timing data

### Logging

- Transpilation operations
- Unsupported feature warnings
- Error conditions
- Performance anomalies

### Alerts

- High error rates
- Performance degradation
- Unsupported feature usage
- Memory usage spikes

## Future Enhancements

### Planned Features

1. **Advanced DDL Support**
   - Full ALTER TABLE operations
   - Foreign key constraints
   - Trigger support

2. **Enhanced Function Library**
   - Custom MySQL function implementations
   - User-defined function support
   - Advanced date/time operations

3. **Query Optimization**
   - Automatic query rewriting
   - Index suggestion generation
   - Query plan analysis

4. **Extended Hint Support**
   - Custom consistency levels
   - Query timeout hints
   - Shard affinity hints

## Compatibility Matrix

### MySQL Features Supported

- ✅ Basic SELECT/INSERT/UPDATE/DELETE
- ✅ JOIN operations
- ✅ Subqueries
- ✅ Common functions (CONCAT, NOW, etc.)
- ✅ Basic DDL operations
- ✅ Transaction support
- ✅ Parameter binding

### Limitations

- ⚠️ Limited ALTER TABLE support
- ⚠️ No stored procedures
- ⚠️ No triggers
- ⚠️ No views
- ⚠️ No user-defined functions

### SQLite Extensions

- ✅ Full-text search (FTS5)
- ✅ JSON functions
- ✅ Window functions
- ✅ CTE (Common Table Expressions)

## Security Considerations

### SQL Injection Prevention

- Parameter binding validation
- SQL injection pattern detection
- Input sanitization
- Query structure validation

### Access Control

- Query type restrictions
- Function whitelist validation
- DDL operation permissions
- Administrative command blocking

## Deployment and Configuration

### Environment Variables

```bash
SQL_COMPATIBILITY_ENABLED=true
SQL_TRANSPILATION_LOG_LEVEL=info
SQL_MAX_QUERY_LENGTH=10000
SQL_FUNCTION_CACHE_SIZE=1000
```

### Configuration Options

```typescript
interface SQLCompatibilityConfig {
  enabled: boolean;
  maxQueryLength: number;
  supportedFunctions: string[];
  dataTypeMappings: Record<string, string>;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}
```

## Troubleshooting

### Common Issues

#### Transpilation Failures

- Check SQL syntax validity
- Verify function name spelling
- Review data type usage
- Examine query hints format

#### Performance Problems

- Monitor query complexity
- Check function mapping efficiency
- Review parameter binding overhead
- Analyze memory usage patterns

#### Compatibility Errors

- Review unsupported feature list
- Check MySQL version compatibility
- Validate query structure
- Examine error logs for hints

### Debug Tools

- Transpilation logging
- Query analysis utilities
- Performance profiling
- Compatibility test harness

## References

### Related Documentation

- [Gateway Worker Architecture](./001-cloudflare-workers-platform.md)
- [Routing and Sharding System](./006-routing-sharding-system.md)
- [Cache Layer Implementation](./003-cache-aside-pattern.md)

### External Resources

- [MySQL Documentation](https://dev.mysql.com/doc/)
- [SQLite Documentation](https://www.sqlite.org/docs.html)
- [SQL Compatibility Best Practices](https://example.com/sql-compatibility)

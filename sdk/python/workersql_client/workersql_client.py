"""
WorkerSQL Python SDK
Uses common schema definitions for consistent data modeling
"""

import json
from dataclasses import dataclass, asdict
from typing import List, Dict, Any, Optional, Union, Type, Callable, cast
import types

# Import external dependencies with proper error handling
try:
    import requests  # type: ignore[import-untyped]
except ImportError:
    raise ImportError("requests package is required. Install with: pip install requests")

try:
    import jsonschema  # type: ignore[import-untyped]
except ImportError:
    raise ImportError("jsonschema package is required. Install with: pip install jsonschema")

# Type-safe function references with explicit ignore for complex types
_validate: Callable[[object, Dict[str, Any]], None] = jsonschema.validate  # type: ignore[assignment,reportUnknownMemberType]
JSValidationError = jsonschema.ValidationError  # type: ignore[assignment,reportUnknownMemberType]
RequestsException = requests.RequestException  # type: ignore[assignment,reportUnknownMemberType]

from pathlib import Path

# Load the common schema
SCHEMA_PATH = Path(__file__).parent.parent / "schema" / "workersql.schema.json"
with open(SCHEMA_PATH) as f:
    SCHEMA = json.load(f)


@dataclass
class DatabaseConfig:
    host: str
    username: str
    password: str
    database: str
    port: int = 3306
    ssl: bool = True
    timeout: int = 30000


@dataclass
class CacheOptions:
    enabled: bool = False
    ttl: int = 300
    key: Optional[str] = None


@dataclass
class QueryRequest:
    sql: str
    params: Optional[List[Union[str, int, bool, None]]] = None
    timeout: int = 30000
    cache: Optional[CacheOptions] = None

    def __post_init__(self):
        if self.params is None:
            self.params = []


@dataclass
class ErrorResponse:
    code: str
    message: str
    timestamp: str
    details: Optional[Dict[str, Any]] = None


@dataclass
class QueryResponse:
    success: bool
    data: Optional[List[Dict[str, Any]]] = None
    row_count: Optional[int] = None
    execution_time: Optional[float] = None
    cached: bool = False
    error: Optional[ErrorResponse] = None


@dataclass
class BatchQueryRequest:
    queries: List[QueryRequest]
    transaction: bool = False
    stop_on_error: bool = True

    def __post_init__(self):
        if len(self.queries) == 0:
            raise ValueError("queries array cannot be empty")
        if len(self.queries) > 100:
            raise ValueError("queries array cannot contain more than 100 items")


@dataclass
class BatchQueryResponse:
    success: bool
    results: List[QueryResponse]
    total_execution_time: Optional[float] = None


@dataclass
class HealthCheckResponse:
    status: str
    database: Dict[str, Any]
    cache: Dict[str, Any]
    timestamp: str


class ValidationError(Exception):
    def __init__(
        self, code: str, message: str, details: Optional[Dict[str, Any]] = None
    ):
        super().__init__(message)
        self.code = code
        self.details = details or {}


class SchemaValidator:
    @staticmethod
    def validate_against_schema(data: Dict[str, Any], schema_ref: str) -> None:
        """Validate data against a specific schema reference"""
        try:
            schema_def = cast(Dict[str, Any], SCHEMA["definitions"][schema_ref])
            _validate(data, schema_def)
        except JSValidationError as e:  # type: ignore
            raise ValidationError(
                "INVALID_QUERY", f"Schema validation failed: {str(e)}"
            )

    @staticmethod
    def validate_database_config(config: Dict[str, Any]) -> DatabaseConfig:
        SchemaValidator.validate_against_schema(config, "DatabaseConfig")
        return DatabaseConfig(**config)

    @staticmethod
    def validate_query_request(request: Dict[str, Any]) -> QueryRequest:
        SchemaValidator.validate_against_schema(request, "QueryRequest")

        # Convert cache dict to CacheOptions if present
        if "cache" in request and request["cache"]:
            request["cache"] = CacheOptions(**request["cache"])

        return QueryRequest(**request)

    @staticmethod
    def sanitize_sql(sql: str) -> str:
        """Basic SQL injection prevention"""
        import re

        dangerous_patterns = [
            r";\s*(drop|delete|truncate|alter|create|insert|update)\s+",
            r"union\s+select",
            r"exec\s*\(",
            r"execute\s*\(",
        ]

        for pattern in dangerous_patterns:
            if re.search(pattern, sql, re.IGNORECASE):
                raise ValidationError(
                    "INVALID_QUERY", "SQL contains potentially dangerous statements"
                )

        return sql.strip()


class WorkerSQLClient:
    def __init__(self, config: Optional[Dict[str, Any]] = None, dsn: Optional[str] = None):
        """
        Initialize WorkerSQL client
        
        Args:
            config: Configuration dictionary
            dsn: DSN connection string (alternative to config)
        """
        from .dsn_parser import DSNParser
        from .retry_logic import RetryStrategy
        from .connection_pool import ConnectionPool

        # Parse DSN if provided
        if dsn:
            parsed_dsn = DSNParser.parse(dsn)
            config = self._config_from_dsn(parsed_dsn)
        elif config is None:
            raise ValidationError("INVALID_QUERY", "Either config or dsn must be provided")

        self.config = self._validate_config(config)
        self.retry_strategy = RetryStrategy(
            max_attempts=self.config.get("retry_attempts", 3),
            initial_delay=self.config.get("retry_delay", 1.0),
        )

        # Initialize connection pool if enabled
        pooling_config = self.config.get("pooling", {})
        if pooling_config.get("enabled", True):
            self.pool: Optional["ConnectionPool"] = ConnectionPool(
                api_endpoint=self.config["api_endpoint"],
                api_key=self.config.get("api_key"),
                min_connections=pooling_config.get("min_connections", 1),
                max_connections=pooling_config.get("max_connections", 10),
                idle_timeout=pooling_config.get("idle_timeout", 300.0),
                connection_timeout=self.config.get("timeout", 30.0) / 1000.0,
            )
        else:
            self.pool = None

        # Create default session (used if pooling is disabled)
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Content-Type": "application/json",
                "User-Agent": "WorkerSQL-PythonSDK/1.0.0",
            }
        )
        if self.config.get("api_key"):
            self.session.headers["Authorization"] = f"Bearer {self.config['api_key']}"

    def _config_from_dsn(self, parsed: Any) -> Dict[str, Any]:
        """Build config from parsed DSN"""
        from .dsn_parser import DSNParser

        return {
            "host": parsed.host,
            "port": parsed.port,
            "username": parsed.username,
            "password": parsed.password,
            "database": parsed.database,
            "api_endpoint": DSNParser.get_api_endpoint(parsed),
            "api_key": parsed.params.get("apiKey"),
            "ssl": parsed.params.get("ssl", "true") != "false",
            "timeout": int(parsed.params.get("timeout", 30000)),
            "retry_attempts": int(parsed.params.get("retryAttempts", 3)),
            "pooling": {
                "enabled": parsed.params.get("pooling", "true") != "false",
                "min_connections": int(parsed.params.get("minConnections", 1)),
                "max_connections": int(parsed.params.get("maxConnections", 10)),
            },
        }

    def _validate_config(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Validate client configuration"""
        if "api_endpoint" not in config and "host" not in config:
            raise ValidationError("INVALID_QUERY", "api_endpoint or host is required")

        # Build api_endpoint from host if not provided
        if "api_endpoint" not in config and "host" in config:
            protocol = "http" if config.get("ssl") is False else "https"
            port = f":{config['port']}" if config.get("port") else ""
            config["api_endpoint"] = f"{protocol}://{config['host']}{port}/v1"

        # Validate database config portion
        db_config = {
            k: v
            for k, v in config.items()
            if k
            in ["host", "port", "username", "password", "database", "ssl", "timeout"]
        }
        SchemaValidator.validate_database_config(db_config)

        return {
            **db_config,
            "api_endpoint": config["api_endpoint"],
            "api_key": config.get("api_key"),
            "retry_attempts": config.get("retry_attempts", 3),
            "retry_delay": config.get("retry_delay", 1.0),
            "pooling": config.get("pooling", {}),
        }

    def _get_session(self) -> requests.Session:
        """Get a session from the pool or use default"""
        if self.pool:
            conn = self.pool.acquire()
            # Store connection ID for release
            conn.session._pool_conn_id = conn.id  # type: ignore
            return conn.session
        return self.session

    def _release_session(self, session: requests.Session) -> None:
        """Release a session back to the pool"""
        if self.pool and hasattr(session, "_pool_conn_id"):
            self.pool.release(session._pool_conn_id)  # type: ignore

    def get_pool_stats(self) -> Optional[Dict[str, int]]:
        """Get connection pool statistics"""
        return self.pool.get_stats() if self.pool else None

    def query(
        self,
        sql: str,
        params: Optional[List[Any]] = None,
        timeout: Optional[int] = None,
        cache: Optional[Dict[str, Any]] = None,
    ) -> QueryResponse:
        """Execute a single SQL query"""
        request_data: Dict[str, Any] = {"sql": sql, "params": params or [], "timeout": timeout or 30000}
        if cache:
            request_data["cache"] = cache
        validated_request = SchemaValidator.validate_query_request(request_data)

        def _execute() -> QueryResponse:
            session = self._get_session()
            try:
                response = session.post(
                    f"{self.config['api_endpoint']}/query",
                    json=asdict(validated_request),
                    timeout=timeout or 30,
                )
                response.raise_for_status()
                result = response.json()
                return QueryResponse(**result)
            finally:
                self._release_session(session)

        return self.retry_strategy.execute(_execute, "query")

    def batch_query(
        self,
        queries: List[Dict[str, Any]],
        transaction: bool = False,
        stop_on_error: bool = True,
    ) -> BatchQueryResponse:
        """Execute multiple queries in batch"""
        validated_queries = [SchemaValidator.validate_query_request(q) for q in queries]
        request_data: Dict[str, Any] = {
            "queries": [asdict(q) for q in validated_queries],
            "transaction": transaction,
            "stop_on_error": stop_on_error,
        }

        def _execute() -> BatchQueryResponse:
            session = self._get_session()
            try:
                response = session.post(
                    f"{self.config['api_endpoint']}/batch",
                    json=request_data,
                    timeout=self.config.get("timeout", 30),
                )
                response.raise_for_status()
                result = response.json()
                return BatchQueryResponse(**result)
            finally:
                self._release_session(session)

        return self.retry_strategy.execute(_execute, "batchQuery")

    def health_check(self) -> HealthCheckResponse:
        """Check service health"""
        def _execute() -> HealthCheckResponse:
            session = self._get_session()
            try:
                response = session.get(f"{self.config['api_endpoint']}/health", timeout=10)
                response.raise_for_status()
                result = response.json()
                return HealthCheckResponse(**result)
            finally:
                self._release_session(session)

        return self.retry_strategy.execute(_execute, "healthCheck")

    def close(self):
        """Close the client connection"""
        if self.pool:
            self.pool.close()
        self.session.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type: Optional[Type[BaseException]], exc_val: Optional[BaseException], exc_tb: Optional[types.TracebackType]) -> None:
        self.close()


class TransactionClient:
    def __init__(self, parent: WorkerSQLClient):
        self.parent = parent
        self.transaction_id = None

    def begin(self):
        """Start a transaction"""
        # Transaction implementation would go here
        print("[WorkerSQL] Transaction started")

    def query(self, sql: str, params: Optional[List[Any]] = None) -> QueryResponse:
        """Execute a query within the transaction"""
        if not self.transaction_id:
            raise ValidationError("INVALID_QUERY", "Transaction not started")
        return self.parent.query(sql, params)

    def commit(self):
        """Commit the transaction"""
        print("[WorkerSQL] Transaction committed")

    def rollback(self):
        """Rollback the transaction"""
        print("[WorkerSQL] Transaction rolled back")


# Example usage
if __name__ == "__main__":
    config = {
        "api_endpoint": "https://workersql.example.com/api",
        "host": "localhost",
        "username": "user",
        "password": "pass",
        "database": "testdb",
    }

    with WorkerSQLClient(config) as client:
        # Simple query
        result = client.query("SELECT * FROM users WHERE id = ?", [1])
        print(f"Query result: {result}")

        # Health check
        health = client.health_check()
        print(f"Health status: {health.status}")

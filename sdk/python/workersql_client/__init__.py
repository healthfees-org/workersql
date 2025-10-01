"""
WorkerSQL Python SDK

A Python SDK for WorkerSQL - bringing MySQL-compatible database operations
to the edge with Cloudflare Workers.
"""

from .workersql_client import (
    WorkerSQLClient,
    SchemaValidator,
    ValidationError,
    TransactionClient,
    DatabaseConfig,
    CacheOptions,
    QueryRequest,
    QueryResponse,
    ErrorResponse,
    BatchQueryRequest,
    BatchQueryResponse,
    HealthCheckResponse,
)

# Import MySQL compatibility layer
from .mysql_compat import (
    connect,
    connection,
    MySQLConnection,
    MySQLCursor,
    ConnectionPool,
    parse_dsn,
    Error,
    DatabaseError,
    InterfaceError,
    PoolError,
    ProgrammingError,
    OperationalError,
)

__version__ = "1.0.0"
__author__ = "HealthFees Organization"
__email__ = "developers@healthfees.org"
__license__ = "Apache-2.0"

__all__ = [
    "WorkerSQLClient",
    "SchemaValidator",
    "ValidationError",
    "TransactionClient",
    "DatabaseConfig",
    "CacheOptions",
    "QueryRequest",
    "QueryResponse",
    "ErrorResponse",
    "BatchQueryRequest",
    "BatchQueryResponse",
    "HealthCheckResponse",
    # MySQL compatibility
    "connect",
    "connection",
    "MySQLConnection",
    "MySQLCursor",
    "ConnectionPool",
    "parse_dsn",
    "Error",
    "DatabaseError",
    "InterfaceError",
    "PoolError",
    "ProgrammingError",
    "OperationalError",
]

"""
DB-API 2.0 (PEP 249) Compliant Interface for WorkerSQL

This module provides a standard Python Database API 2.0 interface
for WorkerSQL, enabling compatibility with Django, SQLAlchemy, and
other Python database frameworks.
"""

from .connection import Connection, connect
from .cursor import Cursor
from .exceptions import (
    Error,
    Warning,
    InterfaceError,
    DatabaseError,
    DataError,
    OperationalError,
    IntegrityError,
    InternalError,
    ProgrammingError,
    NotSupportedError,
)

# Module information
apilevel = "2.0"
threadsafety = 2  # Threads may share the module and connections
paramstyle = "qmark"  # Question mark style, e.g., "...WHERE name=?"

__all__ = [
    "Connection",
    "Cursor",
    "connect",
    "Error",
    "Warning",
    "InterfaceError",
    "DatabaseError",
    "DataError",
    "OperationalError",
    "IntegrityError",
    "InternalError",
    "ProgrammingError",
    "NotSupportedError",
    "apilevel",
    "threadsafety",
    "paramstyle",
]

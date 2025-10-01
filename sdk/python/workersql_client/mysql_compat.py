"""
MySQL Connector Python compatible API wrapper for WorkerSQL
Provides a drop-in replacement for mysql.connector
"""

import re
from typing import Any, Dict, List, Optional, Tuple, Union
from urllib.parse import urlparse, parse_qs
from contextlib import contextmanager

from .workersql_client import WorkerSQLClient, ValidationError, QueryResponse


def parse_dsn(dsn: str) -> Dict[str, Any]:
    """
    Parse workersql:// DSN into connection config
    
    Example DSN: workersql://user:pass@host:port/database?apiEndpoint=https://api.workersql.com
    """
    if not dsn.startswith('workersql://'):
        raise ValueError('Invalid DSN: must start with workersql://')
    
    try:
        parsed = urlparse(dsn)
        query_params = parse_qs(parsed.query)
        
        config = {
            'host': parsed.hostname or 'localhost',
            'username': parsed.username or '',
            'password': parsed.password or '',
            'database': parsed.path.lstrip('/') if parsed.path else '',
        }
        
        if parsed.port:
            config['port'] = parsed.port
        
        # Extract additional parameters from query string
        if 'apiEndpoint' in query_params:
            config['api_endpoint'] = query_params['apiEndpoint'][0]
        if 'apiKey' in query_params:
            config['api_key'] = query_params['apiKey'][0]
        
        return config
    except Exception as e:
        raise ValueError(f'Failed to parse DSN: {e}')


class MySQLCursor:
    """MySQL Connector Python compatible cursor"""
    
    def __init__(self, connection: 'MySQLConnection'):
        self.connection = connection
        self._rowcount = -1
        self._lastrowid = None
        self._description = None
        self._result = None
        self._result_index = 0
        
    @property
    def rowcount(self) -> int:
        """Number of rows affected by last operation"""
        return self._rowcount
    
    @property
    def lastrowid(self) -> Optional[int]:
        """Last inserted row ID"""
        return self._lastrowid
    
    @property
    def description(self) -> Optional[List[Tuple]]:
        """Column descriptions"""
        return self._description
    
    def execute(self, operation: str, params: Optional[Union[List, Tuple, Dict]] = None) -> 'MySQLCursor':
        """
        Execute a database operation (query or command)
        """
        # Convert %s parameter markers to ? for WorkerSQL
        sql = operation
        converted_params = None
        
        if params:
            if isinstance(params, dict):
                # Named parameters: %(name)s -> ?
                # Extract parameter names in order
                param_names = re.findall(r'%\((\w+)\)s', sql)
                converted_params = [params[name] for name in param_names]
                sql = re.sub(r'%\(\w+\)s', '?', sql)
            else:
                # Positional parameters: %s -> ?
                sql = sql.replace('%s', '?')
                converted_params = list(params)
        
        try:
            result = self.connection._client.query(sql, converted_params or [])
            
            # Process result
            self._rowcount = result.row_count or 0
            
            if result.data:
                self._result = result.data
                self._result_index = 0
                self._description = self._extract_description(result.data)
            else:
                self._result = None
                self._description = None
            
        except Exception as e:
            raise DatabaseError(f"Error executing query: {e}")
        
        return self
    
    def executemany(self, operation: str, seq_of_params: List) -> 'MySQLCursor':
        """
        Execute a database operation multiple times
        """
        total_affected = 0
        
        for params in seq_of_params:
            self.execute(operation, params)
            total_affected += self._rowcount
        
        self._rowcount = total_affected
        return self
    
    def fetchone(self) -> Optional[Tuple]:
        """Fetch next row of result set"""
        if self._result is None or self._result_index >= len(self._result):
            return None
        
        row = self._result[self._result_index]
        self._result_index += 1
        
        # Convert dict to tuple in column order
        if self._description:
            return tuple(row.get(col[0]) for col in self._description)
        return tuple(row.values())
    
    def fetchall(self) -> List[Tuple]:
        """Fetch all remaining rows"""
        if self._result is None:
            return []
        
        rows = []
        while True:
            row = self.fetchone()
            if row is None:
                break
            rows.append(row)
        
        return rows
    
    def fetchmany(self, size: int = 1) -> List[Tuple]:
        """Fetch next set of rows"""
        rows = []
        for _ in range(size):
            row = self.fetchone()
            if row is None:
                break
            rows.append(row)
        return rows
    
    def close(self) -> None:
        """Close the cursor"""
        self._result = None
        self._description = None
    
    def _extract_description(self, rows: List[Dict]) -> List[Tuple]:
        """Extract column descriptions from result rows"""
        if not rows:
            return []
        
        first_row = rows[0]
        description = []
        
        for col_name, value in first_row.items():
            # MySQL descriptor tuple: (name, type_code, display_size, internal_size, precision, scale, null_ok)
            col_type = self._infer_type_code(value)
            description.append((col_name, col_type, None, None, None, None, True))
        
        return description
    
    def _infer_type_code(self, value: Any) -> int:
        """Infer MySQL type code from Python value"""
        # MySQL type codes (simplified)
        FIELD_TYPE_LONG = 3
        FIELD_TYPE_DOUBLE = 5
        FIELD_TYPE_STRING = 254
        FIELD_TYPE_NULL = 6
        
        if value is None:
            return FIELD_TYPE_NULL
        elif isinstance(value, bool):
            return FIELD_TYPE_LONG
        elif isinstance(value, int):
            return FIELD_TYPE_LONG
        elif isinstance(value, float):
            return FIELD_TYPE_DOUBLE
        else:
            return FIELD_TYPE_STRING
    
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
    
    def __iter__(self):
        return self
    
    def __next__(self):
        row = self.fetchone()
        if row is None:
            raise StopIteration
        return row


class MySQLConnection:
    """MySQL Connector Python compatible connection"""
    
    def __init__(self, **kwargs):
        """
        Create a connection to WorkerSQL
        
        Supports both direct config and DSN:
        - MySQLConnection(host='localhost', user='root', password='pass', database='db')
        - MySQLConnection(dsn='workersql://user:pass@host/db')
        """
        if 'dsn' in kwargs:
            config = parse_dsn(kwargs['dsn'])
            config.update({k: v for k, v in kwargs.items() if k != 'dsn'})
        else:
            config = {
                'api_endpoint': kwargs.get('api_endpoint', kwargs.get('host', 'http://localhost')),
                'host': kwargs.get('host', 'localhost'),
                'username': kwargs.get('user', kwargs.get('username', '')),
                'password': kwargs.get('password', ''),
                'database': kwargs.get('database', ''),
                'port': kwargs.get('port', 3306),
                'api_key': kwargs.get('api_key'),
            }
        
        self._client = WorkerSQLClient(config)
        self._in_transaction = False
        self._autocommit = True
    
    def cursor(self, buffered: Optional[bool] = None, dictionary: Optional[bool] = None) -> MySQLCursor:
        """Create a new cursor"""
        return MySQLCursor(self)
    
    def commit(self) -> None:
        """Commit current transaction"""
        if self._in_transaction:
            self._client.query("COMMIT")
            self._in_transaction = False
    
    def rollback(self) -> None:
        """Rollback current transaction"""
        if self._in_transaction:
            self._client.query("ROLLBACK")
            self._in_transaction = False
    
    def start_transaction(self, consistent_snapshot: bool = False, isolation_level: Optional[str] = None) -> None:
        """Start a transaction"""
        sql = "BEGIN"
        if isolation_level:
            sql = f"SET TRANSACTION ISOLATION LEVEL {isolation_level}; BEGIN"
        
        self._client.query(sql)
        self._in_transaction = True
    
    def close(self) -> None:
        """Close the connection"""
        self._client.close()
    
    def ping(self, reconnect: bool = False, attempts: int = 1, delay: int = 0) -> None:
        """Check if connection is alive"""
        try:
            self._client.query("SELECT 1")
        except Exception as e:
            raise InterfaceError(f"Connection ping failed: {e}")
    
    def is_connected(self) -> bool:
        """Check if connection is still valid"""
        try:
            self.ping()
            return True
        except:
            return False
    
    @property
    def autocommit(self) -> bool:
        """Get autocommit status"""
        return self._autocommit
    
    @autocommit.setter
    def autocommit(self, value: bool) -> None:
        """Set autocommit mode"""
        self._autocommit = value
        # In WorkerSQL, this would be handled by the backend
    
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
            self.rollback()
        else:
            self.commit()
        self.close()


class ConnectionPool:
    """MySQL Connector Python compatible connection pool"""
    
    def __init__(self, pool_name: str = 'workersql', pool_size: int = 5, **kwargs):
        self.pool_name = pool_name
        self.pool_size = pool_size
        self.config = kwargs
        self._connections: List[MySQLConnection] = []
        self._available: List[MySQLConnection] = []
    
    def get_connection(self) -> MySQLConnection:
        """Get a connection from the pool"""
        if self._available:
            return self._available.pop()
        
        if len(self._connections) < self.pool_size:
            conn = MySQLConnection(**self.config)
            self._connections.append(conn)
            return conn
        
        # Wait for available connection (simplified)
        raise PoolError("Connection pool exhausted")
    
    def close(self) -> None:
        """Close all connections in pool"""
        for conn in self._connections:
            try:
                conn.close()
            except:
                pass
        self._connections.clear()
        self._available.clear()
    
    def _return_connection(self, conn: MySQLConnection) -> None:
        """Return connection to pool (internal use)"""
        if conn in self._connections:
            self._available.append(conn)


# Exception classes for MySQL compatibility
class Error(Exception):
    """Base exception for all MySQL errors"""
    pass


class DatabaseError(Error):
    """Exception for database-related errors"""
    pass


class InterfaceError(Error):
    """Exception for interface errors"""
    pass


class PoolError(Error):
    """Exception for connection pool errors"""
    pass


class ProgrammingError(Error):
    """Exception for programming errors"""
    pass


class OperationalError(Error):
    """Exception for operational errors"""
    pass


# Module-level functions for MySQL compatibility
def connect(**kwargs) -> MySQLConnection:
    """
    Create a connection to WorkerSQL
    
    Compatible with mysql.connector.connect()
    """
    return MySQLConnection(**kwargs)


@contextmanager
def connection(**kwargs):
    """Context manager for connections"""
    conn = connect(**kwargs)
    try:
        yield conn
    finally:
        conn.close()


__all__ = [
    'connect',
    'connection',
    'MySQLConnection',
    'MySQLCursor',
    'ConnectionPool',
    'parse_dsn',
    'Error',
    'DatabaseError',
    'InterfaceError',
    'PoolError',
    'ProgrammingError',
    'OperationalError',
]

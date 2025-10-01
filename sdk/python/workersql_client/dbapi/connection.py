"""DB-API 2.0 Connection Class"""
from typing import Optional, Any
from ..workersql_client import WorkerSQLClient
from .cursor import Cursor
from .exceptions import InterfaceError, DatabaseError

def connect(dsn: Optional[str] = None, **kwargs: Any) -> "Connection":
    """Create a new database connection"""
    return Connection(dsn=dsn, **kwargs)

class Connection:
    """DB-API 2.0 compliant Connection class"""
    
    def __init__(self, dsn: Optional[str] = None, **kwargs: Any):
        if dsn:
            self._client = WorkerSQLClient(dsn=dsn)
        elif kwargs:
            self._client = WorkerSQLClient(config=kwargs)
        else:
            raise InterfaceError("Either dsn or connection parameters must be provided")
        self._closed = False
        self._in_transaction = False
        self._transaction_queries: list = []
    
    def close(self) -> None:
        if not self._closed:
            self._client.close()
            self._closed = True
    
    def commit(self) -> None:
        if self._closed:
            raise InterfaceError("Connection is closed")
        if not self._in_transaction:
            return
        try:
            if self._transaction_queries:
                self._client.batch_query(self._transaction_queries)
            self._in_transaction = False
            self._transaction_queries = []
        except Exception as e:
            raise DatabaseError(f"Commit failed: {e}")
    
    def rollback(self) -> None:
        if self._closed:
            raise InterfaceError("Connection is closed")
        self._in_transaction = False
        self._transaction_queries = []
    
    def cursor(self) -> Cursor:
        if self._closed:
            raise InterfaceError("Connection is closed")
        return Cursor(self)
    
    def __enter__(self) -> "Connection":
        return self
    
    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        if exc_type is None:
            self.commit()
        else:
            self.rollback()
        self.close()
    
    def _execute(self, sql: str, params: Optional[list] = None) -> dict:
        if self._closed:
            raise InterfaceError("Connection is closed")
        if self._in_transaction:
            self._transaction_queries.append({'sql': sql, 'params': params or []})
            return {'success': True, 'data': [], 'rowsAffected': 0}
        return self._client.query(sql, params or [])
    
    def _execute_many(self, sql: str, params_list: list) -> dict:
        if self._closed:
            raise InterfaceError("Connection is closed")
        queries = [{'sql': sql, 'params': params} for params in params_list]
        return self._client.batch_query(queries)
    
    @property
    def closed(self) -> bool:
        return self._closed

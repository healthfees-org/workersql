"""DB-API 2.0 Cursor Class"""
from typing import Optional, Any, List, Tuple, Union
from .exceptions import InterfaceError, ProgrammingError

class Cursor:
    """DB-API 2.0 compliant Cursor class"""

    def __init__(self, connection: Any):
        self._connection = connection
        self._closed = False
        self._result: Optional[dict] = None
        self._position = 0
        self._rowcount = -1
        self._description: Optional[List[Tuple]] = None
        self._arraysize = 1
        self._lastrowid: Optional[int] = None

    @property
    def description(self) -> Optional[List[Tuple]]:
        return self._description

    @property
    def rowcount(self) -> int:
        return self._rowcount

    @property
    def arraysize(self) -> int:
        return self._arraysize

    @arraysize.setter
    def arraysize(self, value: int) -> None:
        self._arraysize = value

    @property
    def lastrowid(self) -> Optional[int]:
        return self._lastrowid

    def close(self) -> None:
        self._closed = True
        self._result = None
        self._position = 0

    def execute(self, operation: str, parameters: Optional[Union[List, Tuple]] = None) -> "Cursor":
        if self._closed:
            raise InterfaceError("Cursor is closed")
        try:
            params = list(parameters) if parameters else []
            self._result = self._connection._execute(operation, params)
            if not self._result.get('success'):
                error = self._result.get('error', {})
                raise ProgrammingError(error.get('message', 'Query failed'))
            if 'rowsAffected' in self._result:
                self._rowcount = self._result['rowsAffected']
            elif 'data' in self._result and self._result['data']:
                self._rowcount = len(self._result['data'])
            else:
                self._rowcount = -1
            if 'lastInsertId' in self._result:
                self._lastrowid = self._result['lastInsertId']
            if self._result.get('data'):
                first_row = self._result['data'][0]
                self._description = [(name, None, None, None, None, None, None) for name in first_row.keys()]
            else:
                self._description = None
            self._position = 0
            return self
        except Exception as e:
            if isinstance(e, (InterfaceError, ProgrammingError)):
                raise
            raise ProgrammingError(f"Execute failed: {e}")

    def executemany(self, operation: str, seq_of_parameters: List[Union[List, Tuple]]) -> "Cursor":
        if self._closed:
            raise InterfaceError("Cursor is closed")
        try:
            params_list = [list(params) for params in seq_of_parameters]
            self._result = self._connection._execute_many(operation, params_list)
            if not self._result.get('success'):
                error = self._result.get('error', {})
                raise ProgrammingError(error.get('message', 'Query failed'))
            self._rowcount = sum(r.get('rowsAffected', 0) for r in self._result.get('results', []) if isinstance(r, dict))
            self._position = 0
            return self
        except Exception as e:
            if isinstance(e, (InterfaceError, ProgrammingError)):
                raise
            raise ProgrammingError(f"ExecuteMany failed: {e}")

    def fetchone(self) -> Optional[Tuple]:
        if self._closed:
            raise InterfaceError("Cursor is closed")
        if not self._result or 'data' not in self._result:
            return None
        data = self._result['data']
        if self._position >= len(data):
            return None
        row = data[self._position]
        self._position += 1
        return tuple(row.values())

    def fetchmany(self, size: Optional[int] = None) -> List[Tuple]:
        if self._closed:
            raise InterfaceError("Cursor is closed")
        size = size or self._arraysize
        rows = []
        for _ in range(size):
            row = self.fetchone()
            if row is None:
                break
            rows.append(row)
        return rows

    def fetchall(self) -> List[Tuple]:
        if self._closed:
            raise InterfaceError("Cursor is closed")
        if not self._result or 'data' not in self._result:
            return []
        data = self._result['data']
        rows = [tuple(row.values()) for row in data[self._position:]]
        self._position = len(data)
        return rows

    def setinputsizes(self, sizes: List[Any]) -> None:
        pass

    def setoutputsize(self, size: int, column: Optional[int] = None) -> None:
        pass

    def __enter__(self) -> "Cursor":
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self.close()

    def __iter__(self) -> "Cursor":
        return self

    def __next__(self) -> Tuple:
        row = self.fetchone()
        if row is None:
            raise StopIteration
        return row

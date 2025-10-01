"""
Result streaming support for WorkerSQL Python SDK
Enables processing large result sets without loading all data into memory
"""

from typing import Iterator, List, Dict, Any, Optional, Callable, Generator
import time


class QueryStream:
    """Streaming query result reader with iterator protocol"""

    def __init__(
        self,
        sql: str,
        params: Optional[List[Any]] = None,
        query_fn: Callable[[str, Optional[List[Any]]], Any] = None,
        batch_size: int = 100
    ):
        self.sql = sql
        self.params = params or []
        self.query_fn = query_fn
        self.batch_size = batch_size
        self.offset = 0
        self.ended = False
        self.current_batch: List[Dict[str, Any]] = []
        self.batch_index = 0

    def __iter__(self) -> Iterator[Dict[str, Any]]:
        """Make this class iterable"""
        return self

    def __next__(self) -> Dict[str, Any]:
        """Get next row from stream"""
        # If we have rows in current batch, return next one
        if self.batch_index < len(self.current_batch):
            row = self.current_batch[self.batch_index]
            self.batch_index += 1
            return row

        # If we're done, stop iteration
        if self.ended:
            raise StopIteration

        # Fetch next batch
        self.current_batch = self._fetch_next_batch()
        self.batch_index = 0

        if not self.current_batch:
            self.ended = True
            raise StopIteration

        row = self.current_batch[self.batch_index]
        self.batch_index += 1
        return row

    def _fetch_next_batch(self) -> List[Dict[str, Any]]:
        """Fetch next batch of rows"""
        stream_sql = self._add_pagination(self.sql, self.batch_size, self.offset)
        result = self.query_fn(stream_sql, self.params)
        rows = result.data or []

        self.offset += len(rows)

        # If we got fewer rows than batch_size, we've reached the end
        if len(rows) < self.batch_size:
            self.ended = True

        return rows

    def _add_pagination(self, sql: str, limit: int, offset: int) -> str:
        """Add LIMIT and OFFSET to SQL query"""
        trimmed_sql = sql.strip()

        # Remove existing LIMIT clause if present
        import re
        limit_pattern = r'\s+LIMIT\s+\d+(\s+OFFSET\s+\d+)?$'
        base_sql = re.sub(limit_pattern, '', trimmed_sql, flags=re.IGNORECASE)

        return f'{base_sql} LIMIT {limit} OFFSET {offset}'

    def fetchmany(self, size: Optional[int] = None) -> List[Dict[str, Any]]:
        """Fetch multiple rows at once"""
        size = size or self.batch_size
        rows = []

        try:
            for _ in range(size):
                rows.append(next(self))
        except StopIteration:
            pass

        return rows

    def fetchall(self) -> List[Dict[str, Any]]:
        """Fetch all remaining rows"""
        rows = []

        try:
            while True:
                rows.append(next(self))
        except StopIteration:
            pass

        return rows

    def close(self):
        """Close the stream"""
        self.ended = True
        self.current_batch = []


class AsyncQueryIterator:
    """Async iterator for query results (for use with async/await)"""

    def __init__(
        self,
        sql: str,
        params: Optional[List[Any]] = None,
        query_fn: Callable = None,
        batch_size: int = 100
    ):
        self.sql = sql
        self.params = params or []
        self.query_fn = query_fn
        self.batch_size = batch_size
        self.offset = 0
        self.current_batch: List[Dict[str, Any]] = []
        self.batch_index = 0
        self.done = False

    def __aiter__(self):
        """Make this class async iterable"""
        return self

    async def __anext__(self) -> Dict[str, Any]:
        """Get next row asynchronously"""
        # If we have rows in current batch, return next one
        if self.batch_index < len(self.current_batch):
            row = self.current_batch[self.batch_index]
            self.batch_index += 1
            return row

        # If we're done, stop iteration
        if self.done:
            raise StopAsyncIteration

        # Fetch next batch
        await self._fetch_next_batch()

        if not self.current_batch:
            self.done = True
            raise StopAsyncIteration

        row = self.current_batch[self.batch_index]
        self.batch_index += 1
        return row

    async def _fetch_next_batch(self):
        """Fetch next batch of rows asynchronously"""
        stream_sql = self._add_pagination(self.sql, self.batch_size, self.offset)
        result = await self.query_fn(stream_sql, self.params)
        self.current_batch = result.data or []
        self.batch_index = 0
        self.offset += len(self.current_batch)

        if len(self.current_batch) < self.batch_size:
            self.done = True

    def _add_pagination(self, sql: str, limit: int, offset: int) -> str:
        """Add LIMIT and OFFSET to SQL query"""
        trimmed_sql = sql.strip()

        import re
        limit_pattern = r'\s+LIMIT\s+\d+(\s+OFFSET\s+\d+)?$'
        base_sql = re.sub(limit_pattern, '', trimmed_sql, flags=re.IGNORECASE)

        return f'{base_sql} LIMIT {limit} OFFSET {offset}'


class CursorStream:
    """Cursor-based streaming for large result sets"""

    def __init__(
        self,
        sql: str,
        params: Optional[List[Any]] = None,
        query_fn: Callable = None,
        batch_size: int = 100
    ):
        self.sql = sql
        self.params = params or []
        self.query_fn = query_fn
        self.batch_size = batch_size
        self.cursor_id: Optional[str] = None
        self.closed = False

    def open(self):
        """Open cursor and prepare for streaming"""
        try:
            # Initialize cursor (implementation depends on server support)
            result = self.query_fn(
                f'DECLARE cursor_{int(time.time())} CURSOR FOR {self.sql}',
                self.params
            )

            self.cursor_id = result.cursor_id if hasattr(result, 'cursor_id') else f'cursor_{int(time.time())}'
            return self.cursor_id
        except Exception as error:
            raise Exception(f'Failed to open cursor: {error}')

    def fetch_next(self) -> List[Dict[str, Any]]:
        """Fetch next batch of rows"""
        if self.closed or not self.cursor_id:
            return []

        try:
            result = self.query_fn(
                f'FETCH {self.batch_size} FROM {self.cursor_id}',
                []
            )

            rows = result.data or []

            if not rows:
                self.close()

            return rows
        except Exception as error:
            self.close()
            raise Exception(f'Failed to fetch from cursor: {error}')

    def close(self):
        """Close cursor and release resources"""
        if self.closed or not self.cursor_id:
            return

        try:
            self.query_fn(f'CLOSE {self.cursor_id}', [])
            self.closed = True
        except Exception:
            # Ignore close errors
            pass

    def __enter__(self):
        """Context manager support"""
        self.open()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager cleanup"""
        self.close()
        return False


def create_query_stream(
    sql: str,
    params: Optional[List[Any]],
    query_fn: Callable,
    batch_size: int = 100
) -> QueryStream:
    """Helper function to create a query stream"""
    return QueryStream(sql, params, query_fn, batch_size)


def create_async_iterator(
    sql: str,
    params: Optional[List[Any]],
    query_fn: Callable,
    batch_size: int = 100
) -> AsyncQueryIterator:
    """Helper function to create an async iterator"""
    return AsyncQueryIterator(sql, params, query_fn, batch_size)

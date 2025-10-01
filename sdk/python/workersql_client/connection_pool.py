"""
Connection Pool for WorkerSQL
Manages a pool of reusable HTTP sessions with health checking
"""

import threading
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, Optional

import requests  # type: ignore[import-untyped]

from .workersql_client import ValidationError


@dataclass
class PooledConnection:
    """A pooled connection wrapper"""

    id: str
    session: requests.Session
    in_use: bool
    created_at: datetime
    last_used: datetime
    use_count: int


class ConnectionPool:
    """Connection pool for HTTP sessions"""

    def __init__(
        self,
        api_endpoint: str,
        api_key: Optional[str] = None,
        min_connections: int = 1,
        max_connections: int = 10,
        idle_timeout: float = 300.0,
        connection_timeout: float = 30.0,
        health_check_interval: float = 60.0,
    ):
        """
        Initialize connection pool

        Args:
            api_endpoint: API endpoint URL
            api_key: Optional API key for authentication
            min_connections: Minimum connections to maintain
            max_connections: Maximum connections allowed
            idle_timeout: Seconds before idle connection is closed
            connection_timeout: Timeout for acquiring connection
            health_check_interval: Seconds between health checks
        """
        self.api_endpoint = api_endpoint
        self.api_key = api_key
        self.min_connections = min_connections
        self.max_connections = max_connections
        self.idle_timeout = idle_timeout
        self.connection_timeout = connection_timeout
        self.health_check_interval = health_check_interval

        self.connections: Dict[str, PooledConnection] = {}
        self.lock = threading.RLock()
        self.closed = False

        # Initialize minimum connections
        self._initialize()

        # Start health check thread
        if self.health_check_interval > 0:
            self.health_check_thread = threading.Thread(
                target=self._health_check_loop, daemon=True
            )
            self.health_check_thread.start()

    def _initialize(self) -> None:
        """Initialize minimum connections"""
        for _ in range(self.min_connections):
            self._create_connection()

    def _create_connection(self) -> PooledConnection:
        """Create a new connection"""
        import random
        import string

        # Generate unique ID
        conn_id = f"conn_{int(time.time())}_{random.randint(1000, 9999)}"

        # Create session
        session = requests.Session()
        session.headers.update(
            {
                "Content-Type": "application/json",
                "User-Agent": "WorkerSQL-PythonSDK/1.0.0",
            }
        )
        if self.api_key:
            session.headers["Authorization"] = f"Bearer {self.api_key}"

        # Create pooled connection
        conn = PooledConnection(
            id=conn_id,
            session=session,
            in_use=False,
            created_at=datetime.now(),
            last_used=datetime.now(),
            use_count=0,
        )

        with self.lock:
            self.connections[conn_id] = conn

        return conn

    def acquire(self) -> PooledConnection:
        """
        Acquire a connection from the pool

        Returns:
            PooledConnection: A pooled connection

        Raises:
            ValidationError: If pool is closed or timeout acquiring connection
        """
        if self.closed:
            raise ValidationError("CONNECTION_ERROR", "Connection pool is closed")

        start_time = time.time()

        while True:
            with self.lock:
                # Try to find an idle connection
                for conn in self.connections.values():
                    if not conn.in_use:
                        conn.in_use = True
                        conn.last_used = datetime.now()
                        conn.use_count += 1
                        return conn

                # No idle connections, create a new one if below max
                if len(self.connections) < self.max_connections:
                    conn = self._create_connection()
                    conn.in_use = True
                    conn.last_used = datetime.now()
                    conn.use_count += 1
                    return conn

            # Check timeout
            if time.time() - start_time > self.connection_timeout:
                raise ValidationError(
                    "TIMEOUT_ERROR", "Timeout waiting for connection"
                )

            # Wait a bit before trying again
            time.sleep(0.1)

    def release(self, connection_id: str) -> None:
        """
        Release a connection back to the pool

        Args:
            connection_id: ID of the connection to release
        """
        with self.lock:
            if connection_id in self.connections:
                conn = self.connections[connection_id]
                conn.in_use = False
                conn.last_used = datetime.now()

    def _perform_health_check(self) -> None:
        """Remove idle connections"""
        now = datetime.now()
        connections_to_remove = []

        with self.lock:
            for conn_id, conn in self.connections.items():
                # Remove idle connections that have exceeded the idle timeout
                if not conn.in_use:
                    idle_seconds = (now - conn.last_used).total_seconds()
                    if idle_seconds > self.idle_timeout:
                        # Keep minimum connections
                        if len(self.connections) > self.min_connections:
                            connections_to_remove.append(conn_id)

            for conn_id in connections_to_remove:
                conn = self.connections.pop(conn_id)
                conn.session.close()

    def _health_check_loop(self) -> None:
        """Health check loop (runs in background thread)"""
        while not self.closed:
            time.sleep(self.health_check_interval)
            self._perform_health_check()

    def get_stats(self) -> Dict[str, int]:
        """
        Get pool statistics

        Returns:
            Dict with total, active, and idle connection counts
        """
        with self.lock:
            active = sum(1 for c in self.connections.values() if c.in_use)
            return {
                "total": len(self.connections),
                "active": active,
                "idle": len(self.connections) - active,
                "min_connections": self.min_connections,
                "max_connections": self.max_connections,
            }

    def get_detailed_stats(self) -> Dict[str, Any]:
        """Get enhanced pool statistics with detailed metrics"""
        with self.lock:
            connections_list = list(self.connections.values())
            active = sum(1 for c in connections_list if c.in_use)
            total_requests = sum(c.use_count for c in connections_list)
            average_use_count = total_requests / len(connections_list) if connections_list else 0

            now = time.time()
            oldest_connection = min((c.created_at for c in connections_list), default=None)
            newest_connection = max((c.created_at for c in connections_list), default=None)

            return {
                "total": len(self.connections),
                "active": active,
                "idle": len(self.connections) - active,
                "min_connections": self.min_connections,
                "max_connections": self.max_connections,
                "total_requests": total_requests,
                "average_use_count": average_use_count,
                "oldest_connection": oldest_connection,
                "newest_connection": newest_connection,
                "connections": [
                    {
                        "id": c.id,
                        "in_use": c.in_use,
                        "created_at": c.created_at,
                        "last_used": c.last_used,
                        "use_count": c.use_count,
                        "age_seconds": now - c.created_at,
                        "idle_seconds": now - c.last_used
                    }
                    for c in connections_list
                ]
            }

    def close(self) -> None:
        """Close the pool and all connections"""
        self.closed = True

        # Wait for active connections to be released (with timeout)
        max_wait = 5.0
        start_time = time.time()

        while time.time() - start_time < max_wait:
            with self.lock:
                active_count = sum(1 for c in self.connections.values() if c.in_use)
                if active_count == 0:
                    break
            time.sleep(0.1)

        # Close all connections
        with self.lock:
            for conn in self.connections.values():
                conn.session.close()
            self.connections.clear()

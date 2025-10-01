"""
Tests for Connection Pool
"""

import pytest
import time
from unittest.mock import Mock, patch
from workersql_client.connection_pool import ConnectionPool
from workersql_client import ValidationError


class TestConnectionPool:
    @pytest.fixture
    def pool_config(self):
        return {
            "api_endpoint": "https://api.test.com/v1",
            "api_key": "test-key",
            "min_connections": 2,
            "max_connections": 5,
            "idle_timeout": 1.0,
            "health_check_interval": 0.5,
        }

    def test_initialization_with_defaults(self):
        pool = ConnectionPool(
            api_endpoint="https://api.test.com/v1",
            api_key="test-key"
        )
        
        stats = pool.get_stats()
        assert stats["min_connections"] == 1
        assert stats["max_connections"] == 10
        assert stats["total"] >= 1
        
        pool.close()

    def test_initialization_with_custom_options(self, pool_config):
        pool = ConnectionPool(**pool_config)
        
        stats = pool.get_stats()
        assert stats["min_connections"] == 2
        assert stats["max_connections"] == 5
        assert stats["total"] == 2
        
        pool.close()

    def test_acquire_connection(self, pool_config):
        pool = ConnectionPool(**pool_config)
        
        conn = pool.acquire()
        assert conn is not None
        assert conn.id is not None
        assert conn.session is not None
        
        stats = pool.get_stats()
        assert stats["active"] == 1
        assert stats["idle"] == 1
        
        pool.release(conn.id)
        pool.close()

    def test_release_connection(self, pool_config):
        pool = ConnectionPool(**pool_config)
        
        conn = pool.acquire()
        conn_id = conn.id
        
        pool.release(conn_id)
        
        stats = pool.get_stats()
        assert stats["active"] == 0
        assert stats["idle"] == 2
        
        pool.close()

    def test_reuse_released_connections(self, pool_config):
        pool = ConnectionPool(**pool_config)
        
        conn1 = pool.acquire()
        conn1_id = conn1.id
        pool.release(conn1_id)
        
        conn2 = pool.acquire()
        assert conn2.id == conn1_id
        
        pool.release(conn2.id)
        pool.close()

    def test_create_new_connections_up_to_max(self, pool_config):
        pool = ConnectionPool(**pool_config)
        
        conns = []
        for i in range(5):
            conns.append(pool.acquire())
        
        stats = pool.get_stats()
        assert stats["total"] == 5
        assert stats["active"] == 5
        assert stats["idle"] == 0
        
        for conn in conns:
            pool.release(conn.id)
        pool.close()

    def test_wait_for_connection_when_exhausted(self, pool_config):
        pool = ConnectionPool(**pool_config)
        
        # Acquire all connections
        conns = []
        for i in range(5):
            conns.append(pool.acquire())
        
        # This should timeout since pool is exhausted
        with pytest.raises(ValidationError, match="Timeout waiting"):
            pool.acquire()
        
        # Clean up
        for conn in conns:
            pool.release(conn.id)
        pool.close()

    def test_track_connection_stats(self, pool_config):
        pool = ConnectionPool(**pool_config)
        
        stats1 = pool.get_stats()
        assert stats1["total"] == 2
        
        conn1 = pool.acquire()
        conn2 = pool.acquire()
        conn3 = pool.acquire()
        
        stats2 = pool.get_stats()
        assert stats2["total"] == 3
        assert stats2["active"] == 3
        assert stats2["idle"] == 0
        
        pool.release(conn1.id)
        
        stats3 = pool.get_stats()
        assert stats3["active"] == 2
        assert stats3["idle"] == 1
        
        pool.release(conn2.id)
        pool.release(conn3.id)
        pool.close()

    def test_health_check_removes_idle_connections(self, pool_config):
        # Short timeouts for testing
        pool = ConnectionPool(
            api_endpoint="https://api.test.com/v1",
            api_key="test-key",
            min_connections=2,
            max_connections=10,
            idle_timeout=0.5,
            health_check_interval=0.3,
        )
        
        # Create extra connections
        conn1 = pool.acquire()
        conn2 = pool.acquire()
        conn3 = pool.acquire()
        
        pool.release(conn1.id)
        pool.release(conn2.id)
        pool.release(conn3.id)
        
        stats1 = pool.get_stats()
        assert stats1["total"] == 3
        
        # Wait for health check to remove idle connections
        time.sleep(1.5)
        
        stats2 = pool.get_stats()
        # Should keep minimum connections
        assert stats2["total"] == 2
        
        pool.close()

    def test_close_pool(self, pool_config):
        pool = ConnectionPool(**pool_config)
        
        stats1 = pool.get_stats()
        assert stats1["total"] == 2
        
        pool.close()
        
        stats2 = pool.get_stats()
        assert stats2["total"] == 0

    def test_acquire_after_close_raises_error(self, pool_config):
        pool = ConnectionPool(**pool_config)
        pool.close()
        
        with pytest.raises(ValidationError, match="Connection pool is closed"):
            pool.acquire()

    def test_connection_use_count(self, pool_config):
        pool = ConnectionPool(**pool_config)
        
        conn = pool.acquire()
        assert conn.use_count == 1
        pool.release(conn.id)
        
        conn2 = pool.acquire()
        assert conn2.id == conn.id
        assert conn2.use_count == 2
        
        pool.release(conn2.id)
        pool.close()

    def test_thread_safety(self, pool_config):
        """Test that pool is thread-safe"""
        import threading
        
        pool = ConnectionPool(**pool_config)
        errors = []
        
        def worker():
            try:
                conn = pool.acquire()
                time.sleep(0.01)  # Simulate work
                pool.release(conn.id)
            except Exception as e:
                errors.append(e)
        
        threads = [threading.Thread(target=worker) for _ in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        
        assert len(errors) == 0
        pool.close()

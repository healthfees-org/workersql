"""
Tests for MySQL Connector Python compatible API wrapper
"""

import pytest
from workersql_client.mysql_compat import (
    connect,
    parse_dsn,
    MySQLConnection,
    MySQLCursor,
    ConnectionPool,
    Error,
    DatabaseError,
)


class TestDSNParsing:
    """Test DSN parsing functionality"""
    
    def test_parse_basic_dsn(self):
        """Test parsing basic workersql:// DSN"""
        dsn = 'workersql://user:pass@localhost:3306/testdb'
        config = parse_dsn(dsn)
        
        assert config['username'] == 'user'
        assert config['password'] == 'pass'
        assert config['host'] == 'localhost'
        assert config['port'] == 3306
        assert config['database'] == 'testdb'
    
    def test_parse_dsn_with_query_params(self):
        """Test parsing DSN with query parameters"""
        dsn = 'workersql://user:pass@api.workersql.com/mydb?apiEndpoint=https://api.workersql.com&apiKey=test-key'
        config = parse_dsn(dsn)
        
        assert config['username'] == 'user'
        assert config['database'] == 'mydb'
        assert config['api_endpoint'] == 'https://api.workersql.com'
        assert config['api_key'] == 'test-key'
    
    def test_parse_dsn_invalid_protocol(self):
        """Test error on invalid DSN protocol"""
        with pytest.raises(ValueError, match='Invalid DSN'):
            parse_dsn('mysql://localhost/testdb')
    
    def test_parse_dsn_without_credentials(self):
        """Test parsing DSN without credentials"""
        dsn = 'workersql://localhost/testdb'
        config = parse_dsn(dsn)
        
        assert config['host'] == 'localhost'
        assert config['database'] == 'testdb'
        assert config['username'] == ''
        assert config['password'] == ''


class TestMySQLConnection:
    """Test MySQL-compatible connection"""
    
    def test_create_connection_with_config(self):
        """Test creating connection with config dict"""
        conn = MySQLConnection(
            host='localhost',
            user='root',
            password='password',
            database='testdb',
            api_endpoint='https://api.workersql.com',
        )
        
        assert conn is not None
        conn.close()
    
    def test_create_connection_with_dsn(self):
        """Test creating connection with DSN"""
        conn = MySQLConnection(
            dsn='workersql://root:password@localhost/testdb?apiEndpoint=https://api.workersql.com'
        )
        
        assert conn is not None
        conn.close()
    
    def test_connection_context_manager(self):
        """Test connection as context manager"""
        with MySQLConnection(host='localhost', api_endpoint='https://api.workersql.com') as conn:
            assert conn is not None
        
        # Connection should be closed after context exit
    
    def test_connection_cursor(self):
        """Test creating cursor from connection"""
        conn = MySQLConnection(host='localhost', api_endpoint='https://api.workersql.com')
        cursor = conn.cursor()
        
        assert cursor is not None
        assert isinstance(cursor, MySQLCursor)
        
        cursor.close()
        conn.close()
    
    def test_connection_transaction_methods(self):
        """Test transaction methods exist"""
        conn = MySQLConnection(host='localhost', api_endpoint='https://api.workersql.com')
        
        assert hasattr(conn, 'commit')
        assert hasattr(conn, 'rollback')
        assert hasattr(conn, 'start_transaction')
        assert callable(conn.commit)
        assert callable(conn.rollback)
        assert callable(conn.start_transaction)
        
        conn.close()
    
    def test_connection_ping(self):
        """Test connection ping method"""
        conn = MySQLConnection(host='localhost', api_endpoint='https://api.workersql.com')
        
        assert hasattr(conn, 'ping')
        assert callable(conn.ping)
        
        conn.close()
    
    def test_connection_autocommit(self):
        """Test autocommit property"""
        conn = MySQLConnection(host='localhost', api_endpoint='https://api.workersql.com')
        
        # Default should be True
        assert conn.autocommit == True
        
        # Should be settable
        conn.autocommit = False
        assert conn.autocommit == False
        
        conn.close()


class TestMySQLCursor:
    """Test MySQL-compatible cursor"""
    
    def test_cursor_properties(self):
        """Test cursor has required properties"""
        conn = MySQLConnection(host='localhost', api_endpoint='https://api.workersql.com')
        cursor = conn.cursor()
        
        assert hasattr(cursor, 'rowcount')
        assert hasattr(cursor, 'lastrowid')
        assert hasattr(cursor, 'description')
        
        # Initial values
        assert cursor.rowcount == -1
        assert cursor.lastrowid is None
        assert cursor.description is None
        
        cursor.close()
        conn.close()
    
    def test_cursor_execute_method(self):
        """Test cursor execute method exists"""
        conn = MySQLConnection(host='localhost', api_endpoint='https://api.workersql.com')
        cursor = conn.cursor()
        
        assert hasattr(cursor, 'execute')
        assert callable(cursor.execute)
        
        cursor.close()
        conn.close()
    
    def test_cursor_fetch_methods(self):
        """Test cursor has fetch methods"""
        conn = MySQLConnection(host='localhost', api_endpoint='https://api.workersql.com')
        cursor = conn.cursor()
        
        assert hasattr(cursor, 'fetchone')
        assert hasattr(cursor, 'fetchall')
        assert hasattr(cursor, 'fetchmany')
        assert callable(cursor.fetchone)
        assert callable(cursor.fetchall)
        assert callable(cursor.fetchmany)
        
        cursor.close()
        conn.close()
    
    def test_cursor_context_manager(self):
        """Test cursor as context manager"""
        conn = MySQLConnection(host='localhost', api_endpoint='https://api.workersql.com')
        
        with conn.cursor() as cursor:
            assert cursor is not None
        
        conn.close()
    
    def test_cursor_iterator(self):
        """Test cursor is iterable"""
        conn = MySQLConnection(host='localhost', api_endpoint='https://api.workersql.com')
        cursor = conn.cursor()
        
        assert hasattr(cursor, '__iter__')
        assert hasattr(cursor, '__next__')
        
        cursor.close()
        conn.close()


class TestConnectionPool:
    """Test connection pooling"""
    
    def test_create_pool(self):
        """Test creating connection pool"""
        pool = ConnectionPool(
            pool_name='test_pool',
            pool_size=5,
            host='localhost',
            api_endpoint='https://api.workersql.com',
        )
        
        assert pool is not None
        assert pool.pool_name == 'test_pool'
        assert pool.pool_size == 5
        
        pool.close()
    
    def test_get_connection_from_pool(self):
        """Test getting connection from pool"""
        pool = ConnectionPool(
            pool_size=2,
            host='localhost',
            api_endpoint='https://api.workersql.com',
        )
        
        conn = pool.get_connection()
        assert conn is not None
        assert isinstance(conn, MySQLConnection)
        
        pool.close()


class TestModuleFunctions:
    """Test module-level functions"""
    
    def test_connect_function(self):
        """Test connect() function"""
        conn = connect(
            host='localhost',
            user='root',
            api_endpoint='https://api.workersql.com',
        )
        
        assert conn is not None
        assert isinstance(conn, MySQLConnection)
        
        conn.close()
    
    def test_parse_dsn_function(self):
        """Test parse_dsn() function"""
        config = parse_dsn('workersql://localhost/testdb')
        
        assert config is not None
        assert isinstance(config, dict)
        assert 'host' in config
        assert 'database' in config


class TestExceptions:
    """Test exception classes"""
    
    def test_exception_hierarchy(self):
        """Test exception class hierarchy"""
        # All exceptions should inherit from Error
        assert issubclass(DatabaseError, Error)
        
        # Test that exceptions can be raised
        with pytest.raises(Error):
            raise Error("Test error")
        
        with pytest.raises(DatabaseError):
            raise DatabaseError("Test database error")

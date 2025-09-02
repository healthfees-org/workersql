"""
Tests for WorkerSQL Python SDK
"""

import pytest  # type: ignore
from typing import Dict, Any
from unittest.mock import Mock, patch
from workersql_client import (
    WorkerSQLClient,
    SchemaValidator,
    ValidationError,
    DatabaseConfig,
    QueryRequest,
    QueryResponse,
)


class TestSchemaValidator:
    def test_validate_database_config(self) -> None:
        config: Dict[str, Any] = {
            "host": "localhost",
            "username": "user",
            "password": "pass",
            "database": "testdb",
        }

        result = SchemaValidator.validate_database_config(config)
        assert isinstance(result, DatabaseConfig)
        assert result.host == "localhost"

    def test_validate_query_request(self) -> None:
        request: Dict[str, Any] = {
            "sql": "SELECT * FROM users",
            "params": [],
            "timeout": 30000,
        }

        result = SchemaValidator.validate_query_request(request)
        assert isinstance(result, QueryRequest)
        assert result.sql == "SELECT * FROM users"

    def test_sanitize_sql_valid(self) -> None:
        sql = "SELECT * FROM users WHERE id = ?"
        result = SchemaValidator.sanitize_sql(sql)
        assert result == sql

    def test_sanitize_sql_invalid(self) -> None:
        sql = "SELECT * FROM users; DROP TABLE users;"
        with pytest.raises(ValidationError):  # type: ignore
            SchemaValidator.sanitize_sql(sql)


class TestWorkerSQLClient:
    @pytest.fixture  # type: ignore
    def mock_config(self) -> Dict[str, Any]:
        return {
            "api_endpoint": "https://test.com/api",
            "host": "localhost",
            "username": "user",
            "password": "pass",
            "database": "testdb",
        }

    @patch('workersql_client.requests.Session')
    def test_client_initialization(self, mock_session: Mock, mock_config: Dict[str, Any]) -> None:
        mock_session_instance = Mock()
        mock_session.return_value = mock_session_instance

        client = WorkerSQLClient(mock_config)
        assert client.config["api_endpoint"] == "https://test.com/api"
        assert client.session == mock_session_instance

    @patch('workersql_client.requests.Session')
    def test_query_success(self, mock_session: Mock, mock_config: Dict[str, Any]) -> None:
        # Mock the session and response
        mock_session_instance = Mock()
        mock_response = Mock()
        mock_response.raise_for_status.return_value = None
        mock_response.json.return_value = {
            "success": True,
            "data": [{"id": 1, "name": "Test User"}],
            "row_count": 1,
            "execution_time": 0.1,
        }
        mock_session_instance.post.return_value = mock_response
        mock_session.return_value = mock_session_instance

        client = WorkerSQLClient(mock_config)
        result = client.query("SELECT * FROM users")

        assert isinstance(result, QueryResponse)
        assert result.success is True
        assert result.data == [{"id": 1, "name": "Test User"}]

    @patch('workersql_client.requests.Session')
    def test_query_with_params(self, mock_session: Mock, mock_config: Dict[str, Any]) -> None:
        mock_session_instance = Mock()
        mock_response = Mock()
        mock_response.raise_for_status.return_value = None
        mock_response.json.return_value = {
            "success": True,
            "data": [{"id": 1}],
            "row_count": 1,
        }
        mock_session_instance.post.return_value = mock_response
        mock_session.return_value = mock_session_instance

        client = WorkerSQLClient(mock_config)
        result = client.query("SELECT * FROM users WHERE id = ?", [1])

        assert result.success is True
        # Verify the request was made with correct data
        call_args = mock_session_instance.post.call_args
        request_data = call_args[1]["json"]
        assert request_data["sql"] == "SELECT * FROM users WHERE id = ?"
        assert request_data["params"] == [1]

    @patch('workersql_client.requests.Session')
    def test_health_check(self, mock_session: Mock, mock_config: Dict[str, Any]) -> None:
        mock_session_instance = Mock()
        mock_response = Mock()
        mock_response.raise_for_status.return_value = None
        mock_response.json.return_value = {
            "status": "healthy",
            "database": {"status": "ok"},
            "cache": {"status": "ok"},
            "timestamp": "2025-09-01T12:00:00Z",
        }
        mock_session_instance.get.return_value = mock_response
        mock_session.return_value = mock_session_instance

        client = WorkerSQLClient(mock_config)
        result = client.health_check()

        assert result.status == "healthy"
        assert result.database["status"] == "ok"


class TestDataClasses:
    def test_database_config_defaults(self) -> None:
        config = DatabaseConfig(
            host="localhost",
            username="user",
            password="pass",
            database="testdb"
        )

        assert config.port == 3306
        assert config.ssl is True
        assert config.timeout == 30000

    def test_query_request_post_init(self) -> None:
        request = QueryRequest(sql="SELECT 1")
        assert request.params == []

    def test_query_response_structure(self) -> None:
        response = QueryResponse(
            success=True,
            data=[{"result": 1}],
            row_count=1,
            execution_time=0.05,
        )

        assert response.success is True
        assert response.data == [{"result": 1}]
        assert response.row_count == 1
        assert response.execution_time == 0.05
        assert response.cached is False
        assert response.error is None


if __name__ == "__main__":
    pytest.main([__file__])  # type: ignore

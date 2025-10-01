"""
Tests for DSN Parser
"""

import pytest
from workersql_client.dsn_parser import DSNParser, ParsedDSN


class TestDSNParser:
    def test_parse_basic_dsn(self) -> None:
        dsn = "workersql://api.workersql.com/mydb"
        parsed = DSNParser.parse(dsn)

        assert parsed.protocol == "workersql"
        assert parsed.host == "api.workersql.com"
        assert parsed.database == "mydb"
        assert parsed.port is None
        assert parsed.username is None
        assert parsed.password is None

    def test_parse_dsn_with_credentials(self) -> None:
        dsn = "workersql://user:pass@api.workersql.com/mydb"
        parsed = DSNParser.parse(dsn)

        assert parsed.username == "user"
        assert parsed.password == "pass"
        assert parsed.host == "api.workersql.com"
        assert parsed.database == "mydb"

    def test_parse_dsn_with_port(self) -> None:
        dsn = "workersql://api.workersql.com:8787/mydb"
        parsed = DSNParser.parse(dsn)

        assert parsed.host == "api.workersql.com"
        assert parsed.port == 8787
        assert parsed.database == "mydb"

    def test_parse_dsn_with_query_parameters(self) -> None:
        dsn = "workersql://api.workersql.com/mydb?apiKey=abc123&ssl=false&timeout=5000"
        parsed = DSNParser.parse(dsn)

        assert parsed.params["apiKey"] == "abc123"
        assert parsed.params["ssl"] == "false"
        assert parsed.params["timeout"] == "5000"

    def test_parse_dsn_with_special_characters(self) -> None:
        dsn = "workersql://user%40name:p%40ss%3Aword@api.workersql.com/mydb"
        parsed = DSNParser.parse(dsn)

        assert parsed.username == "user@name"
        assert parsed.password == "p@ss:word"

    def test_parse_dsn_without_database(self) -> None:
        dsn = "workersql://api.workersql.com"
        parsed = DSNParser.parse(dsn)

        assert parsed.host == "api.workersql.com"
        assert parsed.database is None

    def test_parse_dsn_with_slash_only(self) -> None:
        dsn = "workersql://api.workersql.com/"
        parsed = DSNParser.parse(dsn)

        assert parsed.host == "api.workersql.com"
        assert parsed.database is None

    def test_invalid_protocol(self) -> None:
        dsn = "mysql://api.workersql.com/mydb"
        with pytest.raises(ValueError, match="Invalid protocol"):
            DSNParser.parse(dsn)

    def test_empty_dsn(self) -> None:
        with pytest.raises(ValueError, match="non-empty string"):
            DSNParser.parse("")

    def test_malformed_dsn(self) -> None:
        dsn = "not-a-valid-url"
        with pytest.raises(ValueError):
            DSNParser.parse(dsn)

    def test_dsn_without_host(self) -> None:
        # This will fail during parsing
        dsn = "workersql:///mydb"
        with pytest.raises(ValueError):
            DSNParser.parse(dsn)


class TestGetApiEndpoint:
    def test_construct_https_endpoint_by_default(self) -> None:
        parsed = DSNParser.parse("workersql://api.workersql.com/mydb")
        endpoint = DSNParser.get_api_endpoint(parsed)

        assert endpoint == "https://api.workersql.com/v1"

    def test_construct_http_endpoint_when_ssl_false(self) -> None:
        parsed = DSNParser.parse("workersql://api.workersql.com/mydb?ssl=false")
        endpoint = DSNParser.get_api_endpoint(parsed)

        assert endpoint == "http://api.workersql.com/v1"

    def test_include_port_in_endpoint(self) -> None:
        parsed = DSNParser.parse("workersql://api.workersql.com:8787/mydb")
        endpoint = DSNParser.get_api_endpoint(parsed)

        assert endpoint == "https://api.workersql.com:8787/v1"

    def test_use_provided_api_endpoint(self) -> None:
        parsed = DSNParser.parse(
            "workersql://api.workersql.com/mydb?apiEndpoint=https://custom.endpoint.com/api"
        )
        endpoint = DSNParser.get_api_endpoint(parsed)

        assert endpoint == "https://custom.endpoint.com/api"

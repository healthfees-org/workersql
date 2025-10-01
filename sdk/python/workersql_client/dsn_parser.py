"""
DSN Parser for WorkerSQL
Parses connection strings in the format:
workersql://[username[:password]@]host[:port][/database][?param1=value1&param2=value2]
"""

from typing import Dict, Optional
from urllib.parse import parse_qs, unquote, urlparse


class ParsedDSN:
    """Parsed DSN components"""

    def __init__(
        self,
        protocol: str,
        host: str,
        port: Optional[int] = None,
        username: Optional[str] = None,
        password: Optional[str] = None,
        database: Optional[str] = None,
        params: Optional[Dict[str, str]] = None,
    ):
        self.protocol = protocol
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.database = database
        self.params = params or {}


class DSNParser:
    """DSN Parser for WorkerSQL connection strings"""

    @staticmethod
    def parse(dsn: str) -> ParsedDSN:
        """
        Parse a WorkerSQL DSN string
        
        Args:
            dsn: Connection string to parse
            
        Returns:
            ParsedDSN: Parsed DSN components
            
        Raises:
            ValueError: If DSN format is invalid
        """
        if not dsn or not isinstance(dsn, str):
            raise ValueError("DSN must be a non-empty string")

        try:
            parsed = urlparse(dsn)
        except Exception as e:
            raise ValueError(f"Invalid DSN format: {e}")

        # Validate protocol
        if parsed.scheme.lower() != "workersql":
            raise ValueError(
                f"Invalid protocol: {parsed.scheme}. Expected 'workersql'"
            )

        if not parsed.hostname:
            raise ValueError("Host is required in DSN")

        # Parse query parameters
        params: Dict[str, str] = {}
        if parsed.query:
            parsed_qs = parse_qs(parsed.query)
            # Convert list values to single strings
            for key, values in parsed_qs.items():
                if values:
                    params[key] = values[0]

        # Extract database from path
        database = None
        if parsed.path and parsed.path != "/":
            database = parsed.path.lstrip("/")

        return ParsedDSN(
            protocol=parsed.scheme,
            username=unquote(parsed.username) if parsed.username else None,
            password=unquote(parsed.password) if parsed.password else None,
            host=parsed.hostname,
            port=parsed.port,
            database=database,
            params=params,
        )

    @staticmethod
    def get_api_endpoint(parsed: ParsedDSN) -> str:
        """
        Extract API endpoint from DSN parameters or construct from host
        
        Args:
            parsed: Parsed DSN components
            
        Returns:
            str: API endpoint URL
        """
        # Check if apiEndpoint is specified in params
        if "apiEndpoint" in parsed.params:
            return parsed.params["apiEndpoint"]

        # Construct from host
        protocol = "http" if parsed.params.get("ssl") == "false" else "https"
        port = f":{parsed.port}" if parsed.port else ""
        return f"{protocol}://{parsed.host}{port}/v1"

#!/usr/bin/env python3
"""
Example usage of WorkerSQL Python SDK
"""

from typing import Dict, Any, List
from workersql_client import WorkerSQLClient, ValidationError

def main() -> None:
    # Configuration
    config: Dict[str, Any] = {
        "api_endpoint": "https://your-workersql-endpoint.com/api",
        "host": "localhost",
        "username": "your-username",
        "password": "your-password",
        "database": "your-database",
        "port": 3306,
        "ssl": True,
        "timeout": 30000,
    }

    try:
        with WorkerSQLClient(config) as client:
            print("🔗 Connected to WorkerSQL")

            # Simple query
            print("\n📊 Executing simple query...")
            result = client.query("SELECT 1 as test_value")
            print(f"Result: {result.data}")

            # Query with parameters
            print("\n🔍 Query with parameters...")
            result = client.query(
                "SELECT * FROM users WHERE id = ? AND status = ?",
                [1, "active"]
            )
            print(f"Found {result.row_count} users")

            # Batch queries
            print("\n📦 Executing batch queries...")
            queries: List[Dict[str, Any]] = [
                {
                    "sql": "INSERT INTO logs (action, user_id) VALUES (?, ?)",
                    "params": ["login", 1]
                },
                {
                    "sql": "SELECT COUNT(*) as total FROM logs",
                    "params": []
                }
            ]

            batch_result = client.batch_query(queries)
            print(f"Batch executed in {batch_result.total_execution_time:.2f}s")

            # Health check
            print("\n🏥 Health check...")
            health = client.health_check()
            print(f"Status: {health.status}")

    except ValidationError as e:
        print(f"❌ Validation error: {e.code} - {str(e)}")
    except Exception as e:
        print(f"❌ Unexpected error: {e}")

if __name__ == "__main__":
    main()

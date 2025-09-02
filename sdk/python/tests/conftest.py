"""
Pytest configuration for WorkerSQL Python SDK tests
"""

from typing import Generator

try:
    import pytest  # type: ignore

    @pytest.fixture(autouse=True)  # type: ignore
    def setup_test_env() -> Generator[None, None, None]:
        """Set up test environment variables and configurations"""
        # Add any test setup here if needed
        yield
except ImportError:
    # pytest not available, skip fixture definition
    pass

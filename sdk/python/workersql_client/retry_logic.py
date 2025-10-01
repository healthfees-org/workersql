"""
Retry Logic with Exponential Backoff for WorkerSQL
Handles automatic retries for transient errors
"""

import random
import time
from typing import Any, Callable, List, Optional, TypeVar

from .workersql_client import ValidationError

T = TypeVar("T")

DEFAULT_RETRYABLE_ERRORS = [
    "CONNECTION_ERROR",
    "TIMEOUT_ERROR",
    "RESOURCE_LIMIT",
]


class RetryStrategy:
    """Retry strategy with exponential backoff"""

    def __init__(
        self,
        max_attempts: int = 3,
        initial_delay: float = 1.0,
        max_delay: float = 30.0,
        backoff_multiplier: float = 2.0,
        retryable_errors: Optional[List[str]] = None,
    ):
        """
        Initialize retry strategy

        Args:
            max_attempts: Maximum number of retry attempts
            initial_delay: Initial delay in seconds
            max_delay: Maximum delay in seconds
            backoff_multiplier: Multiplier for exponential backoff
            retryable_errors: List of error codes that should trigger a retry
        """
        self.max_attempts = max_attempts
        self.initial_delay = initial_delay
        self.max_delay = max_delay
        self.backoff_multiplier = backoff_multiplier
        self.retryable_errors = retryable_errors or DEFAULT_RETRYABLE_ERRORS

    def is_retryable(self, error: Exception) -> bool:
        """
        Check if an error is retryable

        Args:
            error: The exception to check

        Returns:
            bool: True if the error should trigger a retry
        """
        if isinstance(error, ValidationError):
            return error.code in self.retryable_errors

        # Check for common network/connection errors
        error_msg = str(error).lower()
        network_errors = [
            "connection",
            "timeout",
            "refused",
            "reset",
            "unreachable",
        ]
        return any(err in error_msg for err in network_errors)

    def calculate_delay(self, attempt: int) -> float:
        """
        Calculate delay for a given attempt

        Args:
            attempt: Current attempt number (0-indexed)

        Returns:
            float: Delay in seconds
        """
        delay = self.initial_delay * (self.backoff_multiplier**attempt)
        return min(delay, self.max_delay)

    def add_jitter(self, delay: float) -> float:
        """
        Add jitter to prevent thundering herd

        Args:
            delay: Base delay in seconds

        Returns:
            float: Delay with jitter added
        """
        jitter = random.random() * 0.3 * delay  # Up to 30% jitter
        return delay + jitter

    def execute(self, fn: Callable[[], T], context: Optional[str] = None) -> T:
        """
        Execute a function with retry logic

        Args:
            fn: Function to execute
            context: Optional context string for logging

        Returns:
            Result of the function

        Raises:
            ValidationError: If all retry attempts fail
        """
        last_error: Optional[Exception] = None

        for attempt in range(self.max_attempts):
            try:
                return fn()
            except Exception as error:
                last_error = error

                # Check if we should retry
                if not self.is_retryable(error):
                    raise

                # Check if we've exhausted retries
                if attempt == self.max_attempts - 1:
                    context_str = f" ({context})" if context else ""
                    raise ValidationError(
                        "CONNECTION_ERROR",
                        f"Failed after {self.max_attempts} attempts{context_str}",
                        {"original_error": str(error), "attempts": attempt + 1},
                    )

                # Calculate and apply delay
                delay = self.calculate_delay(attempt)
                delay_with_jitter = self.add_jitter(delay)

                context_str = f" ({context})" if context else ""
                print(
                    f"[WorkerSQL Retry] Attempt {attempt + 1}/{self.max_attempts} failed{context_str}. "
                    f"Retrying in {delay_with_jitter:.2f}s..."
                )

                time.sleep(delay_with_jitter)

        # This should never be reached, but just in case
        if last_error:
            raise last_error
        raise ValidationError("INTERNAL_ERROR", "Unexpected retry failure")

"""
Tests for Retry Logic
"""

import pytest
import time
from workersql_client.retry_logic import RetryStrategy
from workersql_client import ValidationError


class TestRetryStrategy:
    def test_initialization_with_defaults(self):
        strategy = RetryStrategy()
        assert strategy.max_attempts == 3
        assert strategy.initial_delay == 1.0

    def test_initialization_with_custom_options(self):
        strategy = RetryStrategy(
            max_attempts=5,
            initial_delay=0.5,
            max_delay=10.0,
        )
        assert strategy.max_attempts == 5
        assert strategy.initial_delay == 0.5
        assert strategy.max_delay == 10.0

    def test_is_retryable_with_validation_error(self):
        strategy = RetryStrategy()
        
        error = ValidationError("CONNECTION_ERROR", "Connection failed")
        assert strategy.is_retryable(error) is True
        
        error2 = ValidationError("INVALID_QUERY", "Bad SQL")
        assert strategy.is_retryable(error2) is False

    def test_is_retryable_with_network_errors(self):
        strategy = RetryStrategy()
        
        assert strategy.is_retryable(Exception("connection refused")) is True
        assert strategy.is_retryable(Exception("timeout occurred")) is True
        assert strategy.is_retryable(Exception("connection reset")) is True
        assert strategy.is_retryable(Exception("unreachable host")) is True

    def test_is_not_retryable_with_generic_error(self):
        strategy = RetryStrategy()
        
        error = Exception("Some random error")
        assert strategy.is_retryable(error) is False

    def test_calculate_delay_exponential_backoff(self):
        strategy = RetryStrategy(
            initial_delay=1.0,
            backoff_multiplier=2.0
        )
        
        assert strategy.calculate_delay(0) == 1.0
        assert strategy.calculate_delay(1) == 2.0
        assert strategy.calculate_delay(2) == 4.0
        assert strategy.calculate_delay(3) == 8.0

    def test_calculate_delay_capped_at_max(self):
        strategy = RetryStrategy(
            initial_delay=1.0,
            max_delay=5.0,
            backoff_multiplier=2.0
        )
        
        assert strategy.calculate_delay(0) == 1.0
        assert strategy.calculate_delay(1) == 2.0
        assert strategy.calculate_delay(2) == 4.0
        assert strategy.calculate_delay(3) == 5.0  # Capped
        assert strategy.calculate_delay(4) == 5.0  # Capped

    def test_add_jitter(self):
        strategy = RetryStrategy()
        
        delay = 1.0
        jittered = strategy.add_jitter(delay)
        
        assert jittered >= delay
        assert jittered <= delay * 1.3  # Up to 30% jitter

    def test_add_jitter_produces_different_values(self):
        strategy = RetryStrategy()
        
        delay = 1.0
        jittered1 = strategy.add_jitter(delay)
        jittered2 = strategy.add_jitter(delay)
        
        # Very unlikely to be exactly the same
        assert jittered1 != jittered2

    def test_execute_success_on_first_try(self):
        strategy = RetryStrategy()
        
        call_count = [0]
        
        def fn():
            call_count[0] += 1
            return "success"
        
        result = strategy.execute(fn)
        
        assert result == "success"
        assert call_count[0] == 1

    def test_execute_with_retries(self):
        strategy = RetryStrategy(
            max_attempts=3,
            initial_delay=0.01  # Short delay for testing
        )
        
        call_count = [0]
        
        def fn():
            call_count[0] += 1
            if call_count[0] < 3:
                raise ValidationError("CONNECTION_ERROR", "Failed")
            return "success"
        
        result = strategy.execute(fn)
        
        assert result == "success"
        assert call_count[0] == 3

    def test_execute_does_not_retry_non_retryable(self):
        strategy = RetryStrategy()
        
        call_count = [0]
        
        def fn():
            call_count[0] += 1
            raise ValidationError("INVALID_QUERY", "Bad SQL")
        
        with pytest.raises(ValidationError, match="Bad SQL"):
            strategy.execute(fn)
        
        assert call_count[0] == 1

    def test_execute_throws_after_max_attempts(self):
        strategy = RetryStrategy(
            max_attempts=3,
            initial_delay=0.01
        )
        
        call_count = [0]
        
        def fn():
            call_count[0] += 1
            raise ValidationError("CONNECTION_ERROR", "Always fails")
        
        with pytest.raises(ValidationError, match="Failed after 3 attempts"):
            strategy.execute(fn)
        
        assert call_count[0] == 3

    def test_execute_with_context(self):
        strategy = RetryStrategy(
            max_attempts=2,
            initial_delay=0.01
        )
        
        def fn():
            raise ValidationError("CONNECTION_ERROR", "Failed")
        
        with pytest.raises(ValidationError, match="test operation"):
            strategy.execute(fn, context="test operation")

    def test_execute_waits_between_retries(self):
        strategy = RetryStrategy(
            max_attempts=3,
            initial_delay=0.1
        )
        
        call_count = [0]
        
        def fn():
            call_count[0] += 1
            if call_count[0] < 2:
                raise ValidationError("CONNECTION_ERROR", "Failed")
            return "success"
        
        start_time = time.time()
        strategy.execute(fn)
        elapsed = time.time() - start_time
        
        # Should have waited at least the initial delay
        assert elapsed >= 0.1
        assert call_count[0] == 2

    def test_execute_with_multiple_error_types(self):
        strategy = RetryStrategy(
            max_attempts=4,
            initial_delay=0.01
        )
        
        call_count = [0]
        
        def fn():
            call_count[0] += 1
            if call_count[0] == 1:
                raise ValidationError("CONNECTION_ERROR", "Failed")
            elif call_count[0] == 2:
                raise Exception("timeout")
            elif call_count[0] == 3:
                raise ValidationError("TIMEOUT_ERROR", "Timed out")
            return "success"
        
        result = strategy.execute(fn)
        
        assert result == "success"
        assert call_count[0] == 4

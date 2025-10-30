package com.workersql.sdk.unit;

import com.workersql.sdk.retry.RetryStrategy;
import com.workersql.sdk.types.ErrorCode;
import com.workersql.sdk.types.ValidationError;
import org.junit.jupiter.api.Test;

import java.util.concurrent.Callable;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for Retry Strategy
 */
class RetryStrategyTest {

    @Test
    void testSuccessfulExecutionFirstAttempt() throws Exception {
        RetryStrategy strategy = new RetryStrategy.Builder()
            .maxAttempts(3)
            .initialDelayMs(100)
            .build();

        AtomicInteger attempts = new AtomicInteger(0);
        String result = strategy.execute(() -> {
            attempts.incrementAndGet();
            return "success";
        });

        assertEquals("success", result);
        assertEquals(1, attempts.get());
    }

    @Test
    void testRetryOnConnectionError() throws Exception {
        RetryStrategy strategy = new RetryStrategy.Builder()
            .maxAttempts(3)
            .initialDelayMs(50)
            .build();

        AtomicInteger attempts = new AtomicInteger(0);
        String result = strategy.execute(() -> {
            int attempt = attempts.incrementAndGet();
            if (attempt < 3) {
                throw new ValidationError(ErrorCode.CONNECTION_ERROR, "Connection failed");
            }
            return "success";
        });

        assertEquals("success", result);
        assertEquals(3, attempts.get());
    }

    @Test
    void testNoRetryOnNonRetryableError() {
        RetryStrategy strategy = new RetryStrategy.Builder()
            .maxAttempts(3)
            .build();

        AtomicInteger attempts = new AtomicInteger(0);
        ValidationError thrown = assertThrows(ValidationError.class, () -> {
            strategy.execute(() -> {
                attempts.incrementAndGet();
                throw new ValidationError(ErrorCode.AUTH_ERROR, "Auth failed");
            });
        });

        assertEquals(ErrorCode.AUTH_ERROR, thrown.getCode());
        assertEquals(1, attempts.get());
    }

    @Test
    void testMaxAttemptsExhausted() {
        RetryStrategy strategy = new RetryStrategy.Builder()
            .maxAttempts(3)
            .initialDelayMs(50)
            .build();

        AtomicInteger attempts = new AtomicInteger(0);
        ValidationError thrown = assertThrows(ValidationError.class, () -> {
            strategy.execute(() -> {
                attempts.incrementAndGet();
                throw new ValidationError(ErrorCode.TIMEOUT_ERROR, "Timeout");
            });
        });

        assertEquals(ErrorCode.CONNECTION_ERROR, thrown.getCode());
        assertTrue(thrown.getMessage().contains("Failed after 3 attempts"));
        assertEquals(3, attempts.get());
    }

    @Test
    void testIsRetryable() {
        RetryStrategy strategy = new RetryStrategy.Builder().build();

        assertTrue(strategy.isRetryable(new ValidationError(ErrorCode.CONNECTION_ERROR, "test")));
        assertTrue(strategy.isRetryable(new ValidationError(ErrorCode.TIMEOUT_ERROR, "test")));
        assertTrue(strategy.isRetryable(new ValidationError(ErrorCode.RESOURCE_LIMIT, "test")));

        assertFalse(strategy.isRetryable(new ValidationError(ErrorCode.AUTH_ERROR, "test")));
        assertFalse(strategy.isRetryable(new ValidationError(ErrorCode.PERMISSION_ERROR, "test")));
        assertFalse(strategy.isRetryable(new ValidationError(ErrorCode.INVALID_QUERY, "test")));
    }

    @Test
    void testCalculateDelay() {
        RetryStrategy strategy = new RetryStrategy.Builder()
            .initialDelayMs(1000)
            .maxDelayMs(30000)
            .backoffMultiplier(2.0)
            .build();

        assertEquals(1000, strategy.calculateDelay(0));
        assertEquals(2000, strategy.calculateDelay(1));
        assertEquals(4000, strategy.calculateDelay(2));
        assertEquals(8000, strategy.calculateDelay(3));

        // Should not exceed max delay
        assertTrue(strategy.calculateDelay(10) <= 30000);
    }

    @Test
    void testAddJitter() {
        RetryStrategy strategy = new RetryStrategy.Builder().build();

        long delay = 1000;
        for (int i = 0; i < 100; i++) {
            long jitteredDelay = strategy.addJitter(delay);
            // Jitter should be between delay and delay + 30%
            assertTrue(jitteredDelay >= delay);
            assertTrue(jitteredDelay <= delay * 1.3);
        }
    }

    @Test
    void testRetryWithContext() {
        RetryStrategy strategy = new RetryStrategy.Builder()
            .maxAttempts(2)
            .initialDelayMs(50)
            .build();

        AtomicInteger attempts = new AtomicInteger(0);
        ValidationError thrown = assertThrows(ValidationError.class, () -> {
            strategy.execute(() -> {
                attempts.incrementAndGet();
                throw new ValidationError(ErrorCode.CONNECTION_ERROR, "Failed");
            }, "test-context");
        });

        assertTrue(thrown.getMessage().contains("test-context"));
        assertEquals(2, attempts.get());
    }

    @Test
    void testRetryOnExceptionWithMessage() throws Exception {
        RetryStrategy strategy = new RetryStrategy.Builder()
            .maxAttempts(3)
            .initialDelayMs(50)
            .build();

        AtomicInteger attempts = new AtomicInteger(0);
        String result = strategy.execute(() -> {
            int attempt = attempts.incrementAndGet();
            if (attempt < 3) {
                throw new RuntimeException("ECONNREFUSED: Connection refused");
            }
            return "success";
        });

        assertEquals("success", result);
        assertEquals(3, attempts.get());
    }
}

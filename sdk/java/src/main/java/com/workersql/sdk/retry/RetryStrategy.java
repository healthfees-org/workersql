package com.workersql.sdk.retry;

import com.workersql.sdk.types.ErrorCode;
import com.workersql.sdk.types.ValidationError;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.Callable;

/**
 * Retry strategy with exponential backoff for WorkerSQL
 * Handles automatic retries for transient errors
 */
public class RetryStrategy {
    private static final Logger logger = LoggerFactory.getLogger(RetryStrategy.class);

    private static final Set<String> DEFAULT_RETRYABLE_ERRORS = new HashSet<>(Arrays.asList(
        "CONNECTION_ERROR",
        "TIMEOUT_ERROR",
        "RESOURCE_LIMIT",
        "ECONNREFUSED",
        "ECONNRESET",
        "ETIMEDOUT",
        "ENETUNREACH"
    ));

    private final int maxAttempts;
    private final long initialDelayMs;
    private final long maxDelayMs;
    private final double backoffMultiplier;
    private final Set<String> retryableErrors;

    public RetryStrategy(int maxAttempts, long initialDelayMs, long maxDelayMs, double backoffMultiplier) {
        this(maxAttempts, initialDelayMs, maxDelayMs, backoffMultiplier, DEFAULT_RETRYABLE_ERRORS);
    }

    public RetryStrategy(int maxAttempts, long initialDelayMs, long maxDelayMs, double backoffMultiplier, Set<String> retryableErrors) {
        this.maxAttempts = maxAttempts;
        this.initialDelayMs = initialDelayMs;
        this.maxDelayMs = maxDelayMs;
        this.backoffMultiplier = backoffMultiplier;
        this.retryableErrors = retryableErrors;
    }

    /**
     * Check if an error is retryable
     */
    public boolean isRetryable(Exception error) {
        if (error instanceof ValidationError) {
            ValidationError validationError = (ValidationError) error;
            return retryableErrors.contains(validationError.getCode().name());
        }

        String message = error.getMessage();
        if (message != null) {
            for (String retryableError : retryableErrors) {
                if (message.contains(retryableError)) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Calculate delay for a given attempt
     */
    public long calculateDelay(int attempt) {
        long delay = (long) (initialDelayMs * Math.pow(backoffMultiplier, attempt));
        return Math.min(delay, maxDelayMs);
    }

    /**
     * Add jitter to prevent thundering herd
     */
    public long addJitter(long delay) {
        double jitter = Math.random() * 0.3 * delay; // Up to 30% jitter
        return delay + (long) jitter;
    }

    /**
     * Execute a function with retry logic
     */
    public <T> T execute(Callable<T> callable, String context) throws Exception {
        Exception lastError = null;

        for (int attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                return callable.call();
            } catch (Exception error) {
                lastError = error;

                // Check if we should retry
                if (!isRetryable(error)) {
                    throw error;
                }

                // Check if we've exhausted retries
                if (attempt == maxAttempts - 1) {
                    String contextMsg = context != null ? " (" + context + ")" : "";
                    throw new ValidationError(
                        ErrorCode.CONNECTION_ERROR,
                        "Failed after " + maxAttempts + " attempts" + contextMsg
                    );
                }

                // Calculate and apply delay
                long delay = calculateDelay(attempt);
                long delayWithJitter = addJitter(delay);

                String contextMsg = context != null ? " (" + context + ")" : "";
                logger.debug("[WorkerSQL Retry] Attempt {}/{} failed{}. Retrying in {}ms...",
                    attempt + 1, maxAttempts, contextMsg, Math.round(delayWithJitter));

                try {
                    Thread.sleep(delayWithJitter);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw new ValidationError(ErrorCode.INTERNAL_ERROR, "Retry interrupted");
                }
            }
        }

        throw lastError;
    }

    /**
     * Execute a function with retry logic (no context)
     */
    public <T> T execute(Callable<T> callable) throws Exception {
        return execute(callable, null);
    }

    public static class Builder {
        private int maxAttempts = 3;
        private long initialDelayMs = 1000;
        private long maxDelayMs = 30000;
        private double backoffMultiplier = 2.0;
        private Set<String> retryableErrors = DEFAULT_RETRYABLE_ERRORS;

        public Builder maxAttempts(int maxAttempts) {
            this.maxAttempts = maxAttempts;
            return this;
        }

        public Builder initialDelayMs(long initialDelayMs) {
            this.initialDelayMs = initialDelayMs;
            return this;
        }

        public Builder maxDelayMs(long maxDelayMs) {
            this.maxDelayMs = maxDelayMs;
            return this;
        }

        public Builder backoffMultiplier(double backoffMultiplier) {
            this.backoffMultiplier = backoffMultiplier;
            return this;
        }

        public Builder retryableErrors(Set<String> retryableErrors) {
            this.retryableErrors = retryableErrors;
            return this;
        }

        public RetryStrategy build() {
            return new RetryStrategy(maxAttempts, initialDelayMs, maxDelayMs, backoffMultiplier, retryableErrors);
        }
    }
}

<?php

declare(strict_types=1);

namespace WorkerSQL;

/**
 * Retry strategy with exponential backoff
 */
class RetryStrategy
{
    private int $maxAttempts;
    private float $initialDelay;
    private float $maxDelay;
    private float $backoffMultiplier;
    private array $retryableErrors;

    public function __construct(
        int $maxAttempts = 3,
        float $initialDelay = 1.0,
        float $maxDelay = 30.0,
        float $backoffMultiplier = 2.0,
        array $retryableErrors = ['CONNECTION_ERROR', 'TIMEOUT_ERROR', 'RESOURCE_LIMIT']
    ) {
        $this->maxAttempts = $maxAttempts;
        $this->initialDelay = $initialDelay;
        $this->maxDelay = $maxDelay;
        $this->backoffMultiplier = $backoffMultiplier;
        $this->retryableErrors = $retryableErrors;
    }

    /**
     * Check if an error is retryable
     */
    private function isRetryable(\Throwable $error): bool
    {
        if ($error instanceof ValidationException) {
            return in_array($error->getCode(), $this->retryableErrors, true);
        }

        $message = strtolower($error->getMessage());
        $networkErrors = ['connection', 'timeout', 'refused', 'reset', 'unreachable'];
        
        foreach ($networkErrors as $err) {
            if (strpos($message, $err) !== false) {
                return true;
            }
        }

        return false;
    }

    /**
     * Calculate delay for a given attempt
     */
    private function calculateDelay(int $attempt): float
    {
        $delay = $this->initialDelay * pow($this->backoffMultiplier, $attempt);
        return min($delay, $this->maxDelay);
    }

    /**
     * Add jitter to prevent thundering herd
     */
    private function addJitter(float $delay): float
    {
        $jitter = (float)rand(0, 30) / 100 * $delay; // Up to 30% jitter
        return $delay + $jitter;
    }

    /**
     * Execute a callable with retry logic
     * 
     * @param callable $fn Function to execute
     * @param string|null $context Optional context for logging
     * @return mixed Result of the function
     * @throws ValidationException If all retry attempts fail
     */
    public function execute(callable $fn, ?string $context = null)
    {
        $lastError = null;

        for ($attempt = 0; $attempt < $this->maxAttempts; $attempt++) {
            try {
                return $fn();
            } catch (\Throwable $error) {
                $lastError = $error;

                // Check if we should retry
                if (!$this->isRetryable($error)) {
                    throw $error;
                }

                // Check if we've exhausted retries
                if ($attempt === $this->maxAttempts - 1) {
                    $contextStr = $context ? " ({$context})" : "";
                    throw new ValidationException(
                        'CONNECTION_ERROR',
                        "Failed after {$this->maxAttempts} attempts{$contextStr}",
                        ['original_error' => $error->getMessage(), 'attempts' => $attempt + 1]
                    );
                }

                // Calculate and apply delay
                $delay = $this->calculateDelay($attempt);
                $delayWithJitter = $this->addJitter($delay);

                $contextStr = $context ? " ({$context})" : "";
                error_log(
                    "[WorkerSQL Retry] Attempt " . ($attempt + 1) . "/{$this->maxAttempts} failed{$contextStr}. " .
                    "Retrying in " . round($delayWithJitter, 2) . "s..."
                );

                usleep((int)($delayWithJitter * 1000000)); // Convert to microseconds
            }
        }

        // This should never be reached, but just in case
        if ($lastError) {
            throw $lastError;
        }

        throw new ValidationException('INTERNAL_ERROR', 'Unexpected retry failure');
    }
}

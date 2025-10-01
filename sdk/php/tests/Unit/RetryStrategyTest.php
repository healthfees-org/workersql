<?php

declare(strict_types=1);

namespace WorkerSQL\Tests\Unit;

use PHPUnit\Framework\TestCase;
use WorkerSQL\RetryStrategy;
use WorkerSQL\ValidationException;

class RetryStrategyTest extends TestCase
{
    public function testInitializationWithDefaults(): void
    {
        $strategy = new RetryStrategy();
        $this->assertInstanceOf(RetryStrategy::class, $strategy);
    }

    public function testInitializationWithCustomOptions(): void
    {
        $strategy = new RetryStrategy(5, 0.5, 10.0, 2.0);
        $this->assertInstanceOf(RetryStrategy::class, $strategy);
    }

    public function testCalculateDelayExponentialBackoff(): void
    {
        $strategy = new RetryStrategy(3, 1.0, 30.0, 2.0);

        $this->assertEquals(1.0, $strategy->calculateDelay(0));
        $this->assertEquals(2.0, $strategy->calculateDelay(1));
        $this->assertEquals(4.0, $strategy->calculateDelay(2));
        $this->assertEquals(8.0, $strategy->calculateDelay(3));
    }

    public function testCalculateDelayCappedAtMax(): void
    {
        $strategy = new RetryStrategy(5, 1.0, 5.0, 2.0);

        $this->assertEquals(1.0, $strategy->calculateDelay(0));
        $this->assertEquals(2.0, $strategy->calculateDelay(1));
        $this->assertEquals(4.0, $strategy->calculateDelay(2));
        $this->assertEquals(5.0, $strategy->calculateDelay(3)); // Capped
        $this->assertEquals(5.0, $strategy->calculateDelay(4)); // Capped
    }

    public function testAddJitter(): void
    {
        $strategy = new RetryStrategy();

        $delay = 1.0;
        $jittered = $strategy->addJitter($delay);

        $this->assertGreaterThanOrEqual($delay, $jittered);
        $this->assertLessThanOrEqual($delay * 1.3, $jittered); // Up to 30% jitter
    }

    public function testExecuteSuccessOnFirstTry(): void
    {
        $strategy = new RetryStrategy();

        $callCount = 0;
        $fn = function () use (&$callCount) {
            $callCount++;
            return 'success';
        };

        $result = $strategy->execute($fn);

        $this->assertEquals('success', $result);
        $this->assertEquals(1, $callCount);
    }

    public function testExecuteWithRetries(): void
    {
        $strategy = new RetryStrategy(3, 0.01); // Short delay for testing

        $callCount = 0;
        $fn = function () use (&$callCount) {
            $callCount++;
            if ($callCount < 3) {
                throw new ValidationException('CONNECTION_ERROR', 'Failed');
            }
            return 'success';
        };

        $result = $strategy->execute($fn);

        $this->assertEquals('success', $result);
        $this->assertEquals(3, $callCount);
    }

    public function testExecuteDoesNotRetryNonRetryable(): void
    {
        $strategy = new RetryStrategy();

        $callCount = 0;
        $fn = function () use (&$callCount) {
            $callCount++;
            throw new ValidationException('INVALID_QUERY', 'Bad SQL');
        };

        $this->expectException(ValidationException::class);
        $this->expectExceptionMessage('Bad SQL');

        try {
            $strategy->execute($fn);
        } finally {
            $this->assertEquals(1, $callCount);
        }
    }

    public function testExecuteThrowsAfterMaxAttempts(): void
    {
        $strategy = new RetryStrategy(3, 0.01);

        $callCount = 0;
        $fn = function () use (&$callCount) {
            $callCount++;
            throw new ValidationException('CONNECTION_ERROR', 'Always fails');
        };

        $this->expectException(ValidationException::class);
        $this->expectExceptionMessage('Failed after 3 attempts');

        try {
            $strategy->execute($fn);
        } finally {
            $this->assertEquals(3, $callCount);
        }
    }

    public function testExecuteWithContext(): void
    {
        $strategy = new RetryStrategy(2, 0.01);

        $fn = function () {
            throw new ValidationException('CONNECTION_ERROR', 'Failed');
        };

        $this->expectException(ValidationException::class);
        $this->expectExceptionMessage('test operation');

        $strategy->execute($fn, 'test operation');
    }

    public function testIsRetryableWithValidationError(): void
    {
        $strategy = new RetryStrategy();

        $reflection = new \ReflectionClass($strategy);
        $method = $reflection->getMethod('isRetryable');
        $method->setAccessible(true);

        $retryable = new ValidationException('CONNECTION_ERROR', 'Failed');
        $this->assertTrue($method->invoke($strategy, $retryable));

        $nonRetryable = new ValidationException('INVALID_QUERY', 'Bad SQL');
        $this->assertFalse($method->invoke($strategy, $nonRetryable));
    }

    public function testIsRetryableWithNetworkErrors(): void
    {
        $strategy = new RetryStrategy();

        $reflection = new \ReflectionClass($strategy);
        $method = $reflection->getMethod('isRetryable');
        $method->setAccessible(true);

        $this->assertTrue($method->invoke($strategy, new \Exception('connection refused')));
        $this->assertTrue($method->invoke($strategy, new \Exception('timeout occurred')));
        $this->assertTrue($method->invoke($strategy, new \Exception('connection reset')));
        $this->assertTrue($method->invoke($strategy, new \Exception('unreachable host')));
    }

    public function testIsNotRetryableWithGenericError(): void
    {
        $strategy = new RetryStrategy();

        $reflection = new \ReflectionClass($strategy);
        $method = $reflection->getMethod('isRetryable');
        $method->setAccessible(true);

        $this->assertFalse($method->invoke($strategy, new \Exception('Some random error')));
    }
}

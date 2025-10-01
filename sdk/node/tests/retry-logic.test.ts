/**
 * Tests for Retry Logic
 */

import { describe, it, expect, jest } from '@jest/globals';
import { RetryStrategy } from '../src/retry-logic.js';
import { ValidationError } from '../../schema/validator.js';

describe('RetryStrategy', () => {
  describe('initialization', () => {
    it('should create with default options', () => {
      const strategy = new RetryStrategy();
      expect(strategy).toBeDefined();
    });

    it('should create with custom options', () => {
      const strategy = new RetryStrategy({
        maxAttempts: 5,
        initialDelay: 500,
        maxDelay: 10000,
      });
      expect(strategy).toBeDefined();
    });
  });

  describe('isRetryable', () => {
    const strategy = new RetryStrategy();

    it('should identify retryable ValidationErrors', () => {
      const error = new ValidationError('CONNECTION_ERROR', 'Connection failed');
      expect(strategy.isRetryable(error)).toBe(true);
    });

    it('should identify non-retryable ValidationErrors', () => {
      const error = new ValidationError('INVALID_QUERY', 'Invalid SQL');
      expect(strategy.isRetryable(error)).toBe(false);
    });

    it('should identify retryable network errors', () => {
      const error = new Error('ECONNREFUSED');
      expect(strategy.isRetryable(error)).toBe(true);
    });

    it('should identify timeout errors as retryable', () => {
      const error = new Error('ETIMEDOUT');
      expect(strategy.isRetryable(error)).toBe(true);
    });

    it('should not retry generic errors', () => {
      const error = new Error('Some random error');
      expect(strategy.isRetryable(error)).toBe(false);
    });
  });

  describe('calculateDelay', () => {
    it('should calculate exponential backoff', () => {
      const strategy = new RetryStrategy({
        initialDelay: 1000,
        backoffMultiplier: 2,
      });

      expect(strategy.calculateDelay(0)).toBe(1000);
      expect(strategy.calculateDelay(1)).toBe(2000);
      expect(strategy.calculateDelay(2)).toBe(4000);
      expect(strategy.calculateDelay(3)).toBe(8000);
    });

    it('should cap delay at maxDelay', () => {
      const strategy = new RetryStrategy({
        initialDelay: 1000,
        maxDelay: 5000,
        backoffMultiplier: 2,
      });

      expect(strategy.calculateDelay(0)).toBe(1000);
      expect(strategy.calculateDelay(1)).toBe(2000);
      expect(strategy.calculateDelay(2)).toBe(4000);
      expect(strategy.calculateDelay(3)).toBe(5000); // Capped
      expect(strategy.calculateDelay(4)).toBe(5000); // Capped
    });
  });

  describe('addJitter', () => {
    const strategy = new RetryStrategy();

    it('should add jitter to delay', () => {
      const delay = 1000;
      const jittered = strategy.addJitter(delay);

      expect(jittered).toBeGreaterThanOrEqual(delay);
      expect(jittered).toBeLessThanOrEqual(delay * 1.3); // Up to 30% jitter
    });

    it('should produce different jitter values', () => {
      const delay = 1000;
      const jittered1 = strategy.addJitter(delay);
      const jittered2 = strategy.addJitter(delay);

      // Very unlikely to be exactly the same
      expect(jittered1).not.toBe(jittered2);
    });
  });

  describe('execute', () => {
    it('should execute function successfully on first try', async () => {
      const strategy = new RetryStrategy();
      const fn = jest.fn().mockResolvedValue('success');

      const result = await strategy.execute(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable errors', async () => {
      const strategy = new RetryStrategy({
        maxAttempts: 3,
        initialDelay: 10, // Short delay for testing
      });

      const fn = jest.fn()
        .mockRejectedValueOnce(new ValidationError('CONNECTION_ERROR', 'Failed'))
        .mockRejectedValueOnce(new ValidationError('CONNECTION_ERROR', 'Failed'))
        .mockResolvedValue('success');

      const result = await strategy.execute(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should not retry on non-retryable errors', async () => {
      const strategy = new RetryStrategy();
      const error = new ValidationError('INVALID_QUERY', 'Bad SQL');
      const fn = jest.fn().mockRejectedValue(error);

      await expect(strategy.execute(fn)).rejects.toThrow('Bad SQL');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should throw after max attempts', async () => {
      const strategy = new RetryStrategy({
        maxAttempts: 3,
        initialDelay: 10,
      });

      const fn = jest.fn().mockRejectedValue(
        new ValidationError('CONNECTION_ERROR', 'Always fails')
      );

      await expect(strategy.execute(fn)).rejects.toThrow('Failed after 3 attempts');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should include context in error message', async () => {
      const strategy = new RetryStrategy({
        maxAttempts: 2,
        initialDelay: 10,
      });

      const fn = jest.fn().mockRejectedValue(
        new ValidationError('CONNECTION_ERROR', 'Failed')
      );

      await expect(strategy.execute(fn, 'test operation')).rejects.toThrow('test operation');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should wait between retries', async () => {
      const strategy = new RetryStrategy({
        maxAttempts: 3,
        initialDelay: 100,
      });

      const fn = jest.fn()
        .mockRejectedValueOnce(new ValidationError('CONNECTION_ERROR', 'Failed'))
        .mockResolvedValue('success');

      const startTime = Date.now();
      await strategy.execute(fn);
      const elapsed = Date.now() - startTime;

      // Should have waited at least the initial delay
      expect(elapsed).toBeGreaterThanOrEqual(100);
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('executeWithTimeout', () => {
    it('should execute within timeout', async () => {
      const strategy = new RetryStrategy();
      const fn = jest.fn().mockResolvedValue('success');

      const result = await strategy.executeWithTimeout(fn, 5000);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should timeout if execution takes too long', async () => {
      const strategy = new RetryStrategy({
        maxAttempts: 1,
      });

      const fn = jest.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve('success'), 1000))
      );

      await expect(strategy.executeWithTimeout(fn, 100)).rejects.toThrow('timed out');
    });

    it('should include context in timeout error', async () => {
      const strategy = new RetryStrategy();
      const fn = jest.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve('success'), 1000))
      );

      await expect(
        strategy.executeWithTimeout(fn, 100, 'slow operation')
      ).rejects.toThrow('slow operation');
    });
  });
});

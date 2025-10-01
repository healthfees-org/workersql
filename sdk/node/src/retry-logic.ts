/**
 * Retry Logic with Exponential Backoff for WorkerSQL
 * Handles automatic retries for transient errors
 */

import { ValidationError } from '../../schema/validator.js';

export interface RetryOptions {
  maxAttempts?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  retryableErrors?: string[];
}

const DEFAULT_RETRYABLE_ERRORS = [
  'CONNECTION_ERROR',
  'TIMEOUT_ERROR',
  'RESOURCE_LIMIT',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENETUNREACH',
];

export class RetryStrategy {
  private options: Required<RetryOptions>;

  constructor(options: RetryOptions = {}) {
    this.options = {
      maxAttempts: options.maxAttempts ?? 3,
      initialDelay: options.initialDelay ?? 1000,
      maxDelay: options.maxDelay ?? 30000,
      backoffMultiplier: options.backoffMultiplier ?? 2,
      retryableErrors: options.retryableErrors ?? DEFAULT_RETRYABLE_ERRORS,
    };
  }

  /**
   * Check if an error is retryable
   */
  isRetryable(error: any): boolean {
    if (error instanceof ValidationError) {
      return this.options.retryableErrors.includes(error.code);
    }

    if (error?.code && typeof error.code === 'string') {
      return this.options.retryableErrors.includes(error.code);
    }

    if (error?.message && typeof error.message === 'string') {
      return this.options.retryableErrors.some(code => 
        error.message.includes(code)
      );
    }

    return false;
  }

  /**
   * Calculate delay for a given attempt
   */
  calculateDelay(attempt: number): number {
    const delay = this.options.initialDelay * Math.pow(this.options.backoffMultiplier, attempt);
    return Math.min(delay, this.options.maxDelay);
  }

  /**
   * Add jitter to prevent thundering herd
   */
  addJitter(delay: number): number {
    const jitter = Math.random() * 0.3 * delay; // Up to 30% jitter
    return delay + jitter;
  }

  /**
   * Execute a function with retry logic
   */
  async execute<T>(
    fn: () => Promise<T>,
    context?: string
  ): Promise<T> {
    let lastError: any;

    for (let attempt = 0; attempt < this.options.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        // Check if we should retry
        if (!this.isRetryable(error)) {
          throw error;
        }

        // Check if we've exhausted retries
        if (attempt === this.options.maxAttempts - 1) {
          throw new ValidationError(
            'CONNECTION_ERROR',
            `Failed after ${this.options.maxAttempts} attempts${context ? ` (${context})` : ''}`,
            { originalError: error, attempts: attempt + 1 }
          );
        }

        // Calculate and apply delay
        const delay = this.calculateDelay(attempt);
        const delayWithJitter = this.addJitter(delay);

        console.debug(
          `[WorkerSQL Retry] Attempt ${attempt + 1}/${this.options.maxAttempts} failed${context ? ` (${context})` : ''}. ` +
          `Retrying in ${Math.round(delayWithJitter)}ms...`
        );

        await new Promise(resolve => setTimeout(resolve, delayWithJitter));
      }
    }

    throw lastError;
  }

  /**
   * Execute with timeout
   */
  async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeout: number,
    context?: string
  ): Promise<T> {
    return Promise.race([
      this.execute(fn, context),
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new ValidationError('TIMEOUT_ERROR', `Operation timed out after ${timeout}ms${context ? ` (${context})` : ''}`)),
          timeout
        )
      ),
    ]);
  }
}

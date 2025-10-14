// Package retry provides retry logic with exponential backoff for WorkerSQL
package retry

import (
	"context"
	"fmt"
	"math"
	"math/rand"
	"time"
)

// Options configures retry behavior
type Options struct {
	MaxAttempts       int
	InitialDelay      time.Duration
	MaxDelay          time.Duration
	BackoffMultiplier float64
	RetryableErrors   []string
}

var defaultRetryableErrors = []string{
	"CONNECTION_ERROR",
	"TIMEOUT_ERROR",
	"RESOURCE_LIMIT",
	"ECONNREFUSED",
	"ECONNRESET",
	"ETIMEDOUT",
	"ENETUNREACH",
}

// Strategy handles retry logic with exponential backoff
type Strategy struct {
	options Options
}

// NewStrategy creates a new retry strategy
func NewStrategy(opts *Options) *Strategy {
	if opts == nil {
		opts = &Options{}
	}

	if opts.MaxAttempts == 0 {
		opts.MaxAttempts = 3
	}
	if opts.InitialDelay == 0 {
		opts.InitialDelay = 1 * time.Second
	}
	if opts.MaxDelay == 0 {
		opts.MaxDelay = 30 * time.Second
	}
	if opts.BackoffMultiplier == 0 {
		opts.BackoffMultiplier = 2.0
	}
	if len(opts.RetryableErrors) == 0 {
		opts.RetryableErrors = defaultRetryableErrors
	}

	return &Strategy{options: *opts}
}

// IsRetryable checks if an error is retryable
func (s *Strategy) IsRetryable(err error) bool {
	if err == nil {
		return false
	}

	errMsg := err.Error()
	for _, retryableErr := range s.options.RetryableErrors {
		if contains(errMsg, retryableErr) {
			return true
		}
	}
	return false
}

// CalculateDelay calculates delay for a given attempt
func (s *Strategy) CalculateDelay(attempt int) time.Duration {
	delay := float64(s.options.InitialDelay) * math.Pow(s.options.BackoffMultiplier, float64(attempt))
	if time.Duration(delay) > s.options.MaxDelay {
		return s.options.MaxDelay
	}
	return time.Duration(delay)
}

// AddJitter adds jitter to prevent thundering herd
func (s *Strategy) AddJitter(delay time.Duration) time.Duration {
	jitter := time.Duration(rand.Float64() * 0.3 * float64(delay)) // Up to 30% jitter
	return delay + jitter
}

// Execute executes a function with retry logic
func (s *Strategy) Execute(ctx context.Context, fn func() error) error {
	var lastErr error

	for attempt := 0; attempt < s.options.MaxAttempts; attempt++ {
		// Check context cancellation
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		err := fn()
		if err == nil {
			return nil
		}

		lastErr = err

		// Check if we should retry
		if !s.IsRetryable(err) {
			return err
		}

		// Check if we've exhausted retries
		if attempt == s.options.MaxAttempts-1 {
			return fmt.Errorf("failed after %d attempts: %w", s.options.MaxAttempts, lastErr)
		}

		// Calculate and apply delay
		delay := s.CalculateDelay(attempt)
		delayWithJitter := s.AddJitter(delay)

		// Wait with context cancellation support
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(delayWithJitter):
			// Continue to next attempt
		}
	}

	return lastErr
}

// ExecuteWithTimeout executes a function with retry logic and timeout
func (s *Strategy) ExecuteWithTimeout(ctx context.Context, timeout time.Duration, fn func() error) error {
	timeoutCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	return s.Execute(timeoutCtx, fn)
}

func contains(s, substr string) bool {
	return len(s) > 0 && len(substr) > 0 && (s == substr || len(s) >= len(substr) && findSubstring(s, substr))
}

func findSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

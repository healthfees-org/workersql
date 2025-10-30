package retry_test

import (
"context"
"errors"
"testing"
"time"

"github.com/healthfees-org/workersql/sdk/go/internal/retry"
"github.com/stretchr/testify/assert"
)

func TestNewStrategy(t *testing.T) {
t.Run("with defaults", func(t *testing.T) {
strategy := retry.NewStrategy(nil)
assert.NotNil(t, strategy)
})

t.Run("with custom options", func(t *testing.T) {
opts := &retry.Options{
MaxAttempts:       5,
InitialDelay:      500 * time.Millisecond,
MaxDelay:          10 * time.Second,
BackoffMultiplier: 3.0,
RetryableErrors:   []string{"CUSTOM_ERROR"},
}

strategy := retry.NewStrategy(opts)
assert.NotNil(t, strategy)
})
}

func TestIsRetryable(t *testing.T) {
strategy := retry.NewStrategy(nil)

t.Run("retryable errors", func(t *testing.T) {
testCases := []struct {
name  string
err   error
retry bool
}{
{"CONNECTION_ERROR", errors.New("CONNECTION_ERROR: failed"), true},
{"TIMEOUT_ERROR", errors.New("TIMEOUT_ERROR occurred"), true},
{"RESOURCE_LIMIT", errors.New("hit RESOURCE_LIMIT"), true},
{"ECONNREFUSED", errors.New("ECONNREFUSED"), true},
{"INVALID_QUERY", errors.New("INVALID_QUERY: syntax error"), false},
{"AUTH_ERROR", errors.New("AUTH_ERROR: unauthorized"), false},
{"nil error", nil, false},
}

for _, tc := range testCases {
t.Run(tc.name, func(t *testing.T) {
result := strategy.IsRetryable(tc.err)
assert.Equal(t, tc.retry, result)
})
}
})
}

func TestExecute(t *testing.T) {
t.Run("success on first attempt", func(t *testing.T) {
strategy := retry.NewStrategy(&retry.Options{
MaxAttempts:  3,
InitialDelay: 10 * time.Millisecond,
})

callCount := 0
err := strategy.Execute(context.Background(), func() error {
callCount++
return nil
})

assert.NoError(t, err)
assert.Equal(t, 1, callCount)
})

t.Run("success after retries", func(t *testing.T) {
strategy := retry.NewStrategy(&retry.Options{
MaxAttempts:  3,
InitialDelay: 10 * time.Millisecond,
})

callCount := 0
err := strategy.Execute(context.Background(), func() error {
callCount++
if callCount < 3 {
return errors.New("CONNECTION_ERROR: temporary failure")
}
return nil
})

assert.NoError(t, err)
assert.Equal(t, 3, callCount)
})

t.Run("non-retryable error", func(t *testing.T) {
strategy := retry.NewStrategy(&retry.Options{
MaxAttempts:  3,
InitialDelay: 10 * time.Millisecond,
})

callCount := 0
err := strategy.Execute(context.Background(), func() error {
callCount++
return errors.New("INVALID_QUERY: syntax error")
})

assert.Error(t, err)
assert.Equal(t, 1, callCount) // Should not retry
assert.Contains(t, err.Error(), "INVALID_QUERY")
})

t.Run("exhausted retries", func(t *testing.T) {
strategy := retry.NewStrategy(&retry.Options{
MaxAttempts:  3,
InitialDelay: 10 * time.Millisecond,
})

callCount := 0
err := strategy.Execute(context.Background(), func() error {
callCount++
return errors.New("CONNECTION_ERROR: persistent failure")
})

assert.Error(t, err)
assert.Equal(t, 3, callCount)
assert.Contains(t, err.Error(), "failed after 3 attempts")
})
}

package smoke

import (
	"context"
	"testing"
	"time"

	"github.com/healthfees-org/workersql/sdk/go/pkg/workersql"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// These are integration/smoke tests that would require a running WorkerSQL instance
// In a real scenario, these would connect to a test instance
// For now, we test client initialization and configuration

func TestClientInitialization(t *testing.T) {
	t.Run("initialize with DSN", func(t *testing.T) {
		dsn := "workersql://api.workersql.com/testdb?apiKey=test-key"
		client, err := workersql.NewClient(dsn)
		
		require.NoError(t, err)
		require.NotNil(t, client)
		defer client.Close()

		// Verify configuration was parsed correctly
		stats := client.GetPoolStats()
		assert.NotNil(t, stats)
	})

	t.Run("initialize with config struct", func(t *testing.T) {
		config := workersql.Config{
			Host:     "api.workersql.com",
			Database: "testdb",
			APIKey:   "test-key",
			Pooling: &workersql.PoolConfig{
				Enabled:        true,
				MinConnections: 2,
				MaxConnections: 10,
			},
		}

		client, err := workersql.NewClient(config)
		
		require.NoError(t, err)
		require.NotNil(t, client)
		defer client.Close()

		stats := client.GetPoolStats()
		assert.Equal(t, 2, stats["minConnections"])
		assert.Equal(t, 10, stats["maxConnections"])
	})

	t.Run("initialize with pooling disabled", func(t *testing.T) {
		config := workersql.Config{
			Host:     "api.workersql.com",
			Database: "testdb",
			APIKey:   "test-key",
			Pooling:  nil, // No pooling
		}

		client, err := workersql.NewClient(config)
		
		require.NoError(t, err)
		require.NotNil(t, client)
		defer client.Close()

		stats := client.GetPoolStats()
		assert.Equal(t, false, stats["pooling"])
	})
}

func TestClientConfiguration(t *testing.T) {
	t.Run("DSN with all parameters", func(t *testing.T) {
		dsn := "workersql://user:pass@api.workersql.com:443/production?apiKey=key123&ssl=true&timeout=60000&retryAttempts=5&pooling=true&minConnections=3&maxConnections=15"
		
		client, err := workersql.NewClient(dsn)
		require.NoError(t, err)
		require.NotNil(t, client)
		defer client.Close()

		stats := client.GetPoolStats()
		assert.Equal(t, 3, stats["minConnections"])
		assert.Equal(t, 15, stats["maxConnections"])
	})

	t.Run("timeout configuration", func(t *testing.T) {
		config := workersql.Config{
			Host:     "api.workersql.com",
			Database: "testdb",
			APIKey:   "test-key",
			Timeout:  5 * time.Second,
		}

		client, err := workersql.NewClient(config)
		require.NoError(t, err)
		require.NotNil(t, client)
		defer client.Close()
	})

	t.Run("retry configuration", func(t *testing.T) {
		config := workersql.Config{
			Host:          "api.workersql.com",
			Database:      "testdb",
			APIKey:        "test-key",
			RetryAttempts: 5,
			RetryDelay:    2 * time.Second,
		}

		client, err := workersql.NewClient(config)
		require.NoError(t, err)
		require.NotNil(t, client)
		defer client.Close()
	})
}

func TestErrorHandling(t *testing.T) {
	t.Run("invalid DSN", func(t *testing.T) {
		dsn := "mysql://api.workersql.com/testdb"
		
		_, err := workersql.NewClient(dsn)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "protocol")
	})

	t.Run("missing host", func(t *testing.T) {
		config := workersql.Config{
			Database: "testdb",
			APIKey:   "test-key",
		}

		_, err := workersql.NewClient(config)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "Host")
	})
}

func TestConnectionPooling(t *testing.T) {
	t.Run("pool stats tracking", func(t *testing.T) {
		config := workersql.Config{
			Host:     "api.workersql.com",
			Database: "testdb",
			APIKey:   "test-key",
			Pooling: &workersql.PoolConfig{
				Enabled:        true,
				MinConnections: 2,
				MaxConnections: 5,
			},
		}

		client, err := workersql.NewClient(config)
		require.NoError(t, err)
		defer client.Close()

		stats := client.GetPoolStats()
		assert.Equal(t, 2, stats["total"])
		assert.Equal(t, 0, stats["active"])
		assert.Equal(t, 2, stats["idle"])
	})

	t.Run("close releases resources", func(t *testing.T) {
		config := workersql.Config{
			Host:     "api.workersql.com",
			Database: "testdb",
			APIKey:   "test-key",
			Pooling: &workersql.PoolConfig{
				Enabled:        true,
				MinConnections: 2,
				MaxConnections: 5,
			},
		}

		client, err := workersql.NewClient(config)
		require.NoError(t, err)

		err = client.Close()
		assert.NoError(t, err)
	})
}

// Mock tests for API methods (would require mock server in real scenario)
func TestQueryMethods(t *testing.T) {
	t.Run("query method exists", func(t *testing.T) {
		config := workersql.Config{
			Host:     "localhost",
			Port:     8787,
			Database: "testdb",
			APIKey:   "test-key",
			SSL:      false,
		}

		client, err := workersql.NewClient(config)
		require.NoError(t, err)
		defer client.Close()

		ctx := context.Background()
		
		// This would fail without a real server, but we're testing the method signature
		_, err = client.Query(ctx, "SELECT 1")
		// We expect an error because there's no server, but method should exist
		assert.Error(t, err) // Connection refused or timeout
	})
}

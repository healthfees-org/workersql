package dsn_test

import (
	"testing"

	"github.com/healthfees-org/workersql/sdk/go/internal/dsn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParse(t *testing.T) {
	t.Run("basic DSN", func(t *testing.T) {
		dsnStr := "workersql://api.workersql.com/mydb"
		parsed, err := dsn.Parse(dsnStr)

		require.NoError(t, err)
		assert.Equal(t, "workersql", parsed.Protocol)
		assert.Equal(t, "api.workersql.com", parsed.Host)
		assert.Equal(t, "mydb", parsed.Database)
		assert.Equal(t, 0, parsed.Port)
		assert.Equal(t, "", parsed.Username)
		assert.Equal(t, "", parsed.Password)
	})

	t.Run("DSN with credentials", func(t *testing.T) {
		dsnStr := "workersql://user:pass@api.workersql.com/mydb"
		parsed, err := dsn.Parse(dsnStr)

		require.NoError(t, err)
		assert.Equal(t, "user", parsed.Username)
		assert.Equal(t, "pass", parsed.Password)
		assert.Equal(t, "api.workersql.com", parsed.Host)
		assert.Equal(t, "mydb", parsed.Database)
	})

	t.Run("DSN with port", func(t *testing.T) {
		dsnStr := "workersql://api.workersql.com:8787/mydb"
		parsed, err := dsn.Parse(dsnStr)

		require.NoError(t, err)
		assert.Equal(t, "api.workersql.com", parsed.Host)
		assert.Equal(t, 8787, parsed.Port)
		assert.Equal(t, "mydb", parsed.Database)
	})

	t.Run("DSN with query parameters", func(t *testing.T) {
		dsnStr := "workersql://api.workersql.com/mydb?apiKey=abc123&ssl=false&timeout=5000"
		parsed, err := dsn.Parse(dsnStr)

		require.NoError(t, err)
		assert.Equal(t, "abc123", parsed.Params["apiKey"])
		assert.Equal(t, "false", parsed.Params["ssl"])
		assert.Equal(t, "5000", parsed.Params["timeout"])
	})

	t.Run("DSN with special characters in credentials", func(t *testing.T) {
		dsnStr := "workersql://user%40name:p%40ss%3Aword@api.workersql.com/mydb"
		parsed, err := dsn.Parse(dsnStr)

		require.NoError(t, err)
		assert.Equal(t, "user@name", parsed.Username)
		assert.Equal(t, "p@ss:word", parsed.Password)
	})

	t.Run("full DSN with all components", func(t *testing.T) {
		dsnStr := "workersql://admin:secret@api.workersql.com:443/production?apiKey=key123&ssl=true"
		parsed, err := dsn.Parse(dsnStr)

		require.NoError(t, err)
		assert.Equal(t, "workersql", parsed.Protocol)
		assert.Equal(t, "admin", parsed.Username)
		assert.Equal(t, "secret", parsed.Password)
		assert.Equal(t, "api.workersql.com", parsed.Host)
		assert.Equal(t, 443, parsed.Port)
		assert.Equal(t, "production", parsed.Database)
		assert.Equal(t, "key123", parsed.Params["apiKey"])
		assert.Equal(t, "true", parsed.Params["ssl"])
	})

	t.Run("error on empty DSN", func(t *testing.T) {
		_, err := dsn.Parse("")
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "non-empty")
	})

	t.Run("error on invalid protocol", func(t *testing.T) {
		dsnStr := "mysql://api.workersql.com/mydb"
		_, err := dsn.Parse(dsnStr)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "invalid protocol")
	})

	t.Run("error on missing host", func(t *testing.T) {
		dsnStr := "workersql:///mydb"
		_, err := dsn.Parse(dsnStr)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "host is required")
	})

	t.Run("error on invalid port", func(t *testing.T) {
		dsnStr := "workersql://api.workersql.com:99999/mydb"
		_, err := dsn.Parse(dsnStr)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "invalid port")
	})
}

func TestStringify(t *testing.T) {
	t.Run("basic DSN", func(t *testing.T) {
		parsed := &dsn.ParsedDSN{
			Protocol: "workersql",
			Host:     "api.workersql.com",
			Database: "mydb",
			Params:   make(map[string]string),
		}

		dsnStr := dsn.Stringify(parsed)
		assert.Equal(t, "workersql://api.workersql.com/mydb", dsnStr)
	})

	t.Run("DSN with credentials", func(t *testing.T) {
		parsed := &dsn.ParsedDSN{
			Protocol: "workersql",
			Username: "user",
			Password: "pass",
			Host:     "api.workersql.com",
			Database: "mydb",
			Params:   make(map[string]string),
		}

		dsnStr := dsn.Stringify(parsed)
		assert.Equal(t, "workersql://user:pass@api.workersql.com/mydb", dsnStr)
	})

	t.Run("DSN with port and params", func(t *testing.T) {
		parsed := &dsn.ParsedDSN{
			Protocol: "workersql",
			Host:     "api.workersql.com",
			Port:     8787,
			Database: "mydb",
			Params: map[string]string{
				"apiKey": "abc123",
				"ssl":    "false",
			},
		}

		dsnStr := dsn.Stringify(parsed)
		// Check that all parts are present (order of params may vary)
		assert.Contains(t, dsnStr, "workersql://api.workersql.com:8787/mydb?")
		assert.Contains(t, dsnStr, "apiKey=abc123")
		assert.Contains(t, dsnStr, "ssl=false")
	})

	t.Run("roundtrip", func(t *testing.T) {
		original := "workersql://user:pass@api.workersql.com:443/mydb?apiKey=key123"
		parsed, err := dsn.Parse(original)
		require.NoError(t, err)

		stringified := dsn.Stringify(parsed)
		reparsed, err := dsn.Parse(stringified)
		require.NoError(t, err)

		assert.Equal(t, parsed.Protocol, reparsed.Protocol)
		assert.Equal(t, parsed.Username, reparsed.Username)
		assert.Equal(t, parsed.Password, reparsed.Password)
		assert.Equal(t, parsed.Host, reparsed.Host)
		assert.Equal(t, parsed.Port, reparsed.Port)
		assert.Equal(t, parsed.Database, reparsed.Database)
		assert.Equal(t, parsed.Params["apiKey"], reparsed.Params["apiKey"])
	})
}

func TestGetAPIEndpoint(t *testing.T) {
	t.Run("HTTPS endpoint by default", func(t *testing.T) {
		parsed := &dsn.ParsedDSN{
			Protocol: "workersql",
			Host:     "api.workersql.com",
			Params:   make(map[string]string),
		}

		endpoint := dsn.GetAPIEndpoint(parsed)
		assert.Equal(t, "https://api.workersql.com/v1", endpoint)
	})

	t.Run("HTTP endpoint when ssl=false", func(t *testing.T) {
		parsed := &dsn.ParsedDSN{
			Protocol: "workersql",
			Host:     "api.workersql.com",
			Params: map[string]string{
				"ssl": "false",
			},
		}

		endpoint := dsn.GetAPIEndpoint(parsed)
		assert.Equal(t, "http://api.workersql.com/v1", endpoint)
	})

	t.Run("endpoint with port", func(t *testing.T) {
		parsed := &dsn.ParsedDSN{
			Protocol: "workersql",
			Host:     "api.workersql.com",
			Port:     8787,
			Params:   make(map[string]string),
		}

		endpoint := dsn.GetAPIEndpoint(parsed)
		assert.Equal(t, "https://api.workersql.com:8787/v1", endpoint)
	})

	t.Run("custom apiEndpoint parameter", func(t *testing.T) {
		parsed := &dsn.ParsedDSN{
			Protocol: "workersql",
			Host:     "api.workersql.com",
			Params: map[string]string{
				"apiEndpoint": "https://custom.endpoint.com/api",
			},
		}

		endpoint := dsn.GetAPIEndpoint(parsed)
		assert.Equal(t, "https://custom.endpoint.com/api", endpoint)
	})
}

package fuzz

import (
	"testing"

	"github.com/healthfees-org/workersql/sdk/go/internal/dsn"
)

// FuzzDSNParse tests DSN parsing with random inputs
func FuzzDSNParse(f *testing.F) {
	// Seed corpus with valid DSNs
	f.Add("workersql://api.workersql.com/mydb")
	f.Add("workersql://user:pass@api.workersql.com/mydb")
	f.Add("workersql://api.workersql.com:8787/mydb")
	f.Add("workersql://user:pass@api.workersql.com:443/production?apiKey=key123&ssl=true")
	f.Add("workersql://localhost/testdb?ssl=false")
	f.Add("workersql://api.workersql.com/mydb?apiKey=abc123&timeout=5000")

	// Seed corpus with invalid DSNs to test error handling
	f.Add("mysql://api.workersql.com/mydb")
	f.Add("workersql:///mydb")
	f.Add("workersql://")
	f.Add("")
	f.Add("not-a-url")
	f.Add("workersql://host:99999/db")
	f.Add("workersql://host:-1/db")

	f.Fuzz(func(t *testing.T, input string) {
		// Parse should not panic on any input
		parsed, err := dsn.Parse(input)

		if err != nil {
			// Error is expected for invalid input - just ensure it doesn't panic
			return
		}

		// If parsing succeeded, validate the result
		if parsed == nil {
			t.Error("parsed result should not be nil when error is nil")
			return
		}

		// Protocol should always be "workersql" for valid parses
		if parsed.Protocol != "workersql" {
			t.Errorf("unexpected protocol: %s", parsed.Protocol)
		}

		// Host should not be empty
		if parsed.Host == "" {
			t.Error("host should not be empty for valid parse")
		}

		// Port should be in valid range if set
		if parsed.Port < 0 || parsed.Port > 65535 {
			t.Errorf("invalid port number: %d", parsed.Port)
		}

		// Test roundtrip: stringify and parse again
		stringified := dsn.Stringify(parsed)
		reparsed, err := dsn.Parse(stringified)
		if err != nil {
			t.Errorf("roundtrip parse failed: %v", err)
			return
		}

		// Verify critical fields match
		if reparsed.Protocol != parsed.Protocol {
			t.Errorf("protocol mismatch after roundtrip: %s vs %s", reparsed.Protocol, parsed.Protocol)
		}
		if reparsed.Host != parsed.Host {
			t.Errorf("host mismatch after roundtrip: %s vs %s", reparsed.Host, parsed.Host)
		}
		if reparsed.Port != parsed.Port {
			t.Errorf("port mismatch after roundtrip: %d vs %d", reparsed.Port, parsed.Port)
		}
	})
}

// FuzzDSNStringify tests DSN stringification with random inputs
func FuzzDSNStringify(f *testing.F) {
	// Seed corpus with various DSN structures
	f.Add("workersql", "", "", "api.workersql.com", 0, "mydb", "apiKey", "key123")
	f.Add("workersql", "user", "pass", "api.workersql.com", 443, "production", "", "")
	f.Add("workersql", "", "", "localhost", 8787, "testdb", "ssl", "false")

	f.Fuzz(func(t *testing.T, protocol, username, password, host string, port int, database, paramKey, paramValue string) {
		// Ensure protocol is always "workersql" for valid test
		protocol = "workersql"

		// Clamp port to valid range
		if port < 0 {
			port = 0
		}
		if port > 65535 {
			port = 65535
		}

		// Build DSN struct
		parsed := &dsn.ParsedDSN{
			Protocol: protocol,
			Username: username,
			Password: password,
			Host:     host,
			Port:     port,
			Database: database,
			Params:   make(map[string]string),
		}

		if paramKey != "" {
			parsed.Params[paramKey] = paramValue
		}

		// Stringify should not panic
		result := dsn.Stringify(parsed)

		// Result should not be empty if host is provided
		if host != "" && result == "" {
			t.Error("stringify result should not be empty with valid host")
		}

		// Result should always start with protocol
		if len(result) > 0 && result[:11] != "workersql://" {
			t.Errorf("stringify result should start with 'workersql://': %s", result)
		}
	})
}

// FuzzGetAPIEndpoint tests API endpoint construction with random inputs
func FuzzGetAPIEndpoint(f *testing.F) {
	// Seed corpus
	f.Add("api.workersql.com", 0, "false", "")
	f.Add("api.workersql.com", 443, "true", "")
	f.Add("localhost", 8787, "false", "")
	f.Add("custom.com", 9000, "true", "https://custom.endpoint.com/api")

	f.Fuzz(func(t *testing.T, host string, port int, ssl, customEndpoint string) {
		// Clamp port to valid range
		if port < 0 {
			port = 0
		}
		if port > 65535 {
			port = 65535
		}

		parsed := &dsn.ParsedDSN{
			Protocol: "workersql",
			Host:     host,
			Port:     port,
			Params:   make(map[string]string),
		}

		if ssl != "" {
			parsed.Params["ssl"] = ssl
		}

		if customEndpoint != "" {
			parsed.Params["apiEndpoint"] = customEndpoint
		}

		// GetAPIEndpoint should not panic
		endpoint := dsn.GetAPIEndpoint(parsed)

		// If custom endpoint is provided, it should be used
		if customEndpoint != "" && endpoint != customEndpoint {
			t.Errorf("custom endpoint not used: expected %s, got %s", customEndpoint, endpoint)
		}

		// If no custom endpoint, result should be a URL
		if customEndpoint == "" && len(endpoint) > 0 {
			// Should start with http:// or https://
			if endpoint[:7] != "http://" && endpoint[:8] != "https://" {
				t.Errorf("endpoint should be a valid URL: %s", endpoint)
			}

			// Should end with /v1
			if len(endpoint) > 3 && endpoint[len(endpoint)-3:] != "/v1" {
				t.Errorf("endpoint should end with /v1: %s", endpoint)
			}
		}
	})
}

// Package dsn provides DSN parsing for WorkerSQL connection strings.
// Parses connection strings in the format:
// workersql://[username[:password]@]host[:port][/database][?param1=value1&param2=value2]
package dsn

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// ParsedDSN represents a parsed WorkerSQL DSN
type ParsedDSN struct {
	Protocol string
	Username string
	Password string
	Host     string
	Port     int
	Database string
	Params   map[string]string
}

// Parse parses a WorkerSQL DSN string
func Parse(dsn string) (*ParsedDSN, error) {
	if dsn == "" {
		return nil, fmt.Errorf("DSN must be a non-empty string")
	}

	// Parse the URL
	u, err := url.Parse(dsn)
	if err != nil {
		return nil, fmt.Errorf("invalid DSN format: %w", err)
	}

	// Validate protocol
	if u.Scheme != "workersql" {
		return nil, fmt.Errorf("invalid protocol: %s. Expected 'workersql'", u.Scheme)
	}

	// Extract host and port
	host := u.Hostname()
	if host == "" {
		return nil, fmt.Errorf("host is required in DSN")
	}

	var port int
	if u.Port() != "" {
		port, err = strconv.Atoi(u.Port())
		if err != nil || port < 1 || port > 65535 {
			return nil, fmt.Errorf("invalid port: %s", u.Port())
		}
	}

	// Extract username and password
	username := ""
	password := ""
	if u.User != nil {
		username = u.User.Username()
		if pwd, ok := u.User.Password(); ok {
			password = pwd
		}
	}

	// Extract database from path
	database := ""
	if u.Path != "" && u.Path != "/" {
		database = strings.TrimPrefix(u.Path, "/")
	}

	// Parse query parameters
	params := make(map[string]string)
	for key, values := range u.Query() {
		if len(values) > 0 {
			params[key] = values[0]
		}
	}

	return &ParsedDSN{
		Protocol: u.Scheme,
		Username: username,
		Password: password,
		Host:     host,
		Port:     port,
		Database: database,
		Params:   params,
	}, nil
}

// Stringify converts a ParsedDSN back to a DSN string
func Stringify(parsed *ParsedDSN) string {
	var sb strings.Builder
	
	sb.WriteString(parsed.Protocol)
	sb.WriteString("://")

	if parsed.Username != "" {
		sb.WriteString(url.PathEscape(parsed.Username))
		if parsed.Password != "" {
			sb.WriteString(":")
			sb.WriteString(url.PathEscape(parsed.Password))
		}
		sb.WriteString("@")
	}

	sb.WriteString(parsed.Host)

	if parsed.Port > 0 {
		sb.WriteString(":")
		sb.WriteString(strconv.Itoa(parsed.Port))
	}

	if parsed.Database != "" {
		sb.WriteString("/")
		sb.WriteString(url.PathEscape(parsed.Database))
	}

	if len(parsed.Params) > 0 {
		sb.WriteString("?")
		first := true
		for key, value := range parsed.Params {
			if !first {
				sb.WriteString("&")
			}
			first = false
			sb.WriteString(url.QueryEscape(key))
			sb.WriteString("=")
			sb.WriteString(url.QueryEscape(value))
		}
	}

	return sb.String()
}

// GetAPIEndpoint extracts the API endpoint from DSN parameters or constructs from host
func GetAPIEndpoint(parsed *ParsedDSN) string {
	// Check if apiEndpoint is specified in params
	if endpoint, ok := parsed.Params["apiEndpoint"]; ok {
		return endpoint
	}

	// Construct from host
	protocol := "https"
	if ssl, ok := parsed.Params["ssl"]; ok && ssl == "false" {
		protocol = "http"
	}

	port := ""
	if parsed.Port > 0 {
		port = fmt.Sprintf(":%d", parsed.Port)
	}

	return fmt.Sprintf("%s://%s%s/v1", protocol, parsed.Host, port)
}

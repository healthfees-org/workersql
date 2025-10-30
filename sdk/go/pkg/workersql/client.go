// Package workersql provides a Go SDK for WorkerSQL - MySQL at the edge on Cloudflare
package workersql

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/healthfees-org/workersql/sdk/go/internal/dsn"
	"github.com/healthfees-org/workersql/sdk/go/internal/pool"
	"github.com/healthfees-org/workersql/sdk/go/internal/retry"
	"github.com/healthfees-org/workersql/sdk/go/internal/websocket"
)

// Config configures the WorkerSQL client
type Config struct {
	Host          string
	Port          int
	Username      string
	Password      string
	Database      string
	APIEndpoint   string
	APIKey        string
	SSL           bool
	Timeout       time.Duration
	RetryAttempts int
	RetryDelay    time.Duration
	Pooling       *PoolConfig
}

// PoolConfig configures connection pooling
type PoolConfig struct {
	Enabled             bool
	MinConnections      int
	MaxConnections      int
	IdleTimeout         time.Duration
	HealthCheckInterval time.Duration
}

// ErrorResponse represents an error response from the API
type ErrorResponse struct {
	Code      string                 `json:"code"`
	Message   string                 `json:"message"`
	Details   map[string]interface{} `json:"details,omitempty"`
	Timestamp string                 `json:"timestamp"`
}

// QueryResponse represents a query response
type QueryResponse struct {
	Success       bool                     `json:"success"`
	Data          []map[string]interface{} `json:"data,omitempty"`
	RowCount      int                      `json:"rowCount,omitempty"`
	ExecutionTime float64                  `json:"executionTime,omitempty"`
	Cached        bool                     `json:"cached,omitempty"`
	Error         *ErrorResponse           `json:"error,omitempty"`
}

// BatchQueryResponse represents a batch query response
type BatchQueryResponse struct {
	Success            bool            `json:"success"`
	Results            []QueryResponse `json:"results"`
	TotalExecutionTime float64         `json:"totalExecutionTime,omitempty"`
}

// HealthCheckResponse represents a health check response
type HealthCheckResponse struct {
	Status    string `json:"status"`
	Database  struct {
		Connected    bool    `json:"connected"`
		ResponseTime float64 `json:"responseTime,omitempty"`
	} `json:"database"`
	Cache struct {
		Enabled bool    `json:"enabled"`
		HitRate float64 `json:"hitRate,omitempty"`
	} `json:"cache"`
	Timestamp string `json:"timestamp"`
}

// Client is the main WorkerSQL client
type Client struct {
	config        Config
	pool          *pool.Pool
	httpClient    *http.Client
	retryStrategy *retry.Strategy
}

// NewClient creates a new WorkerSQL client from a DSN string or config
func NewClient(configOrDSN interface{}) (*Client, error) {
	var config Config

	switch v := configOrDSN.(type) {
	case string:
		// Parse DSN
		parsed, err := dsn.Parse(v)
		if err != nil {
			return nil, fmt.Errorf("failed to parse DSN: %w", err)
		}
		config = configFromDSN(parsed)
	case Config:
		config = v
	case *Config:
		config = *v
	default:
		return nil, fmt.Errorf("config must be a DSN string or Config struct")
	}

	// Validate config
	if err := validateConfig(&config); err != nil {
		return nil, err
	}

	client := &Client{
		config: config,
	}

	// Initialize retry strategy
	client.retryStrategy = retry.NewStrategy(&retry.Options{
		MaxAttempts:       config.RetryAttempts,
		InitialDelay:      config.RetryDelay,
		MaxDelay:          30 * time.Second,
		BackoffMultiplier: 2.0,
	})

	// Initialize connection pool if enabled
	if config.Pooling != nil && config.Pooling.Enabled {
		client.pool = pool.NewPool(pool.Options{
			APIEndpoint:         config.APIEndpoint,
			APIKey:              config.APIKey,
			MinConnections:      config.Pooling.MinConnections,
			MaxConnections:      config.Pooling.MaxConnections,
			IdleTimeout:         config.Pooling.IdleTimeout,
			ConnectionTimeout:   config.Timeout,
			HealthCheckInterval: config.Pooling.HealthCheckInterval,
		})
	} else {
		// Create default HTTP client
		client.httpClient = &http.Client{
			Timeout: config.Timeout,
		}
	}

	return client, nil
}

// Query executes a SQL query
func (c *Client) Query(ctx context.Context, sql string, params ...interface{}) (*QueryResponse, error) {
	request := map[string]interface{}{
		"sql": sql,
	}
	if len(params) > 0 {
		request["params"] = params
	}

	var response QueryResponse
	err := c.retryStrategy.Execute(ctx, func() error {
		return c.doRequest(ctx, "POST", "/query", request, &response)
	})

	if err != nil {
		return nil, err
	}

	return &response, nil
}

// QueryRow executes a query expected to return a single row
func (c *Client) QueryRow(ctx context.Context, sql string, params ...interface{}) (map[string]interface{}, error) {
	response, err := c.Query(ctx, sql, params...)
	if err != nil {
		return nil, err
	}

	if !response.Success {
		if response.Error != nil {
			return nil, fmt.Errorf("%s: %s", response.Error.Code, response.Error.Message)
		}
		return nil, fmt.Errorf("query failed")
	}

	if len(response.Data) == 0 {
		return nil, fmt.Errorf("no rows returned")
	}

	return response.Data[0], nil
}

// Exec executes a SQL statement (INSERT, UPDATE, DELETE)
func (c *Client) Exec(ctx context.Context, sql string, params ...interface{}) (*QueryResponse, error) {
	return c.Query(ctx, sql, params...)
}

// BatchQuery executes multiple queries
func (c *Client) BatchQuery(ctx context.Context, queries []map[string]interface{}) (*BatchQueryResponse, error) {
	request := map[string]interface{}{
		"queries": queries,
	}

	var response BatchQueryResponse
	err := c.retryStrategy.Execute(ctx, func() error {
		return c.doRequest(ctx, "POST", "/batch", request, &response)
	})

	if err != nil {
		return nil, err
	}

	return &response, nil
}

// Transaction executes a function within a transaction
func (c *Client) Transaction(ctx context.Context, fn func(ctx context.Context, tx *TransactionClient) error) error {
	tx, err := c.BeginTx(ctx)
	if err != nil {
		return err
	}

	defer func() {
		if r := recover(); r != nil {
			_ = tx.Rollback(ctx)
			panic(r)
		}
	}()

	if err := fn(ctx, tx); err != nil {
		if rbErr := tx.Rollback(ctx); rbErr != nil {
			return fmt.Errorf("transaction error: %w (rollback error: %v)", err, rbErr)
		}
		return err
	}

	return tx.Commit(ctx)
}

// BeginTx starts a new transaction
func (c *Client) BeginTx(ctx context.Context) (*TransactionClient, error) {
	wsClient := websocket.NewTransactionClient(c.config.APIEndpoint, c.config.APIKey)
	
	if err := wsClient.Connect(ctx); err != nil {
		return nil, fmt.Errorf("failed to connect for transaction: %w", err)
	}

	if err := wsClient.Begin(ctx); err != nil {
		_ = wsClient.Close()
		return nil, fmt.Errorf("failed to begin transaction: %w", err)
	}

	return &TransactionClient{
		wsClient: wsClient,
	}, nil
}

// Health checks the health of the database
func (c *Client) Health(ctx context.Context) (*HealthCheckResponse, error) {
	var response HealthCheckResponse
	err := c.doRequest(ctx, "GET", "/health", nil, &response)
	if err != nil {
		return nil, err
	}
	return &response, nil
}

// GetPoolStats returns connection pool statistics
func (c *Client) GetPoolStats() map[string]interface{} {
	if c.pool != nil {
		return c.pool.GetStats()
	}
	return map[string]interface{}{
		"pooling": false,
	}
}

// Close closes the client and all connections
func (c *Client) Close() error {
	if c.pool != nil {
		return c.pool.Close()
	}
	if c.httpClient != nil {
		c.httpClient.CloseIdleConnections()
	}
	return nil
}

func (c *Client) doRequest(ctx context.Context, method, path string, body interface{}, response interface{}) error {
	var httpClient *http.Client

	// Get HTTP client from pool or use default
	if c.pool != nil {
		conn, err := c.pool.Acquire(ctx)
		if err != nil {
			return fmt.Errorf("failed to acquire connection: %w", err)
		}
		defer c.pool.Release(conn)
		httpClient = conn.Client
	} else {
		httpClient = c.httpClient
	}

	// Prepare request body
	var bodyReader io.Reader
	if body != nil {
		bodyBytes, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("failed to marshal request: %w", err)
		}
		bodyReader = bytes.NewReader(bodyBytes)
	}

	// Create request
	url := c.config.APIEndpoint + path
	req, err := http.NewRequestWithContext(ctx, method, url, bodyReader)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	// Set headers
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "WorkerSQL-GoSDK/1.0.0")
	if c.config.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.config.APIKey)
	}

	// Execute request
	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	// Read response body
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response: %w", err)
	}

	// Check status code
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var errResp ErrorResponse
		if err := json.Unmarshal(respBody, &errResp); err == nil {
			return fmt.Errorf("%s: %s", errResp.Code, errResp.Message)
		}
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	// Parse response
	if response != nil {
		if err := json.Unmarshal(respBody, response); err != nil {
			return fmt.Errorf("failed to parse response: %w", err)
		}
	}

	return nil
}

// TransactionClient represents a transaction
type TransactionClient struct {
	wsClient *websocket.TransactionClient
}

// Query executes a query within the transaction
func (tx *TransactionClient) Query(ctx context.Context, sql string, params ...interface{}) (*QueryResponse, error) {
	wsResp, err := tx.wsClient.Query(ctx, sql, params)
	if err != nil {
		return nil, err
	}

	return &QueryResponse{
		Success:       wsResp.Success,
		Data:          wsResp.Data,
		RowCount:      wsResp.RowCount,
		ExecutionTime: wsResp.ExecutionTime,
		Cached:        wsResp.Cached,
	}, nil
}

// Exec executes a statement within the transaction
func (tx *TransactionClient) Exec(ctx context.Context, sql string, params ...interface{}) (*QueryResponse, error) {
	return tx.Query(ctx, sql, params...)
}

// Commit commits the transaction
func (tx *TransactionClient) Commit(ctx context.Context) error {
	err := tx.wsClient.Commit(ctx)
	if closeErr := tx.wsClient.Close(); closeErr != nil && err == nil {
		err = closeErr
	}
	return err
}

// Rollback rolls back the transaction
func (tx *TransactionClient) Rollback(ctx context.Context) error {
	err := tx.wsClient.Rollback(ctx)
	if closeErr := tx.wsClient.Close(); closeErr != nil && err == nil {
		err = closeErr
	}
	return err
}

func configFromDSN(parsed *dsn.ParsedDSN) Config {
	config := Config{
		Host:        parsed.Host,
		Port:        parsed.Port,
		Username:    parsed.Username,
		Password:    parsed.Password,
		Database:    parsed.Database,
		APIEndpoint: dsn.GetAPIEndpoint(parsed),
		SSL:         true,
		Timeout:     30 * time.Second,
	}

	// Extract params
	if apiKey, ok := parsed.Params["apiKey"]; ok {
		config.APIKey = apiKey
	}
	if ssl, ok := parsed.Params["ssl"]; ok && ssl == "false" {
		config.SSL = false
	}
	if timeout, ok := parsed.Params["timeout"]; ok {
		if t, err := time.ParseDuration(timeout + "ms"); err == nil {
			config.Timeout = t
		}
	}
	if retryAttempts, ok := parsed.Params["retryAttempts"]; ok {
		if attempts, err := strconv.Atoi(retryAttempts); err == nil && attempts > 0 {
			config.RetryAttempts = attempts
		}
	}

	// Connection pooling params
	if pooling, ok := parsed.Params["pooling"]; ok && pooling == "true" {
		config.Pooling = &PoolConfig{
			Enabled:        true,
			MinConnections: 1,
			MaxConnections: 10,
			IdleTimeout:    5 * time.Minute,
		}

		if minConn, ok := parsed.Params["minConnections"]; ok {
			if min, err := strconv.Atoi(minConn); err == nil && min > 0 {
				config.Pooling.MinConnections = min
			}
		}
		if maxConn, ok := parsed.Params["maxConnections"]; ok {
			if max, err := strconv.Atoi(maxConn); err == nil && max > 0 {
				config.Pooling.MaxConnections = max
			}
		}
	}

	return config
}

func validateConfig(config *Config) error {
	if config.APIEndpoint == "" && config.Host == "" {
		return fmt.Errorf("either APIEndpoint or Host must be specified")
	}

	if config.APIEndpoint == "" {
		// Construct API endpoint from host
		protocol := "https"
		if !config.SSL {
			protocol = "http"
		}
		port := ""
		if config.Port > 0 {
			port = fmt.Sprintf(":%d", config.Port)
		}
		config.APIEndpoint = fmt.Sprintf("%s://%s%s/v1", protocol, config.Host, port)
	}

	if config.Timeout == 0 {
		config.Timeout = 30 * time.Second
	}

	if config.RetryAttempts == 0 {
		config.RetryAttempts = 3
	}

	if config.RetryDelay == 0 {
		config.RetryDelay = 1 * time.Second
	}

	return nil
}

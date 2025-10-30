// Package websocket provides WebSocket transaction client for WorkerSQL
package websocket

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

// Message represents a WebSocket message
type Message struct {
	Type          string                 `json:"type"`
	ID            string                 `json:"id"`
	SQL           string                 `json:"sql,omitempty"`
	Params        []interface{}          `json:"params,omitempty"`
	TransactionID string                 `json:"transactionId,omitempty"`
	Data          interface{}            `json:"data,omitempty"`
	Error         map[string]interface{} `json:"error,omitempty"`
}

// QueryResponse represents a query response
type QueryResponse struct {
	Success       bool                     `json:"success"`
	Data          []map[string]interface{} `json:"data,omitempty"`
	RowCount      int                      `json:"rowCount,omitempty"`
	ExecutionTime float64                  `json:"executionTime,omitempty"`
	Cached        bool                     `json:"cached,omitempty"`
	Error         map[string]interface{}   `json:"error,omitempty"`
}

// TransactionClient manages WebSocket connections for transactions
type TransactionClient struct {
	url           string
	apiKey        string
	conn          *websocket.Conn
	connected     bool
	connecting    bool
	transactionID string
	handlers      map[string]*messageHandler
	mu            sync.RWMutex
	closeCh       chan struct{}
}

type messageHandler struct {
	responseCh chan interface{}
	errorCh    chan error
	timeout    *time.Timer
}

// NewTransactionClient creates a new WebSocket transaction client
func NewTransactionClient(apiEndpoint, apiKey string) *TransactionClient {
	// Convert HTTP(S) URL to WS(S)
	wsURL := apiEndpoint
	if len(wsURL) > 7 && wsURL[:7] == "http://" {
		wsURL = "ws://" + wsURL[7:]
	} else if len(wsURL) > 8 && wsURL[:8] == "https://" {
		wsURL = "wss://" + wsURL[8:]
	}
	wsURL += "/ws"

	return &TransactionClient{
		url:      wsURL,
		apiKey:   apiKey,
		handlers: make(map[string]*messageHandler),
		closeCh:  make(chan struct{}),
	}
}

// Connect establishes a WebSocket connection
func (c *TransactionClient) Connect(ctx context.Context) error {
	c.mu.Lock()
	if c.connected {
		c.mu.Unlock()
		return nil
	}
	if c.connecting {
		c.mu.Unlock()
		return fmt.Errorf("connection already in progress")
	}
	c.connecting = true
	c.mu.Unlock()

	defer func() {
		c.mu.Lock()
		c.connecting = false
		c.mu.Unlock()
	}()

	header := make(map[string][]string)
	if c.apiKey != "" {
		header["Authorization"] = []string{"Bearer " + c.apiKey}
	}

	dialer := websocket.DefaultDialer
	conn, _, err := dialer.DialContext(ctx, c.url, header)
	if err != nil {
		return fmt.Errorf("failed to connect to WebSocket: %w", err)
	}

	c.mu.Lock()
	c.conn = conn
	c.connected = true
	c.mu.Unlock()

	// Start message handler goroutine
	go c.handleMessages()

	return nil
}

// Begin starts a transaction
func (c *TransactionClient) Begin(ctx context.Context) error {
	msg := Message{
		Type: "begin",
		ID:   generateID(),
	}

	response, err := c.sendMessage(ctx, msg, 30*time.Second)
	if err != nil {
		return err
	}

	if respMap, ok := response.(map[string]interface{}); ok {
		if txID, ok := respMap["transactionId"].(string); ok {
			c.mu.Lock()
			c.transactionID = txID
			c.mu.Unlock()
			return nil
		}
	}

	return fmt.Errorf("invalid response from BEGIN")
}

// Query executes a query within the transaction
func (c *TransactionClient) Query(ctx context.Context, sql string, params []interface{}) (*QueryResponse, error) {
	c.mu.RLock()
	txID := c.transactionID
	c.mu.RUnlock()

	if txID == "" {
		return nil, fmt.Errorf("no active transaction")
	}

	msg := Message{
		Type:          "query",
		ID:            generateID(),
		SQL:           sql,
		Params:        params,
		TransactionID: txID,
	}

	response, err := c.sendMessage(ctx, msg, 30*time.Second)
	if err != nil {
		return nil, err
	}

	// Parse response as QueryResponse
	var qr QueryResponse
	respBytes, _ := json.Marshal(response)
	if err := json.Unmarshal(respBytes, &qr); err != nil {
		return nil, fmt.Errorf("failed to parse query response: %w", err)
	}

	return &qr, nil
}

// Commit commits the transaction
func (c *TransactionClient) Commit(ctx context.Context) error {
	c.mu.RLock()
	txID := c.transactionID
	c.mu.RUnlock()

	if txID == "" {
		return nil // Nothing to commit
	}

	msg := Message{
		Type:          "commit",
		ID:            generateID(),
		TransactionID: txID,
	}

	_, err := c.sendMessage(ctx, msg, 30*time.Second)
	
	c.mu.Lock()
	c.transactionID = ""
	c.mu.Unlock()

	return err
}

// Rollback rolls back the transaction
func (c *TransactionClient) Rollback(ctx context.Context) error {
	c.mu.RLock()
	txID := c.transactionID
	c.mu.RUnlock()

	if txID == "" {
		return nil // Nothing to rollback
	}

	msg := Message{
		Type:          "rollback",
		ID:            generateID(),
		TransactionID: txID,
	}

	_, err := c.sendMessage(ctx, msg, 30*time.Second)
	
	c.mu.Lock()
	c.transactionID = ""
	c.mu.Unlock()

	return err
}

// Close closes the WebSocket connection
func (c *TransactionClient) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if !c.connected || c.conn == nil {
		return nil
	}

	close(c.closeCh)
	err := c.conn.Close()
	c.connected = false
	c.conn = nil
	c.transactionID = ""

	return err
}

func (c *TransactionClient) sendMessage(ctx context.Context, msg Message, timeout time.Duration) (interface{}, error) {
	c.mu.RLock()
	if !c.connected || c.conn == nil {
		c.mu.RUnlock()
		return nil, fmt.Errorf("not connected")
	}
	c.mu.RUnlock()

	// Create handler for this message
	handler := &messageHandler{
		responseCh: make(chan interface{}, 1),
		errorCh:    make(chan error, 1),
		timeout:    time.NewTimer(timeout),
	}

	c.mu.Lock()
	c.handlers[msg.ID] = handler
	c.mu.Unlock()

	defer func() {
		c.mu.Lock()
		delete(c.handlers, msg.ID)
		c.mu.Unlock()
		handler.timeout.Stop()
	}()

	// Send message
	c.mu.RLock()
	err := c.conn.WriteJSON(msg)
	c.mu.RUnlock()
	
	if err != nil {
		return nil, fmt.Errorf("failed to send message: %w", err)
	}

	// Wait for response
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-handler.timeout.C:
		return nil, fmt.Errorf("message timeout")
	case err := <-handler.errorCh:
		return nil, err
	case resp := <-handler.responseCh:
		return resp, nil
	}
}

func (c *TransactionClient) handleMessages() {
	for {
		select {
		case <-c.closeCh:
			return
		default:
		}

		c.mu.RLock()
		conn := c.conn
		c.mu.RUnlock()

		if conn == nil {
			return
		}

		var msg Message
		err := conn.ReadJSON(&msg)
		if err != nil {
			// Connection closed or error
			return
		}

		c.mu.RLock()
		handler, ok := c.handlers[msg.ID]
		c.mu.RUnlock()

		if !ok {
			continue
		}

		if msg.Error != nil {
			handler.errorCh <- fmt.Errorf("server error: %v", msg.Error)
		} else {
			handler.responseCh <- msg.Data
		}
	}
}

var idCounter = uint64(0)

func generateID() string {
	count := atomic.AddUint64(&idCounter, 1)
	return fmt.Sprintf("msg_%d_%d", time.Now().UnixNano(), count)
}

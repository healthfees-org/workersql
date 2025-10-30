// Package pool provides connection pooling for WorkerSQL HTTP connections
package pool

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

// Connection represents a pooled HTTP client connection
type Connection struct {
	ID         string
	Client     *http.Client
	InUse      bool
	CreatedAt  time.Time
	LastUsed   time.Time
	UseCount   int64
}

// Options configures the connection pool
type Options struct {
	APIEndpoint        string
	APIKey             string
	MinConnections     int
	MaxConnections     int
	IdleTimeout        time.Duration
	ConnectionTimeout  time.Duration
	HealthCheckInterval time.Duration
}

// Pool manages a pool of reusable HTTP connections
type Pool struct {
	options     Options
	connections map[string]*Connection
	mu          sync.RWMutex
	stopCh      chan struct{}
	wg          sync.WaitGroup
	connCounter uint64
}

// NewPool creates a new connection pool
func NewPool(opts Options) *Pool {
	if opts.MinConnections == 0 {
		opts.MinConnections = 1
	}
	if opts.MaxConnections == 0 {
		opts.MaxConnections = 10
	}
	if opts.IdleTimeout == 0 {
		opts.IdleTimeout = 5 * time.Minute
	}
	if opts.ConnectionTimeout == 0 {
		opts.ConnectionTimeout = 30 * time.Second
	}
	if opts.HealthCheckInterval == 0 {
		opts.HealthCheckInterval = 1 * time.Minute
	}

	p := &Pool{
		options:     opts,
		connections: make(map[string]*Connection),
		stopCh:      make(chan struct{}),
	}

	// Create minimum connections
	for i := 0; i < opts.MinConnections; i++ {
		p.createConnection()
	}

	// Start health check goroutine
	if opts.HealthCheckInterval > 0 {
		p.wg.Add(1)
		go p.healthCheckLoop()
	}

	return p
}

// Acquire gets a connection from the pool
func (p *Pool) Acquire(ctx context.Context) (*Connection, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	// Try to find an idle connection
	for _, conn := range p.connections {
		if !conn.InUse {
			conn.InUse = true
			conn.LastUsed = time.Now()
			conn.UseCount++
			return conn, nil
		}
	}

	// Create a new connection if we haven't hit the max
	if len(p.connections) < p.options.MaxConnections {
		conn := p.createConnection()
		conn.InUse = true
		conn.LastUsed = time.Now()
		conn.UseCount++
		return conn, nil
	}

	return nil, fmt.Errorf("connection pool exhausted (max: %d)", p.options.MaxConnections)
}

// Release returns a connection to the pool
func (p *Pool) Release(conn *Connection) {
	if conn == nil {
		return
	}

	p.mu.Lock()
	defer p.mu.Unlock()

	if existing, ok := p.connections[conn.ID]; ok {
		existing.InUse = false
		existing.LastUsed = time.Now()
	}
}

// GetStats returns pool statistics
func (p *Pool) GetStats() map[string]interface{} {
	p.mu.RLock()
	defer p.mu.RUnlock()

	total := len(p.connections)
	active := 0
	idle := 0

	for _, conn := range p.connections {
		if conn.InUse {
			active++
		} else {
			idle++
		}
	}

	return map[string]interface{}{
		"total":          total,
		"active":         active,
		"idle":           idle,
		"minConnections": p.options.MinConnections,
		"maxConnections": p.options.MaxConnections,
	}
}

// Close closes all connections and stops the pool
func (p *Pool) Close() error {
	close(p.stopCh)
	p.wg.Wait()

	p.mu.Lock()
	defer p.mu.Unlock()

	// Close all idle connections
	for id, conn := range p.connections {
		if !conn.InUse {
			conn.Client.CloseIdleConnections()
			delete(p.connections, id)
		}
	}

	return nil
}

func (p *Pool) createConnection() *Connection {
	count := atomic.AddUint64(&p.connCounter, 1)
	id := fmt.Sprintf("conn_%d_%d", time.Now().UnixNano(), count)

	client := &http.Client{
		Timeout: p.options.ConnectionTimeout,
		Transport: &http.Transport{
			MaxIdleConns:        100,
			MaxIdleConnsPerHost: 10,
			IdleConnTimeout:     90 * time.Second,
		},
	}

	conn := &Connection{
		ID:        id,
		Client:    client,
		InUse:     false,
		CreatedAt: time.Now(),
		LastUsed:  time.Now(),
		UseCount:  0,
	}

	p.connections[id] = conn
	return conn
}

func (p *Pool) healthCheckLoop() {
	defer p.wg.Done()

	ticker := time.NewTicker(p.options.HealthCheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-p.stopCh:
			return
		case <-ticker.C:
			p.performHealthCheck()
		}
	}
}

func (p *Pool) performHealthCheck() {
	p.mu.Lock()
	defer p.mu.Unlock()

	now := time.Now()
	toRemove := []string{}

	// Check for idle connections that have exceeded idle timeout
	for id, conn := range p.connections {
		if !conn.InUse && now.Sub(conn.LastUsed) > p.options.IdleTimeout {
			// Keep minimum connections
			if len(p.connections)-len(toRemove) > p.options.MinConnections {
				toRemove = append(toRemove, id)
			}
		}
	}

	// Remove idle connections
	for _, id := range toRemove {
		if conn, ok := p.connections[id]; ok {
			conn.Client.CloseIdleConnections()
			delete(p.connections, id)
		}
	}

	// Ensure minimum connections
	for len(p.connections) < p.options.MinConnections {
		p.createConnection()
	}
}

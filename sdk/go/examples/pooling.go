package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/healthfees-org/workersql/sdk/go/pkg/workersql"
)

func main() {
	// Create client with connection pooling enabled
	config := workersql.Config{
		Host:     "api.workersql.com",
		Database: "mydb",
		APIKey:   "your-api-key",
		Timeout:  30 * time.Second,
		Pooling: &workersql.PoolConfig{
			Enabled:             true,
			MinConnections:      5,
			MaxConnections:      20,
			IdleTimeout:         5 * time.Minute,
			HealthCheckInterval: 1 * time.Minute,
		},
	}

	client, err := workersql.NewClient(config)
	if err != nil {
		log.Fatal(err)
	}
	defer client.Close()

	ctx := context.Background()

	// Check initial pool stats
	fmt.Println("Initial pool stats:")
	printPoolStats(client)

	// Execute multiple concurrent queries to demonstrate pooling
	fmt.Println("\nExecuting 10 concurrent queries...")
	done := make(chan bool, 10)

	for i := 0; i < 10; i++ {
		go func(id int) {
			defer func() { done <- true }()
			
			result, err := client.Query(ctx, "SELECT * FROM users LIMIT 10")
			if err != nil {
				log.Printf("Query %d failed: %v\n", id, err)
				return
			}
			fmt.Printf("Query %d completed: %d rows (cached: %v, time: %.2fms)\n",
				id, result.RowCount, result.Cached, result.ExecutionTime)
		}(i)
	}

	// Wait for all queries to complete
	for i := 0; i < 10; i++ {
		<-done
	}

	// Check pool stats after queries
	fmt.Println("\nPool stats after concurrent queries:")
	printPoolStats(client)

	// Wait a bit to see idle connections
	time.Sleep(2 * time.Second)

	fmt.Println("\nPool stats after idle period:")
	printPoolStats(client)
}

func printPoolStats(client *workersql.Client) {
	stats := client.GetPoolStats()
	fmt.Printf("  Total connections: %v\n", stats["total"])
	fmt.Printf("  Active connections: %v\n", stats["active"])
	fmt.Printf("  Idle connections: %v\n", stats["idle"])
	fmt.Printf("  Min connections: %v\n", stats["minConnections"])
	fmt.Printf("  Max connections: %v\n", stats["maxConnections"])
}

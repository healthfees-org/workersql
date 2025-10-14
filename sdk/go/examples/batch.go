package main

import (
	"context"
	"fmt"
	"log"

	"github.com/healthfees-org/workersql/sdk/go/pkg/workersql"
)

func main() {
	client, err := workersql.NewClient("workersql://api.workersql.com/mydb?apiKey=your-key")
	if err != nil {
		log.Fatal(err)
	}
	defer client.Close()

	ctx := context.Background()

	// Execute multiple queries in a batch
	queries := []map[string]interface{}{
		{
			"sql":    "SELECT * FROM users WHERE id = ?",
			"params": []interface{}{1},
		},
		{
			"sql":    "SELECT * FROM orders WHERE user_id = ?",
			"params": []interface{}{1},
		},
		{
			"sql":    "SELECT * FROM products WHERE category = ?",
			"params": []interface{}{"electronics"},
		},
		{
			"sql": "SELECT COUNT(*) as total FROM users",
		},
	}

	fmt.Println("Executing batch query...")
	batchResult, err := client.BatchQuery(ctx, queries)
	if err != nil {
		log.Fatal(err)
	}

	fmt.Printf("Batch query completed in %.2fms\n", batchResult.TotalExecutionTime)
	fmt.Printf("Success: %v\n", batchResult.Success)

	// Process each result
	for i, result := range batchResult.Results {
		fmt.Printf("\nQuery %d:\n", i+1)
		fmt.Printf("  Success: %v\n", result.Success)
		fmt.Printf("  Row count: %d\n", result.RowCount)
		fmt.Printf("  Execution time: %.2fms\n", result.ExecutionTime)
		fmt.Printf("  Cached: %v\n", result.Cached)

		if result.Error != nil {
			fmt.Printf("  Error: %s - %s\n", result.Error.Code, result.Error.Message)
		} else {
			fmt.Printf("  Data: %d rows returned\n", len(result.Data))
		}
	}
}

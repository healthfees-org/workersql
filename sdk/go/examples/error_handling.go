package main

import (
	"context"
	"errors"
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

	// Example 1: Basic error checking
	fmt.Println("Example 1: Basic error checking")
	result, err := client.Query(ctx, "SELECT * FROM users WHERE id = ?", 999)
	if err != nil {
		log.Printf("Query error: %v\n", err)
		return
	}

	if !result.Success {
		if result.Error != nil {
			fmt.Printf("Query failed with code %s: %s\n", result.Error.Code, result.Error.Message)
			if result.Error.Details != nil {
				fmt.Printf("Details: %+v\n", result.Error.Details)
			}
		}
		return
	}

	fmt.Printf("Query succeeded: %d rows\n", result.RowCount)

	// Example 2: Handling specific error codes
	fmt.Println("\nExample 2: Handling specific error codes")
	handleErrorCode(ctx, client, "SELECT * FROM nonexistent_table")

	// Example 3: Retryable vs non-retryable errors
	fmt.Println("\nExample 3: Connection error with automatic retry")
	// This would automatically retry on CONNECTION_ERROR, TIMEOUT_ERROR, etc.
	result, err = client.Query(ctx, "SELECT * FROM users")
	if err != nil {
		fmt.Printf("Query failed after retries: %v\n", err)
	} else {
		fmt.Printf("Query succeeded: %d rows\n", result.RowCount)
	}

	// Example 4: Context cancellation
	fmt.Println("\nExample 4: Context cancellation")
	ctxWithCancel, cancel := context.WithCancel(ctx)
	cancel() // Cancel immediately

	_, err = client.Query(ctxWithCancel, "SELECT * FROM users")
	if err != nil {
		if errors.Is(err, context.Canceled) {
			fmt.Println("Query was canceled as expected")
		} else {
			fmt.Printf("Unexpected error: %v\n", err)
		}
	}

	// Example 5: Transaction error handling
	fmt.Println("\nExample 5: Transaction error handling")
	err = client.Transaction(ctx, func(ctx context.Context, tx *workersql.TransactionClient) error {
		// This will fail and automatically rollback
		_, err := tx.Exec(ctx, "INSERT INTO users (id, name) VALUES (?, ?)", 1, "Duplicate ID")
		if err != nil {
			return fmt.Errorf("insert failed: %w", err)
		}
		return nil
	})
	if err != nil {
		fmt.Printf("Transaction failed and rolled back: %v\n", err)
	}
}

func handleErrorCode(ctx context.Context, client *workersql.Client, query string) {
	result, err := client.Query(ctx, query)
	if err != nil {
		fmt.Printf("Network or system error: %v\n", err)
		return
	}

	if !result.Success && result.Error != nil {
		switch result.Error.Code {
		case "INVALID_QUERY":
			fmt.Printf("SQL Syntax Error: %s\n", result.Error.Message)
			// Log query for debugging
			fmt.Printf("Failed query: %s\n", query)

		case "CONNECTION_ERROR":
			fmt.Printf("Connection Error: %s\n", result.Error.Message)
			// Implement exponential backoff or circuit breaker

		case "TIMEOUT_ERROR":
			fmt.Printf("Query Timeout: %s\n", result.Error.Message)
			// Consider optimizing query or increasing timeout

		case "AUTH_ERROR":
			fmt.Printf("Authentication Failed: %s\n", result.Error.Message)
			// Check API key validity

		case "PERMISSION_ERROR":
			fmt.Printf("Permission Denied: %s\n", result.Error.Message)
			// Check user permissions

		case "RESOURCE_LIMIT":
			fmt.Printf("Resource Limit Exceeded: %s\n", result.Error.Message)
			// Implement rate limiting or request throttling

		case "INTERNAL_ERROR":
			fmt.Printf("Internal Server Error: %s\n", result.Error.Message)
			// Report to monitoring system

		default:
			fmt.Printf("Unknown Error [%s]: %s\n", result.Error.Code, result.Error.Message)
		}
	}
}

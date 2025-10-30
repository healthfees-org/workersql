package main

import (
	"context"
	"fmt"
	"log"

	"github.com/healthfees-org/workersql/sdk/go/pkg/workersql"
)

func main() {
	// Create client
	client, err := workersql.NewClient("workersql://api.workersql.com/mydb?apiKey=your-key")
	if err != nil {
		log.Fatal(err)
	}
	defer client.Close()

	ctx := context.Background()

	// CREATE - Insert a new user
	fmt.Println("Creating new user...")
	result, err := client.Exec(ctx,
		"INSERT INTO users (name, email, status) VALUES (?, ?, ?)",
		"John Doe", "john@example.com", "active")
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Created user, rows affected: %d\n", result.RowCount)

	// READ - Query users
	fmt.Println("\nReading users...")
	queryResult, err := client.Query(ctx, "SELECT * FROM users WHERE status = ?", "active")
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Found %d active users\n", queryResult.RowCount)
	for _, row := range queryResult.Data {
		fmt.Printf("  - %s <%s>\n", row["name"], row["email"])
	}

	// READ ONE - Query single user
	fmt.Println("\nReading single user...")
	user, err := client.QueryRow(ctx, "SELECT * FROM users WHERE email = ?", "john@example.com")
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("User: %s (status: %s)\n", user["name"], user["status"])

	// UPDATE - Update user status
	fmt.Println("\nUpdating user status...")
	updateResult, err := client.Exec(ctx,
		"UPDATE users SET status = ? WHERE email = ?",
		"inactive", "john@example.com")
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Updated %d rows\n", updateResult.RowCount)

	// DELETE - Delete user
	fmt.Println("\nDeleting user...")
	deleteResult, err := client.Exec(ctx,
		"DELETE FROM users WHERE email = ?",
		"john@example.com")
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Deleted %d rows\n", deleteResult.RowCount)

	fmt.Println("\nCRUD operations completed successfully!")
}

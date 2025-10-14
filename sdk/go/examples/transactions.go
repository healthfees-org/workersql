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

	// Example 1: Using Transaction helper
	fmt.Println("Example 1: Transaction helper")
	err = transferMoney(ctx, client, 1, 2, 100.0)
	if err != nil {
		log.Printf("Transaction failed: %v\n", err)
	} else {
		fmt.Println("Transaction completed successfully!")
	}

	// Example 2: Manual transaction management
	fmt.Println("\nExample 2: Manual transaction")
	err = transferMoneyManual(ctx, client, 1, 2, 50.0)
	if err != nil {
		log.Printf("Transaction failed: %v\n", err)
	} else {
		fmt.Println("Transaction completed successfully!")
	}

	// Example 3: Transaction with rollback on error
	fmt.Println("\nExample 3: Transaction with error handling")
	err = transferMoneyWithValidation(ctx, client, 1, 2, 1000.0)
	if err != nil {
		fmt.Printf("Transaction rolled back: %v\n", err)
	} else {
		fmt.Println("Transaction completed successfully!")
	}
}

// transferMoney uses the Transaction helper for automatic commit/rollback
func transferMoney(ctx context.Context, client *workersql.Client, fromID, toID int, amount float64) error {
	return client.Transaction(ctx, func(ctx context.Context, tx *workersql.TransactionClient) error {
		// Deduct from source account
		_, err := tx.Exec(ctx,
			"UPDATE accounts SET balance = balance - ? WHERE id = ?",
			amount, fromID)
		if err != nil {
			return fmt.Errorf("failed to deduct from account %d: %w", fromID, err)
		}

		// Add to destination account
		_, err = tx.Exec(ctx,
			"UPDATE accounts SET balance = balance + ? WHERE id = ?",
			amount, toID)
		if err != nil {
			return fmt.Errorf("failed to add to account %d: %w", toID, err)
		}

		// Record transaction
		_, err = tx.Exec(ctx,
			"INSERT INTO transactions (from_account, to_account, amount, timestamp) VALUES (?, ?, ?, NOW())",
			fromID, toID, amount)
		if err != nil {
			return fmt.Errorf("failed to record transaction: %w", err)
		}

		return nil // Commits on success
	})
}

// transferMoneyManual demonstrates manual transaction management
func transferMoneyManual(ctx context.Context, client *workersql.Client, fromID, toID int, amount float64) error {
	// Begin transaction
	tx, err := client.BeginTx(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}

	// Deduct from source account
	_, err = tx.Exec(ctx,
		"UPDATE accounts SET balance = balance - ? WHERE id = ?",
		amount, fromID)
	if err != nil {
		tx.Rollback(ctx)
		return fmt.Errorf("failed to deduct: %w", err)
	}

	// Add to destination account
	_, err = tx.Exec(ctx,
		"UPDATE accounts SET balance = balance + ? WHERE id = ?",
		amount, toID)
	if err != nil {
		tx.Rollback(ctx)
		return fmt.Errorf("failed to add: %w", err)
	}

	// Commit transaction
	err = tx.Commit(ctx)
	if err != nil {
		return fmt.Errorf("failed to commit: %w", err)
	}

	return nil
}

// transferMoneyWithValidation includes business logic validation
func transferMoneyWithValidation(ctx context.Context, client *workersql.Client, fromID, toID int, amount float64) error {
	return client.Transaction(ctx, func(ctx context.Context, tx *workersql.TransactionClient) error {
		// Check source account balance
		result, err := tx.Query(ctx, "SELECT balance FROM accounts WHERE id = ?", fromID)
		if err != nil {
			return fmt.Errorf("failed to check balance: %w", err)
		}

		if len(result.Data) == 0 {
			return fmt.Errorf("account %d not found", fromID)
		}

		balance, ok := result.Data[0]["balance"].(float64)
		if !ok {
			return fmt.Errorf("invalid balance type")
		}

		if balance < amount {
			return fmt.Errorf("insufficient funds: balance %.2f, requested %.2f", balance, amount)
		}

		// Perform transfer
		_, err = tx.Exec(ctx,
			"UPDATE accounts SET balance = balance - ? WHERE id = ?",
			amount, fromID)
		if err != nil {
			return err
		}

		_, err = tx.Exec(ctx,
			"UPDATE accounts SET balance = balance + ? WHERE id = ?",
			amount, toID)
		if err != nil {
			return err
		}

		return nil
	})
}

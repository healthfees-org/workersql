<?php

declare(strict_types=1);

namespace WorkerSQL\MySQLi;

use mysqli;
use WorkerSQL\Client;
use WorkerSQL\ValidationException;

/**
 * MySQLi-compatible WorkerSQL Driver
 * 
 * Drop-in replacement for MySQLi that uses WorkerSQL HTTP API.
 * Compatible with WordPress (using mysqli extension).
 */
class WorkerSQLMySQLi extends mysqli
{
    private Client $client;
    private ?WorkerSQLMySQLiResult $lastResult = null;
    private bool $inTransaction = false;
    private array $transactionQueries = [];
    private int $affectedRows = 0;
    private ?int $insertId = null;
    private int $errno = 0;
    private string $error = '';

    /**
     * Create a new MySQLi connection
     * 
     * @param string $dsn WorkerSQL DSN (workersql://...)
     */
    public function __construct(string $dsn)
    {
        // Don't call parent constructor
        $this->client = new Client($dsn);
    }

    /**
     * Perform a query
     * 
     * @param string $query SQL query
     * @return WorkerSQLMySQLiResult|bool
     */
    public function query(string $query): WorkerSQLMySQLiResult|bool
    {
        try {
            $result = $this->client->query($query);
            
            if (!$result['success']) {
                $this->errno = 1;
                $this->error = $result['error']['message'] ?? 'Query failed';
                return false;
            }
            
            $this->affectedRows = $result['rowsAffected'] ?? 0;
            $this->insertId = $result['lastInsertId'] ?? null;
            $this->errno = 0;
            $this->error = '';
            
            $this->lastResult = new WorkerSQLMySQLiResult($result['data'] ?? []);
            return $this->lastResult;
        } catch (\Exception $e) {
            $this->errno = 1;
            $this->error = $e->getMessage();
            return false;
        }
    }

    /**
     * Prepare a statement
     * 
     * @param string $query SQL query with ? placeholders
     * @return WorkerSQLMySQLiStmt|false
     */
    public function prepare(string $query): WorkerSQLMySQLiStmt|false
    {
        try {
            return new WorkerSQLMySQLiStmt($query, $this->client, $this);
        } catch (\Exception $e) {
            $this->errno = 1;
            $this->error = $e->getMessage();
            return false;
        }
    }

    /**
     * Execute a query (alias for query)
     * 
     * @param string $query SQL query
     * @return bool
     */
    public function real_query(string $query): bool
    {
        $result = $this->query($query);
        return $result !== false;
    }

    /**
     * Begin a transaction
     * 
     * @return bool
     */
    public function begin_transaction(): bool
    {
        if ($this->inTransaction) {
            $this->errno = 1;
            $this->error = 'Transaction already started';
            return false;
        }
        
        $this->inTransaction = true;
        $this->transactionQueries = [];
        return true;
    }

    /**
     * Commit a transaction
     * 
     * @return bool
     */
    public function commit(): bool
    {
        if (!$this->inTransaction) {
            $this->errno = 1;
            $this->error = 'No transaction to commit';
            return false;
        }
        
        try {
            if (!empty($this->transactionQueries)) {
                $this->client->batchQuery($this->transactionQueries, ['transaction' => true]);
            }
            
            $this->inTransaction = false;
            $this->transactionQueries = [];
            return true;
        } catch (\Exception $e) {
            $this->rollback();
            $this->errno = 1;
            $this->error = $e->getMessage();
            return false;
        }
    }

    /**
     * Rollback a transaction
     * 
     * @return bool
     */
    public function rollback(): bool
    {
        if (!$this->inTransaction) {
            $this->errno = 1;
            $this->error = 'No transaction to rollback';
            return false;
        }
        
        $this->inTransaction = false;
        $this->transactionQueries = [];
        return true;
    }

    /**
     * Add query to transaction queue
     * 
     * @internal
     */
    public function addTransactionQuery(string $sql, array $params): void
    {
        $this->transactionQueries[] = [
            'sql' => $sql,
            'params' => $params,
        ];
    }

    /**
     * Check if in transaction
     * 
     * @return bool
     */
    public function inTransaction(): bool
    {
        return $this->inTransaction;
    }

    /**
     * Escape a string for use in a query
     * 
     * @param string $string String to escape
     * @return string
     */
    public function real_escape_string(string $string): string
    {
        return addslashes($string);
    }

    /**
     * Get the ID of the last inserted row
     * 
     * @return int|string
     */
    public function insert_id(): int|string
    {
        return $this->insertId ?? 0;
    }

    /**
     * Get the number of affected rows
     * 
     * @return int|string
     */
    public function affected_rows(): int|string
    {
        return $this->affectedRows;
    }

    /**
     * Get the last error number
     * 
     * @return int
     */
    public function errno(): int
    {
        return $this->errno;
    }

    /**
     * Get the last error message
     * 
     * @return string
     */
    public function error(): string
    {
        return $this->error;
    }

    /**
     * Close the connection
     * 
     * @return bool
     */
    public function close(): bool
    {
        $this->client->close();
        return true;
    }

    /**
     * Get underlying WorkerSQL client
     * 
     * @return Client
     */
    public function getClient(): Client
    {
        return $this->client;
    }

    /**
     * Magic property getter for mysqli properties
     * 
     * @param string $name Property name
     * @return mixed
     */
    public function __get(string $name): mixed
    {
        return match ($name) {
            'affected_rows' => $this->affectedRows,
            'insert_id' => $this->insertId ?? 0,
            'errno' => $this->errno,
            'error' => $this->error,
            default => null,
        };
    }
}

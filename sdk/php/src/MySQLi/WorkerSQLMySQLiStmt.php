<?php

declare(strict_types=1);

namespace WorkerSQL\MySQLi;

use mysqli_stmt;
use WorkerSQL\Client;

/**
 * MySQLi Prepared Statement
 */
class WorkerSQLMySQLiStmt extends mysqli_stmt
{
    private string $query;
    private Client $client;
    private WorkerSQLMySQLi $mysqli;
    private array $params = [];
    private ?array $result = null;
    private int $errno = 0;
    private string $error = '';

    public function __construct(string $query, Client $client, WorkerSQLMySQLi $mysqli)
    {
        $this->query = $query;
        $this->client = $client;
        $this->mysqli = $mysqli;
    }

    /**
     * Bind parameters to the prepared statement
     *
     * @param string $types Parameter types (s=string, i=integer, d=double, b=blob)
     * @param mixed ...$vars Variables to bind
     * @return bool
     */
    public function bind_param(string $types, mixed &...$vars): bool
    {
        $this->params = [];
        foreach ($vars as $var) {
            $this->params[] = $var;
        }
        return true;
    }

    /**
     * Execute the prepared statement
     *
     * @return bool
     */
    public function execute(): bool
    {
        try {
            // If in transaction, queue the query
            if ($this->mysqli->inTransaction()) {
                $this->mysqli->addTransactionQuery($this->query, $this->params);
                $this->result = ['success' => true, 'data' => []];
                return true;
            }

            $this->result = $this->client->query($this->query, $this->params);

            if (!$this->result['success']) {
                $this->errno = 1;
                $this->error = $this->result['error']['message'] ?? 'Execution failed';
                return false;
            }

            $this->errno = 0;
            $this->error = '';
            return true;
        } catch (\Exception $e) {
            $this->errno = 1;
            $this->error = $e->getMessage();
            return false;
        }
    }

    /**
     * Get the result set
     *
     * @return WorkerSQLMySQLiResult|false
     */
    public function get_result(): WorkerSQLMySQLiResult|false
    {
        if ($this->result === null || !isset($this->result['data'])) {
            return false;
        }
        return new WorkerSQLMySQLiResult($this->result['data']);
    }

    /**
     * Get the number of affected rows
     *
     * @return int
     */
    public function affected_rows(): int
    {
        return $this->result['rowsAffected'] ?? 0;
    }

    /**
     * Get the last insert ID
     *
     * @return int
     */
    public function insert_id(): int
    {
        return $this->result['lastInsertId'] ?? 0;
    }

    /**
     * Get error number
     *
     * @return int
     */
    public function errno(): int
    {
        return $this->errno;
    }

    /**
     * Get error message
     *
     * @return string
     */
    public function error(): string
    {
        return $this->error;
    }

    /**
     * Close the statement
     *
     * @return bool
     */
    public function close(): bool
    {
        $this->params = [];
        $this->result = null;
        return true;
    }

    /**
     * Magic property getter
     *
     * @param string $name Property name
     * @return mixed
     */
    public function __get(string $name): mixed
    {
        return match ($name) {
            'affected_rows' => $this->result['rowsAffected'] ?? 0,
            'insert_id' => $this->result['lastInsertId'] ?? 0,
            'errno' => $this->errno,
            'error' => $this->error,
            default => null,
        };
    }
}

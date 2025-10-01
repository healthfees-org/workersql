<?php

declare(strict_types=1);

namespace WorkerSQL\PDO;

use PDO;
use PDOStatement;
use WorkerSQL\Client;
use WorkerSQL\ValidationException;

/**
 * PDOStatement-compatible statement class
 */
class WorkerSQLPDOStatement extends PDOStatement
{
    private string $queryString;
    private Client $client;
    private WorkerSQLPDO $pdo;
    private array $params = [];
    private ?array $result = null;
    private int $position = 0;
    private int $fetchMode = PDO::FETCH_ASSOC;
    private ?int $lastInsertId = null;
    private array $errorInfo = ['00000', null, null];

    public function __construct(string $query, Client $client, WorkerSQLPDO $pdo)
    {
        $this->queryString = $query;
        $this->client = $client;
        $this->pdo = $pdo;
    }

    /**
     * Bind a value to a parameter
     * 
     * @param string|int $param Parameter identifier
     * @param mixed $value Parameter value
     * @param int $type Data type
     * @return bool
     */
    public function bindValue(string|int $param, mixed $value, int $type = PDO::PARAM_STR): bool
    {
        // Convert named parameters (:name) to positional (?)
        if (is_string($param) && str_starts_with($param, ':')) {
            $param = ltrim($param, ':');
            $this->params[$param] = $value;
        } else {
            $this->params[] = $value;
        }
        return true;
    }

    /**
     * Bind a parameter to a variable
     * 
     * @param string|int $param Parameter identifier
     * @param mixed $var Variable to bind
     * @param int $type Data type
     * @param int $maxLength Maximum length
     * @param mixed $driverOptions Driver options
     * @return bool
     */
    public function bindParam(
        string|int $param,
        mixed &$var,
        int $type = PDO::PARAM_STR,
        int $maxLength = 0,
        mixed $driverOptions = null
    ): bool {
        // For simplicity, bind by value
        return $this->bindValue($param, $var, $type);
    }

    /**
     * Execute the prepared statement
     * 
     * @param array|null $params Input parameters
     * @return bool
     */
    public function execute(?array $params = null): bool
    {
        try {
            $finalParams = $params ?? array_values($this->params);
            
            // Convert named parameters in query to positional
            $query = $this->queryString;
            if (str_contains($query, ':')) {
                // Simple named parameter replacement
                foreach ($this->params as $key => $value) {
                    if (is_string($key)) {
                        $query = str_replace(":$key", '?', $query);
                    }
                }
            }
            
            // If in transaction, queue the query
            if ($this->pdo->inTransaction()) {
                $this->pdo->addTransactionQuery($query, $finalParams);
                $this->result = ['success' => true, 'data' => []];
                return true;
            }
            
            // Execute query
            $this->result = $this->client->query($query, $finalParams);
            
            if (!$this->result['success']) {
                $error = $this->result['error'] ?? [];
                $this->errorInfo = [
                    $error['code'] ?? 'HY000',
                    1,
                    $error['message'] ?? 'Query failed'
                ];
                return false;
            }
            
            // Store last insert ID if available
            if (isset($this->result['lastInsertId'])) {
                $this->lastInsertId = $this->result['lastInsertId'];
            }
            
            $this->position = 0;
            $this->errorInfo = ['00000', null, null];
            return true;
        } catch (\Exception $e) {
            $this->errorInfo = ['HY000', 1, $e->getMessage()];
            return false;
        }
    }

    /**
     * Fetch the next row
     * 
     * @param int|null $mode Fetch mode
     * @param int $cursorOrientation Cursor orientation
     * @param int $cursorOffset Cursor offset
     * @return mixed
     */
    public function fetch(
        ?int $mode = null,
        int $cursorOrientation = PDO::FETCH_ORI_NEXT,
        int $cursorOffset = 0
    ): mixed {
        $mode = $mode ?? $this->fetchMode;
        
        if ($this->result === null || !isset($this->result['data'])) {
            return false;
        }
        
        $data = $this->result['data'];
        if (!isset($data[$this->position])) {
            return false;
        }
        
        $row = $data[$this->position++];
        
        return match ($mode) {
            PDO::FETCH_ASSOC => $row,
            PDO::FETCH_NUM => array_values($row),
            PDO::FETCH_BOTH => array_merge($row, array_values($row)),
            PDO::FETCH_OBJ => (object)$row,
            default => $row,
        };
    }

    /**
     * Fetch all rows
     * 
     * @param int|null $mode Fetch mode
     * @param mixed ...$args Additional arguments
     * @return array
     */
    public function fetchAll(?int $mode = null, mixed ...$args): array
    {
        $mode = $mode ?? $this->fetchMode;
        
        if ($this->result === null || !isset($this->result['data'])) {
            return [];
        }
        
        $data = $this->result['data'];
        $results = [];
        
        foreach ($data as $row) {
            $results[] = match ($mode) {
                PDO::FETCH_ASSOC => $row,
                PDO::FETCH_NUM => array_values($row),
                PDO::FETCH_BOTH => array_merge($row, array_values($row)),
                PDO::FETCH_OBJ => (object)$row,
                PDO::FETCH_COLUMN => $row[array_key_first($row)] ?? null,
                default => $row,
            };
        }
        
        return $results;
    }

    /**
     * Fetch a single column from the next row
     * 
     * @param int $column Column number
     * @return mixed
     */
    public function fetchColumn(int $column = 0): mixed
    {
        $row = $this->fetch(PDO::FETCH_NUM);
        return $row !== false && isset($row[$column]) ? $row[$column] : false;
    }

    /**
     * Fetch the next row as an object
     * 
     * @param string|null $class Class name
     * @param array $constructorArgs Constructor arguments
     * @return object|false
     */
    public function fetchObject(?string $class = "stdClass", array $constructorArgs = []): object|false
    {
        $row = $this->fetch(PDO::FETCH_ASSOC);
        if ($row === false) {
            return false;
        }
        
        if ($class === "stdClass") {
            return (object)$row;
        }
        
        // Create instance and populate properties
        $object = new $class(...$constructorArgs);
        foreach ($row as $key => $value) {
            $object->$key = $value;
        }
        return $object;
    }

    /**
     * Set the fetch mode
     * 
     * @param int $mode Fetch mode
     * @param mixed ...$args Additional arguments
     * @return bool
     */
    public function setFetchMode(int $mode, mixed ...$args): bool
    {
        $this->fetchMode = $mode;
        return true;
    }

    /**
     * Get the number of rows affected
     * 
     * @return int
     */
    public function rowCount(): int
    {
        if ($this->result === null) {
            return 0;
        }
        
        if (isset($this->result['rowsAffected'])) {
            return $this->result['rowsAffected'];
        }
        
        if (isset($this->result['data'])) {
            return count($this->result['data']);
        }
        
        return 0;
    }

    /**
     * Get the number of columns
     * 
     * @return int
     */
    public function columnCount(): int
    {
        if ($this->result === null || !isset($this->result['data']) || empty($this->result['data'])) {
            return 0;
        }
        
        return count($this->result['data'][0] ?? []);
    }

    /**
     * Get error code
     * 
     * @return string|null
     */
    public function errorCode(): ?string
    {
        return $this->errorInfo[0] !== '00000' ? $this->errorInfo[0] : null;
    }

    /**
     * Get error info
     * 
     * @return array
     */
    public function errorInfo(): array
    {
        return $this->errorInfo;
    }

    /**
     * Get last insert ID
     * 
     * @internal
     */
    public function getLastInsertId(): ?int
    {
        return $this->lastInsertId;
    }
}

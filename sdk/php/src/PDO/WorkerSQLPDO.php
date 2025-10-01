<?php

declare(strict_types=1);

namespace WorkerSQL\PDO;

use PDO as BasePDO;
use WorkerSQL\Client;
use WorkerSQL\ValidationException;

/**
 * PDO-compatible WorkerSQL Driver
 *
 * Drop-in replacement for PDO that uses WorkerSQL HTTP API.
 * Compatible with WordPress, Laravel, Symfony, and other PDO-based applications.
 */
class WorkerSQLPDO extends BasePDO
{
    private Client $client;
    private array $attributes = [];
    private ?WorkerSQLPDOStatement $lastStatement = null;
    private bool $inTransaction = false;
    private array $transactionQueries = [];

    /**
     * Create a new PDO instance
     *
     * @param string $dsn Data Source Name (workersql://...)
     * @param string|null $username Username (optional, can be in DSN)
     * @param string|null $password Password (optional, can be in DSN)
     * @param array|null $options Driver options
     */
    public function __construct(
        string $dsn,
        ?string $username = null,
        ?string $password = null,
        ?array $options = null
    ) {
        // Don't call parent constructor as we're overriding everything

        // Parse DSN and create WorkerSQL client
        $this->client = new Client($dsn);

        // Set default attributes
        $this->attributes = [
            BasePDO::ATTR_ERRMODE => BasePDO::ERRMODE_EXCEPTION,
            BasePDO::ATTR_DEFAULT_FETCH_MODE => BasePDO::FETCH_ASSOC,
            BasePDO::ATTR_EMULATE_PREPARES => false,
            BasePDO::ATTR_STRINGIFY_FETCHES => false,
        ];

        // Apply custom options
        if ($options) {
            foreach ($options as $key => $value) {
                $this->attributes[$key] = $value;
            }
        }
    }

    /**
     * Prepare a statement for execution
     *
     * @param string $query SQL query with named (:name) or positional (?) placeholders
     * @param array $options Driver options
     * @return WorkerSQLPDOStatement|false
     */
    public function prepare(string $query, array $options = []): WorkerSQLPDOStatement|false
    {
        try {
            $statement = new WorkerSQLPDOStatement($query, $this->client, $this);
            $this->lastStatement = $statement;
            return $statement;
        } catch (\Exception $e) {
            if ($this->attributes[BasePDO::ATTR_ERRMODE] === BasePDO::ERRMODE_EXCEPTION) {
                throw $e;
            }
            return false;
        }
    }

    /**
     * Execute a SQL statement and return the number of affected rows
     *
     * @param string $query SQL query
     * @return int|false Number of affected rows
     */
    public function exec(string $query): int|false
    {
        try {
            $result = $this->client->query($query);

            if (!$result['success']) {
                throw new ValidationException(
                    $result['error']['code'] ?? 'INTERNAL_ERROR',
                    $result['error']['message'] ?? 'Query failed'
                );
            }

            return $result['rowsAffected'] ?? 0;
        } catch (\Exception $e) {
            if ($this->attributes[BasePDO::ATTR_ERRMODE] === BasePDO::ERRMODE_EXCEPTION) {
                throw $e;
            }
            return false;
        }
    }

    /**
     * Execute a query and return a statement object
     *
     * @param string $query SQL query
     * @param int|null $fetchMode Fetch mode
     * @param mixed ...$fetchModeArgs Fetch mode arguments
     * @return WorkerSQLPDOStatement|false
     */
    public function query(string $query, ?int $fetchMode = null, mixed ...$fetchModeArgs): WorkerSQLPDOStatement|false
    {
        try {
            $stmt = $this->prepare($query);
            if ($stmt === false) {
                return false;
            }

            $stmt->execute();

            if ($fetchMode !== null) {
                $stmt->setFetchMode($fetchMode, ...$fetchModeArgs);
            }

            return $stmt;
        } catch (\Exception $e) {
            if ($this->attributes[BasePDO::ATTR_ERRMODE] === BasePDO::ERRMODE_EXCEPTION) {
                throw $e;
            }
            return false;
        }
    }

    /**
     * Begin a transaction
     *
     * @return bool
     */
    public function beginTransaction(): bool
    {
        if ($this->inTransaction) {
            throw new \PDOException('Transaction already started');
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
            throw new \PDOException('No transaction to commit');
        }

        try {
            if (!empty($this->transactionQueries)) {
                $this->client->batchQuery($this->transactionQueries, ['transaction' => true]);
            }

            $this->inTransaction = false;
            $this->transactionQueries = [];
            return true;
        } catch (\Exception $e) {
            $this->rollBack();
            throw $e;
        }
    }

    /**
     * Roll back a transaction
     *
     * @return bool
     */
    public function rollBack(): bool
    {
        if (!$this->inTransaction) {
            throw new \PDOException('No transaction to roll back');
        }

        $this->inTransaction = false;
        $this->transactionQueries = [];
        return true;
    }

    /**
     * Check if inside a transaction
     *
     * @return bool
     */
    public function inTransaction(): bool
    {
        return $this->inTransaction;
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
     * Get the ID of the last inserted row
     *
     * @param string|null $name Sequence name (ignored)
     * @return string|false
     */
    public function lastInsertId(?string $name = null): string|false
    {
        if ($this->lastStatement) {
            $insertId = $this->lastStatement->getLastInsertId();
            return $insertId !== null ? (string)$insertId : false;
        }
        return false;
    }

    /**
     * Get an attribute
     *
     * @param int $attribute Attribute to get
     * @return mixed
     */
    public function getAttribute(int $attribute): mixed
    {
        return $this->attributes[$attribute] ?? null;
    }

    /**
     * Set an attribute
     *
     * @param int $attribute Attribute to set
     * @param mixed $value Value to set
     * @return bool
     */
    public function setAttribute(int $attribute, mixed $value): bool
    {
        $this->attributes[$attribute] = $value;
        return true;
    }

    /**
     * Quote a string for use in a query
     *
     * @param string $string String to quote
     * @param int $type Parameter type
     * @return string|false
     */
    public function quote(string $string, int $type = BasePDO::PARAM_STR): string|false
    {
        // Basic escaping - recommend using prepared statements instead
        return "'" . addslashes($string) . "'";
    }

    /**
     * Get error code
     *
     * @return string|null
     */
    public function errorCode(): ?string
    {
        return $this->lastStatement?->errorCode();
    }

    /**
     * Get error info
     *
     * @return array
     */
    public function errorInfo(): array
    {
        return $this->lastStatement?->errorInfo() ?? ['00000', null, null];
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
}

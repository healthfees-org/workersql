<?php

namespace WorkerSQL\PDO;

use WorkerSQL\Client;
use WorkerSQL\DatabaseException;

/**
 * PDO-compatible connection for WorkerSQL
 * Provides a drop-in replacement for PDO
 */
class Connection
{
    private Client $client;
    private bool $inTransaction = false;
    private int $errorMode = \PDO::ERRMODE_EXCEPTION;
    private array $attributes = [];

    public function __construct(string $dsn, ?string $username = null, ?string $password = null, ?array $options = [])
    {
        $config = $this->parseDSN($dsn);
        
        if ($username !== null) {
            $config['username'] = $username;
        }
        if ($password !== null) {
            $config['password'] = $password;
        }

        // Merge options
        if (isset($options['api_key'])) {
            $config['api_key'] = $options['api_key'];
        }

        $this->client = new Client($config);
        
        // Set attributes from options
        if (isset($options[\PDO::ATTR_ERRMODE])) {
            $this->errorMode = $options[\PDO::ATTR_ERRMODE];
        }
    }

    private function parseDSN(string $dsn): array
    {
        // Support workersql:// DSN format
        if (strpos($dsn, 'workersql://') === 0) {
            $parsed = parse_url($dsn);
            
            $config = [
                'api_endpoint' => 'https://' . $parsed['host'],
                'host' => $parsed['host'] ?? 'localhost',
                'username' => $parsed['user'] ?? '',
                'password' => $parsed['pass'] ?? '',
                'database' => ltrim($parsed['path'] ?? '', '/'),
            ];

            if (isset($parsed['port'])) {
                $config['port'] = $parsed['port'];
            }

            // Parse query parameters
            if (isset($parsed['query'])) {
                parse_str($parsed['query'], $params);
                if (isset($params['apiEndpoint'])) {
                    $config['api_endpoint'] = $params['apiEndpoint'];
                }
                if (isset($params['apiKey'])) {
                    $config['api_key'] = $params['apiKey'];
                }
            }

            return $config;
        }

        // Support mysql: DSN format for compatibility
        if (strpos($dsn, 'mysql:') === 0) {
            $parts = explode(';', substr($dsn, 6));
            $config = ['api_endpoint' => 'http://localhost'];

            foreach ($parts as $part) {
                list($key, $value) = explode('=', $part, 2);
                $config[$key] = $value;
            }

            return $config;
        }

        throw new \InvalidArgumentException('Invalid DSN format. Use workersql:// or mysql: DSN');
    }

    public function prepare(string $statement, array $options = []): Statement
    {
        return new Statement($this->client, $statement);
    }

    public function query(string $statement): Statement
    {
        $stmt = $this->prepare($statement);
        $stmt->execute();
        return $stmt;
    }

    public function exec(string $statement): int
    {
        $result = $this->client->query($statement);
        return $result['data']['rowsAffected'] ?? 0;
    }

    public function beginTransaction(): bool
    {
        if ($this->inTransaction) {
            return false;
        }

        $this->client->query('BEGIN');
        $this->inTransaction = true;
        return true;
    }

    public function commit(): bool
    {
        if (!$this->inTransaction) {
            return false;
        }

        $this->client->query('COMMIT');
        $this->inTransaction = false;
        return true;
    }

    public function rollBack(): bool
    {
        if (!$this->inTransaction) {
            return false;
        }

        $this->client->query('ROLLBACK');
        $this->inTransaction = false;
        return true;
    }

    public function inTransaction(): bool
    {
        return $this->inTransaction;
    }

    public function lastInsertId(?string $name = null): string
    {
        $result = $this->client->query('SELECT LAST_INSERT_ID() as id');
        return (string)($result['data']['rows'][0]['id'] ?? '0');
    }

    public function getAttribute(int $attribute)
    {
        switch ($attribute) {
            case \PDO::ATTR_ERRMODE:
                return $this->errorMode;
            case \PDO::ATTR_DRIVER_NAME:
                return 'workersql';
            case \PDO::ATTR_CLIENT_VERSION:
                return '1.0.0';
            case \PDO::ATTR_SERVER_VERSION:
                return '1.0.0';
            default:
                return $this->attributes[$attribute] ?? null;
        }
    }

    public function setAttribute(int $attribute, $value): bool
    {
        switch ($attribute) {
            case \PDO::ATTR_ERRMODE:
                $this->errorMode = $value;
                return true;
            default:
                $this->attributes[$attribute] = $value;
                return true;
        }
    }

    public function errorCode(): ?string
    {
        return null; // Would be set on error
    }

    public function errorInfo(): array
    {
        return ['00000', null, null]; // No error
    }

    public function quote(string $string, int $type = \PDO::PARAM_STR): string
    {
        // Basic SQL string escaping
        return "'" . str_replace("'", "''", $string) . "'";
    }
}

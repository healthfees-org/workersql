<?php

declare(strict_types=1);

namespace WorkerSQL;

use GuzzleHttp\Client as GuzzleClient;
use GuzzleHttp\Exception\GuzzleException;

/**
 * WorkerSQL PHP Client
 *
 * Provides MySQL-compatible database operations at the edge.
 */
class Client
{
    private GuzzleClient $httpClient;
    private array $config;
    private ?RetryStrategy $retryStrategy = null;

    /**
     * Create a new WorkerSQL client
     *
     * @param string|array $config DSN string or configuration array
     */
    public function __construct($config)
    {
        if (is_string($config)) {
            $this->config = $this->configFromDSN($config);
        } elseif (is_array($config)) {
            $this->config = $this->validateConfig($config);
        } else {
            throw new ValidationException('INVALID_QUERY', 'Config must be string DSN or array');
        }

        $this->httpClient = new GuzzleClient([
            'base_uri' => $this->config['api_endpoint'],
            'timeout' => ($this->config['timeout'] ?? 30000) / 1000,
            'headers' => [
                'Content-Type' => 'application/json',
                'User-Agent' => 'WorkerSQL-PHPSDK/1.0.0',
                'Authorization' => isset($this->config['api_key'])
                    ? 'Bearer ' . $this->config['api_key']
                    : null,
            ],
        ]);

        $this->retryStrategy = new RetryStrategy(
            $this->config['retry_attempts'] ?? 3,
            $this->config['retry_delay'] ?? 1.0
        );
    }

    /**
     * Build configuration from DSN string
     */
    private function configFromDSN(string $dsn): array
    {
        $parsed = DSNParser::parse($dsn);

        return [
            'host' => $parsed['host'],
            'port' => $parsed['port'] ?? null,
            'username' => $parsed['username'] ?? null,
            'password' => $parsed['password'] ?? null,
            'database' => $parsed['database'] ?? null,
            'api_endpoint' => DSNParser::getApiEndpoint($parsed),
            'api_key' => $parsed['params']['apiKey'] ?? null,
            'ssl' => ($parsed['params']['ssl'] ?? 'true') !== 'false',
            'timeout' => isset($parsed['params']['timeout'])
                ? (int)$parsed['params']['timeout']
                : 30000,
            'retry_attempts' => isset($parsed['params']['retryAttempts'])
                ? (int)$parsed['params']['retryAttempts']
                : 3,
        ];
    }

    /**
     * Validate configuration array
     */
    private function validateConfig(array $config): array
    {
        if (!isset($config['api_endpoint']) && !isset($config['host'])) {
            throw new ValidationException('INVALID_QUERY', 'api_endpoint or host is required');
        }

        // Build api_endpoint from host if not provided
        if (!isset($config['api_endpoint']) && isset($config['host'])) {
            $protocol = ($config['ssl'] ?? true) ? 'https' : 'http';
            $port = isset($config['port']) ? ':' . $config['port'] : '';
            $config['api_endpoint'] = "{$protocol}://{$config['host']}{$port}/v1";
        }

        return $config;
    }

    /**
     * Execute a SQL query
     *
     * @param string $sql SQL query with ? placeholders
     * @param array $params Query parameters
     * @param array|null $options Optional query options
     * @return array Query response
     */
    public function query(string $sql, array $params = [], ?array $options = null): array
    {
        $request = [
            'sql' => $sql,
            'params' => $params,
            'timeout' => $options['timeout'] ?? 30000,
        ];

        if (isset($options['cache'])) {
            $request['cache'] = $options['cache'];
        }

        return $this->retryStrategy->execute(function () use ($request) {
            try {
                $response = $this->httpClient->post('/query', [
                    'json' => $request,
                ]);

                return json_decode($response->getBody()->getContents(), true);
            } catch (GuzzleException $e) {
                throw new ValidationException('CONNECTION_ERROR', 'Failed to execute query: ' . $e->getMessage());
            }
        }, 'query');
    }

    /**
     * Execute multiple queries in batch
     *
     * @param array $queries Array of query objects
     * @param array|null $options Batch options
     * @return array Batch response
     */
    public function batchQuery(array $queries, ?array $options = null): array
    {
        $request = [
            'queries' => $queries,
            'transaction' => $options['transaction'] ?? false,
            'stopOnError' => $options['stopOnError'] ?? true,
        ];

        return $this->retryStrategy->execute(function () use ($request) {
            try {
                $response = $this->httpClient->post('/batch', [
                    'json' => $request,
                ]);

                return json_decode($response->getBody()->getContents(), true);
            } catch (GuzzleException $e) {
                throw new ValidationException('CONNECTION_ERROR', 'Failed to execute batch query: ' . $e->getMessage());
            }
        }, 'batchQuery');
    }

    /**
     * Check service health
     *
     * @return array Health check response
     */
    public function healthCheck(): array
    {
        return $this->retryStrategy->execute(function () {
            try {
                $response = $this->httpClient->get('/health');
                return json_decode($response->getBody()->getContents(), true);
            } catch (GuzzleException $e) {
                throw new ValidationException('CONNECTION_ERROR', 'Health check failed: ' . $e->getMessage());
            }
        }, 'healthCheck');
    }

    /**
     * Close the client connection
     */
    public function close(): void
    {
        // Cleanup if needed
    }
}

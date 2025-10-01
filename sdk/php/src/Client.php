<?php

namespace WorkerSQL;

use GuzzleHttp\Client as HttpClient;
use GuzzleHttp\Exception\RequestException;

/**
 * WorkerSQL PHP Client
 * Core client for WorkerSQL API
 */
class Client
{
    private HttpClient $httpClient;
    private array $config;
    private bool $isHealthy = true;
    private ?string $lastHealthCheck = null;
    private string $logLevel;

    public function __construct(array $config)
    {
        $this->config = $this->validateConfig($config);
        $this->logLevel = $config['log_level'] ?? 'info';

        $headers = [
            'Content-Type' => 'application/json',
            'User-Agent' => 'WorkerSQL-PHPSDK/1.0.0',
        ];

        if (isset($this->config['api_key'])) {
            $headers['Authorization'] = 'Bearer ' . $this->config['api_key'];
        }

        $this->httpClient = new HttpClient([
            'base_uri' => $this->config['api_endpoint'],
            'timeout' => $this->config['timeout'] ?? 30,
            'headers' => $headers,
        ]);
    }

    private function validateConfig(array $config): array
    {
        if (!isset($config['api_endpoint'])) {
            throw new \InvalidArgumentException('api_endpoint is required');
        }

        return [
            'api_endpoint' => $config['api_endpoint'],
            'api_key' => $config['api_key'] ?? null,
            'retry_attempts' => $config['retry_attempts'] ?? 3,
            'retry_delay' => $config['retry_delay'] ?? 1.0,
            'timeout' => $config['timeout'] ?? 30,
        ];
    }

    public function query(string $sql, array $params = [], array $options = []): array
    {
        $request = [
            'sql' => $sql,
            'params' => $params,
            'timeout' => $options['timeout'] ?? 30000,
        ];

        if (isset($options['cache'])) {
            $request['cache'] = $options['cache'];
        }

        return $this->retryWithBackoff(function () use ($request) {
            return $this->executeQuery($request);
        });
    }

    private function executeQuery(array $request): array
    {
        try {
            $response = $this->httpClient->post('/query', [
                'json' => $request,
            ]);

            $result = json_decode($response->getBody()->getContents(), true);
            return $result;
        } catch (RequestException $e) {
            throw new DatabaseException(
                'Failed to execute query: ' . $e->getMessage(),
                $e->getCode(),
                $e
            );
        }
    }

    public function batchQuery(array $queries, array $options = []): array
    {
        $request = [
            'queries' => $queries,
            'transaction' => $options['transaction'] ?? false,
            'stopOnError' => $options['stop_on_error'] ?? true,
        ];

        return $this->retryWithBackoff(function () use ($request) {
            return $this->executeBatchQuery($request);
        });
    }

    private function executeBatchQuery(array $request): array
    {
        try {
            $response = $this->httpClient->post('/batch', [
                'json' => $request,
            ]);

            return json_decode($response->getBody()->getContents(), true);
        } catch (RequestException $e) {
            throw new DatabaseException(
                'Failed to execute batch query: ' . $e->getMessage(),
                $e->getCode(),
                $e
            );
        }
    }

    public function healthCheck(): array
    {
        try {
            $response = $this->httpClient->get('/health');
            $result = json_decode($response->getBody()->getContents(), true);
            
            $this->isHealthy = true;
            $this->lastHealthCheck = date('c');
            
            return $result;
        } catch (RequestException $e) {
            $this->isHealthy = false;
            throw new DatabaseException(
                'Health check failed: ' . $e->getMessage(),
                $e->getCode(),
                $e
            );
        }
    }

    public function getHealthStatus(): array
    {
        return [
            'healthy' => $this->isHealthy,
            'last_check' => $this->lastHealthCheck,
        ];
    }

    private function retryWithBackoff(callable $operation)
    {
        $maxRetries = $this->config['retry_attempts'];
        $baseDelay = $this->config['retry_delay'];
        $lastException = null;

        for ($attempt = 0; $attempt <= $maxRetries; $attempt++) {
            try {
                return $operation();
            } catch (\Exception $e) {
                $lastException = $e;
                
                if ($attempt === $maxRetries) {
                    break;
                }

                $delay = $baseDelay * pow(2, $attempt);
                $this->log('warn', "Retry attempt " . ($attempt + 1) . "/$maxRetries after {$delay}s");
                usleep((int)($delay * 1000000));
            }
        }

        throw $lastException ?? new DatabaseException('Max retries exceeded');
    }

    private function log(string $level, string $message): void
    {
        $levels = ['debug' => 0, 'info' => 1, 'warn' => 2, 'error' => 3];
        $configLevel = $levels[$this->logLevel] ?? 1;
        $messageLevel = $levels[$level] ?? 1;

        if ($messageLevel >= $configLevel) {
            error_log("[WorkerSQL] [" . strtoupper($level) . "] $message");
        }
    }

    public function close(): void
    {
        // Cleanup resources if needed
        $this->log('debug', 'Client closed');
    }
}

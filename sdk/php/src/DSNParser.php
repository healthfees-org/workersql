<?php

declare(strict_types=1);

namespace WorkerSQL;

/**
 * DSN Parser for WorkerSQL connection strings
 */
class DSNParser
{
    /**
     * Parse a WorkerSQL DSN string
     * 
     * @param string $dsn Connection string to parse
     * @return array Parsed DSN components
     * @throws ValidationException If DSN format is invalid
     */
    public static function parse(string $dsn): array
    {
        if (empty($dsn)) {
            throw new ValidationException('INVALID_QUERY', 'DSN must be a non-empty string');
        }

        $parsed = parse_url($dsn);

        if ($parsed === false) {
            throw new ValidationException('INVALID_QUERY', 'Invalid DSN format: ' . $dsn);
        }

        // Validate protocol
        if (!isset($parsed['scheme']) || strtolower($parsed['scheme']) !== 'workersql') {
            throw new ValidationException(
                'INVALID_QUERY',
                'Invalid protocol: ' . ($parsed['scheme'] ?? 'missing') . '. Expected "workersql"'
            );
        }

        if (!isset($parsed['host'])) {
            throw new ValidationException('INVALID_QUERY', 'Host is required in DSN');
        }

        // Parse query parameters
        $params = [];
        if (isset($parsed['query'])) {
            parse_str($parsed['query'], $params);
        }

        // Extract database from path
        $database = null;
        if (isset($parsed['path']) && $parsed['path'] !== '/') {
            $database = ltrim($parsed['path'], '/');
        }

        return [
            'protocol' => $parsed['scheme'],
            'username' => isset($parsed['user']) ? urldecode($parsed['user']) : null,
            'password' => isset($parsed['pass']) ? urldecode($parsed['pass']) : null,
            'host' => $parsed['host'],
            'port' => $parsed['port'] ?? null,
            'database' => $database,
            'params' => $params,
        ];
    }

    /**
     * Get API endpoint from parsed DSN
     * 
     * @param array $parsed Parsed DSN components
     * @return string API endpoint URL
     */
    public static function getApiEndpoint(array $parsed): string
    {
        // Check if apiEndpoint is specified in params
        if (isset($parsed['params']['apiEndpoint'])) {
            return $parsed['params']['apiEndpoint'];
        }

        // Construct from host
        $protocol = ($parsed['params']['ssl'] ?? 'true') === 'false' ? 'http' : 'https';
        $port = isset($parsed['port']) ? ':' . $parsed['port'] : '';
        return "{$protocol}://{$parsed['host']}{$port}/v1";
    }
}

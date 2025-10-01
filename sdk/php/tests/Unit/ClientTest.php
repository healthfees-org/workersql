<?php

declare(strict_types=1);

namespace WorkerSQL\Tests\Unit;

use PHPUnit\Framework\TestCase;
use WorkerSQL\Client;
use WorkerSQL\ValidationException;
use GuzzleHttp\Client as GuzzleClient;
use GuzzleHttp\Psr7\Response;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;

class ClientTest extends TestCase
{
    public function testInitializationWithDSN(): void
    {
        $client = new Client('workersql://api.test.com/mydb?apiKey=test-key');
        $this->assertInstanceOf(Client::class, $client);
    }

    public function testInitializationWithArray(): void
    {
        $client = new Client([
            'host' => 'api.test.com',
            'database' => 'mydb',
            'api_key' => 'test-key',
        ]);
        $this->assertInstanceOf(Client::class, $client);
    }

    public function testInvalidConfigThrowsException(): void
    {
        $this->expectException(ValidationException::class);
        new Client(['invalid' => 'config']);
    }

    public function testQuerySuccess(): void
    {
        $mockResponse = new Response(200, [], json_encode([
            'success' => true,
            'data' => [['id' => 1, 'name' => 'Test']],
            'rowCount' => 1,
        ]));

        $mock = new MockHandler([$mockResponse]);
        $handlerStack = HandlerStack::create($mock);

        // Create client with mocked Guzzle
        $reflection = new \ReflectionClass(Client::class);
        $client = $reflection->newInstanceWithoutConstructor();

        $httpClientProperty = $reflection->getProperty('httpClient');
        $httpClientProperty->setAccessible(true);
        $httpClientProperty->setValue($client, new GuzzleClient(['handler' => $handlerStack]));

        $configProperty = $reflection->getProperty('config');
        $configProperty->setAccessible(true);
        $configProperty->setValue($client, [
            'api_endpoint' => 'https://api.test.com/v1',
            'retry_attempts' => 3,
        ]);

        $retryProperty = $reflection->getProperty('retryStrategy');
        $retryProperty->setAccessible(true);
        $retryProperty->setValue($client, new \WorkerSQL\RetryStrategy());

        $result = $client->query('SELECT * FROM users');

        $this->assertTrue($result['success']);
        $this->assertCount(1, $result['data']);
        $this->assertEquals('Test', $result['data'][0]['name']);
    }

    public function testQueryWithParameters(): void
    {
        $mockResponse = new Response(200, [], json_encode([
            'success' => true,
            'data' => [['id' => 1]],
            'rowCount' => 1,
        ]));

        $mock = new MockHandler([$mockResponse]);
        $handlerStack = HandlerStack::create($mock);

        $reflection = new \ReflectionClass(Client::class);
        $client = $reflection->newInstanceWithoutConstructor();

        $httpClientProperty = $reflection->getProperty('httpClient');
        $httpClientProperty->setAccessible(true);
        $httpClientProperty->setValue($client, new GuzzleClient(['handler' => $handlerStack]));

        $configProperty = $reflection->getProperty('config');
        $configProperty->setAccessible(true);
        $configProperty->setValue($client, [
            'api_endpoint' => 'https://api.test.com/v1',
            'retry_attempts' => 3,
        ]);

        $retryProperty = $reflection->getProperty('retryStrategy');
        $retryProperty->setAccessible(true);
        $retryProperty->setValue($client, new \WorkerSQL\RetryStrategy());

        $result = $client->query('SELECT * FROM users WHERE id = ?', [1]);

        $this->assertTrue($result['success']);
    }

    public function testBatchQuery(): void
    {
        $mockResponse = new Response(200, [], json_encode([
            'success' => true,
            'results' => [
                ['success' => true, 'data' => [], 'rowCount' => 1],
                ['success' => true, 'data' => [], 'rowCount' => 1],
            ],
        ]));

        $mock = new MockHandler([$mockResponse]);
        $handlerStack = HandlerStack::create($mock);

        $reflection = new \ReflectionClass(Client::class);
        $client = $reflection->newInstanceWithoutConstructor();

        $httpClientProperty = $reflection->getProperty('httpClient');
        $httpClientProperty->setAccessible(true);
        $httpClientProperty->setValue($client, new GuzzleClient(['handler' => $handlerStack]));

        $configProperty = $reflection->getProperty('config');
        $configProperty->setAccessible(true);
        $configProperty->setValue($client, [
            'api_endpoint' => 'https://api.test.com/v1',
            'retry_attempts' => 3,
        ]);

        $retryProperty = $reflection->getProperty('retryStrategy');
        $retryProperty->setAccessible(true);
        $retryProperty->setValue($client, new \WorkerSQL\RetryStrategy());

        $queries = [
            ['sql' => 'INSERT INTO users (name) VALUES (?)', 'params' => ['User1']],
            ['sql' => 'INSERT INTO users (name) VALUES (?)', 'params' => ['User2']],
        ];

        $result = $client->batchQuery($queries);

        $this->assertTrue($result['success']);
        $this->assertCount(2, $result['results']);
    }

    public function testHealthCheck(): void
    {
        $mockResponse = new Response(200, [], json_encode([
            'status' => 'healthy',
            'database' => ['connected' => true],
            'cache' => ['enabled' => true],
            'timestamp' => '2025-09-01T12:00:00Z',
        ]));

        $mock = new MockHandler([$mockResponse]);
        $handlerStack = HandlerStack::create($mock);

        $reflection = new \ReflectionClass(Client::class);
        $client = $reflection->newInstanceWithoutConstructor();

        $httpClientProperty = $reflection->getProperty('httpClient');
        $httpClientProperty->setAccessible(true);
        $httpClientProperty->setValue($client, new GuzzleClient(['handler' => $handlerStack]));

        $configProperty = $reflection->getProperty('config');
        $configProperty->setAccessible(true);
        $configProperty->setValue($client, [
            'api_endpoint' => 'https://api.test.com/v1',
            'retry_attempts' => 3,
        ]);

        $retryProperty = $reflection->getProperty('retryStrategy');
        $retryProperty->setAccessible(true);
        $retryProperty->setValue($client, new \WorkerSQL\RetryStrategy());

        $result = $client->healthCheck();

        $this->assertEquals('healthy', $result['status']);
        $this->assertTrue($result['database']['connected']);
    }

    public function testConfigFromDSN(): void
    {
        $reflection = new \ReflectionClass(Client::class);
        $method = $reflection->getMethod('configFromDSN');
        $method->setAccessible(true);

        $client = $reflection->newInstanceWithoutConstructor();
        $parsed = \WorkerSQL\DSNParser::parse(
            'workersql://user:pass@api.test.com:8787/mydb?apiKey=test-key&retryAttempts=5'
        );

        $config = $method->invoke($client, $parsed);

        $this->assertEquals('api.test.com', $config['host']);
        $this->assertEquals(8787, $config['port']);
        $this->assertEquals('user', $config['username']);
        $this->assertEquals('pass', $config['password']);
        $this->assertEquals('mydb', $config['database']);
        $this->assertEquals('test-key', $config['api_key']);
        $this->assertEquals(5, $config['retry_attempts']);
    }
}

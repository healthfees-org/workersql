<?php

declare(strict_types=1);

namespace WorkerSQL\Tests\Unit;

use PHPUnit\Framework\TestCase;
use WorkerSQL\DSNParser;
use WorkerSQL\ValidationException;

class DSNParserTest extends TestCase
{
    public function testParseBasicDSN(): void
    {
        $dsn = 'workersql://api.workersql.com/mydb';
        $parsed = DSNParser::parse($dsn);

        $this->assertEquals('workersql', $parsed['protocol']);
        $this->assertEquals('api.workersql.com', $parsed['host']);
        $this->assertEquals('mydb', $parsed['database']);
        $this->assertNull($parsed['port']);
        $this->assertNull($parsed['username']);
        $this->assertNull($parsed['password']);
    }

    public function testParseDSNWithCredentials(): void
    {
        $dsn = 'workersql://user:pass@api.workersql.com/mydb';
        $parsed = DSNParser::parse($dsn);

        $this->assertEquals('user', $parsed['username']);
        $this->assertEquals('pass', $parsed['password']);
        $this->assertEquals('api.workersql.com', $parsed['host']);
        $this->assertEquals('mydb', $parsed['database']);
    }

    public function testParseDSNWithPort(): void
    {
        $dsn = 'workersql://api.workersql.com:8787/mydb';
        $parsed = DSNParser::parse($dsn);

        $this->assertEquals('api.workersql.com', $parsed['host']);
        $this->assertEquals(8787, $parsed['port']);
        $this->assertEquals('mydb', $parsed['database']);
    }

    public function testParseDSNWithQueryParameters(): void
    {
        $dsn = 'workersql://api.workersql.com/mydb?apiKey=abc123&ssl=false&timeout=5000';
        $parsed = DSNParser::parse($dsn);

        $this->assertEquals('abc123', $parsed['params']['apiKey']);
        $this->assertEquals('false', $parsed['params']['ssl']);
        $this->assertEquals('5000', $parsed['params']['timeout']);
    }

    public function testParseDSNWithSpecialCharacters(): void
    {
        $dsn = 'workersql://user%40name:p%40ss%3Aword@api.workersql.com/mydb';
        $parsed = DSNParser::parse($dsn);

        $this->assertEquals('user@name', $parsed['username']);
        $this->assertEquals('p@ss:word', $parsed['password']);
    }

    public function testParseDSNWithoutDatabase(): void
    {
        $dsn = 'workersql://api.workersql.com';
        $parsed = DSNParser::parse($dsn);

        $this->assertEquals('api.workersql.com', $parsed['host']);
        $this->assertNull($parsed['database']);
    }

    public function testInvalidProtocolThrowsException(): void
    {
        $this->expectException(ValidationException::class);
        $this->expectExceptionMessage('Invalid protocol');

        DSNParser::parse('mysql://api.workersql.com/mydb');
    }

    public function testEmptyDSNThrowsException(): void
    {
        $this->expectException(ValidationException::class);
        $this->expectExceptionMessage('non-empty string');

        DSNParser::parse('');
    }

    public function testGetApiEndpointHTTPSByDefault(): void
    {
        $parsed = DSNParser::parse('workersql://api.workersql.com/mydb');
        $endpoint = DSNParser::getApiEndpoint($parsed);

        $this->assertEquals('https://api.workersql.com/v1', $endpoint);
    }

    public function testGetApiEndpointHTTPWhenSSLFalse(): void
    {
        $parsed = DSNParser::parse('workersql://api.workersql.com/mydb?ssl=false');
        $endpoint = DSNParser::getApiEndpoint($parsed);

        $this->assertEquals('http://api.workersql.com/v1', $endpoint);
    }

    public function testGetApiEndpointIncludesPort(): void
    {
        $parsed = DSNParser::parse('workersql://api.workersql.com:8787/mydb');
        $endpoint = DSNParser::getApiEndpoint($parsed);

        $this->assertEquals('https://api.workersql.com:8787/v1', $endpoint);
    }

    public function testGetApiEndpointUsesProvidedEndpoint(): void
    {
        $parsed = DSNParser::parse(
            'workersql://api.workersql.com/mydb?apiEndpoint=https://custom.endpoint.com/api'
        );
        $endpoint = DSNParser::getApiEndpoint($parsed);

        $this->assertEquals('https://custom.endpoint.com/api', $endpoint);
    }
}

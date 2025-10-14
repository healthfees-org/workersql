package com.workersql.sdk.unit;

import com.workersql.sdk.util.DSNParser;
import com.workersql.sdk.util.ParsedDSN;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for DSN Parser
 */
class DSNParserTest {

    @Test
    void testParseBasicDSN() {
        String dsn = "workersql://user:pass@api.workersql.com/mydb?apiKey=abc123";
        ParsedDSN parsed = DSNParser.parse(dsn);

        assertEquals("workersql", parsed.getProtocol());
        assertEquals("user", parsed.getUsername());
        assertEquals("pass", parsed.getPassword());
        assertEquals("api.workersql.com", parsed.getHost());
        assertNull(parsed.getPort());
        assertEquals("mydb", parsed.getDatabase());
        assertEquals("abc123", parsed.getParams().get("apiKey"));
    }

    @Test
    void testParseWithPort() {
        String dsn = "workersql://user:pass@localhost:8787/test?apiKey=key";
        ParsedDSN parsed = DSNParser.parse(dsn);

        assertEquals("localhost", parsed.getHost());
        assertEquals(8787, parsed.getPort());
        assertEquals("test", parsed.getDatabase());
    }

    @Test
    void testParseWithoutCredentials() {
        String dsn = "workersql://api.workersql.com/mydb?apiKey=key";
        ParsedDSN parsed = DSNParser.parse(dsn);

        assertNull(parsed.getUsername());
        assertNull(parsed.getPassword());
        assertEquals("api.workersql.com", parsed.getHost());
    }

    @Test
    void testParseWithMultipleParams() {
        String dsn = "workersql://host/db?apiKey=key&ssl=false&timeout=5000";
        ParsedDSN parsed = DSNParser.parse(dsn);

        assertEquals("key", parsed.getParams().get("apiKey"));
        assertEquals("false", parsed.getParams().get("ssl"));
        assertEquals("5000", parsed.getParams().get("timeout"));
    }

    @Test
    void testParseInvalidProtocol() {
        String dsn = "mysql://user:pass@host/db";
        assertThrows(IllegalArgumentException.class, () -> DSNParser.parse(dsn));
    }

    @Test
    void testParseInvalidFormat() {
        String dsn = "not-a-valid-dsn";
        assertThrows(IllegalArgumentException.class, () -> DSNParser.parse(dsn));
    }

    @Test
    void testParseEmptyDSN() {
        assertThrows(IllegalArgumentException.class, () -> DSNParser.parse(""));
        assertThrows(IllegalArgumentException.class, () -> DSNParser.parse(null));
    }

    @Test
    void testParseInvalidPort() {
        String dsn = "workersql://host:99999/db";
        assertThrows(IllegalArgumentException.class, () -> DSNParser.parse(dsn));
    }

    @Test
    void testStringify() {
        ParsedDSN parsed = new ParsedDSN(
            "workersql",
            "user",
            "pass",
            "api.workersql.com",
            443,
            "mydb",
            java.util.Collections.singletonMap("apiKey", "abc123")
        );

        String dsn = DSNParser.stringify(parsed);
        assertTrue(dsn.contains("workersql://"));
        assertTrue(dsn.contains("user:pass@"));
        assertTrue(dsn.contains("api.workersql.com:443"));
        assertTrue(dsn.contains("/mydb"));
        assertTrue(dsn.contains("apiKey=abc123"));
    }

    @Test
    void testGetApiEndpointWithSSL() {
        ParsedDSN parsed = new ParsedDSN(
            "workersql",
            null,
            null,
            "api.workersql.com",
            443,
            "mydb",
            java.util.Collections.emptyMap()
        );

        String endpoint = DSNParser.getApiEndpoint(parsed);
        assertEquals("https://api.workersql.com:443/v1", endpoint);
    }

    @Test
    void testGetApiEndpointWithoutSSL() {
        ParsedDSN parsed = new ParsedDSN(
            "workersql",
            null,
            null,
            "localhost",
            8787,
            "test",
            java.util.Collections.singletonMap("ssl", "false")
        );

        String endpoint = DSNParser.getApiEndpoint(parsed);
        assertEquals("http://localhost:8787/v1", endpoint);
    }

    @Test
    void testGetApiEndpointFromParams() {
        ParsedDSN parsed = new ParsedDSN(
            "workersql",
            null,
            null,
            "host",
            null,
            "db",
            java.util.Collections.singletonMap("apiEndpoint", "https://custom.endpoint.com/v2")
        );

        String endpoint = DSNParser.getApiEndpoint(parsed);
        assertEquals("https://custom.endpoint.com/v2", endpoint);
    }

    @Test
    void testURLEncoding() {
        String dsn = "workersql://user%40domain:p%40ss@host/db%20name?key=value%20with%20spaces";
        ParsedDSN parsed = DSNParser.parse(dsn);

        assertEquals("user@domain", parsed.getUsername());
        assertEquals("p@ss", parsed.getPassword());
        assertEquals("db name", parsed.getDatabase());
        assertEquals("value with spaces", parsed.getParams().get("key"));
    }
}

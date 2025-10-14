package com.workersql.sdk.fuzz;

import com.workersql.sdk.client.WorkerSQLClient;
import com.workersql.sdk.client.WorkerSQLConfig;
import com.workersql.sdk.types.ErrorCode;
import com.workersql.sdk.types.QueryRequest;
import com.workersql.sdk.types.ValidationError;
import com.workersql.sdk.util.DSNParser;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.Arrays;
import java.util.Collections;
import java.util.Random;
import java.util.List;
import java.util.ArrayList;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Fuzz tests for WorkerSQL Java SDK
 * These tests verify security and robustness with malformed/malicious inputs
 */
class WorkerSQLFuzzTest {

    private static final Random random = new Random();

    @ParameterizedTest
    @ValueSource(strings = {
        // SQL injection attempts
        "'; DROP TABLE users; --",
        "1' OR '1'='1",
        "' UNION SELECT * FROM admin --",
        "1; DELETE FROM users WHERE 1=1 --",
        // XSS attempts
        "<script>alert('xss')</script>",
        "javascript:alert('xss')",
        // Command injection
        "; rm -rf /",
        "| cat /etc/passwd",
        // Path traversal
        "../../etc/passwd",
        "../../../windows/system32",
        // Null bytes
        "test\u0000",
        // Very long strings - using constant instead of repeat()
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        // Unicode edge cases
        "\uD800\uDC00", // surrogate pair
        "\uFFFD", // replacement character
    })
    void testMaliciousQueryStrings(String maliciousInput) {
        // Test that malicious inputs are handled safely
        QueryRequest.Builder builder = QueryRequest.builder();
        
        // Should not throw exception during building
        assertDoesNotThrow(() -> {
            builder.sql("SELECT * FROM users WHERE name = ?")
                   .params(Collections.singletonList(maliciousInput))
                   .build();
        });
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "",
        " ",
        "   ",
        "\t",
        "\n",
        "\r\n",
    })
    void testEmptyOrWhitespaceSQL(String sql) {
        // Empty or whitespace-only SQL should be rejected
        assertThrows(IllegalArgumentException.class, () -> {
            QueryRequest.builder().sql(sql).build();
        });
    }

    @Test
    void testNullSQLQuery() {
        assertThrows(IllegalArgumentException.class, () -> {
            QueryRequest.builder().sql(null).build();
        });
    }

    @Test
    void testExtremelyLargeParameterList() {
        // Test with 10,000 parameters
        int paramCount = 10000;
        StringBuilder sql = new StringBuilder("INSERT INTO test VALUES (");
        for (int i = 0; i < paramCount; i++) {
            if (i > 0) sql.append(", ");
            sql.append("?");
        }
        sql.append(")");

        QueryRequest.Builder builder = QueryRequest.builder().sql(sql.toString());
        for (int i = 0; i < paramCount; i++) {
            builder.addParam(i);
        }

        assertDoesNotThrow(builder::build);
    }

    @Test
    void testMixedParameterTypes() {
        // Test with various parameter types
        QueryRequest request = QueryRequest.builder()
            .sql("SELECT * WHERE a=? AND b=? AND c=? AND d=? AND e=?")
            .params(Arrays.asList(
                "string",
                123,
                true,
                null,
                -999.999
            ))
            .build();

        assertEquals(5, request.getParams().size());
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "not-a-dsn",
        "mysql://wrong-protocol@host/db",
        "workersql://", // incomplete
        "workersql:///", // no host
        "workersql://host:99999/db", // invalid port
        "workersql://host:-1/db", // negative port
        "workersql://host:abc/db", // non-numeric port
        "://host/db", // no protocol
        "workersql//host/db", // missing colon
    })
    void testMalformedDSN(String dsn) {
        assertThrows(IllegalArgumentException.class, () -> {
            DSNParser.parse(dsn);
        });
    }

    @Test
    void testDSNWithSpecialCharacters() {
        // Test DSN with URL-encoded special characters
        String dsn = "workersql://user%40domain:p%40ss%23word@host/db%2Fname?key=val%20ue";
        assertDoesNotThrow(() -> DSNParser.parse(dsn));
    }

    @Test
    void testDSNWithExtremelyLongValues() {
        String longString = "a".repeat(10000);
        String dsn = "workersql://" + longString + ":" + longString + "@host/db";
        
        // Should parse but may be impractical
        assertDoesNotThrow(() -> DSNParser.parse(dsn));
    }

    @ParameterizedTest
    @ValueSource(ints = {-1, 0, 100, 999, 10000000})
    void testInvalidTimeouts(int timeout) {
        if (timeout < 1000 || timeout > 300000) {
            assertThrows(IllegalArgumentException.class, () -> {
                QueryRequest.builder()
                    .sql("SELECT 1")
                    .timeout(timeout)
                    .build();
            });
        } else {
            assertDoesNotThrow(() -> {
                QueryRequest.builder()
                    .sql("SELECT 1")
                    .timeout(timeout)
                    .build();
            });
        }
    }

    @Test
    void testRandomByteSequences() {
        // Generate 100 random byte sequences
        for (int i = 0; i < 100; i++) {
            byte[] randomBytes = new byte[random.nextInt(1000) + 1];
            random.nextBytes(randomBytes);
            String randomString = new String(randomBytes);

            // Should handle gracefully
            assertDoesNotThrow(() -> {
                QueryRequest.builder()
                    .sql("SELECT * FROM test WHERE data = ?")
                    .params(Collections.singletonList(randomString))
                    .build();
            });
        }
    }

    @Test
    void testConcurrentParamBuilding() throws InterruptedException {
        // Note: Builder is not thread-safe, this test demonstrates thread safety issues
        // In practice, each thread should create its own builder
        Thread[] threads = new Thread[10];
        List<QueryRequest> requests = new ArrayList<>();

        for (int i = 0; i < threads.length; i++) {
            final int index = i;
            threads[i] = new Thread(() -> {
                QueryRequest.Builder builder = QueryRequest.builder().sql("SELECT ?");
                for (int j = 0; j < 100; j++) {
                    builder.addParam("thread-" + index + "-" + j);
                }
                synchronized (requests) {
                    requests.add(builder.build());
                }
            });
            threads[i].start();
        }

        for (Thread thread : threads) {
            thread.join();
        }

        // Verify we have 10 requests, each with 100 params
        assertEquals(10, requests.size());
        for (QueryRequest request : requests) {
            assertEquals(100, request.getParams().size());
        }
    }

    @Test
    void testInvalidCacheTTL() {
        assertThrows(IllegalArgumentException.class, () -> {
            com.workersql.sdk.types.CacheOptions.builder()
                .ttl(-1)
                .build();
        });

        assertThrows(IllegalArgumentException.class, () -> {
            com.workersql.sdk.types.CacheOptions.builder()
                .ttl(0)
                .build();
        });

        assertThrows(IllegalArgumentException.class, () -> {
            com.workersql.sdk.types.CacheOptions.builder()
                .ttl(86401) // Over max
                .build();
        });
    }

    @Test
    void testDatabaseConfigValidation() {
        // Test missing required fields
        assertThrows(IllegalArgumentException.class, () -> {
            com.workersql.sdk.types.DatabaseConfig.builder()
                .port(3306)
                .build();
        });

        assertThrows(IllegalArgumentException.class, () -> {
            com.workersql.sdk.types.DatabaseConfig.builder()
                .host("localhost")
                .build();
        });

        // Test invalid port ranges
        assertThrows(IllegalArgumentException.class, () -> {
            com.workersql.sdk.types.DatabaseConfig.builder()
                .host("localhost")
                .username("user")
                .password("pass")
                .database("db")
                .port(0)
                .build();
        });

        assertThrows(IllegalArgumentException.class, () -> {
            com.workersql.sdk.types.DatabaseConfig.builder()
                .host("localhost")
                .username("user")
                .password("pass")
                .database("db")
                .port(65536)
                .build();
        });

        // Test invalid timeout
        assertThrows(IllegalArgumentException.class, () -> {
            com.workersql.sdk.types.DatabaseConfig.builder()
                .host("localhost")
                .username("user")
                .password("pass")
                .database("db")
                .timeout(999) // Below minimum
                .build();
        });
    }

    @Test
    void testUnicodeHandling() {
        // Test various Unicode edge cases
        String[] unicodeStrings = {
            "Hello 世界", // Mixed ASCII and CJK
            "مرحبا", // Arabic
            "Здравствуй", // Cyrillic
            "🎉🎊🎈", // Emojis
            "\\u0000\\u0001", // Control characters
            "\uD83D\uDE00", // Emoji (surrogate pair)
        };

        for (String unicode : unicodeStrings) {
            assertDoesNotThrow(() -> {
                QueryRequest.builder()
                    .sql("SELECT * FROM test WHERE name = ?")
                    .params(Collections.singletonList(unicode))
                    .build();
            });
        }
    }
}

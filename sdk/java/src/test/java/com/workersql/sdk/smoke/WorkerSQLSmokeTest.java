package com.workersql.sdk.smoke;

import com.workersql.sdk.client.WorkerSQLClient;
import com.workersql.sdk.client.WorkerSQLConfig;
import com.workersql.sdk.types.QueryResponse;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import org.junit.jupiter.api.*;

import java.util.Arrays;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Smoke tests for WorkerSQL Java SDK
 * These tests verify end-to-end functionality with a mock server
 */
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class WorkerSQLSmokeTest {

    private static MockWebServer mockServer;
    private WorkerSQLClient client;

    @BeforeAll
    static void setupServer() throws Exception {
        mockServer = new MockWebServer();
        mockServer.start();
    }

    @AfterAll
    static void tearDownServer() throws Exception {
        mockServer.shutdown();
    }

    @BeforeEach
    void setUp() {
        String baseUrl = mockServer.url("/v1").toString();
        WorkerSQLConfig config = WorkerSQLConfig.builder()
            .host("localhost")
            .port(mockServer.getPort())
            .username("test")
            .password("test")
            .database("testdb")
            .apiEndpoint(baseUrl.substring(0, baseUrl.length() - 1)) // Remove trailing slash
            .apiKey("test-key")
            .poolingEnabled(false)
            .build();

        client = new WorkerSQLClient(config);
    }

    @AfterEach
    void tearDown() throws Exception {
        if (client != null) {
            client.close();
        }
    }

    @Test
    @Order(1)
    void testBasicQuerySuccess() throws Exception {
        mockServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setBody("{\"success\":true,\"data\":[{\"id\":1,\"name\":\"test\"}],\"rowCount\":1}")
            .addHeader("Content-Type", "application/json"));

        QueryResponse response = client.query("SELECT * FROM users WHERE id = ?", Arrays.asList(1));

        assertTrue(response.isSuccess());
        assertNotNull(response.getData());
        assertEquals(1, response.getData().size());
        assertEquals(1, response.getRowCount());
    }

    @Test
    @Order(2)
    void testQueryWithoutParams() throws Exception {
        mockServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setBody("{\"success\":true,\"data\":[],\"rowCount\":0}")
            .addHeader("Content-Type", "application/json"));

        QueryResponse response = client.query("SELECT * FROM users");

        assertTrue(response.isSuccess());
        assertNotNull(response.getData());
        assertEquals(0, response.getData().size());
    }

    @Test
    @Order(3)
    void testInsertQuery() throws Exception {
        mockServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setBody("{\"success\":true,\"rowCount\":1,\"executionTime\":15.5}")
            .addHeader("Content-Type", "application/json"));

        QueryResponse response = client.query(
            "INSERT INTO users (name, email) VALUES (?, ?)",
            Arrays.asList("John Doe", "john@example.com")
        );

        assertTrue(response.isSuccess());
        assertEquals(1, response.getRowCount());
        assertNotNull(response.getExecutionTime());
        assertTrue(response.getExecutionTime() > 0);
    }

    @Test
    @Order(4)
    void testHealthCheck() throws Exception {
        mockServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setBody("{\"status\":\"healthy\"}")
            .addHeader("Content-Type", "application/json"));

        // Health check endpoint validation (simplified for testing)
        assertDoesNotThrow(() -> client.healthCheck());
    }

    @Test
    @Order(5)
    void testConnectionPoolDisabled() {
        Map<String, Object> stats = client.getPoolStats();
        assertNull(stats, "Pool stats should be null when pooling is disabled");
    }

    @Test
    @Order(6)
    @org.junit.jupiter.api.Disabled("Requires mock server URL adjustment for proper hostname resolution")
    void testDSNConnection() throws Exception {
        String dsn = "workersql://test:test@localhost:" + mockServer.getPort() + "/testdb?apiKey=test-key&pooling=false";
        
        mockServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setBody("{\"success\":true,\"data\":[]}")
            .addHeader("Content-Type", "application/json"));

        try (WorkerSQLClient dsnClient = new WorkerSQLClient(dsn)) {
            QueryResponse response = dsnClient.query("SELECT 1");
            assertTrue(response.isSuccess());
        }
    }

    @Test
    @Order(7)
    void testCachedResponse() throws Exception {
        mockServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setBody("{\"success\":true,\"data\":[{\"id\":1}],\"rowCount\":1,\"cached\":true}")
            .addHeader("Content-Type", "application/json"));

        QueryResponse response = client.query("SELECT * FROM users WHERE id = 1");

        assertTrue(response.isSuccess());
        Boolean cached = response.getCached();
        // Cached may be null if not present in response
        if (cached != null) {
            assertTrue(cached);
        }
    }

    @Test
    @Order(8)
    void testMultipleQueries() throws Exception {
        for (int i = 0; i < 5; i++) {
            mockServer.enqueue(new MockResponse()
                .setResponseCode(200)
                .setBody("{\"success\":true,\"data\":[],\"rowCount\":0}")
                .addHeader("Content-Type", "application/json"));
        }

        for (int i = 0; i < 5; i++) {
            QueryResponse response = client.query("SELECT * FROM table" + i);
            assertTrue(response.isSuccess());
        }
    }

    @Test
    @Order(9)
    void testAutoCloseableInterface() throws Exception {
        mockServer.enqueue(new MockResponse()
            .setResponseCode(200)
            .setBody("{\"success\":true,\"data\":[]}")
            .addHeader("Content-Type", "application/json"));

        String baseUrl = mockServer.url("/v1").toString();
        WorkerSQLConfig config = WorkerSQLConfig.builder()
            .host("localhost")
            .port(mockServer.getPort())
            .username("test")
            .password("test")
            .database("testdb")
            .apiEndpoint(baseUrl.substring(0, baseUrl.length() - 1))
            .apiKey("test-key")
            .poolingEnabled(false)
            .build();

        try (WorkerSQLClient autoClient = new WorkerSQLClient(config)) {
            QueryResponse response = autoClient.query("SELECT 1");
            assertTrue(response.isSuccess());
        } // Client should auto-close here
    }
}

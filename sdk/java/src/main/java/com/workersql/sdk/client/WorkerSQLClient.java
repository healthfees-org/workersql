package com.workersql.sdk.client;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.reflect.TypeToken;
import com.workersql.sdk.pool.ConnectionPool;
import com.workersql.sdk.pool.PooledConnection;
import com.workersql.sdk.retry.RetryStrategy;
import com.workersql.sdk.types.*;
import com.workersql.sdk.util.DSNParser;
import com.workersql.sdk.util.ParsedDSN;
import com.workersql.sdk.websocket.WebSocketTransactionClient;
import com.workersql.sdk.metadata.MetadataProvider;
import com.workersql.sdk.procedures.StoredProcedureCaller;
import com.workersql.sdk.procedures.MultiStatementExecutor;
import com.workersql.sdk.streaming.QueryStream;
import com.workersql.sdk.streaming.CursorStream;
import com.workersql.sdk.streaming.StreamOptions;
import okhttp3.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.lang.reflect.Type;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.Callable;
import java.util.concurrent.TimeUnit;

/**
 * WorkerSQL Java SDK Client
 * Main client class for interacting with WorkerSQL edge database
 */
public class WorkerSQLClient implements AutoCloseable {
    private static final Logger logger = LoggerFactory.getLogger(WorkerSQLClient.class);
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");
    private static final Gson gson = new GsonBuilder()
        .setDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'")
        .create();

    private final WorkerSQLConfig config;
    private final OkHttpClient httpClient;
    private final ConnectionPool pool;
    private final RetryStrategy retryStrategy;
    private final ParsedDSN parsedDSN;

    /**
     * Create a client from DSN string
     */
    public WorkerSQLClient(String dsn) {
        this(configFromDSN(dsn));
    }

    /**
     * Create a client from configuration object
     */
    public WorkerSQLClient(WorkerSQLConfig config) {
        this.config = config;
        this.parsedDSN = null;

        // Initialize retry strategy
        this.retryStrategy = new RetryStrategy.Builder()
            .maxAttempts(config.getRetryAttempts())
            .initialDelayMs(config.getRetryDelay())
            .build();

        // Initialize connection pool if enabled
        if (config.isPoolingEnabled()) {
            this.pool = new ConnectionPool(
                config.getApiEndpoint(),
                config.getApiKey(),
                config.getMinConnections(),
                config.getMaxConnections(),
                config.getIdleTimeout(),
                config.getTimeout()
            );
            this.httpClient = null;
        } else {
            this.pool = null;
            this.httpClient = createHttpClient();
        }
    }

    private static WorkerSQLConfig configFromDSN(String dsn) {
        ParsedDSN parsed = DSNParser.parse(dsn);

        return WorkerSQLConfig.builder()
            .host(parsed.getHost())
            .port(parsed.getPort() != null ? parsed.getPort() : 443)
            .username(parsed.getUsername())
            .password(parsed.getPassword())
            .database(parsed.getDatabase())
            .apiEndpoint(DSNParser.getApiEndpoint(parsed))
            .apiKey(parsed.getParams().get("apiKey"))
            .ssl(!"false".equalsIgnoreCase(parsed.getParams().get("ssl")))
            .timeout(parseIntParam(parsed.getParams(), "timeout", 30000))
            .retryAttempts(parseIntParam(parsed.getParams(), "retryAttempts", 3))
            .poolingEnabled(!"false".equalsIgnoreCase(parsed.getParams().get("pooling")))
            .minConnections(parseIntParam(parsed.getParams(), "minConnections", 1))
            .maxConnections(parseIntParam(parsed.getParams(), "maxConnections", 10))
            .build();
    }

    private static int parseIntParam(Map<String, String> params, String key, int defaultValue) {
        String value = params.get(key);
        if (value != null) {
            try {
                return Integer.parseInt(value);
            } catch (NumberFormatException e) {
                logger.warn("Invalid {} parameter: {}, using default: {}", key, value, defaultValue);
            }
        }
        return defaultValue;
    }

    private OkHttpClient createHttpClient() {
        OkHttpClient.Builder builder = new OkHttpClient.Builder()
            .connectTimeout(config.getTimeout(), TimeUnit.MILLISECONDS)
            .readTimeout(config.getTimeout(), TimeUnit.MILLISECONDS)
            .writeTimeout(config.getTimeout(), TimeUnit.MILLISECONDS);

        builder.addInterceptor(chain -> {
            Request original = chain.request();
            Request.Builder requestBuilder = original.newBuilder()
                .header("Content-Type", "application/json")
                .header("User-Agent", "WorkerSQL-JavaSDK/1.0.0");

            if (config.getApiKey() != null) {
                requestBuilder.header("Authorization", "Bearer " + config.getApiKey());
            }

            return chain.proceed(requestBuilder.build());
        });

        return builder.build();
    }

    /**
     * Execute a SQL query
     */
    public QueryResponse query(String sql) throws Exception {
        return query(sql, Collections.emptyList());
    }

    /**
     * Execute a SQL query with parameters
     */
    public QueryResponse query(String sql, List<Object> params) throws Exception {
        QueryRequest request = QueryRequest.builder()
            .sql(sql)
            .params(params)
            .build();

        return executeQuery(request);
    }

    /**
     * Execute a query request
     */
    private QueryResponse executeQuery(QueryRequest request) throws Exception {
        String endpoint = config.getApiEndpoint() + "/query";

        return retryStrategy.execute(() -> {
            String jsonBody = gson.toJson(request);
            RequestBody body = RequestBody.create(jsonBody, JSON);
            Request httpRequest = new Request.Builder()
                .url(endpoint)
                .post(body)
                .build();

            Response response;
            if (pool != null) {
                PooledConnection conn = pool.acquire();
                try {
                    response = conn.getClient().newCall(httpRequest).execute();
                } finally {
                    pool.release(conn.getId());
                }
            } else {
                response = httpClient.newCall(httpRequest).execute();
            }

            return parseQueryResponse(response);
        }, "query");
    }

    /**
     * Execute a transaction
     */
    public void transaction(TransactionCallback callback) throws Exception {
        // Generate transaction ID
        String transactionId = UUID.randomUUID().toString();

        // Begin transaction
        beginTransaction(transactionId);

        try {
            // Execute queries in transaction
            TransactionContext ctx = new TransactionContext(transactionId, this);
            callback.execute(ctx);

            // Commit transaction
            commitTransaction(transactionId);
        } catch (Exception e) {
            // Rollback transaction on error
            try {
                rollbackTransaction(transactionId);
            } catch (Exception rollbackError) {
                logger.error("Failed to rollback transaction: {}", rollbackError.getMessage());
            }
            throw e;
        }
    }

    private void beginTransaction(String transactionId) throws Exception {
        String endpoint = config.getApiEndpoint() + "/transaction";
        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("operation", "BEGIN");
        requestBody.put("transactionId", transactionId);

        executeTransactionOperation(endpoint, requestBody);
    }

    private void commitTransaction(String transactionId) throws Exception {
        String endpoint = config.getApiEndpoint() + "/transaction";
        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("operation", "COMMIT");
        requestBody.put("transactionId", transactionId);

        executeTransactionOperation(endpoint, requestBody);
    }

    private void rollbackTransaction(String transactionId) throws Exception {
        String endpoint = config.getApiEndpoint() + "/transaction";
        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("operation", "ROLLBACK");
        requestBody.put("transactionId", transactionId);

        executeTransactionOperation(endpoint, requestBody);
    }

    private void executeTransactionOperation(String endpoint, Map<String, Object> requestBody) throws Exception {
        String jsonBody = gson.toJson(requestBody);
        RequestBody body = RequestBody.create(jsonBody, JSON);
        Request httpRequest = new Request.Builder()
            .url(endpoint)
            .post(body)
            .build();

        Response response;
        if (pool != null) {
            PooledConnection conn = pool.acquire();
            try {
                response = conn.getClient().newCall(httpRequest).execute();
            } finally {
                pool.release(conn.getId());
            }
        } else {
            response = httpClient.newCall(httpRequest).execute();
        }

        if (!response.isSuccessful()) {
            throw new ValidationError(ErrorCode.INTERNAL_ERROR, "Transaction operation failed");
        }
    }

    /**
     * Check service health
     */
    public HealthCheckResponse healthCheck() throws Exception {
        String endpoint = config.getApiEndpoint() + "/health";
        Request httpRequest = new Request.Builder()
            .url(endpoint)
            .get()
            .build();

        Response response;
        if (pool != null) {
            PooledConnection conn = pool.acquire();
            try {
                response = conn.getClient().newCall(httpRequest).execute();
            } finally {
                pool.release(conn.getId());
            }
        } else {
            response = httpClient.newCall(httpRequest).execute();
        }

        if (!response.isSuccessful()) {
            throw new ValidationError(ErrorCode.CONNECTION_ERROR, "Health check failed");
        }

        String responseBody = response.body().string();
        Type type = new TypeToken<HealthCheckResponse>(){}.getType();
        return gson.fromJson(responseBody, type);
    }

    /**
     * Get connection pool statistics
     */
    public Map<String, Object> getPoolStats() {
        if (pool != null) {
            return pool.getStats();
        }
        return null;
    }

    /**
     * Parse query response from HTTP response
     */
    private QueryResponse parseQueryResponse(Response response) throws IOException {
        if (!response.isSuccessful()) {
            String errorBody = response.body() != null ? response.body().string() : "Unknown error";
            throw new ValidationError(ErrorCode.CONNECTION_ERROR, "HTTP " + response.code() + ": " + errorBody);
        }

        String responseBody = response.body().string();
        Type type = new TypeToken<Map<String, Object>>(){}.getType();
        Map<String, Object> jsonResponse = gson.fromJson(responseBody, type);

        QueryResponse.Builder builder = QueryResponse.builder()
            .success((Boolean) jsonResponse.getOrDefault("success", false));

        if (jsonResponse.containsKey("data")) {
            Type dataType = new TypeToken<List<Map<String, Object>>>(){}.getType();
            builder.data((List<Map<String, Object>>) jsonResponse.get("data"));
        }

        if (jsonResponse.containsKey("rowCount")) {
            builder.rowCount(((Number) jsonResponse.get("rowCount")).intValue());
        }

        if (jsonResponse.containsKey("executionTime")) {
            builder.executionTime(((Number) jsonResponse.get("executionTime")).doubleValue());
        }

        if (jsonResponse.containsKey("cached")) {
            builder.cached((Boolean) jsonResponse.get("cached"));
        }

        if (jsonResponse.containsKey("error")) {
            Map<String, Object> errorMap = (Map<String, Object>) jsonResponse.get("error");
            ErrorCode errorCode = ErrorCode.valueOf((String) errorMap.get("code"));
            String message = (String) errorMap.get("message");
            Map<String, Object> details = (Map<String, Object>) errorMap.get("details");
            Instant timestamp = Instant.parse((String) errorMap.get("timestamp"));

            builder.error(new ErrorResponse(errorCode, message, details, timestamp));
        }

        return builder.build();
    }

    // ========== WebSocket Transaction Support ==========

    /**
     * Create a WebSocket transaction client for sticky sessions
     */
    public WebSocketTransactionClient createWebSocketClient() {
        return new WebSocketTransactionClient(config.getApiEndpoint(), config.getApiKey());
    }

    /**
     * Execute a transaction using WebSocket sticky sessions
     */
    public void transactionWebSocket(TransactionCallback callback) throws Exception {
        WebSocketTransactionClient wsClient = createWebSocketClient();
        try {
            // Connect to WebSocket
            wsClient.connect().get();

            // Begin transaction
            String txId = wsClient.begin().get();
            logger.debug("Started WebSocket transaction: {}", txId);

            try {
                // Execute callback
                TransactionContext ctx = new TransactionContext(txId, this);
                callback.execute(ctx);

                // Commit
                wsClient.commit().get();
                logger.debug("Committed WebSocket transaction: {}", txId);
            } catch (Exception e) {
                // Rollback on error
                try {
                    wsClient.rollback().get();
                    logger.debug("Rolled back WebSocket transaction: {}", txId);
                } catch (Exception rollbackError) {
                    logger.error("Failed to rollback transaction", rollbackError);
                }
                throw e;
            }
        } finally {
            wsClient.close();
        }
    }

    // ========== Metadata Provider Support ==========

    /**
     * Get metadata provider for database introspection
     */
    public MetadataProvider getMetadataProvider() {
        return new MetadataProvider((sql, params) -> query(sql, params));
    }

    // ========== Stored Procedure Support ==========

    /**
     * Get stored procedure caller
     */
    public StoredProcedureCaller getStoredProcedureCaller() {
        return new StoredProcedureCaller((sql, params) -> query(sql, params));
    }

    /**
     * Get multi-statement executor
     */
    public MultiStatementExecutor getMultiStatementExecutor() {
        return new MultiStatementExecutor((sql, params) -> query(sql, params));
    }

    // ========== Query Streaming Support ==========

    /**
     * Create a query stream for large result sets
     */
    public QueryStream streamQuery(String sql, List<Object> params, StreamOptions options) {
        return new QueryStream(sql, params, (s, p) -> query(s, p), options);
    }

    /**
     * Create a query stream with default options
     */
    public QueryStream streamQuery(String sql, List<Object> params) {
        return streamQuery(sql, params, null);
    }

    /**
     * Create a query stream without parameters
     */
    public QueryStream streamQuery(String sql) {
        return streamQuery(sql, Collections.emptyList(), null);
    }

    /**
     * Create a cursor-based stream for large result sets
     */
    public CursorStream createCursorStream(String sql, List<Object> params, StreamOptions options) {
        return new CursorStream(sql, params, (s, p) -> query(s, p), options);
    }

    /**
     * Create a cursor stream with default options
     */
    public CursorStream createCursorStream(String sql, List<Object> params) {
        return createCursorStream(sql, params, null);
    }

    /**
     * Create a cursor stream without parameters
     */
    public CursorStream createCursorStream(String sql) {
        return createCursorStream(sql, Collections.emptyList(), null);
    }

    /**
     * Close the client and release resources
     */
    @Override
    public void close() throws Exception {
        if (pool != null) {
            pool.close();
        }
    }

    /**
     * Transaction callback interface
     */
    public interface TransactionCallback {
        void execute(TransactionContext ctx) throws Exception;
    }

    /**
     * Transaction context for executing queries within a transaction
     */
    public static class TransactionContext {
        private final String transactionId;
        private final WorkerSQLClient client;

        TransactionContext(String transactionId, WorkerSQLClient client) {
            this.transactionId = transactionId;
            this.client = client;
        }

        public QueryResponse query(String sql) throws Exception {
            return query(sql, Collections.emptyList());
        }

        public QueryResponse query(String sql, List<Object> params) throws Exception {
            return client.query(sql, params);
        }
    }
}

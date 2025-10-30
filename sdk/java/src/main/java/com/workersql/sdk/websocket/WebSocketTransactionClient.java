package com.workersql.sdk.websocket;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.workersql.sdk.types.ErrorCode;
import com.workersql.sdk.types.QueryResponse;
import com.workersql.sdk.types.ValidationError;
import okhttp3.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * WebSocket message types
 */
class WebSocketMessage {
    private String type;
    private String id;
    private String sql;
    private Object[] params;
    private String transactionId;
    private Object data;
    private Map<String, Object> error;

    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getSql() { return sql; }
    public void setSql(String sql) { this.sql = sql; }
    public Object[] getParams() { return params; }
    public void setParams(Object[] params) { this.params = params; }
    public String getTransactionId() { return transactionId; }
    public void setTransactionId(String transactionId) { this.transactionId = transactionId; }
    public Object getData() { return data; }
    public void setData(Object data) { this.data = data; }
    public Map<String, Object> getError() { return error; }
    public void setError(Map<String, Object> error) { this.error = error; }
}

/**
 * WebSocket Transaction Client for WorkerSQL
 * Provides sticky sessions for transactions using WebSocket connections
 */
public class WebSocketTransactionClient {
    private static final Logger logger = LoggerFactory.getLogger(WebSocketTransactionClient.class);
    private static final Gson gson = new GsonBuilder().create();

    private WebSocket ws;
    private final String url;
    private final String apiKey;
    private final Map<String, CompletableFuture<Object>> messageHandlers = new ConcurrentHashMap<>();
    private volatile boolean connected = false;
    private volatile boolean connecting = false;
    private String transactionId;

    public WebSocketTransactionClient(String apiEndpoint, String apiKey) {
        // Convert HTTP(S) URL to WS(S)
        this.url = apiEndpoint.replaceFirst("^http", "ws") + "/ws";
        this.apiKey = apiKey;
    }

    /**
     * Connect to WebSocket server
     */
    public CompletableFuture<Void> connect() {
        if (connected) {
            return CompletableFuture.completedFuture(null);
        }

        if (connecting) {
            // Wait for existing connection attempt
            return CompletableFuture.supplyAsync(() -> {
                while (connecting && !connected) {
                    try {
                        Thread.sleep(100);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        throw new ValidationError(ErrorCode.CONNECTION_ERROR, "Connection interrupted");
                    }
                }
                if (!connected) {
                    throw new ValidationError(ErrorCode.CONNECTION_ERROR, "WebSocket connection failed");
                }
                return null;
            });
        }

        connecting = true;

        CompletableFuture<Void> future = new CompletableFuture<>();

        try {
            OkHttpClient client = new OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(0, TimeUnit.SECONDS)
                .build();

            String wsUrl = apiKey != null ? url + "?token=" + apiKey : url;
            Request request = new Request.Builder().url(wsUrl).build();

            ws = client.newWebSocket(request, new WebSocketListener() {
                @Override
                public void onOpen(WebSocket webSocket, Response response) {
                    connected = true;
                    connecting = false;
                    logger.debug("[WorkerSQL WS] Connected");
                    future.complete(null);
                }

                @Override
                public void onMessage(WebSocket webSocket, String text) {
                    handleMessage(text);
                }

                @Override
                public void onFailure(WebSocket webSocket, Throwable t, Response response) {
                    connecting = false;
                    connected = false;
                    logger.error("[WorkerSQL WS] Connection failed", t);
                    
                    // Reject all pending handlers
                    for (Map.Entry<String, CompletableFuture<Object>> entry : messageHandlers.entrySet()) {
                        entry.getValue().completeExceptionally(
                            new ValidationError(ErrorCode.CONNECTION_ERROR, "WebSocket connection failed")
                        );
                    }
                    messageHandlers.clear();

                    if (!future.isDone()) {
                        future.completeExceptionally(
                            new ValidationError(ErrorCode.CONNECTION_ERROR, "WebSocket connection error: " + t.getMessage())
                        );
                    }
                }

                @Override
                public void onClosed(WebSocket webSocket, int code, String reason) {
                    connected = false;
                    connecting = false;
                    logger.debug("[WorkerSQL WS] Connection closed: {}", reason);

                    // Reject all pending handlers
                    for (Map.Entry<String, CompletableFuture<Object>> entry : messageHandlers.entrySet()) {
                        entry.getValue().completeExceptionally(
                            new ValidationError(ErrorCode.CONNECTION_ERROR, "WebSocket connection closed")
                        );
                    }
                    messageHandlers.clear();
                }
            });

        } catch (Exception e) {
            connecting = false;
            future.completeExceptionally(
                new ValidationError(ErrorCode.CONNECTION_ERROR, "Failed to create WebSocket connection: " + e.getMessage())
            );
        }

        return future;
    }

    /**
     * Handle incoming WebSocket messages
     */
    private void handleMessage(String data) {
        try {
            WebSocketMessage message = gson.fromJson(data, WebSocketMessage.class);
            CompletableFuture<Object> handler = messageHandlers.remove(message.getId());

            if (handler != null) {
                if ("error".equals(message.getType())) {
                    Map<String, Object> error = message.getError();
                    String code = error != null ? (String) error.get("code") : "INTERNAL_ERROR";
                    String msg = error != null ? (String) error.get("message") : "Unknown error";
                    handler.completeExceptionally(
                        new ValidationError(ErrorCode.valueOf(code), msg)
                    );
                } else {
                    handler.complete(message.getData());
                }
            }
        } catch (Exception e) {
            logger.error("[WorkerSQL WS] Failed to parse message", e);
        }
    }

    /**
     * Send a message and wait for response
     */
    private CompletableFuture<Object> sendMessage(String type, String sql, Object[] params, String transactionId) {
        if (!connected || ws == null) {
            return CompletableFuture.failedFuture(
                new ValidationError(ErrorCode.CONNECTION_ERROR, "WebSocket not connected")
            );
        }

        String id = "msg_" + System.currentTimeMillis() + "_" + UUID.randomUUID().toString().substring(0, 8);

        WebSocketMessage message = new WebSocketMessage();
        message.setType(type);
        message.setId(id);
        message.setSql(sql);
        message.setParams(params);
        message.setTransactionId(transactionId);

        String jsonMessage = gson.toJson(message);
        CompletableFuture<Object> future = new CompletableFuture<>();

        // Set timeout
        CompletableFuture.delayedExecutor(30, TimeUnit.SECONDS).execute(() -> {
            if (messageHandlers.remove(id) != null) {
                future.completeExceptionally(
                    new ValidationError(ErrorCode.TIMEOUT_ERROR, "WebSocket message timeout")
                );
            }
        });

        messageHandlers.put(id, future);
        ws.send(jsonMessage);

        return future;
    }

    /**
     * Begin a transaction
     */
    public CompletableFuture<String> begin() {
        String txId = "tx_" + System.currentTimeMillis() + "_" + UUID.randomUUID().toString().substring(0, 8);
        this.transactionId = txId;

        return sendMessage("begin", null, null, txId)
            .thenApply(data -> txId);
    }

    /**
     * Execute a query within the transaction
     */
    public CompletableFuture<QueryResponse> query(String sql, Object[] params) {
        return sendMessage("query", sql, params, transactionId)
            .thenApply(data -> {
                // Convert response to QueryResponse
                return QueryResponse.builder()
                    .success(true)
                    .data((java.util.List<Map<String, Object>>) data)
                    .build();
            });
    }

    /**
     * Commit the transaction
     */
    public CompletableFuture<Void> commit() {
        return sendMessage("commit", null, null, transactionId)
            .thenApply(data -> null);
    }

    /**
     * Rollback the transaction
     */
    public CompletableFuture<Void> rollback() {
        return sendMessage("rollback", null, null, transactionId)
            .thenApply(data -> null);
    }

    /**
     * Close the WebSocket connection
     */
    public void close() {
        if (ws != null) {
            ws.close(1000, "Client closing");
            ws = null;
        }
        connected = false;
        connecting = false;
        messageHandlers.clear();
    }

    public boolean isConnected() {
        return connected;
    }

    public String getTransactionId() {
        return transactionId;
    }
}

package com.workersql.sdk.pool;

import com.workersql.sdk.types.ErrorCode;
import com.workersql.sdk.types.ValidationError;
import okhttp3.OkHttpClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Connection pool configuration
 */
class ConnectionPoolConfig {
    private final String apiEndpoint;
    private final String apiKey;
    private final int minConnections;
    private final int maxConnections;
    private final long idleTimeoutMs;
    private final long connectionTimeoutMs;
    private final long healthCheckIntervalMs;

    public ConnectionPoolConfig(String apiEndpoint, String apiKey, int minConnections, int maxConnections,
                                long idleTimeoutMs, long connectionTimeoutMs, long healthCheckIntervalMs) {
        this.apiEndpoint = apiEndpoint;
        this.apiKey = apiKey;
        this.minConnections = minConnections;
        this.maxConnections = maxConnections;
        this.idleTimeoutMs = idleTimeoutMs;
        this.connectionTimeoutMs = connectionTimeoutMs;
        this.healthCheckIntervalMs = healthCheckIntervalMs;
    }

    public String getApiEndpoint() { return apiEndpoint; }
    public String getApiKey() { return apiKey; }
    public int getMinConnections() { return minConnections; }
    public int getMaxConnections() { return maxConnections; }
    public long getIdleTimeoutMs() { return idleTimeoutMs; }
    public long getConnectionTimeoutMs() { return connectionTimeoutMs; }
    public long getHealthCheckIntervalMs() { return healthCheckIntervalMs; }
}

/**
 * Connection pool for WorkerSQL
 * Manages a pool of reusable HTTP connections with health checking
 */
public class ConnectionPool {
    private static final Logger logger = LoggerFactory.getLogger(ConnectionPool.class);

    private final Map<String, PooledConnection> connections = new ConcurrentHashMap<>();
    private final ConnectionPoolConfig config;
    private final ScheduledExecutorService healthCheckExecutor;
    private final AtomicBoolean closed = new AtomicBoolean(false);

    public ConnectionPool(String apiEndpoint, String apiKey, int minConnections, int maxConnections,
                          long idleTimeoutMs, long connectionTimeoutMs) {
        this(apiEndpoint, apiKey, minConnections, maxConnections, idleTimeoutMs, connectionTimeoutMs, 60000);
    }

    public ConnectionPool(String apiEndpoint, String apiKey, int minConnections, int maxConnections,
                          long idleTimeoutMs, long connectionTimeoutMs, long healthCheckIntervalMs) {
        this.config = new ConnectionPoolConfig(
            apiEndpoint, apiKey, minConnections, maxConnections,
            idleTimeoutMs, connectionTimeoutMs, healthCheckIntervalMs
        );

        this.healthCheckExecutor = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "ConnectionPool-HealthCheck");
            t.setDaemon(true);
            return t;
        });

        initialize();
    }

    private void initialize() {
        // Create minimum connections
        for (int i = 0; i < config.getMinConnections(); i++) {
            createConnection();
        }

        // Start health check timer
        if (config.getHealthCheckIntervalMs() > 0) {
            healthCheckExecutor.scheduleAtFixedRate(
                this::performHealthCheck,
                config.getHealthCheckIntervalMs(),
                config.getHealthCheckIntervalMs(),
                TimeUnit.MILLISECONDS
            );
        }
    }

    private PooledConnection createConnection() {
        String id = "conn_" + System.currentTimeMillis() + "_" + UUID.randomUUID().toString().substring(0, 8);

        OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(config.getConnectionTimeoutMs(), TimeUnit.MILLISECONDS)
            .readTimeout(config.getConnectionTimeoutMs(), TimeUnit.MILLISECONDS)
            .writeTimeout(config.getConnectionTimeoutMs(), TimeUnit.MILLISECONDS)
            .build();

        PooledConnection connection = new PooledConnection(id, client);
        connections.put(id, connection);
        logger.debug("Created new connection: {}", id);
        return connection;
    }

    /**
     * Acquire a connection from the pool
     */
    public PooledConnection acquire() throws ValidationError, InterruptedException {
        if (closed.get()) {
            throw new ValidationError(ErrorCode.CONNECTION_ERROR, "Connection pool is closed");
        }

        // Try to find an idle connection
        for (PooledConnection conn : connections.values()) {
            if (!conn.isInUse()) {
                conn.markInUse();
                logger.debug("Acquired existing connection: {}", conn.getId());
                return conn;
            }
        }

        // No idle connections, create a new one if below max
        synchronized (this) {
            if (connections.size() < config.getMaxConnections()) {
                PooledConnection conn = createConnection();
                conn.markInUse();
                logger.debug("Acquired new connection: {}", conn.getId());
                return conn;
            }
        }

        // Wait for a connection to become available
        long startTime = System.currentTimeMillis();
        while (System.currentTimeMillis() - startTime < config.getConnectionTimeoutMs()) {
            for (PooledConnection conn : connections.values()) {
                if (!conn.isInUse()) {
                    conn.markInUse();
                    logger.debug("Acquired available connection after wait: {}", conn.getId());
                    return conn;
                }
            }
            Thread.sleep(100);
        }

        throw new ValidationError(ErrorCode.TIMEOUT_ERROR, "Timeout waiting for connection");
    }

    /**
     * Release a connection back to the pool
     */
    public void release(String connectionId) {
        PooledConnection conn = connections.get(connectionId);
        if (conn != null) {
            conn.release();
            logger.debug("Released connection: {}", connectionId);
        }
    }

    /**
     * Remove idle connections
     */
    private void performHealthCheck() {
        if (closed.get()) {
            return;
        }

        long now = System.currentTimeMillis();
        List<String> connectionsToRemove = new ArrayList<>();

        for (Map.Entry<String, PooledConnection> entry : connections.entrySet()) {
            PooledConnection conn = entry.getValue();
            // Remove idle connections that have exceeded the idle timeout
            if (!conn.isInUse() && now - conn.getLastUsed().getTime() > config.getIdleTimeoutMs()) {
                // Keep minimum connections
                if (connections.size() > config.getMinConnections()) {
                    connectionsToRemove.add(entry.getKey());
                }
            }
        }

        for (String id : connectionsToRemove) {
            connections.remove(id);
            logger.debug("Removed idle connection: {}", id);
        }
    }

    /**
     * Get pool statistics
     */
    public Map<String, Object> getStats() {
        long active = connections.values().stream().filter(PooledConnection::isInUse).count();
        Map<String, Object> stats = new HashMap<>();
        stats.put("total", connections.size());
        stats.put("active", active);
        stats.put("idle", connections.size() - active);
        stats.put("minConnections", config.getMinConnections());
        stats.put("maxConnections", config.getMaxConnections());
        return stats;
    }

    /**
     * Close the pool and all connections
     */
    public void close() throws InterruptedException {
        if (!closed.compareAndSet(false, true)) {
            return; // Already closed
        }

        healthCheckExecutor.shutdown();
        if (!healthCheckExecutor.awaitTermination(5, TimeUnit.SECONDS)) {
            healthCheckExecutor.shutdownNow();
        }

        // Wait for active connections to be released (max 5 seconds)
        long maxWait = 5000;
        long startTime = System.currentTimeMillis();

        while (System.currentTimeMillis() - startTime < maxWait) {
            long activeCount = connections.values().stream().filter(PooledConnection::isInUse).count();
            if (activeCount == 0) {
                break;
            }
            Thread.sleep(100);
        }

        connections.clear();
        logger.info("Connection pool closed");
    }
}

package com.workersql.sdk.client;

/**
 * Configuration for WorkerSQL client
 */
public class WorkerSQLConfig {
    private final String host;
    private final int port;
    private final String username;
    private final String password;
    private final String database;
    private final String apiEndpoint;
    private final String apiKey;
    private final boolean ssl;
    private final int timeout;
    private final int retryAttempts;
    private final long retryDelay;
    private final boolean poolingEnabled;
    private final int minConnections;
    private final int maxConnections;
    private final long idleTimeout;

    private WorkerSQLConfig(Builder builder) {
        this.host = builder.host;
        this.port = builder.port;
        this.username = builder.username;
        this.password = builder.password;
        this.database = builder.database;
        this.apiEndpoint = builder.apiEndpoint;
        this.apiKey = builder.apiKey;
        this.ssl = builder.ssl;
        this.timeout = builder.timeout;
        this.retryAttempts = builder.retryAttempts;
        this.retryDelay = builder.retryDelay;
        this.poolingEnabled = builder.poolingEnabled;
        this.minConnections = builder.minConnections;
        this.maxConnections = builder.maxConnections;
        this.idleTimeout = builder.idleTimeout;
    }

    public String getHost() { return host; }
    public int getPort() { return port; }
    public String getUsername() { return username; }
    public String getPassword() { return password; }
    public String getDatabase() { return database; }
    public String getApiEndpoint() { return apiEndpoint; }
    public String getApiKey() { return apiKey; }
    public boolean isSsl() { return ssl; }
    public int getTimeout() { return timeout; }
    public int getRetryAttempts() { return retryAttempts; }
    public long getRetryDelay() { return retryDelay; }
    public boolean isPoolingEnabled() { return poolingEnabled; }
    public int getMinConnections() { return minConnections; }
    public int getMaxConnections() { return maxConnections; }
    public long getIdleTimeout() { return idleTimeout; }

    public static Builder builder() {
        return new Builder();
    }

    public static class Builder {
        private String host;
        private int port = 443;
        private String username;
        private String password;
        private String database;
        private String apiEndpoint;
        private String apiKey;
        private boolean ssl = true;
        private int timeout = 30000;
        private int retryAttempts = 3;
        private long retryDelay = 1000;
        private boolean poolingEnabled = true;
        private int minConnections = 1;
        private int maxConnections = 10;
        private long idleTimeout = 300000;

        public Builder host(String host) {
            this.host = host;
            return this;
        }

        public Builder port(int port) {
            this.port = port;
            return this;
        }

        public Builder username(String username) {
            this.username = username;
            return this;
        }

        public Builder password(String password) {
            this.password = password;
            return this;
        }

        public Builder database(String database) {
            this.database = database;
            return this;
        }

        public Builder apiEndpoint(String apiEndpoint) {
            this.apiEndpoint = apiEndpoint;
            return this;
        }

        public Builder apiKey(String apiKey) {
            this.apiKey = apiKey;
            return this;
        }

        public Builder ssl(boolean ssl) {
            this.ssl = ssl;
            return this;
        }

        public Builder timeout(int timeout) {
            this.timeout = timeout;
            return this;
        }

        public Builder retryAttempts(int retryAttempts) {
            this.retryAttempts = retryAttempts;
            return this;
        }

        public Builder retryDelay(long retryDelay) {
            this.retryDelay = retryDelay;
            return this;
        }

        public Builder poolingEnabled(boolean poolingEnabled) {
            this.poolingEnabled = poolingEnabled;
            return this;
        }

        public Builder minConnections(int minConnections) {
            this.minConnections = minConnections;
            return this;
        }

        public Builder maxConnections(int maxConnections) {
            this.maxConnections = maxConnections;
            return this;
        }

        public Builder idleTimeout(long idleTimeout) {
            this.idleTimeout = idleTimeout;
            return this;
        }

        public WorkerSQLConfig build() {
            if (apiEndpoint == null || apiEndpoint.isEmpty()) {
                // Construct from host if not provided
                String protocol = ssl ? "https" : "http";
                String portStr = (port == 443 || port == 80) ? "" : ":" + port;
                apiEndpoint = protocol + "://" + host + portStr + "/v1";
            }
            return new WorkerSQLConfig(this);
        }
    }
}

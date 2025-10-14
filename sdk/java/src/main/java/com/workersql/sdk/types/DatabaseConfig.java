package com.workersql.sdk.types;

/**
 * Database configuration for WorkerSQL connection
 */
public class DatabaseConfig {
    private final String host;
    private final int port;
    private final String username;
    private final String password;
    private final String database;
    private final boolean ssl;
    private final int timeout;

    private DatabaseConfig(Builder builder) {
        this.host = builder.host;
        this.port = builder.port;
        this.username = builder.username;
        this.password = builder.password;
        this.database = builder.database;
        this.ssl = builder.ssl;
        this.timeout = builder.timeout;
    }

    public String getHost() { return host; }
    public int getPort() { return port; }
    public String getUsername() { return username; }
    public String getPassword() { return password; }
    public String getDatabase() { return database; }
    public boolean isSsl() { return ssl; }
    public int getTimeout() { return timeout; }

    public static Builder builder() {
        return new Builder();
    }

    public static class Builder {
        private String host;
        private int port = 3306;
        private String username;
        private String password;
        private String database;
        private boolean ssl = true;
        private int timeout = 30000;

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

        public Builder ssl(boolean ssl) {
            this.ssl = ssl;
            return this;
        }

        public Builder timeout(int timeout) {
            this.timeout = timeout;
            return this;
        }

        public DatabaseConfig build() {
            if (host == null || host.isEmpty()) {
                throw new IllegalArgumentException("host is required");
            }
            if (username == null || username.isEmpty()) {
                throw new IllegalArgumentException("username is required");
            }
            if (password == null || password.isEmpty()) {
                throw new IllegalArgumentException("password is required");
            }
            if (database == null || database.isEmpty()) {
                throw new IllegalArgumentException("database is required");
            }
            if (port < 1 || port > 65535) {
                throw new IllegalArgumentException("port must be between 1 and 65535");
            }
            if (timeout < 1000) {
                throw new IllegalArgumentException("timeout must be at least 1000ms");
            }
            return new DatabaseConfig(this);
        }
    }
}

package com.workersql.sdk.types;

/**
 * Health status enumeration
 */
enum HealthStatus {
    HEALTHY("healthy"),
    DEGRADED("degraded"),
    UNHEALTHY("unhealthy");

    private final String value;

    HealthStatus(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    public static HealthStatus fromString(String value) {
        for (HealthStatus status : values()) {
            if (status.value.equalsIgnoreCase(value)) {
                return status;
            }
        }
        throw new IllegalArgumentException("Unknown health status: " + value);
    }
}

/**
 * Database health information
 */
class DatabaseHealth {
    private final boolean connected;
    private final Double responseTime;

    public DatabaseHealth(boolean connected, Double responseTime) {
        this.connected = connected;
        this.responseTime = responseTime;
    }

    public boolean isConnected() { return connected; }
    public Double getResponseTime() { return responseTime; }
}

/**
 * Cache health information
 */
class CacheHealth {
    private final boolean enabled;
    private final Double hitRate;

    public CacheHealth(boolean enabled, Double hitRate) {
        this.enabled = enabled;
        this.hitRate = hitRate;
    }

    public boolean isEnabled() { return enabled; }
    public Double getHitRate() { return hitRate; }
}

/**
 * Health check response from WorkerSQL
 */
public class HealthCheckResponse {
    private final HealthStatus status;
    private final DatabaseHealth database;
    private final CacheHealth cache;
    private final String timestamp;

    public HealthCheckResponse(HealthStatus status, DatabaseHealth database, CacheHealth cache, String timestamp) {
        this.status = status;
        this.database = database;
        this.cache = cache;
        this.timestamp = timestamp;
    }

    public HealthStatus getStatus() { return status; }
    public DatabaseHealth getDatabase() { return database; }
    public CacheHealth getCache() { return cache; }
    public String getTimestamp() { return timestamp; }
}

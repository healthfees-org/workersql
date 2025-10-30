package com.workersql.sdk.pool;

import okhttp3.OkHttpClient;
import java.util.Date;

/**
 * Pooled connection wrapper
 */
public class PooledConnection {
    private final String id;
    private final OkHttpClient client;
    private volatile boolean inUse;
    private final Date createdAt;
    private volatile Date lastUsed;
    private int useCount;

    public PooledConnection(String id, OkHttpClient client) {
        this.id = id;
        this.client = client;
        this.inUse = false;
        this.createdAt = new Date();
        this.lastUsed = new Date();
        this.useCount = 0;
    }

    public String getId() { return id; }
    public OkHttpClient getClient() { return client; }
    public boolean isInUse() { return inUse; }
    public Date getCreatedAt() { return createdAt; }
    public Date getLastUsed() { return lastUsed; }
    public int getUseCount() { return useCount; }

    public void markInUse() {
        this.inUse = true;
        this.lastUsed = new Date();
        this.useCount++;
    }

    public void release() {
        this.inUse = false;
        this.lastUsed = new Date();
    }
}

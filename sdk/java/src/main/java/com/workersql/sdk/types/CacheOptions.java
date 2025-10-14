package com.workersql.sdk.types;

/**
 * Cache options for queries
 */
public class CacheOptions {
    private final boolean enabled;
    private final int ttl;
    private final String key;

    private CacheOptions(Builder builder) {
        this.enabled = builder.enabled;
        this.ttl = builder.ttl;
        this.key = builder.key;
    }

    public boolean isEnabled() { return enabled; }
    public int getTtl() { return ttl; }
    public String getKey() { return key; }

    public static Builder builder() {
        return new Builder();
    }

    public static class Builder {
        private boolean enabled = true;
        private int ttl = 300;
        private String key;

        public Builder enabled(boolean enabled) {
            this.enabled = enabled;
            return this;
        }

        public Builder ttl(int ttl) {
            this.ttl = ttl;
            return this;
        }

        public Builder key(String key) {
            this.key = key;
            return this;
        }

        public CacheOptions build() {
            if (ttl < 1 || ttl > 86400) {
                throw new IllegalArgumentException("ttl must be between 1 and 86400");
            }
            return new CacheOptions(this);
        }
    }
}

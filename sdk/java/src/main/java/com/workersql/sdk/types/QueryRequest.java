package com.workersql.sdk.types;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Query request to WorkerSQL
 */
public class QueryRequest {
    private final String sql;
    private final List<Object> params;
    private final int timeout;
    private final CacheOptions cache;

    private QueryRequest(Builder builder) {
        this.sql = builder.sql;
        this.params = builder.params != null ? Collections.unmodifiableList(builder.params) : Collections.emptyList();
        this.timeout = builder.timeout;
        this.cache = builder.cache;
    }

    public String getSql() { return sql; }
    public List<Object> getParams() { return params; }
    public int getTimeout() { return timeout; }
    public CacheOptions getCache() { return cache; }

    public static Builder builder() {
        return new Builder();
    }

    public static class Builder {
        private String sql;
        private List<Object> params = new ArrayList<>();
        private int timeout = 30000;
        private CacheOptions cache;

        public Builder sql(String sql) {
            this.sql = sql;
            return this;
        }

        public Builder params(List<Object> params) {
            this.params = params != null ? new ArrayList<>(params) : new ArrayList<>();
            return this;
        }

        public Builder addParam(Object param) {
            if (this.params == null) {
                this.params = new ArrayList<>();
            }
            this.params.add(param);
            return this;
        }

        public Builder timeout(int timeout) {
            this.timeout = timeout;
            return this;
        }

        public Builder cache(CacheOptions cache) {
            this.cache = cache;
            return this;
        }

        public QueryRequest build() {
            if (sql == null || sql.trim().isEmpty()) {
                throw new IllegalArgumentException("sql is required and must be non-empty");
            }
            if (timeout < 1000 || timeout > 300000) {
                throw new IllegalArgumentException("timeout must be between 1000 and 300000ms");
            }
            return new QueryRequest(this);
        }
    }
}

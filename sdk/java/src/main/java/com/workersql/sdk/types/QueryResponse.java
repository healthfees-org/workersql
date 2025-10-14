package com.workersql.sdk.types;

import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * Query response from WorkerSQL
 */
public class QueryResponse {
    private final boolean success;
    private final List<Map<String, Object>> data;
    private final Integer rowCount;
    private final Double executionTime;
    private final Boolean cached;
    private final ErrorResponse error;

    private QueryResponse(Builder builder) {
        this.success = builder.success;
        this.data = builder.data != null ? Collections.unmodifiableList(builder.data) : Collections.emptyList();
        this.rowCount = builder.rowCount;
        this.executionTime = builder.executionTime;
        this.cached = builder.cached;
        this.error = builder.error;
    }

    public boolean isSuccess() { return success; }
    public List<Map<String, Object>> getData() { return data; }
    public Integer getRowCount() { return rowCount; }
    public Double getExecutionTime() { return executionTime; }
    public Boolean getCached() { return cached; }
    public ErrorResponse getError() { return error; }

    public static Builder builder() {
        return new Builder();
    }

    public static class Builder {
        private boolean success;
        private List<Map<String, Object>> data;
        private Integer rowCount;
        private Double executionTime;
        private Boolean cached;
        private ErrorResponse error;

        public Builder success(boolean success) {
            this.success = success;
            return this;
        }

        public Builder data(List<Map<String, Object>> data) {
            this.data = data;
            return this;
        }

        public Builder rowCount(Integer rowCount) {
            this.rowCount = rowCount;
            return this;
        }

        public Builder executionTime(Double executionTime) {
            this.executionTime = executionTime;
            return this;
        }

        public Builder cached(Boolean cached) {
            this.cached = cached;
            return this;
        }

        public Builder error(ErrorResponse error) {
            this.error = error;
            return this;
        }

        public QueryResponse build() {
            return new QueryResponse(this);
        }
    }
}

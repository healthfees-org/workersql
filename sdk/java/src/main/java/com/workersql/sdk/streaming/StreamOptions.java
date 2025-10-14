package com.workersql.sdk.streaming;

public class StreamOptions {
    private int highWaterMark = 16;
    private int batchSize = 100;
    private int timeout = 30000;

    public int getHighWaterMark() { return highWaterMark; }
    public void setHighWaterMark(int highWaterMark) { this.highWaterMark = highWaterMark; }
    public int getBatchSize() { return batchSize; }
    public void setBatchSize(int batchSize) { this.batchSize = batchSize; }
    public int getTimeout() { return timeout; }
    public void setTimeout(int timeout) { this.timeout = timeout; }

    public static Builder builder() {
        return new Builder();
    }

    public static class Builder {
        private final StreamOptions options = new StreamOptions();

        public Builder highWaterMark(int value) {
            options.highWaterMark = value;
            return this;
        }

        public Builder batchSize(int value) {
            options.batchSize = value;
            return this;
        }

        public Builder timeout(int value) {
            options.timeout = value;
            return this;
        }

        public StreamOptions build() {
            return options;
        }
    }
}

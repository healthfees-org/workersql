package com.workersql.sdk.streaming;

import com.workersql.sdk.common.QueryFunction;
import com.workersql.sdk.types.QueryResponse;

import java.util.*;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

public class QueryStream implements Iterator<Map<String, Object>>, AutoCloseable {
    private final String sql;
    private final List<Object> params;
    private final QueryFunction queryFn;
    private final StreamOptions options;
    private final BlockingQueue<Map<String, Object>> buffer;
    private final AtomicBoolean ended = new AtomicBoolean(false);
    private final AtomicBoolean closed = new AtomicBoolean(false);

    private int offset = 0;
    private Thread readerThread;
    private Exception error;

    public QueryStream(String sql, List<Object> params, QueryFunction queryFn, StreamOptions options) {
        this.sql = sql;
        this.params = params != null ? params : Collections.emptyList();
        this.queryFn = queryFn;
        this.options = options != null ? options : new StreamOptions();
        this.buffer = new LinkedBlockingQueue<>(this.options.getHighWaterMark());

        startReading();
    }

    public QueryStream(String sql, List<Object> params, QueryFunction queryFn) {
        this(sql, params, queryFn, null);
    }

    private void startReading() {
        readerThread = new Thread(() -> {
            try {
                while (!ended.get() && !closed.get()) {
                    String streamSql = addPagination(sql, options.getBatchSize(), offset);
                    QueryResponse result = queryFn.execute(streamSql, params);

                    List<Map<String, Object>> rows = result.getData();
                    if (rows == null || rows.isEmpty()) {
                        ended.set(true);
                        break;
                    }

                    for (Map<String, Object> row : rows) {
                        if (!buffer.offer(row, options.getTimeout(), TimeUnit.MILLISECONDS)) {
                            throw new Exception("Stream buffer timeout");
                        }
                    }

                    offset += rows.size();

                    if (rows.size() < options.getBatchSize()) {
                        ended.set(true);
                        break;
                    }
                }
            } catch (Exception e) {
                error = e;
                ended.set(true);
            }
        }, "QueryStream-Reader");

        readerThread.setDaemon(true);
        readerThread.start();
    }

    private String addPagination(String sql, int limit, int offset) {
        String trimmedSql = sql.trim();
        trimmedSql = trimmedSql.replaceAll("(?i)\\s+LIMIT\\s+\\d+(\\s+OFFSET\\s+\\d+)?$", "");
        return trimmedSql + " LIMIT " + limit + " OFFSET " + offset;
    }

    @Override
    public boolean hasNext() {
        if (error != null) {
            throw new RuntimeException("Stream error: " + error.getMessage(), error);
        }

        if (!buffer.isEmpty()) {
            return true;
        }

        if (ended.get()) {
            return false;
        }

        try {
            Thread.sleep(10);
            return !buffer.isEmpty() || !ended.get();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    @Override
    public Map<String, Object> next() {
        if (!hasNext()) {
            throw new NoSuchElementException("No more rows");
        }

        try {
            Map<String, Object> row = buffer.poll(options.getTimeout(), TimeUnit.MILLISECONDS);
            if (row == null) {
                throw new NoSuchElementException("Stream timeout");
            }
            return row;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException("Interrupted while reading stream", e);
        }
    }

    public void forEach(Consumer<Map<String, Object>> consumer) {
        while (hasNext()) {
            consumer.accept(next());
        }
    }

    public List<Map<String, Object>> collect() {
        List<Map<String, Object>> result = new ArrayList<>();
        forEach(result::add);
        return result;
    }

    @Override
    public void close() {
        closed.set(true);
        if (readerThread != null) {
            readerThread.interrupt();
        }
        buffer.clear();
    }

    public boolean isEnded() {
        return ended.get();
    }
}

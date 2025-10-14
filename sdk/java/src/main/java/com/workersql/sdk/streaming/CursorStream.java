package com.workersql.sdk.streaming;

import com.workersql.sdk.common.QueryFunction;
import com.workersql.sdk.types.QueryResponse;

import java.util.*;
import java.util.function.Consumer;

public class CursorStream implements AutoCloseable {
    private final String sql;
    private final List<Object> params;
    private final QueryFunction queryFn;
    private final StreamOptions options;
    private final List<Consumer<Map<String, Object>>> dataListeners = new ArrayList<>();
    private final List<Consumer<String>> openListeners = new ArrayList<>();
    private final List<Runnable> endListeners = new ArrayList<>();
    private final List<Consumer<Exception>> errorListeners = new ArrayList<>();

    private String cursorId;
    private boolean closed = false;

    public CursorStream(String sql, List<Object> params, QueryFunction queryFn, StreamOptions options) {
        this.sql = sql;
        this.params = params != null ? params : Collections.emptyList();
        this.queryFn = queryFn;
        this.options = options != null ? options : new StreamOptions();
    }

    public CursorStream(String sql, List<Object> params, QueryFunction queryFn) {
        this(sql, params, queryFn, null);
    }

    public CursorStream onData(Consumer<Map<String, Object>> listener) {
        dataListeners.add(listener);
        return this;
    }

    public CursorStream onOpen(Consumer<String> listener) {
        openListeners.add(listener);
        return this;
    }

    public CursorStream onEnd(Runnable listener) {
        endListeners.add(listener);
        return this;
    }

    public CursorStream onError(Consumer<Exception> listener) {
        errorListeners.add(listener);
        return this;
    }

    public void start() {
        new Thread(() -> {
            try {
                String declareSql = "DECLARE cursor_" + System.currentTimeMillis() + " CURSOR FOR " + sql;
                QueryResponse result = queryFn.execute(declareSql, params);

                cursorId = "cursor_" + System.currentTimeMillis();
                
                for (Consumer<String> listener : openListeners) {
                    listener.accept(cursorId);
                }

                fetchNext();
            } catch (Exception e) {
                for (Consumer<Exception> listener : errorListeners) {
                    listener.accept(e);
                }
            }
        }, "CursorStream").start();
    }

    private void fetchNext() throws Exception {
        if (closed || cursorId == null) {
            return;
        }

        String fetchSql = "FETCH " + options.getBatchSize() + " FROM " + cursorId;
        QueryResponse result = queryFn.execute(fetchSql, Collections.emptyList());

        List<Map<String, Object>> rows = result.getData();
        if (rows == null || rows.isEmpty()) {
            close();
            for (Runnable listener : endListeners) {
                listener.run();
            }
            return;
        }

        for (Map<String, Object> row : rows) {
            for (Consumer<Map<String, Object>> listener : dataListeners) {
                listener.accept(row);
            }
        }

        fetchNext();
    }

    @Override
    public void close() throws Exception {
        if (closed) {
            return;
        }

        closed = true;

        if (cursorId != null) {
            try {
                queryFn.execute("CLOSE " + cursorId, Collections.emptyList());
            } catch (Exception e) {
                // Ignore errors on close
            }
            cursorId = null;
        }
    }

    public boolean isClosed() {
        return closed;
    }
}

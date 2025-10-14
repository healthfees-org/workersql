package com.workersql.sdk.procedures;

import com.workersql.sdk.common.QueryFunction;
import com.workersql.sdk.types.QueryResponse;

import java.util.*;

public class MultiStatementExecutor {
    private final QueryFunction queryFn;

    public MultiStatementExecutor(QueryFunction queryFn) {
        this.queryFn = queryFn;
    }

    public List<QueryResponse> execute(List<String> statements) throws Exception {
        List<QueryResponse> results = new ArrayList<>();

        for (String statement : statements) {
            QueryResponse result = queryFn.execute(statement, Collections.emptyList());
            results.add(result);
        }

        return results;
    }

    public List<QueryResponse> executeScript(String script) throws Exception {
        String[] statements = script.split(";");
        List<String> cleanStatements = new ArrayList<>();

        for (String stmt : statements) {
            String trimmed = stmt.trim();
            if (!trimmed.isEmpty()) {
                cleanStatements.add(trimmed);
            }
        }

        return execute(cleanStatements);
    }
}

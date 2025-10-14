package com.workersql.sdk.common;

import com.workersql.sdk.types.QueryResponse;

import java.util.List;

/**
 * Functional interface for executing queries
 * Used by metadata, stored procedures, and streaming features
 */
@FunctionalInterface
public interface QueryFunction {
    QueryResponse execute(String sql, List<Object> params) throws Exception;
}

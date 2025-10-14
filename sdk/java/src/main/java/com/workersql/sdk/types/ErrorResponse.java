package com.workersql.sdk.types;

import java.time.Instant;
import java.util.Collections;
import java.util.Map;

/**
 * Error response from WorkerSQL API
 */
public class ErrorResponse {
    private final ErrorCode code;
    private final String message;
    private final Map<String, Object> details;
    private final Instant timestamp;

    public ErrorResponse(ErrorCode code, String message, Map<String, Object> details, Instant timestamp) {
        this.code = code;
        this.message = message;
        this.details = details != null ? Collections.unmodifiableMap(details) : Collections.emptyMap();
        this.timestamp = timestamp;
    }

    public ErrorCode getCode() { return code; }
    public String getMessage() { return message; }
    public Map<String, Object> getDetails() { return details; }
    public Instant getTimestamp() { return timestamp; }
}

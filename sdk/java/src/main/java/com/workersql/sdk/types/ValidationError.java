package com.workersql.sdk.types;

import java.util.Collections;
import java.util.Map;

/**
 * Custom exception for validation and API errors
 */
public class ValidationError extends RuntimeException {
    private final ErrorCode code;
    private final Map<String, Object> details;

    public ValidationError(ErrorCode code, String message) {
        this(code, message, Collections.emptyMap());
    }

    public ValidationError(ErrorCode code, String message, Map<String, Object> details) {
        super(message);
        this.code = code;
        this.details = details != null ? Collections.unmodifiableMap(details) : Collections.emptyMap();
    }

    public ErrorCode getCode() {
        return code;
    }

    public Map<String, Object> getDetails() {
        return details;
    }
}

/**
 * Schema Validation Utilities
 * Common validation logic for all SDK implementations
 */
export class ValidationError extends Error {
    code;
    details;
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'ValidationError';
        this.code = code;
        this.details = details;
    }
}
export class SchemaValidator {
    static validateDatabaseConfig(config) {
        const errors = [];
        if (!config.host || typeof config.host !== 'string') {
            errors.push('host is required and must be a string');
        }
        if (!config.username || typeof config.username !== 'string') {
            errors.push('username is required and must be a string');
        }
        if (!config.password || typeof config.password !== 'string') {
            errors.push('password is required and must be a string');
        }
        if (!config.database || typeof config.database !== 'string') {
            errors.push('database is required and must be a string');
        }
        if (config.port !== undefined) {
            if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
                errors.push('port must be an integer between 1 and 65535');
            }
        }
        if (config.timeout !== undefined) {
            if (!Number.isInteger(config.timeout) || config.timeout < 1000) {
                errors.push('timeout must be an integer >= 1000');
            }
        }
        if (errors.length > 0) {
            throw new ValidationError('INVALID_QUERY', `Invalid database config: ${errors.join(', ')}`, { errors });
        }
        return {
            host: config.host,
            port: config.port || 3306,
            username: config.username,
            password: config.password,
            database: config.database,
            ssl: config.ssl !== false, // Default to true
            timeout: config.timeout || 30000
        };
    }
    static validateQueryRequest(request) {
        const errors = [];
        if (!request.sql || typeof request.sql !== 'string' || request.sql.trim().length === 0) {
            errors.push('sql is required and must be a non-empty string');
        }
        if (request.params !== undefined) {
            if (!Array.isArray(request.params)) {
                errors.push('params must be an array');
            }
            else {
                request.params.forEach((param, index) => {
                    const type = typeof param;
                    if (param !== null && type !== 'string' && type !== 'number' && type !== 'boolean') {
                        errors.push(`params[${index}] must be string, number, boolean, or null`);
                    }
                });
            }
        }
        if (request.timeout !== undefined) {
            if (!Number.isInteger(request.timeout) || request.timeout < 1000 || request.timeout > 300000) {
                errors.push('timeout must be an integer between 1000 and 300000');
            }
        }
        if (request.cache !== undefined) {
            this.validateCacheOptions(request.cache);
        }
        if (errors.length > 0) {
            throw new ValidationError('INVALID_QUERY', `Invalid query request: ${errors.join(', ')}`, { errors });
        }
        return {
            sql: request.sql.trim(),
            params: request.params || [],
            timeout: request.timeout || 30000,
            cache: request.cache
        };
    }
    static validateCacheOptions(cache) {
        const errors = [];
        if (cache.ttl !== undefined) {
            if (!Number.isInteger(cache.ttl) || cache.ttl < 1 || cache.ttl > 86400) {
                errors.push('cache.ttl must be an integer between 1 and 86400');
            }
        }
        if (cache.key !== undefined && typeof cache.key !== 'string') {
            errors.push('cache.key must be a string');
        }
        if (errors.length > 0) {
            throw new ValidationError('INVALID_QUERY', `Invalid cache options: ${errors.join(', ')}`, { errors });
        }
        return {
            enabled: cache.enabled !== false,
            ttl: cache.ttl || 300,
            key: cache.key
        };
    }
    static validateBatchQueryRequest(request) {
        const errors = [];
        if (!request.queries || !Array.isArray(request.queries)) {
            errors.push('queries is required and must be an array');
        }
        else {
            if (request.queries.length === 0) {
                errors.push('queries array cannot be empty');
            }
            if (request.queries.length > 100) {
                errors.push('queries array cannot contain more than 100 items');
            }
            request.queries.forEach((query, index) => {
                try {
                    this.validateQueryRequest(query);
                }
                catch (error) {
                    if (error instanceof ValidationError) {
                        errors.push(`queries[${index}]: ${error.message}`);
                    }
                }
            });
        }
        if (errors.length > 0) {
            throw new ValidationError('INVALID_QUERY', `Invalid batch query request: ${errors.join(', ')}`, { errors });
        }
        return {
            queries: request.queries.map(q => this.validateQueryRequest(q)),
            transaction: request.transaction || false,
            stopOnError: request.stopOnError !== false
        };
    }
    static sanitizeSQL(sql) {
        // Basic SQL injection prevention
        const dangerous = [
            /;\s*(drop|delete|truncate|alter|create|insert|update)\s+/gi,
            /union\s+select/gi,
            /exec\s*\(/gi,
            /execute\s*\(/gi
        ];
        for (const pattern of dangerous) {
            if (pattern.test(sql)) {
                throw new ValidationError('INVALID_QUERY', 'SQL contains potentially dangerous statements', { sql });
            }
        }
        return sql.trim();
    }
}
//# sourceMappingURL=validator.js.map
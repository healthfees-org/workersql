# Environment Variables Configuration for Edge MySQL Gateway

This document outlines all environment variables used by the Edge SQL gateway
and how to configure them for different environments.

## Core Environment Variables

### Required Variables

| Variable            | Description                                   | Default       | Example                                |
| ------------------- | --------------------------------------------- | ------------- | -------------------------------------- |
| `ENVIRONMENT`       | Deployment environment                        | `development` | `development`, `staging`, `production` |
| `LOG_LEVEL`         | Logging verbosity level                       | `info`        | `debug`, `info`, `warn`, `error`       |
| `MAX_SHARD_SIZE_GB` | Maximum size per shard in GB                  | `10`          | `1` (dev), `50` (prod)                 |
| `CACHE_TTL_MS`      | Cache Time-To-Live in milliseconds            | `30000`       | `5000` (dev), `300000` (prod)          |
| `CACHE_SWR_MS`      | Stale-While-Revalidate period in milliseconds | `120000`      | `10000` (dev), `1800000` (prod)        |

### Optional Variables

| Variable            | Description                  | Default  | Example         |
| ------------------- | ---------------------------- | -------- | --------------- |
| `DEFAULT_CACHE_TTL` | Fallback cache TTL           | `30000`  | `60000`         |
| `DEFAULT_CACHE_SWR` | Fallback cache SWR           | `120000` | `300000`        |
| `SHARD_COUNT`       | Number of shards for routing | `4`      | `8`, `16`, `32` |

## Environment-Specific Configurations

### Development Environment

```toml
[env.development.vars]
ENVIRONMENT = "development"
LOG_LEVEL = "debug"
MAX_SHARD_SIZE_GB = "1"
CACHE_TTL_MS = "5000"
CACHE_SWR_MS = "10000"
SHARD_COUNT = "4"
```

**Purpose**: Fast iteration, verbose logging, small limits

- Short cache times for immediate feedback
- Debug logging for troubleshooting
- Small shard sizes to test capacity limits

### Staging Environment

```toml
[env.staging.vars]
ENVIRONMENT = "staging"
LOG_LEVEL = "info"
MAX_SHARD_SIZE_GB = "5"
CACHE_TTL_MS = "30000"
CACHE_SWR_MS = "120000"
SHARD_COUNT = "8"
```

**Purpose**: Production-like testing with moderate limits

- Moderate cache times for realistic testing
- Info-level logging for performance testing
- Medium shard sizes for load testing

### Production Environment

```toml
[env.production.vars]
ENVIRONMENT = "production"
LOG_LEVEL = "warn"
MAX_SHARD_SIZE_GB = "50"
CACHE_TTL_MS = "300000"
CACHE_SWR_MS = "1800000"
SHARD_COUNT = "16"
```

**Purpose**: Optimized for performance and cost

- Long cache times for performance
- Warn-level logging to reduce noise
- Large shard sizes for efficiency

## Secrets Management

Secrets should be set using `wrangler secret put` and never stored in
configuration files:

### Required Secrets

```bash
# JWT signing key for authentication
wrangler secret put JWT_SECRET

# Database encryption key (if using encryption at rest)
wrangler secret put DATABASE_ENCRYPTION_KEY

# Admin API key for management operations
wrangler secret put ADMIN_API_KEY
```

### Optional Secrets

```bash
# External monitoring API keys
wrangler secret put DATADOG_API_KEY
wrangler secret put SENTRY_DSN

# Third-party integrations
wrangler secret put EXTERNAL_API_KEY
```

## Cloudflare Bindings

These are configured in `wrangler.toml` and available as environment bindings:

### KV Namespace

- `APP_CACHE`: KVNamespace for caching query results and metadata

### Queue

- `DB_EVENTS`: Queue for asynchronous event processing (cache invalidation,
  etc.)

### Durable Objects

- `SHARD`: DurableObjectNamespace for TableShard instances

### D1 Database

- `PORTABLE_DB`: D1Database for optional portable data mirror

## Local Development Setup

### 1. Copy Environment Template

```bash
cp wrangler.toml.template wrangler.toml
```

### 2. Create KV Namespace

```bash
# Create main namespace
wrangler kv:namespace create "APP_CACHE"

# Create preview namespace for development
wrangler kv:namespace create "APP_CACHE" --preview
```

Update the IDs in `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "APP_CACHE"
id = "your-kv-namespace-id"
preview_id = "your-preview-namespace-id"
```

### 3. Create Queue

```bash
# Create main queue
wrangler queues create db-events

# Create dead letter queue
wrangler queues create db-events-dlq
```

### 4. Create D1 Database (Optional)

```bash
wrangler d1 create portable-mirror
```

Update the database ID in `wrangler.toml`:

```toml
[[d1_databases]]
binding = "PORTABLE_DB"
database_name = "portable-mirror"
database_id = "your-d1-database-id"
```

### 5. Set Development Secrets

```bash
# Set a simple JWT secret for development
echo "dev-jwt-secret-key-$(date +%s)" | wrangler secret put JWT_SECRET

# Set other required secrets
wrangler secret put DATABASE_ENCRYPTION_KEY
wrangler secret put ADMIN_API_KEY
```

## Environment Variable Validation

The application validates environment variables on startup. Missing required
variables will cause the worker to fail deployment.

### Validation Rules

- `ENVIRONMENT`: Must be one of `development`, `staging`, `production`
- `LOG_LEVEL`: Must be one of `debug`, `info`, `warn`, `error`
- `MAX_SHARD_SIZE_GB`: Must be a positive integer
- `CACHE_TTL_MS`: Must be a positive integer
- `CACHE_SWR_MS`: Must be greater than `CACHE_TTL_MS`
- `SHARD_COUNT`: Must be a power of 2 (for consistent hashing)

### Error Handling

Invalid environment variables will:

1. Log detailed error messages
2. Prevent worker deployment
3. Provide suggestions for fixes

## Monitoring and Observability

### Recommended Environment Variables for Production

```toml
[env.production.vars]
# ... other vars ...
ENABLE_METRICS = "true"
METRICS_SAMPLE_RATE = "0.1"
TRACE_SAMPLE_RATE = "0.01"
```

### Performance Tuning Variables

```toml
# Cache optimization
CACHE_COMPRESSION = "true"
CACHE_MAX_SIZE_KB = "1024"

# Connection pooling
MAX_CONCURRENT_REQUESTS = "100"
REQUEST_TIMEOUT_MS = "30000"

# Shard management
SHARD_REBALANCE_THRESHOLD = "0.8"
SHARD_HEALTH_CHECK_INTERVAL_MS = "60000"
```

## Troubleshooting

### Common Issues

1. **Cache not working**: Check `CACHE_TTL_MS` and `CACHE_SWR_MS` values
2. **High latency**: Increase cache TTL or reduce shard count
3. **Memory errors**: Reduce `MAX_SHARD_SIZE_GB`
4. **Authentication failures**: Verify `JWT_SECRET` is set

### Debug Mode

Enable debug mode for troubleshooting:

```toml
[env.development.vars]
LOG_LEVEL = "debug"
DEBUG_CACHE = "true"
DEBUG_ROUTING = "true"
DEBUG_AUTHENTICATION = "true"
```

This will provide detailed logs for all operations.

---
applyTo: 'src/services/MonitoringService.ts'
---

# Monitoring Service Implementation

## Overview

The MonitoringService provides comprehensive observability and monitoring capabilities for the WorkerSQL system, focusing on performance metrics, SLA tracking, and operational health monitoring.

## Architecture

### Core Components

1. **Metrics Collection Layer**
   - Cloudflare Analytics GraphQL API integration
   - Durable Objects invocation metrics
   - KV operations and cache performance
   - Queue backlog and consumer metrics

2. **SLA Management**
   - Configurable SLA thresholds
   - Real-time violation detection
   - Automated alerting system

3. **Data Processing Pipeline**
   - Raw metrics aggregation
   - Statistical analysis (P50/P90/P95 percentiles)
   - Time-series data processing

## Key Features

### Shard Monitoring
- **Metrics Collected**: CPU time, request duration, response size, storage usage
- **Aggregation**: Per-shard performance statistics with percentile calculations
- **Filtering**: Support for specific shard ID filtering

### Cache Performance Monitoring
- **Hit Rate Calculation**: Read/write/delete operation success rates
- **Latency Tracking**: Average and percentile response times
- **Operation Types**: Comprehensive coverage of KV operations

### Queue Health Monitoring
- **Backlog Metrics**: Message and byte backlog tracking
- **Consumer Performance**: Processing concurrency and throughput
- **Capacity Planning**: Maximum backlog thresholds

### SLA Compliance
- **Threshold Management**: Configurable performance targets
- **Violation Detection**: Real-time SLA breach identification
- **Severity Levels**: Warning and critical alert classification

## Implementation Details

### GraphQL Integration

The service integrates with Cloudflare's Analytics GraphQL API using authenticated requests:

```typescript
const response = await this.queryGraphQL(query, variables);
```

**Authentication**: Uses Cloudflare API tokens with Account Analytics read permissions.

### Metrics Processing

Raw GraphQL responses are processed into structured metrics:

```typescript
private processShardMetrics(data: any, shardIds: string[]): ShardMetrics[]
private processCacheMetrics(data: any): CacheMetrics
private processQueueMetrics(data: any, queueIds: string[]): QueueMetrics[]
```

### SLA Evaluation

SLA checking evaluates system metrics against predefined thresholds:

```typescript
async checkSLAs(metrics: SystemMetrics): Promise<SLAStatus>
```

**Threshold Categories**:
- Shard performance (latency, CPU usage)
- Cache efficiency (hit rates, operation success)
- Queue health (backlog levels, processing rates)

### Alerting System

Automated alerts are sent when SLA violations are detected:

```typescript
async sendAlerts(slaStatus: SLAStatus): Promise<void>
```

**Alert Channels**: Configurable webhook endpoints for external monitoring systems.

## Configuration

### Environment Variables

```typescript
CLOUDFLARE_ACCOUNT_ID: string    // Cloudflare account identifier
CLOUDFLARE_API_TOKEN: string     // API token with analytics permissions
```

### SLA Thresholds

Thresholds are configured within the service implementation:

```typescript
private readonly SLA_THRESHOLDS = {
  shardLatencyMs: 100,
  cacheHitRate: 0.95,
  queueBacklogMax: 1000,
  // ... additional thresholds
};
```

## Usage Patterns

### Basic Metrics Collection

```typescript
const monitoring = new MonitoringService(env);

// Collect cache metrics for the last hour
const cacheMetrics = await monitoring.collectCacheMetrics({
  since: '2025-01-01T00:00:00Z',
  until: '2025-01-01T01:00:00Z'
});

// Collect shard metrics for specific shards
const shardMetrics = await monitoring.collectShardMetrics(
  ['shard-1', 'shard-2'],
  { since: '2025-01-01T00:00:00Z', until: '2025-01-01T01:00:00Z' }
);
```

### SLA Monitoring

```typescript
// Get comprehensive system metrics
const systemMetrics = await monitoring.getSystemMetrics(timeRange);

// Check SLA compliance
const slaStatus = await monitoring.checkSLAs(systemMetrics);

// Send alerts if violations detected
if (slaStatus.violations.length > 0) {
  await monitoring.sendAlerts(slaStatus);
}
```

## Error Handling

### API Failures
- Network timeouts and connection errors
- Invalid API credentials
- Rate limiting and quota exceeded

### Data Processing
- Malformed GraphQL responses
- Missing or invalid metric data
- Type conversion errors

### SLA Violations
- Threshold calculation errors
- Alert delivery failures

## Performance Considerations

### Caching Strategy
- Metrics are cached in APP_CACHE with TTL-based expiration
- Reduces API call frequency for frequently requested time ranges

### Batch Processing
- GraphQL queries use pagination for large datasets
- Metrics aggregation performed in-memory for efficiency

### Rate Limiting
- Respects Cloudflare API rate limits
- Implements exponential backoff for retries

## Testing Strategy

### Unit Tests
- Mock GraphQL API responses
- Test individual metric processing functions
- Validate SLA threshold calculations

### Integration Tests
- Real Cloudflare Workers runtime testing
- End-to-end GraphQL API integration
- Environment-specific configuration validation

### Fuzz Tests
- Malformed input data handling
- Invalid time ranges and parameters
- API response edge cases

### Browser Tests
- Playwright-based UI interaction testing
- Browser compatibility validation
- Client-side error handling

## Security Considerations

### API Token Management
- Tokens stored securely in Workers Secrets
- Never logged or exposed in error messages
- Minimal required permissions (Analytics Read only)

### Data Sanitization
- Input validation for all user-provided parameters
- SQL injection prevention in GraphQL queries
- XSS protection in alert messages

## Future Enhancements

### Planned Features
- Custom dashboard integration
- Advanced alerting rules engine
- Historical trend analysis
- Predictive performance modeling

### API Extensions
- Additional Cloudflare product metrics
- Custom metric definitions
- Third-party monitoring system integrations

## Dependencies

- **Cloudflare Analytics API**: GraphQL-based metrics collection
- **Workers Runtime**: Environment-specific execution context
- **KV Storage**: Metrics caching and configuration storage

## Maintenance Notes

### Monitoring Health
- Regular validation of API token permissions
- Monitoring of API call success rates
- Alert threshold tuning based on historical data

### Code Quality
- Comprehensive test coverage (100% target)
- TypeScript strict mode compliance
- ESLint and Prettier code formatting

### Documentation Updates
- API changes require documentation updates
- SLA threshold changes need stakeholder communication
- New metrics require usage examples and validation

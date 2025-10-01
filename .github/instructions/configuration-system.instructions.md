# Configuration System Implementation

## Overview
The configuration system provides dynamic loading, validation, and updating of table policies and routing configurations for the Edge SQL system. It supports YAML-based configuration stored in Cloudflare KV, with environment-based overrides and runtime updates.

## Components

### 1. Table Policy YAML Parser (`TablePolicyParser`)
- **Location**: `src/services/TablePolicyParser.ts`
- **Purpose**: Parses YAML configuration files for table policies and routing policies
- **Features**:
  - YAML parsing with JSON fallback
  - Environment variable substitution
  - Policy validation
  - Default policy generation

### 2. Configuration Service (`ConfigService`)
- **Location**: `src/services/ConfigService.ts`
- **Purpose**: Manages loading, caching, and updating of configuration
- **Features**:
  - KV-based configuration storage
  - In-memory caching with TTL
  - Dynamic configuration updates
  - Comprehensive validation

### 3. Configuration Files
- **Location**: `config/`
- **Files**:
  - `routing-policy.yaml`: Shard routing configuration
  - `table-policies/*.yaml`: Per-table policy configurations

## Configuration Storage

### KV Keys
- `config:table-policies:{tableName}`: YAML content for table policies
- `config:routing-policy`: YAML content for routing policy

### Environment Variables
- `DEFAULT_CACHE_TTL`: Default cache TTL in milliseconds
- `DEFAULT_CACHE_SWR`: Default cache SWR in milliseconds
- `SHARD_COUNT`: Number of shards

## API

### ConfigService Methods

#### Loading Configuration
```typescript
// Get all table policies
const policies = await configService.getTablePolicies();

// Get specific table policy
const policy = await configService.getTablePolicy('users');

// Get routing policy
const routing = await configService.getRoutingPolicy();
```

#### Dynamic Updates
```typescript
// Update table policy
await configService.updateTablePolicy('users', yamlContent);

// Update routing policy
await configService.updateRoutingPolicy(yamlContent);
```

#### Validation
```typescript
// Validate configuration
const result = await configService.validateConfig();
// { valid: boolean, errors: string[] }
```

#### Cache Management
```typescript
// Clear configuration cache
configService.clearCache();
```

## Configuration Schema

### Table Policy YAML
```yaml
primary_key: id
shard_by: tenant_id
cache:
  mode: bounded  # strong | bounded | cached
  ttl_ms: 30000
  swr_ms: 120000
  always_strong_columns:
    - email
    - user_id
```

### Routing Policy YAML
```yaml
version: 1
tenants:
  tenant_acme: shard_0
  tenant_globex: shard_1
ranges:
  - prefix: '00..7f'
    shard: shard-range-0
  - prefix: '80..ff'
    shard: shard-range-1
```

## Validation Rules

### Table Policy Validation
- Primary key must be defined
- Cache mode must be 'strong', 'bounded', or 'cached'
- TTL and SWR must be non-negative numbers
- For bounded mode: SWR > TTL

### Routing Policy Validation
- Version must be positive integer
- At least one range must be defined
- Range prefixes and shards must be defined

## Testing

### Unit Tests
- `tests/services/ConfigService.test.ts`: ConfigService functionality
- `tests/services/TablePolicyParser.test.ts`: YAML parsing and validation

### Coverage Requirements
- 100% function coverage
- All configuration paths tested
- Error conditions covered
- Cache behavior tested

## Deployment

### Initial Setup
1. Upload YAML configurations to KV:
   ```bash
   # Upload table policies
   wrangler kv:key put "config:table-policies:users" --path config/table-policies/users.yaml
   wrangler kv:key put "config:table-policies:orders" --path config/table-policies/orders.yaml

   # Upload routing policy
   wrangler kv:key put "config:routing-policy" --path config/routing-policy.yaml
   ```

2. Set environment variables in wrangler.toml

### Runtime Updates
- Use `ConfigService.updateTablePolicy()` and `ConfigService.updateRoutingPolicy()` for runtime updates
- Cache is automatically cleared on updates
- Validation prevents invalid configurations

## Monitoring

### Logs
- Configuration load events
- Cache hits/misses
- Validation errors
- Update operations

### Metrics
- Configuration load time
- Cache hit rate
- Validation failure rate

## Security Considerations

- Configuration updates require authentication (via AuthContext)
- YAML parsing is sandboxed
- No sensitive data in configuration files
- Environment variables for secrets

## Performance

- Configuration cached in memory for 5 minutes
- KV operations are async and cached
- Validation runs on load and update
- Minimal parsing overhead with caching

## Troubleshooting

### Common Issues

1. **Configuration not loading**
   - Check KV keys exist
   - Verify YAML syntax
   - Check worker logs for parsing errors

2. **Invalid configuration**
   - Run `validateConfig()` to get error details
   - Check schema compliance
   - Verify environment variables

3. **Cache not updating**
   - Call `clearCache()` after manual KV updates
   - Check cache TTL settings

### Debug Commands
```typescript
// Force reload configuration
await configService.clearCache();
await configService.getTablePolicies();

// Validate current config
const validation = await configService.validateConfig();
console.log(validation);
```

## Future Enhancements

- Configuration versioning and rollback
- Configuration diff and preview
- Hot-reload without restart
- Configuration templates
- Multi-environment configurations

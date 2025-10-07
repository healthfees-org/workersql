# n8n Workflow Automation Sharding Configuration

## Overview

This directory contains WorkerSQL sharding configuration for a self-hosted n8n workflow automation platform with 500 active workflows and 100,000+ workflow execution results. The configuration is optimized for high-frequency workflow executions with extensive execution history.

## n8n Database Schema

n8n uses the following key tables:
- **workflows** - Workflow definitions (~500 workflows)
- **executions** - Workflow execution records (~100,000 executions)
- **execution_data** - Execution input/output data (~100,000 rows, large JSON blobs)
- **credentials** - Encrypted API credentials (~200 credentials)
- **tags** - Workflow organization tags (~50 tags)
- **workflow_tags** - Workflow-to-tag relationships (~1,000 relationships)
- **webhook_entity** - Webhook configurations (~300 webhooks)
- **settings** - Instance configuration (~100 settings)
- **users** - n8n users (~20 users)
- **shared_workflow** - Workflow sharing permissions (~500 shares)
- **shared_credentials** - Credential sharing permissions (~200 shares)

## Sharding Strategy

### Execution-Optimized Sharding

n8n's primary challenge is managing massive execution history while maintaining fast workflow triggers and execution:
1. **Workflows**: Small dataset, frequently accessed during execution
2. **Executions**: Large dataset, write-heavy, time-series pattern
3. **Execution Data**: Very large JSON blobs, rarely accessed after completion
4. **Credentials**: Security-critical, small dataset

### Table-Specific Policies

#### Workflow Table (workflows)
- **Shard by**: `tenant_id` (multi-instance isolation)
- **Cache mode**: `cached` (10-minute TTL, 1-hour SWR)
- **Rationale**: Workflow definitions change rarely, aggressive caching improves execution start time
- **Strong consistency columns**: None (eventual consistency acceptable)
- **Co-location**: Keep workflows with their executions for join performance

#### Execution Table (executions)
- **Shard by**: `workflow_id` (co-locate executions with workflow)
- **Cache mode**: `bounded` (1-minute TTL, 10-minute SWR)
- **Rationale**: Recent executions queried frequently for monitoring, but staleness acceptable
- **Strong consistency columns**: None (eventual consistency acceptable for history)
- **Partitioning strategy**: Consider time-based partitioning for old executions

#### Execution Data Table (execution_data)
- **Shard by**: `workflow_id` (co-locate with executions)
- **Cache mode**: `cached` (30-minute TTL, 4-hour SWR)
- **Rationale**: Execution data rarely accessed after completion, aggressive caching reduces storage I/O
- **Data retention**: Archive/delete executions older than 90 days
- **Compression**: Consider JSON compression for large payloads

#### Credentials Table (credentials)
- **Shard by**: `tenant_id` (security isolation)
- **Cache mode**: `strong` (no caching)
- **Rationale**: Credentials must always be fresh, security-critical
- **Strong consistency columns**: All columns (security-sensitive)
- **Encryption**: Encrypted at rest, decrypted only during execution

#### Tag Tables (tags, workflow_tags)
- **Shard by**: `tenant_id` (lightweight data)
- **Cache mode**: `cached` (15-minute TTL, 2-hour SWR)
- **Rationale**: Tags rarely change, UI frequently queries for filtering

#### Webhook Table (webhook_entity)
- **Shard by**: `webhook_id` hash-based for load distribution
- **Cache mode**: `bounded` (5-minute TTL, 30-minute SWR)
- **Rationale**: Webhooks queried on each trigger, moderate caching balances load
- **Strong consistency columns**: `webhook_path` (prevent duplicate webhook URLs)

#### User and Permission Tables (users, shared_workflow, shared_credentials)
- **Shard by**: `tenant_id` (security isolation)
- **Cache mode**: `bounded` (5-minute TTL, 30-minute SWR)
- **Rationale**: Permissions checked frequently, bounded caching ensures reasonable freshness

#### Settings Table (settings)
- **Shard by**: `tenant_id` (instance isolation)
- **Cache mode**: `strong` (no caching)
- **Rationale**: Instance settings critical, must always be current

### Routing Configuration

The routing policy optimizes for workflow execution patterns:

#### Workflow and Execution Shards (Time-Based Partitioning)
- **shard_0**: Active workflows (modified in last 30 days) + recent executions (last 7 days)
- **shard_1**: Semi-active workflows (modified 30-90 days ago) + executions (8-30 days old)
- **shard_2**: Archive workflows (modified >90 days ago) + old executions (31-90 days old)
- **shard_3**: Long-term archive (executions >90 days old, eligible for deletion)

#### Webhook and Trigger Shards
- **shard_4-5**: Hash-distributed webhooks for load balancing across high-frequency triggers

#### Metadata Shards
- **shard_6**: Credentials, users, permissions (security-critical, low-volume)
- **shard_7**: Tags, settings, shared entities (metadata and configuration)

### Shard Sizing Considerations

Each shard has a 10GB capacity limit. Estimated storage:
- **Workflow**: ~10KB per workflow definition
- **Execution record**: ~500 bytes metadata
- **Execution data**: ~50KB average (highly variable, some multi-MB)

Capacity planning:
- Active workflow shard (shard_0):
  - 200 active workflows × 10KB = 2MB
  - 10,000 recent executions × 500B = 5MB
  - 10,000 execution data × 50KB = 500MB
  - Total: ~507MB (5% capacity)

- Archive shard (shard_3):
  - 60,000 old executions × 500B = 30MB
  - 60,000 execution data × 50KB = 3GB
  - Total: ~3GB (30% capacity)

Growth headroom allows for:
- 200,000+ total executions before archive shard fills
- 500+ active workflows without splitting
- Automatic time-based migration keeps active shards performant

### Cache Key Patterns

WorkerSQL generates cache keys optimized for workflow execution:

#### Entity Cache
```
t:workflows:id:123                   # Workflow definition by ID
t:executions:id:456                  # Execution record by ID
t:execution_data:id:789              # Execution data by ID
```

#### Query Result Cache (Critical Paths)
```
tenant_n8n:q:workflows:active        # All active workflows (startup)
tenant_n8n:q:executions:workflow_123:recent  # Recent executions for workflow
tenant_n8n:q:webhook_entity:path_/hook/abc   # Webhook lookup by path
```

#### Index Cache
```
idx:executions:workflow_id:123       # All executions for workflow (dashboard)
idx:executions:status:running        # Currently running executions
idx:webhook_entity:workflow_id:123   # Webhooks for workflow
```

### Performance Characteristics

Expected performance with this configuration:
- **Workflow trigger**: <50ms (cached workflow definition)
- **Execution start**: <100ms (write execution record)
- **Execution history query**: <200ms (bounded cache)
- **Webhook lookup**: <100ms (bounded cache)
- **Concurrent executions**: 1,000+ per instance
- **Execution throughput**: 10,000+ executions/hour

### Consistency Guarantees

#### Strong Consistency (No Caching)
- Credentials (security-critical)
- Instance settings
- Workflow activation state (prevent double-execution)

#### Bounded Consistency (Near Real-Time)
- Execution status (for dashboard)
- Webhook configurations
- User permissions

#### Eventual Consistency (Background Sync)
- Workflow definitions (changes deployed explicitly)
- Execution history (logs and debugging)
- Tags and organization

### Workflow Execution Flow

#### Trigger Execution (High Performance)
```sql
-- 1. Webhook lookup (bounded cache, 5-min freshness)
SELECT * FROM webhook_entity WHERE webhook_path = '/hook/abc123';
-- Cache hit: <10ms, Cache miss: <100ms

-- 2. Workflow definition lookup (cached, 10-min freshness)
SELECT * FROM workflows WHERE id = ?;
-- Cache hit: <10ms, Cache miss: <100ms

-- 3. Create execution record (no cache, write to shard)
INSERT INTO executions (workflow_id, status, started_at) VALUES (?, 'running', NOW());
-- Write: <50ms

-- 4. Execute workflow nodes (application logic)

-- 5. Store execution data (no cache, write to shard)
INSERT INTO execution_data (execution_id, data) VALUES (?, ?);
-- Write: <100ms (depends on data size)

-- 6. Update execution status (no cache, write to shard)
UPDATE executions SET status = 'success', finished_at = NOW() WHERE id = ?;
-- Write: <50ms
```

Total execution overhead: ~200-400ms (excluding workflow node processing)

#### Dashboard Query (Read Performance)
```sql
-- Recent executions (bounded cache, 1-min freshness)
SELECT * FROM executions WHERE workflow_id = ? ORDER BY started_at DESC LIMIT 50;
-- Cache hit: <20ms, Cache miss: <150ms

-- Execution statistics (materialized query cache)
SELECT status, COUNT(*) FROM executions WHERE workflow_id = ? GROUP BY status;
-- Cache hit: <20ms, Cache miss: <200ms
```

### Migration and Scaling

#### Execution History Growth
Automatic time-based migration strategy:
1. **Daily job**: Move executions >7 days to shard_1 (semi-active)
2. **Weekly job**: Move executions >30 days to shard_2 (archive)
3. **Monthly job**: Move executions >90 days to shard_3 (long-term archive)
4. **Quarterly job**: Delete executions >365 days (configurable retention)

Migration uses ShardSplitService:
```typescript
// Example: Migrate old executions
await shardSplitService.planSplit({
  sourceShard: 'shard_0',
  targetShard: 'shard_1',
  tenantIds: ['tenant_n8n'],
  description: 'Migrate executions 8-30 days old'
});

// Filter during backfill
WHERE execution_id IN (
  SELECT id FROM executions 
  WHERE finished_at BETWEEN '7 days ago' AND '30 days ago'
)
```

#### Workflow Growth
When workflow count exceeds 1,000:
1. Shard by tenant for multi-instance deployments
2. Shard by workflow category/folder for single-instance
3. Consider dedicated shards for high-frequency workflows

#### High-Frequency Workflow Isolation
Workflows executing >100 times/hour:
1. Monitor execution count per workflow
2. Create dedicated shard for top 10 high-frequency workflows
3. Prevents resource contention with batch/scheduled workflows

### Monitoring Recommendations

Critical n8n metrics:
- **Execution success rate**: Alert if <95%
- **Execution start latency**: p95 should be <500ms
- **Execution data size**: Alert if avg >500KB (indicates inefficiency)
- **Archive shard growth**: Alert at 8GB (80% capacity)
- **Credential access**: Audit all credential accesses
- **Webhook response time**: p95 should be <200ms
- **Cache hit rate (workflows)**: Alert if <90%

### Data Retention and Archival

Recommended retention policy:
- **Active executions** (0-7 days): Keep in shard_0, no archival
- **Recent executions** (8-30 days): Move to shard_1, keep full data
- **Archive executions** (31-90 days): Move to shard_2, compress execution_data
- **Long-term archive** (91-365 days): Move to shard_3, optionally move to D1 mirror
- **Expired executions** (>365 days): Delete or export to cold storage

Archival strategy:
```sql
-- Compress execution_data for archive shards
UPDATE execution_data 
SET data = COMPRESS(data)
WHERE execution_id IN (SELECT id FROM executions WHERE finished_at < '30 days ago');

-- Export to D1 mirror for long-term analytics
INSERT INTO d1_mirror.executions 
SELECT * FROM executions WHERE finished_at BETWEEN '90 days ago' AND '365 days ago';

-- Delete expired executions
DELETE FROM executions WHERE finished_at < '365 days ago';
DELETE FROM execution_data WHERE execution_id NOT IN (SELECT id FROM executions);
```

### Security Considerations

#### Credential Protection
- Credentials table: Strong consistency, no caching
- Encrypted at rest in Durable Object storage
- Decrypted only during workflow execution
- Audit log for all credential accesses
- Tenant isolation prevents cross-instance access

#### Webhook Security
- Webhook paths: Unique constraint prevents collisions
- HMAC signature validation in application layer
- Rate limiting per webhook path
- IP whitelisting support via settings

#### Execution Data Privacy
- Execution data may contain sensitive information
- Tenant isolation enforced by sharding
- Automatic deletion after retention period
- Optional encryption for execution_data

## Configuration Files

This directory should contain YAML files for each n8n table following the patterns described above. Key policies to implement:
- Strong consistency for credentials and settings
- Bounded consistency for executions with short TTL
- Aggressive caching for workflow definitions
- Time-based routing for execution history archival

## References

- [ADR-006: Routing and Sharding System](../../docs/architecture/006-routing-sharding-system.md)
- [ADR-003: Cache-Aside Pattern with KV](../../docs/architecture/003-cache-aside-pattern.md)
- [ADR-011: Shard Management](../../docs/architecture/011-shard-management.md)
- [Configuration System](../../.github/instructions/configuration-system.instructions.md)
- [n8n Database Schema](https://github.com/n8n-io/n8n/blob/master/packages/cli/src/databases/entities/)
- [Shard Split Lifecycle](../../.github/instructions/shard-split-lifecycle.instructions.md)
- [Queue-based Cache Invalidation](../../.github/instructions/queue-invalidation.instructions.md)

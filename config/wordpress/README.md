# WordPress Sharding Configuration

## Overview

This directory contains WorkerSQL sharding configuration for a WordPress blog/content site with thousands of posts and pages. The configuration is optimized for multi-tenant WordPress hosting where each site is isolated by tenant ID.

## WordPress Database Schema

WordPress uses the following key tables:
- **wp_posts** - Blog posts, pages, custom post types (~5,000 posts)
- **wp_postmeta** - Post metadata (key-value pairs, ~20,000 rows)
- **wp_comments** - User comments (~10,000 comments)
- **wp_commentmeta** - Comment metadata (~5,000 rows)
- **wp_users** - User accounts (~500 users)
- **wp_usermeta** - User metadata (~2,000 rows)
- **wp_terms** - Categories and tags (~200 terms)
- **wp_term_taxonomy** - Term taxonomy relationships (~200 rows)
- **wp_term_relationships** - Post-to-term relationships (~3,000 relationships)
- **wp_options** - Site configuration (~300 options)

## Sharding Strategy

### Tenant-Based Sharding

WordPress installations are sharded by **tenant_id** to ensure complete data isolation between different WordPress sites. This is critical for:
- Security: Preventing cross-site data leakage
- Performance: Isolating high-traffic sites from low-traffic sites
- Scalability: Enabling independent scaling per tenant

### Table-Specific Policies

#### Content Tables (wp_posts, wp_postmeta)
- **Shard by**: `tenant_id` (site isolation)
- **Cache mode**: `bounded` (5-minute TTL, 30-minute SWR)
- **Rationale**: Posts change moderately, bounded caching provides good balance
- **Strong consistency columns**: None (eventual consistency acceptable for content)

#### User Tables (wp_users, wp_usermeta)
- **Shard by**: `tenant_id` (site isolation)
- **Cache mode**: `bounded` (10-minute TTL, 1-hour SWR)
- **Rationale**: User data changes infrequently but needs reasonable freshness
- **Strong consistency columns**: `user_email`, `user_login` (prevent duplicate users)

#### Comment Tables (wp_comments, wp_commentmeta)
- **Shard by**: `tenant_id` (site isolation)
- **Cache mode**: `bounded` (5-minute TTL, 30-minute SWR)
- **Rationale**: Comments are frequently added, need moderate freshness

#### Taxonomy Tables (wp_terms, wp_term_taxonomy, wp_term_relationships)
- **Shard by**: `tenant_id` (site isolation)
- **Cache mode**: `cached` (10-minute TTL, 2-hour SWR)
- **Rationale**: Taxonomy rarely changes, aggressive caching improves performance

#### Configuration Table (wp_options)
- **Shard by**: `tenant_id` (site isolation)
- **Cache mode**: `strong` (no caching)
- **Rationale**: Critical configuration must always be fresh

### Routing Configuration

The routing policy maps tenant IDs to shards using:
1. **Explicit tenant mapping** for high-traffic sites (dedicated shards)
2. **Hash-based distribution** for smaller sites (shared shards)

Example:
- `site_wordpress_vip_1` → dedicated `shard_0` (high-traffic blog)
- `site_wordpress_vip_2` → dedicated `shard_1` (high-traffic blog)
- All other sites → hash-distributed across `shard_2` through `shard_7`

### Shard Sizing Considerations

Each shard has a 10GB capacity limit. Estimated storage per WordPress site:
- **Small site** (500 posts): ~50MB
- **Medium site** (2,000 posts): ~200MB
- **Large site** (10,000 posts): ~1GB

With hash-based distribution:
- Small/medium sites: ~40-50 sites per shard
- Large sites: ~8-10 sites per shard
- VIP sites: Dedicated shards (1 site per shard)

### Cache Key Patterns

WorkerSQL generates cache keys using these patterns:

#### Entity Cache
```
t:wp_posts:id:123                    # Single post by ID
t:wp_users:id:456                    # Single user by ID
```

#### Query Result Cache
```
tenant_a:q:wp_posts:hash_of_query    # Materialized query result
```

#### Index Cache
```
idx:wp_posts:post_author:123         # Posts by author
idx:wp_comments:comment_post_ID:456  # Comments by post
```

### Performance Characteristics

Expected performance with this configuration:
- **Cache hit rate**: 85-90% for read-heavy workloads
- **Read latency**: <50ms (cached), <200ms (uncached)
- **Write latency**: <100ms (dual-write during splits)
- **Concurrent users**: 1,000+ per shard

### Migration and Scaling

#### Adding New Sites
New WordPress sites are automatically routed via hash-based distribution. No configuration changes required.

#### High-Traffic Site Isolation
When a site outgrows shared sharding:
1. Create new dedicated shard for the site
2. Use `ShardSplitService.planSplit()` to initiate migration
3. Dual-write phase ensures zero downtime
4. Cutover when tail replay catches up

#### Shard Splitting
If a shard approaches 10GB capacity:
1. Identify tenants to migrate (prefer largest sites)
2. Plan split with target shard
3. Background backfill copies historical data
4. Tail replay catches up recent changes
5. Cutover routing atomically

### Monitoring Recommendations

Monitor these metrics per shard:
- **Storage usage**: Alert at 8GB (80% capacity)
- **Query latency**: p95 should be <200ms
- **Cache hit rate**: Alert if <75%
- **Tenant count**: Track for rebalancing decisions
- **Split progress**: Monitor backfill and tail replay status

## Configuration Files

This directory should contain YAML files for each WordPress table following the patterns described above. See the existing examples in `/config/table-policies/` for reference implementations.

## References

- [ADR-006: Routing and Sharding System](../../docs/architecture/006-routing-sharding-system.md)
- [ADR-003: Cache-Aside Pattern with KV](../../docs/architecture/003-cache-aside-pattern.md)
- [ADR-011: Shard Management](../../docs/architecture/011-shard-management.md)
- [Configuration System](../../.github/instructions/configuration-system.instructions.md)
- [WordPress Database Schema](https://codex.wordpress.org/Database_Description)

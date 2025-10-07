# WooCommerce Sharding Configuration

## Overview

This directory contains WorkerSQL sharding configuration for a high-performance WooCommerce e-commerce site with 30,000 products and 100,000 orders. The configuration is optimized for high-volume transactional workloads with strong consistency requirements for critical operations.

## WooCommerce Database Schema

WooCommerce extends WordPress with these additional tables:
- **wc_products** - Product catalog (~30,000 products)
- **wc_product_meta** - Product metadata (pricing, SKU, inventory, ~150,000 rows)
- **wc_orders** - Customer orders (~100,000 orders)
- **wc_order_items** - Order line items (~300,000 items)
- **wc_order_itemmeta** - Order item metadata (~600,000 rows)
- **wc_customers** - Customer profiles (~50,000 customers)
- **wc_customer_sessions** - Shopping cart sessions (~5,000 active sessions)
- **wc_inventory** - Stock levels and reservations (~30,000 SKUs)
- **wc_payment_tokens** - Saved payment methods (~20,000 tokens)
- **wc_webhooks** - Webhook configurations (~50 webhooks)

Plus standard WordPress tables:
- **wp_users** - User accounts (~50,000 users)
- **wp_usermeta** - User metadata (~200,000 rows)
- **wp_posts** - Product descriptions as custom post type
- **wp_postmeta** - Additional product metadata

## Sharding Strategy

### Multi-Dimension Sharding

WooCommerce requires a sophisticated sharding strategy due to:
1. **Product catalog**: Large, mostly read-heavy
2. **Orders**: High write volume, transactional integrity required
3. **Inventory**: Critical consistency, race condition prevention
4. **Customers**: Moderate read/write, security-sensitive

### Table-Specific Policies

#### Product Tables (wc_products, wc_product_meta, wp_posts for products)
- **Shard by**: `tenant_id` + `product_id` hash-based distribution
- **Cache mode**: `cached` (15-minute TTL, 2-hour SWR)
- **Rationale**: Products change infrequently, aggressive caching improves catalog browsing
- **Strong consistency columns**: None (eventual consistency acceptable)
- **Index optimization**: Cache by category, brand, tag for faceted search

#### Order Tables (wc_orders, wc_order_items, wc_order_itemmeta)
- **Shard by**: `customer_id` for co-location with customer data
- **Cache mode**: `strong` (no caching)
- **Rationale**: Orders require ACID guarantees, always read from authoritative storage
- **Strong consistency columns**: All columns (critical for payment processing)
- **Transaction support**: Use WebSocket sticky sessions for multi-table operations

#### Inventory Table (wc_inventory)
- **Shard by**: `product_id` (co-locate with product to support atomic stock updates)
- **Cache mode**: `bounded` (30-second TTL, 5-minute SWR)
- **Rationale**: Inventory needs frequent updates but can tolerate brief staleness
- **Strong consistency columns**: `stock_quantity`, `reserved_quantity` (prevent overselling)
- **Race condition handling**: Use SQL-level atomic operations for stock adjustments

#### Customer Tables (wc_customers, wp_users, wp_usermeta)
- **Shard by**: `customer_id` (tenant isolation + customer ID)
- **Cache mode**: `bounded` (5-minute TTL, 30-minute SWR)
- **Rationale**: Customer data changes moderately, bounded caching balances freshness
- **Strong consistency columns**: `customer_email`, `user_login` (prevent duplicates)

#### Session Table (wc_customer_sessions)
- **Shard by**: `session_id` hash-based distribution
- **Cache mode**: `bounded` (1-minute TTL, 5-minute SWR)
- **Rationale**: Sessions are ephemeral but frequently accessed during checkout
- **TTL**: Auto-expire sessions after 24 hours of inactivity

#### Payment Token Table (wc_payment_tokens)
- **Shard by**: `customer_id` (co-locate with customer)
- **Cache mode**: `strong` (no caching)
- **Rationale**: Payment data must always be fresh for PCI compliance
- **Strong consistency columns**: All columns (security-critical)

### Routing Configuration

The routing policy uses sophisticated tenant and customer-based routing:

#### High-Volume Product Shards
- **shard_0**: Products A-G (10,000 products)
- **shard_1**: Products H-Q (10,000 products)
- **shard_2**: Products R-Z (10,000 products)

#### Order and Customer Shards
- **shard_3-5**: Customers 1-20,000 (with co-located orders)
- **shard_6-7**: Customers 20,001-50,000 (with co-located orders)

#### Session Shards
- **shard_8-9**: Hash-distributed sessions for load balancing

### Shard Sizing Considerations

Each shard has a 10GB capacity limit. Estimated storage per entity:
- **Product**: ~500KB (with metadata and images references)
- **Order**: ~2KB (with line items)
- **Customer**: ~5KB (with metadata)

Capacity planning:
- Product shards: 10,000 products × 500KB = ~5GB (50% capacity)
- Order shards: 25,000 orders × 2KB + 50,000 order items = ~300MB (3% capacity)
- Customer shards: 16,667 customers × 5KB = ~83MB (0.8% capacity)

Growth headroom allows for:
- Product shards: Double product count before splitting
- Order shards: 10+ years of order history before splitting
- Customer shards: 100,000+ customers before splitting

### Cache Key Patterns

WorkerSQL generates cache keys optimized for e-commerce:

#### Entity Cache
```
t:wc_products:id:1234                # Single product by ID
t:wc_orders:id:5678                  # Single order by ID
t:wc_customers:id:9012               # Single customer by ID
```

#### Query Result Cache (Product Catalog)
```
tenant_shop:q:wc_products:category_electronics  # Products by category
tenant_shop:q:wc_products:price_range_50_100    # Products by price range
tenant_shop:q:wc_products:brand_acme            # Products by brand
```

#### Index Cache
```
idx:wc_orders:customer_id:123       # All orders by customer
idx:wc_order_items:order_id:456     # Line items for order
idx:wc_products:sku:ABC123          # Product by SKU
```

### Performance Characteristics

Expected performance with this configuration:
- **Product catalog browse**: <50ms (90%+ cache hit rate)
- **Order creation**: <200ms (strong consistency, no cache)
- **Inventory check**: <100ms (bounded cache, 30s freshness)
- **Customer lookup**: <100ms (bounded cache)
- **Concurrent checkouts**: 100+ simultaneous transactions per shard

### Consistency Guarantees

#### Strong Consistency (ACID Transactions)
- Order placement (payment → order creation → inventory deduction)
- Payment token operations
- Inventory updates (prevent overselling)

#### Bounded Consistency (Near Real-Time)
- Product catalog updates (30s-5min delay acceptable)
- Customer profile updates
- Session management

#### Eventual Consistency (Background Sync)
- Product recommendations
- Analytics and reporting
- Search index updates

### Transaction Patterns

#### Checkout Flow (Strong Consistency)
```sql
BEGIN TRANSACTION; -- WebSocket sticky session

-- Reserve inventory
UPDATE wc_inventory 
SET reserved_quantity = reserved_quantity + 1
WHERE product_id = ? AND (stock_quantity - reserved_quantity) >= 1;

-- Create order
INSERT INTO wc_orders (customer_id, total, status) VALUES (?, ?, 'pending');

-- Add order items
INSERT INTO wc_order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?);

-- Process payment (external API call)

-- Update order status
UPDATE wc_orders SET status = 'processing' WHERE order_id = ?;

-- Commit inventory
UPDATE wc_inventory 
SET stock_quantity = stock_quantity - 1,
    reserved_quantity = reserved_quantity - 1
WHERE product_id = ?;

COMMIT TRANSACTION;
```

#### Product Update (Eventual Consistency)
```sql
-- Update product (triggers cache invalidation via queue)
UPDATE wc_products SET price = ?, title = ? WHERE product_id = ?;

-- Cache invalidated asynchronously
-- Browse sessions may see stale price for up to 15 minutes
```

### Migration and Scaling

#### Product Catalog Growth
When product count exceeds 20,000 per shard:
1. Split product shards by category or brand
2. Use range-based routing for deterministic placement
3. Background backfill during low-traffic hours

#### Order Volume Growth
Orders co-located with customers provide natural sharding:
1. Monitor per-customer shard order count
2. Split customer base when approaching 50,000 customers per shard
3. Orders automatically follow customer routing

#### Inventory Hotspots
For viral products causing inventory contention:
1. Implement optimistic locking with retry logic
2. Consider dedicated shard for top 100 products
3. Use row-level locking in TableShard SQLite

### Monitoring Recommendations

Critical WooCommerce metrics:
- **Inventory accuracy**: Zero tolerance for overselling
- **Order completion rate**: Alert if <95%
- **Checkout latency**: p95 should be <500ms end-to-end
- **Payment failure rate**: Alert if >2%
- **Cache hit rate (products)**: Alert if <85%
- **Database size per shard**: Alert at 8GB (80% capacity)
- **Concurrent transaction count**: Monitor for deadlock potential

### Security Considerations

#### PCI DSS Compliance
- Payment tokens: Strong consistency, encrypted at rest
- Customer data: Tenant isolation enforced by sharding
- Audit logging: All payment operations logged

#### Data Isolation
- Each WooCommerce store isolated by tenant_id
- Cross-tenant queries blocked at gateway level
- Role-based access control enforced

#### Inventory Integrity
- Atomic operations prevent race conditions
- Reserved quantity prevents overselling during checkout
- Periodic reconciliation jobs verify accuracy

## Configuration Files

This directory should contain YAML files for each WooCommerce table following the patterns described above. Key policies to implement:
- Strong consistency for orders and payments
- Bounded consistency for inventory with short TTL
- Aggressive caching for product catalog
- Customer-based routing for data co-location

## References

- [ADR-006: Routing and Sharding System](../../docs/architecture/006-routing-sharding-system.md)
- [ADR-003: Cache-Aside Pattern with KV](../../docs/architecture/003-cache-aside-pattern.md)
- [ADR-011: Shard Management](../../docs/architecture/011-shard-management.md)
- [Configuration System](../../.github/instructions/configuration-system.instructions.md)
- [WooCommerce Database Schema](https://github.com/woocommerce/woocommerce/wiki/Database-Description)
- [ACID Transactions in Durable Objects](../../.github/instructions/durable-object-shard-sqlite.instructions.md)

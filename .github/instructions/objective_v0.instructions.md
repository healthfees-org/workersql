# Edge SQL on Cloudflare — **MySQL‑compat driver, DO‑primary, KV cache, Queues invalidation, optional D1 mirror**

> **Purpose**: Provide a Cloudflare‑only, production‑grade data layer that *feels like MySQL* to applications (swap DSN / client lib) while delivering **ACID writes at the edge** (per shard), **planet‑wide low‑latency reads**, and a clean **cache‑invalidation** and **portability** story—without running a traditional MySQL server.

> **Vision**: SQL as a service at edge and an OpenAPI compliant REST API end-point using dynamic durable data contracts modeled in JSON.

> **GitHub‑ready**: This `README.md` uses **Mermaid** diagrams which render natively on GitHub.

> **Miniflare**: This project uses **Miniflare** for local development and testing of Cloudflare Workers.

> **Wrangler**: This project uses **Wrangler** for deployment and management of Cloudflare Workers.

> **Jest**: This project uses **Jest** for testing Cloudflare Workers.

> **Pre-commit**: This project uses **Pre-commit** for managing and maintaining code quality.

---

## Table of Contents
- [Why this architecture](#why-this-architecture)
- [System overview (Mermaid)](#system-overview-mermaid)
- [Data flows (Mermaid)](#data-flows-mermaid)
- [Drop‑in feel: client and DSN](#drop-in-feel-client-and-dsn)
- [Routing, sharding, and policy](#routing-sharding-and-policy)
- [Cache layout & invalidation](#cache-layout--invalidation)
- [Consistency model](#consistency-model)
- [SQL dialect compatibility](#sql-dialect-compatibility)
- [Benchmarking vs MySQL/MariaDB/Percona/Postgres](#benchmarking-vs-mysqlmariadbperconapostgres)
- [Comparative matrix](#comparative-matrix)
- [Roadmap: Postgres‑class features (JSON & GIS/GeoJSON)](#roadmap-postgres-class-features-json--gisgeojson)
- [Security & compliance](#security--compliance)
- [Operational excellence (SLO/observability)](#operational-excellence-sloobservability)
- [Deployment (Wrangler bindings)](#deployment-wrangler-bindings)
- [FAQ](#faq)
- [License](#license)

---

## Why this architecture
- **Authoritative store**: **SQLite‑backed Durable Objects (DOs)** → transactional, strongly consistent **per shard** with **Point‑In‑Time Recovery (PITR)**.
- **Fast global reads**: **Workers KV** used strictly as a **cache/materialized view** (never source of truth).
- **Change fan‑out**: **Queues** for cache invalidation and optional pre‑warming.
- **Portability/analytics (optional)**: **D1 mirror** populated by batches (not in the hot path).
- **Drop‑in feel**: a MySQL‑compatible **compat client** (`@edge-mysql/promise`) + **Gateway Worker** that hides KV vs DO and performs policy‑driven routing.

---

## System overview (Mermaid)
```mermaid
graph TD
  A[App / Service] -- DSN: edge-mysql://... --> B[Compat Client <br/>@edge-mysql/promise]
  B --> C[Gateway Worker]
  C -- fresh cache read --> K[(Workers KV)]
  C -- strong/miss --> R[Router]
  R --> S1[Durable Object Shard 1<br/>(SQLite)]
  R --> S2[Durable Object Shard N<br/>(SQLite)]
  S1 -- ACID write --> S1
  S1 -- events --> Q[[Queues: db-events]]
  Q --> CW[Cache Worker (consumer)]
  CW --> K
  CW --> D1[(Optional: D1 Mirror)]
  subgraph Cloudflare Edge
    C; R; S1; S2; K; Q; CW; D1
  end
```

---

## Data flows (Mermaid)

### Read path (KV → DO → repopulate)
```mermaid
sequenceDiagram
  autonumber
  participant App
  participant Client as Compat Client
  participant GW as Gateway Worker
  participant KV as Workers KV
  participant DO as DO (Shard)
  App->>Client: query("SELECT ... WHERE id=?")
  Client->>GW: HTTP/WS request
  GW->>KV: GET cache key
  alt Fresh cache hit
    KV-->>GW: value (within TTL)
    GW-->>Client: rows
    Client-->>App: rows
  else Miss or stale or strong
    KV-->>GW: miss/stale
    GW->>DO: SQL exec (read)
    DO-->>GW: rows
    GW->>KV: SET {data, ver, freshUntil, swrUntil}
    GW-->>Client: rows
    Client-->>App: rows
  end
```

### Write path (ACID in shard, event‑driven invalidation)
```mermaid
sequenceDiagram
  autonumber
  participant App
  participant Client as Compat Client (WS sticky)
  participant GW as Gateway Worker
  participant DO as DO (Shard)
  participant Q as Queues
  participant CW as Cache Worker
  participant KV as Workers KV
  participant D1 as (Optional) D1
  App->>Client: BEGIN; UPDATE ...; COMMIT
  Client->>GW: Txn messages over WS (pinned shard)
  GW->>DO: BEGIN/UPDATE/COMMIT (single shard)
  DO-->>GW: OK + new ver
  DO->>Q: enqueue {invalidateKeys, prewarms, d1Ops}
  Q-->>CW: deliver (at least once)
  CW->>KV: DELETE keys / UPSERT prewarms
  opt Mirroring
    CW->>D1: batch ops (sequential, auto‑commit)
  end
  GW-->>Client: OK
```

### Sharding & routing
```mermaid
graph LR
  R[Router] -->|tenant=a| A((Shard A))
  R -->|tenant=b| B((Shard B))
  R -->|hash 00..7f| C((Shard C))
  R -->|hash 80..ff| D((Shard D))
```

### Cache/invalidation topology
```mermaid
graph TD
  DO[(Authoritative DO/SQLite)] -- change events --> Q[[Queues]]
  Q --> W[Cache Worker]
  W -->|delete/set| KV[(Workers KV)]
  W -->|optional| D1[(D1 mirror)]
  User[Client Read] --> GW[Gateway] -->|fresh?
KV| KV
  GW -->|fallback| DO
```

---

## Drop‑in feel: client and DSN
Swap the DSN and keep familiar call patterns.

```text
# Before (mysql2/promise)
mysql://user:pass@db.example:3306/app

# After (edge)
edge-mysql://tenant@cloudflare?account_id=...&project=...&token=...
```

```ts
import { createPool } from '@edge-mysql/promise';
const pool = createPool(process.env.EDGE_MYSQL_DSN!);

const conn = await pool.getConnection();
await conn.beginTransaction();       // pins to shard (WS sticky)
await conn.query('UPDATE users SET name=? WHERE id=?', ['Ada', 42]);
await conn.commit();

const [rows] = await pool.query('SELECT * FROM users WHERE id=?', [42]);
```

**Optional SQL hints** (no new APIs, parsed by the gateway):
```sql
/*+ strong */ SELECT * FROM balances WHERE id=?;
/*+ bounded=1500 */ SELECT * FROM posts WHERE id=?;
/*+ shard:tenant_id=acme */ BEGIN;
```

---

## Routing, sharding, and policy
Define a table policy once; the gateway honors it so apps stay zero‑config.

```yaml
# table-policy.yaml
tables:
  users:
    pk: id
    shard_by: tenant_id
    cache:
      mode: bounded
      ttl_ms: 30000
      swr_ms: 120000
      always_strong_columns: [role, permissions, balance]
  posts:
    pk: id
    shard_by: tenant_id
    cache:
      mode: bounded
      ttl_ms: 15000
      swr_ms: 60000
```

---

## Sharding for the ~10 GB per‑DO limit (Runbook)

**Why 10 GB?** Each Durable Object (DO) shard persists to a SQLite store with practical limits around ~10 GB. Plan to **scale horizontally** before you reach this ceiling.

### Capacity guardrails
- **Soft alert:** **7.0 GB** (plan split)
- **Plan window:** **8.5 GB** (freeze schema changes on that shard; prepare split)
- **Hard guard:** **9.5 GB** (throttle heavy writes; proceed to cutover)
- Track: `bytes_used`, `rows`, `ops/sec`, `write_amp`, and queue lag for that shard.

### Split strategies
- **Per‑tenant split (preferred):** Move a subset of tenants off the hot shard (keeps joins intra‑tenant).
- **Range/hash split:** Split by key hash prefixes (e.g., `00..7f` vs `80..ff`) for non‑tenant global data.

### Online split (zero/near‑zero downtime)
```mermaid
sequenceDiagram
  autonumber
  participant Router
  participant Old as DO‑A (old shard)
  participant New as DO‑B (new shard)
  participant BF as BackfillWorker
  participant Q as Queues
  participant CW as CacheWorker
  participant App
  Router->>Old: set router_epoch = n (steady state)
  Note over Router,Old: 1) Plan: choose target keys/tenants
  Router->>New: create shard DO‑B (empty)
  Router->>Old: enable dual‑write for affected keys (epoch n→n+1)
  App->>Router: writes (affected keys)
  Router->>Old: write (epoch n+1)
  Router->>New: write (epoch n+1)
  Old-->>Q: change events (epoched)
  Q-->>CW: invalidate KV keys
  par Backfill
    BF->>Old: snapshot scan (consistent window)
    Old-->>BF: rows
    BF->>New: bulk upsert rows (idempotent)
  and Tail
    Q-->>BF: tail changes after snapshot LSN
    BF->>New: apply tail (idempotent)
  end
  Router->>Router: cutover route → New (epoch n+2)
  App->>Router: reads/writes → New
  Router->>Old: read‑only window (grace period)
  Router->>Old: decommission after verification
```

### Routing map (versioned)
```yaml
routing:
  version: 3
  tenants:
    acme: shard-acme-2   # moved from shard-acme-1
  ranges:
    - prefix: "00..7f"
      shard: shard-range-0
    - prefix: "80..ff"
      shard: shard-range-1
```

**Router behavior**
- Reads route by latest `routing.version`.
- During dual‑write (epoch n+1), **writes go to both** old and new; reads remain on old until cutover (n+2).
- KV invalidations include `ver`/`epoch` so stale messages are ignored.

### Verification & rollback
- **Verify**: row counts, checksums by key range/tenant; sample query parity.
- **Rollback**: flip routing back to old shard (epoch rollback) and replay tail to resync new.
- **Backups**: keep DO PITR enabled; capture R2 snapshots before and after cutover.

---

## Cache layout & invalidation
**KV key patterns**
- Entity: `t:<table>:id:<pk>` → `{ data, ver, freshUntil, swrUntil }`
- Index (equality): `idx:<table>:<col>:<val>` → `[ids...]`
- Query materialization: `q:<table>:<sha256(sql+params)>` → `{ rows, ver, ... }`

**Invalidation rules**
- Only the **writer path** (DO → Queue → Consumer) mutates KV
- Invalidation is **idempotent**; include `ver` to ignore stale events
- Typical TTLs: entities 15–60s; lists 10–30s; SWR windows 1–5m

---

## Consistency model
- **KV** → cache only, **eventually consistent** (global propagation may take seconds)
- **DO storage** → authoritative, single‑threaded, **transactional SQL**, **PITR**
- **Queues** → at‑least‑once delivery; consumers must be **idempotent**

Read consistency modes (policy‑driven; optionally hinted per‑query):
- `strong` (bypass KV)
- `bounded(ms)` (serve KV only if within freshness window)
- `cached` (serve KV if present; fallback to DO)

---

## SQL dialect compatibility
| MySQL | SQLite equivalent / note |
|---|---|
| `AUTO_INCREMENT` | `INTEGER PRIMARY KEY` (rowid) |
| `BOOLEAN` | `INTEGER` (0/1) |
| `NOW()` | `CURRENT_TIMESTAMP` |
| `LAST_INSERT_ID()` | `SELECT last_insert_rowid()` |
| `JSON_*` | SQLite JSON1 (`json_extract`, `json_set`, …) |
| FKs | Supported; ensure PRAGMAs/migrations enable |
| `ENGINE=InnoDB` | N/A (drop) |
| `UNSIGNED` | Emulate via CHECK / app validation |
| `DATETIME` | `TEXT` (ISO8601) or `INTEGER` epoch |

The gateway performs light **DDL/SQL transpilation** for common patterns.

---

## Benchmarking vs MySQL/MariaDB/Percona/Postgres
**Goal**: compare tail latency, throughput, and correctness under contention.

### Workloads
1. **Hot key read**: `SELECT * FROM users WHERE id=?` (cached vs strong)
2. **Cold read / range**: last 50 events by tenant
3. **Point write**: single‑row `UPDATE` inside a transaction
4. **Batch write**: 10‑row `INSERT ... VALUES (...)` inside a transaction
5. **Contention**: increment a counter row from N concurrent clients
6. **Mixed 80/20**: 80% reads, 20% writes for 10 minutes

### Metrics
- p50/p95/p99 latency (ms); max sustained QPS (p95 ≤ SLA)
- Correctness under contention (lost updates)
- Cost signals: Worker CPU time, egress, instance CPU/mem (for DB engines)

### Test environments
- **Edge SQL**: Gateway + DO shards + KV + Queues (no D1 in hot path)
- **MySQL / Percona / MariaDB / Postgres**: single node (or managed) in the nearest region; poolers enabled (`mysql2`, `pgbouncer`)

### One‑shot `docker compose` for engines
```yaml
# compose.db.yml
services:
  mysql:
    image: mysql:8
    environment:
      - MYSQL_ROOT_PASSWORD=pass
      - MYSQL_DATABASE=app
      - MYSQL_USER=app
      - MYSQL_PASSWORD=pass
    ports: ["3306:3306"]

  percona:
    image: percona:8
    environment:
      - MYSQL_ROOT_PASSWORD=pass
      - MYSQL_DATABASE=app
      - MYSQL_USER=app
      - MYSQL_PASSWORD=pass
    ports: ["13306:3306"]

  mariadb:
    image: mariadb:11
    environment:
      - MARIADB_ROOT_PASSWORD=pass
      - MARIADB_DATABASE=app
      - MARIADB_USER=app
      - MARIADB_PASSWORD=pass
    ports: ["23306:3306"]

  postgres:
    image: postgres:16
    environment:
      - POSTGRES_PASSWORD=pass
      - POSTGRES_USER=app
      - POSTGRES_DB=app
    ports: ["5432:5432"]
```

### Harness (Node + k6)
- Client libraries: `@edge-mysql/promise`, `mysql2`, `pg`
- Load: `k6` or `autocannon` driving the Node harness

```bash
# Example: start DBs
docker compose -f compose.db.yml up -d

# Run edge harness (Workers dev or wrangler publish, then target the gateway URL)
node bench/edge-run.js --duration 600 --rps 500

# Run RDBMS harnesses
node bench/mysql-run.js --dsn mysql://app:pass@127.0.0.1:3306/app
node bench/mysql-run.js --dsn mysql://app:pass@127.0.0.1:13306/app   # Percona
node bench/mysql-run.js --dsn mysql://app:pass@127.0.0.1:23306/app   # MariaDB
node bench/pg-run.js    --dsn postgres://app:pass@127.0.0.1:5432/app
```

### Results template
| Engine | Workload | p50 | p95 | p99 | Max QPS (p95≤X) | Notes |
|---|---|---:|---:|---:|---:|---|
| Edge SQL (KV cached) | Hot key read |  |  |  |  | |
| Edge SQL (strong) | Hot key read |  |  |  |  | |
| Edge SQL | Point write |  |  |  |  | |
| MySQL | Point write |  |  |  |  | |
| Percona | Point write |  |  |  |  | |
| MariaDB | Point write |  |  |  |  | |
| Postgres | Point write |  |  |  |  | |

**Expectations**
- Cached reads (Edge SQL) → lowest global latency.
- Strong reads/writes (Edge SQL) → competitive regional latency; serialized correctness per shard.
- Traditional RDBMS → excels at complex cross‑table queries & cross‑entity transactions within one region.

---

## Comparative matrix
| Dimension | Edge SQL (this) | MySQL/Percona | MariaDB | Postgres |
|---|---|---|---|---|
| Global read latency | **Excellent** (KV at edge) | Regional only | Regional only | Regional only |
| Write semantics | **ACID intra‑shard** | ACID | ACID | ACID |
| Cross‑shard ACID | No (use sagas) | n/a (single cluster) | n/a | n/a |
| Ops overhead | **Low** (serverless) | Medium/High | Medium | Medium/High |
| JSON features | Good (SQLite JSON1) | Good | Good | **Excellent (JSONB)** |
| GIS/GeoJSON | Good (edge patterns) | Good (MySQL GIS) | Good | **Excellent (PostGIS)** |
| PITR baked‑in | **Yes (DO)** | Varies | Varies | Varies |

---

## Roadmap: Postgres‑class features (JSON & GIS/GeoJSON)
**Phase 1 — JSON @ Edge (now)**
- Use **SQLite JSON1**; add generated columns for indexed JSON paths.

**Phase 2 — Geospatial basics @ Edge**
- Store `lat/lon` + GeoJSON; Haversine filters; H3/S2 cell pre‑index; KV materialized tiles.

**Phase 3 — Spatial indexing @ Edge**
- Approximate KNN via H3 rings + refinement; hierarchical buckets for bounding boxes.

**Phase 4 — Heavy GIS & Analytics (Portable Mirrors)**
- Mirror to D1 or external Postgres+PostGIS for advanced analytics; generate vector tiles into R2.

**Phase 5 — Developer ergonomics**
- JSON path index DSL; geo query builder (`nearby`, `within`), tile/cell‑based cache invalidation.

---

## Security & compliance
- **Auth**: Signed tenant tokens validated at gateway.
- **Isolation**: Shard routing enforces tenant boundaries.
- **Least‑privilege**: Prepared statements by default; no string concatenation.
- **Secrets**: Workers bindings; never in code.

---

## Operational excellence (SLO/observability)
- **Per‑shard metrics**: ops/sec, p95 latency, queue lag, KV hit/miss, conflicts.
- **Alarms**: cache stampede, queue backlog, DO CPU overage, PITR gaps.
- **SLO examples**: p95 cached read ≤ 30 ms; p95 strong read ≤ 120 ms; p95 write ≤ 150 ms.

---

## Deployment (Wrangler bindings)
```toml
# wrangler.toml (excerpt)
name = "edge-mysql-gateway"
main = "src/gateway.ts"
compatibility_date = "2025-08-01"

[[kv_namespaces]]
binding = "APP_CACHE"
id = "xxxxxxxxxxxxxxxx"

[[queues.producers]]
binding = "DB_EVENTS"
queue = "db-events"

[[queues.consumers]]
queue = "db-events"
max_batch_size = 50
max_batch_timeout = 2

[[durable_objects.bindings]]
name = "SHARD"
class_name = "TableShard"

[[d1_databases]]
binding = "PORTABLE_DB"
database_name = "portable-mirror"
database_id = "yyyyyyyyyyyyyyyy"
```

---

## FAQ
**Is this a literal MySQL server on :3306?**
No—Workers don’t accept inbound TCP. The compat client speaks HTTP/WS to the gateway.

**Do I get real transactions?**
Yes—**within a shard** (single DO). Cross‑shard requires sagas/outbox.

**Why include D1 at all?**
Portability/analytics mirror fed by batches; not in the hot path.

**Shard size guidance?**
Design for ~10 GB per DO shard; scale horizontally by minting more shards.

---

## License
Apache‑2.0

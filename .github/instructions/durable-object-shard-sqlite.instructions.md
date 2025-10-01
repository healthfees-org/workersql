---
applyTo: 'src/services/TableShard.ts'
---

# Durable Object Shard — SQLite, ACID, PITR, Capacity, Conflicts

This instruction captures the implemented patterns for `TableShard` so future work aligns.

## Highlights
- SQLite-backed storage via `ctx.storage.sql` with prepared-style bindings (`?` placeholders).
- ACID: Synchronous transactions using `storage.transactionSync` for queued multi-statement commits; implicit atomicity for single statements.
- Prepared statements: engine-level binding through `exec(sql, ...params)`; LRU of statement strings for advisory caching.
- PITR: Expose `/pitr/bookmark` and `/pitr/restore` using bookmarks (`getCurrentBookmark`, `getBookmarkForTime`, `onNextSessionRestoreBookmark`).
- Capacity: Track size using `PRAGMA page_count` and `PRAGMA page_size`; store latest into `_meta` key `capacity:size`; enforce 10GB (configurable by `MAX_SHARD_SIZE_GB`).
- Conflicts & deadlocks: Normalize transient busy/overload errors to `RETRYABLE` and retry with backoff; unique constraint violations mapped to `CONFLICT_UNIQUE`.

## Endpoints
- POST `/query` { query, tenantId }
- POST `/mutation` { query, tenantId, transactionId? }
- POST `/ddl` { query, tenantId }
- POST `/transaction` { operation: 'BEGIN'|'COMMIT'|'ROLLBACK', transactionId?, tenantId }
- POST `/pitr/bookmark` { at?: number }
- POST `/pitr/restore` { bookmark: string }
- GET  `/health`, GET `/metrics`

## Internal schema
- `_events(id INTEGER PRIMARY KEY, ts INTEGER, type TEXT, payload TEXT)` for future change logging.
- `_meta(k TEXT PRIMARY KEY, v TEXT)` stores capacity and other metadata.

## Notes
- Within a DO instance, JavaScript event isolation plus SQLite-backed storage ensures serializability. Use `transactionSync` for explicit multi-statement atomicity.
- Avoid executing `BEGIN/COMMIT` in SQL: use Storage API transactions.
- Capacity refresh runs on-demand and every 60s; adjust thresholds in env vars.
- Invalidation events are queued to `DB_EVENTS` with `{ type: 'invalidate', keys: [tenant:table] }`.

## Testing
- Unit tests cover: SELECT with bindings, INSERT with last_insert_rowid, transactional queue+commit, PITR endpoints, capacity guard, and retry on transient errors (see `tests/services/TableShard.test.ts`).

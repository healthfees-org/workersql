---
applyTo: 'src/services/ShardSplitService.ts'
---

## Shard split lifecycle guardrails

- Maintain phase normalization when mutating plans; call `normalizePlan` before editing and persist after every mutation to guarantee backfill/tail scaffolding exists.
- Always schedule heavy backfill work with `ExecutionContext.waitUntil` and keep the `yieldToEventLoop` helper to avoid blocking the worker event loop.
- Tail replay must respect monotonic `event.id` ordering and ignore non-mutating (e.g., `SELECT`) statements; only route DDL to `/ddl` and other writes to `/mutation` endpoints.
- When enhancing routing logic, preserve `routingVersionAtStart` and update metrics through `persistPlan` so dashboards stay accurate.
- See `docs/architecture/011-shard-management.md` for lifecycle diagrams, acceptance tests, and operator flow; update both the doc and associated test suites (`tests/services`, `tests/integration`, `tests/smoke`, `tests/fuzz`, `tests/browser`) together when behavior changes.

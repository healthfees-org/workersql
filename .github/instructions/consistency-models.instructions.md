---
applyTo: 'src/**'
---

# Consistency Models Implementation

Implemented 3 modes for SELECT path in `EdgeSQLGateway`:

- strong: bypasses cache entirely; always routes to DO
- bounded: returns cached only if fresh (TTL window); else routes to DO and updates cache synchronously
- cached (SWR): returns cached even if stale within SWR window and revalidates in background; otherwise routes to DO and updates cache

Resolution order:
1) Query hint (`/*+ strong */`, `/*+ bounded=ms */`, `/*+ weak */`) via `SQLCompatibilityService.parseQueryHints`
2) Table policy (`TablePolicy.cache.mode`) via `ConfigService.getTablePolicy`

Keys/TTL:
- TTL and SWR are sourced from `ConfigService.getCacheTTL()` and `getCacheSWR()` by default. Table policies can override via KV-stored YAML.

Tests:
- Added Workers integration tests for strong/bounded/cached semantics
- Existing cache tests cover materialization; new tests avoid strict timing assertions due to Workers runtime variability

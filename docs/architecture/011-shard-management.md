# Shard Management and Online Split Lifecycle

## Context

WorkerSQL supports live shard rebalancing without downtime. The split lifecycle
is orchestrated inside the edge worker by `ShardSplitService`, with data
export/import delegated to the `TableShard` durable objects. This document
captures the operational contract, component interactions, and acceptance
criteria for the shard split workflow delivered in this iteration.

## Actors and Responsibilities

- **ShardSplitService**: owns plan state, phase transitions, progress metrics,
  and validation against routing policies.
- **RoutingVersionManager**: persists routing policy history in KV, guards
  version bumps, and handles rollback.
- **ConfigService**: supplies table policies (primary keys, shard-by columns)
  consumed during backfill iteration.
- **TableShard Durable Objects**: expose `admin/export`, `admin/import`, and
  `admin/events` admin endpoints used for bulk backfill and tail replay.
- **Cloudflare KV (APP_CACHE)**: durable storage for split plans, routing
  versions, and idempotency cursors.

## Lifecycle Phases

| Phase             | Trigger            | Key Work                                                                              | Exit Criteria                                                                   |
| ----------------- | ------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `planning`        | `planSplit`        | Validate tenants, snapshot table policies, persist plan skeleton                      | Plan persisted with `backfill`/`tail` initialized                               |
| `dual_write`      | `startDualWrite`   | Enable dual-write routing; clear previous error state                                 | Ready for backfill launcher                                                     |
| `backfill`        | `runBackfill`      | Execute async export/import loops per tenant & table; update row counters and cursors | All tables copied, `tail.status` reset to `pending`, transition to `tailing`    |
| `tailing`         | Backfill completes | Maintain dual-write until tail replay catches up                                      | `replayTail` finishes with `tail.status = caught_up`, phase → `cutover_pending` |
| `cutover_pending` | Tail caught up     | Await routing update approval                                                         | `cutover` bumps routing version, phase → `completed`                            |
| `completed`       | Cutover committed  | Tenants now routed to target shard                                                    | Metrics frozen, plan retained for audit                                         |
| `rolled_back`     | `rollback`         | Revert routing pointer, reset plan state                                              | Ready to re-run workflow                                                        |

## Data Flow Summary

1. **Planning**
   - Inputs: source shard, target shard, tenant IDs.
   - Validations: tenant list non-empty, source ≠ target, tenants currently
     routed to source shard, no overlapping active plan.
   - Outcomes: KV record `shard_split:plan:{id}` with canonical backfill/tail
     structures.

2. **Dual Write**
   - Flip plan phase to `dual_write`, clear residual error state, mark
     `dualWriteStartedAt` (used for tail replay window).

3. **Backfill Execution**
   - `runBackfill` persists running status then schedules `executeBackfill` via
     `ExecutionContext.waitUntil`.
   - `backfillTable` iterates `admin/export` results using cursor + limit 200;
     each batch invokes target shard `admin/import` in upsert mode.
   - Progress metrics: `totalRowsCopied`, per-table cursor map,
     `backfill.startedAt/completedAt`.

4. **Tail Replay**
   - Fetch events via `admin/events` with `afterId` cursor to ensure
     idempotency.
   - Filter events to target tenants, ignore `SELECT` statements, route DDL to
     `/ddl` endpoint, other mutations to `/mutation`.
   - Persist `lastEventId` and `lastEventTs` after each event to support
     resumability.
   - When batch size < limit, mark `tail.status = caught_up`, phase →
     `cutover_pending`.

5. **Cutover**
   - Copy routing policy, update tenant → target shard assignments, increment
     version, persist via `RoutingVersionManager.updateCurrentPolicy`.
   - Plan captures `routingVersionCutover` for audit and metrics reporting.

6. **Rollback**
   - Reset routing pointer to `routingVersionAtStart`.
   - Clear backfill/tail progress markers and error message, phase →
     `rolled_back`.

## Background Task Contract

- Backfill work is always scheduled via `ExecutionContext.waitUntil` to avoid
  worker request timeouts.
- Each export/import batch yields to event loop (`yieldToEventLoop`) to keep
  cooperative concurrency responsive.
- Failures capture an `errorMessage` and flip the associated phase status
  (`backfill.status` or `tail.status`) to `failed` for observability.

## Metrics

`ShardSplitService.getMetrics()` surfaces per-plan metrics:

- `splitId`, `sourceShard`, `targetShard`
- `phase`, `totalRowsCopied`
- `backfillStatus`, `tailStatus`
- `tenants`, `startedAt`, `updatedAt`

These are suitable for dashboarding and alerting on stalled phases.

## Testing Strategy

| Test Suite           | Location                                           | Coverage                                                             |
| -------------------- | -------------------------------------------------- | -------------------------------------------------------------------- |
| Unit                 | `tests/services/ShardSplitService.test.ts`         | Planning validation, async backfill execution, status persistence    |
| Integration          | `tests/integration/shardSplit.integration.test.ts` | Full lifecycle: plan → dual-write → backfill → tail replay → cutover |
| Smoke                | `tests/smoke/shardSplit.smoke.test.ts`             | Service boot sanity check                                            |
| Fuzz                 | `tests/fuzz/shardSplit.fuzz.test.ts`               | Randomized tenant lists verifying validation invariants              |
| Browser (Playwright) | `tests/browser/shardSplit.spec.ts`                 | Acceptance documentation rendered and key lifecycle sections visible |

## Acceptance Criteria

1. **Valid Planning**: A split cannot be planned unless every tenant is
   currently routed to the source shard and no other active plan overlaps
   (unit + fuzz coverage).
2. **Backfill Safety**: Each export/import batch updates cursors atomically and
   marks success, retrying from persisted state (unit + integration coverage).
3. **Tail Idempotency**: Events replay strictly increasing `id` and skip
   non-applicable writes, guaranteeing no duplicate mutations (integration
   coverage).
4. **Cutover Discipline**: Routing version increments exactly once and records
   the new version on the plan (integration coverage).
5. **Rollback Preparedness**: Rolling back restores pending statuses allowing
   operators to re-run the pipeline (covered by unit smoke assertions of plan
   normalization).
6. **Operator Visibility**: Metrics expose backfill/tail status transitions for
   observability (implicitly covered by unit tests verifying persisted state
   changes).

## Operational Runbook

- Use `planSplit` via admin API (payload: source, target, tenants, description).
- After validation, call `startDualWrite` to begin mirrored writes.
- Trigger `runBackfill` (worker automatically schedules background execution);
  monitor metrics for `backfill.status`.
- Poll and execute `replayTail` until phase becomes `cutover_pending` with
  `tail.status = caught_up`.
- Call `cutover` to move tenants to the new shard.
- If anomalies surface before cutover, call `rollback` to revert routing and
  reset state.

## Follow-up Enhancements

- Emit structured logs for each phase transition to feed observability
  pipelines.
- Persist per-table success/failure counters for detailed reporting.
- Add queue-based notification when tail replay completes to reduce manual
  polling.

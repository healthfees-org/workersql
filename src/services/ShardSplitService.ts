import { ConfigService } from './ConfigService';
import { RoutingVersionManager } from './RoutingVersionManager';
import { Logger } from './Logger';
import {
  CloudflareEnvironment,
  EdgeSQLError,
  ShardSplitMetrics,
  ShardSplitPhase,
  ShardSplitPlan,
  TablePolicy,
} from '../types';

type DualWritePhase = 'dual_write' | 'backfill' | 'tailing' | 'cutover_pending';

interface CreateSplitInput {
  sourceShard: string;
  targetShard: string;
  tenantIds: string[];
  description?: string;
}

interface AdminSplitCommand {
  splitId: string;
}

interface BackfillOptions extends AdminSplitCommand {
  ctx?: ExecutionContext;
}

const PLAN_PREFIX = 'shard_split:plan:';

export class ShardSplitService {
  private splits = new Map<string, ShardSplitPlan>();
  private logger: Logger;
  private versionManager: RoutingVersionManager;

  constructor(
    private env: CloudflareEnvironment,
    private configService: ConfigService
  ) {
    const evars = env as unknown as Record<string, unknown>;
    const envStr = typeof evars['ENVIRONMENT'] === 'string' ? (evars['ENVIRONMENT'] as string) : '';
    this.logger = new Logger({ service: 'ShardSplitService' }, { environment: envStr });
    this.versionManager = new RoutingVersionManager(env);
  }

  async initialize(): Promise<void> {
    await this.loadPlansFromKV();
  }

  async planSplit(input: CreateSplitInput): Promise<ShardSplitPlan> {
    if (!input.tenantIds.length) {
      throw new EdgeSQLError('tenantIds required for shard split', 'INVALID_SPLIT');
    }
    if (input.sourceShard === input.targetShard) {
      throw new EdgeSQLError('source and target shard must differ', 'INVALID_SPLIT');
    }

    const id = crypto.randomUUID();
    const dedupTenants = [...new Set(input.tenantIds)].sort();
    const now = Date.now();
    const currentVersion = await this.versionManager.getCurrentVersion();
    const conflictingPlan = this.listPlans().find(
      (existing) =>
        this.isPlanActive(existing) &&
        existing.tenantIds.some((tenantId) => dedupTenants.includes(tenantId))
    );
    if (conflictingPlan) {
      throw new EdgeSQLError(
        `Active split ${conflictingPlan.id} already in progress for one or more tenants`,
        'INVALID_SPLIT'
      );
    }
    const routingPolicy = await this.versionManager.getPolicyByVersion(currentVersion);
    if (!routingPolicy) {
      throw new EdgeSQLError('Current routing policy not found', 'CONFIG_LOAD_ERROR');
    }

    const mismatchedTenants = dedupTenants.filter(
      (tenantId) => routingPolicy.tenants[tenantId] !== input.sourceShard
    );
    if (mismatchedTenants.length) {
      throw new EdgeSQLError(
        `Tenants not routed to source shard ${input.sourceShard}: ${mismatchedTenants.join(', ')}`,
        'INVALID_SPLIT'
      );
    }

    const tablePolicies = structuredClone(await this.configService.getTablePolicies());

    const plan = this.normalizePlan({
      id,
      sourceShard: input.sourceShard,
      targetShard: input.targetShard,
      tenantIds: dedupTenants,
      tablePolicies,
      createdAt: now,
      updatedAt: now,
      phase: 'planning',
      routingVersionAtStart: currentVersion,
      backfill: {
        status: 'pending',
        tableCursor: {},
        totalRowsCopied: 0,
      },
      tail: {
        status: 'pending',
      },
    });

    await this.persistPlan(plan);
    this.logger.info('planned shard split', {
      id,
      source: plan.sourceShard,
      target: plan.targetShard,
    });
    return plan;
  }

  async startDualWrite({ splitId }: AdminSplitCommand): Promise<ShardSplitPlan> {
    const plan = await this.requirePlan(splitId);
    this.normalizePlan(plan);
    plan.phase = 'dual_write';
    plan.dualWriteStartedAt = Date.now();
    plan.updatedAt = Date.now();
    plan.backfill!.status = 'pending';
    delete plan.backfill!.startedAt;
    delete plan.backfill!.completedAt;
    delete plan.errorMessage;
    if (plan.tail) {
      plan.tail.status = 'pending';
      delete plan.tail.startedAt;
      delete plan.tail.completedAt;
    }
    await this.persistPlan(plan);
    this.logger.info('dual write enabled', { splitId, tenants: plan.tenantIds });
    return plan;
  }

  async runBackfill(options: BackfillOptions): Promise<ShardSplitPlan> {
    const plan = await this.requirePlan(options.splitId);
    if (!this.isDualWritePhase(plan.phase)) {
      throw new EdgeSQLError('Backfill requires dual-write phase', 'INVALID_PHASE');
    }

    this.normalizePlan(plan);
    plan.phase = 'backfill';
    plan.backfill!.status = 'running';
    plan.backfill!.startedAt = plan.backfill!.startedAt ?? Date.now();
    plan.updatedAt = Date.now();
    delete plan.errorMessage;
    await this.persistPlan(plan);

    const task = this.executeBackfill(plan.id);
    if (options.ctx) {
      options.ctx.waitUntil(
        task.catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error('backfill task execution error', {
            splitId: plan.id,
            error: message,
          });
        })
      );
    } else {
      await task;
    }

    return this.requirePlan(plan.id);
  }

  async replayTail({ splitId }: AdminSplitCommand): Promise<ShardSplitPlan> {
    const plan = await this.requirePlan(splitId);
    if (plan.phase !== 'tailing' && plan.phase !== 'backfill' && plan.phase !== 'cutover_pending') {
      throw new EdgeSQLError('Tail replay requires backfill or tailing phase', 'INVALID_PHASE');
    }
    if (!plan.dualWriteStartedAt) {
      throw new EdgeSQLError('dual write phase not initialized', 'INVALID_PHASE');
    }
    if (plan.phase === 'cutover_pending' && plan.tail?.status === 'caught_up') {
      return plan;
    }

    this.normalizePlan(plan);
    plan.tail!.status = 'replaying';
    plan.tail!.startedAt = plan.tail!.startedAt ?? Date.now();
    plan.updatedAt = Date.now();
    delete plan.errorMessage;
    await this.persistPlan(plan);

    const sourceStub = this.env.SHARD.get(this.env.SHARD.idFromName(plan.sourceShard));
    const targetStub = this.env.SHARD.get(this.env.SHARD.idFromName(plan.targetShard));
    const afterId = plan.tail!.lastEventId ?? 0;
    const EVENT_BATCH_LIMIT = 750;

    try {
      const eventsResponse = await sourceStub.fetch(
        new Request('http://do/admin/events', {
          method: 'POST',
          body: JSON.stringify({
            since: Math.max(plan.dualWriteStartedAt - 5, 0),
            afterId,
            limit: EVENT_BATCH_LIMIT,
          }),
        })
      );
      if (!eventsResponse.ok) {
        throw new EdgeSQLError('Failed to fetch tail events', 'BACKFILL_FAILED');
      }

      const payload = (await eventsResponse.json()) as {
        success: boolean;
        events?: Array<{
          id: number;
          ts: number;
          type: string;
          payload?: { tenantId?: string; sql?: string; params?: unknown[] };
        }>;
      };
      if (!payload.success) {
        throw new EdgeSQLError('Tail events payload invalid', 'BACKFILL_FAILED');
      }

      const events = (payload.events ?? []).sort((a, b) => a.id - b.id);
      let processed = 0;
      let maxEventId = afterId;

      for (const event of events) {
        if (!event) {
          continue;
        }
        if (typeof event.id !== 'number') {
          continue;
        }
        if (event.id <= maxEventId) {
          continue;
        }

        const tenantId = event.payload?.tenantId;
        if (!tenantId || !plan.tenantIds.includes(tenantId)) {
          continue;
        }

        const sql = event.payload?.sql;
        if (!sql) {
          continue;
        }

        const trimmed = sql.trim().toUpperCase();
        if (trimmed.startsWith('SELECT')) {
          continue;
        }

        const isDDL =
          trimmed.startsWith('CREATE') || trimmed.startsWith('ALTER') || trimmed.startsWith('DROP');
        const endpoint = isDDL ? 'ddl' : 'mutation';
        const response = await targetStub.fetch(
          new Request(`http://do/${endpoint}`, {
            method: 'POST',
            body: JSON.stringify({
              query: { sql, params: event.payload?.params ?? [] },
              tenantId,
            }),
          })
        );
        if (!response.ok) {
          throw new EdgeSQLError('Failed to apply tail event', 'BACKFILL_FAILED');
        }
        await response.arrayBuffer().catch(() => undefined);

        maxEventId = Math.max(maxEventId, event.id);
        plan.tail!.lastEventId = maxEventId;
        plan.tail!.lastEventTs = event.ts;
        plan.updatedAt = Date.now();
        await this.persistPlan(plan);
        await this.yieldToEventLoop();
        processed += 1;
      }

      const hasMore = events.length === EVENT_BATCH_LIMIT;
      if (!hasMore) {
        plan.tail!.status = 'caught_up';
        plan.tail!.completedAt = Date.now();
        plan.phase = 'cutover_pending';
      } else {
        plan.tail!.status = 'replaying';
      }
      plan.updatedAt = Date.now();
      await this.persistPlan(plan);
      this.logger.info('tail replay progress', {
        splitId,
        processed,
        caughtUp: !hasMore,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      plan.tail!.status = 'failed';
      plan.errorMessage = message;
      plan.updatedAt = Date.now();
      await this.persistPlan(plan);
      this.logger.error('tail replay failed', { splitId, error: message });
      throw error;
    }

    return this.requirePlan(splitId);
  }

  async cutover({ splitId }: AdminSplitCommand): Promise<ShardSplitPlan> {
    const plan = await this.requirePlan(splitId);
    if (plan.phase !== 'cutover_pending') {
      throw new EdgeSQLError('Cutover requires cutover_pending phase', 'INVALID_PHASE');
    }
    if (plan.tail?.status !== 'caught_up') {
      throw new EdgeSQLError('Tail replay must be caught up before cutover', 'INVALID_PHASE');
    }

    const currentVersion = await this.versionManager.getCurrentVersion();
    const policy = await this.versionManager.getPolicyByVersion(currentVersion);
    if (!policy) {
      throw new EdgeSQLError('Current routing policy not found', 'CONFIG_LOAD_ERROR');
    }

    const newPolicy = structuredClone(policy);
    for (const tenantId of plan.tenantIds) {
      newPolicy.tenants[tenantId] = plan.targetShard;
    }
    newPolicy.version = newPolicy.version + 1;

    plan.routingVersionCutover = await this.versionManager.updateCurrentPolicy(
      newPolicy,
      `Split ${plan.id} cutover`
    );
    plan.phase = 'completed';
    plan.updatedAt = Date.now();
    await this.persistPlan(plan);
    this.logger.info('cutover completed', { splitId, version: plan.routingVersionCutover });
    return plan;
  }

  async rollback({ splitId }: AdminSplitCommand): Promise<ShardSplitPlan> {
    const plan = await this.requirePlan(splitId);
    await this.versionManager.rollbackToVersion(plan.routingVersionAtStart);
    plan.phase = 'rolled_back';
    plan.rollbackVersion = plan.routingVersionAtStart;
    plan.updatedAt = Date.now();
    if (plan.backfill) {
      plan.backfill.status = 'pending';
      delete plan.backfill.startedAt;
      delete plan.backfill.completedAt;
    }
    if (plan.tail) {
      plan.tail.status = 'pending';
      delete plan.tail.startedAt;
      delete plan.tail.completedAt;
      delete plan.tail.lastEventId;
      delete plan.tail.lastEventTs;
    }
    delete plan.errorMessage;
    await this.persistPlan(plan);
    this.logger.warn('split rolled back', { splitId });
    return plan;
  }

  resolveReadShard(tenantId: string, primaryShard: string): string {
    for (const plan of this.splits.values()) {
      if (!this.isPlanActive(plan)) {
        continue;
      }
      if (plan.tenantIds.includes(tenantId)) {
        return plan.phase === 'completed' || plan.phase === 'cutover_pending'
          ? plan.targetShard
          : plan.sourceShard;
      }
    }
    return primaryShard;
  }

  resolveWriteShards(tenantId: string, primaryShard: string): string[] {
    for (const plan of this.splits.values()) {
      if (!this.isPlanActive(plan)) {
        continue;
      }
      if (plan.tenantIds.includes(tenantId)) {
        const shards = new Set([plan.sourceShard, plan.targetShard]);
        if (plan.phase === 'completed') {
          return [plan.targetShard];
        }
        return Array.from(shards);
      }
    }
    return [primaryShard];
  }

  listPlans(): ShardSplitPlan[] {
    return Array.from(this.splits.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  async getPlan(splitId: string): Promise<ShardSplitPlan | null> {
    try {
      return await this.requirePlan(splitId);
    } catch {
      return null;
    }
  }

  getMetrics(): ShardSplitMetrics[] {
    return this.listPlans().map((plan) => {
      const metrics: ShardSplitMetrics = {
        splitId: plan.id,
        sourceShard: plan.sourceShard,
        targetShard: plan.targetShard,
        phase: plan.phase,
        totalRowsCopied: plan.backfill?.totalRowsCopied ?? 0,
        tenants: plan.tenantIds,
        startedAt: plan.createdAt,
        updatedAt: plan.updatedAt,
      };

      if (plan.backfill?.status) {
        metrics.backfillStatus = plan.backfill.status;
      }
      if (plan.tail?.status) {
        metrics.tailStatus = plan.tail.status;
      }

      return metrics;
    });
  }

  private async executeBackfill(splitId: string): Promise<void> {
    const plan = await this.requirePlan(splitId);
    const sourceStub = this.env.SHARD.get(this.env.SHARD.idFromName(plan.sourceShard));
    const targetStub = this.env.SHARD.get(this.env.SHARD.idFromName(plan.targetShard));
    const tables = Object.entries(plan.tablePolicies) as Array<[string, TablePolicy]>;

    try {
      for (const tenantId of plan.tenantIds) {
        for (const [tableName, policy] of tables) {
          if (!policy.shardBy) {
            continue;
          }
          await this.backfillTable({
            plan,
            tenantId,
            tableName,
            policy,
            sourceStub,
            targetStub,
          });
        }
      }

      plan.phase = 'tailing';
      plan.backfill!.status = 'completed';
      plan.backfill!.completedAt = Date.now();
      if (plan.tail) {
        plan.tail.status = 'pending';
        delete plan.tail.startedAt;
        delete plan.tail.completedAt;
        delete plan.tail.lastEventId;
        delete plan.tail.lastEventTs;
      }
      plan.updatedAt = Date.now();
      await this.persistPlan(plan);
      this.logger.info('backfill complete', { splitId: plan.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      plan.backfill!.status = 'failed';
      plan.errorMessage = message;
      plan.updatedAt = Date.now();
      await this.persistPlan(plan);
      this.logger.error('backfill failed', { splitId, error: message });
      throw error;
    }
  }

  private async backfillTable(params: {
    plan: ShardSplitPlan;
    tenantId: string;
    tableName: string;
    policy: TablePolicy;
    sourceStub: DurableObjectStub;
    targetStub: DurableObjectStub;
  }): Promise<void> {
    const { plan, tenantId, tableName, policy, sourceStub, targetStub } = params;
    const cursorKey = `${tenantId}:${tableName}`;
    let cursor = plan.backfill!.tableCursor[cursorKey] ?? null;
    let hasMore = true;

    while (hasMore) {
      const response = await sourceStub.fetch(
        new Request('http://do/admin/export', {
          method: 'POST',
          body: JSON.stringify({
            table: tableName,
            tenantId,
            tenantColumn: policy.shardBy,
            cursor: cursor ? Number(cursor) : 0,
            limit: 200,
          }),
        })
      );
      if (!response.ok) {
        throw new EdgeSQLError(`Failed to export rows for ${tableName}`, 'BACKFILL_FAILED');
      }
      const payload = (await response.json()) as {
        success: boolean;
        rows?: Array<{ rowid: number; data: Record<string, unknown> }>;
        nextCursor?: number | null;
      };
      const rows = payload.rows ?? [];
      if (rows.length === 0) {
        hasMore = false;
        break;
      }

      const importRes = await targetStub.fetch(
        new Request('http://do/admin/import', {
          method: 'POST',
          body: JSON.stringify({
            table: tableName,
            rows,
            mode: 'upsert',
          }),
        })
      );
      if (!importRes.ok) {
        throw new EdgeSQLError(`Failed to import rows for ${tableName}`, 'BACKFILL_FAILED');
      }

      plan.backfill!.totalRowsCopied += rows.length;
      plan.backfill!.tableCursor[cursorKey] = rows[rows.length - 1]?.rowid.toString() ?? cursor;
      plan.updatedAt = Date.now();
      await this.persistPlan(plan);
      await this.yieldToEventLoop();

      cursor =
        payload.nextCursor !== null && payload.nextCursor !== undefined
          ? payload.nextCursor.toString()
          : null;
      hasMore = payload.nextCursor !== null && payload.nextCursor !== undefined;
    }
  }

  private async loadPlansFromKV(): Promise<void> {
    const list = await this.env.APP_CACHE.list({ prefix: PLAN_PREFIX });
    for (const key of list.keys) {
      const raw = await this.env.APP_CACHE.get(key.name, 'json');
      if (!raw) {
        continue;
      }
      const plan = this.normalizePlan(raw as ShardSplitPlan);
      this.splits.set(plan.id, plan);
    }
    this.logger.info('loaded shard split plans', { count: this.splits.size });
  }

  private async persistPlan(plan: ShardSplitPlan): Promise<void> {
    const normalized = this.normalizePlan(plan);
    this.splits.set(normalized.id, normalized);
    await this.env.APP_CACHE.put(`${PLAN_PREFIX}${normalized.id}`, JSON.stringify(normalized));
  }

  private async requirePlan(splitId: string): Promise<ShardSplitPlan> {
    const plan = this.splits.get(splitId);
    if (!plan) {
      const raw = await this.env.APP_CACHE.get(`${PLAN_PREFIX}${splitId}`, 'json');
      if (!raw) {
        throw new EdgeSQLError(`Shard split ${splitId} not found`, 'SPLIT_NOT_FOUND');
      }
      const parsed = this.normalizePlan(raw as ShardSplitPlan);
      this.splits.set(splitId, parsed);
      return parsed;
    }
    return plan;
  }

  private isPlanActive(plan: ShardSplitPlan): boolean {
    return plan.phase !== 'rolled_back' && plan.phase !== 'completed';
  }

  private isDualWritePhase(phase: ShardSplitPhase): phase is DualWritePhase {
    return (
      phase === 'dual_write' ||
      phase === 'backfill' ||
      phase === 'tailing' ||
      phase === 'cutover_pending'
    );
  }

  private normalizePlan(plan: ShardSplitPlan): ShardSplitPlan {
    if (!plan.backfill) {
      plan.backfill = { status: 'pending', tableCursor: {}, totalRowsCopied: 0 };
    } else {
      plan.backfill.status = plan.backfill.status ?? 'pending';
      plan.backfill.tableCursor = plan.backfill.tableCursor ?? {};
      plan.backfill.totalRowsCopied = plan.backfill.totalRowsCopied ?? 0;
    }

    if (!plan.tail) {
      plan.tail = { status: 'pending' };
    } else {
      plan.tail.status = plan.tail.status ?? 'pending';
    }

    return plan;
  }

  private async yieldToEventLoop(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

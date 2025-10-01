import { Logger } from './Logger';
import { RoutingVersionManager } from './RoutingVersionManager';
import {
  CloudflareEnvironment,
  RoutingPolicy,
  ShardMigrationRoutingInfo,
  ShardMigrationState,
  ShardMigrationStatus,
  ShardSplitRequest,
} from '../types';

interface ExportChunkResponse {
  success: boolean;
  rows: Array<Record<string, unknown>>;
  nextCursor?: number;
  count: number;
  table?: string;
}

interface ExportTablesResponse {
  success: boolean;
  tables: string[];
}

interface IngestResponse {
  success: boolean;
  inserted: number;
}

const MIGRATION_STATE_KEY = (id: string) => `shard:migration:state:${id}`;
const MIGRATION_TENANT_KEY = (tenantId: string) => `shard:migration:tenant:${tenantId}`;
const MIGRATION_INDEX_KEY = 'shard:migration:index';

export class ShardMigrationService {
  private env: CloudflareEnvironment;
  private versionManager: RoutingVersionManager;
  private logger: Logger;

  constructor(env: CloudflareEnvironment) {
    this.env = env;
    this.versionManager = new RoutingVersionManager(env);
    const evars = env as unknown as Record<string, unknown>;
    const envStr = typeof evars['ENVIRONMENT'] === 'string' ? (evars['ENVIRONMENT'] as string) : '';
    this.logger = new Logger({ service: 'ShardMigrationService' }, { environment: envStr });
  }

  async startSplit(request: ShardSplitRequest): Promise<ShardMigrationState> {
    if (!request.tenants.length) {
      throw new Error('At least one tenant must be provided for shard split.');
    }
    if (!request.targetShards.length) {
      throw new Error('At least one target shard must be provided.');
    }

    const migrationId = request.migrationId || `mig_${Date.now()}_${crypto.randomUUID()}`;

    // Validate no overlapping migrations
    for (const tenantId of request.tenants) {
      const tenantKey = MIGRATION_TENANT_KEY(tenantId);
      const existing = await this.env.APP_CACHE.get(tenantKey, 'text');
      if (existing) {
        throw new Error(`Tenant ${tenantId} already participating in migration ${existing}`);
      }
    }

    const currentVersion = await this.versionManager.getCurrentVersion();
    const tables = request.tables?.length ? request.tables : await this.discoverTables(request);
    const tenantAssignments = this.assignTenants(request.tenants, request.targetShards);

    const state: ShardMigrationState = {
      id: migrationId,
      sourceShard: request.sourceShard,
      targetShards: request.targetShards,
      tenants: request.tenants,
      tenantAssignments,
      tables,
      tenantColumn: request.tenantColumn || 'tenant_id',
      status: 'initializing',
      versionBefore: currentVersion,
      dualWrite: true,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      progress: {
        totalTables: tables.length * request.tenants.length,
        tablesCompleted: 0,
        backfilledRows: 0,
        cursors: {},
      },
    };

    if (request.description) {
      state.description = request.description;
    }

    await this.saveState(state);
    await this.indexMigration(state.id);

    for (const tenantId of request.tenants) {
      await this.env.APP_CACHE.put(MIGRATION_TENANT_KEY(tenantId), migrationId, {
        expirationTtl: 60 * 60 * 24,
      });
    }

    this.logger.info('Shard migration initialized', {
      migrationId,
      source: state.sourceShard,
      targets: state.targetShards,
      tenants: state.tenants,
      tables: state.tables,
    });

    return state;
  }

  async runBackfillAndCutover(migrationId: string): Promise<void> {
    const state = await this.getState(migrationId);
    if (!state) {
      throw new Error(`Migration ${migrationId} not found.`);
    }

    if (state.status === 'completed' || state.status === 'cutover_complete') {
      return;
    }

    try {
      await this.transitionState(state, 'backfill');
      await this.performBackfill(state);
      await this.transitionState(state, 'tail_sync');
      await this.promoteRouting(state);
      await this.transitionState(state, 'cutover_complete');
      await this.completeMigration(state.id);
    } catch (error) {
      this.logger.error('Migration backfill failed', {
        migrationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async getDualWriteTargets(tenantId: string, primaryShardId?: string): Promise<string[]> {
    const info = await this.getRoutingInfoForTenant(tenantId);
    if (!info || !info.active) {
      return [];
    }

    if (primaryShardId) {
      return info.dualWriteTargets.filter((id: string) => id !== primaryShardId);
    }

    return info.dualWriteTargets;
  }

  async getRoutingInfoForTenant(tenantId: string): Promise<ShardMigrationRoutingInfo | null> {
    const migrationId = await this.env.APP_CACHE.get(MIGRATION_TENANT_KEY(tenantId), 'text');
    if (!migrationId) {
      return null;
    }

    const state = await this.getState(migrationId);
    if (
      !state ||
      (state.status !== 'backfill' &&
        state.status !== 'tail_sync' &&
        state.status !== 'cutover_pending')
    ) {
      return {
        active: state ? state.dualWrite : false,
        sourceShard: state ? state.sourceShard : '',
        dualWriteTargets: [],
        status: state ? state.status : 'completed',
      };
    }

    return {
      active: state.dualWrite,
      sourceShard: state.sourceShard,
      dualWriteTargets: Array.from(new Set(Object.values(state.tenantAssignments))),
      status: state.status,
    };
  }

  async listMigrations(): Promise<ShardMigrationState[]> {
    const index = (await this.env.APP_CACHE.get(MIGRATION_INDEX_KEY, 'json')) as string[] | null;
    if (!index) {
      return [];
    }

    const states: ShardMigrationState[] = [];
    for (const id of index) {
      const state = await this.getState(id);
      if (state) {
        states.push(state);
      }
    }
    return states.sort((a, b) => b.startedAt - a.startedAt);
  }

  async completeMigration(migrationId: string): Promise<void> {
    const state = await this.getState(migrationId);
    if (!state) {
      return;
    }

    state.dualWrite = false;
    state.status = 'completed';
    state.completedAt = Date.now();
    state.updatedAt = Date.now();
    await this.saveState(state);

    for (const tenantId of state.tenants) {
      await this.env.APP_CACHE.delete(MIGRATION_TENANT_KEY(tenantId));
    }

    this.logger.info('Shard migration completed', { migrationId });
  }

  async rollbackMigration(migrationId: string): Promise<void> {
    const state = await this.getState(migrationId);
    if (!state) {
      throw new Error(`Migration ${migrationId} not found.`);
    }

    await this.versionManager.rollbackToVersion(state.versionBefore);

    // Reset routing pointers
    for (const tenantId of state.tenants) {
      await this.env.APP_CACHE.put(MIGRATION_TENANT_KEY(tenantId), state.id, {
        expirationTtl: 60 * 30,
      });
    }

    await this.transitionState(state, 'rolled_back');

    for (const tenantId of state.tenants) {
      await this.env.APP_CACHE.delete(MIGRATION_TENANT_KEY(tenantId));
    }
  }

  private async transitionState(
    state: ShardMigrationState,
    status: ShardMigrationStatus
  ): Promise<void> {
    state.status = status;
    state.updatedAt = Date.now();
    await this.saveState(state);
  }

  private async performBackfill(state: ShardMigrationState): Promise<void> {
    for (const tenantId of state.tenants) {
      if (!state.progress.cursors[tenantId]) {
        state.progress.cursors[tenantId] = {};
      }
    }

    for (const table of state.tables) {
      await this.backfillTable(state, table);
    }
  }

  private async backfillTable(state: ShardMigrationState, tableName: string): Promise<void> {
    const limit = 250;

    for (const tenantId of state.tenants) {
      let cursor = state.progress.cursors[tenantId]?.[tableName] || 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const chunk = await this.fetchExportChunk(state.sourceShard, {
          table: tableName,
          tenantId,
          cursor,
          limit,
          tenantColumn: state.tenantColumn,
        });

        if (!chunk.success) {
          throw new Error(`Export chunk failed for table ${tableName}`);
        }

        if (!chunk.rows.length) {
          break;
        }

        const targetShard = state.tenantAssignments[tenantId];
        if (!targetShard) {
          throw new Error(`No target shard assignment for tenant ${tenantId}`);
        }

        await this.ingestRows(targetShard, tableName, chunk.rows);

        cursor = chunk.nextCursor || cursor;
        state.progress.backfilledRows += chunk.rows.length;
        if (!state.progress.cursors[tenantId]) {
          state.progress.cursors[tenantId] = {};
        }
        state.progress.cursors[tenantId][tableName] = cursor;
        state.updatedAt = Date.now();
        await this.saveState(state);

        if (chunk.rows.length < limit) {
          break;
        }
      }

      state.progress.tablesCompleted += 1;
      state.updatedAt = Date.now();
      await this.saveState(state);
    }
  }

  private async promoteRouting(state: ShardMigrationState): Promise<void> {
    const currentVersion = await this.versionManager.getCurrentVersion();
    const currentPolicy =
      (await this.versionManager.getPolicyByVersion(currentVersion)) ?? this.defaultPolicy();
    const updatedPolicy: RoutingPolicy = {
      ...currentPolicy,
      tenants: { ...currentPolicy.tenants },
      version: currentPolicy.version,
    };

    for (const [tenantId, shardId] of Object.entries(state.tenantAssignments)) {
      updatedPolicy.tenants[tenantId] = shardId;
    }

    const newVersion = await this.versionManager.updateCurrentPolicy(
      updatedPolicy,
      `Shard split ${state.id}`
    );
    state.versionAfter = newVersion;
    state.status = 'cutover_pending';
    state.updatedAt = Date.now();
    await this.saveState(state);
  }

  private defaultPolicy(): RoutingPolicy {
    return {
      version: 1,
      tenants: {},
      ranges: [],
    };
  }

  private assignTenants(tenants: string[], targetShards: string[]): Record<string, string> {
    const assignments: Record<string, string> = {};
    const shardCount = targetShards.length;
    for (let i = 0; i < tenants.length; i++) {
      const shardIndex = i % shardCount;
      const shardId = targetShards[shardIndex];
      const tenantId = tenants[i];
      if (!shardId || !tenantId) {
        throw new Error('Invalid shard assignment calculated during migration.');
      }
      assignments[tenantId] = shardId;
    }
    return assignments;
  }

  private async discoverTables(request: ShardSplitRequest): Promise<string[]> {
    const response = await this.fetchExportTables(request.sourceShard);
    if (!response.success) {
      throw new Error('Failed to discover tables for migration.');
    }
    return response.tables;
  }

  private async fetchExportTables(shardId: string): Promise<ExportTablesResponse> {
    const stub = this.getShardStub(shardId);
    const res = await stub.fetch(
      new Request('http://do/migration/export', {
        method: 'POST',
        body: JSON.stringify({ action: 'listTables' }),
      })
    );
    return (await res.json()) as ExportTablesResponse;
  }

  private async fetchExportChunk(
    shardId: string,
    params: {
      table: string;
      tenantId: string;
      cursor: number;
      limit: number;
      tenantColumn: string;
    }
  ): Promise<ExportChunkResponse> {
    const stub = this.getShardStub(shardId);
    const res = await stub.fetch(
      new Request('http://do/migration/export', {
        method: 'POST',
        body: JSON.stringify({
          action: 'export',
          table: params.table,
          tenantId: params.tenantId,
          cursor: params.cursor,
          limit: params.limit,
          tenantColumn: params.tenantColumn,
        }),
      })
    );
    return (await res.json()) as ExportChunkResponse;
  }

  private async ingestRows(
    shardId: string,
    table: string,
    rows: Array<Record<string, unknown>>
  ): Promise<void> {
    const stub = this.getShardStub(shardId);
    const res = await stub.fetch(
      new Request('http://do/migration/ingest', {
        method: 'POST',
        body: JSON.stringify({ table, rows }),
      })
    );
    const data = (await res.json()) as IngestResponse;
    if (!data.success) {
      throw new Error(`Failed to ingest rows for table ${table} on shard ${shardId}`);
    }
  }

  private getShardStub(shardId: string): DurableObjectStub {
    return this.env.SHARD.get(this.env.SHARD.idFromName(shardId));
  }

  private async saveState(state: ShardMigrationState): Promise<void> {
    await this.env.APP_CACHE.put(MIGRATION_STATE_KEY(state.id), JSON.stringify(state));
  }

  private async getState(id: string): Promise<ShardMigrationState | null> {
    const stored = await this.env.APP_CACHE.get(MIGRATION_STATE_KEY(id), 'json');
    if (!stored) {
      return null;
    }
    return stored as ShardMigrationState;
  }

  private async indexMigration(id: string): Promise<void> {
    const index = (await this.env.APP_CACHE.get(MIGRATION_INDEX_KEY, 'json')) as string[] | null;
    const updated = Array.from(new Set([...(index || []), id]));
    await this.env.APP_CACHE.put(MIGRATION_INDEX_KEY, JSON.stringify(updated));
  }
}

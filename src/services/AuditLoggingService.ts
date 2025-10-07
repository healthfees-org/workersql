import { EdgeSQLError } from '../types';
import { BaseService } from './BaseService';
import type { CloudflareEnvironment, AuthContext } from '../types';
import { DataEncryptionService } from './DataEncryptionService';

/**
 * Audit log entry structure
 */
export interface AuditLogEntry {
  id: string;
  timestamp: number;
  tenantId: string;
  userId?: string;
  action: string;
  resource: string;
  method: string;
  status: 'success' | 'failure' | 'denied';
  ipAddress?: string;
  userAgent?: string;
  requestId: string;
  duration?: number;
  metadata?: Record<string, unknown>;
  errorMessage?: string;
}

/**
 * Analytics Engine dataset configuration
 */
interface AnalyticsDataset {
  name: string;
  accountId: string;
  apiToken: string;
}

/**
 * R2 audit log storage configuration
 */
interface R2AuditConfig {
  bucket: R2Bucket;
  retentionDays: number;
  maxFileSize: number; // in bytes
  compressionEnabled: boolean;
}

/**
 * Audit logging service using Cloudflare Analytics Engine and R2 storage
 * Provides comprehensive audit trails with time-based retention
 */
export class AuditLoggingService extends BaseService {
  private readonly analyticsDatasets: AnalyticsDataset[] = [];
  private r2Config?: R2AuditConfig;
  private logBuffer: AuditLogEntry[] = [];
  private readonly bufferSize = 100;
  private readonly flushInterval = 30000; // 30 seconds
  private encryption: DataEncryptionService | undefined;

  constructor(env: CloudflareEnvironment) {
    super(env);

    // Initialize Analytics Engine datasets
    this.initializeAnalyticsDatasets();

    // Initialize R2 storage if configured
    this.initializeR2Storage();

    // Initialize optional encryption
    try {
      this.encryption = new DataEncryptionService(env);
    } catch {
      this.encryption = undefined;
    }

    // Start periodic buffer flush
    this.startPeriodicFlush();
  }

  /**
   * Log an audit event
   */
  async logEvent(
    authContext: AuthContext,
    action: string,
    resource: string,
    method: string,
    status: 'success' | 'failure' | 'denied',
    metadata?: Record<string, unknown>,
    errorMessage?: string,
    duration?: number,
    request?: Request
  ): Promise<void> {
    try {
      const entryBase = {
        id: this.generateLogId(),
        timestamp: Date.now(),
        tenantId: authContext.tenantId,
        action,
        resource,
        method,
        status,
        requestId: this.generateRequestId(),
        ...(duration !== undefined ? { duration } : {}),
        ...(metadata !== undefined ? { metadata } : {}),
        ...(errorMessage !== undefined ? { errorMessage } : {}),
      } satisfies Omit<AuditLogEntry, 'userId' | 'ipAddress' | 'userAgent'>;

      const entry: AuditLogEntry = authContext.userId
        ? { ...entryBase, userId: authContext.userId }
        : (entryBase as AuditLogEntry);

      // Extract request information if available
      if (request) {
        const ip = this.extractIPAddress(request);
        if (ip && ip !== 'unknown') {
          (entry as unknown as { ipAddress?: string }).ipAddress = ip;
        }
        const ua = request.headers.get('User-Agent');
        if (ua) {
          (entry as unknown as { userAgent?: string }).userAgent = ua;
        }
      }

      // Add to buffer for batch processing
      this.logBuffer.push(entry);

      // Flush if buffer is full
      if (this.logBuffer.length >= this.bufferSize) {
        await this.flushBuffer();
      }

      // Send to Analytics Engine immediately for real-time analytics
      await this.sendToAnalyticsEngine(entry);

      this.log('info', 'Audit event logged', {
        tenantId: authContext.tenantId,
        action,
        resource,
        status,
      });
    } catch (error) {
      // Don't throw - audit logging should not break the main flow
      this.log('error', 'Failed to log audit event', {
        error: (error as Error).message,
        tenantId: authContext.tenantId,
        action,
      });
    }
  }

  /**
   * Log authentication event
   */
  async logAuthEvent(
    tenantId: string,
    userId: string | undefined,
    action: 'login' | 'logout' | 'token_refresh' | 'token_validation',
    status: 'success' | 'failure' | 'denied',
    _ipAddress?: string,
    _userAgent?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const base: AuthContext = { tenantId, permissions: [], tokenHash: '' };
    const ctx: AuthContext = userId ? { ...base, userId } : base;
    await this.logEvent(
      ctx,
      `auth.${action}`,
      'authentication',
      'POST',
      status,
      metadata,
      undefined,
      undefined,
      undefined
    );
  }

  /**
   * Log database operation
   */
  async logDatabaseOperation(
    authContext: AuthContext,
    operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE',
    tableName: string,
    status: 'success' | 'failure' | 'denied',
    rowCount?: number,
    duration?: number,
    errorMessage?: string,
    request?: Request
  ): Promise<void> {
    await this.logEvent(
      authContext,
      `db.${operation.toLowerCase()}`,
      `table.${tableName}`,
      'POST',
      status,
      { rowCount },
      errorMessage,
      duration,
      request
    );
  }

  /**
   * Query audit logs from Analytics Engine
   */
  async queryAuditLogs(
    tenantId: string,
    filters: {
      startTime?: number;
      endTime?: number;
      action?: string;
      status?: string;
      userId?: string;
      limit?: number;
    } = {}
  ): Promise<AuditLogEntry[]> {
    try {
      const query = this.buildAnalyticsQuery(tenantId, filters);
      const results = await this.executeAnalyticsQuery(query);

      return results.map(this.transformAnalyticsResult);
    } catch (error) {
      this.log('error', 'Failed to query audit logs', { error: (error as Error).message });
      return [];
    }
  }

  /**
   * Get audit summary statistics
   */
  async getAuditSummary(
    tenantId: string,
    timeRange: { start: number; end: number }
  ): Promise<{
    totalEvents: number;
    successCount: number;
    failureCount: number;
    deniedCount: number;
    topActions: Array<{ action: string; count: number }>;
    topUsers: Array<{ userId: string; count: number }>;
  }> {
    try {
      const query = `
        SELECT
          count(*) as totalEvents,
          sum(if(status = 'success', 1, 0)) as successCount,
          sum(if(status = 'failure', 1, 0)) as failureCount,
          sum(if(status = 'denied', 1, 0)) as deniedCount
        FROM audit_logs
        WHERE tenantId = '${tenantId}'
          AND timestamp >= ${timeRange.start}
          AND timestamp <= ${timeRange.end}
      `;

      const results = await this.executeAnalyticsQuery(query);

      // Additional queries for top actions and users would be implemented here
      const topActions: Array<{ action: string; count: number }> = [];
      const topUsers: Array<{ userId: string; count: number }> = [];

      const first = (results[0] || {}) as Record<string, unknown>;
      return {
        totalEvents: Number((first['totalEvents'] as number | string | undefined) ?? 0),
        successCount: Number((first['successCount'] as number | string | undefined) ?? 0),
        failureCount: Number((first['failureCount'] as number | string | undefined) ?? 0),
        deniedCount: Number((first['deniedCount'] as number | string | undefined) ?? 0),
        topActions,
        topUsers,
      };
    } catch (error) {
      this.log('error', 'Failed to get audit summary', { error: (error as Error).message });
      return {
        totalEvents: 0,
        successCount: 0,
        failureCount: 0,
        deniedCount: 0,
        topActions: [],
        topUsers: [],
      };
    }
  }

  /**
   * Export audit logs to R2 for long-term storage
   */
  async exportAuditLogs(
    tenantId: string,
    timeRange: { start: number; end: number },
    format: 'json' | 'csv' = 'json'
  ): Promise<string> {
    if (!this.r2Config) {
      throw new EdgeSQLError('R2 storage not configured for audit logs', 'AUDIT_R2_NOT_CONFIGURED');
    }

    try {
      const logs = await this.queryAuditLogs(tenantId, {
        startTime: timeRange.start,
        endTime: timeRange.end,
        limit: 10000, // Reasonable limit for export
      });

      const fileName = `audit-${tenantId}-${timeRange.start}-${timeRange.end}.${format}`;
      const fileContent =
        format === 'json' ? JSON.stringify(logs, null, 2) : this.convertToCSV(logs);

      await this.r2Config.bucket.put(fileName, fileContent, {
        httpMetadata: {
          contentType: format === 'json' ? 'application/json' : 'text/csv',
        },
      });

      // Schedule cleanup based on retention policy
      await this.scheduleLogCleanup(fileName, timeRange.end);

      return fileName;
    } catch (error) {
      this.log('error', 'Failed to export audit logs', { error: (error as Error).message });
      throw new EdgeSQLError('Audit log export failed', 'AUDIT_EXPORT_FAILED');
    }
  }

  /**
   * Clean up old audit logs from R2 based on retention policy
   */
  async cleanupOldLogs(): Promise<void> {
    if (!this.r2Config) {
      return;
    }

    try {
      const retentionCutoff = Date.now() - this.r2Config.retentionDays * 24 * 60 * 60 * 1000;
      const objects = await this.r2Config.bucket.list({
        prefix: 'audit-',
      });

      const deletePromises = objects.objects
        .filter((obj) => {
          // Extract timestamp from filename
          const timestampMatch = obj.key.match(/audit-.*-(\d+)-\d+\./);
          if (timestampMatch && timestampMatch[1]) {
            const timestamp = parseInt(timestampMatch[1] as string, 10);
            return Number.isFinite(timestamp) && timestamp < retentionCutoff;
          }
          return false;
        })
        .map((obj) => this.r2Config!.bucket.delete(obj.key));

      await Promise.all(deletePromises);

      this.log('info', 'Cleaned up old audit logs', {
        deletedCount: deletePromises.length,
        retentionDays: this.r2Config.retentionDays,
      });
    } catch (error) {
      this.log('error', 'Failed to cleanup old audit logs', { error: (error as Error).message });
    }
  }

  /**
   * Initialize Analytics Engine datasets
   */
  private initializeAnalyticsDatasets(): void {
    // Prefer dataset binding when available
    if (this.env.AUDIT_LOGS && 'writeDataPoint' in this.env.AUDIT_LOGS) {
      this.analyticsDatasets.push({
        name: 'audit_logs',
        accountId: this.env.CLOUDFLARE_ACCOUNT_ID || '',
        apiToken: this.env.CLOUDFLARE_API_TOKEN || '',
      });
      return;
    }

    if (this.env.CLOUDFLARE_ACCOUNT_ID && this.env.CLOUDFLARE_API_TOKEN) {
      this.analyticsDatasets.push({
        name: 'audit_logs',
        accountId: this.env.CLOUDFLARE_ACCOUNT_ID,
        apiToken: this.env.CLOUDFLARE_API_TOKEN,
      });
    }
  }

  /**
   * Initialize R2 storage for audit logs
   */
  private initializeR2Storage(): void {
    // R2 binding would be added to the environment
    const auditBucket = this.env.AUDIT_LOGS_BUCKET as R2Bucket | undefined;

    if (auditBucket) {
      this.r2Config = {
        bucket: auditBucket,
        retentionDays: parseInt(this.env.AUDIT_RETENTION_DAYS || '90'),
        maxFileSize: 10 * 1024 * 1024, // 10MB
        compressionEnabled: true,
      };
    }
  }

  /**
   * Send audit entry to Analytics Engine
   */
  private async sendToAnalyticsEngine(entry: AuditLogEntry): Promise<void> {
    // If dataset binding exists, use it for write
    const binding = this.env.AUDIT_LOGS;
    if (binding && 'writeDataPoint' in binding) {
      try {
        type AEDP = Parameters<AnalyticsEngineDataset['writeDataPoint']>[0];
        const point: AEDP = {
          indexes: [entry.tenantId, entry.userId ?? '', entry.action, entry.status],
          blobs: [
            entry.resource,
            entry.method,
            entry.ipAddress ?? '',
            entry.userAgent ?? '',
            entry.requestId,
            entry.errorMessage ?? '',
          ],
          doubles: [Number(entry.duration ?? 0)],
          timestamps: [new Date(entry.timestamp)],
        } as AEDP;
        binding.writeDataPoint(point);
        return;
      } catch (e) {
        this.log('warn', 'AE binding write failed, falling back to SQL API', {
          error: (e as Error).message,
        });
      }
    }

    // Fallback to SQL API
    if (this.analyticsDatasets.length === 0) {
      return;
    }
    const dataset = this.analyticsDatasets[0]!;
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${dataset.accountId}/analytics_engine/sql`;
    const query = `
      INSERT INTO ${dataset.name} (
        _timestamp, tenantId, userId, action, resource, method, status,
        ipAddress, userAgent, requestId, duration, errorMessage
      ) VALUES (
        ${entry.timestamp}, '${entry.tenantId}', '${entry.userId || ''}',
        '${entry.action}', '${entry.resource}', '${entry.method}', '${entry.status}',
        '${entry.ipAddress || ''}', '${entry.userAgent || ''}', '${entry.requestId}',
        ${entry.duration || 0}, '${entry.errorMessage || ''}'
      )
    `;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${dataset.apiToken}`,
          'Content-Type': 'text/plain',
        },
        body: query,
      });
      if (!response.ok) {
        throw new Error(`Analytics Engine API error: ${response.status}`);
      }
    } catch (error) {
      this.log('warn', 'Failed to send to Analytics Engine', { error: (error as Error).message });
    }
  }

  /**
   * Flush buffered log entries
   */
  private async flushBuffer(): Promise<void> {
    if (this.logBuffer.length === 0) {
      return;
    }

    const entries = [...this.logBuffer];
    this.logBuffer = [];

    // Send all entries to Analytics Engine
    await Promise.all(entries.map((entry) => this.sendToAnalyticsEngine(entry)));

    // Persist to R2 if configured and buffer is large
    if (this.r2Config && entries.length >= this.bufferSize) {
      await this.persistBufferToR2(entries);
    }
  }

  /**
   * Persist buffer to R2 storage
   */
  private async persistBufferToR2(entries: AuditLogEntry[]): Promise<void> {
    if (!this.r2Config) {
      return;
    }

    try {
      const timestamp = Date.now();
      const fileName = `audit-buffer-${timestamp}.json${this.encryption?.isEnabled() ? '.enc' : ''}`;

      let content = JSON.stringify(entries);
      if (this.r2Config.compressionEnabled) {
        // Compression placeholder
        content = JSON.stringify(entries);
      }
      // Optional encryption
      let body: string | Uint8Array = content;
      if (this.encryption?.isEnabled()) {
        const enc = await this.encryption.encryptData(content);
        body = JSON.stringify(enc);
      }

      await this.r2Config.bucket.put(fileName, body, {
        httpMetadata: {
          contentType: this.encryption?.isEnabled()
            ? 'application/octet-stream'
            : 'application/json',
        },
      });

      // Schedule cleanup
      await this.scheduleLogCleanup(fileName, timestamp);
    } catch (error) {
      this.log('error', 'Failed to persist buffer to R2', { error: (error as Error).message });
    }
  }

  /**
   * Schedule cleanup of log files
   */
  private async scheduleLogCleanup(fileName: string, timestamp: number): Promise<void> {
    if (!this.r2Config) {
      return;
    }

    const cleanupTime = timestamp + this.r2Config.retentionDays * 24 * 60 * 60 * 1000;

    // In a real implementation, this would use a queue or scheduled job
    // For now, we'll just log the cleanup schedule
    this.log('info', 'Scheduled log cleanup', {
      fileName,
      cleanupTime: new Date(cleanupTime).toISOString(),
    });
  }

  /**
   * Start periodic buffer flush
   */
  private startPeriodicFlush(): void {
    setInterval(() => {
      this.flushBuffer().catch((error) => {
        this.log('error', 'Periodic buffer flush failed', { error: (error as Error).message });
      });
    }, this.flushInterval);
  }

  /**
   * Build Analytics Engine query
   */
  private buildAnalyticsQuery(
    tenantId: string,
    filters: {
      startTime?: number;
      endTime?: number;
      action?: string;
      status?: string;
      userId?: string;
      limit?: number;
    }
  ): string {
    let query = `
      SELECT * FROM audit_logs
      WHERE tenantId = '${tenantId}'
    `;

    if (filters.startTime) {
      query += ` AND _timestamp >= ${filters.startTime}`;
    }
    if (filters.endTime) {
      query += ` AND _timestamp <= ${filters.endTime}`;
    }
    if (filters.action) {
      query += ` AND action = '${filters.action}'`;
    }
    if (filters.status) {
      query += ` AND status = '${filters.status}'`;
    }
    if (filters.userId) {
      query += ` AND userId = '${filters.userId}'`;
    }

    query += ` ORDER BY _timestamp DESC`;

    if (filters.limit) {
      query += ` LIMIT ${filters.limit}`;
    }

    return query;
  }

  /**
   * Execute Analytics Engine query
   */
  private async executeAnalyticsQuery(query: string): Promise<Record<string, unknown>[]> {
    if (this.analyticsDatasets.length === 0) {
      return [];
    }

    const dataset = this.analyticsDatasets[0]!;
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${dataset.accountId}/analytics_engine/sql`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${dataset.apiToken}`,
        'Content-Type': 'text/plain',
      },
      body: query,
    });

    if (!response.ok) {
      throw new Error(`Analytics query failed: ${response.status}`);
    }

    const result = (await response.json().catch(() => ({}))) as unknown;
    if (result && typeof result === 'object' && 'data' in result) {
      const data = (result as { data?: unknown }).data;
      if (Array.isArray(data)) {
        return data as Record<string, unknown>[];
      }
    }
    return [];
  }

  /**
   * Transform Analytics Engine result to AuditLogEntry
   */
  private transformAnalyticsResult(result: Record<string, unknown>): AuditLogEntry {
    return {
      id: (result['id'] as string) || this.generateLogId(),
      timestamp: (result['_timestamp'] as number) || Date.now(),
      tenantId: String(result['tenantId'] ?? ''),
      ...(result['userId'] ? { userId: String(result['userId']) } : {}),
      action: String(result['action'] ?? ''),
      resource: String(result['resource'] ?? ''),
      method: String(result['method'] ?? ''),
      status: String(result['status'] ?? 'success') as 'success' | 'failure' | 'denied',
      ...(result['ipAddress'] ? { ipAddress: String(result['ipAddress']) } : {}),
      ...(result['userAgent'] ? { userAgent: String(result['userAgent']) } : {}),
      requestId: String(result['requestId'] ?? ''),
      ...(result['duration'] ? { duration: Number(result['duration']) } : {}),
      metadata:
        typeof result['metadata'] === 'string'
          ? (() => {
              try {
                return JSON.parse(result['metadata'] as string) as Record<string, unknown>;
              } catch {
                return {} as Record<string, unknown>;
              }
            })()
          : ((result['metadata'] as Record<string, unknown> | undefined) ?? {}),
      ...(result['errorMessage'] ? { errorMessage: String(result['errorMessage']) } : {}),
    };
  }

  /**
   * Convert audit logs to CSV format
   */
  private convertToCSV(logs: AuditLogEntry[]): string {
    const headers = [
      'id',
      'timestamp',
      'tenantId',
      'userId',
      'action',
      'resource',
      'method',
      'status',
      'ipAddress',
      'userAgent',
      'requestId',
      'duration',
      'errorMessage',
    ];

    const rows = logs.map((log) => [
      log.id,
      log.timestamp,
      log.tenantId,
      log.userId || '',
      log.action,
      log.resource,
      log.method,
      log.status,
      log.ipAddress || '',
      log.userAgent || '',
      log.requestId,
      log.duration || '',
      log.errorMessage || '',
    ]);

    return [headers, ...rows].map((row) => row.map((field) => `"${field}"`).join(',')).join('\n');
  }

  /**
   * Extract IP address from request
   */
  private extractIPAddress(request: Request): string {
    // Try CF-Connecting-IP first (Cloudflare specific)
    const cfIP = request.headers.get('CF-Connecting-IP');
    if (cfIP) {
      return cfIP;
    }

    // Try X-Forwarded-For
    const forwardedFor = request.headers.get('X-Forwarded-For');
    if (forwardedFor) {
      const first = forwardedFor.split(',')[0];
      return (first ?? '').trim();
    }

    // Fallback to remote address (not available in Workers)
    return 'unknown';
  }

  /**
   * Generate unique log ID
   */
  private generateLogId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate request ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

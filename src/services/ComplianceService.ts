import { BaseService } from './BaseService';
import type { CloudflareEnvironment } from '../types';

export interface ComplianceReportOptions {
  tenantId: string;
  since: number; // epoch ms
  until: number; // epoch ms
}

export interface ComplianceReportSummary {
  tenantId: string;
  window: { since: number; until: number };
  totals: {
    events: number;
    success: number;
    failure: number;
    denied: number;
  };
}

/**
 * Generates compliance-focused summaries based on audit logs
 * stored in Workers Analytics Engine (via SQL API) or dataset binding.
 */
export class ComplianceService extends BaseService {
  private readonly dataset = 'audit_logs';

  constructor(env: CloudflareEnvironment) {
    super(env);
  }

  async generateSummary(opts: ComplianceReportOptions): Promise<ComplianceReportSummary> {
    const { tenantId, since, until } = opts;
    // Prefer SQL API due to flexible aggregation
    const query = `
      SELECT
        count() AS events,
        sum(if(status = 'success', 1, 0)) AS success,
        sum(if(status = 'failure', 1, 0)) AS failure,
        sum(if(status = 'denied', 1, 0)) AS denied
      FROM ${this.dataset}
      WHERE tenantId = '${tenantId}'
        AND _timestamp >= ${since}
        AND _timestamp <= ${until}
    `;

    const data = await this.executeAnalyticsQuery(query);
    const row = (data[0] || {
      events: 0,
      success: 0,
      failure: 0,
      denied: 0,
    }) as Record<string, unknown>;
    return {
      tenantId,
      window: { since, until },
      totals: {
        events: Number((row['events'] as number | string | undefined) ?? 0),
        success: Number((row['success'] as number | string | undefined) ?? 0),
        failure: Number((row['failure'] as number | string | undefined) ?? 0),
        denied: Number((row['denied'] as number | string | undefined) ?? 0),
      },
    };
  }

  private async executeAnalyticsQuery(
    query: string
  ): Promise<Record<string, string | number | boolean | null>[]> {
    const accountId = this.env.CLOUDFLARE_ACCOUNT_ID;
    const token = this.env.CLOUDFLARE_API_TOKEN;
    if (!accountId || !token) {
      return [];
    }
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/plain',
        Accept: 'application/json',
      },
      body: query,
    });
    if (!res.ok) {
      return [];
    }
    const json = (await res.json().catch(() => ({}))) as unknown;
    if (json && typeof json === 'object' && 'data' in json) {
      const data = (json as { data?: unknown }).data;
      if (Array.isArray(data)) {
        return data as Record<string, string | number | boolean | null>[];
      }
    }
    return [];
  }
}

export interface SessionInfo {
  tenantId: string;
  shardId: string;
  lastSeen: number;
}

export class ConnectionManager {
  private sessions = new Map<string, SessionInfo>(); // sessionId -> info
  private shardConnectionCounts = new Map<string, number>();

  constructor(private ttlMs: number = 10 * 60 * 1000) {}

  // Sticky session: map sessionId to shardId
  bindSession(sessionId: string, tenantId: string, shardId: string): void {
    this.sessions.set(sessionId, { tenantId, shardId, lastSeen: Date.now() });
    this.shardConnectionCounts.set(shardId, (this.shardConnectionCounts.get(shardId) || 0) + 1);
  }

  getSession(sessionId: string): SessionInfo | undefined {
    const info = this.sessions.get(sessionId);
    if (info) info.lastSeen = Date.now();
    return info;
  }

  releaseSession(sessionId: string): void {
    const info = this.sessions.get(sessionId);
    if (!info) return;
    this.sessions.delete(sessionId);
    this.shardConnectionCounts.set(
      info.shardId,
      Math.max(0, (this.shardConnectionCounts.get(info.shardId) || 1) - 1)
    );
  }

  getShardConnections(shardId: string): number {
    return this.shardConnectionCounts.get(shardId) || 0;
  }

  // Cleanup stale sessions
  cleanup(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, info] of this.sessions.entries()) {
      if (info.lastSeen < cutoff) {
        this.releaseSession(id);
      }
    }
  }
}

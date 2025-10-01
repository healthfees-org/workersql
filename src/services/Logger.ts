type LogLevel = 'info' | 'warn' | 'error';

export interface LoggerContext {
  service?: string;
  shardId?: string;
  tenantId?: string;
}

export class Logger {
  private ctx: LoggerContext;
  private readonly isDev: boolean;

  constructor(ctx: LoggerContext = {}, options?: { environment?: string }) {
    this.ctx = ctx;
    this.isDev = (options?.environment || '').toLowerCase() === 'development';
  }

  info(message: string, data?: Record<string, unknown>) {
    this.emit('info', message, data);
  }

  warn(message: string, data?: Record<string, unknown>) {
    this.emit('warn', message, data);
  }

  error(message: string, data?: Record<string, unknown>) {
    this.emit('error', message, data);
  }

  private emit(level: LogLevel, message: string, data?: Record<string, unknown>) {
    // No console logging outside local development per policy
    if (!this.isDev) {
      return;
    }
    const entry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...this.ctx,
      ...this.redact(data || {}),
    };
    const line = JSON.stringify(entry);
    if (level === 'error') {
      // eslint-disable-next-line no-console
      console.error(line);
    } else if (level === 'warn') {
      // eslint-disable-next-line no-console
      console.warn(line);
    } else {
      // eslint-disable-next-line no-console
      console.log(line);
    }
  }

  //@TODO @FLAG -- this is simplistic, there might be a better utility for this
  private redact(obj: Record<string, unknown>): Record<string, unknown> {
    const redacted: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (/token|secret|password|authorization/i.test(k)) {
        redacted[k] = '[REDACTED]';
      } else {
        redacted[k] = v;
      }
    }
    return redacted;
  }
}

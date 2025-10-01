/**
 * DSN Parser for WorkerSQL
 * Parses connection strings in the format:
 * workersql://[username[:password]@]host[:port][/database][?param1=value1&param2=value2]
 */

export interface ParsedDSN {
  protocol: string;
  username?: string;
  password?: string;
  host: string;
  port?: number;
  database?: string;
  params: Record<string, string>;
}

export class DSNParser {
  /**
   * Parse a WorkerSQL DSN string
   * @param dsn Connection string to parse
   * @returns Parsed DSN components
   */
  static parse(dsn: string): ParsedDSN {
    if (!dsn || typeof dsn !== 'string') {
      throw new Error('DSN must be a non-empty string');
    }

    // Match the DSN pattern
    const dsnRegex = /^([a-z]+):\/\/(?:([^:@]+)(?::([^@]+))?@)?([^/:?]+)(?::(\d+))?(?:\/([^?]+))?(?:\?(.+))?$/i;
    const match = dsn.match(dsnRegex);

    if (!match) {
      throw new Error(`Invalid DSN format: ${dsn}`);
    }

    const [, protocol, username, password, host, portStr, database, queryString] = match;

    // Validate protocol
    if (!protocol || protocol.toLowerCase() !== 'workersql') {
      throw new Error(`Invalid protocol: ${protocol || 'missing'}. Expected 'workersql'`);
    }

    if (!host) {
      throw new Error('Host is required in DSN');
    }

    // Parse port
    const port = portStr ? parseInt(portStr, 10) : undefined;
    if (port !== undefined && (isNaN(port) || port < 1 || port > 65535)) {
      throw new Error(`Invalid port: ${portStr}`);
    }

    // Parse query parameters
    const params: Record<string, string> = {};
    if (queryString) {
      const pairs = queryString.split('&');
      for (const pair of pairs) {
        const [key, value] = pair.split('=');
        if (key) {
          params[decodeURIComponent(key)] = value ? decodeURIComponent(value) : '';
        }
      }
    }

    return {
      protocol,
      username: username ? decodeURIComponent(username) : undefined,
      password: password ? decodeURIComponent(password) : undefined,
      host: decodeURIComponent(host),
      port,
      database: database ? decodeURIComponent(database) : undefined,
      params,
    };
  }

  /**
   * Convert parsed DSN back to string format
   * @param parsed Parsed DSN components
   * @returns DSN string
   */
  static stringify(parsed: ParsedDSN): string {
    let dsn = `${parsed.protocol}://`;

    if (parsed.username) {
      dsn += encodeURIComponent(parsed.username);
      if (parsed.password) {
        dsn += `:${encodeURIComponent(parsed.password)}`;
      }
      dsn += '@';
    }

    dsn += encodeURIComponent(parsed.host);

    if (parsed.port) {
      dsn += `:${parsed.port}`;
    }

    if (parsed.database) {
      dsn += `/${encodeURIComponent(parsed.database)}`;
    }

    if (Object.keys(parsed.params).length > 0) {
      const queryString = Object.entries(parsed.params)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
      dsn += `?${queryString}`;
    }

    return dsn;
  }

  /**
   * Extract API endpoint from DSN parameters or construct from host
   * @param parsed Parsed DSN components
   * @returns API endpoint URL
   */
  static getApiEndpoint(parsed: ParsedDSN): string {
    // Check if apiEndpoint is specified in params
    if (parsed.params['apiEndpoint']) {
      return parsed.params['apiEndpoint'];
    }

    // Construct from host
    const protocol = parsed.params['ssl'] === 'false' ? 'http' : 'https';
    const port = parsed.port ? `:${parsed.port}` : '';
    return `${protocol}://${parsed.host}${port}/v1`;
  }
}

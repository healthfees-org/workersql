/**
 * Tests for DSN Parser
 */

import { describe, it, expect } from '@jest/globals';
import { DSNParser } from '../src/dsn-parser.js';

describe('DSNParser', () => {
  describe('parse', () => {
    it('should parse basic DSN', () => {
      const dsn = 'workersql://api.workersql.com/mydb';
      const parsed = DSNParser.parse(dsn);

      expect(parsed.protocol).toBe('workersql');
      expect(parsed.host).toBe('api.workersql.com');
      expect(parsed.database).toBe('mydb');
      expect(parsed.port).toBeUndefined();
      expect(parsed.username).toBeUndefined();
      expect(parsed.password).toBeUndefined();
    });

    it('should parse DSN with credentials', () => {
      const dsn = 'workersql://user:pass@api.workersql.com/mydb';
      const parsed = DSNParser.parse(dsn);

      expect(parsed.username).toBe('user');
      expect(parsed.password).toBe('pass');
      expect(parsed.host).toBe('api.workersql.com');
      expect(parsed.database).toBe('mydb');
    });

    it('should parse DSN with port', () => {
      const dsn = 'workersql://api.workersql.com:8787/mydb';
      const parsed = DSNParser.parse(dsn);

      expect(parsed.host).toBe('api.workersql.com');
      expect(parsed.port).toBe(8787);
      expect(parsed.database).toBe('mydb');
    });

    it('should parse DSN with query parameters', () => {
      const dsn = 'workersql://api.workersql.com/mydb?apiKey=abc123&ssl=false&timeout=5000';
      const parsed = DSNParser.parse(dsn);

      expect(parsed.params['apiKey']).toBe('abc123');
      expect(parsed.params['ssl']).toBe('false');
      expect(parsed.params['timeout']).toBe('5000');
    });

    it('should parse DSN with special characters in credentials', () => {
      const dsn = 'workersql://user%40name:p%40ss%3Aword@api.workersql.com/mydb';
      const parsed = DSNParser.parse(dsn);

      expect(parsed.username).toBe('user@name');
      expect(parsed.password).toBe('p@ss:word');
    });

    it('should parse DSN without database', () => {
      const dsn = 'workersql://api.workersql.com';
      const parsed = DSNParser.parse(dsn);

      expect(parsed.host).toBe('api.workersql.com');
      expect(parsed.database).toBeUndefined();
    });

    it('should throw error for invalid protocol', () => {
      const dsn = 'mysql://api.workersql.com/mydb';
      expect(() => DSNParser.parse(dsn)).toThrow('Invalid protocol');
    });

    it('should throw error for empty DSN', () => {
      expect(() => DSNParser.parse('')).toThrow('DSN must be a non-empty string');
    });

    it('should throw error for malformed DSN', () => {
      const dsn = 'not-a-valid-url';
      expect(() => DSNParser.parse(dsn)).toThrow();
    });

    it('should throw error for DSN without host', () => {
      const dsn = 'workersql:///mydb';
      expect(() => DSNParser.parse(dsn)).toThrow('Host is required');
    });
  });

  describe('getApiEndpoint', () => {
    it('should construct HTTPS endpoint by default', () => {
      const parsed = DSNParser.parse('workersql://api.workersql.com/mydb');
      const endpoint = DSNParser.getApiEndpoint(parsed);

      expect(endpoint).toBe('https://api.workersql.com/v1');
    });

    it('should construct HTTP endpoint when ssl=false', () => {
      const parsed = DSNParser.parse('workersql://api.workersql.com/mydb?ssl=false');
      const endpoint = DSNParser.getApiEndpoint(parsed);

      expect(endpoint).toBe('http://api.workersql.com/v1');
    });

    it('should include port in endpoint', () => {
      const parsed = DSNParser.parse('workersql://api.workersql.com:8787/mydb');
      const endpoint = DSNParser.getApiEndpoint(parsed);

      expect(endpoint).toBe('https://api.workersql.com:8787/v1');
    });

    it('should use provided apiEndpoint parameter', () => {
      const parsed = DSNParser.parse('workersql://api.workersql.com/mydb?apiEndpoint=https://custom.endpoint.com/api');
      const endpoint = DSNParser.getApiEndpoint(parsed);

      expect(endpoint).toBe('https://custom.endpoint.com/api');
    });
  });

  describe('stringify', () => {
    it('should convert parsed DSN back to string', () => {
      const original = 'workersql://user:pass@api.workersql.com:443/mydb?apiKey=abc123';
      const parsed = DSNParser.parse(original);
      const stringified = DSNParser.stringify(parsed);

      // Parse both to compare structure (order may differ)
      const reparsed = DSNParser.parse(stringified);
      expect(reparsed.protocol).toBe(parsed.protocol);
      expect(reparsed.username).toBe(parsed.username);
      expect(reparsed.password).toBe(parsed.password);
      expect(reparsed.host).toBe(parsed.host);
      expect(reparsed.port).toBe(parsed.port);
      expect(reparsed.database).toBe(parsed.database);
    });

    it('should handle special characters in credentials', () => {
      const parsed = {
        protocol: 'workersql',
        username: 'user@name',
        password: 'p@ss:word',
        host: 'api.workersql.com',
        port: undefined,
        database: 'mydb',
        params: {},
      };
      const stringified = DSNParser.stringify(parsed);

      expect(stringified).toContain('user%40name');
      expect(stringified).toContain('p%40ss%3Aword');
    });
  });
});

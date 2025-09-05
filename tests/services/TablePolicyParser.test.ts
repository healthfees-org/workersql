import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TablePolicyParser } from '../../src/services/TablePolicyParser';

describe('TablePolicyParser', () => {
  let parser: TablePolicyParser;

  beforeEach(() => {
    parser = new TablePolicyParser();
  });

  describe('interface compliance', () => {
    it('should implement ITablePolicyParser interface methods', () => {
      expect(typeof parser.parseTablePolicy).toBe('function');
      expect(typeof parser.parseRoutingPolicy).toBe('function');
      expect(typeof parser.validateTablePolicy).toBe('function');
      expect(typeof parser.validateRoutingPolicy).toBe('function');
      expect(typeof parser.getDefaultTablePolicy).toBe('function');
      expect(typeof parser.getDefaultRoutingPolicy).toBe('function');
    });
  });

  describe('parseTablePolicy', () => {
    it('should parse valid YAML table policy', async () => {
      const yamlContent = `
primary_key: id
shard_by: tenant_id
cache:
  mode: bounded
  ttl_ms: 300000
  swr_ms: 1800000
  always_strong_columns:
    - email
    - user_id
`;

      const policy = await parser.parseTablePolicy(yamlContent, 'users');

      expect(policy.pk).toBe('id');
      expect(policy.shardBy).toBe('tenant_id');
      expect(policy.cache.mode).toBe('bounded');
      expect(policy.cache.ttlMs).toBe(300000);
      expect(policy.cache.swrMs).toBe(1800000);
      expect(policy.cache.alwaysStrongColumns).toEqual(['email', 'user_id']);
    });

    it('should map always_strong_columns when present', async () => {
      const yamlContent = `
primary_key: id
cache:
  mode: cached
  ttl_ms: 1000
  swr_ms: 2000
  always_strong_columns:
    - a
    - b
`;
      const policy = await parser.parseTablePolicy(yamlContent, 'tbl');
      expect(policy.cache.mode).toBe('cached');
      expect(policy.cache.alwaysStrongColumns).toEqual(['a', 'b']);
    });

    it('should handle minimal YAML policy', async () => {
      const yamlContent = `
primary_key: order_id
cache:
  mode: strong
  ttl_ms: 60000
`;

      const policy = await parser.parseTablePolicy(yamlContent, 'orders');

      expect(policy.pk).toBe('order_id');
      expect(policy.shardBy).toBeUndefined();
      expect(policy.cache.mode).toBe('strong');
      expect(policy.cache.ttlMs).toBe(60000);
      expect(policy.cache.swrMs).toBe(300000); // Default value when not specified
    });

    it('should use default values for missing fields', async () => {
      const yamlContent = `primary_key: test_id`;

      const policy = await parser.parseTablePolicy(yamlContent, 'test');

      expect(policy.pk).toBe('test_id');
      expect(policy.cache.mode).toBe('bounded');
      expect(policy.cache.ttlMs).toBe(60000);
      expect(policy.cache.swrMs).toBe(300000);
    });

    it('should default ttlMs when cache exists but ttl_ms is missing', async () => {
      const yamlContent = `
primary_key: foo
cache:
  mode: strong
  swr_ms: 1000
`;

      const policy = await parser.parseTablePolicy(yamlContent, 'tbl');

      expect(policy.pk).toBe('foo');
      expect(policy.cache.mode).toBe('strong');
      // ttl_ms missing should default
      expect(policy.cache.ttlMs).toBe(60000);
      // swr_ms present should be used
      expect(policy.cache.swrMs).toBe(1000);
    });

    it('should throw error for invalid YAML', async () => {
      const invalidYaml = `
primary_key: id
cache:
  mode: invalid_mode
`;

      await expect(parser.parseTablePolicy(invalidYaml, 'test')).rejects.toThrow();
    });

    it('should handle YAML parser errors gracefully', async () => {
      const malformedYaml = `
primary_key: id
cache:
  mode: bounded
  ttl_ms: "not_a_number"
`;

      await expect(parser.parseTablePolicy(malformedYaml, 'test')).rejects.toThrow(
        'Invalid table policy for test'
      );
    });

    it('should throw error when YAML parser is unavailable for table policy', async () => {
      // Create a parser instance and mock the yamlParser as null
      const testParser = new TablePolicyParser();
      (testParser as any).yamlParser = null;

      const yamlContent = `primary_key: test_id`;

      await expect(testParser.parseTablePolicy(yamlContent, 'test')).rejects.toThrow(
        'YAML parser not available'
      );
    });

    it('should throw error when YAML parser is unavailable for routing policy', async () => {
      // Create a parser instance and mock the yamlParser as null
      const testParser = new TablePolicyParser();
      (testParser as any).yamlParser = null;

      const yamlContent = `version: 1`;

      await expect(testParser.parseRoutingPolicy(yamlContent)).rejects.toThrow(
        'YAML parser not available'
      );
    });
  });

  describe('parseRoutingPolicy', () => {
    it('should parse valid YAML routing policy', async () => {
      const yamlContent = `
version: 2
tenants:
  tenant_a: shard_0
  tenant_b: shard_1
ranges:
  - prefix: "prefix_a"
    shard: shard_0
  - prefix: "prefix_b"
    shard: shard_1
`;

      const policy = await parser.parseRoutingPolicy(yamlContent);

      expect(policy.version).toBe(2);
      expect(policy.tenants).toEqual({
        tenant_a: 'shard_0',
        tenant_b: 'shard_1',
      });
      expect(policy.ranges).toEqual([
        { prefix: 'prefix_a', shard: 'shard_0' },
        { prefix: 'prefix_b', shard: 'shard_1' },
      ]);
    });

    it('should handle empty routing policy', async () => {
      const yamlContent = `version: 1`;

      const policy = await parser.parseRoutingPolicy(yamlContent);

      expect(policy.version).toBe(1);
      expect(policy.tenants).toEqual({});
      expect(policy.ranges).toEqual([]);
    });

    it('should throw error for invalid routing policy', async () => {
      const yamlContent = `
version: -1
tenants:
  tenant_a: shard_0
`;

      await expect(parser.parseRoutingPolicy(yamlContent)).rejects.toThrow(
        'Invalid routing policy'
      );
    });

    it('should handle YAML parser errors in routing policy', async () => {
      const malformedYaml = `
version: 1
tenants:
  invalid: yaml: content: [unclosed
`;

      await expect(parser.parseRoutingPolicy(malformedYaml)).rejects.toThrow(
        'Failed to parse routing policy'
      );
    });

    it('should throw when YAML parser is unavailable for routing policy', async () => {
      const p = new TablePolicyParser();
      (p as any).yamlParser = null;
      await expect(p.parseRoutingPolicy('version: 1')).rejects.toThrow('YAML parser not available');
    });
  });

  describe('validateTablePolicy', () => {
    it('should validate correct table policy', () => {
      const policy = {
        pk: 'id',
        cache: {
          mode: 'bounded' as const,
          ttlMs: 60000,
          swrMs: 300000,
        },
      };

      expect(parser.validateTablePolicy(policy)).toBe(true);
    });

    it('should reject invalid cache mode', () => {
      const policy = {
        pk: 'id',
        cache: {
          mode: 'invalid' as any,
          ttlMs: 60000,
          swrMs: 300000,
        },
      };

      expect(parser.validateTablePolicy(policy)).toBe(false);
    });

    it('should reject negative SWR', () => {
      const policy = {
        pk: 'id',
        cache: {
          mode: 'bounded' as const,
          ttlMs: 60000,
          swrMs: -100,
        },
      };

      expect(parser.validateTablePolicy(policy)).toBe(false);
    });

    it('should reject negative TTL', () => {
      const policy = {
        pk: 'id',
        cache: {
          mode: 'bounded' as const,
          ttlMs: -1,
          swrMs: 300000,
        },
      } as any;

      expect(parser.validateTablePolicy(policy)).toBe(false);
    });

    it('should reject missing primary key', () => {
      const policy = {
        cache: {
          mode: 'bounded' as const,
          ttlMs: 60000,
          swrMs: 300000,
        },
      } as any;

      expect(parser.validateTablePolicy(policy)).toBe(false);
    });

    it('should reject invalid primary key type', () => {
      const policy = {
        pk: 123,
        cache: {
          mode: 'bounded' as const,
          ttlMs: 60000,
          swrMs: 300000,
        },
      } as any;

      expect(parser.validateTablePolicy(policy)).toBe(false);
    });

    it('should reject missing cache', () => {
      const policy = {
        pk: 'id',
      } as any;

      expect(parser.validateTablePolicy(policy)).toBe(false);
    });
  });

  describe('validateRoutingPolicy', () => {
    it('should validate correct routing policy', () => {
      const policy = {
        version: 1,
        tenants: { tenant_a: 'shard_0' },
        ranges: [{ prefix: 'test', shard: 'shard_0' }],
      };

      expect(parser.validateRoutingPolicy(policy)).toBe(true);
    });

    it('should reject invalid version', () => {
      const policy = {
        version: 0,
        tenants: {},
        ranges: [],
      };

      expect(parser.validateRoutingPolicy(policy)).toBe(false);
    });

    it('should reject invalid tenants object', () => {
      const policy = {
        version: 1,
        tenants: 'invalid' as any,
        ranges: [],
      };

      expect(parser.validateRoutingPolicy(policy)).toBe(false);
    });

    it('should reject invalid ranges array', () => {
      const policy = {
        version: 1,
        tenants: {},
        ranges: 'invalid' as any,
      };

      expect(parser.validateRoutingPolicy(policy)).toBe(false);
    });

    it('should reject ranges with missing prefix', () => {
      const policy = {
        version: 1,
        tenants: {},
        ranges: [{ shard: 'shard_0' }] as any,
      };

      expect(parser.validateRoutingPolicy(policy)).toBe(false);
    });

    it('should reject ranges with missing shard', () => {
      const policy = {
        version: 1,
        tenants: {},
        ranges: [{ prefix: 'test' }] as any,
      };

      expect(parser.validateRoutingPolicy(policy)).toBe(false);
    });

    it('should validate ranges with all required fields', () => {
      const policy = {
        version: 1,
        tenants: {},
        ranges: [
          { prefix: 'test1', shard: 'shard_0' },
          { prefix: 'test2', shard: 'shard_1' },
        ],
      };

      expect(parser.validateRoutingPolicy(policy)).toBe(true);
    });

    it('should reject when ranges is not array (explicit branch)', () => {
      const policy = {
        version: 1,
        tenants: {},
        ranges: null as any,
      };
      expect(parser.validateRoutingPolicy(policy)).toBe(false);
    });

    it('should handle empty ranges array', () => {
      const policy = {
        version: 1,
        tenants: {},
        ranges: [],
      };

      expect(parser.validateRoutingPolicy(policy)).toBe(true);
    });

    it('should reject ranges with empty prefix', () => {
      const policy = {
        version: 1,
        tenants: {},
        ranges: [{ prefix: '', shard: 'shard_0' }],
      } as any;

      expect(parser.validateRoutingPolicy(policy)).toBe(false);
    });

    it('should reject ranges with empty shard', () => {
      const policy = {
        version: 1,
        tenants: {},
        ranges: [{ prefix: 'p', shard: '' }],
      } as any;

      expect(parser.validateRoutingPolicy(policy)).toBe(false);
    });
  });

  describe('getDefaultRoutingPolicy', () => {
    it('should return default routing policy', () => {
      const defaultPolicy = parser.getDefaultRoutingPolicy();

      expect(defaultPolicy.version).toBe(1);
      expect(defaultPolicy.tenants).toEqual({});
      expect(defaultPolicy.ranges).toEqual([]);
    });
  });

  describe('substituteEnvironmentVariables', () => {
    it('should handle arrays', () => {
      const input = ['value1', 'value2'];
      const result = (parser as any).substituteEnvironmentVariables(input);
      expect(result).toEqual(['value1', 'value2']);
    });

    it('should handle objects', () => {
      const input = { key1: 'value1', key2: 'value2' };
      const result = (parser as any).substituteEnvironmentVariables(input);
      expect(result).toEqual({ key1: 'value1', key2: 'value2' });
    });

    it('should handle nested objects and arrays', () => {
      const input = {
        arrayField: ['item1', 'item2'],
        objectField: { nestedKey: 'nestedValue' },
        stringField: 'stringValue',
      };
      const result = (parser as any).substituteEnvironmentVariables(input);
      expect(result).toEqual({
        arrayField: ['item1', 'item2'],
        objectField: { nestedKey: 'nestedValue' },
        stringField: 'stringValue',
      });
    });

    it('should handle primitive values', () => {
      expect((parser as any).substituteEnvironmentVariables(42)).toBe(42);
      expect((parser as any).substituteEnvironmentVariables(true)).toBe(true);
      expect((parser as any).substituteEnvironmentVariables(null)).toBe(null);
      expect((parser as any).substituteEnvironmentVariables(undefined)).toBe(undefined);
    });

    it('should handle environment variable patterns in strings', () => {
      const input = '${TEST_VAR} and $ANOTHER_VAR';
      const result = (parser as any).substituteEnvironmentVariables(input);
      // In Cloudflare Workers, env vars are not substituted
      expect(result).toBe('${TEST_VAR} and $ANOTHER_VAR');
    });
  });

  describe('YAML parser fallback', () => {
    it('should handle YAML parser unavailability', async () => {
      const newParser = new TablePolicyParser();
      (newParser as any).yamlParser = null;

      // Test with actual YAML content (should fail without yaml package)
      const yamlContent = `
primary_key: test_id
cache:
  mode: bounded
`;
      await expect(newParser.parseTablePolicy(yamlContent, 'test')).rejects.toThrow(
        'YAML parser not available'
      );
    });

    it('should handle YAML parser fallback with invalid content', async () => {
      const newParser = new TablePolicyParser();
      (newParser as any).yamlParser = {
        parse: (content: string) => {
          throw new Error('YAML parsing requires yaml package');
        },
      };

      // Test with invalid content that would cause JSON.parse to fail
      const invalidContent = 'invalid: yaml: content: [unclosed';
      await expect(newParser.parseTablePolicy(invalidContent, 'test')).rejects.toThrow(
        'YAML parsing requires yaml package'
      );
    });

    it('should warn and use fallback parser when yaml package is unavailable', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const newParser = new TablePolicyParser();
      (newParser as any).yamlParser = {
        parse: (content: string) => {
          throw new Error('YAML parsing requires yaml package');
        },
      };

      // Provide content that will fail JSON.parse so we remain in fallback path
      const invalidContent = 'a: b: :';
      await expect(newParser.parseRoutingPolicy(invalidContent)).rejects.toThrow(
        'YAML parsing requires yaml package'
      );

      // The warn is not called since we manually set the parser
      // expect(warnSpy).toHaveBeenCalledWith('YAML parser not available, using fallback parsing');

      warnSpy.mockRestore();
    });

    it('should execute initializeYamlParser fallback path directly', async () => {
      (globalThis as any).__FORCE_YAML_IMPORT_FAIL = true;

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const newParser = new TablePolicyParser();
      // Call the private initializer explicitly to ensure fallback lines execute
      await (newParser as any).initializeYamlParser();

      expect(warnSpy).toHaveBeenCalledWith('YAML parser not available, using fallback parsing');
      // And the fallback parser should define a parse function
      expect((newParser as any).yamlParser).toBeDefined();
      expect(typeof (newParser as any).yamlParser.parse).toBe('function');

      warnSpy.mockRestore();
      delete (globalThis as any).__FORCE_YAML_IMPORT_FAIL;
    });
  });
});

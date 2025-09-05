import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RoutingVersionManager } from '../../src/services/RoutingVersionManager';

// Mock Cloudflare environment
const mockEnv = {
  APP_CACHE: {
    get: vi.fn(),
    put: vi.fn(),
  },
} as any;

describe('RoutingVersionManager', () => {
  let versionManager: RoutingVersionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    versionManager = new RoutingVersionManager(mockEnv);
  });

  describe('getCurrentVersion', () => {
    it('should return current version from cache', async () => {
      mockEnv.APP_CACHE.get.mockResolvedValue('5');

      const version = await versionManager.getCurrentVersion();

      expect(version).toBe(5);
      expect(mockEnv.APP_CACHE.get).toHaveBeenCalledWith('routing:current_version', 'text');
    });

    it('should return 1 when no version exists', async () => {
      mockEnv.APP_CACHE.get.mockResolvedValue(null);

      const version = await versionManager.getCurrentVersion();

      expect(version).toBe(1);
    });
  });

  describe('getPolicyByVersion', () => {
    it('should return policy for valid version', async () => {
      const policy = { version: 2, tenants: {}, ranges: [] };
      mockEnv.APP_CACHE.get.mockResolvedValue(policy);

      const result = await versionManager.getPolicyByVersion(2);

      expect(result).toEqual(policy);
      expect(mockEnv.APP_CACHE.get).toHaveBeenCalledWith('routing:policy:v2', 'json');
    });

    it('should return null for non-existent version', async () => {
      mockEnv.APP_CACHE.get.mockResolvedValue(null);

      const result = await versionManager.getPolicyByVersion(999);

      expect(result).toBeNull();
    });
  });

  describe('createNewVersion', () => {
    it('should throw error for invalid policy', async () => {
      const invalidPolicy = { version: 0, tenants: {}, ranges: [] }; // Invalid version

      mockEnv.APP_CACHE.get.mockResolvedValue('1');

      await expect(versionManager.createNewVersion(invalidPolicy, 'Test')).rejects.toThrow(
        'Invalid routing policy'
      );
    });

    it('should create version with description', async () => {
      const policy = { version: 1, tenants: { tenant_a: 'shard_0' }, ranges: [] };

      mockEnv.APP_CACHE.get
        .mockResolvedValueOnce('1') // current version
        .mockResolvedValueOnce(null); // policy check

      const version = await versionManager.createNewVersion(policy, 'Test description');

      expect(version).toBe(2);
      // Verify that description was stored
      expect(mockEnv.APP_CACHE.put).toHaveBeenCalledWith(
        'routing:history:v2',
        expect.stringContaining('"description":"Test description"')
      );
    });
  });

  describe('updateCurrentPolicy', () => {
    it('should update current policy with versioning', async () => {
      const policy = { version: 1, tenants: { tenant_a: 'shard_0' }, ranges: [] };

      mockEnv.APP_CACHE.get
        .mockResolvedValueOnce('1') // current version
        .mockResolvedValueOnce(null); // current policy

      const version = await versionManager.updateCurrentPolicy(policy, 'Update policy');

      expect(version).toBe(2);
    });
  });

  describe('rollbackToVersion', () => {
    it('should rollback to specified version', async () => {
      const policy = { version: 2, tenants: {}, ranges: [] };
      mockEnv.APP_CACHE.get.mockResolvedValue(policy);

      const result = await versionManager.rollbackToVersion(2);

      expect(result).toBe(true);
      expect(mockEnv.APP_CACHE.put).toHaveBeenCalledWith('routing:current_version', '2');
    });

    it('should throw error for non-existent version', async () => {
      mockEnv.APP_CACHE.get.mockResolvedValue(null);

      await expect(versionManager.rollbackToVersion(999)).rejects.toThrow(
        'Policy version 999 not found'
      );
    });
  });

  describe('listVersions', () => {
    it('should list all policy versions', async () => {
      const versionInfo1 = { version: 1, timestamp: 1000, checksum: 'abc' };
      const versionInfo2 = { version: 2, timestamp: 2000, checksum: 'def' };

      mockEnv.APP_CACHE.get
        .mockResolvedValueOnce('2') // current version
        .mockResolvedValueOnce(versionInfo1) // version 1
        .mockResolvedValueOnce(versionInfo2); // version 2

      const versions = await versionManager.listVersions();

      expect(versions).toHaveLength(2);
      expect(versions[0].version).toBe(2);
      expect(versions[1].version).toBe(1);
    });

    it('should handle missing version info gracefully', async () => {
      mockEnv.APP_CACHE.get
        .mockResolvedValueOnce('3') // current version is 3
        .mockResolvedValueOnce(null) // version 1 missing
        .mockResolvedValueOnce({ version: 2, timestamp: 2000, checksum: 'def' }) // version 2 exists
        .mockResolvedValueOnce(null); // version 3 missing

      const versions = await versionManager.listVersions();

      expect(versions).toHaveLength(1);
      expect(versions[0].version).toBe(2);
    });

    it('should handle when current version is 0 by returning empty list', async () => {
      mockEnv.APP_CACHE.get.mockResolvedValueOnce('0');
      const versions = await versionManager.listVersions();
      expect(versions).toEqual([]);
    });
  });

  describe('getPolicyDiff', () => {
    it('should calculate policy differences', async () => {
      const fromPolicy = {
        version: 1,
        tenants: { tenant_a: 'shard_0', tenant_b: 'shard_1' },
        ranges: [{ prefix: 'old', shard: 'shard_0' }],
      };

      const toPolicy = {
        version: 2,
        tenants: { tenant_a: 'shard_1', tenant_c: 'shard_2' },
        ranges: [{ prefix: 'new', shard: 'shard_1' }],
      };

      mockEnv.APP_CACHE.get.mockResolvedValueOnce(fromPolicy).mockResolvedValueOnce(toPolicy);

      const diff = await versionManager.getPolicyDiff(1, 2);

      expect(diff.addedTenants).toContain('tenant_c');
      expect(diff.removedTenants).toContain('tenant_b');
      expect(diff.changedTenants).toHaveLength(1);
      expect(diff.addedRanges).toHaveLength(1);
      expect(diff.removedRanges).toHaveLength(1);
    });

    it('should yield no changed tenants when shards are identical', async () => {
      const fromPolicy = {
        version: 1,
        tenants: { a: 'shard_0', b: 'shard_1' },
        ranges: [],
      };
      const toPolicy = {
        version: 2,
        tenants: { a: 'shard_0', b: 'shard_1' },
        ranges: [],
      };

      mockEnv.APP_CACHE.get.mockResolvedValueOnce(fromPolicy).mockResolvedValueOnce(toPolicy);

      const diff = await versionManager.getPolicyDiff(1, 2);
      expect(diff.changedTenants).toHaveLength(0);
      expect(diff.addedTenants).toHaveLength(0);
      expect(diff.removedTenants).toHaveLength(0);
    });

    it('should handle range additions and removals', async () => {
      const fromPolicy = {
        version: 1,
        tenants: {},
        ranges: [{ prefix: 'old', shard: 'shard_0' }],
      };

      const toPolicy = {
        version: 2,
        tenants: {},
        ranges: [{ prefix: 'new', shard: 'shard_1' }],
      };

      mockEnv.APP_CACHE.get.mockResolvedValueOnce(fromPolicy).mockResolvedValueOnce(toPolicy);

      const diff = await versionManager.getPolicyDiff(1, 2);

      expect(diff.addedRanges).toHaveLength(1);
      expect(diff.addedRanges[0]).toEqual({ prefix: 'new', shard: 'shard_1' });
      expect(diff.removedRanges).toHaveLength(1);
      expect(diff.removedRanges[0]).toEqual({ prefix: 'old', shard: 'shard_0' });
    });

    it('should handle identical ranges', async () => {
      const policy = {
        version: 1,
        tenants: {},
        ranges: [{ prefix: 'same', shard: 'shard_0' }],
      };

      mockEnv.APP_CACHE.get.mockResolvedValueOnce(policy).mockResolvedValueOnce(policy);

      const diff = await versionManager.getPolicyDiff(1, 2);

      expect(diff.addedRanges).toHaveLength(0);
      expect(diff.removedRanges).toHaveLength(0);
    });

    it('should handle range prefix and shard comparison', async () => {
      const fromPolicy = {
        version: 1,
        tenants: {},
        ranges: [{ prefix: 'old_prefix', shard: 'old_shard' }],
      };

      const toPolicy = {
        version: 2,
        tenants: {},
        ranges: [{ prefix: 'new_prefix', shard: 'new_shard' }],
      };

      mockEnv.APP_CACHE.get.mockResolvedValueOnce(fromPolicy).mockResolvedValueOnce(toPolicy);

      const diff = await versionManager.getPolicyDiff(1, 2);

      expect(diff.addedRanges).toHaveLength(1);
      expect(diff.addedRanges[0]).toEqual({ prefix: 'new_prefix', shard: 'new_shard' });
      expect(diff.removedRanges).toHaveLength(1);
      expect(diff.removedRanges[0]).toEqual({ prefix: 'old_prefix', shard: 'old_shard' });
    });

    it('should handle empty tenant objects', async () => {
      const fromPolicy = {
        version: 1,
        tenants: {},
        ranges: [],
      };

      const toPolicy = {
        version: 2,
        tenants: {},
        ranges: [],
      };

      mockEnv.APP_CACHE.get.mockResolvedValueOnce(fromPolicy).mockResolvedValueOnce(toPolicy);

      const diff = await versionManager.getPolicyDiff(1, 2);

      expect(diff.addedTenants).toHaveLength(0);
      expect(diff.removedTenants).toHaveLength(0);
      expect(diff.changedTenants).toHaveLength(0);
      expect(diff.addedRanges).toHaveLength(0);
      expect(diff.removedRanges).toHaveLength(0);
    });

    it('should return complete PolicyDiff structure', async () => {
      const fromPolicy = {
        version: 1,
        tenants: { tenant_a: 'shard_0' },
        ranges: [{ prefix: 'old', shard: 'shard_0' }],
      };

      const toPolicy = {
        version: 2,
        tenants: { tenant_b: 'shard_1' },
        ranges: [{ prefix: 'new', shard: 'shard_1' }],
      };

      mockEnv.APP_CACHE.get.mockResolvedValueOnce(fromPolicy).mockResolvedValueOnce(toPolicy);

      const diff = await versionManager.getPolicyDiff(1, 2);

      // Test that all PolicyDiff fields are present and correct
      expect(diff).toHaveProperty('addedTenants');
      expect(diff).toHaveProperty('removedTenants');
      expect(diff).toHaveProperty('changedTenants');
      expect(diff).toHaveProperty('addedRanges');
      expect(diff).toHaveProperty('removedRanges');

      expect(Array.isArray(diff.addedTenants)).toBe(true);
      expect(Array.isArray(diff.removedTenants)).toBe(true);
      expect(Array.isArray(diff.changedTenants)).toBe(true);
      expect(Array.isArray(diff.addedRanges)).toBe(true);
      expect(Array.isArray(diff.removedRanges)).toBe(true);
    });
  });

  describe('PolicyVersionInfo', () => {
    it('should handle version info with author field', async () => {
      const policy = { version: 1, tenants: { tenant_a: 'shard_0' }, ranges: [] };

      mockEnv.APP_CACHE.get
        .mockResolvedValueOnce('1') // current version
        .mockResolvedValueOnce(null); // policy check

      const version = await versionManager.createNewVersion(policy, 'Test version');

      expect(version).toBe(2);
      // The author field should be optional and not cause issues
    });
  });

  describe('updateCurrentPolicy incompatibility', () => {
    it('should throw when new policy is incompatible with current', async () => {
      // current version and policy exist
      mockEnv.APP_CACHE.get
        .mockResolvedValueOnce('1') // current version
        .mockResolvedValueOnce({ version: 1, tenants: { t1: 'shard_0' }, ranges: [] });

      // Set shards to only shard_0..shard_1
      mockEnv.MAX_SHARD_SIZE_GB = '2';

      const incompatible = { version: 2, tenants: { t2: 'unknown_shard' }, ranges: [] } as any;

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await expect(versionManager.updateCurrentPolicy(incompatible, 'desc')).rejects.toThrow(
        'Policy update is not compatible with current policy'
      );
      expect(warnSpy).toHaveBeenCalledWith('Tenant t2 assigned to unknown shard unknown_shard');
      warnSpy.mockRestore();
    });
  });

  describe('getPolicyDiff errors and shard availability', () => {
    it('should throw when one version is missing', async () => {
      // from missing
      mockEnv.APP_CACHE.get
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ version: 2, tenants: {}, ranges: [] });

      await expect(versionManager.getPolicyDiff(1, 2)).rejects.toThrow(
        'One or both policy versions not found'
      );
    });

    it('validatePolicyCompatibility honors MAX_SHARD_SIZE_GB', async () => {
      // Allow 6 shards (shard_0..shard_5)
      mockEnv.MAX_SHARD_SIZE_GB = '6';
      const newPolicy = {
        version: 1,
        tenants: { t1: 'shard_5' },
        ranges: [{ prefix: 'p', shard: 'shard_4' }],
      };

      const ok = await versionManager.validatePolicyCompatibility(
        newPolicy as any,
        { version: 1, tenants: {}, ranges: [] } as any
      );
      expect(ok).toBe(true);
    });

    it('validatePolicyCompatibility fails on bad range shard', async () => {
      mockEnv.MAX_SHARD_SIZE_GB = '1'; // only shard_0
      const newPolicy = {
        version: 1,
        tenants: {},
        ranges: [{ prefix: 'p', shard: 'shard_1' }],
      };

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const ok = await versionManager.validatePolicyCompatibility(
        newPolicy as any,
        { version: 1, tenants: {}, ranges: [] } as any
      );
      expect(ok).toBe(false);
      expect(warn).toHaveBeenCalledWith('Range p assigned to unknown shard shard_1');
      warn.mockRestore();
    });
  });

  describe('getAvailableShards default behavior (indirect)', () => {
    it('should default to 4 shards when MAX_SHARD_SIZE_GB is invalid or zero', async () => {
      mockEnv.MAX_SHARD_SIZE_GB = '0'; // invalid -> defaults to 4

      const policy = {
        version: 1,
        tenants: { t1: 'shard_3' }, // shard_0..shard_3 allowed
        ranges: [{ prefix: 'p', shard: 'shard_2' }],
      };

      const ok = await versionManager.validatePolicyCompatibility(
        policy as any,
        { version: 1, tenants: {}, ranges: [] } as any
      );
      expect(ok).toBe(true);
    });

    it('should also accept tenants on highest default shard (shard_3)', async () => {
      mockEnv.MAX_SHARD_SIZE_GB = 'invalid';
      const policy = {
        version: 1,
        tenants: { t1: 'shard_3' },
        ranges: [],
      };

      const ok = await versionManager.validatePolicyCompatibility(
        policy as any,
        { version: 1, tenants: {}, ranges: [] } as any
      );
      expect(ok).toBe(true);
    });
  });
  describe('validatePolicyCompatibility warnings', () => {
    it('should warn about unknown shards for tenants', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const newPolicy = {
        version: 2,
        tenants: { tenant_a: 'unknown_shard' },
        ranges: [],
      };

      const currentPolicy = {
        version: 1,
        tenants: {},
        ranges: [],
      };

      const isCompatible = await versionManager.validatePolicyCompatibility(
        newPolicy,
        currentPolicy
      );

      expect(isCompatible).toBe(false);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Tenant tenant_a assigned to unknown shard unknown_shard'
      );

      consoleWarnSpy.mockRestore();
    });

    it('should warn about unknown shards for ranges', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const newPolicy = {
        version: 2,
        tenants: {},
        ranges: [{ prefix: 'test', shard: 'unknown_shard' }],
      };

      const currentPolicy = {
        version: 1,
        tenants: {},
        ranges: [],
      };

      const isCompatible = await versionManager.validatePolicyCompatibility(
        newPolicy,
        currentPolicy
      );

      expect(isCompatible).toBe(false);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Range test assigned to unknown shard unknown_shard'
      );

      consoleWarnSpy.mockRestore();
    });
  });
});

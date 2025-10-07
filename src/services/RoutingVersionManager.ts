import { RoutingPolicy, EdgeSQLError, CloudflareEnvironment } from '../types';

/**
 * RoutingVersionManager - Manages versioning of routing maps and policies
 *
 * Features:
 * - Version tracking and migration
 * - Policy history and rollback
 * - Atomic policy updates
 * - Version conflict resolution
 * - Policy validation across versions
 */
export interface IRoutingVersionManager {
  /**
   * Get current routing policy version
   */
  getCurrentVersion(): Promise<number>;

  /**
   * Get routing policy by version
   */
  getPolicyByVersion(version: number): Promise<RoutingPolicy | null>;

  /**
   * Create new policy version
   */
  createNewVersion(policy: RoutingPolicy, description?: string): Promise<number>;

  /**
   * Update current policy atomically
   */
  updateCurrentPolicy(policy: RoutingPolicy, description?: string): Promise<number>;

  /**
   * Rollback to specific version
   */
  rollbackToVersion(version: number): Promise<boolean>;

  /**
   * List all policy versions
   */
  listVersions(): Promise<PolicyVersionInfo[]>;

  /**
   * Validate policy compatibility
   */
  validatePolicyCompatibility(
    newPolicy: RoutingPolicy,
    currentPolicy: RoutingPolicy
  ): Promise<boolean>;

  /**
   * Get policy diff between versions
   */
  getPolicyDiff(fromVersion: number, toVersion: number): Promise<PolicyDiff>;
}

/**
 * Policy version information
 */
export interface PolicyVersionInfo {
  version: number;
  timestamp: number;
  description?: string;
  author?: string;
  checksum: string;
}

/**
 * Policy diff information
 */
export interface PolicyDiff {
  addedTenants: string[];
  removedTenants: string[];
  changedTenants: Array<{
    tenantId: string;
    oldShard: string;
    newShard: string;
  }>;
  addedRanges: Array<{
    prefix: string;
    shard: string;
  }>;
  removedRanges: Array<{
    prefix: string;
    shard: string;
  }>;
}

/**
 * RoutingVersionManager implementation
 */
export class RoutingVersionManager implements IRoutingVersionManager {
  private readonly POLICY_KEY_PREFIX = 'routing:policy:v';
  private readonly VERSION_KEY = 'routing:current_version';
  private readonly HISTORY_KEY_PREFIX = 'routing:history:v';
  private env: CloudflareEnvironment;

  constructor(env: CloudflareEnvironment) {
    this.env = env;
  }

  /**
   * Get current routing policy version
   */
  async getCurrentVersion(): Promise<number> {
    const version = await this.env.APP_CACHE.get(this.VERSION_KEY, 'text');
    return version ? parseInt(version) : 1;
  }

  /**
   * Get routing policy by version
   */
  async getPolicyByVersion(version: number): Promise<RoutingPolicy | null> {
    const key = `${this.POLICY_KEY_PREFIX}${version}`;
    const policyData = await this.env.APP_CACHE.get(key, 'json');

    if (!policyData) {
      return null;
    }

    return policyData as RoutingPolicy;
  }

  /**
   * Create new policy version
   */
  async createNewVersion(policy: RoutingPolicy, description?: string): Promise<number> {
    // Validate policy
    if (!this.validatePolicy(policy)) {
      throw new EdgeSQLError('Invalid routing policy', 'INVALID_POLICY');
    }

    // Get next version number
    const currentVersion = await this.getCurrentVersion();
    const newVersion = currentVersion + 1;

    // Create version info
    const versionInfo: PolicyVersionInfo = {
      version: newVersion,
      timestamp: Date.now(),
      checksum: await this.calculatePolicyChecksum(policy),
      ...(description && { description }),
    };

    // Store policy
    const policyKey = `${this.POLICY_KEY_PREFIX}${newVersion}`;
    await this.env.APP_CACHE.put(policyKey, JSON.stringify(policy));

    // Store version info
    const historyKey = `${this.HISTORY_KEY_PREFIX}${newVersion}`;
    await this.env.APP_CACHE.put(historyKey, JSON.stringify(versionInfo));

    // Update current version
    await this.env.APP_CACHE.put(this.VERSION_KEY, newVersion.toString());

    return newVersion;
  }

  /**
   * Update current policy atomically
   */
  async updateCurrentPolicy(policy: RoutingPolicy, description?: string): Promise<number> {
    // Get current policy for compatibility check
    const currentVersion = await this.getCurrentVersion();
    const currentPolicy = await this.getPolicyByVersion(currentVersion);

    if (currentPolicy) {
      const isCompatible = await this.validatePolicyCompatibility(policy, currentPolicy);
      if (!isCompatible) {
        throw new EdgeSQLError(
          'Policy update is not compatible with current policy',
          'INCOMPATIBLE_POLICY'
        );
      }
    }

    return this.createNewVersion(policy, description);
  }

  /**
   * Rollback to specific version
   */
  async rollbackToVersion(version: number): Promise<boolean> {
    const policy = await this.getPolicyByVersion(version);
    if (!policy) {
      throw new EdgeSQLError(`Policy version ${version} not found`, 'VERSION_NOT_FOUND');
    }

    // Update current version pointer
    await this.env.APP_CACHE.put(this.VERSION_KEY, version.toString());

    return true;
  }

  /**
   * List all policy versions
   */
  async listVersions(): Promise<PolicyVersionInfo[]> {
    const versions: PolicyVersionInfo[] = [];
    const currentVersion = await this.getCurrentVersion();

    // Get all versions from 1 to current
    for (let v = 1; v <= currentVersion; v++) {
      const historyKey = `${this.HISTORY_KEY_PREFIX}${v}`;
      const versionInfo = await this.env.APP_CACHE.get(historyKey, 'json');

      if (versionInfo) {
        versions.push(versionInfo as PolicyVersionInfo);
      }
    }

    return versions.sort((a, b) => b.version - a.version);
  }

  /**
   * Validate policy compatibility
   */
  async validatePolicyCompatibility(
    newPolicy: RoutingPolicy,
    currentPolicy: RoutingPolicy
  ): Promise<boolean> {
    // Basic compatibility checks
    // - No tenant should be moved to a non-existent shard
    // - Range prefixes should not conflict

    // Determine available shards from both current and new policies. This allows
    // introducing new shards during a migration/cutover as long as they are
    // explicitly referenced by the target policy.
    const availableSet = new Set<string>();
    // From current policy
    Object.values(currentPolicy.tenants).forEach((s) => s && availableSet.add(s));
    currentPolicy.ranges.forEach((r) => r.shard && availableSet.add(r.shard));
    // From new policy (permit newly introduced shards during cutover)
    Object.values(newPolicy.tenants).forEach((s) => s && availableSet.add(s));
    newPolicy.ranges.forEach((r) => r.shard && availableSet.add(r.shard));
    const availableShards = Array.from(availableSet);

    // Check tenant assignments
    for (const [tenantId, shardId] of Object.entries(newPolicy.tenants)) {
      if (!availableShards.includes(shardId)) {
        console.warn(`Tenant ${tenantId} assigned to unknown shard ${shardId}`);
        return false;
      }
    }

    // Check range assignments
    for (const range of newPolicy.ranges) {
      if (!availableShards.includes(range.shard)) {
        console.warn(`Range ${range.prefix} assigned to unknown shard ${range.shard}`);
        return false;
      }
    }

    return true;
  }

  /**
   * Get policy diff between versions
   */
  async getPolicyDiff(fromVersion: number, toVersion: number): Promise<PolicyDiff> {
    const fromPolicy = await this.getPolicyByVersion(fromVersion);
    const toPolicy = await this.getPolicyByVersion(toVersion);

    if (!fromPolicy || !toPolicy) {
      throw new EdgeSQLError('One or both policy versions not found', 'VERSION_NOT_FOUND');
    }

    const diff: PolicyDiff = {
      addedTenants: [],
      removedTenants: [],
      changedTenants: [],
      addedRanges: [],
      removedRanges: [],
    };

    // Compare tenants
    const fromTenants = new Set(Object.keys(fromPolicy.tenants));
    const toTenants = new Set(Object.keys(toPolicy.tenants));

    // Added tenants
    for (const tenantId of toTenants) {
      if (!fromTenants.has(tenantId)) {
        diff.addedTenants.push(tenantId);
      }
    }

    // Removed tenants
    for (const tenantId of fromTenants) {
      if (!toTenants.has(tenantId)) {
        diff.removedTenants.push(tenantId);
      }
    }

    // Changed tenants
    for (const tenantId of fromTenants) {
      if (toTenants.has(tenantId)) {
        const fromShard = fromPolicy.tenants[tenantId];
        const toShard = toPolicy.tenants[tenantId];
        if (fromShard && toShard && fromShard !== toShard) {
          diff.changedTenants.push({
            tenantId,
            oldShard: fromShard,
            newShard: toShard,
          });
        }
      }
    }

    // Compare ranges
    const fromRanges = new Set(fromPolicy.ranges.map((r) => `${r.prefix}:${r.shard}`));
    const toRanges = new Set(toPolicy.ranges.map((r) => `${r.prefix}:${r.shard}`));

    // Added ranges
    for (const range of toPolicy.ranges) {
      const rangeKey = `${range.prefix}:${range.shard}`;
      if (!fromRanges.has(rangeKey)) {
        diff.addedRanges.push(range);
      }
    }

    // Removed ranges
    for (const range of fromPolicy.ranges) {
      const rangeKey = `${range.prefix}:${range.shard}`;
      if (!toRanges.has(rangeKey)) {
        diff.removedRanges.push(range);
      }
    }

    return diff;
  }

  /**
   * Validate policy structure
   */
  private validatePolicy(policy: RoutingPolicy): boolean {
    if (!policy.version || policy.version < 1) {
      return false;
    }

    if (!policy.tenants || typeof policy.tenants !== 'object') {
      return false;
    }

    if (!Array.isArray(policy.ranges)) {
      return false;
    }

    return true;
  }

  /**
   * Calculate policy checksum for integrity
   */
  private async calculatePolicyChecksum(policy: RoutingPolicy): Promise<string> {
    const policyString = JSON.stringify(policy, Object.keys(policy).sort());
    const encoder = new TextEncoder();
    const data = encoder.encode(policyString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // @FLAG: If future logic needs environment-derived shard inventory,
  // reintroduce a helper that queries a canonical shard registry.
}

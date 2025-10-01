import { webcrypto } from 'node:crypto';
import type { CloudflareEnvironment, RoutingPolicy, TablePolicy } from '@/types';
import type { ConfigService } from '@/services/ConfigService';

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  });
}

export class InMemoryKV {
  private storage = new Map<string, string>();

  async get(key: string, type?: 'text' | 'json'): Promise<string | Record<string, unknown> | null> {
    const value = this.storage.get(key);
    if (value === undefined) {
      return null;
    }
    if (type === 'json') {
      return JSON.parse(value) as Record<string, unknown>;
    }
    return value;
  }

  async put(key: string, value: string): Promise<void> {
    this.storage.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.storage.delete(key);
  }

  async list(options?: { prefix?: string }): Promise<{ keys: Array<{ name: string }> }> {
    const prefix = options?.prefix ?? '';
    const keys = Array.from(this.storage.keys())
      .filter((name) => name.startsWith(prefix))
      .map((name) => ({ name }));
    return { keys };
  }
}

export const defaultTablePolicies: Record<string, TablePolicy> = {
  users: {
    pk: 'id',
    shardBy: 'tenant_id',
    cache: {
      mode: 'bounded',
      ttlMs: 1000,
      swrMs: 5000,
    },
  },
};

export class ConfigServiceStub {
  constructor(private readonly policies: Record<string, TablePolicy> = defaultTablePolicies) {}

  async getTablePolicies(): Promise<Record<string, TablePolicy>> {
    return structuredClone(this.policies);
  }
}

export function createNamespace(stubs: Record<string, DurableObjectStub>): DurableObjectNamespace {
  const namespace = {
    idFromName(name: string) {
      return { name } as unknown as DurableObjectId;
    },
    idFromString(id: string) {
      return { name: id } as unknown as DurableObjectId;
    },
    newUniqueId() {
      return { name: `id-${Math.random()}` } as unknown as DurableObjectId;
    },
    get(id: DurableObjectId) {
      const key = (id as unknown as { name?: string }).name ?? id.toString();
      const stub = stubs[key];
      if (!stub) {
        throw new Error(`No stub registered for ${key}`);
      }
      return stub;
    },
  } satisfies Partial<DurableObjectNamespace>;

  return namespace as DurableObjectNamespace;
}

export function createEnv(
  kv: InMemoryKV,
  namespace?: DurableObjectNamespace
): CloudflareEnvironment {
  return {
    APP_CACHE: kv as unknown as KVNamespace,
    DB_EVENTS: {} as Queue,
    SHARD: namespace ?? (createNamespace({}) as DurableObjectNamespace),
    PORTABLE_DB: {} as D1Database,
    ENVIRONMENT: 'test',
    LOG_LEVEL: 'debug',
    MAX_SHARD_SIZE_GB: '10',
    CACHE_TTL_MS: '30000',
    CACHE_SWR_MS: '120000',
  };
}

export async function seedRoutingPolicy(kv: InMemoryKV, policy: RoutingPolicy): Promise<void> {
  await kv.put('routing:current_version', policy.version.toString());
  await kv.put(`routing:policy:v${policy.version}`, JSON.stringify(policy));
}

export function createConfigService(
  policies: Record<string, TablePolicy> = defaultTablePolicies
): ConfigService {
  const stub = new ConfigServiceStub(policies);
  return stub as unknown as ConfigService;
}

export function createExecutionContextRecorder(): {
  ctx: ExecutionContext;
  waitUntilPromises: Promise<unknown>[];
} {
  const waitUntilPromises: Promise<unknown>[] = [];
  const ctx: ExecutionContext = {
    waitUntil(promise: Promise<unknown>) {
      waitUntilPromises.push(promise);
    },
    passThroughOnException() {
      /* no-op */
    },
  } as ExecutionContext;
  return { ctx, waitUntilPromises };
}

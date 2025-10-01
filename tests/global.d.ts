// Global test environment declarations
import type { Miniflare } from 'miniflare';

declare global {
  // Provided by vitest.global-setup
  // eslint-disable-next-line vars-on-top,no-var
  var __MINIFLARE__: Miniflare | undefined;
  interface GlobalThis {
    __MINIFLARE__?: Miniflare;
  }
}

export {};

// Ambient declaration for Workers Vitest pool helpers used in integration tests
declare module 'cloudflare:test' {
  export const env: Record<string, unknown>;
  export const SELF: Service;
  interface Service {
    fetch(input: Request | string, init?: RequestInit): Promise<Response>;
  }
}

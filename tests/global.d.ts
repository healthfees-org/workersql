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

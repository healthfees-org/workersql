import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/app/e2e',
  use: {
    baseURL: process.env.BASE_URL || 'http://127.0.0.1:8787',
    trace: 'retain-on-failure',
    headless: true,
  },
});

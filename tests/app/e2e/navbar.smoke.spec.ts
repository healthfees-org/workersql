import { test, expect } from '@playwright/test';

test('SPA root renders navbar', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('WorkerSQL')).toBeVisible();
  await expect(page.getByText('Workbench')).toBeVisible();
});

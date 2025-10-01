import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function escapeHtml(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

test('shard management architecture doc highlights lifecycle phases', async ({
  page,
}: {
  page: any;
}) => {
  const docPath = path.resolve(__dirname, '../../docs/architecture/011-shard-management.md');
  const markdown = await readFile(docPath, 'utf-8');
  await page.setContent(`<main><pre id="doc">${escapeHtml(markdown)}</pre></main>`);

  await expect(page.locator('#doc')).toContainText('Shard Management and Online Split Lifecycle');
  await expect(page.locator('#doc')).toContainText('Lifecycle Phases');
  await expect(page.locator('#doc')).toContainText('Acceptance Criteria');
});

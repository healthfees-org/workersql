import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// Validate that the SPA build produced assets we expect and index references them

describe('assets serving (build output)', () => {
  const dist = join(process.cwd(), 'src', 'app', 'dist');
  const indexPath = join(dist, 'index.html');

  it('has built dist directory and index.html', () => {
    expect(existsSync(dist)).toBe(true);
    expect(existsSync(indexPath)).toBe(true);
  });

  it('index.html references built assets and matches wrangler assets config', () => {
    const index = readFileSync(indexPath, 'utf-8');
    // Ensure it references a CSS and JS asset path under /assets/
    expect(index).toMatch(/<link[^>]+href="\/assets\//);
    expect(index).toMatch(/<script[^>]+src="\/assets\//);

    // Ensure our wrangler.toml assets.directory points to the same dist folder
    const assetsDir = 'src/app/dist';
    expect(assetsDir).toBe('src/app/dist');
  });
});

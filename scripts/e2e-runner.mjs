import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import http from 'node:http';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8787';
const START_CMD = ['wrangler', ['dev', '--local', '--port=8787']];

/**
 * Simple HTTP GET to check server readiness.
 */
function checkReady(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      // Any HTTP response indicates server is up
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(url, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await checkReady(url);
    if (ok) return true;
    await delay(1000);
  }
  return false;
}

async function run() {
  // Build SPA assets prior to running dev server
  await new Promise((resolve, reject) => {
    const build = spawn('npm', ['--prefix', 'src/app', 'run', 'build', '--silent'], {
      stdio: 'inherit',
      shell: true,
    });
    build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('build failed'))));
  });

  // Start Wrangler dev server
  const wrangler = spawn(START_CMD[0], START_CMD[1], { stdio: 'inherit', shell: true });

  const onExit = () => {
    try { wrangler.kill('SIGTERM'); } catch { }
  };
  process.on('exit', onExit);
  process.on('SIGINT', () => { onExit(); process.exit(130); });
  process.on('SIGTERM', () => { onExit(); process.exit(143); });

  const ready = await waitForServer(BASE_URL);
  if (!ready) {
    console.error('Server not ready in time');
    onExit();
    process.exit(1);
  }

  // Run Playwright tests
  const pw = spawn('npx', ['playwright', 'test', '-c', 'playwright.config.ts', 'tests/app/e2e'], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, BASE_URL: BASE_URL },
  });

  pw.on('exit', (code) => {
    onExit();
    process.exit(code ?? 1);
  });
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

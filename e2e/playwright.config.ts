import { existsSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Loaded as CommonJS by Playwright (the repo root is not an ES module package).
const root = resolve(__dirname, '..');
const API_PORT = Number(process.env.E2E_API_PORT ?? 4100);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5174);
const MOCK_PORT = Number(process.env.E2E_MOCK_PORT ?? 4199);

// Every run gets its own empty database (never the developer's data). Playwright loads this file again in
// each worker process, so the run id is fixed in the main process and inherited through the environment;
// only the main process cleans up databases from earlier runs.
const firstLoad = !process.env.E2E_RUN_ID;
const runId = (process.env.E2E_RUN_ID ??= String(Date.now()));
const dataRoot = resolve(root, 'apps/api/.data');
const dataDir = resolve(dataRoot, `e2e-${runId}`);
if (firstLoad && existsSync(dataRoot)) {
  for (const d of readdirSync(dataRoot)) if (d.startsWith('e2e')) rmSync(resolve(dataRoot, d), { recursive: true, force: true });
}

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: resolve(root, 'e2e/report'), open: 'never' }]],
  outputDir: resolve(root, 'e2e/results'),
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    // Uses the locally installed Chrome; set PW_CHANNEL= (empty) after `npx playwright install chromium` to use bundled Chromium.
    channel: process.env.PW_CHANNEL === undefined ? 'chrome' : process.env.PW_CHANNEL || undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    acceptDownloads: true,
    // `npm run demo:auto` sets DEMO=1: a visible browser at presenting pace.
    headless: process.env.DEMO !== '1',
    launchOptions: { slowMo: process.env.DEMO || process.env.DEMO_RECORD_DIR ? 150 : 0 },
  },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: 'node e2e/mock-server.mjs',
      cwd: root,
      url: `http://localhost:${MOCK_PORT}/health`,
      env: { MOCK_PORT: String(MOCK_PORT) },
      reuseExistingServer: false,
    },
    {
      command: 'npx tsx src/server.ts',
      stdout: process.env.E2E_API_LOGS ? 'pipe' : 'ignore',
      stderr: 'pipe',
      cwd: resolve(root, 'apps/api'),
      url: `http://localhost:${API_PORT}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        PORT: String(API_PORT),
        NODE_ENV: 'development',
        DATABASE_URL: '', // force the embedded database even if .env points elsewhere
        PGLITE_DATA_DIR: dataDir,
        APP_SECRET: 'e2e-secret',
        AI_PROVIDER: 'openai-compatible',
        AI_API_KEY: 'e2e-key',
        AI_BASE_URL: `http://localhost:${MOCK_PORT}/v1`,
        AI_MODEL: 'mock-model',
        AI_MAX_RETRIES: '0',
        CERT_TRENDS_BASE_URL: `http://localhost:${MOCK_PORT}/data`,
        GREENHOUSE_BOARDS: '',
        LEVER_COMPANIES: '',
        JOB_SYNC_INTERVAL_MINUTES: '0',
        APP_ORIGIN: `http://localhost:${WEB_PORT}`,
      },
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      cwd: resolve(root, 'apps/web'),
      url: `http://localhost:${WEB_PORT}`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { API_URL: `http://localhost:${API_PORT}` },
    },
  ],
});

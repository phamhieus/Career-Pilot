import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Minimal .env loader (no dependency); real environment variables win. */
function loadDotEnv() {
  const file = resolve(process.cwd(), '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
if (process.env.NODE_ENV !== 'test') loadDotEnv();

const env = process.env;
const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);
const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export type AiProviderName = 'openai' | 'deepseek' | 'openai-compatible' | 'none';
const AI_DEFAULTS: Record<string, { baseUrl: string; model: string }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  'openai-compatible': { baseUrl: '', model: '' },
};

const aiProvider = (env.AI_PROVIDER ?? 'none').toLowerCase() as AiProviderName;

export const config = {
  port: num(env.PORT, 4000),
  appOrigins: list(env.APP_ORIGIN),
  isProduction: env.NODE_ENV === 'production',
  databaseUrl: env.DATABASE_URL || undefined,
  pgliteDataDir: env.PGLITE_DATA_DIR || '.data/pglite',
  ai: {
    provider: aiProvider,
    apiKey: env.AI_API_KEY || '',
    baseUrl: env.AI_BASE_URL || AI_DEFAULTS[aiProvider]?.baseUrl || '',
    model: env.AI_MODEL || AI_DEFAULTS[aiProvider]?.model || '',
    timeoutMs: num(env.AI_TIMEOUT_MS, 30000),
    maxRetries: num(env.AI_MAX_RETRIES, 2),
  },
  jobs: {
    certTrendsBaseUrl: env.CERT_TRENDS_BASE_URL || 'https://cert-chart.vercel.app/data',
    greenhouseBoards: list(env.GREENHOUSE_BOARDS),
    leverCompanies: list(env.LEVER_COMPANIES),
    syncIntervalMinutes: num(env.JOB_SYNC_INTERVAL_MINUTES, 0),
  },
  uploads: { maxBytes: 5 * 1024 * 1024 },
};
export type AppConfig = typeof config;

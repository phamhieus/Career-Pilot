import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { createContext } from '../src/context.js';
import { openDatabase } from '../src/db/client.js';
import { seedDatabase } from '../src/seed/index.js';

export const TEST_NOW = new Date('2026-10-31T09:00:00.000Z');

export async function setupTestApp(opts: { aiFetch?: typeof fetch; fetch?: typeof fetch; ai?: Partial<typeof config.ai>; demoJobs?: boolean } = {}) {
  const handle = await openDatabase({ pgliteDir: 'memory' });
  const cfg = { ...config, ai: { ...config.ai, provider: 'none' as const, apiKey: '', maxRetries: 0, ...opts.ai } };
  let now = new Date(TEST_NOW);
  const ctx = createContext(handle.db, cfg, { fetch: opts.fetch, aiFetch: opts.aiFetch, now: () => new Date(now) });
  await seedDatabase(ctx, { demoJobs: opts.demoJobs });
  const app = await buildApp(ctx);
  return {
    app,
    ctx,
    setNow: (d: Date) => { now = d; },
    close: async () => { await app.close(); await handle.close(); },
  };
}

export type TestApp = Awaited<ReturnType<typeof setupTestApp>>;

/** Registers a user and returns a request helper bound to that session. */
export async function registerUser(t: TestApp, email = 'dev@example.com') {
  const res = await t.app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: 'correct horse battery', displayName: 'Test Dev' } });
  if (res.statusCode !== 200) throw new Error(`register failed: ${res.body}`);
  const cookie = `cp_session=${res.cookies.find((c) => c.name === 'cp_session')!.value}`;
  const call = async <T = any>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown, expected = 200): Promise<T> => {
    const r = await t.app.inject({ method, url, payload: payload as object, headers: { cookie } });
    if (r.statusCode !== expected) throw new Error(`${method} ${url} → ${r.statusCode}: ${r.body.slice(0, 500)}`);
    return (r.headers['content-type']?.toString().includes('json') ? r.json() : r.rawPayload) as T;
  };
  return { cookie, user: res.json().user as { id: number }, call };
}

import { expect, type Page } from '@playwright/test';

let counter = 0;
export const uniqueEmail = (prefix = 'user') => `${prefix}-${Date.now()}-${counter++}@e2e.test`;
export const PASSWORD = 'correct horse battery';

/** Creates an account through the API (cookie lands in the page context) and opens the app. */
export async function signUp(page: Page, opts: { name?: string; sample?: boolean; open?: string } = {}) {
  const email = uniqueEmail();
  const res = await page.request.post('/api/auth/register', { data: { email, password: PASSWORD, displayName: opts.name ?? 'E2E Tester' } });
  expect(res.ok(), await res.text()).toBeTruthy();
  if (opts.sample) await loadSample(page);
  if (opts.open) await page.goto(opts.open);
  return { email };
}

export async function loadSample(page: Page) {
  const res = await page.request.post('/api/profile/sample');
  expect(res.ok(), await res.text()).toBeTruthy();
}

export async function api<T = any>(page: Page, method: 'get' | 'post' | 'patch' | 'put' | 'delete', url: string, data?: unknown): Promise<T> {
  const res = await page.request[method](url, data === undefined ? undefined : { data });
  expect(res.ok(), `${method.toUpperCase()} ${url} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

/** The labeled demo AI Engineer posting (always seeded). */
export async function demoAiJobId(page: Page): Promise<number> {
  const list = await api<{ items: { id: number; title: string; isDemo: boolean }[] }>(page, 'get', '/api/jobs?role=ai-engineer&limit=50');
  const job = list.items.find((j) => j.isDemo && j.title.startsWith('AI Engineer (LLM'));
  expect(job, 'demo AI Engineer job should be seeded').toBeTruthy();
  return job!.id;
}

/** Collects console errors and uncaught exceptions for the page. */
export function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${page.url()} :: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${page.url()} :: ${e.message}`));
  return errors;
}

/** Answers interview questions until the report appears. */
export async function finishInterview(page: Page, answer: string) {
  const report = page.getByText('Practice score').first();
  const box = page.getByRole('textbox', { name: 'Your answer' });
  for (let i = 0; i < 20; i++) {
    if (await report.isVisible()) return;
    await box.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
    if (!(await box.isVisible())) break;
    await box.fill(answer);
    await page.getByRole('button', { name: 'Submit answer' }).click();
    // The box empties when the next question arrives and disappears with the report.
    await expect(async () => expect(!(await box.isVisible()) || (await box.inputValue()) === '').toBe(true)).toPass({ timeout: 30_000 });
  }
  await expect(report).toBeVisible();
}

export const GOOD_ANSWER = 'First I clarified the goal because users reported slow checkouts. Then I measured latency, I proposed a cache and we cut p95 latency noticeably. I learned to measure before optimizing and would add alerts next time.';

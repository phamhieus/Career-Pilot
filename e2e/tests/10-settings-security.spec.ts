import { expect, test } from '@playwright/test';
import { api, PASSWORD, signUp } from './helpers';

test.describe('Settings', () => {
  test('TC-SET-01 choose an AI provider, save the key, test the connection, remove it', async ({ page }) => {
    await signUp(page, { open: '/settings' });
    await expect(page.getByText(/\(server default\)/)).toBeVisible();
    await page.getByRole('radio', { name: /^Other OpenAI-compatible API/ }).click();
    await page.getByPlaceholder('sk-…').fill('sk-e2e-user-key-9876');
    await page.getByPlaceholder('model-name').fill('mock-model');
    await page.getByPlaceholder('https://your-gateway.example.com/v1').fill('http://localhost:4199/v1');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('openai-compatible · mock-model')).toBeVisible();
    await expect(page.getByText('your key ••••9876')).toBeVisible();
    // The key itself is never sent back to the browser.
    const settings = await api(page, 'get', '/api/settings/ai');
    expect(JSON.stringify(settings)).not.toContain('sk-e2e-user-key');

    await page.getByRole('button', { name: 'Test connection' }).click();
    await expect(page.getByText(/Connection works — openai-compatible · mock-model/)).toBeVisible();

    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Remove my key' }).click();
    await expect(page.getByText(/\(server default\)/)).toBeVisible();
  });

  test('TC-SET-02 unsafe base URLs are rejected', async ({ page }) => {
    await signUp(page);
    const res = await page.request.put('/api/settings/ai', { data: { provider: 'openai-compatible', apiKey: 'sk-test-12345678', model: 'm', baseUrl: 'http://example.com/v1' } });
    expect(res.status()).toBe(400);
    expect(await res.text()).toMatch(/HTTPS/);
  });

  test('TC-SET-03 dark mode toggle', async ({ page }) => {
    await signUp(page, { open: '/dashboard' });
    const html = page.locator('html');
    const before = await html.getAttribute('data-theme');
    await page.getByRole('button', { name: 'Toggle dark mode' }).click();
    await expect(html).not.toHaveAttribute('data-theme', before ?? '');
  });

  test('TC-SET-04 export personal data', async ({ page }) => {
    await signUp(page, { sample: true, open: '/settings' });
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export my data' }).click()]);
    expect(download.suggestedFilename()).toBe('careerpilot-data.json');
  });

  test('TC-SET-05 delete account removes access', async ({ page }) => {
    const { email } = await signUp(page, { sample: true, open: '/settings' });
    const del = page.getByRole('button', { name: 'Delete everything' });
    await expect(del).toBeDisabled();
    await page.getByLabel(/to confirm/).fill(email);
    await del.click();
    await expect(page.getByRole('heading', { name: /Plan your next tech career move/ })).toBeVisible();
    const login = await page.request.post('/api/auth/login', { data: { email, password: PASSWORD } });
    expect(login.status()).toBe(401);
  });
});

test.describe('Security & privacy', () => {
  test('TC-SEC-01 another user cannot open my CV, application or private job', async ({ page, browser }) => {
    await signUp(page, { sample: true });
    const imp = await api(page, 'post', '/api/jobs/import', { text: 'Data Engineer\nRequirements\n- SQL and Python\n- Airflow pipelines and dbt models in production systems' });
    const cv = await api(page, 'post', '/api/resumes', { kind: 'master' });
    const app = await api(page, 'post', '/api/applications', { jobId: imp.jobId });

    const other = await (await browser.newContext()).newPage();
    await signUp(other);
    for (const url of [`/resume/${cv.resume.id}`, `/applications/${app.id}`, `/jobs/${imp.jobId}`]) {
      await other.goto(url);
      await expect(other.getByText('Couldn’t load this')).toBeVisible();
      await expect(other.getByText(/not found/)).toBeVisible();
    }
    await other.close();
  });

  test('TC-SEC-02 cross-origin state-changing requests are blocked', async ({ page }) => {
    await signUp(page);
    const res = await page.request.post('/api/profile/sample', { headers: { origin: 'https://evil.example' } });
    expect(res.status()).toBe(403);
  });

  test('TC-SEC-03 oversized or wrong-type uploads are rejected', async ({ page }) => {
    await signUp(page);
    const res = await page.request.post('/api/profile/import-cv', { multipart: { file: { name: 'cv.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not really a pdf') } } });
    expect(res.status()).toBe(400);
    expect(await res.text()).toMatch(/not a valid PDF/);
  });
});

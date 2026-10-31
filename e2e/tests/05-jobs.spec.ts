import { expect, test } from '@playwright/test';
import { api, demoAiJobId, signUp } from './helpers';

const JD = `Platform AI Engineer (E2E)
Requirements
- 3+ years of Python development
- Building RAG pipelines with a vector database
- REST API design
Nice to have
- Kubernetes`;

test.describe('Job intelligence & job matching', () => {
  test('TC-JOB-01 Cert Trends sync ingests real postings with provenance; re-sync does not duplicate', async ({ page }) => {
    test.setTimeout(180_000);
    await signUp(page, { sample: true, open: '/jobs' });
    await page.getByRole('button', { name: 'Sync now' }).first().click();
    await expect(page.getByText(/\d+ new, \d+ updated, \d+ unchanged/)).toBeVisible({ timeout: 150_000 });
    const before = await api(page, 'get', '/api/jobs?includeDemo=false&limit=1');
    expect(before.total).toBeGreaterThan(300);

    const second = await api(page, 'post', '/api/jobs/sources/cert-trends/sync', {});
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(0);

    await page.reload();
    await page.getByLabel('Show demo postings').uncheck();
    await expect(page.getByText('Demo', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/via (ITviec|Greenhouse|Arbeitnow|MyCareersFuture)/).first()).toBeVisible();
  });

  test('TC-JOB-02 demo jobs are labeled and show a deterministic match', async ({ page }) => {
    await signUp(page, { sample: true });
    await page.goto(`/jobs/${await demoAiJobId(page)}`);
    await expect(page.getByText('This is a fictional demo posting')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your match' })).toBeVisible();
    for (const c of ['Skills', 'Seniority', 'Experience', 'Location & work mode']) await expect(page.getByText(c, { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Critical gaps').or(page.getByText('Unknown — needs evidence')).first()).toBeVisible();
    await expect(page.getByText('Recommended assessments')).toBeVisible();
    await expect(page.getByText('Roadmap nodes for your gaps')).toBeVisible();
    await expect(page.getByText(/not a probability of being hired/)).toBeVisible();
  });

  test('TC-JOB-03 importing a JD creates a private, analyzed job', async ({ page }) => {
    await signUp(page, { sample: true, open: '/jobs' });
    await page.getByRole('button', { name: 'Import a job description' }).click();
    const dialog = page.getByRole('dialog', { name: 'Import a job description' });
    await dialog.getByLabel('Title (optional)').fill('Platform AI Engineer (E2E)');
    await dialog.getByLabel('Company (optional)').fill('Private Co (E2E)');
    await dialog.getByPlaceholder('Paste the full JD…').fill(JD);
    await dialog.getByRole('button', { name: 'Analyze & save' }).click();
    await expect(page).toHaveURL(/\/jobs\/\d+$/);
    await expect(page.getByRole('heading', { name: 'Platform AI Engineer (E2E)' })).toBeVisible();
    await expect(page.getByText('Retrieval-Augmented Generation').first()).toBeVisible();
    await expect(page.getByText(/Requirements extracted by ai:openai-compatible/)).toBeVisible();
    await expect(page.getByText('Not stated')).toBeVisible(); // no salary invented
  });

  test('TC-JOB-04 search and role filter', async ({ page }) => {
    await signUp(page, { open: '/jobs?role=business-analyst' });
    await expect(page.getByRole('link', { name: /Business Analyst \(Banking\)/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /AI Engineer \(LLM Applications\)/ })).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Search jobs' }).fill('zzz-no-such-job');
    await page.getByRole('textbox', { name: 'Search jobs' }).press('Enter');
    await expect(page.getByText('No postings match')).toBeVisible();
  });

  test('TC-JOB-05 a job without JD text can be enriched with a pasted JD (private copy)', async ({ page }) => {
    await signUp(page, { sample: true });
    await api(page, 'post', '/api/jobs/sources/cert-trends/sync', {});
    const list = await api(page, 'get', '/api/jobs?includeDemo=false&limit=5');
    const job = list.items.find((j: { hasDescription: boolean }) => !j.hasDescription);
    await page.goto(`/jobs/${job.id}`);
    await expect(page.getByText(/does not publish the full JD text/)).toBeVisible();
    await page.getByPlaceholder('Paste the job description…').fill(JD);
    await page.getByRole('button', { name: 'Analyze pasted JD' }).click();
    await expect(page).not.toHaveURL(new RegExp(`/jobs/${job.id}$`));
    await expect(page.getByText(/your pasted JD/)).toBeVisible();
  });
});

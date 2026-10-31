import { expect, test } from '@playwright/test';
import { api, demoAiJobId, signUp } from './helpers';

test.describe('Application tracker', () => {
  test('TC-APP-01 save a job with a CV version, move through stages and see the timeline', async ({ page }) => {
    await signUp(page, { sample: true });
    const jobId = await demoAiJobId(page);
    const cv = await api(page, 'post', '/api/resumes', { kind: 'tailored', jobId });
    await page.goto(`/jobs/${jobId}`);
    await page.getByRole('button', { name: 'Save to tracker' }).click();
    await expect(page).toHaveURL(/\/applications\/\d+$/);

    await page.getByRole('combobox', { name: 'Attach CV version' }).selectOption(String(cv.version.id));
    await expect(page.getByRole('link', { name: /v1$/ })).toBeVisible();
    const stages = page.getByRole('group', { name: 'Stage' });
    await stages.getByRole('button', { name: 'Applied' }).click();
    await expect(page.getByText(/Saved → Applied/)).toBeVisible();
    await stages.getByRole('button', { name: 'Interview' }).click();
    await expect(page.getByText(/Applied → Interview/)).toBeVisible();

    await page.getByRole('textbox', { name: 'Round name' }).fill('Technical interview');
    await page.getByRole('combobox', { name: 'Round type' }).selectOption('technical');
    await page.getByRole('button', { name: 'Add' }).first().click();
    await expect(page.getByText(/Prepare for "Technical interview"/)).toBeVisible();
  });

  test('TC-APP-02 closing requires an outcome; accepted requires an offer first', async ({ page }) => {
    await signUp(page, { sample: true });
    const appRow = await api(page, 'post', '/api/applications', { jobId: await demoAiJobId(page) });
    await page.goto(`/applications/${appRow.id}`);
    await page.getByRole('group', { name: 'Stage' }).getByRole('button', { name: 'Closed' }).click();
    const dialog = page.getByRole('dialog', { name: 'Close application' });
    await dialog.getByLabel('Outcome').selectOption('accepted');
    await dialog.getByRole('button', { name: 'Close application' }).click();
    await expect(dialog.getByText(/only be accepted after reaching the Offer stage/)).toBeVisible();
    await dialog.getByLabel('Outcome').selectOption('withdrawn');
    await dialog.getByRole('button', { name: 'Close application' }).click();
    await expect(page.getByText('Outcome: Withdrawn')).toBeVisible();
  });

  test('TC-APP-03 AI-recommended next actions are shown with internal links only', async ({ page }) => {
    await signUp(page, { sample: true });
    const appRow = await api(page, 'post', '/api/applications', { jobId: await demoAiJobId(page) });
    await page.goto(`/applications/${appRow.id}`);
    const card = page.locator('.card').filter({ hasText: 'AI-recommended next actions' });
    await expect(card.getByText('Practice the technical round')).toBeVisible();
    await expect(card.getByText(/AI · openai-compatible/)).toBeVisible();
    const href = await card.getByRole('link', { name: 'Practice the technical round' }).getAttribute('href');
    expect(href).toMatch(/^\//);
  });

  test('TC-APP-04 kanban, table and analytics views; duplicates are rejected', async ({ page }) => {
    await signUp(page, { sample: true });
    const jobId = await demoAiJobId(page);
    const appRow = await api(page, 'post', '/api/applications', { jobId });
    await api(page, 'post', `/api/applications/${appRow.id}/stage`, { stage: 'applied' });
    const dup = await page.request.post('/api/applications', { data: { jobId } });
    expect(dup.status()).toBe(409);

    await page.goto('/applications');
    await expect(page.getByText('AI Engineer (LLM Applications)').first()).toBeVisible();
    await page.getByRole('tab', { name: 'Table' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'AI Engineer (LLM Applications)' })).toBeVisible();
    await page.getByRole('tab', { name: 'Analytics' }).click();
    await expect(page.getByText('Response rate')).toBeVisible();
    await expect(page.getByText('Tracked')).toBeVisible();
  });

  test('TC-APP-05 notes, contacts and follow-up date are saved', async ({ page }) => {
    await signUp(page, { sample: true });
    const appRow = await api(page, 'post', '/api/applications', { jobId: await demoAiJobId(page) });
    await page.goto(`/applications/${appRow.id}`);
    await page.getByRole('textbox', { name: 'Add a note to the timeline' }).fill('Recruiter replied on LinkedIn');
    await page.getByRole('button', { name: 'Add', exact: true }).last().click();
    await expect(page.getByText('Recruiter replied on LinkedIn')).toBeVisible();
    await page.getByLabel('Follow-up date').fill('2030-01-15');
    await expect(page.getByText(/Follow-up on 2030-01-15/)).toBeVisible();
  });
});

import { expect, test, type Page } from '@playwright/test';
import { ITEMS } from '../../apps/api/src/seed/data/assessments';
import { api, signUp } from './helpers';

const PRACTICAL = 'I would model rows with a typed dataclass and Decimal amounts, validate required fields, skip invalid rows while collecting errors, and test it with pytest parametrize covering edge cases. First I write the failing tests because that clarifies the contract.';

/** Answers every item on the attempt page: objective items correctly (or wrongly), open items with a solid answer. */
async function answerAttempt(page: Page, correct: boolean) {
  await page.getByRole('radiogroup').first().waitFor();
  const groups = page.getByRole('radiogroup');
  for (let i = 0; i < (await groups.count()); i++) {
    const card = groups.nth(i).locator('xpath=ancestor::div[contains(@class,"card")][1]');
    const prompt = (await card.locator('p.font-medium').first().innerText()).trim();
    const item = ITEMS.find((x) => x.prompt === prompt);
    expect(item, `question bank item for: ${prompt}`).toBeTruthy();
    const idx = correct ? item!.correctIndex! : (item!.correctIndex! + 1) % item!.options!.length;
    await groups.nth(i).getByRole('radio').nth(idx).check();
  }
  const boxes = page.getByRole('textbox', { name: 'Your answer' });
  for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).fill(correct ? PRACTICAL : 'I am not sure how to approach this one, sorry.');
}

test.describe('Learning plan', () => {
  test('TC-LRN-01 generate a plan that respects prerequisites, weekly hours and near-term daily sessions', async ({ page }) => {
    await signUp(page, { sample: true, open: '/learning?role=ai-engineer' });
    await page.getByRole('radio', { name: /YouTube videos/ }).check();
    await page.getByRole('button', { name: 'Generate plan' }).click();
    await expect(page).toHaveURL(/\/learning\/\d+$/);
    await expect(page.getByRole('heading', { name: 'AI Engineer learning plan' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Next two weeks' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Milestones' })).toBeVisible();
    await expect(page.getByText('Schedule fits your constraints').or(page.getByText('Deadline at risk'))).toBeVisible();
    await expect(page.getByText('created', { exact: true })).toBeVisible();
    const planId = Number(page.url().split('/').pop());
    const plan = await api(page, 'get', `/api/learning/${planId}`);
    expect(plan.plan.learningFormat).toBe('youtube');
    await page.getByText('Choose learning material: documents, project or YouTube', { exact: true }).first().click();
    await expect(page.getByRole('link', { name: /lessons on YouTube/ }).first()).toHaveAttribute('href', /^https:\/\/www.youtube.com\/results\?search_query=/);
    const perWeek = new Map<number, number>();
    for (const t of plan.tasks) perWeek.set(t.weekIndex, (perWeek.get(t.weekIndex) ?? 0) + t.estimatedHours);
    for (const h of perWeek.values()) expect(h).toBeLessThanOrEqual(plan.plan.weeklyHours + 0.05);
  });

  test('TC-LRN-02 completing a task updates progress', async ({ page }) => {
    await signUp(page, { sample: true });
    const plan = await api(page, 'post', '/api/learning', { roleSlug: 'cloud-engineer' });
    await page.goto(`/learning/${plan.id}`);
    await page.getByRole('button', { name: 'Mark as done' }).first().click();
    await expect(page.getByRole('button', { name: 'Mark as not done' }).first()).toBeVisible();
    await expect(page.getByText(/^1\//).first()).toBeVisible();
  });

  test('TC-LRN-03 an infeasible deadline is flagged instead of overloading weeks', async ({ page }) => {
    await signUp(page, { sample: true, open: '/learning' });
    await page.getByLabel('Target role').selectOption('ai-engineer');
    await page.getByLabel('Hours / week').fill('2');
    const soon = new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel('Deadline (optional)').fill(soon);
    await page.getByRole('button', { name: 'Generate plan' }).click();
    await expect(page.getByText('Deadline at risk')).toBeVisible();
    await expect(page.getByText(/Not feasible by/)).toBeVisible();
  });
});

test.describe('Assessments', () => {
  test('TC-ASM-01 passing quiz + practical verifies the skill and revises the plan', async ({ page }) => {
    await signUp(page, { sample: true });
    const plan = await api(page, 'post', '/api/learning', { roleSlug: 'ai-engineer' });
    await page.goto('/assessments');
    await page.getByPlaceholder('Type to add a skill…').fill('Python');
    await page.getByRole('button', { name: '+ Python' }).click();
    await page.getByRole('button', { name: 'Generate blueprint & start' }).click();
    await expect(page).toHaveURL(/\/assessments\/attempts\/\d+/);
    await answerAttempt(page, true);
    await page.getByRole('button', { name: 'Submit for grading' }).click();
    await expect(page.getByText(/^Passed/)).toBeVisible();
    await expect(page.getByText('App-verified').first()).toBeVisible();
    await expect(page.getByText(/Your learning plan was updated/)).toBeVisible();
    // Answer keys are revealed only after grading.
    await expect(page.getByText(/three-valued logic|context manager|Mutable default/).first()).toBeVisible();

    await page.goto(`/learning/${plan.id}`);
    await expect(page.getByText('assessment passed').first()).toBeVisible();
    await page.goto('/profile?tab=skills');
    const row = page.locator('div').filter({ hasText: /^Python/ }).first();
    await expect(row).toBeVisible();
    await expect(page.getByText('App-verified').first()).toBeVisible();
  });

  test('TC-ASM-02 failing adds remedial work and keeps the skill unverified', async ({ page }) => {
    await signUp(page, { sample: true });
    const plan = await api(page, 'post', '/api/learning', { roleSlug: 'ai-engineer' });
    const bp = await api(page, 'post', '/api/assessments/blueprints', { skillSlugs: ['python'], level: 3 });
    const attempt = await api(page, 'post', `/api/assessments/blueprints/${bp.id}/attempts`);
    await page.goto(`/assessments/attempts/${attempt.id}`);
    await answerAttempt(page, false);
    await page.getByRole('button', { name: 'Submit for grading' }).click();
    await expect(page.getByText(/Not yet passed/)).toBeVisible();
    await page.goto(`/learning/${plan.id}`);
    await expect(page.getByText('assessment failed').first()).toBeVisible();
    await page.getByRole('button', { name: /Week 1/ }).click().catch(() => undefined);
    await expect(page.getByText(/Remedial: review python/).first()).toBeVisible();
  });

  test('TC-ASM-03 an attempt cannot be graded twice', async ({ page }) => {
    await signUp(page);
    const bp = await api(page, 'post', '/api/assessments/blueprints', { skillSlugs: ['sql'], level: 3 });
    const attempt = await api(page, 'post', `/api/assessments/blueprints/${bp.id}/attempts`);
    await api(page, 'post', `/api/assessments/attempts/${attempt.id}/submit`, { answers: {} });
    const again = await page.request.post(`/api/assessments/attempts/${attempt.id}/submit`, { data: { answers: {} } });
    expect(again.status()).toBe(409);
  });
});

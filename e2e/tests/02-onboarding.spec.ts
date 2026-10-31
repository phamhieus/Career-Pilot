import { expect, test } from '@playwright/test';
import { api, signUp } from './helpers';

test.describe('Getting-started guide', () => {
  test('TC-ONB-01 welcome page lists 15 steps in 5 phases with step 1 next', async ({ page }) => {
    await signUp(page, { open: '/welcome' });
    for (const phase of ['Set up your profile', 'Explore roles', 'Pick a job', 'Learn & verify', 'Apply']) {
      await expect(page.getByRole('heading', { name: phase })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: /Track the application and follow next actions/ })).toBeVisible();
    // Step 1 is expanded with its why/how and a call to action.
    await expect(page.getByText('How to do it')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open profile' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Start step 1' })).toBeVisible();
  });

  test('TC-ONB-02 loading the sample profile completes step 1 and the guide bar moves on', async ({ page }) => {
    await signUp(page, { open: '/welcome' });
    await page.getByRole('button', { name: 'Load sample profile' }).click();
    await expect(page.getByText('Sample loaded — step 1 is done.')).toBeVisible();
    await page.goto('/atlas');
    const guide = page.getByRole('region', { name: 'Getting started guide' });
    await expect(guide).toContainText('Step 2 of 15');
    await expect(guide).toContainText('Complete a discovery or skill interview');
    await guide.getByRole('link', { name: 'Start interview' }).click();
    await expect(page).toHaveURL(/\/interviews\/new\?mode=discovery/);
    // On the step's own page the bar explains what to do here.
    await guide.getByRole('button', { name: 'What to do here' }).click();
    await expect(guide.getByText('Click “Build blueprint”, then “Start interview”.')).toBeVisible();
  });

  test('TC-ONB-03 progress is derived from real activity (roles, matching, roadmap)', async ({ page }) => {
    await signUp(page, { sample: true });
    await page.goto('/atlas/ai-engineer');
    await page.goto('/atlas/cloud-engineer');
    await page.goto('/matching?role=ai-engineer');
    await expect(page.getByText('Capability fit')).toBeVisible();
    await page.goto('/roadmap/ai-engineer');
    await expect(page.locator('.react-flow__node').first()).toBeVisible();
    const ob = await api(page, 'get', '/api/onboarding');
    const done = Object.fromEntries(ob.steps.map((s: { key: string; done: boolean }) => [s.key, s.done]));
    expect(done).toMatchObject({ profile: true, roles: true, matching: true, roadmap: true, discovery: false });
  });

  test('TC-ONB-04 the guide bar can be hidden and shown again', async ({ page }) => {
    await signUp(page, { open: '/dashboard' });
    const guide = page.getByRole('region', { name: 'Getting started guide' });
    await expect(guide).toBeVisible();
    await guide.getByRole('button', { name: 'Hide the guide' }).click();
    await expect(guide).toBeHidden();
    await page.getByRole('link', { name: /Getting started/ }).first().click();
    await expect(page).toHaveURL(/\/welcome/);
    await page.getByRole('button', { name: /Show the step-by-step guide bar/ }).click();
    await page.goto('/jobs');
    await expect(page.getByRole('region', { name: 'Getting started guide' })).toBeVisible();
  });

  test('TC-ONB-05 dashboard shows the next getting-started step', async ({ page }) => {
    await signUp(page, { sample: true, open: '/dashboard' });
    await expect(page.getByText(/Next: step 2 — Complete a discovery or skill interview/)).toBeVisible();
    await page.getByRole('link', { name: /Open the guide/ }).click();
    await expect(page).toHaveURL(/\/welcome/);
  });
});

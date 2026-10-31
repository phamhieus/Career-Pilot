import { expect, test } from '@playwright/test';
import { demoAiJobId, finishInterview, GOOD_ANSWER, signUp } from './helpers';

test.describe('AI mock interviews', () => {
  test('TC-INT-01 job-specific interview: blueprint, one question at a time, hidden answers, report with AI coaching', async ({ page }) => {
    await signUp(page, { sample: true });
    await page.goto(`/jobs/${await demoAiJobId(page)}`);
    await page.getByRole('link', { name: 'Mock interview', exact: true }).click();
    await expect(page.getByText(/AI interviewer: openai-compatible · mock-model/)).toBeVisible();
    await page.getByLabel('Round').selectOption('technical');
    await page.getByRole('button', { name: 'Build blueprint' }).click();

    await expect(page.getByText('Interview blueprint')).toBeVisible();
    await expect(page.getByText(/Required by AI Engineer \(LLM Applications\)/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Start interview' }).click();
    await expect(page.getByText(/E2E question \d+/)).toBeVisible();
    await expect(page.getByText('Question 1', { exact: true })).toBeVisible();
    // Model answers stay hidden during the formal interview.
    await expect(page.getByText('A strong answer would cover')).toHaveCount(0);

    await finishInterview(page, GOOD_ANSWER);
    await expect(page.getByText('Rubric breakdown')).toBeVisible();
    await expect(page.getByText(/AI coaching/)).toBeVisible();
    await expect(page.getByText('Good structure overall; add measurable outcomes')).toBeVisible();
    await expect(page.getByText('Coach tip').first()).toBeVisible();
    await expect(page.getByText('A strong answer would cover').first()).toBeVisible();
    await expect(page.getByText(/never verify coding or production experience/)).toBeVisible();
  });

  test('TC-INT-02 discovery interview suggests profile updates the user can apply', async ({ page }) => {
    await signUp(page, { sample: true, open: '/interviews/new?mode=discovery' });
    await page.getByRole('button', { name: 'Build blueprint' }).click();
    await expect(page.getByText('Your background')).toBeVisible();
    await page.getByRole('radio', { name: 'Working outside tech' }).check();
    await page.getByText('Optional background details', { exact: true }).click();
    await page.getByLabel('Job title').fill('Accountant');
    await page.getByLabel('Years of work experience').fill('4');
    await page.getByRole('button', { name: 'Continue' }).click();
    for (let i = 0; i < 8; i++) {
      await expect(page.getByText(`Question ${i + 1}`)).toBeVisible();
      await page.locator('input[name="discovery-choice"]').nth(i % 2).check();
      if (i === 0) {
        await page.getByText('Add an example or note (optional)', { exact: true }).click();
        await page.getByRole('textbox', { name: 'Note' }).fill('I love researching new AI tools.');
      }
      await page.getByRole('button', { name: 'Next' }).click();
    }
    await expect(page.getByText('Suggested profile updates')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Top 3 Career Matches' })).toBeVisible();
    await expect(page.getByText('Practice score')).toHaveCount(0);
    await expect(page.getByText('4 years of experience')).toBeVisible();
    await page.getByRole('button', { name: 'Apply to my profile' }).click();
    await expect(page.getByText(/Applied —/)).toBeVisible();
  });

  test('TC-INT-03 focused practice shows feedback after each answer', async ({ page }) => {
    await signUp(page, { sample: true, open: '/interviews/new?mode=focused&role=backend-engineer' });
    await page.getByLabel('Target role').selectOption('backend-engineer');
    await page.getByRole('button', { name: 'Build blueprint' }).click();
    await page.getByRole('button', { name: 'Start interview' }).click();
    await page.getByRole('textbox', { name: 'Your answer' }).fill(GOOD_ANSWER);
    await page.getByRole('button', { name: 'Submit answer' }).click();
    await expect(page.getByText(/Feedback on your last answer/)).toBeVisible();
  });

  test('TC-INT-04 a session can be abandoned and is listed with its status', async ({ page }) => {
    await signUp(page, { sample: true, open: '/interviews/new?role=cloud-engineer' });
    await page.getByLabel('Target role').selectOption('cloud-engineer');
    await page.getByRole('button', { name: 'Build blueprint' }).click();
    await page.getByRole('button', { name: 'Start interview' }).click();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Abandon' }).click();
    await expect(page.getByText(/abandoned before a report/)).toBeVisible();
    await page.goto('/interviews');
    await expect(page.getByText('Abandoned').first()).toBeVisible();
  });

  test('TC-INT-05 job-specific mode requires a job', async ({ page }) => {
    await signUp(page, { sample: true, open: '/interviews/new?mode=job_specific' });
    await page.getByRole('button', { name: 'Build blueprint' }).click();
    await expect(page.getByText('Choose a job')).toBeVisible();
  });
});

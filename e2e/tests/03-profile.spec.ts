import { expect, test } from '@playwright/test';
import { api, signUp } from './helpers';

const CV = `Minh Tran
Backend Developer

Experience
Backend Developer at Example Retail Platform  Mar 2021 - Present
- Built REST APIs in Java and Spring Boot for order flows

Skills
Java, PostgreSQL, Docker`;

test.describe('Career profile', () => {
  test('TC-PRO-01 basics are saved and persist after reload', async ({ page }) => {
    await signUp(page, { open: '/profile' });
    await page.getByLabel('Headline').fill('Backend developer moving into AI');
    await page.getByLabel('Location').fill('Ho Chi Minh City');
    await page.getByRole('button', { name: 'Save basics' }).click();
    await expect(page.getByText('Saved')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Headline')).toHaveValue('Backend developer moving into AI');
  });

  test('TC-PRO-02 add a work entry; skills are detected from the text', async ({ page }) => {
    await signUp(page, { open: '/profile?tab=experience' });
    await page.getByRole('button', { name: 'Add entry' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add entry' });
    await dialog.getByLabel('Title').fill('Software Engineer');
    await dialog.getByLabel('Organization').fill('Acme (test)');
    await dialog.getByLabel('Start (YYYY-MM)').fill('2022-01');
    await dialog.getByLabel('Highlights (one per line)').fill('Built REST APIs with Python and PostgreSQL\nContainerized services with Docker');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Software Engineer')).toBeVisible();
    for (const slug of ['python', 'sql', 'containers']) await expect(page.getByText(slug, { exact: true }).first()).toBeVisible();
  });

  test('TC-PRO-03 CV import creates unconfirmed entries that the user confirms', async ({ page }) => {
    await signUp(page, { open: '/profile?tab=experience' });
    await page.getByRole('button', { name: 'Import CV' }).click();
    const dialog = page.getByRole('dialog', { name: 'Import CV' });
    await dialog.getByPlaceholder('Paste your CV text…').fill(CV);
    await dialog.getByRole('button', { name: 'Extract' }).click();
    await expect(dialog.getByText(/Extracted 1 entries/)).toBeVisible();
    await expect(dialog.getByText(/AI · openai-compatible/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Review entries' }).click();
    await expect(page.getByText(/need your confirmation/)).toBeVisible();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByRole('button', { name: 'Confirm' })).toHaveCount(0);
    // CV skills are recorded as claims, not verified skills.
    await page.getByRole('tab', { name: /Skills/ }).click();
    await expect(page.getByText('CV claim').first()).toBeVisible();
  });

  test('TC-PRO-04 self-reported skills and ratings', async ({ page }) => {
    await signUp(page, { open: '/profile?tab=skills' });
    await page.getByPlaceholder('Type to add a skill…').fill('Kubernetes');
    await page.getByRole('button', { name: '+ Kubernetes' }).click();
    await page.getByRole('button', { name: 'Add at level 3' }).click();
    const rating = page.getByRole('radiogroup', { name: 'Self-rating for Kubernetes' });
    await expect(rating.getByRole('radio', { name: '3' })).toHaveAttribute('aria-checked', 'true');
    await rating.getByRole('radio', { name: '5' }).click();
    await expect(rating.getByRole('radio', { name: '5' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('Self-reported').first()).toBeVisible();
    const prof = await api(page, 'get', '/api/profile');
    expect(prof.skills.find((s: { slug: string }) => s.slug === 'kubernetes')).toMatchObject({ status: 'self_reported', selfRating: 5 });
  });

  test('TC-PRO-05 interests, values and constraints are saved', async ({ page }) => {
    await signUp(page, { open: '/profile?tab=preferences' });
    await page.getByRole('button', { name: 'Autonomy' }).click();
    await page.getByRole('button', { name: 'AI & Data' }).click();
    await page.getByRole('button', { name: 'Save preferences' }).click();
    await expect(page.getByText('Saved')).toBeVisible();
    await page.getByRole('tab', { name: 'Constraints & goals' }).click();
    await page.getByLabel('Learning hours per week').fill('12');
    await page.getByRole('button', { name: 'remote' }).first().click(); // the Markets group comes first
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved')).toBeVisible();
    const prof = await api(page, 'get', '/api/profile');
    expect(prof.profile).toMatchObject({ weeklyLearningHours: 12, workValues: ['autonomy'], interests: ['ai-data'], markets: ['remote'] });
  });
});

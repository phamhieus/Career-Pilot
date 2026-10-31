import { expect, test } from '@playwright/test';
import { demoAiJobId, signUp, trackErrors } from './helpers';

const ROUTES = ['/dashboard', '/welcome', '/atlas', '/atlas/backend-engineer', '/career-map', '/roadmap/ai-engineer', '/profile', '/matching', '/jobs', '/market', '/assessments', '/learning', '/interviews', '/interviews/new', '/resume', '/applications', '/settings'];

test.describe('Smoke & responsive', () => {
  test('TC-SMK-01 every main route renders without console errors', async ({ page }) => {
    const errors = trackErrors(page);
    await signUp(page, { sample: true });
    const jobId = await demoAiJobId(page);
    for (const route of [...ROUTES, `/jobs/${jobId}`]) {
      await page.goto(route);
      await expect(page.locator('h1').first(), route).toBeVisible();
      await expect(page.getByText('Couldn’t load this'), route).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });

  test('TC-SMK-02 market view separates history, signals and forecast and never invents a trend', async ({ page }) => {
    await signUp(page, { open: '/market' });
    await page.getByLabel('Include demo postings').check();
    for (const h of ['Historical observations', 'Current market signals', 'Forecast scenarios', 'Source coverage & freshness']) await expect(page.getByRole('heading', { name: h })).toBeVisible();
    await expect(page.getByText('Insufficient historical data').first()).toBeVisible();
    await expect(page.getByText(/fictional demo posting\(s\) are included/)).toBeVisible();
  });

  test('TC-SMK-03 market figures, rows and tags open a detail popup that drills further', async ({ page }) => {
    await signUp(page, { open: '/market' });
    await page.getByLabel('Include demo postings').check();
    await page.getByRole('button', { name: /^Active/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Active postings' })).toBeVisible();
    await expect(dialog.getByRole('link').first()).toBeVisible();
    await dialog.locator('ul button').first().click(); // drill into a breakdown row
    await expect(dialog.getByRole('heading', { name: 'Active postings' })).toHaveCount(0);
    await expect(dialog.getByRole('link').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await page.getByText('Tables', { exact: true }).click();
    const roleTable = page.locator('table').filter({ has: page.getByRole('columnheader', { name: 'Active postings' }) });
    await roleTable.locator('tbody tr').first().click(); // first role row
    await expect(page.getByRole('dialog').getByText('Active postings whose title maps to this role.')).toBeVisible();
  });

  test('TC-RSP-01 mobile layout: menu, navigation and no horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signUp(page, { sample: true, open: '/dashboard' });
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('link', { name: 'Jobs' }).click();
    await expect(page).toHaveURL(/\/jobs/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('TC-A11Y-01 keyboard users can skip to content and every form control has a label', async ({ page }) => {
    await signUp(page, { open: '/profile' });
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    const unlabeled = await page.evaluate(() => [...document.querySelectorAll('input:not([type=hidden]), select, textarea')].filter((el) => {
      const id = el.getAttribute('id');
      return !el.closest('label') && !el.getAttribute('aria-label') && !(id && document.querySelector(`label[for="${id}"]`));
    }).length);
    expect(unlabeled).toBe(0);
  });
});

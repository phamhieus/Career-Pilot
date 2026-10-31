import { expect, test } from '@playwright/test';
import { api, signUp } from './helpers';

test('TC-DEMO-TRACKER Dinh Dieu data populates the tracker and repeat loading does not duplicate it', async ({ page }) => {
  await signUp(page, { open: '/applications' });
  await page.getByRole('button', { name: 'Load demo tracker — Dinh Dieu', exact: true }).click();
  await expect(page.getByText(/10 demo applications across every stage/)).toBeVisible();
  await page.getByRole('tab', { name: 'Table', exact: true }).click();
  await expect(page.getByRole('row')).toHaveCount(11);
  const first = (await api(page, 'get', '/api/applications'))[0];
  await page.goto(`/applications/${first.id}`);
  await expect(page.getByRole('heading', { name: 'Timeline', exact: true })).toBeVisible();
  await expect(page.getByText('Fictional demo tracker created for Dinh Dieu.')).toBeVisible();
  await page.goto('/applications');
  await page.getByRole('button', { name: 'Load demo tracker — Dinh Dieu', exact: true }).click();
  expect(await api(page, 'get', '/api/applications')).toHaveLength(10);
});

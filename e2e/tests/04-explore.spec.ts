import { expect, test } from '@playwright/test';
import { signUp } from './helpers';

test.describe('Career Atlas, Career Map and Roadmaps', () => {
  test.beforeEach(async ({ page }) => { await signUp(page, { sample: true }); });

  test('TC-ATL-01 atlas lists families and filters roles', async ({ page }) => {
    await page.goto('/atlas');
    await expect(page.getByRole('heading', { name: 'Software Engineering' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tech Leadership & Architecture' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Search roles' }).fill('cloud');
    await expect(page.getByRole('link', { name: /Cloud Engineer/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Business Analyst/ })).toHaveCount(0);
  });

  test('TC-ATL-02 role page shows matrix, levels and a sourced outlook', async ({ page }) => {
    await page.goto('/atlas/ai-engineer');
    await expect(page.getByRole('heading', { name: 'AI Engineer', level: 1 })).toBeVisible();
    for (const h of ['Typical responsibilities', 'Career path & level requirements', 'Skills to reach junior', 'Future outlook', 'Career paths & transitions']) {
      await expect(page.getByRole('heading', { name: h })).toBeVisible();
    }
    await expect(page.getByText('Observed', { exact: true })).toBeVisible();
    await expect(page.getByText('Speculation — CareerPilot editorial')).toBeVisible();
    await expect(page.getByText('Critical').first()).toBeVisible();
    const source = page.getByRole('link', { name: /O\*NET OnLine/ }).first();
    await expect(source).toHaveAttribute('href', /onetonline\.org/);
    await expect(source).toHaveAttribute('target', '_blank');
    await page.getByRole('button', { name: /Stage 2 middle/i }).click();
    await expect(page.getByRole('heading', { name: 'Junior → Middle', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Skills to reach middle' })).toBeVisible();
    await page.getByRole('link', { name: 'Check my gaps for middle' }).click();
    await expect(page.getByLabel('Target level')).toHaveValue('middle');
  });

  test('TC-MAP-01 career map shows transitions for a selected role', async ({ page }) => {
    await page.goto('/career-map');
    await page.locator('.react-flow__node').filter({ hasText: /^Backend Engineer/ }).first().click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText('Can move to')).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'AI Engineer' })).toBeVisible();
    await expect(drawer.getByText('Moderate').or(drawer.getByText('Significant')).first()).toBeVisible();
  });

  test('TC-RDM-01 roadmap node details, statuses and group collapse', async ({ page }) => {
    await page.goto('/roadmap/backend-engineer');
    await expect(page.getByText(/Not started \(\d+\)/)).toBeVisible();
    await page.locator('.react-flow__node').filter({ hasText: /^SQL/ }).first().click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText('Learning outcome')).toBeVisible();
    await expect(drawer.getByText('Verification')).toBeVisible();
    await expect(drawer.getByRole('link', { name: /PostgreSQL Tutorial/ })).toHaveAttribute('href', /postgresql\.org/);
    await expect(drawer.getByRole('button', { name: 'Assess this skill' })).toBeVisible();
    await page.keyboard.press('Escape');
    // Collapse the "data" group: its nodes are replaced by one group node.
    await page.getByRole('button', { name: '− data' }).click();
    await expect(page.locator('.react-flow__node').filter({ hasText: /^SQL/ })).toHaveCount(0);
    await expect(page.locator('.react-flow__node').filter({ hasText: /^data/ })).toBeVisible();
  });

  test('TC-RDM-02 non-curated roadmaps are labeled as auto-generated', async ({ page }) => {
    await page.goto('/roadmap/frontend-engineer');
    await expect(page.getByText(/auto-generated from the role’s skill matrix/)).toBeVisible();
  });

  test('TC-RDM-03 starting an assessment from a roadmap node', async ({ page }) => {
    await page.goto('/roadmap/ai-engineer');
    await page.locator('.react-flow__node').filter({ hasText: /^Python/ }).first().click();
    await page.getByRole('button', { name: 'Assess this skill' }).click();
    await expect(page).toHaveURL(/\/assessments\/attempts\/\d+/);
    await expect(page.getByRole('heading', { name: /Python — level/ })).toBeVisible();
  });
});

test.describe('Role matching', () => {
  test('TC-MAT-01 four independent dimensions, critical gate and unknown evidence', async ({ page }) => {
    await signUp(page, { sample: true, open: '/matching?role=ai-engineer' });
    for (const d of ['Capability fit', 'Interest & work fit', 'Growth potential', 'Market opportunity']) await expect(page.getByText(d, { exact: true })).toBeVisible();
    await expect(page.getByText(/Critical skill gate: (blocked|needs evidence)/)).toBeVisible();
    await expect(page.getByRole('heading', { name: /Why your capability score is/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Skills you can carry into this role' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your skills vs role requirements' })).toBeVisible();
    const ragRow = page.getByRole('row').filter({ hasText: 'Retrieval-Augmented Generation' });
    await expect(ragRow.getByText('Unknown')).toBeVisible();
    await expect(ragRow.getByText('Excluded from known-skill score.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Needs stronger evidence', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: 'Retrieval-Augmented Generation' })).toHaveCount(0);
    await page.getByRole('button', { name: 'All skills', exact: true }).click();
    await page.getByRole('heading', { name: /Why your capability score is/ }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath('matching-explanation.png') });
    await expect(page.getByText(/not probabilities of being hired/)).toBeVisible();
  });

  test('TC-MAT-02 changing the target level changes required levels', async ({ page }) => {
    await signUp(page, { sample: true, open: '/matching?role=ai-engineer' });
    const pythonRow = page.getByRole('row').filter({ hasText: /^Python/ });
    await expect(pythonRow.getByRole('cell', { name: 'L3', exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: 'Target level' }).selectOption('senior');
    await expect(pythonRow.getByRole('cell', { name: 'L4', exact: true })).toBeVisible();
  });

  test('TC-MAT-03 roles can be sorted by each dimension', async ({ page }) => {
    await signUp(page, { sample: true, open: '/matching' });
    await page.getByRole('tab', { name: 'Interest' }).click();
    await expect(page.getByRole('tab', { name: 'Interest' })).toHaveAttribute('aria-selected', 'true');
  });
});

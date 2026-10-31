import { expect, test } from '@playwright/test';
import { api, demoAiJobId, signUp } from './helpers';

test.describe('CV builder', () => {
  test('TC-CV-01 master CV is generated from confirmed evidence with a live preview and quality report', async ({ page }) => {
    await signUp(page, { sample: true, name: 'Minh Tran', open: '/resume' });
    await page.getByRole('button', { name: 'Generate from my evidence' }).click();
    await expect(page).toHaveURL(/\/resume\/\d+$/);
    const preview = page.getByLabel('CV preview');
    await expect(preview.getByText('Minh Tran')).toBeVisible();
    await expect(preview.getByText('Example Retail Platform (sample)').first()).toBeVisible();
    for (const q of ['Evidence coverage', 'Clarity', 'Completeness', 'Format compatibility']) await expect(page.getByText(q, { exact: true })).toBeVisible();
    await expect(page.getByText(/No tool can guarantee passing an applicant tracking system/)).toBeVisible();
  });

  test('TC-CV-02 tailored CV flags AI-added claims; reverting and saving creates v2', async ({ page }) => {
    await signUp(page, { sample: true });
    await page.goto(`/jobs/${await demoAiJobId(page)}`);
    await page.getByRole('button', { name: 'Tailor my CV' }).click();
    await expect(page).toHaveURL(/\/resume\/\d+$/);
    await expect(page.getByText(/need your confirmation/)).toBeVisible();
    await expect(page.getByText(/Number "40%" does not appear in the source evidence/)).toBeVisible();
    await page.getByRole('button', { name: 'Revert to source' }).first().click();
    await page.getByRole('textbox', { name: 'Version note' }).fill('Reverted invented metric');
    await page.getByRole('button', { name: 'Save as v2' }).click();
    await expect(page.getByText(/Tailored CV · v2/)).toBeVisible();
    await expect(page.getByText(/need your confirmation/)).toHaveCount(0);
    await page.getByRole('tab', { name: /Versions/ }).click();
    await expect(page.getByText('Reverted invented metric')).toBeVisible();
  });

  test('TC-CV-03 locked bullets survive regeneration; versions can be restored', async ({ page }) => {
    await signUp(page, { sample: true });
    const jobId = await demoAiJobId(page);
    const cv = await api(page, 'post', '/api/resumes', { kind: 'tailored', jobId });
    await page.goto(`/resume/${cv.resume.id}`);
    await page.getByRole('button', { name: 'Lock bullet' }).first().click();
    await page.getByRole('button', { name: 'Save as v2' }).click();
    await expect(page.getByText(/· v2/)).toBeVisible();
    await page.getByRole('button', { name: 'Regenerate (keeps locked)' }).click();
    await expect(page.getByText(/· v3/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unlock bullet' }).first()).toBeVisible();
    await page.getByRole('tab', { name: /Versions/ }).click();
    await page.getByRole('button', { name: 'Restore version 1' }).click();
    await expect(page.getByText(/· v4/)).toBeVisible();
  });

  test('TC-CV-04 export to PDF and DOCX', async ({ page }) => {
    await signUp(page, { sample: true });
    const cv = await api(page, 'post', '/api/resumes', { kind: 'master' });
    await page.goto(`/resume/${cv.resume.id}`);
    const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PDF' }).click()]);
    expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
    const [docx] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'DOCX' }).click()]);
    expect(docx.suggestedFilename()).toMatch(/\.docx$/);
    const res = await page.request.get(`/api/resumes/${cv.resume.id}/export?format=pdf`);
    expect((await res.body()).subarray(0, 4).toString()).toBe('%PDF');
  });

  test('TC-CV-05 Vietnamese CV uses Vietnamese section titles', async ({ page }) => {
    await signUp(page, { sample: true, open: '/resume' });
    await page.getByRole('combobox').nth(1).selectOption('vi');
    await page.getByRole('button', { name: 'Generate from my evidence' }).click();
    await expect(page.getByLabel('CV preview').getByText('Kinh nghiệm làm việc')).toBeVisible();
  });

  test('TC-CV-06 user-written bullets without evidence are flagged until linked or confirmed', async ({ page }) => {
    await signUp(page, { sample: true });
    const cv = await api(page, 'post', '/api/resumes', { kind: 'master' });
    await page.goto(`/resume/${cv.resume.id}`);
    await page.getByRole('button', { name: 'Add bullet' }).nth(1).click();
    await page.getByRole('textbox', { name: 'Bullet text' }).last().fill('Led a team of 12 engineers');
    await page.getByRole('button', { name: 'Save as v2' }).click();
    await expect(page.getByText(/need your confirmation/)).toBeVisible();
    await page.getByLabel('I confirm this is true').last().check();
    await page.getByRole('button', { name: 'Save as v3' }).click();
    await expect(page.getByText(/need your confirmation/)).toHaveCount(0);
  });
});

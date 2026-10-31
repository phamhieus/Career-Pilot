import { expect, test } from '@playwright/test';
import { PASSWORD, uniqueEmail } from './helpers';

test.describe('Authentication', () => {
  test('TC-AUTH-01 new account lands on the getting-started guide', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Plan your next tech career move/ })).toBeVisible();
    await page.getByRole('textbox', { name: 'Display name' }).fill('Lan Nguyen');
    await page.getByRole('textbox', { name: 'Email' }).fill(uniqueEmail('signup'));
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).last().click();
    await expect(page).toHaveURL(/\/welcome$/);
    await expect(page.getByRole('heading', { name: /Welcome, Lan/ })).toBeVisible();
    await expect(page.getByText('0/15 done')).toBeVisible();
  });

  test('TC-AUTH-02 form validation messages', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('textbox', { name: 'Email' }).fill('not-an-email');
    await page.getByLabel('Password').fill('short');
    await page.getByRole('button', { name: 'Create account' }).last().click();
    await expect(page.getByText('Enter a valid email')).toBeVisible();
    await expect(page.getByText('At least 8 characters')).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test('TC-AUTH-03 duplicate email is rejected', async ({ page }) => {
    const email = uniqueEmail('dup');
    await page.request.post('/api/auth/register', { data: { email, password: PASSWORD, displayName: 'First' } });
    await page.context().clearCookies();
    await page.goto('/');
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).last().click();
    await expect(page.getByRole('alert')).toContainText('already exists');
  });

  test('TC-AUTH-04 sign out, wrong password, sign in', async ({ page }) => {
    const email = uniqueEmail('login');
    await page.request.post('/api/auth/register', { data: { email, password: PASSWORD, displayName: 'Login Tester' } });
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: /Plan your next tech career move/ })).toBeVisible();

    await page.getByRole('tab', { name: 'Sign in' }).click();
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await page.getByLabel('Password').fill('wrong password!');
    await page.getByRole('button', { name: 'Sign in' }).last().click();
    await expect(page.getByRole('alert')).toContainText('Email or password is incorrect');

    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).last().click();
    await expect(page.getByRole('heading', { name: /Welcome back, Login/ })).toBeVisible();
  });

  test('TC-AUTH-05 protected pages require sign-in', async ({ page }) => {
    await page.goto('/applications');
    await expect(page.getByRole('heading', { name: /Plan your next tech career move/ })).toBeVisible();
    const res = await page.request.get('/api/profile');
    expect(res.status()).toBe(401);
  });
});

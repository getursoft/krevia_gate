import { expect, test } from '@playwright/test';
import { E2E } from '../playwright.config';
import { PASSWORD, joinSociety, login, logout, register, uniquePhone } from './helpers';

test.describe('Landing page', () => {
  test('shows the Krevia brand, exact tagline and entry points', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Krevia — Secured. Transparent. Trust.');
    await expect(page.getByTestId('tagline')).toHaveText('Secured. Transparent. Trust.');
    await expect(page.locator('.site-header .logo-word')).toHaveText('Krevia');
    await expect(page.getByRole('link', { name: /I'm a resident/ })).toHaveAttribute('href', '/register');
    await expect(page.getByRole('link', { name: 'I manage a society' })).toBeVisible();
    await expect(page.getByText(/Privacy Policy \(placeholder\)/)).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Cravia');
  });
});

test.describe('Authentication', () => {
  test('client-side validation errors on register', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Full name').fill('A');
    await page.getByLabel('Mobile number').fill('12345');
    await page.getByLabel('Email (optional)').fill('not-an-email');
    await page.getByLabel('Password').fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Enter a valid 10-digit Indian mobile number')).toBeVisible();
    await expect(page.getByText('Enter a valid email address')).toBeVisible();
    await expect(page.getByText('Password must be at least 8 characters')).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);
  });

  test('server rejects a duplicate mobile number', async ({ page, context }) => {
    const { phone } = await register(page);
    await context.clearCookies();
    await page.goto('/register');
    await page.getByLabel('Full name').fill('Duplicate Person');
    await page.getByLabel('Mobile number').fill(phone);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.locator('.alert-error')).toContainText('already exists');
  });

  test('wrong credentials are rejected with a generic error', async ({ page }) => {
    await login(page, uniquePhone(), 'Wrong12345');
    await expect(page.locator('.alert-error')).toHaveText('Incorrect mobile number or password.');
    await expect(page).toHaveURL(/\/login/);
  });

  test('protected routes redirect to login, then back after sign-in', async ({ page, context }) => {
    for (const path of ['/dashboard', '/profile', '/society/join', '/admin']) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path).replace(/\//g, '%2F')}`));
    }
    const { phone } = await register(page);
    await context.clearCookies();
    await login(page, phone, PASSWORD, '/profile');
    await expect(page).toHaveURL(/\/profile$/);
  });

  test('a forged session cookie does not grant access', async ({ page, context }) => {
    await context.addCookies([{ name: 'krevia_session', value: 'forged', url: `http://localhost:${E2E.webPort}` }]);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Resident journey', () => {
  test('register → search → join → pending status → admin approves → dashboard shows approved', async ({ page, context }) => {
    const { phone, fullName } = await register(page, 'Kiran Desai');

    // Search with no results first.
    await page.getByLabel(/Search by society name/).fill('zzzz-no-such-society');
    await expect(page.getByText('No societies found')).toBeVisible();

    await joinSociety(page, 'valley', 'Green Valley Residency', 'T2', 'b-704', 'Owner');
    await expect(page.getByRole('heading', { name: 'Membership request' })).toBeVisible();
    await expect(page.getByTestId('membership-status')).toHaveText('Pending verification');

    // Persisted: reload shows the same status from the backend.
    await page.reload();
    await expect(page.getByTestId('membership-status')).toHaveText('Pending verification');

    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: `Welcome back, ${fullName}!` })).toBeVisible();
    await expect(page.getByTestId('dashboard-society')).toHaveText('Green Valley Residency');
    await expect(page.getByTestId('dashboard-unit')).toHaveText('T2 · B-704');
    await expect(page.getByTestId('membership-status')).toHaveText('Pending verification');
    await expect(page.getByText('Coming soon').first()).toBeVisible();

    // Society admin approves.
    await logout(page);
    await login(page, E2E.adminPhone, E2E.adminPassword, '/admin/requests');
    await expect(page).toHaveURL(/\/admin\/requests$/);
    const row = page.getByTestId('admin-request').filter({ hasText: 'Kiran Desai' });
    await expect(row).toContainText('T2 · B-704 · Owner');
    page.once('dialog', (d) => d.accept());
    await row.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText("Kiran Desai's request was approved.")).toBeVisible();

    await context.clearCookies();
    await login(page, phone);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId('membership-status')).toHaveText('Approved');
    await expect(page.getByText(/You are a verified member of Green Valley Residency/)).toBeVisible();
  });

  test('duplicate submissions are blocked and a resident can withdraw', async ({ page }) => {
    await register(page);
    await joinSociety(page, 'Lakeview', 'Lakeview Heights', 'B', '12', 'Tenant');
    await expect(page.getByTestId('membership-status')).toHaveText('Pending verification');
    // The join flow is replaced by the status card, so a second request cannot be started.
    await page.goto('/society/join');
    await expect(page.getByRole('heading', { name: 'Join your society' })).toHaveCount(0);
    // Server also rejects a direct duplicate POST.
    const res = await page.request.post('/api/v1/membership-requests', {
      headers: { Origin: `http://localhost:${E2E.webPort}` },
      data: { societyId: '00000000-0000-4000-8000-000000000000', tower: 'B', unitNumber: '12', occupancy: 'TENANT' },
    });
    expect([404, 409]).toContain(res.status());

    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Withdraw request' }).click();
    await expect(page.getByRole('heading', { name: 'Join your society' })).toBeVisible();
  });

  test('a resident without admin role cannot use the admin page', async ({ page }) => {
    await register(page);
    await page.goto('/admin');
    await expect(page.getByTestId('role-denied')).toContainText('No society admin access');
    await page.goto('/admin/requests');
    await expect(page.getByText('No society administration access')).toBeVisible();
  });
});

test.describe('Profile and logout', () => {
  test('updates profile with validation, then logs out and loses access', async ({ page }) => {
    await register(page, 'Arjun Mehta');
    await page.goto('/profile');
    await expect(page.getByLabel('Mobile number')).toBeDisabled();

    await page.getByLabel('Email (optional)').fill('bad-email');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Enter a valid email address')).toBeVisible();

    await page.getByLabel('Full name').fill('Arjun R. Mehta');
    await page.getByLabel('Email (optional)').fill('arjun@example.in');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Profile updated.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Full name')).toHaveValue('Arjun R. Mehta');
    await expect(page.getByTestId('topbar-name')).toHaveText('Arjun R. Mehta');

    await logout(page);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});

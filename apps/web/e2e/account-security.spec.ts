import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { E2E } from '../playwright.config';
import { login, logout, PASSWORD, register, uniquePhone } from './helpers';

/** Reads the newest development-outbox message for a phone (the API runs with MESSAGE_DELIVERY=dev-outbox). */
async function outbox(request: APIRequestContext, phone: string): Promise<string> {
  const res = await request.get(`http://localhost:${E2E.apiPort}/api/v1/dev/outbox?to=${phone}`);
  expect(res.ok()).toBe(true);
  const { items } = (await res.json()) as { items: { body: string }[] };
  expect(items.length).toBeGreaterThan(0);
  return items[0]!.body;
}

async function adminCreatesInvitation(page: Page, phone: string, flat: string) {
  await login(page, E2E.adminPhone, E2E.adminPassword);
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/units');
  await page.getByLabel('Tower / block').selectOption({ label: 'T2' });
  await page.getByLabel('Flat / unit number').fill(flat);
  await page.getByRole('button', { name: 'Add unit' }).click();
  await expect(page.getByText(`Unit ${flat.toUpperCase()} added.`)).toBeVisible();

  await page.getByRole('link', { name: 'Invitations' }).click();
  await expect(page).toHaveURL(/\/admin\/invitations$/);
  await page.getByLabel('Mobile number').fill(phone);
  await page.getByLabel('Role').selectOption('RESIDENT');
  await page.getByLabel('Flat').selectOption({ label: `T2-${flat}` });
  await page.getByLabel('Occupancy').selectOption('TENANT');
  await page.getByRole('button', { name: 'Create invitation' }).click();
  await expect(page.getByTestId('invite-created')).toContainText('shown only once');
  const inviteUrl = (await page.getByTestId('invite-url').textContent())!.trim();
  await expect(page.getByTestId('invitation-row').first()).toContainText(phone.slice(-4));
  await logout(page);
  return inviteUrl;
}

test.describe('Sprint 2 — accounts, invitations and access', () => {
  test('password reset with a one-time code signs in with the new password', async ({ page }) => {
    const { phone } = await register(page, 'Reset Person');
    await logout(page);

    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await page.getByLabel('Mobile number').fill(phone);
    await page.getByRole('button', { name: 'Send code' }).click();
    await expect(page.getByText(/If an account exists for this number/)).toBeVisible();

    const code = /(\d{6}) is your/.exec(await outbox(page.request, `+91${phone}`))![1]!;
    await page.getByLabel('6-digit code').fill(code);
    await page.getByLabel('New password', { exact: true }).fill('NewSecret2026');
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(page).toHaveURL(/\/login\?reset=1$/);
    await expect(page.getByText('Password changed.')).toBeVisible();

    await login(page, phone, PASSWORD);
    await expect(page.locator('.alert-error')).toContainText('Incorrect mobile number or password');
    await login(page, phone, 'NewSecret2026');
    await expect(page).toHaveURL(/\/(home|dashboard|society\/join)/);
  });

  test('an invited resident registers through the invite link, accepts, and the admin manages the membership', async ({ page }) => {
    const phone = uniquePhone();
    const inviteUrl = await adminCreatesInvitation(page, phone, `E${Date.now() % 10000}`);
    const invitePath = new URL(inviteUrl).pathname + new URL(inviteUrl).search;

    await page.goto(invitePath);
    await expect(page.getByTestId('invite-society')).toContainText('Green Valley Residency');
    await expect(page.getByTestId('invite-role')).toHaveText('Resident');
    await page.getByRole('link', { name: 'Create an account' }).click();
    await page.getByLabel('Full name').fill('Invited Tenant');
    await page.getByLabel('Mobile number').fill(phone);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/invite\?token=/);
    await page.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    // The same link cannot be used twice.
    await page.goto(invitePath);
    await expect(page.locator('.alert-error')).toContainText(/invalid or has expired/);

    await page.goto('/settings');
    await expect(page.getByTestId('my-memberships')).toContainText('Green Valley Residency');
    await expect(page.getByTestId('my-memberships')).toContainText('Active');
    await logout(page);

    await login(page, E2E.adminPhone, E2E.adminPassword);
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto('/admin/members');
    const row = page.getByTestId('member-row').filter({ hasText: 'Invited Tenant' });
    await expect(row).toContainText('Resident');
    page.once('dialog', (d) => void d.accept());
    await row.getByRole('button', { name: 'Suspend' }).click();
    await expect(page.getByText('Invited Tenant is now suspended.')).toBeVisible();

    await page.getByRole('link', { name: 'Audit log' }).click();
    await expect(page.getByTestId('audit-row').filter({ hasText: 'Membership status changed' }).first()).toBeVisible();
    await expect(page.getByTestId('audit-row').filter({ hasText: 'Invitation accepted' }).first()).toBeVisible();
  });

  test('a signed-in user with a different number cannot accept someone else\'s invitation', async ({ page }) => {
    const inviteUrl = await adminCreatesInvitation(page, uniquePhone(), `F${Date.now() % 10000}`);
    await register(page, 'Wrong Number');
    await page.goto(new URL(inviteUrl).pathname + new URL(inviteUrl).search);
    await page.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(page.locator('.alert-error')).toContainText('not valid for your account');
  });

  test('guards and residents cannot open resident management; the API refuses them too', async ({ page }) => {
    await login(page, E2E.guardPhone, E2E.guardPassword);
    await expect(page).toHaveURL(/\/guard$/);
    for (const path of ['/admin/members', '/admin/invitations', '/admin/units', '/admin/audit']) {
      await page.goto(path);
      await expect(page.getByTestId('role-denied')).toBeVisible();
    }
    const me = await (await page.request.get('/api/v1/auth/me')).json();
    const societyId = me.user.guardSocietyIds[0];
    expect((await page.request.get(`/api/v1/societies/${societyId}/members`)).status()).toBe(403);
    expect((await page.request.post(`/api/v1/societies/${societyId}/invitations`, { data: { phone: '9876512345', role: 'ADMIN' } })).status()).toBe(403);
  });
});

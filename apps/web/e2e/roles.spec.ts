import { expect, test } from '@playwright/test';
import { ROLE_NAVIGATION, type AppRole } from '@krevia/shared';
import { E2E } from '../playwright.config';
import { joinSociety, login, register } from './helpers';

async function expectSidebar(page: import('@playwright/test').Page, role: AppRole) {
  const links = page.locator('.sidebar .side-nav .side-link');
  await expect(links).toHaveText(ROLE_NAVIGATION[role].sidebar.map((i) => i.label));
}

test.describe('Role-based dashboards', () => {
  test('society admin lands on the admin dashboard with live stats and the admin menu', async ({ page }) => {
    await login(page, E2E.adminPhone, E2E.adminPassword);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: 'Society Dashboard' })).toBeVisible();
    await expectSidebar(page, 'ADMIN');
    await expect(page.getByTestId('society-chip')).toContainText('Green Valley Residency');
    await expect(page.locator('.user-menu-name')).toContainText('Society Admin');

    // Stats match the API response for the admin's society.
    const me = await page.request.get('/api/v1/auth/me');
    const societyId = (await me.json()).user.adminSocietyIds[0];
    const overview = await (await page.request.get(`/api/v1/societies/${societyId}/overview`)).json();
    await expect(page.getByTestId('stat-units')).toHaveText(String(overview.totalUnits));
    await expect(page.getByTestId('stat-residents')).toHaveText(String(overview.approvedMembers));
    await expect(page.getByTestId('stat-pending')).toHaveText(String(overview.pendingRequests));

    await expect(page.getByTestId('quick-action')).toHaveText(ROLE_NAVIGATION.ADMIN.quickActions.map((i) => new RegExp(i.label)));
    await page.getByTestId('quick-action').filter({ hasText: 'Approve Residents' }).click();
    await expect(page).toHaveURL(/\/admin\/requests$/);
  });

  test('security guard lands on the gate console with the guard menu', async ({ page }) => {
    await login(page, E2E.guardPhone, E2E.guardPassword);
    await expect(page).toHaveURL(/\/guard$/);
    await expect(page.getByRole('heading', { name: 'Live Gate Entry' })).toBeVisible();
    await expectSidebar(page, 'GUARD');
    await expect(page.getByTestId('gate-console')).toContainText('Coming soon');
    await expect(page.getByText('No entries recorded')).toBeVisible();
    await expect(page.getByTestId('society-chip')).toContainText('Security');
    // A guard has no admin dashboard access (and the API rejects admin actions).
    await page.goto('/admin');
    await expect(page.getByTestId('role-denied')).toBeVisible();
  });

  test('resident gets the resident dashboard and menu; staff areas and modules behave correctly', async ({ page }) => {
    await register(page, 'Neha Kulkarni');
    await joinSociety(page, 'Green', 'Green Valley Residency', 'T3', '904', 'Tenant');
    await page.goto('/home');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expectSidebar(page, 'RESIDENT');
    await expect(page.getByTestId('society-chip')).toContainText('904 · Tower T3');
    await expect(page.getByTestId('quick-action')).toHaveCount(ROLE_NAVIGATION.RESIDENT.quickActions.length);

    // Unbuilt modules open an honest coming-soon page.
    await page.locator('.sidebar').getByRole('link', { name: 'Payments' }).click();
    await expect(page).toHaveURL(/\/resident\/m\/payments$/);
    await expect(page.getByTestId('coming-soon')).toContainText('Payments');
    await expect(page.locator('.sidebar').getByRole('link', { name: 'Payments' })).toHaveAttribute('aria-current', 'page');

    // Feature search jumps to a module.
    await page.getByLabel('Search features').fill('direct');
    await page.getByRole('listbox').getByRole('link', { name: 'Directory' }).click();
    await expect(page).toHaveURL(/\/resident\/m\/directory$/);

    // No view switcher for a single-role user; staff areas are denied.
    await page.locator('.user-menu-btn').click();
    await expect(page.getByText('Switch view')).toHaveCount(0);
    await page.goto('/guard');
    await expect(page.getByTestId('role-denied')).toContainText('No security guard access');
  });
});

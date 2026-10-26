import { expect, test } from '@playwright/test';
import { E2E } from '../playwright.config';
import { PASSWORD, login, logout, uniquePhone } from './helpers';

/**
 * Sprint 4 web acceptance: a guard registers a visitor in the browser, the
 * destination resident approves it in their own view, the guard records entry
 * and exit, and an administrator sees the audited history and can override.
 */
test.describe.serial('Sprint 4 visitor and gate workflow', () => {
  const stamp = Date.now().toString().slice(-6);
  const buildingName = `E2E${stamp}`;
  const unitNumber = `V${stamp.slice(-3)}`;
  const visitorName = `E2E Courier ${stamp}`;
  const overrideName = `E2E Emergency ${stamp}`;
  const residentPhone = uniquePhone();
  let societyId = '';
  let unitId = '';
  let visitorId = '';

  const mobile = { 'X-Krevia-Client': 'mobile' };

  async function token(request: import('@playwright/test').APIRequestContext, phone: string, password: string) {
    const res = await request.post('/api/v1/auth/login', { headers: mobile, data: { phone, password } });
    expect(res.ok()).toBeTruthy();
    return (await res.json()).token as string;
  }

  test.beforeAll(async ({ request }) => {
    const adminToken = await token(request, E2E.adminPhone, E2E.adminPassword);
    const auth = { Authorization: `Bearer ${adminToken}`, ...mobile };
    const me = await (await request.get('/api/v1/auth/me', { headers: auth })).json();
    societyId = me.user.adminSocietyIds[0];

    const building = await request.post(`/api/v1/societies/${societyId}/buildings`, { headers: auth, data: { name: buildingName } });
    expect(building.status()).toBe(201);
    const unit = await request.post(`/api/v1/societies/${societyId}/units`, {
      headers: auth,
      data: { buildingId: (await building.json()).building.id, number: unitNumber },
    });
    expect(unit.status()).toBe(201);
    unitId = (await unit.json()).unit.id;

    // Register the resident through the API and link them to the unit.
    const registration = await request.post('/api/v1/auth/register', {
      headers: mobile,
      data: { fullName: 'Eve Resident Guest', phone: residentPhone, password: PASSWORD },
    });
    expect(registration.status()).toBe(201);
    const residentToken = (await registration.json()).token as string;
    const invitation = await request.post(`/api/v1/societies/${societyId}/invitations`, {
      headers: auth,
      data: { phone: residentPhone, role: 'RESIDENT', unitId, occupancy: 'OWNER' },
    });
    expect(invitation.status()).toBe(201);
    const inviteToken = new URL((await invitation.json()).inviteUrl).searchParams.get('token');
    const accepted = await request.post('/api/v1/invitations/accept', {
      headers: { Authorization: `Bearer ${residentToken}`, ...mobile },
      data: { token: inviteToken },
    });
    expect(accepted.ok()).toBeTruthy();
  });

  test('guard registers, resident approves, guard records entry and exit, admin sees the history', async ({ page, request }) => {
    await login(page, E2E.guardPhone, E2E.guardPassword);
    await expect(page).toHaveURL(/\/guard$/);
    await page.getByLabel('Visitor name').fill(visitorName);
    await page.getByLabel('Mobile number (optional)').fill(uniquePhone());
    await page.getByLabel('Destination flat').selectOption(unitId);
    await page.getByLabel('Purpose').fill('Parcel for the e2e resident');
    await page.getByRole('button', { name: 'Register visitor' }).click();
    await expect(page.getByText(new RegExp(`${visitorName} registered`))).toBeVisible();
    await expect(page.getByTestId('live-queue')).toContainText(visitorName);
    await expect(page.getByTestId('live-queue')).toContainText('Pending approval');

    await logout(page);
    await login(page, residentPhone, PASSWORD);
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto('/resident/visitors');
    await expect(page.getByTestId('pending-approvals')).toContainText(visitorName);
    await page.getByRole('button', { name: 'Approve' }).first().click();
    await expect(page.getByText(`${visitorName} approved for entry.`)).toBeVisible();

    await logout(page);
    await login(page, E2E.guardPhone, E2E.guardPassword);
    await expect(page.getByTestId('live-queue')).toContainText('Approved');
    await page.getByRole('button', { name: 'Record entry' }).first().click();
    await expect(page.getByText(`${visitorName}'s entry recorded.`)).toBeVisible();
    await page.getByRole('button', { name: 'Record exit' }).first().click();
    await expect(page.getByText(`${visitorName}'s exit recorded.`)).toBeVisible();

    await logout(page);
    await login(page, E2E.adminPhone, E2E.adminPassword);
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto('/admin/visitors');
    await page.getByLabel('Search visitors').fill(visitorName);
    await page.getByRole('button', { name: 'Search' }).click();
    const row = page.getByTestId('visitor-row').filter({ hasText: visitorName });
    await expect(row).toContainText('Exited');
    await expect(row).toContainText('Entered');
    await expect(row).toContainText('manual entry');

    // The audit trail is visible through the API to the same administrator.
    const adminToken = await token(request, E2E.adminPhone, E2E.adminPassword);
    const auth = { Authorization: `Bearer ${adminToken}`, ...mobile };
    const visitors = await (await request.get(`/api/v1/societies/${societyId}/visitors?q=${encodeURIComponent(visitorName)}`, { headers: auth })).json();
    visitorId = visitors.items[0].id;
    const audit = await (await request.get(`/api/v1/societies/${societyId}/audit-events?action=visitor.exited&pageSize=100`, { headers: auth })).json();
    expect(audit.items.some((e: { targetId: string }) => e.targetId === visitorId)).toBe(true);
  });

  test('administrator admits a visitor by emergency override with a mandatory reason', async ({ page, request }) => {
    const guardToken = await token(request, E2E.guardPhone, E2E.guardPassword);
    const created = await request.post(`/api/v1/societies/${societyId}/visitors`, {
      headers: { Authorization: `Bearer ${guardToken}`, ...mobile },
      data: {
        name: overrideName,
        phone: uniquePhone(),
        category: 'VISITOR',
        unitId,
        purpose: 'Emergency override e2e',
        idempotencyKey: `e2e-override-${stamp}`,
      },
    });
    expect(created.status()).toBe(201);

    await login(page, E2E.adminPhone, E2E.adminPassword);
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto('/admin/visitors');
    await page.getByLabel('Search visitors').fill(overrideName);
    await page.getByRole('button', { name: 'Search' }).click();
    const row = page.getByTestId('visitor-row').filter({ hasText: overrideName });
    await expect(row).toContainText('Pending approval');
    page.once('dialog', (dialog) => void dialog.accept('Medical emergency at the gate'));
    await row.getByRole('button', { name: 'Emergency override' }).click();
    await expect(row).toContainText('emergency override');
    await expect(row).toContainText('Medical emergency at the gate');
    await expect(row).toContainText('Entered');
  });
});

import { expect, type Page } from '@playwright/test';

let counter = 0;
export function uniquePhone(): string {
  counter += 1;
  return `8${String(Date.now() % 1e6).padStart(6, '0')}${String(counter).padStart(3, '0')}`;
}

export const PASSWORD = 'Resident123';

export async function register(page: Page, fullName = 'Priya Sharma') {
  const phone = uniquePhone();
  await page.goto('/register');
  await page.getByLabel('Full name').fill(fullName);
  await page.getByLabel('Mobile number').fill(phone);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/society\/join$/);
  return { phone, fullName };
}

export async function login(page: Page, phone: string, password = PASSWORD, next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  await page.getByLabel('Mobile number').fill(phone);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function logout(page: Page) {
  await page.locator('.sidebar').getByRole('button', { name: 'Logout' }).click();
  await expect(page).toHaveURL(/\/login$/);
}

/** Search, select society, enter unit, review and submit. */
export async function joinSociety(page: Page, search: string, society: string, tower: string, unit: string, occupancy: 'Owner' | 'Tenant') {
  await page.goto('/society/join');
  await page.getByLabel(/Search by society name/).fill(search);
  await page.getByRole('button', { name: new RegExp(society) }).click();
  await expect(page.getByTestId('selected-society')).toHaveText(society);
  await page.getByLabel('Tower / block').selectOption(tower);
  await page.getByLabel('Flat / unit number').fill(unit);
  await page.getByLabel(occupancy).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Submit request' }).click();
}

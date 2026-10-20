import { expect, test } from '@playwright/test';
import { register } from './helpers';

test('landing page and dashboard work at phone width', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tagline')).toHaveText('Secured. Transparent. Trust.');
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);

  await register(page);
  await page.goto('/dashboard');
  await expect(page.locator('.bottom-nav')).toBeVisible();
  await expect(page.getByTestId('no-society')).toBeVisible();
  await page.getByRole('button', { name: 'More' }).click();
  await expect(page.locator('.sidebar')).toHaveAttribute('data-open', 'true');
  await expect(page.locator('.sidebar').getByRole('link', { name: 'Buy & Sell' })).toBeVisible();
});

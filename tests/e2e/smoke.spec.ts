import { expect, test } from '@playwright/test';

test('student shell loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Student Dashboard' })).toBeVisible();
});

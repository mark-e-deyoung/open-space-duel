const { test, expect } = require('@playwright/test');

const raw = Number.parseInt(process.env.SOAK_ITERATIONS || '12', 10);
const iterations = Number.isFinite(raw) ? Math.max(1, Math.min(raw, 100)) : 12;

for (let i = 1; i <= iterations; i += 1) {
  test(`public deployment navigation ${i}/${iterations}`, async ({ page }) => {
    const response = await page.goto(`?__public_lro=${Date.now()}-${i}`, {
      waitUntil: 'domcontentloaded',
    });

    expect(response, 'navigation should return an HTTP response').not.toBeNull();
    expect(response.status(), 'public deployment should not return an HTTP error').toBeLessThan(400);
    await expect(page.locator('body')).toBeVisible();
    await expect(page.getByTestId('main-menu')).toBeVisible();
  });
}

// V1 public black-box-only interaction checks. No private repo read, QA hooks, or hidden fixtures.
const { test, expect } = require('@playwright/test');

const viewports = [
  { name: 'narrow-portrait', width: 320, height: 568 },
  { name: 'phone-portrait', width: 390, height: 844 },
  { name: 'phone-landscape', width: 568, height: 320 },
  { name: 'tall-phone', width: 430, height: 932 },
];

for (const viewport of viewports) {
  test('public onboarding can be dismissed and menu used: ' + viewport.name, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const response = await page.goto('?__osd_public_menu_rdte=' + viewport.name, {
      waitUntil: 'domcontentloaded',
    });
    expect(response).not.toBeNull();
    expect(response.status()).toBeLessThan(400);

    // The earlier smoke passed with onboarding still obscuring the menu.
    // Require this real, user-visible interaction instead of only DOM presence.
    const dismiss = page.getByRole('button', { name: /got it/i });
    await expect(dismiss).toBeVisible();
    const closeRect = await dismiss.boundingBox();
    expect(closeRect).not.toBeNull();
    expect(closeRect.width).toBeGreaterThanOrEqual(44);
    expect(closeRect.height).toBeGreaterThanOrEqual(44);
    await dismiss.click();
    await expect(dismiss).toBeHidden();

    const menu = page.getByTestId('main-menu');
    await expect(menu).toBeVisible();
    for (const title of ['SURVIVAL', 'LOCAL DUEL', 'DUEL']) {
      const control = menu.getByRole('button', { name: title, exact: true });
      await expect(control).toBeVisible();
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
    }

    const metrics = await page.evaluate(() => ({
      innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      innerHeight,
      documentHeight: document.documentElement.scrollHeight,
    }));
    console.log(JSON.stringify({ ...viewport, ...metrics, browser: testInfo.project.name }));
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.innerWidth + 1);
    await page.screenshot({ path: testInfo.outputPath('menu-dismissed-' + viewport.name + '.png'), fullPage: true });
  });
}

// Separate action smoke: click a public first-player local mode. No network/login/state mutation.
test('public survival action is clickable after onboarding dismissal', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const response = await page.goto('?__osd_public_menu_rdte=survival', { waitUntil: 'domcontentloaded' });
  expect(response).not.toBeNull();
  expect(response.status()).toBeLessThan(400);
  const dismiss = page.getByRole('button', { name: /got it/i });
  await expect(dismiss).toBeVisible();
  await dismiss.click();
  const survival = page.getByTestId('main-menu').getByRole('button', { name: 'SURVIVAL', exact: true });
  await expect(survival).toBeVisible();
  await survival.click();
  await page.screenshot({ path: testInfo.outputPath('survival-click-' + testInfo.project.name + '.png'), fullPage: true });
});

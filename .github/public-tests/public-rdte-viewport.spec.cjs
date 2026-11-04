// Public-deployment-only browser/viewport probes; no private source or services.
const { test, expect } = require('@playwright/test');

const viewports = [
  { name: 'narrow-portrait', width: 320, height: 568 },
  { name: 'phone-portrait', width: 390, height: 844 },
  { name: 'phone-landscape', width: 568, height: 320 },
  { name: 'tall-phone', width: 430, height: 932 },
];

for (const viewport of viewports) {
  test('public RDTE viewport ' + viewport.name, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const response = await page.goto('?__public_rdte_viewport=' + viewport.name, {
      waitUntil: 'domcontentloaded',
    });
    expect(response).not.toBeNull();
    expect(response.status()).toBeLessThan(400);
    await expect(page.locator('body')).toBeVisible();
    await expect(page.getByTestId('main-menu')).toBeVisible();

    // Public-only visual evidence. A browser viewport is not a physical iPhone.
    const menuBox = await page.getByTestId('main-menu').boundingBox();
    expect(menuBox).not.toBeNull();
    expect(menuBox.width).toBeGreaterThan(0);
    expect(menuBox.height).toBeGreaterThan(0);
    const metrics = await page.evaluate(() => ({
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));
    console.log(JSON.stringify({ ...viewport, ...metrics, browser: testInfo.project.name }));
    await page.screenshot({
      path: testInfo.outputPath('public-' + viewport.name + '.png'),
      fullPage: true,
    });
  });
}

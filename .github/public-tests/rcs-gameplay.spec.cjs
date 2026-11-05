// Public black-box gameplay: no internal state hooks or private fixtures.
const { test, expect } = require('@playwright/test');

test('paid steering and forward thrust are perceptible in live gameplay', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 900, height: 700 });
  const response = await page.goto('?public_rcs=1', { waitUntil: 'domcontentloaded' });
  expect(response).not.toBeNull();
  expect(response.status()).toBeLessThan(400);

  const dismiss = page.getByRole('button', { name: /got it/i });
  await expect(dismiss).toBeVisible();
  await dismiss.click();

  const survival = page.getByTestId('main-menu').getByRole('button', {
    name: 'SURVIVAL', exact: true,
  });
  await expect(survival).toBeVisible();
  await survival.click();
  await expect(page.getByTestId('main-menu')).toBeHidden();
  await expect(page.locator('#game-canvas')).toBeVisible();

  // Hold steering, then add thrust: both should be expressed independently.
  await page.keyboard.down('ArrowLeft');
  const indicator = page.getByTestId('propulsion-state');
  await expect(indicator).toContainText('TURN LEFT');
  await page.keyboard.down('ArrowUp');
  await expect(indicator).toContainText('FORWARD THRUST + TURN LEFT');

  // Verify that the cyan steering-jet pixels actually reach the live canvas.
  // The normal teal ship outline and orange main flame have different colors.
  const cyanCount = async () => page.locator('#game-canvas').evaluate(canvas => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;
    const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i] > 70 && rgba[i] < 155 &&
          rgba[i + 1] > 170 && rgba[i + 1] < 245 &&
          rgba[i + 2] > 225) count += 1;
    }
    return count;
  });
  await expect.poll(cyanCount, { timeout: 5000 }).toBeGreaterThan(0);
  console.log(JSON.stringify({ browser: testInfo.project.name, cyanJetPixels: await cyanCount() }));
  await page.screenshot({ path: testInfo.outputPath('steering-and-thrust.png') });

  await page.keyboard.up('ArrowLeft');
  await page.keyboard.up('ArrowUp');
  await expect(page.getByTestId('propulsion-state')).toHaveCount(0);
});

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
    const touchViolations = [];
    console.log(JSON.stringify({control:'GOT IT', viewport: viewport.name, width: closeRect.width, height: closeRect.height, browser: testInfo.project.name}));
    if (closeRect.width < 44 || closeRect.height < 44) touchViolations.push('GOT IT: ' + Math.round(closeRect.width) + 'x' + Math.round(closeRect.height) + 'px');
    await dismiss.click();
    await expect(dismiss).toBeHidden();

    const menu = page.getByTestId('main-menu');
    await expect(menu).toBeVisible();
    for (const title of ['SURVIVAL', 'LOCAL DUEL', 'DUEL']) {
      const control = menu.getByRole('button', { name: title, exact: true });
      await expect(control).toBeVisible();
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      console.log(JSON.stringify({control:title, viewport: viewport.name, width:bounds.width, height:bounds.height, browser:testInfo.project.name}));
      if (bounds.width < 44 || bounds.height < 44) touchViolations.push(title + ': ' + Math.round(bounds.width) + 'x' + Math.round(bounds.height) + 'px');
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
    // Preserve the 44px gate: collect all measurements before failing.
    expect(touchViolations, 'Public mobile touch targets below 44 CSS px').toEqual([]);
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


test('public compact landscape geometry does not obscure config behind title or launch bar', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 568, height: 320 });
  const response = await page.goto('?__osd_public_menu_rdte=landscape-geometry', { waitUntil: 'domcontentloaded' });
  expect(response).not.toBeNull();
  expect(response.status()).toBeLessThan(400);
  const dismiss = page.getByRole('button', { name: /got it/i });
  await expect(dismiss).toBeVisible();
  await dismiss.click();
  await expect(dismiss).toBeHidden();
  const menu = page.getByTestId('main-menu');
  const title = menu.getByTestId('game-title');
  const heading = menu.getByRole('heading', { name: 'PILOT 1 CONFIG' });
  const slider = menu.getByTestId('stat-focus-slider');
  const launch = menu.getByTestId('start-local-btn').locator('..');
  await expect(title).toBeVisible();
  await expect(heading).toBeVisible();
  await expect(slider).toBeVisible();
  const [titleBox, headingBox, sliderBox, launchBox] = await Promise.all([
    title.boundingBox(), heading.boundingBox(), slider.boundingBox(), launch.boundingBox()
  ]);
  expect(titleBox).not.toBeNull();
  expect(headingBox).not.toBeNull();
  expect(sliderBox).not.toBeNull();
  expect(launchBox).not.toBeNull();
  const geometry = {
    browser: testInfo.project.name,
    viewport: { width: 568, height: 320 },
    title: titleBox, pilotHeading: headingBox, tuningSlider: sliderBox, launchBar: launchBox
  };
  console.log('PUBLIC_LANDSCAPE_GEOMETRY ' + JSON.stringify(geometry));
  await page.screenshot({ path: testInfo.outputPath('landscape-before-assert.png'), fullPage: true });
  // Both are intentionally soft: preserve the independent first failures.
  expect.soft(headingBox.y, 'Pilot heading must be below game title').toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
  expect.soft(sliderBox.y + sliderBox.height, 'Tuning control must remain above bottom launcher').toBeLessThanOrEqual(launchBox.y);
});


test('public keyboard-only route reaches and activates Survival', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const response = await page.goto('?__osd_public_menu_rdte=keyboard-only', { waitUntil: 'domcontentloaded' });
  expect(response).not.toBeNull();
  expect(response.status()).toBeLessThan(400);

  const dismiss = page.getByRole('button', { name: /got it/i });
  await expect(dismiss).toBeVisible();
  await dismiss.click();
  await expect(dismiss).toBeHidden();

  const menu = page.getByTestId('main-menu');
  const survival = menu.getByRole('button', { name: 'SURVIVAL', exact: true });
  await expect(survival).toBeVisible();
  let reached = false;
  for (let i = 0; i < 80; i += 1) {
    await page.keyboard.press('Tab');
    reached = await survival.evaluate(el => document.activeElement === el);
    if (reached) break;
  }
  expect(reached, 'A keyboard-only user must reach the main Survival action by Tab').toBe(true);
  await page.keyboard.press('Enter');
  if (await menu.isVisible()) {
    // The current first-player quick-launch contract can require a second
    // explicit keyboard launch from the selected pilot card.
    await expect(survival).toBeFocused();
    await page.keyboard.press('Enter');
  }
  await expect(menu).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('keyboard-only-survival.png') });
});

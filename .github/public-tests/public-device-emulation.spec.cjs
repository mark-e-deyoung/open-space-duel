// Public-only mobile device emulation: not a physical iPhone or Android certification.
const { test, expect } = require('@playwright/test');

async function firstVisit(page, label) {
  const response = await page.goto('?__public_device_rdte=' + label, { waitUntil: 'domcontentloaded' });
  expect(response).not.toBeNull();
  expect(response.status()).toBeLessThan(400);
  const dismiss = page.getByRole('button', { name: /got it/i });
  await expect(dismiss).toBeVisible();
  return dismiss;
}
function point(rect) {
  return rect && { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}
test('real tap input dismisses onboarding and activates Survival', async ({ page }, testInfo) => {
  const dismiss = await firstVisit(page, 'tap-survival');
  // The WebKit Linux iPhone emulation may report maxTouchPoints=0 despite a
  // Playwright touch-enabled context. Assert the configured emulation and
  // exercise real touch-dispatched .tap() calls below, not that UA heuristic.
  expect(testInfo.project.use.hasTouch, 'device profile must enable touch').toBe(true);
  const touch = await page.evaluate(() => ({
    maxTouchPoints: navigator.maxTouchPoints,
    hasTouchStart: 'ontouchstart' in window,
    width: innerWidth
  }));
  console.log('PUBLIC_DEVICE_TOUCH_CONTEXT ' + JSON.stringify({ project: testInfo.project.name, ...touch }));
  await dismiss.tap();
  await expect(dismiss).toBeHidden();
  const menu = page.getByTestId('main-menu');
  const survival = menu.getByRole('button', { name: 'SURVIVAL', exact: true });
  await expect(survival).toBeVisible();
  await survival.tap();
  // A quick-launch can first select PILOT 1; require a second explicit tap if offered.
  if (await menu.isVisible()) await survival.tap();
  await expect(menu).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('public-mobile-survival-tap.png') });
});
test('mobile touch targets meet internal 44 CSS px floor', async ({ page }, testInfo) => {
  const dismiss = await firstVisit(page, 'touch-targets');
  const measurements = [];
  const record = async (name, locator) => {
    const rect = await locator.boundingBox();
    expect(rect).not.toBeNull();
    measurements.push({ name, ...point(rect) });
    expect.soft(rect.width, name + ' width').toBeGreaterThanOrEqual(44);
    expect.soft(rect.height, name + ' height').toBeGreaterThanOrEqual(44);
  };
  await record('GOT IT', dismiss);
  await dismiss.tap();
  const menu = page.getByTestId('main-menu');
  for (const label of ['SURVIVAL', 'DUEL']) {
    await record(label, menu.getByRole('button', { name: label, exact: true }));
  }
  console.log('PUBLIC_DEVICE_TARGETS ' + JSON.stringify({ project: testInfo.project.name, measurements }));
  await testInfo.attach('mobile-touch-targets', { body: JSON.stringify(measurements), contentType: 'application/json' });
  await page.screenshot({ path: testInfo.outputPath('public-mobile-targets.png') });
});
test('compact landscape exposes pilot setup without fixed action bar overlap', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 568, height: 320 });
  const dismiss = await firstVisit(page, 'compact-landscape');
  await dismiss.tap();
  await expect(dismiss).toBeHidden();
  const menu = page.getByTestId('main-menu');
  const title = menu.getByTestId('game-title');
  const heading = menu.getByRole('heading', { name: 'PILOT 1 CONFIG' });
  const slider = menu.getByTestId('stat-focus-slider');
  const launcher = menu.getByTestId('start-local-btn').locator('..');
  for (const control of [title, heading, slider, launcher]) await expect(control).toBeVisible();
  const [a, b, c, d] = await Promise.all([
    title.boundingBox(), heading.boundingBox(), slider.boundingBox(), launcher.boundingBox()
  ]);
  expect(a).not.toBeNull(); expect(b).not.toBeNull();
  expect(c).not.toBeNull(); expect(d).not.toBeNull();
  const observed = { project: testInfo.project.name, title: point(a), heading: point(b), slider: point(c), launch: point(d) };
  console.log('PUBLIC_DEVICE_LANDSCAPE ' + JSON.stringify(observed));
  await page.screenshot({ path: testInfo.outputPath('public-mobile-landscape.png'), fullPage: true });
  expect.soft(b.y, 'pilot heading must clear game title').toBeGreaterThanOrEqual(a.y + a.height);
  expect.soft(c.y + c.height, 'settings slider must clear launcher').toBeLessThanOrEqual(d.y);
});

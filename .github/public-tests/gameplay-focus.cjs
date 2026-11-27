const { expect } = require('@playwright/test');

// Use normal mouse input on an actually exposed game surface. The touch
// overlay deliberately covers the left half; do not force-click through it.
async function focusGameplay(page) {
  await page.bringToFront();
  const canvas = page.locator('#game-canvas');
  await expect(canvas).toBeVisible();
  const point = await canvas.evaluate(el => {
    const r = el.getBoundingClientRect();
    for (const xf of [0.65, 0.75, 0.55, 0.85]) {
      for (const yf of [0.35, 0.50, 0.65, 0.25, 0.75]) {
        const x = r.left + r.width * xf, y = r.top + r.height * yf;
        if (document.elementFromPoint(x, y) === el) return { x, y };
      }
    }
    return null;
  });
  expect(point, 'an unobstructed user-clickable gameplay surface must exist').not.toBeNull();
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => page.evaluate(() => {
    const active = document.activeElement;
    return document.hasFocus() && !!active &&
      !active.closest('button,input,select,textarea,a[href],[contenteditable]:not([contenteditable="false"]),[role="dialog"]');
  }), { message: 'ordinary gameplay click must transfer keyboard focus away from native controls' }).toBe(true);
}
module.exports = { focusGameplay };

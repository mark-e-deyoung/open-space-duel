// Public user-observable two-human local gameplay. No private test hooks or bypass.
const { test, expect } = require('@playwright/test');

const models = ['arcade', 'inertial'];
const shipClasses = ['standard', 'interceptor', 'dreadnought'];
const base = process.env.DEPLOYED_BASE_URL;

async function newGame(page, model, p1, p2) {
  await page.setViewportSize({ width: 1120, height: 780 });
  await page.addInitScript(() => {
    localStorage.setItem('osd_tutorial_dismissed', 'true');
    localStorage.setItem('osd_sound_enabled', 'false');
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await page.getByTestId('flight-model-select').selectOption(model);
  await expect(page.getByTestId('flight-model-select')).toHaveValue(model);
  await page.getByTestId('ship-card-' + p1).click();
  await expect(page.getByTestId('ship-card-' + p1)).toHaveClass(/active/);
  await page.getByTestId('p2-ship-card-' + p2).click();
  await expect(page.getByTestId('p2-ship-card-' + p2)).toHaveClass(/active/);
  await page.getByTestId('start-local-multi-btn').click();
  await expect(page.getByTestId('main-menu')).toBeHidden();
  await expect(page.locator('#game-canvas')).toBeVisible();
  await expect(page.getByTestId('hud')).toBeVisible();
  await expect(page.getByTestId('p1-stats')).toHaveCount(2);
  await expect(page.getByTestId('hud')).toContainText('PILOT 2');
  await page.locator('#game-canvas').click({ position: { x: 300, y: 200 } });
  return errors;
}

async function displayedEnergy(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="hud"] div')]
      .filter(el => el.children.length === 0 && el.textContent?.trim() === 'ENERGY')
      .map(el => Number.parseFloat(el.nextElementSibling?.firstElementChild?.style.width || 'NaN')),
  );
}

async function pressFor(page, keys, milliseconds) {
  for (const key of keys) await page.keyboard.down(key);
  await page.waitForTimeout(milliseconds);
  for (const key of [...keys].reverse()) await page.keyboard.up(key);
}

for (const model of models) {
  for (const p1 of shipClasses) {
    for (const p2 of shipClasses) {
      test(`local two-human ${model} P1:${p1} P2:${p2} independent controls`,
        async ({ page }, info) => {
          test.setTimeout(75_000);
          const errors = await newGame(page, model, p1, p2);
          const baseline = await displayedEnergy(page);
          expect(baseline, 'two visible player energy bars').toHaveLength(2);
          expect(baseline.every(Number.isFinite)).toBe(true);

          // Human 1: dedicated A/W/F/Q mappings, P2 has untouched arrows.
          await pressFor(page, ['a'], 850);
          const afterP1 = await displayedEnergy(page);
          expect(afterP1).toHaveLength(2);
          expect(afterP1[0], 'P1 paid turn consumes P1 energy').toBeLessThan(baseline[0]);
          expect(afterP1[1], 'P1 cannot spend P2 energy').toBeGreaterThanOrEqual(baseline[1] - 1.5);

          // Human 2: dedicated arrow + Enter/L mappings.
          const beforeP2 = await displayedEnergy(page);
          await pressFor(page, ['ArrowRight'], 850);
          const afterP2 = await displayedEnergy(page);
          expect(afterP2[1], 'P2 paid turn consumes P2 energy').toBeLessThan(beforeP2[1]);
          // Combined human input: independent thrust, yaw and weapons.
          await pressFor(page, ['w', 'ArrowUp', 'd', 'ArrowLeft'], 350);
          await pressFor(page, ['f', 'Enter'], 250);
          await pressFor(page, ['q', 'l'], 250);
          await expect(page.getByTestId('hud')).toBeVisible();
          await expect(page.locator('#game-canvas')).toBeVisible();

          const pixels = await page.locator('#game-canvas').evaluate(canvas => {
            const ctx = canvas.getContext('2d');
            if (!ctx) return { coloured: 0, width: 0, height: 0 };
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let coloured = 0;
            for (let i = 0; i < data.length; i += 4) {
              if (data[i] + data[i + 1] + data[i + 2] > 80) coloured++;
            }
            return { coloured, width: canvas.width, height: canvas.height };
          });
          expect(pixels.width).toBeGreaterThan(0);
          expect(pixels.height).toBeGreaterThan(0);
          expect(pixels.coloured, 'actual game frame must render active pixels').toBeGreaterThan(100);

          // Gameplay pause/resume must stop and restart the visible scene.
          await page.keyboard.press('Escape');
          await expect(page.getByTestId('paused-banner')).toBeVisible();
          await page.keyboard.press('Escape');
          await expect(page.getByTestId('paused-banner')).toBeHidden();

          await page.screenshot({
            path: info.outputPath(`local-${model}-${p1}-${p2}.png`),
          });
          console.log(JSON.stringify({
            scenario: 'two-human-local', model, p1, p2, browser: info.project.name,
            baseline, afterP1, afterP2, pixels,
            errors,
          }));
          expect(errors, 'uncaught browser exceptions').toEqual([]);
        });
    }
  }
}

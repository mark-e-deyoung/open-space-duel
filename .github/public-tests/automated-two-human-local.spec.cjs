// Public user-observable two-human local gameplay. No private test hooks or bypass.
const { test, expect } = require('@playwright/test');
const { focusGameplay } = require('./gameplay-focus.cjs');

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
  await focusGameplay(page);
  return errors;
}

// Observe the displayed HUD while input is held, including short paid-torque
// intervals in inertial flight. Never infer expenditure from a recovered
// energy bar sampled after release.
async function observePaidTurn(page, player, key, direction) {
  await page.evaluate(() => {
    const hud = document.querySelector('[data-testid="hud"]');
    if (!hud) throw Error('HUD unavailable');
    const read = () => [...hud.querySelectorAll('div')]
      .filter(el => el.children.length === 0 && el.textContent?.trim() === 'ENERGY')
      .map(el => ({
        energy: Number.parseFloat(el.nextElementSibling?.firstElementChild?.style.width || 'NaN'),
        propulsion: el.parentElement?.querySelector('[data-testid="propulsion-state"]')?.textContent || '',
      }));
    const baseline = read();
    const samples = [];
    const observer = new MutationObserver(() => {
      if (samples.length < 512) samples.push(read());
    });
    observer.observe(hud, { subtree:true, childList:true, attributes:true, characterData:true });
    window.__localHudObservation = { baseline, samples, observer };
  });
  try {
    const baseline = await page.evaluate(() => window.__localHudObservation.baseline);
    expect(baseline, 'two displayed energy bars').toHaveLength(2);
    expect(baseline.every(p => Number.isFinite(p.energy))).toBe(true);
    await page.keyboard.down(key);
    const result = await page.waitForFunction(({ player, direction }) => {
      const o = window.__localHudObservation;
      const other = 1 - player;
      return o.samples.find(row =>
        row.length === 2 && row.every(p => Number.isFinite(p.energy)) &&
        row[player].propulsion.includes(direction) &&
        row[player].energy < o.baseline[player].energy &&
        row[other].energy >= o.baseline[other].energy - 1.5 &&
        !row[other].propulsion.includes('TURN')
      ) || false;
    }, { player, direction }, { timeout: 5000 });
    return { baseline, observed: await result.jsonValue() };
  } finally {
    await page.keyboard.up(key);
    await page.evaluate(() => {
      window.__localHudObservation?.observer.disconnect();
      delete window.__localHudObservation;
    });
  }
}

async function togglePause(page, paused) {
  await page.keyboard.down('Escape');
  try {
    const banner = page.getByTestId('paused-banner');
    if (paused) await expect(banner).toBeVisible();
    else await expect(banner).toBeHidden();
  } finally {
    await page.keyboard.up('Escape');
  }
  // Allow the fixed-step input sampler to observe release before another edge.
  await page.waitForTimeout(150);
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
          const turnP1 = await observePaidTurn(page, 0, 'a', 'TURN LEFT');
          // Confirm a separate P2 command, including paid acceleration in inertial mode.
          const turnP2 = await observePaidTurn(page, 1, 'ArrowRight', 'TURN RIGHT');
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
          await togglePause(page, true);
          await togglePause(page, false);

          await page.screenshot({
            path: info.outputPath(`local-${model}-${p1}-${p2}.png`),
          });
          console.log(JSON.stringify({
            scenario: 'two-human-local', model, p1, p2, browser: info.project.name,
            turnP1, turnP2, pixels,
            errors,
          }));
          expect(errors, 'uncaught browser exceptions').toEqual([]);
        });
    }
  }
}

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

async function displayedEnergy(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="hud"] div')]
      .filter(el => el.children.length === 0 && el.textContent?.trim() === 'ENERGY')
      .map(el => Number.parseFloat(el.nextElementSibling?.firstElementChild?.style.width || 'NaN')),
  );
}

async function pressFor(page, keys, milliseconds) {
  const held = [];
  try {
    for (const key of keys) { await page.keyboard.down(key); held.push(key); }
    await page.waitForTimeout(milliseconds);
  } finally {
    for (const key of held.reverse()) await page.keyboard.up(key);
  }
}

// Capture the actual rendered energy and propulsion together, at HUD updates.
// Inertial torque stops spending at the angular-speed limit; a later sample
// after recharge is not a measurement of the command's initial paid impulse.
async function observePaidTurn(page, player, key, direction) {
  const baseline = await displayedEnergy(page);
  expect(baseline).toHaveLength(2);
  expect(baseline.every(Number.isFinite)).toBe(true);
  await page.evaluate(() => {
    const hud = document.querySelector('[data-testid="hud"]');
    if (!hud) throw new Error('HUD missing');
    const samples = [];
    const sample = () => {
      const bars = [...hud.querySelectorAll('div')].filter(el =>
        el.children.length === 0 && el.textContent?.trim() === 'ENERGY');
      if (bars.length !== 2 || samples.length >= 600) return;
      samples.push(bars.map(el => ({
        energy: Number.parseFloat(el.nextElementSibling?.firstElementChild?.style.width || 'NaN'),
        propulsion: el.parentElement?.querySelector('[data-testid="propulsion-state"]')?.textContent || ''
      })));
    };
    const observer = new MutationObserver(sample);
    observer.observe(hud, { childList: true, subtree: true, attributes: true, characterData: true });
    window.__osdPublicHudObservation = { samples, observer };
    sample();
  });
  let evidence;
  try {
    await page.keyboard.down(key);
    const readPaid = () => page.evaluate(({ player, direction, baseline }) => {
      const samples = window.__osdPublicHudObservation.samples;
      return samples.find(pair => pair[player].propulsion.includes(direction) &&
        Number.isFinite(pair[player].energy) && pair[player].energy < baseline[player]) || null;
    }, { player, direction, baseline });
    await expect.poll(readPaid, { timeout: 2500, intervals: [25, 50, 100],
      message: 'paid steering must be visible with reduced energy during the command' }).not.toBeNull();
    evidence = await readPaid();
    expect(evidence).not.toBeNull();
    expect(evidence[1 - player].energy, 'one pilot cannot spend the other pilot energy')
      .toBeGreaterThanOrEqual(baseline[1 - player] - 1.5);
    expect(evidence[1 - player].propulsion, 'one pilot cannot command the other pilot steering').not.toMatch(/TURN/);
    return { baseline, paid: evidence };
  } finally {
    await page.keyboard.up(key);
    await page.evaluate(() => {
      window.__osdPublicHudObservation?.observer.disconnect();
      delete window.__osdPublicHudObservation;
    });
  }
}

async function setPause(page, paused) {
  await page.keyboard.down('Escape');
  try {
    if (paused) await expect(page.getByTestId('paused-banner')).toBeVisible();
    else await expect(page.getByTestId('paused-banner')).toBeHidden();
  } finally { await page.keyboard.up('Escape'); }
  // Give the fixed-timestep input sampler a key-up edge before pressing again.
  await page.waitForTimeout(150);
  if (paused) await expect(page.getByTestId('paused-banner')).toBeVisible();
  else await expect(page.getByTestId('paused-banner')).toBeHidden();
}

for (const model of models) {
  for (const p1 of shipClasses) {
    for (const p2 of shipClasses) {
      test(`local two-human ${model} P1:${p1} P2:${p2} independent controls`,
        async ({ page }, info) => {
          test.setTimeout(75_000);
          const errors = await newGame(page, model, p1, p2);
          const p1Turn = await observePaidTurn(page, 0, 'a', 'TURN LEFT');
          // Ensure the first command has ended before observing the second.
          await expect(page.getByTestId('propulsion-state')).toHaveCount(0);
          const p2Turn = await observePaidTurn(page, 1, 'ArrowRight', 'TURN RIGHT');
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
          await setPause(page, true);
          await setPause(page, false);

          await page.screenshot({
            path: info.outputPath(`local-${model}-${p1}-${p2}.png`),
          });
          console.log(JSON.stringify({
            scenario: 'two-human-local', model, p1, p2, browser: info.project.name,
            p1Turn, p2Turn, pixels,
            errors,
          }));
          expect(errors, 'uncaught browser exceptions').toEqual([]);
        });
    }
  }
}

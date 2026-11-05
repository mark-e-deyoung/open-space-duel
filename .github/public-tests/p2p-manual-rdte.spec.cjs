// Public-safe two-browser P2P acceptance, no private QA hooks or server credentials.
// A same-runner ICE success is evidence for local WebRTC, not global NAT/TURN.
const { test, expect } = require('@playwright/test');

test('real manual WebRTC duel transfers player input and authoritative state', async ({ browser }) => {
  test.setTimeout(120_000);
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const failures = [];
  for (const [label, page] of [['host', host], ['guest', guest]]) {
    page.on('pageerror', e => failures.push(label + ': ' + String(e)));
  }

  async function dismissOnboarding(page) {
    const gotIt = page.getByRole('button', { name: /got it/i });
    if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  }

  async function findDuelPanel(page) {
    const create = page.getByTestId('host-manual-btn');
    for (let i = 0; i < 8 && !(await create.isVisible().catch(() => false)); i++) {
      const next = page.locator('#nav-next');
      await expect(next).toBeVisible();
      await next.click();
    }
    await expect(create).toBeVisible();
    return create;
  }

  try {
    await host.goto('', { waitUntil: 'domcontentloaded' });
    await guest.goto('', { waitUntil: 'domcontentloaded' });
    await dismissOnboarding(host);
    await dismissOnboarding(guest);
    await (await findDuelPanel(host)).click();

    const link = host.getByTestId('invite-link-input');
    await expect.poll(() => link.inputValue(), { timeout: 40_000 })
      .toMatch(/#invite=/);
    const url = await link.inputValue();
    if (!url.startsWith('http://127.0.0.1:4173/open-space-duel/')) {
      throw new Error('Untrusted or unexpected manual invite destination');
    }

    // A true second browser context handles the URL/hash; do not use app hooks.
    await guest.goto(url, { waitUntil: 'domcontentloaded' });
    await dismissOnboarding(guest);
    const reply = guest.getByTestId('response-link-output');
    await expect.poll(() => reply.inputValue(), { timeout: 40_000 })
      .toMatch(/#response=/);
    await host.getByTestId('response-input').fill(await reply.inputValue());
    await host.getByTestId('connect-btn').click();

    await expect(host.getByTestId('main-menu')).toBeHidden({ timeout: 50_000 });
    await expect(guest.getByTestId('main-menu')).toBeHidden({ timeout: 50_000 });
    await expect(host.getByTestId('hud')).toBeVisible();
    await expect(guest.getByTestId('hud')).toBeVisible();

    // The guest's actual keyboard input must reach the authoritative host,
    // then the host's state projection must reflect paid forward propulsion.
    await guest.keyboard.down('ArrowUp');
    await expect(host.getByTestId('propulsion-state').filter({ hasText: 'FORWARD THRUST' }))
      .toBeVisible({ timeout: 10_000 });
    await guest.keyboard.up('ArrowUp');
    await expect(host.getByTestId('propulsion-state').filter({ hasText: 'FORWARD THRUST' }))
      .toHaveCount(0, { timeout: 10_000 });
    console.log(JSON.stringify({ mode: 'manual-WebRTC', roundTrip: 'guest-input-to-host-HUD', result: 'observed' }));
    await host.screenshot({ path: test.info().outputPath('manual-host.png') });
    await guest.screenshot({ path: test.info().outputPath('manual-guest.png') });
    expect(failures).toEqual([]);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

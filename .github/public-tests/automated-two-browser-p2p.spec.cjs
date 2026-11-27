// Public user-path browser P2P acceptance. No private game hooks or mock signaling.
const { test, expect, chromium, firefox } = require('@playwright/test');
const types = { chromium, firefox };
const combinations = [
  ['chromium', 'chromium'], ['chromium', 'firefox'],
  ['firefox', 'chromium'], ['firefox', 'firefox'],
];
const base = process.env.DEPLOYED_BASE_URL;

async function initialize(ctx) {
  await ctx.addInitScript(() => {
    localStorage.setItem('osd_tutorial_dismissed', 'true');
    localStorage.setItem('osd_sound_enabled', 'false');
    const Original = window.RTCPeerConnection;
    window.__publicRtcProbe = [];
    window.RTCPeerConnection = class extends Original {
      constructor(...args) {
        super(...args);
        window.__publicRtcProbe.push(this);
      }
    };
  });
}

async function observedConnections(page) {
  return page.evaluate(() => (window.__publicRtcProbe || []).map(pc => ({
    connection: pc.connectionState,
    ice: pc.iceConnectionState,
    gathering: pc.iceGatheringState,
  })));
}

for (const mode of ['arcade', 'inertial']) {
  for (const [hostEngine, guestEngine] of combinations) {
    test(`real browser P2P ${mode} host:${hostEngine} guest:${guestEngine}`,
      async ({}, info) => {
        test.setTimeout(150_000);
        const hostBrowser = await types[hostEngine].launch({ timeout: 20_000 });
        const guestBrowser = await types[guestEngine].launch({ timeout: 20_000 });
        let hostCtx, guestCtx;
        const errors = { host: [], guest: [] };
        try {
          hostCtx = await hostBrowser.newContext({
            viewport: { width: 1120, height: 780 },
            recordVideo: { dir: info.outputPath('videos-host') },
          });
          guestCtx = await guestBrowser.newContext({
            viewport: { width: 1120, height: 780 },
            recordVideo: { dir: info.outputPath('videos-guest') },
          });
          await initialize(hostCtx);
          await initialize(guestCtx);
          const host = await hostCtx.newPage();
          const guest = await guestCtx.newPage();
          for (const page of [host, guest]) {
            page.setDefaultTimeout(15_000);
            page.setDefaultNavigationTimeout(20_000);
          }
          const stage = label => console.log(JSON.stringify({ scenario: 'browser-p2p', mode, hostEngine, guestEngine, stage: label }));
          stage('host navigation');
          host.on('pageerror', error => errors.host.push(error.message));
          guest.on('pageerror', error => errors.guest.push(error.message));

          await host.goto(base, { waitUntil: 'domcontentloaded' });
          await expect(host.getByTestId('main-menu')).toBeVisible();
          await host.getByTestId('flight-model-select').selectOption(mode);
          await host.getByTestId('open-host-card-btn').click();
          await expect(host.getByTestId('host-manual-btn')).toBeVisible();
          stage('create host offer');
          await host.getByTestId('host-manual-btn').click();
          const inviteBox = host.getByTestId('invite-link-input');
          await expect.poll(
            () => inviteBox.inputValue(),
            { timeout: 45_000, message: 'host must create real encoded WebRTC offer' },
          ).toContain('#invite=');
          const invite = await inviteBox.inputValue();
          // A normal user opens the genuine link; no URL testMode or app internals.
          stage('guest accepts offer');
          await guest.goto(invite, { waitUntil: 'domcontentloaded' });
          const responseBox = guest.getByTestId('response-link-output');
          await expect.poll(
            () => responseBox.inputValue(),
            { timeout: 45_000, message: 'guest must return answer to this session' },
          ).toContain('#response=');
          const response = await responseBox.inputValue();
          stage('host accepts answer');
          await host.getByTestId('response-input').fill(response);
          await host.getByTestId('connect-btn').click();

          stage('wait for actual transport');
          await expect.poll(
            async () => (await observedConnections(host)).some(x => x.connection === 'connected'),
            { timeout: 35_000, message: 'host real RTCPeerConnection not connected' },
          ).toBe(true);
          await expect.poll(
            async () => (await observedConnections(guest)).some(x => x.connection === 'connected'),
            { timeout: 35_000, message: 'guest real RTCPeerConnection not connected' },
          ).toBe(true);
          stage('verify both game surfaces');
          for (const page of [host, guest]) {
            await expect(page.locator('#game-canvas')).toBeVisible();
            await expect(page.getByTestId('hud')).toBeVisible();
            await expect(page.getByTestId('p1-stats')).toHaveCount(2);
            await page.locator('#game-canvas').click({ position: { x: 300, y: 200 } });
          }

          stage('independent real inputs');
          // Both human roles inject actual keyboard events, not state mutation.
          await host.keyboard.down('ArrowLeft');
          await expect(host.getByTestId('propulsion-state')).toContainText('TURN LEFT');
          await host.keyboard.up('ArrowLeft');
          await guest.keyboard.down('ArrowRight');
          await expect(guest.getByTestId('propulsion-state')).toContainText('TURN RIGHT');
          await guest.keyboard.up('ArrowRight');
          await host.keyboard.down('ArrowUp');
          await guest.keyboard.down('ArrowUp');
          await host.waitForTimeout(400);
          await host.keyboard.up('ArrowUp');
          await guest.keyboard.up('ArrowUp');
          await host.keyboard.press('Space');
          await guest.keyboard.press('Space');

          await expect(host.getByTestId('hud')).toBeVisible();
          await expect(guest.getByTestId('hud')).toBeVisible();
          const before = [await observedConnections(host), await observedConnections(guest)];
          await host.waitForTimeout(800);
          const after = [await observedConnections(host), await observedConnections(guest)];
          expect(after.every(side => side.some(x => x.connection === 'connected')))
            .toBe(true);
          await host.screenshot({ path: info.outputPath('real-host-' + mode + '.png') });
          await guest.screenshot({ path: info.outputPath('real-guest-' + mode + '.png') });
          console.log(JSON.stringify({
            scenario: 'two-real-browser-P2P', mode,
            hostEngine, guestEngine,
            connectionsBefore: before, connectionsAfter: after,
            exceptions: errors,
          }));
          expect(errors.host).toEqual([]);
          expect(errors.guest).toEqual([]);
        } catch (error) {
          console.error(JSON.stringify({ scenario: 'browser-p2p', mode, hostEngine, guestEngine, failure: String(error).slice(0, 500) }));
          throw error;
        } finally {
          await hostCtx?.close();
          await guestCtx?.close();
          await hostBrowser.close();
          await guestBrowser.close();
        }
      });
  }
}

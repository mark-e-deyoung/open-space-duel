// Public user-path browser P2P acceptance. No private game hooks or mock signaling.
const { test, expect, chromium, firefox } = require('@playwright/test');
const { focusGameplay } = require('./gameplay-focus.cjs');
// Offer/answer links and RTC credentials must not enter public traces or videos.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
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
        const errors = { host: 0, guest: 0 };
        let currentStage = 'initialize browsers';
        try {
          hostCtx = await hostBrowser.newContext({
            viewport: { width: 1120, height: 780 },
          });
          guestCtx = await guestBrowser.newContext({
            viewport: { width: 1120, height: 780 },
          });
          await initialize(hostCtx);
          await initialize(guestCtx);
          const host = await hostCtx.newPage();
          const guest = await guestCtx.newPage();
          for (const page of [host, guest]) {
            page.setDefaultTimeout(15_000);
            page.setDefaultNavigationTimeout(20_000);
          }
          const stage = label => { currentStage = label; console.log(JSON.stringify({ scenario: 'browser-p2p', mode, hostEngine, guestEngine, stage: label })); };
          stage('host navigation');
          host.on('pageerror', () => errors.host++);
          guest.on('pageerror', () => errors.guest++);

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
            await focusGameplay(page);
          }

          stage('independent real inputs');
          // Both human roles inject actual keyboard events, not state mutation.
          stage('host steering');
          await focusGameplay(host);
          await host.keyboard.down('ArrowLeft');
          await expect(host.getByTestId('propulsion-state')).toContainText('TURN LEFT');
          await host.keyboard.up('ArrowLeft');
          stage('guest steering');
          await focusGameplay(guest);
          await guest.keyboard.down('ArrowRight');
          await expect(guest.getByTestId('propulsion-state')).toContainText('TURN RIGHT');
          await guest.keyboard.up('ArrowRight');
          for (const [role, page] of [['host', host], ['guest', guest]]) {
            stage(role + ' thrust and fire');
            await focusGameplay(page);
            await page.keyboard.down('ArrowUp');
            try { await expect(page.getByTestId('propulsion-state')).toContainText('FORWARD THRUST'); }
            finally { await page.keyboard.up('ArrowUp'); }
            await page.keyboard.press('Space');
          }

          await expect(host.getByTestId('hud')).toBeVisible();
          await expect(guest.getByTestId('hud')).toBeVisible();
          const before = [await observedConnections(host), await observedConnections(guest)];
          await host.waitForTimeout(800);
          const after = [await observedConnections(host), await observedConnections(guest)];
          expect(after.every(side => side.some(x => x.connection === 'connected')))
            .toBe(true);
          stage('connected gameplay complete');
          console.log(JSON.stringify({
            scenario: 'two-real-browser-P2P', mode,
            hostEngine, guestEngine,
            connectionsBefore: before, connectionsAfter: after,
            exceptions: errors,
          }));
          expect(errors.host).toBe(0);
          expect(errors.guest).toBe(0);
        } catch (error) {
          const failureClass = error?.name === 'TimeoutError' ? 'TimeoutError' : 'AssertionOrRuntimeFailure';
          console.error(JSON.stringify({ scenario: 'browser-p2p', mode, hostEngine, guestEngine, stage: currentStage, failureClass }));
          throw new Error('P2P acceptance failed at ' + currentStage + ' (' + failureClass + ')');
        } finally {
          await hostCtx?.close();
          await guestCtx?.close();
          await hostBrowser.close();
          await guestBrowser.close();
        }
      });
  }
}

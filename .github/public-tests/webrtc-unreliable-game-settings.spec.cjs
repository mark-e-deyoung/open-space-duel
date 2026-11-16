// Public, standalone browser WebRTC capability probe. No game source,
// private hooks, credentials, artifact promotion, or external signaling.
const { test, expect } = require('@playwright/test');

test('unordered zero-retransmit real two-context browser RTCDataChannel', async ({ browser }, info) => {
  test.setTimeout(90_000);
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const host = await firstContext.newPage();
  const guest = await secondContext.newPage();
  try {
    await Promise.all([
      host.goto('http://127.0.0.1:4174/', { waitUntil: 'domcontentloaded' }),
      guest.goto('http://127.0.0.1:4174/', { waitUntil: 'domcontentloaded' }),
    ]);
    await host.evaluate(() => {
      const pc = new RTCPeerConnection({ iceServers: [] });
      const channel = pc.createDataChannel('transport-only-rdte', { ordered: false, maxRetransmits: 0 });
      const messages = [];
      channel.onmessage = (event) => messages.push(event.data);
      window.__transportProbe = { pc, channel, messages };
    });
    await guest.evaluate(() => {
      const pc = new RTCPeerConnection({ iceServers: [] });
      const messages = [];
      pc.ondatachannel = (event) => {
        const channel = event.channel;
        channel.onmessage = (msg) => messages.push(msg.data);
        window.__transportProbe.channel = channel;
      };
      window.__transportProbe = { pc, channel: null, messages };
    });

    const offer = await host.evaluate(async () => {
      const pc = window.__transportProbe.pc;
      await pc.setLocalDescription(await pc.createOffer());
      if (pc.iceGatheringState !== 'complete') {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Host ICE gathering timed out')), 20_000);
          pc.addEventListener('icegatheringstatechange', () => {
            if (pc.iceGatheringState === 'complete') {
              clearTimeout(timer);
              resolve();
            }
          });
        });
      }
      return pc.localDescription.toJSON();
    });
    const answer = await guest.evaluate(async (offerData) => {
      const pc = window.__transportProbe.pc;
      await pc.setRemoteDescription(offerData);
      await pc.setLocalDescription(await pc.createAnswer());
      if (pc.iceGatheringState !== 'complete') {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Guest ICE gathering timed out')), 20_000);
          pc.addEventListener('icegatheringstatechange', () => {
            if (pc.iceGatheringState === 'complete') {
              clearTimeout(timer);
              resolve();
            }
          });
        });
      }
      return pc.localDescription.toJSON();
    }, offer);
    await host.evaluate(async (answerData) =>
      window.__transportProbe.pc.setRemoteDescription(answerData), answer);

    await expect.poll(
      () => host.evaluate(() => window.__transportProbe.channel.readyState),
      { timeout: 20_000, message: 'Host RTCDataChannel failed to open' },
    ).toBe('open');
    await expect.poll(
      () => guest.evaluate(() => window.__transportProbe.channel?.readyState),
      { timeout: 20_000, message: 'Guest RTCDataChannel failed to open' },
    ).toBe('open');

    await host.evaluate(() => window.__transportProbe.channel.send('host-to-guest'));
    await expect.poll(
      () => guest.evaluate(() => window.__transportProbe.messages.join(',')),
      { timeout: 10_000 },
    ).toContain('host-to-guest');

    await guest.evaluate(() => window.__transportProbe.channel.send('guest-to-host'));
    await expect.poll(
      () => host.evaluate(() => window.__transportProbe.messages.join(',')),
      { timeout: 10_000 },
    ).toContain('guest-to-host');

    const options = await Promise.all([
      host.evaluate(() => ({
        ordered: window.__transportProbe.channel.ordered,
        maxRetransmits: window.__transportProbe.channel.maxRetransmits,
      })),
      guest.evaluate(() => ({
        ordered: window.__transportProbe.channel.ordered,
        maxRetransmits: window.__transportProbe.channel.maxRetransmits,
      })),
    ]);
    expect(options).toEqual([
      { ordered: false, maxRetransmits: 0 },
      { ordered: false, maxRetransmits: 0 },
    ]);

    // High-rate diagnostic, not an incorrect guarantee of no packet loss:
    // unreliable RTCDataChannel intentionally does not promise delivery.
    const sent = 100;
    await Promise.all([
      host.evaluate(n => {
        for (let i = 0; i < n; i++) {
          window.__transportProbe.channel.send('h-burst:' + i);
        }
      }, sent),
      guest.evaluate(n => {
        for (let i = 0; i < n; i++) {
          window.__transportProbe.channel.send('g-burst:' + i);
        }
      }, sent),
    ]);
    await expect.poll(
      () => guest.evaluate(() =>
        window.__transportProbe.messages.some(v => v.startsWith('h-burst:'))),
      { timeout: 10_000 },
    ).toBe(true);
    await expect.poll(
      () => host.evaluate(() =>
        window.__transportProbe.messages.some(v => v.startsWith('g-burst:'))),
      { timeout: 10_000 },
    ).toBe(true);
    await host.waitForTimeout(500);
    const received = await Promise.all([
      guest.evaluate(() =>
        window.__transportProbe.messages.filter(v => v.startsWith('h-burst:')).length),
      host.evaluate(() =>
        window.__transportProbe.messages.filter(v => v.startsWith('g-burst:')).length),
    ]);

    const states = await Promise.all([
      host.evaluate(() => window.__transportProbe.pc.connectionState),
      guest.evaluate(() => window.__transportProbe.pc.connectionState),
    ]);
    expect(states).toEqual(['connected', 'connected']);
    console.log(JSON.stringify({
      probe: 'public-only-unreliable-webrtc-host-ice',
      browser: info.project.name,
      hostAndGuest: states,
      dataChannel: 'bidirectional-unordered-maxRetransmits-0',
      packetsSentEachWay: sent,
      packetsReceived: received,
      options,
      result: 'pass',
    }));
  } finally {
    await firstContext.close();
    await secondContext.close();
  }
});

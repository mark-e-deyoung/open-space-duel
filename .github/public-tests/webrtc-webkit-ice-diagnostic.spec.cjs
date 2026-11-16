// Public-only WebKit ICE qualification differential. No private source,
// credentials, hosted deployment, external room service or product release.
const { test, expect } = require('@playwright/test');

const cases = [
  { name: 'ordered-host-only', channel: { ordered: true }, iceServers: [] },
  { name: 'unreliable-host-only', channel: { ordered: false, maxRetransmits: 0 }, iceServers: [] },
  { name: 'ordered-stun', channel: { ordered: true }, iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
];

async function gather(pc, label) {
  if (pc.iceGatheringState === 'complete') return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label + ' ICE timeout')), 20_000);
    const changed = () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', changed);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', changed);
  });
}

for (const candidate of cases) {
  test('WebKit ICE differential: ' + candidate.name, async ({ browser }, info) => {
    test.setTimeout(80_000);
    const contexts = [await browser.newContext(), await browser.newContext()];
    const pages = await Promise.all(contexts.map(ctx => ctx.newPage()));
    const [host, guest] = pages;
    try {
      await Promise.all(pages.map(page =>
        page.goto('http://127.0.0.1:4174/', { waitUntil: 'domcontentloaded' })));
      await host.evaluate(cfg => {
        const pc = new RTCPeerConnection({ iceServers: cfg.iceServers });
        const channel = pc.createDataChannel('osd-public-ice-diagnostic', cfg.channel);
        window.__iceProbe = { pc, channel, messages: [] };
      }, candidate);
      await guest.evaluate(cfg => {
        const pc = new RTCPeerConnection({ iceServers: cfg.iceServers });
        const state = { pc, channel: null, messages: [] };
        pc.ondatachannel = event => {
          state.channel = event.channel;
          state.channel.onmessage = msg => state.messages.push(msg.data);
        };
        window.__iceProbe = state;
      }, candidate);
      const offer = await host.evaluate(async () => {
        const pc = window.__iceProbe.pc;
        await pc.setLocalDescription(await pc.createOffer());
        if (pc.iceGatheringState !== 'complete') {
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Host ICE gather timeout')), 20_000);
            pc.addEventListener('icegatheringstatechange', () => {
              if (pc.iceGatheringState === 'complete') {
                clearTimeout(timeout);
                resolve();
              }
            });
          });
        }
        return pc.localDescription.toJSON();
      });
      const answer = await guest.evaluate(async offerData => {
        const pc = window.__iceProbe.pc;
        await pc.setRemoteDescription(offerData);
        await pc.setLocalDescription(await pc.createAnswer());
        if (pc.iceGatheringState !== 'complete') {
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Guest ICE gather timeout')), 20_000);
            pc.addEventListener('icegatheringstatechange', () => {
              if (pc.iceGatheringState === 'complete') {
                clearTimeout(timeout);
                resolve();
              }
            });
          });
        }
        return pc.localDescription.toJSON();
      }, offer);
      await host.evaluate(x => window.__iceProbe.pc.setRemoteDescription(x), answer);

      const snapshot = () => Promise.all(pages.map(page => page.evaluate(() => {
        const { pc, channel } = window.__iceProbe;
        const sdp = pc.localDescription?.sdp ?? '';
        const remote = pc.remoteDescription?.sdp ?? '';
        return {
          gathering: pc.iceGatheringState,
          iceConnection: pc.iceConnectionState,
          peerConnection: pc.connectionState,
          channel: channel?.readyState ?? 'none',
          ordered: channel?.ordered ?? null,
          maxRetransmits: channel?.maxRetransmits ?? null,
          localCandidates: (sdp.match(/^a=candidate:/gm) || []).length,
          remoteCandidates: (remote.match(/^a=candidate:/gm) || []).length,
        };
      })));
      try {
        await expect.poll(
          () => host.evaluate(() => window.__iceProbe.channel.readyState),
          { timeout: 20_000, message: candidate.name + ': host datachannel did not open' },
        ).toBe('open');
        await expect.poll(
          () => guest.evaluate(() => window.__iceProbe.channel?.readyState),
          { timeout: 10_000, message: candidate.name + ': guest datachannel did not open' },
        ).toBe('open');
      } finally {
        console.log(JSON.stringify({
          probe: 'public-webkit-ice-differential',
          browser: info.project.name,
          case: candidate.name,
          sides: await snapshot(),
        }));
      }
      await host.evaluate(() => window.__iceProbe.channel.send('public-ping'));
      await expect.poll(
        () => guest.evaluate(() => window.__iceProbe.messages.includes('public-ping')),
        { timeout: 10_000 },
      ).toBe(true);
    } finally {
      await Promise.all(contexts.map(x => x.close()));
    }
  });
}

// Records a mobile-width demo as frames, then prints the ffmpeg command to encode it.
// Usage: node record-demo.mjs <url> <outdir> <steps.json>
//
// steps.json is an array, executed in order:
//   { "wait": 800 }                 sleep in ms (also used as pacing between frames)
//   { "tap": "#continueBtn" }       tap the centre of a CSS selector
//   { "tapPoint": [160, 420] }      tap viewport coordinates
//   { "eval": "__demo.scrollTo(0)" }run JS, wait for promises
//
// Requires Chrome started with --remote-debugging-port (default 9333) and the
// page served over http (ES modules + importmap don't work from file://).

import fs from 'node:fs';

const PORT = Number(process.env.CDP_PORT || 9333);
const [, , URL_, OUTDIR, STEPS] = process.argv;
if (!URL_ || !OUTDIR || !STEPS) {
  console.error('usage: node record-demo.mjs <url> <outdir> <steps.json>');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const steps = JSON.parse(fs.readFileSync(STEPS, 'utf8'));

fs.rmSync(OUTDIR, { recursive: true, force: true });
fs.mkdirSync(OUTDIR, { recursive: true });

const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const browserWs = new WebSocket(version.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();
const frames = [];
let frame = 0;

const send = (ws, method, params = {}, sessionId) => {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej }));
};
browserWs.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
  }
});
await new Promise((r) => browserWs.addEventListener('open', r, { once: true }));

const { targetId } = await send(browserWs, 'Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send(browserWs, 'Target.attachToTarget', { targetId, flatten: true });
const sess = (m, p) => send(browserWs, m, p, sessionId);

await sess('Page.enable');
await sess('Runtime.enable');
await sess('Emulation.setDeviceMetricsOverride', {
  width: Number(process.env.VIEWPORT_W || 390),
  height: Number(process.env.VIEWPORT_H || 844),
  deviceScaleFactor: 2,
  mobile: true,
});
await sess('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

browserWs.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method !== 'Page.screencastFrame') return;
  const file = `f${String(frame++).padStart(5, '0')}.png`;
  fs.writeFileSync(`${OUTDIR}/${file}`, Buffer.from(m.params.data, 'base64'));
  frames.push({ file, t: m.params.metadata.timestamp });
  sess('Page.screencastFrameAck', { sessionId: m.params.sessionId }).catch(() => {});
});

const evalJS = async (expression) => {
  const r = await sess('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};

const tapAt = async (x, y) => {
  await sess('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await sleep(60);
  await sess('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(70);
  await sess('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};

const centreOf = async (sel) =>
  JSON.parse(
    await evalJS(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();
      return JSON.stringify([r.x+r.width/2, r.y+r.height/2])})()`)
  );

await sess('Page.navigate', { url: URL_ });
await sleep(Number(process.env.SETTLE_MS || 2600));
await sess('Page.startScreencast', { format: 'png', maxWidth: 780, maxHeight: 1688, everyNthFrame: 1 });
await sleep(500);

for (const step of steps) {
  if (step.wait) await sleep(step.wait);
  if (step.tap) {
    const [x, y] = await centreOf(step.tap);
    await tapAt(x, y);
  }
  if (step.tapPoint) await tapAt(step.tapPoint[0], step.tapPoint[1]);
  if (step.eval) await evalJS(step.eval);
}

await sess('Page.stopScreencast');
await sess('Target.closeTarget', { targetId });
browserWs.close();

// concat list using real frame timestamps so timing matches what the page did
const lines = [];
for (let i = 0; i < frames.length; i++) {
  const dur = i + 1 < frames.length ? Math.max(0.01, Math.min(0.5, frames[i + 1].t - frames[i].t)) : 0.6;
  lines.push(`file '${frames[i].file}'`, `duration ${dur.toFixed(4)}`);
}
lines.push(`file '${frames[frames.length - 1].file}'`);
fs.writeFileSync(`${OUTDIR}/list.txt`, lines.join('\n'));

console.log(`${frames.length} frames in ${OUTDIR}`);
console.log(
  `ffmpeg -f concat -safe 0 -i ${OUTDIR}/list.txt -vf "scale=540:-2,fps=30" ` +
    `-c:v libx264 -preset slow -crf 26 -pix_fmt yuv420p -movflags +faststart ${OUTDIR}/demo.mp4`
);
process.exit(0);

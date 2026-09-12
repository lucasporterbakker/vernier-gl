#!/usr/bin/env node
/* vernier — record the drafting table's demo to video.

   Drives a headless Chrome over the DevTools protocol, plays the table's
   own in-page demo (demo/drive.js), captures the screencast, and hands the
   frames to ffmpeg with their real timestamps.

     npm install            # once, for `ws`
     node record.mjs                                  # records http://localhost:4174/
     node record.mjs https://example.com/table/ --out ../../out --size 1280x800 --scale 2

   Needs Chrome (or CHROME=/path/to/chrome), node ≥ 18, and ffmpeg on PATH
   for the .mp4 (the frames and the concat list are written either way). */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import http from 'node:http';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const url = args.find(a => /^https?:/.test(a)) || 'http://localhost:4174/';
const out = resolve(opt('--out', 'out'));
const [W, H] = opt('--size', '1280x800').split('x').map(Number);
const scale = Number(opt('--scale', '2'));
const port = Number(opt('--port', '9334'));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = p => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port, path: p }, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => res(JSON.parse(b))); }).on('error', rej);
});

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const profile = join(tmpdir(), `vernier-record-${process.pid}`);
// a real device scale factor, not an emulated one: the screencast only hands
// out retina frames when the window itself is hi-dpi (emulation captures at
// css pixels). Headless keeps a toolbar's worth of the window, so the bounds
// are corrected after launch until the viewport is exactly W × H.
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--hide-scrollbars', `--window-size=${W},${H + 90}`, `--force-device-scale-factor=${scale}`,
  'about:blank',
], { stdio: 'ignore' });
const wipe = () => { try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { /* Chrome still closing; the OS reaps its temp dir */ } };
const cleanup = async () => {
  if (chrome.exitCode === null && !chrome.killed) {
    const gone = new Promise(r => chrome.once('exit', r));
    chrome.kill();
    await Promise.race([gone, sleep(3000)]);
  }
  wipe();
};
process.on('exit', () => { try { chrome.kill(); } catch (e) { /* gone */ } wipe(); });

try {
  let targets = null;
  for (let i = 0; i < 50 && !targets; i++) { try { targets = await getJson('/json'); } catch (e) { await sleep(200); } }
  if (!targets) throw new Error('Chrome did not come up on the debugging port');
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl, { maxPayload: 512 * 1024 * 1024 });
  await new Promise(r => ws.on('open', r));

  let id = 0;
  const pending = new Map();
  const frames = [];
  let recording = false;
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params }));
  });
  ws.on('message', d => {
    const m = JSON.parse(d);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else if (m.method === 'Page.screencastFrame') {
      if (recording) frames.push({ data: m.params.data, t: m.params.metadata.timestamp });
      send('Page.screencastFrameAck', { sessionId: m.params.sessionId }).catch(() => {});
    }
    else if (m.method === 'Runtime.exceptionThrown') console.error('page exception:', (m.params.exceptionDetails.exception || {}).description || '');
  });
  const ev = async (expr, awaitPromise = false) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise })).result.value;

  await send('Page.enable');
  await send('Runtime.enable');
  const { windowId } = await send('Browser.getWindowForTarget');
  for (let i = 0; i < 4; i++) {
    const [iw, ih] = await ev('[innerWidth, innerHeight]');
    if (iw === W && ih === H) break;
    const { bounds } = await send('Browser.getWindowBounds', { windowId });
    await send('Browser.setWindowBounds', { windowId, bounds: { width: bounds.width + (W - iw), height: bounds.height + (H - ih) } });
    await sleep(300);
  }
  console.log('viewport', await ev('innerWidth + "×" + innerHeight + " @" + devicePixelRatio + "x"'));

  // a clean sheet: clear the last drawing, reload, wait for the table
  await send('Page.navigate', { url });
  await sleep(2500);
  await ev('localStorage.removeItem("vernier-table"); history.replaceState(null, "", location.pathname);');
  await send('Page.navigate', { url });
  for (let i = 0; i < 100 && !(await ev('typeof window.__demo === "object" && typeof window.__table === "object"')); i++) await sleep(100);
  await sleep(1200);

  frames.length = 0;
  await send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W * scale, maxHeight: H * scale, everyNthFrame: 1 });
  recording = true;
  await sleep(400);
  await ev('window.__demo.play()', true);   // resolves when the demo finishes
  await sleep(300);
  recording = false;
  await send('Page.stopScreencast');
  ws.close();

  if (!frames.length) throw new Error('no frames captured');
  const t0 = frames[0].t;
  const list = ['ffconcat version 1.0'];
  frames.forEach((f, i) => {
    const name = `f${String(i).padStart(5, '0')}.jpg`;
    writeFileSync(join(out, name), Buffer.from(f.data, 'base64'));
    const next = frames[i + 1] ? frames[i + 1].t : f.t + 1 / 30;
    list.push(`file '${name}'`, `duration ${Math.max(1 / 60, next - f.t).toFixed(4)}`);
  });
  list.push(`file 'f${String(frames.length - 1).padStart(5, '0')}.jpg'`);
  writeFileSync(join(out, 'list.txt'), list.join('\n') + '\n');
  console.log(`${frames.length} frames over ${(frames[frames.length - 1].t - t0).toFixed(1)}s → ${out}`);

  const mp4 = join(out, 'vernier-gl.mp4');
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(out, 'list.txt'),
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-r', '30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-movflags', '+faststart', mp4],
    { stdio: 'inherit' });
  const code = await new Promise(r => ff.on('exit', r).on('error', () => r(-1)));
  if (code === 0) console.log(`wrote ${mp4}`);
  else console.log('ffmpeg not available or failed — the frames and list.txt are in place for a manual encode');
} finally {
  await cleanup();
}

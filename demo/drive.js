/* vernier — the drafting table's own demo, in-page.

   The recording script, made playable: a plan of "WEBGL" as city blocks
   draws itself on the flat sheet, the last letter is drafted live (one
   plate typed in by size), the sheet tilts into a skyline, the new tower
   is pulled up by its top edge, its crown is dropped onto the next tower
   and climbs it, and the camera walks once around the block — all through
   the same pointer, wheel, and keyboard events a hand would send, so
   nothing is faked. It plays once on a fresh, empty table after a few
   idle seconds; the ▶ button replays it, and your own drawing is put back
   afterwards. Any click, scroll, or key of yours stops it on the spot. */

(() => {
  const STOP = Symbol('stop');
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let tbl = null, playing = false, armed = 0, autoDone = false, waiting = null;

  /* ---------- presentation cursor: the site's own arrow, hand, and jaws ---------- */

  const AC = '#a9c1fa', K = '#0e0f15';
  const el = document.createElement('div');
  el.id = 'demo-cursor';
  el.style.cssText = 'position:fixed;left:0;top:0;z-index:9;pointer-events:none;display:none;will-change:transform;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.5))';
  document.body.appendChild(el);
  const svg = b => `<svg width="26" height="26" viewBox="0 0 26 26" xmlns="http://www.w3.org/2000/svg">${b}</svg>`;
  const ink = `fill="${AC}" stroke="${K}" stroke-width="1.15" stroke-linejoin="round"`;
  const GLYPH = {
    default: svg(`<path d="M2 1.6 L15.4 9.5 L9.1 10.8 L5.9 16.7 Z" ${ink}/>`),
    'ew-resize': svg(`<g transform="translate(13,13)"><path d="M-10.5 0 L-5.2 -4.2 L-5.2 -1.5 L5.2 -1.5 L5.2 -4.2 L10.5 0 L5.2 4.2 L5.2 1.5 L-5.2 1.5 L-5.2 4.2 Z" ${ink}/></g>`),
    'ns-resize': svg(`<g transform="translate(13,13)"><path d="M0 -10.5 L4.2 -5.2 L1.5 -5.2 L1.5 5.2 L4.2 5.2 L0 10.5 L-4.2 5.2 L-1.5 5.2 L-1.5 -5.2 L-4.2 -5.2 Z" ${ink}/></g>`),
    grab: svg(`<g transform="translate(4,2)"><path d="M3.6 11.4 V5.0 a1.35 1.35 0 0 1 2.7 0 V10 V4.0 a1.35 1.35 0 0 1 2.7 0 V10 V4.7 a1.35 1.35 0 0 1 2.7 0 V10.4 V7.0 a1.35 1.35 0 0 1 2.7 0 V13.6 c0 4.1-2.3 6.6-5.9 6.6 -2.9 0-4.1-1.2-5.7-3.8 L1.2 13.3 a1.45 1.45 0 0 1 2.4-1.7 Z" ${ink}/></g>`),
    grabbing: svg(`<g transform="translate(4,5)"><path d="M2.9 8.6 V7.4 a1.35 1.35 0 0 1 2.7 0 V8.1 a1.35 1.35 0 0 1 2.7 0 V8.3 a1.35 1.35 0 0 1 2.7 0 V8.5 a1.35 1.35 0 0 1 2.7 0 V12.2 c0 3.8-2.2 5.9-5.6 5.9 -2.7 0-3.9-1.1-5.4-3.4 L0.8 10.5 a1.45 1.45 0 0 1 2.1-1.6 Z" ${ink}/></g>`),
  };
  const OFF = { default: [0, 0], grab: [-13, -13], grabbing: [-13, -13], 'ew-resize': [-13, -13], 'ns-resize': [-13, -13] };
  let kind = '', cx = -100, cy = -100, dirty = true, shown = false, tickId = 0;
  function tick() {
    if (!shown) { tickId = 0; return; }
    const c = tbl.canvas.style.cursor || 'default';
    const k = GLYPH[c] ? c : 'default';
    if (dirty || k !== kind) {
      if (k !== kind) { kind = k; el.innerHTML = GLYPH[k]; }
      const o = OFF[kind];
      el.style.transform = `translate(${Math.round(cx + o[0])}px, ${Math.round(cy + o[1])}px)`;
      dirty = false;
    }
    tickId = requestAnimationFrame(tick);
  }
  const cursor = {
    show() { shown = true; el.style.display = 'block'; if (!tickId) tickId = requestAnimationFrame(tick); },
    hide() { shown = false; el.style.display = 'none'; },
    at(x, y) { cx = x; cy = y; dirty = true; },
  };

  /* ---------- synthetic input: the events a hand would send ---------- */

  let held = false, px = 0, py = 0;
  const ptr = (type, extra) => tbl.canvas.dispatchEvent(new PointerEvent(type, {
    clientX: px, clientY: py, bubbles: true, cancelable: true, pointerType: 'mouse', isPrimary: true, button: 0, ...extra,
  }));
  const moveTo = (x, y) => { px = x; py = y; cursor.at(x, y); ptr('pointermove', { buttons: held ? 1 : 0 }); };
  const press = () => { held = true; ptr('pointerdown', { buttons: 1 }); };
  const release = () => { held = false; ptr('pointerup', { buttons: 0 }); };
  const wheel = (dx, dy, pinch) => tbl.canvas.dispatchEvent(new WheelEvent('wheel', {
    clientX: px, clientY: py, deltaX: dx, deltaY: dy, ctrlKey: !!pinch, bubbles: true, cancelable: true,
  }));
  const key = k => dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const sleep = ms => new Promise((res, rej) => {
    const id = setTimeout(() => { waiting = null; res(); }, ms);
    waiting = () => { clearTimeout(id); waiting = null; rej(STOP); };
  });
  async function glide(to, steps = 14, dt = 16) {
    const x0 = px, y0 = py;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps, e = k * k * (3 - 2 * k);
      moveTo(x0 + (to[0] - x0) * e, y0 + (to[1] - y0) * e);
      await sleep(dt);
    }
  }
  const click = async () => { press(); await sleep(45); release(); };

  /* ---------- the plan: "WEBGL" as city blocks, relative to the sheet centre, y up ----------
     Each letter is a city block: 48px-thick strokes cut into lots, every lot its own
     building with its own height, standing on an 8px plinth that reads as the
     block's sidewalk. Tiers are the setbacks on the towers and the little squares are
     rooftop plant; both are plates that stack on the lot beneath. Lots are
     [x0, y0, x1, y1, height] in px from the letter's bottom-left corner. Drafting
     order is build order, so each block goes plinth, lots, tiers. */

  // Everything sits on the major grid: blocks are 3 × 4 majors (the W is 4 × 4),
  // avenues are one major wide, and the block edges land on major lines. Inside a
  // block the letter is drawn in 64px stroke zones with an 8px sidewalk at every
  // edge, so strokes that meet leave a 16px lane between their buildings.
  const X0 = -640, Y0 = -128;   // the five blocks span 1280 × 256, centred on the sheet
  const LETTERS = {
    W: { at: 0, w: 256, lots: [
      [8, 8, 56, 96, 104], [8, 96, 56, 176, 232], [8, 176, 56, 248, 72],          // left stem
      [200, 8, 248, 72, 64], [200, 72, 248, 168, 272], [200, 168, 248, 248, 128],  // right stem
      [72, 8, 128, 56, 40], [128, 8, 184, 56, 80],                                 // bottom bar
      [104, 72, 152, 128, 168], [104, 128, 152, 184, 56],                          // middle stroke
      [16, 104, 48, 168, 56], [24, 112, 40, 160, 40],                              // setbacks
      [208, 80, 240, 160, 64], [216, 88, 232, 152, 48],
      [24, 200, 40, 216, 16], [144, 24, 160, 40, 16],                              // rooftop plant
    ] },
    E: { at: 320, w: 192, lots: [
      [8, 8, 56, 104, 96], [8, 104, 56, 184, 224], [8, 184, 56, 248, 128],
      [72, 200, 128, 248, 64], [128, 200, 184, 248, 112],
      [72, 104, 112, 152, 56], [112, 104, 152, 152, 40],
      [72, 8, 128, 56, 48], [128, 8, 184, 56, 144],
      [16, 112, 48, 176, 56], [24, 120, 40, 168, 40],
      [136, 16, 176, 48, 40],
      [144, 216, 160, 232, 16], [24, 48, 40, 64, 16],
    ] },
    B: { at: 576, w: 192, lots: [
      [8, 8, 56, 80, 112], [8, 80, 56, 160, 296], [8, 160, 56, 248, 160],
      [72, 200, 120, 248, 72], [120, 200, 184, 248, 120],
      [136, 160, 184, 192, 96],
      [72, 104, 120, 152, 48], [120, 104, 184, 152, 80],
      [136, 64, 184, 96, 128],
      [72, 8, 120, 56, 40], [120, 8, 184, 56, 88],
      [16, 88, 48, 152, 64], [24, 96, 40, 144, 48],
      [144, 72, 176, 88, 40],
      [24, 200, 40, 216, 16], [144, 24, 160, 40, 16],
    ] },
    G: { at: 832, w: 192, lots: [
      [8, 200, 64, 248, 120], [64, 200, 120, 248, 56], [120, 200, 184, 248, 176],
      [8, 8, 56, 96, 128], [8, 96, 56, 184, 240],
      [72, 8, 128, 56, 64], [128, 8, 184, 56, 104],
      [136, 72, 184, 120, 144],
      [104, 128, 184, 152, 40],
      [16, 104, 48, 176, 56], [24, 112, 40, 168, 40],
      [128, 208, 176, 240, 48],
      [152, 88, 168, 104, 16],
    ] },
    L: { at: 1088, w: 192, lots: [] },   // its plinth is laid with the plan; the buildings are drafted live
  };
  const LX = X0 + LETTERS.L.at;
  const L_STEM = [LX + 8, Y0 + 8, LX + 56, Y0 + 248];
  const L_FOOT_ANCHOR = [LX + 72, Y0 + 8], L_FOOT_SIZE = ['112', '48'];
  const L_CROWN = [LX + 8, Y0 + 96, LX + 56, Y0 + 144];
  const DROP_LO = [X0 + LETTERS.G.at + 8, Y0 + 24];   // where the L's crown gets dropped: the G stem's lowest lot
  const N_PLAN = Object.values(LETTERS).reduce((n, l) => n + 1 + l.lots.length, 0);
  const IDX = { lStem: N_PLAN, lFoot: N_PLAN + 1, lCrown: N_PLAN + 2 };

  const snap64 = v => Math.round(v / 64) * 64;
  const centre = () => { const [W, H] = tbl.size(); return [snap64(W / 2), snap64(H / 2)]; };
  const ground = (x, y) => { const c = centre(); return tbl.project(c[0] + x, c[1] + y, 0); };

  function cityPlates() {
    const c = centre(), out = [];
    for (const k of 'WEBGL') {
      const L = LETTERS[k], ox = c[0] + X0 + L.at, oy = c[1] + Y0;
      out.push({ lo: [ox, oy], hi: [ox + L.w, oy + 256], h: 8 });   // the plinth: the block itself, on the majors
      for (const [x0, y0, x1, y1, h] of L.lots)
        out.push({ lo: [ox + x0, oy + y0], hi: [ox + x1, oy + y1], h });
    }
    return out;
  }

  async function draft([x0, y0, x1, y1]) {
    await glide(ground(x0, y0), 12); await sleep(110);
    await click(); await sleep(80);
    await glide(ground(x1, y1), 14); await sleep(120);
    await click(); await sleep(210);
  }

  // anchor a plate with one click, then type its size: w, x, h, enter
  async function draftTyped([x0, y0], [w, h]) {
    await glide(ground(x0, y0), 12); await sleep(110);
    await click(); await sleep(80);
    await glide(ground(x0 + 48, y0 + 24), 8); await sleep(200);
    for (const ch of w) { key(ch); await sleep(110); }
    key('x'); await sleep(140);
    for (const ch of h) { key(ch); await sleep(110); }
    await sleep(320);
    key('Enter'); await sleep(260);
  }

  // find the top edge of a wall on screen: probe just below its projected line
  // until the table reports the height handle under the cursor
  function wallGrab(t) {
    const st = tbl.state();
    const r = st.rects[t.box];
    const rk = Math.min(1, st.tilt * 3.2);
    const top = (r.base + r.h) * rk;
    const q = t.wall === 'left'
      ? [r.lo[0] + 0.5, (r.lo[1] + r.hi[1]) / 2]
      : [r.lo[0] + t.at * (r.hi[0] - r.lo[0]), r.lo[1] + 0.5];
    const s = tbl.project(q[0], q[1], top);
    if (!s) return null;
    for (const dy of [4, 6, 8, 10, 3, 12, 14]) {
      moveTo(s[0], s[1] + dy);
      const h = tbl.state().hover;
      if (h.box === t.box && h.mode === 'resize' && h.bound === 'z') return [s[0], s[1] + dy];
    }
    return null;
  }

  async function pull(t) {
    const from = [px, py];
    const pt = wallGrab(t);
    moveTo(from[0], from[1]);
    if (!pt) return;
    await glide(pt, 16); await sleep(240);
    press();
    const d = tbl.state().drag;
    if (!d.on) { release(); return; }
    const to = [d.sx + d.unit[0] * t.dz * d.perUnit, d.sy + d.unit[1] * t.dz * d.perUnit];
    await glide(to, 12, 24);
    release();
    await sleep(480);
  }

  // the hint line narrates, so a watcher knows they're watching — and how to stop
  const DEMO = '<em>demo</em> &nbsp;&middot;&nbsp; ';
  const TAKE = ' &nbsp;&middot;&nbsp; <em>click, scroll, or type</em> to take over';
  const say = t => tbl.hint(DEMO + t + TAKE);

  // move a volume by its top face to a new low corner: the aim accounts for
  // the hand's own parallax, since the table tracks the sheet point under it
  async function slide(idx, lo) {
    const c = centre();
    const st = tbl.state();
    const r = st.rects[idx];
    if (!r) return;
    const rk = Math.min(1, st.tilt * 3.2);
    const fc = tbl.project((r.lo[0] + r.hi[0]) / 2, (r.lo[1] + r.hi[1]) / 2, (r.base + r.h) * rk);
    if (!fc) return;
    await glide(fc, 20); await sleep(500);
    press();
    const g0 = tbl.ground(px, py);
    const dest = g0 && tbl.project(c[0] + lo[0] + (g0.x - r.lo[0]), c[1] + lo[1] + (g0.y - r.lo[1]), 0);
    if (dest) await glide(dest, 22, 26);
    release();
    await sleep(650);
  }

  async function run() {
    const [W, H] = tbl.size();
    say('a plan, drafted flat: five city blocks that spell a word');
    moveTo(W * 0.12, H * 0.86);
    await sleep(300);
    for (let i = 0; i < 2; i++) { wheel(0, 6.8, true); await sleep(70); }   // pinch out a touch: the blocks fill the sheet
    await sleep(500);
    const plan = cityPlates();
    for (let i = 0; i < plan.length; i++) { tbl.add(plan[i], i === 0); await sleep(30); }
    await sleep(700);

    say('drafting the last block: click&ndash;click, then a plate typed in by size');
    await draft(L_STEM);
    await draftTyped(L_FOOT_ANCHOR, L_FOOT_SIZE);
    await draft(L_CROWN);
    await glide([W * 0.86, H * 0.86], 14); await sleep(700);

    // tilt the sheet into perspective (the target leads; the view eases after it)
    say('tilting the sheet &mdash; the plan stands up into a skyline');
    for (let i = 0; i < 60 && tbl.state().tiltTgt < 0.52; i++) { wheel(0, 42); await sleep(42); }
    await sleep(1800);

    say('pulling the new tower up by its top edge');
    await pull({ box: IDX.lStem, wall: 'front', at: 0.5, dz: 208 });

    say('dropping its crown on the next block &mdash; it climbs to the top');
    await slide(IDX.lCrown, DROP_LO);

    // pinch out, drop the camera to street height, and walk around the block
    say('pinching out, tilting low, and walking around the block');
    await glide([W * 0.9, H * 0.88], 14); await sleep(300);
    for (let i = 0; i < 3; i++) { wheel(0, 6.2, true); await sleep(70); }
    await sleep(500);
    for (let i = 0; i < 60 && tbl.state().tiltTgt < 0.86; i++) { wheel(0, 42); await sleep(42); }
    await sleep(1400);
    const tv = tbl.state().tilt, ease = tv * tv * (3 - 2 * tv), want = 2 * Math.PI / ease;
    for (let i = 0; i < 400 && tbl.state().orbitTgt < want; i++) { wheel(13, 0); await sleep(46); }   // a slow walk
    await sleep(2800);
  }

  /* ---------- play / stop ---------- */

  const button = document.getElementById('play');
  const label = () => { if (button) button.innerHTML = playing ? '&#9632; stop' : '&#9654; watch'; };

  let yourTurnT = 0;
  async function play() {
    if (!tbl || playing) return;
    playing = true; label();
    clearTimeout(yourTurnT);
    const own = tbl.empty() ? null : tbl.snapshot();
    let finished = false;
    tbl.quiet(true);
    if (own) tbl.clear();
    tbl.resetView();
    cursor.show();
    try {
      for (let i = 0; i < 40 && tbl.state().tilt > 0.002; i++) await sleep(50);   // let a tilted view settle flat
      await run();
      finished = true;
    } catch (e) {
      if (e !== STOP) console.error(e);
    } finally {
      if (held) release();
      cursor.hide();
      tbl.quiet(false);
      if (own) { tbl.restore(own); tbl.hint(null); }
      else if (finished) {
        tbl.hint('<em>your turn</em> &nbsp;&middot;&nbsp; click&ndash;click drafts &nbsp;&middot;&nbsp; faces move &nbsp;&middot;&nbsp; lines resize &nbsp;&middot;&nbsp; <em>&#8984;z</em> takes it all back');
        yourTurnT = setTimeout(() => { if (!playing) tbl.hint(null); }, 9000);
      } else tbl.hint(null);
      playing = false; label();
    }
  }
  const stop = () => { if (waiting) waiting(); };

  // a person's click, scroll, or key ends the demo; their pointer moves are
  // kept away from the table while it plays so the choreography holds
  const onReal = e => { if (playing && e.isTrusted) { autoDone = true; disarm(); stop(); } };
  addEventListener('pointerdown', onReal, true);
  addEventListener('wheel', onReal, true);
  addEventListener('keydown', onReal, true);
  addEventListener('pointermove', e => { if (playing && e.isTrusted) e.stopImmediatePropagation(); }, true);

  /* ---------- auto-play: once, on a fresh empty table, after a quiet moment ---------- */

  const disarm = () => { clearTimeout(armed); armed = 0; };
  function arm() {
    if (!tbl || autoDone || playing || !fine || reduced || tbl.fromLink || !tbl.empty()) return;
    disarm();
    armed = setTimeout(() => {
      armed = 0;
      if (document.hidden || playing || !tbl.empty()) return;
      autoDone = true;
      play();
    }, 5000);
  }
  addEventListener('pointermove', e => { if (e.isTrusted && !playing) arm(); }, true);
  for (const t of ['pointerdown', 'wheel', 'keydown'])
    addEventListener(t, e => { if (e.isTrusted && !playing) { autoDone = true; disarm(); } }, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) disarm(); else arm(); });

  if (button) button.addEventListener('click', () => { if (playing) stop(); else play(); });

  (function start(tries) {
    tbl = window.__table;
    if (!tbl) { if (tries > 0) setTimeout(() => start(tries - 1), 50); return; }
    if (!fine && button) button.hidden = true;
    arm();
  })(200);

  window.__demo = { play, stop, get playing() { return playing; }, get armed() { return armed !== 0; } };
})();

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
     Each letter is a block of lots on a 5×7 grid of 32px cells: [x0, y0, x1, y1, height],
     every lot its own building, so the strokes read as a skyline rather than an
     extrusion. Tiers are the setbacks on the towers: narrower plates that stack on a
     lot. Drafting order is build order, so every tier follows its lot. */

  const CELL = 32, X0 = -496, Y0 = -112;   // the block is 992 × 224, centred
  const LETTERS = {
    W: { at: 0, lots: [
      [0, 0, 1, 3, 120], [0, 3, 1, 5, 200], [0, 5, 1, 7, 88],          // left stem
      [4, 0, 5, 2, 72], [4, 2, 5, 5, 232], [4, 5, 5, 7, 136],          // right stem
      [1, 0, 2, 1, 48], [2, 0, 3, 1, 96], [3, 0, 4, 1, 56],            // bottom bar
      [2, 1, 3, 3, 152], [2, 3, 3, 4, 64],                             // middle stroke
      [0.25, 3.25, 0.75, 4.75, 48], [4.25, 2.5, 4.75, 4.5, 56],        // tiers
    ] },
    E: { at: 6.5, lots: [
      [0, 0, 1, 2, 96], [0, 2, 1, 5, 216], [0, 5, 1, 7, 144],
      [1, 6, 3, 7, 64], [3, 6, 5, 7, 112],
      [1, 3, 2.5, 4, 80], [2.5, 3, 4, 4, 40],
      [1, 0, 3, 1, 56], [3, 0, 5, 1, 128],
      [0.25, 2.5, 0.75, 4.5, 56], [3.5, 0.25, 4.5, 0.75, 40],
    ] },
    B: { at: 13, lots: [
      [0, 0, 1, 2, 128], [0, 2, 1, 4, 264], [0, 4, 1, 7, 176],
      [1, 6, 3, 7, 88], [3, 6, 5, 7, 120],
      [4, 4, 5, 6, 96],
      [1, 3, 3, 4, 48], [3, 3, 5, 4, 72],
      [4, 1, 5, 3, 104],
      [1, 0, 3, 1, 64], [3, 0, 5, 1, 40],
      [0.25, 2.25, 0.75, 3.75, 64], [4.25, 1.25, 4.75, 2.75, 32],
    ] },
    G: { at: 19.5, lots: [
      [0, 6, 2, 7, 104], [2, 6, 4, 7, 56], [4, 6, 5, 7, 144],
      [0, 0, 1, 3, 160], [0, 3, 1, 6, 224],
      [0, 0, 2, 1, 72], [2, 0, 5, 1, 96],
      [4, 1, 5, 3, 120],
      [2, 3, 5, 4, 48],
      [0.25, 3.5, 0.75, 5.5, 56], [4.25, 1.25, 4.75, 2.75, 40],
    ] },
  };
  // the L is drafted live: its stem click–click, its foot by a typed size, its crown click–click
  const LX = X0 + 26 * CELL;
  const L_STEM = [LX, Y0, LX + CELL, Y0 + 7 * CELL];
  const L_FOOT_ANCHOR = [LX + CELL, Y0], L_FOOT_SIZE = ['128', '32'];
  const L_CROWN = [LX, Y0 + 2 * CELL, LX + CELL, Y0 + 4 * CELL];
  const DROP_LO = [X0 + 19.5 * CELL, Y0 + 16];   // where the L's crown gets dropped: the G stem's lower lot
  const N_PLAN = Object.values(LETTERS).reduce((n, l) => n + l.lots.length, 0);
  const IDX = { lStem: N_PLAN, lFoot: N_PLAN + 1, lCrown: N_PLAN + 2 };

  const snap8 = v => Math.round(v / 8) * 8;
  const centre = () => { const [W, H] = tbl.size(); return [snap8(W / 2), snap8(H / 2)]; };
  const ground = (x, y) => { const c = centre(); return tbl.project(c[0] + x, c[1] + y, 0); };

  function cityPlates() {
    const c = centre(), out = [];
    for (const k of 'WEBG') {
      const ox = X0 + LETTERS[k].at * CELL;
      for (const [x0, y0, x1, y1, h] of LETTERS[k].lots)
        out.push({ lo: [c[0] + ox + x0 * CELL, c[1] + Y0 + y0 * CELL], hi: [c[0] + ox + x1 * CELL, c[1] + Y0 + y1 * CELL], h });
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
    await sleep(400);
    const plan = cityPlates();
    for (let i = 0; i < plan.length; i++) { tbl.add(plan[i], i === 0); await sleep(38); }
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
    for (let i = 0; i < 4; i++) { wheel(0, 5, true); await sleep(60); }
    await sleep(500);
    for (let i = 0; i < 60 && tbl.state().tiltTgt < 0.86; i++) { wheel(0, 42); await sleep(42); }
    await sleep(1400);
    const tv = tbl.state().tilt, ease = tv * tv * (3 - 2 * tv), want = 2 * Math.PI / ease;
    for (let i = 0; i < 240 && tbl.state().orbitTgt < want; i++) { wheel(30, 0); await sleep(46); }
    await sleep(2600);
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

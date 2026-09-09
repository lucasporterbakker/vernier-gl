/**
 * vernier — an interactive design grid.
 *
 * An infinite 8px grid that reveals itself around the pointer, a crosshair
 * that snaps to grid intersections like a measuring instrument, and
 * click–click dimension measuring. Rendered by one fragment shader on a
 * fullscreen triangle; driven by a render-on-demand loop that goes fully
 * idle (zero rAF) when nothing changes.
 *
 * The library draws pixels only. Text — the coordinate readout — is yours
 * to render in the DOM from the `onUpdate` callback; shaders are the wrong
 * tool for type, and your readout should match your typography anyway.
 *
 *   import { createVernier } from 'vernier-gl';
 *   const v = createVernier({
 *     canvas,
 *     onUpdate: s => readout.textContent = s.measuring
 *       ? `w: ${s.w} · h: ${s.h}`
 *       : `x: ${s.x} · y: ${s.y}`,
 *   });
 *   v.setColors({ bg: '#0e0f15', line: '#58a6ff', accent: '#a9c1fa' });
 *   v.destroy();
 */

import { VERT, FRAG } from './shaders.js';

const DEFAULTS = {
  grid: 8,          // css px between minor lines
  majorEvery: 8,    // major line every N minors
  measure: true,    // click–click dimension measuring (Esc cancels)
  maxDpr: 2,        // devicePixelRatio cap
  holdMs: 700,      // full energy this long after the last pointer move
  decay: 1.6,       // energy units per second after the hold
  fade: 1.4,        // released-measurement fade, units per second
  colors: { bg: '#0e0f15', line: '#58a6ff', accent: '#a9c1fa' },
  onUpdate: null,
};

const hex01 = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);

const RELEASE_S = 0.48; // duration of the release sweep across the measured area
const HOLD_S = 0.65;    // completed measurement holds fully present this long

export function createVernier(options = {}) {
  const opts = { ...DEFAULTS, ...options, colors: { ...DEFAULTS.colors, ...(options.colors || {}) } };
  const canvas = opts.canvas;
  if (!canvas || typeof canvas.getContext !== 'function')
    throw new Error('vernier: options.canvas must be a canvas element');

  const gl = canvas.getContext('webgl2', {
    antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'low-power',
  });
  if (!gl) return null; // no WebGL2 — keep your CSS fallback

  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- program ---------- */

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('vernier: ' + gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('vernier: ' + gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  const U = {};
  for (const n of ['uRes', 'uCross', 'uRaw', 'uMeas', 'uMeasA', 'uRel', 'uHold', 'uMinor', 'uMajor', 'uDpr', 'uEnergy', 'uPulse', 'uBg', 'uLine', 'uAc'])
    U[n] = gl.getUniformLocation(prog, n);

  /* ---------- state ---------- */

  let dpr = 1, W = 0, H = 0;
  let energy = 0, lastMove = -1e9, lastT = 0, rafId = 0, running = false;
  let destroyed = false, lost = false;

  const raw = { x: -1e4, y: -1e4 };     // css px, canvas-local
  const target = { x: -1e4, y: -1e4 };  // snapped
  const cur = { x: -1e4, y: -1e4 };     // lerped
  const meas = { on: false, ax: 0, ay: 0, hx: 0, hy: 0, alpha: 0, rel: 0, hold: false, holdT0: 0, holdV: 0 };

  function setColors(c = {}) {
    if (destroyed || lost) return;
    if (c.bg) gl.uniform3fv(U.uBg, hex01(c.bg));
    if (c.line) gl.uniform3fv(U.uLine, hex01(c.line));
    if (c.accent) gl.uniform3fv(U.uAc, hex01(c.accent));
    render(true);
  }

  function resize() {
    if (destroyed || lost) return;
    dpr = Math.min(devicePixelRatio || 1, opts.maxDpr);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uDpr, dpr);
    const minor = Math.max(2, Math.round(opts.grid * dpr));
    gl.uniform1f(U.uMinor, minor);
    gl.uniform1f(U.uMajor, minor * opts.majorEvery);
    render(true);
  }

  /* ---------- frame loop (render-on-demand) ---------- */

  function render(force, t = performance.now()) {
    if (destroyed || lost) return;
    rafId = 0;
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
    lastT = t;

    const k = reduced ? 1 : 1 - Math.pow(0.0001, dt);
    cur.x += (target.x - cur.x) * k;
    cur.y += (target.y - cur.y) * k;

    if (t - lastMove > opts.holdMs) energy = Math.max(0, energy - opts.decay * dt);

    if (meas.on) {
      meas.hx = cur.x; meas.hy = cur.y;
      meas.alpha = 1;
      meas.holdV = 0;
    } else if (meas.hold) {
      // the final area holds for a beat — quick attack with a small
      // overshoot (the confirmation flash), then steady
      const th = (t - meas.holdT0) / 1000;
      meas.alpha = 1;
      meas.holdV = Math.min(th / 0.06, 1) * (1 + 0.35 * Math.exp(-th * 7));
      if (th >= HOLD_S) { meas.hold = false; meas.rel = 1e-4; }
    } else if (meas.alpha > 0) {
      meas.alpha = reduced ? 0 : Math.max(0, meas.alpha - opts.fade * dt);
      if (meas.rel > 0) meas.rel = Math.min(1, meas.rel + dt / RELEASE_S);
      if (meas.alpha <= 0) { meas.rel = 0; meas.holdV = 0; }
    }

    const pulse = reduced ? 0.85 : 0.7 + 0.3 * Math.sin(t / 1000 * 2.6);
    gl.uniform2f(U.uCross, cur.x * dpr, (H - cur.y) * dpr);
    gl.uniform2f(U.uRaw, raw.x * dpr, (H - raw.y) * dpr);
    gl.uniform4f(U.uMeas, meas.ax * dpr, (H - meas.ay) * dpr, meas.hx * dpr, (H - meas.hy) * dpr);
    gl.uniform1f(U.uMeasA, meas.alpha);
    gl.uniform1f(U.uRel, meas.rel);
    gl.uniform1f(U.uHold, meas.holdV);
    gl.uniform1f(U.uEnergy, energy);
    gl.uniform1f(U.uPulse, pulse);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (opts.onUpdate) opts.onUpdate({
      x: Math.round(target.x), y: Math.round(target.y),
      cx: cur.x, cy: cur.y,
      energy,
      measuring: meas.on,
      holding: meas.hold,
      hx: meas.hx, hy: meas.hy,
      w: Math.abs(Math.round((meas.on ? target.x : meas.hx) - meas.ax)),
      h: Math.abs(Math.round((meas.on ? target.y : meas.hy) - meas.ay)),
      measureAlpha: meas.alpha,
      release: meas.rel,
    });

    const settled = Math.abs(cur.x - target.x) < 0.05 && Math.abs(cur.y - target.y) < 0.05;
    const fading = !meas.on && meas.alpha > 0.004;
    if (!force && (energy > 0.004 || !settled || fading)) schedule();
    else running = false;
  }

  const frame = t => render(false, t);
  function schedule() { running = true; if (!rafId) rafId = requestAnimationFrame(frame); }
  function kick() { if (!running) { lastT = performance.now(); schedule(); } }

  /* ---------- input ---------- */

  const local = e => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onMove = e => {
    const p = local(e);
    raw.x = p.x; raw.y = p.y;
    target.x = Math.round(p.x / opts.grid) * opts.grid;
    target.y = Math.round(p.y / opts.grid) * opts.grid;
    if (cur.x < -1e3) { cur.x = target.x; cur.y = target.y; } // first entry: no fly-in
    lastMove = performance.now();
    energy = 1;
    kick();
  };

  const onDown = e => {
    if (!opts.measure) return;
    if (e.target !== canvas && !canvas.contains(e.target)) {
      // clicks on overlaid UI shouldn't start measurements; clicks that fall
      // through to the page over the canvas should
      const r = canvas.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
      if (e.target.closest && e.target.closest('a, button, select, input, textarea, [data-vernier-ignore]')) return;
    }
    const p = local(e);
    if (!meas.on) {
      meas.on = true;
      meas.rel = 0; meas.hold = false; meas.holdV = 0;
      meas.ax = Math.round(p.x / opts.grid) * opts.grid;
      meas.ay = Math.round(p.y / opts.grid) * opts.grid;
      meas.hx = meas.ax; meas.hy = meas.ay;
    } else {
      meas.on = false; // release — hold the final area, then sweep it away
      meas.hx = target.x; meas.hy = target.y; // commit to the snapped point, not mid-ease
      meas.rel = 0;
      meas.hold = !reduced;
      meas.holdT0 = performance.now();
      if (reduced) meas.alpha = 0;
    }
    kick();
  };

  const onKey = e => {
    if (e.key === 'Escape' && (meas.on || meas.hold || meas.alpha > 0)) {
      meas.on = false; meas.hold = false; meas.holdV = 0; meas.alpha = 0; meas.rel = 0; kick();
    }
  };

  const onLeaveWindow = () => { lastMove = -1e9; };
  const onVisibility = () => {
    if (document.hidden) { if (rafId) cancelAnimationFrame(rafId); rafId = 0; running = false; }
    else render(true);
  };
  const onLost = e => { e.preventDefault(); lost = true; canvas.style.display = 'none'; };

  addEventListener('pointermove', onMove, { passive: true });
  addEventListener('pointerdown', onDown, { passive: true });
  addEventListener('keydown', onKey);
  addEventListener('pointerleave', onLeaveWindow);
  addEventListener('resize', resize);
  document.addEventListener('visibilitychange', onVisibility);
  canvas.addEventListener('webglcontextlost', onLost);

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(canvas);

  setColors(opts.colors);
  resize();

  /* ---------- handle ---------- */

  return {
    canvas,
    setColors,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (rafId) cancelAnimationFrame(rafId);
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerdown', onDown);
      removeEventListener('keydown', onKey);
      removeEventListener('pointerleave', onLeaveWindow);
      removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onLost);
      if (ro) ro.disconnect();
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    },
  };
}

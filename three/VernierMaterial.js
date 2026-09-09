/**
 * vernier — Three.js adapter.
 *
 * Wraps the same fragment shader as the zero-dependency core in a
 * THREE.ShaderMaterial (GLSL3), for scenes that already run Three. Pair it
 * with a fullscreen PlaneGeometry(2, 2) and drive the uniforms from your
 * own pointer handling — or use the tiny `createVernierBackdrop` helper.
 *
 *   import * as THREE from 'three';
 *   import { createVernierMaterial } from 'vernier-gl/three';
 *
 *   const material = createVernierMaterial(THREE);
 *   const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
 *
 * Three is a peer dependency: this module never imports it, you hand the
 * namespace in. The material renders in clip space and ignores cameras.
 */

import { FRAG_BODY } from '../src/shaders.js';

const THREE_VERT = `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// With an explicit glslVersion of GLSL3, Three expects the shader to
// declare its own fragment output (the gl_FragColor shim exists only in
// the auto-upgraded default path). The shared body writes to `O`.
const THREE_FRAG = `
out vec4 O;
${FRAG_BODY}`;

const hex01 = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);

export function createVernierMaterial(THREE, { colors = {} } = {}) {
  const c = { bg: '#0e0f15', line: '#58a6ff', accent: '#a9c1fa', ...colors };
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: THREE_VERT,
    fragmentShader: THREE_FRAG,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uRes:    { value: new THREE.Vector2(1, 1) },
      uCross:  { value: new THREE.Vector2(-1e4, -1e4) },
      uRaw:    { value: new THREE.Vector2(-1e4, -1e4) },
      uMeas:   { value: new THREE.Vector4(0, 0, 0, 0) },
      uMeasA:  { value: 0 },
      uRel:    { value: 0 },
      uMinor:  { value: 16 },
      uMajor:  { value: 128 },
      uDpr:    { value: 2 },
      uEnergy: { value: 0 },
      uPulse:  { value: 0.85 },
      uBg:     { value: new THREE.Vector3(...hex01(c.bg)) },
      uLine:   { value: new THREE.Vector3(...hex01(c.line)) },
      uAc:     { value: new THREE.Vector3(...hex01(c.accent)) },
    },
  });

  material.setSize = (width, height, dpr, grid = 8, majorEvery = 8) => {
    material.uniforms.uRes.value.set(width * dpr, height * dpr);
    material.uniforms.uDpr.value = dpr;
    const minor = Math.max(2, Math.round(grid * dpr));
    material.uniforms.uMinor.value = minor;
    material.uniforms.uMajor.value = minor * majorEvery;
  };
  material.setColors = ({ bg, line, accent }) => {
    if (bg) material.uniforms.uBg.value.set(...hex01(bg));
    if (line) material.uniforms.uLine.value.set(...hex01(line));
    if (accent) material.uniforms.uAc.value.set(...hex01(accent));
  };

  return material;
}

/**
 * Minimal full-viewport backdrop: renderer-sized scene + material, with
 * pointer tracking, energy decay, and grid snapping. Call `update()` from
 * your render loop and `resize()` when the renderer resizes.
 *
 *   const backdrop = createVernierBackdrop(THREE, renderer);
 *   // in your loop, before rendering your scene with autoClear off:
 *   backdrop.update(); renderer.render(backdrop.scene, backdrop.camera);
 */
export function createVernierBackdrop(THREE, renderer, options = {}) {
  const { grid = 8, majorEvery = 8, colors } = options;
  const material = createVernierMaterial(THREE, { colors });
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  // the vertex shader outputs clip space directly, so Three's CPU-side
  // frustum test must not get a vote
  mesh.frustumCulled = false;
  scene.add(mesh);

  const el = renderer.domElement;
  const raw = { x: -1e4, y: -1e4 };
  const target = { x: -1e4, y: -1e4 };
  const cur = { x: -1e4, y: -1e4 };
  let energy = 0, lastMove = -1e9;

  const onMove = e => {
    const r = el.getBoundingClientRect();
    raw.x = e.clientX - r.left; raw.y = e.clientY - r.top;
    target.x = Math.round(raw.x / grid) * grid;
    target.y = Math.round(raw.y / grid) * grid;
    if (cur.x < -1e3) { cur.x = target.x; cur.y = target.y; }
    lastMove = performance.now();
    energy = 1;
  };
  addEventListener('pointermove', onMove, { passive: true });

  function resize() {
    const dpr = renderer.getPixelRatio();
    const size = renderer.getSize(new THREE.Vector2());
    material.setSize(size.x, size.y, dpr, grid, majorEvery);
  }
  resize();

  let lastT = performance.now();
  function update(t = performance.now()) {
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
    lastT = t;
    const k = 1 - Math.pow(0.0001, dt);
    cur.x += (target.x - cur.x) * k;
    cur.y += (target.y - cur.y) * k;
    if (t - lastMove > 700) energy = Math.max(0, energy - 1.6 * dt);
    const dpr = material.uniforms.uDpr.value;
    const h = material.uniforms.uRes.value.y;
    material.uniforms.uCross.value.set(cur.x * dpr, h - cur.y * dpr);
    material.uniforms.uRaw.value.set(raw.x * dpr, h - raw.y * dpr);
    material.uniforms.uEnergy.value = energy;
    material.uniforms.uPulse.value = 0.7 + 0.3 * Math.sin(t / 1000 * 2.6);
  }

  return {
    scene, camera, material, update, resize,
    destroy() { removeEventListener('pointermove', onMove); material.dispose(); },
  };
}

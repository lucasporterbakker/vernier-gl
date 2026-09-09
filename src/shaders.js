/**
 * vernier — GLSL sources.
 *
 * The fragment shader is the whole picture: an infinite two-level grid,
 * a proximity reveal around the pointer, a crosshair snapped to the grid,
 * and a measurement rectangle. Everything arrives as uniforms; the shader
 * holds no state and knows nothing about themes, DOM, or time-keeping.
 *
 * Coordinates are device pixels, y-up (gl_FragCoord space). The driver is
 * responsible for flipping pointer y and multiplying by devicePixelRatio.
 */

export const VERT = `#version 300 es
void main() {
  // fullscreen triangle from gl_VertexID — no buffers, no attributes
  vec2 v = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(v * 2.0 - 1.0, 0.0, 1.0);
}`;

// The body is shared verbatim with the Three.js adapter, which prepends its
// own #version and precision lines. Keep this header in sync with FRAG_BODY.
export const FRAG_BODY = `
uniform vec2  uRes;      // canvas size, device px
uniform vec2  uCross;    // snapped crosshair, device px, y-up
uniform vec2  uRaw;      // raw pointer, device px, y-up
uniform vec4  uMeas;     // measurement corners: anchor.xy, head.xy (device px, y-up)
uniform float uMeasA;    // measurement alpha: 1 while measuring, fades after release
uniform float uRel;      // release-sweep progress: 0 idle/measuring, 0→1 after release
uniform float uMinor;    // minor grid spacing, device px (integer for crispness)
uniform float uMajor;    // major grid spacing, device px
uniform float uDpr;      // device pixel ratio
uniform float uEnergy;   // pointer energy 0..1 (drives reveal + crosshair)
uniform float uPulse;    // crosshair-handle pulse 0..1, precomputed by the driver
uniform vec3  uBg;       // page ground
uniform vec3  uLine;     // guide color
uniform vec3  uAc;       // accent color

float hairline(float d, float w) { return 1.0 - smoothstep(w, w + 1.1, d); }

vec2 gridDist(vec2 p, float s) {
  vec2 f = p / s;
  return abs(f - round(f)) * s;
}

// hollow square handle of half-size r centered on q
float handle(vec2 p, vec2 q, float r) {
  float box = max(abs(p.x - q.x), abs(p.y - q.y));
  return hairline(abs(box - r), 0.9 * uDpr);
}

void main() {
  vec2 p = gl_FragCoord.xy;
  float hw = 0.5 * uDpr;   // hairline half-width: one css pixel

  // pointer proximity field: the grid reveals itself around the cursor
  float sigma = 180.0 * uDpr;
  float pr = distance(p, uRaw);
  float spot = exp(-(pr * pr) / (2.0 * sigma * sigma));
  float lift = uEnergy * spot;

  vec2 dMin = gridDist(p, uMinor);
  vec2 dMaj = gridDist(p, uMajor);
  float minor = hairline(min(dMin.x, dMin.y), hw) * (0.028 + 0.105 * lift);
  float major = hairline(min(dMaj.x, dMaj.y), hw) * (0.060 + 0.150 * lift);
  float dots  = hairline(max(dMaj.x, dMaj.y), 1.1 * uDpr) * lift * 0.85;

  // crosshair through the snapped point
  vec2 dc = abs(p - uCross);
  float cross = hairline(min(dc.x, dc.y), hw) * uEnergy * 0.20;

  // cursor handle
  float r = 3.5 * uDpr;
  float ring = handle(p, uCross, r);
  float boxc = max(dc.x, dc.y);
  float inner = 1.0 - smoothstep(r - 0.9 * uDpr, r, boxc);

  // measurement rectangle: border + faint fill + anchor handle
  vec2 lo = min(uMeas.xy, uMeas.zw);
  vec2 hi = max(uMeas.xy, uMeas.zw);
  float inX = step(lo.x - hw, p.x) * step(p.x, hi.x + hw);
  float inY = step(lo.y - hw, p.y) * step(p.y, hi.y + hw);
  float ex = min(abs(p.x - lo.x), abs(p.x - hi.x));
  float ey = min(abs(p.y - lo.y), abs(p.y - hi.y));
  float mBorder = max(hairline(ex, hw) * inY, hairline(ey, hw) * inX) * uMeasA;
  float mFill = inX * inY * 0.045 * uMeasA;
  float mAnchor = handle(p, uMeas.xy, r) * uMeasA;

  // release sweep: an accent band scans the captured area once, top-left to
  // bottom-right, as the rectangle lets go — measured, recorded
  vec2 span = max(hi - lo, vec2(1.0));
  float sw = ((p.x - lo.x) + (hi.y - p.y)) / (span.x + span.y);
  float bd = (sw - mix(-0.2, 1.2, uRel)) / 0.075;
  float band = exp(-bd * bd) * step(1e-4, uRel) * smoothstep(0.0, 0.1, uMeasA);
  float mSweep = inX * inY * band;

  vec3 col = uBg;
  col += uLine * (minor + major) * (1.0 - inner * uEnergy);
  col += uLine * cross * (1.0 - inner);
  col += uAc * dots;
  col += uLine * lift * 0.012;
  col += uAc * mFill;
  col += uAc * mSweep * 0.18;
  col += uAc * mBorder * (0.55 + band * 0.45);
  col += uAc * mAnchor * 0.9;
  col += uAc * ring * uEnergy * uPulse;

  O = vec4(col, 1.0);
}`;

export const FRAG = `#version 300 es
precision highp float;
out vec4 O;
${FRAG_BODY}`;

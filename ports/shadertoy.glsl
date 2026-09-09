// vernier — interactive design grid
// https://lucasporterbakker.com
//
// An infinite 8px grid that reveals itself around the cursor, a crosshair
// snapped to grid intersections, and click-drag dimension measuring: the
// captured pane reads like lit glass over the grid, with a live w × h
// readout. Release to hold the final area — the calculated dimensions
// flash in the pane, and a faint scan-line passes while it stands.
//
// Left alone, it measures on its own (Shadertoy can't see the mouse until
// you click, so the idle state runs a deterministic demo loop instead).
//
// Port of vernier-gl (the packaged version adds themes, a DOM readout,
// render-on-demand with zero rAF at idle, and a Three.js material).

const vec3 BG   = vec3(0.055, 0.059, 0.082);  // #0e0f15
const vec3 LINE = vec3(0.345, 0.651, 1.000);  // #58a6ff
const vec3 AC   = vec3(0.663, 0.757, 0.980);  // #a9c1fa
const float MINOR = 8.0;
const float MAJOR = 64.0;

float hairline(float d, float w) { return 1.0 - smoothstep(w, w + 1.1, d); }

vec2 gridDist(vec2 p, float s) {
  vec2 f = p / s;
  return abs(f - round(f)) * s;
}

// hollow square handle of half-size r centered on q
float handle(vec2 p, vec2 q, float r) {
  float box = max(abs(p.x - q.x), abs(p.y - q.y));
  return hairline(abs(box - r), 0.9);
}

vec2 snap(vec2 p) { return round(p / MINOR) * MINOR; }

// deterministic wander for the self-running demo
vec2 path(float t, vec2 R) {
  return R * (0.5 + vec2(0.33 * sin(t * 0.53) + 0.11 * sin(t * 1.31),
                         0.27 * sin(t * 0.71 + 1.7) + 0.09 * cos(t * 1.13)));
}

// ---- tiny 4x5 digit font, for the w × h readout ----------------------------

const int FONT[11] = int[11](
  0x69996, 0x26227, 0x6924F, 0xE161E, 0x99F11,   // 0 1 2 3 4
  0xF8E1E, 0x68E96, 0xF1244, 0x69696, 0x69716,   // 5 6 7 8 9
  0x09690);                                       // ×

// sample glyph g on its unit cell (org = bottom-left, cell = s*(4,5) px)
float glyph(int g, vec2 p, vec2 org, float s) {
  vec2 uv = (p - org) / (vec2(4.0, 5.0) * s);
  if (min(uv.x, uv.y) < 0.0 || max(uv.x, uv.y) >= 1.0) return 0.0;
  int col = int(uv.x * 4.0);
  int row = int(uv.y * 5.0);              // 0 = bottom
  int nib = (FONT[g] >> (row * 4)) & 15;  // rows packed top-first: bottom = low nibble
  return float((nib >> (3 - col)) & 1);
}

int dig(int n) { return n < 10 ? 1 : n < 100 ? 2 : n < 1000 ? 3 : 4; }

// print n right-aligned so its last glyph ends at `end` (advance = 5 units)
float printNumR(vec2 p, vec2 end, float s, int n) {
  float acc = 0.0;
  vec2 cur = end;
  for (int i = 0; i < 4; i++) {
    cur.x -= 5.0 * s;
    acc += glyph(n % 10, p, cur, s);
    n /= 10;
    if (n == 0) break;
  }
  return acc;
}

// "W×H" with org at the string's bottom-left
float dims(vec2 p, vec2 org, float s, int W, int H) {
  int dw = dig(W), dh = dig(H);
  float t = printNumR(p, org + vec2(float(dw * 5) * s, 0.0), s, W);
  t += glyph(10, p, org + vec2(float(dw * 5) * s, 0.0), s);
  t += printNumR(p, org + vec2(float((dw + 1 + dh) * 5) * s, 0.0), s, H);
  return t;
}

float dimsWidth(float s, int W, int H) { return float((dig(W) + 1 + dig(H)) * 5 - 1) * s; }

// ----------------------------------------------------------------------------

void mainImage(out vec4 O, in vec2 fragCoord) {
  vec2 R = iResolution.xy;
  vec2 p = fragCoord;
  float hw = 0.5;   // hairline half-width
  float t = iTime;

  bool interacted = abs(iMouse.z) > 0.5;

  vec2 raw, a, h;                            // cursor, anchor, measure head
  float measA = 0.0, hold = 0.0, rel = 0.0;
  float liveA = 0.0, ctrA = 0.0;             // readout: live at cursor / centered flash

  if (interacted) {
    raw = iMouse.xy;
    a = snap(abs(iMouse.zw));
    h = snap(iMouse.xy);
    if (iMouse.z > 0.0) {
      measA = 1.0; liveA = 0.9;              // dragging: live measurement
    } else {
      measA = 0.85; hold = 1.0; ctrA = 0.5;  // released: the area stands
      rel = fract(t / 4.0);                  // ...with a slow passing scan
    }
  } else {
    // demo loop, every 7s: wander → measure → hold → sweep away
    float n = floor(t / 7.0), c = t - n * 7.0;
    raw = path(t, R);
    a = snap(path(n * 7.0 + 2.0, R));
    h = snap(raw);
    if (c > 2.0 && c < 4.2) {
      measA = 1.0; liveA = 0.9;
    } else if (c >= 4.2) {
      h = snap(path(n * 7.0 + 4.2, R));      // head frozen at release
      hold = 1.0;
      if (c < 4.85) {
        measA = 1.0;
        ctrA = 0.35 + 0.65 * exp(-(c - 4.2) * 6.0);   // flash, then settle
      } else {
        measA = max(0.0, 1.0 - (c - 4.85) * 1.4);
        rel = min(1.0, (c - 4.85) / 0.48);
        ctrA = 0.35 * measA;                           // ...then away
      }
    }
  }
  vec2 ch = snap(raw);   // crosshair rides the cursor

  // pointer proximity: the grid reveals itself around the cursor
  float sigma = 180.0;
  float pr = distance(p, raw);
  float lift = exp(-(pr * pr) / (2.0 * sigma * sigma));

  // measurement pane geometry — the pane lights the grid under it
  vec2 lo = min(a, h), hi = max(a, h);
  float inX = step(lo.x - hw, p.x) * step(p.x, hi.x + hw);
  float inY = step(lo.y - hw, p.y) * step(p.y, hi.y + hw);
  float glass = inX * inY * measA;

  vec2 dMin = gridDist(p, MINOR);
  vec2 dMaj = gridDist(p, MAJOR);
  float minor = hairline(min(dMin.x, dMin.y), hw) * (0.028 + 0.105 * lift + 0.055 * glass);
  float major = hairline(min(dMaj.x, dMaj.y), hw) * (0.060 + 0.150 * lift + 0.075 * glass);
  float dots  = hairline(max(dMaj.x, dMaj.y), 1.1) * max(lift * 0.85, glass * 0.6);

  // crosshair through the snapped point
  vec2 dc = abs(p - ch);
  float crossHair = hairline(min(dc.x, dc.y), hw) * 0.20;

  // cursor handle
  float r = 3.5;
  float ring = handle(p, ch, r);
  float boxc = max(dc.x, dc.y);
  float inner = 1.0 - smoothstep(r - 0.9, r, boxc);

  // pane material: hairline border, faint fill, inner edge glow — lit glass
  float ex = min(abs(p.x - lo.x), abs(p.x - hi.x));
  float ey = min(abs(p.y - lo.y), abs(p.y - hi.y));
  float mBorder = max(hairline(ex, hw) * inY, hairline(ey, hw) * inX) * measA;
  float edgeIn = max(min(min(p.x - lo.x, hi.x - p.x), min(p.y - lo.y, hi.y - p.y)), 0.0);
  float glow = exp(-edgeIn / 16.0) * glass;
  float mFill = glass * (0.055 + 0.045 * hold);
  float mAnchor = handle(p, a, r) * measA;

  // completed hold: all four corners take handles
  float mCorners = min(handle(p, lo, r) + handle(p, hi, r)
                     + handle(p, vec2(lo.x, hi.y), r) + handle(p, vec2(hi.x, lo.y), r), 1.0)
                 * hold * measA;

  // release sweep: a faint accent band passes over the captured area
  vec2 span = max(hi - lo, vec2(1.0));
  float sw = ((p.x - lo.x) + (hi.y - p.y)) / (span.x + span.y);
  float bd = (sw - mix(-0.2, 1.2, rel)) / 0.075;
  float band = exp(-bd * bd) * step(1e-4, rel) * smoothstep(0.0, 0.1, measA);
  float mSweep = inX * inY * band;

  // the readout: live w × h beside the cursor, or the calculated area
  // flashed in the middle of the pane on release
  int W = int(hi.x - lo.x), H = int(hi.y - lo.y);
  float txt = 0.0;
  if (liveA > 0.0)
    txt += dims(p, h + vec2(14.0, -34.0), 2.0, W, H) * liveA;
  if (ctrA > 0.0)
    txt += dims(p, vec2((lo.x + hi.x) * 0.5 - dimsWidth(4.0, W, H) * 0.5,
                        (lo.y + hi.y) * 0.5 - 2.5 * 4.0), 4.0, W, H) * ctrA;

  float pulse = 0.7 + 0.3 * sin(t * 2.6);

  vec3 col = BG;
  col += LINE * (minor + major) * (1.0 - inner);
  col += LINE * crossHair * (1.0 - inner);
  col += AC * dots;
  col += LINE * lift * 0.012;
  col += AC * mFill;
  col += AC * glow * (0.05 + 0.04 * hold);
  col += AC * mSweep * 0.10;
  col += AC * mBorder * (0.55 + band * 0.22 + 0.25 * hold);
  col += AC * mAnchor * 0.9;
  col += AC * mCorners * 0.9;
  col += AC * ring * pulse;
  col += AC * min(txt, 1.0);

  O = vec4(col, 1.0);
}

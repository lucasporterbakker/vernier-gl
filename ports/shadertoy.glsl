// vernier — interactive design grid
// https://lucasporterbakker.com
//
// An infinite 8px grid that reveals itself around the cursor, a crosshair
// snapped to grid intersections, and click-drag dimension measuring: the
// captured pane reads like lit glass over the grid. Release to hold the
// final area — a scan-line sweeps it slowly while it stands.
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

void mainImage(out vec4 O, in vec2 fragCoord) {
  vec2 R = iResolution.xy;
  vec2 p = fragCoord;
  float hw = 0.5;   // hairline half-width
  float t = iTime;

  bool interacted = abs(iMouse.z) > 0.5;

  vec2 raw, a, h;                            // cursor, anchor, measure head
  float measA = 0.0, hold = 0.0, rel = 0.0;

  if (interacted) {
    raw = iMouse.xy;
    a = snap(abs(iMouse.zw));
    h = snap(iMouse.xy);
    if (iMouse.z > 0.0) {
      measA = 1.0;                           // dragging: live measurement
    } else {
      measA = 0.85; hold = 1.0;              // released: the area stands
      rel = fract(t / 3.0);                  // ...with a slow repeating scan
    }
  } else {
    // demo loop, every 7s: wander → measure → hold → sweep away
    float n = floor(t / 7.0), c = t - n * 7.0;
    raw = path(t, R);
    a = snap(path(n * 7.0 + 2.0, R));
    h = snap(raw);
    if (c > 2.0 && c < 4.2) {
      measA = 1.0;
    } else if (c >= 4.2) {
      h = snap(path(n * 7.0 + 4.2, R));      // head frozen at release
      hold = 1.0;
      if (c < 4.85) { measA = 1.0; }
      else {
        measA = max(0.0, 1.0 - (c - 4.85) * 1.4);
        rel = min(1.0, (c - 4.85) / 0.48);
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

  // release sweep: an accent band scans the captured area
  vec2 span = max(hi - lo, vec2(1.0));
  float sw = ((p.x - lo.x) + (hi.y - p.y)) / (span.x + span.y);
  float bd = (sw - mix(-0.2, 1.2, rel)) / 0.075;
  float band = exp(-bd * bd) * step(1e-4, rel) * smoothstep(0.0, 0.1, measA);
  float mSweep = inX * inY * band;

  float pulse = 0.7 + 0.3 * sin(t * 2.6);

  vec3 col = BG;
  col += LINE * (minor + major) * (1.0 - inner);
  col += LINE * crossHair * (1.0 - inner);
  col += AC * dots;
  col += LINE * lift * 0.012;
  col += AC * mFill;
  col += AC * glow * (0.05 + 0.04 * hold);
  col += AC * mSweep * 0.18;
  col += AC * mBorder * (0.55 + band * 0.45 + 0.25 * hold);
  col += AC * mAnchor * 0.9;
  col += AC * mCorners * 0.9;
  col += AC * ring * pulse;

  O = vec4(col, 1.0);
}

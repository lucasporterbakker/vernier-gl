// vernier — Buffer A (state)
// iChannel0 = Buffer A (this buffer — self-feedback)
//
// Carries the state the single-pass version couldn't: the eased crosshair,
// the measurement lifecycle with real timestamps, and cursor activity.
// Four texels on the bottom row; every other pixel stays zero.
//
//   (0,0)  cur.xy (eased crosshair), 0, init flag
//   (1,0)  anchor.xy, head.xy
//   (2,0)  phase (0 idle / 1 measuring / 2 hold / 3 fade), tPhase, measA, prevPressed
//   (3,0)  raw.xy (this frame's cursor), lastMoveT, everTouched

const float MINOR = 8.0;
const float HOLD_S = 0.65;   // completed measurement holds this long
const float FADE_PS = 1.4;   // fade, alpha per second

vec2 snap(vec2 p) { return round(p / MINOR) * MINOR; }

// deterministic wander for the self-running demo
vec2 path(float t, vec2 R) {
  return R * (0.5 + vec2(0.33 * sin(t * 0.53) + 0.11 * sin(t * 1.31),
                         0.27 * sin(t * 0.71 + 1.7) + 0.09 * cos(t * 1.13)));
}

void mainImage(out vec4 O, in vec2 f) {
  ivec2 tx = ivec2(f);
  O = vec4(0.0);
  if (tx.y != 0 || tx.x > 3) return;

  vec4 s0 = texelFetch(iChannel0, ivec2(0, 0), 0);
  vec4 s1 = texelFetch(iChannel0, ivec2(1, 0), 0);
  vec4 s2 = texelFetch(iChannel0, ivec2(2, 0), 0);
  vec4 s3 = texelFetch(iChannel0, ivec2(3, 0), 0);

  vec2 R = iResolution.xy;
  float dt = clamp(iTimeDelta, 0.001, 0.05);
  bool everTouched = s3.w > 0.5 || abs(iMouse.z) > 0.5;

  // cursor — the mouse once touched, a synthetic demo drag before that
  vec2 raw; bool pressedNow; vec2 anchorSrc;
  if (abs(iMouse.z) > 0.5) {
    raw = iMouse.xy;
    pressedNow = iMouse.z > 0.0;
    anchorSrc = abs(iMouse.zw);
  } else {
    float n = floor(iTime / 7.0), c = iTime - n * 7.0;
    raw = path(iTime, R);
    pressedNow = !everTouched && c > 2.0 && c < 4.2;
    anchorSrc = path(n * 7.0 + 2.0, R);
  }

  int ph = int(s2.x + 0.5);
  float tPhase = s2.y, measA = s2.z;
  bool prevPressed = s2.w > 0.5;
  vec2 cur = s0.xy, anchor = s1.xy, head = s1.zw;
  float lastMoveT = s3.z;

  if (s0.w < 0.5) {   // very first frame
    cur = snap(raw); anchor = cur; head = cur;
    ph = 0; tPhase = iTime; measA = 0.0;
    lastMoveT = iTime; prevPressed = false;
  }

  if (distance(raw, s3.xy) > 0.5) lastMoveT = iTime;

  // eased crosshair — the glide the stateless port was missing
  float k = 1.0 - pow(0.0001, dt);
  cur += (snap(raw) - cur) * k;

  if (pressedNow && !prevPressed) {                       // press: pin anchor
    ph = 1; tPhase = iTime;
    anchor = snap(anchorSrc); head = cur; measA = 1.0;
  } else if (!pressedNow && prevPressed && ph == 1) {     // release: hold
    ph = 2; tPhase = iTime; head = snap(raw); measA = 1.0;
  }
  if (ph == 1) { head = cur; measA = 1.0; }
  if (ph == 2) {
    measA = 1.0;
    if (iTime - tPhase > HOLD_S) { ph = 3; tPhase = iTime; }
  }
  if (ph == 3) {
    measA = max(0.0, measA - FADE_PS * dt);
    if (measA <= 0.0) ph = 0;
  }

  if (tx.x == 0) O = vec4(cur, 0.0, 1.0);
  if (tx.x == 1) O = vec4(anchor, head);
  if (tx.x == 2) O = vec4(float(ph), tPhase, measA, pressedNow ? 1.0 : 0.0);
  if (tx.x == 3) O = vec4(raw, lastMoveT, everTouched ? 1.0 : 0.0);
}

# vernier

**Interactive design grid — a snapping, measuring WebGL backdrop.**

An infinite 8px grid that reveals itself around your pointer. A crosshair
that glides between grid intersections like the jaw of a measuring
instrument. Click once to pin an anchor, move to stretch a live dimension
pane (`w × h`) that reads like lit glass over the grid, its edges ticked
like a rule, click again to release — the final area holds for a beat,
corners take handles, then a scan-line sweeps it away. Named after the [vernier
scale](https://en.wikipedia.org/wiki/Vernier_scale) — the sliding secondary
scale that made calipers precise.

One fragment shader. Zero dependencies. Zero animation frames at idle.

> **Live demo:** **[the drafting table](https://lucasporterbakker.github.io/vernier-gl/)**
> — or run `npx serve` in this repo and open `/` for it, `/demo/` for the
> instrument on its own, and `/demo/table.html` for the zero-dependency
> table.

## The drafting table

What happens when the grid becomes a drawing surface.

Draft measured rectangles on the flat sheet and they stay as your plan.
Scroll, and the sheet tilts: the camera lifts from plan into perspective
and every rectangle stands up into a volume. Now sculpt it — the middle of
a face is a hand that slides the whole volume, an edge is a resize handle
that stretches the footprint or pulls the height, and everything stays
snapped to the grid with its dimensions live. Draw one plate over another
and it stacks; drag the support away and what sat on it drops.

| gesture | what it does |
|---------|--------------|
| click–click | draft a plate (flat or tilted) |
| type a number | set the dimension you're drafting or holding — `240`, `x`, `160`, enter |
| scroll | tilt the sheet between plan and perspective |
| sideways scroll | orbit the model |
| pinch | zoom |
| drag a face | move the volume across the sheet |
| drag an edge | resize the footprint, or pull the height |
| arrows | nudge the hovered volume a grid unit (⇧ for a major) |
| backspace | delete what you're hovering |
| ⌘Z / ⇧⌘Z | undo / redo |
| esc | cancel a measurement, then flatten, then reset zoom |

Every dimension is live and every edge is a rule: the pane you draft is
ticked every grid unit, longer every major, and while you move a volume a
dimension line reads the clearance to its nearest neighbour, brightening
when the gap is flush or a whole number of majors.

Whatever you draw is encoded in the URL, so the address bar is a share
link, and it is kept in `localStorage` between visits. Left alone on an
empty sheet, the table drafts a demo of its own after a few seconds (the
▶ in the corner replays it, and gives your drawing back afterwards) — the
same choreography `tools/record` captures to video.

A fixed sun gives the volumes lambert tone and casts soft shadows with a
penumbra that widens as it travels, plus contact occlusion where a plate
rests on the sheet or on another plate — computed analytically in the
fragment shader rather than with shadow maps, which blur the hairlines.

It ships in two editions. `index.html` (the live demo above) is built on a
three.js scene graph: `BoxGeometry` volumes wearing graph-paper
`ShaderMaterial`s, a `PerspectiveCamera` whose fov morphs from 2° to 31°
while the dolly compensates so the plan never pops, and `Raycaster`
picking. Its light is analytic but not per-frame: the sun is fixed, so
the ground's shadows are baked into a sheet-space texture whenever the
model changes, and each volume tests only the neighbours that can
actually shade it — orbiting costs nothing extra at the ninety-six-volume cap.
`/demo/table.html` is the same table with zero dependencies — one
fragment shader raytracing the volumes and their shadows itself, every
pixel, every frame it draws.

## Quick start

```html
<canvas id="backdrop" style="position: fixed; inset: 0; width: 100vw; height: 100vh;"></canvas>
```

```js
import { createVernier } from 'vernier-gl';

const vernier = createVernier({
  canvas: document.getElementById('backdrop'),
  colors: { bg: '#0e0f15', line: '#58a6ff', accent: '#a9c1fa' },
  onUpdate: s => {
    // the library draws pixels; text is yours — render the readout in the
    // DOM so it matches your typography
    readout.textContent = s.measuring ? `w: ${s.w} · h: ${s.h}` : `x: ${s.x} · y: ${s.y}`;
  },
});

// retint live — e.g. from your site's theme picker
vernier.setColors({ bg: '#161616', line: '#58a6ff', accent: '#ffa14a' });

// remove listeners, release the context
vernier.destroy();
```

Returns `null` when WebGL2 is unavailable — keep your CSS fallback.

## Options

| option       | default                | what it does                                        |
|--------------|------------------------|-----------------------------------------------------|
| `canvas`     | — (required)           | the canvas to render into; you own its layout       |
| `grid`       | `8`                    | CSS px between minor lines; snapping quantum        |
| `majorEvery` | `8`                    | major line every N minors (64px by default)         |
| `measure`    | `true`                 | click–click dimension measuring (Esc cancels)       |
| `maxDpr`     | `2`                    | devicePixelRatio cap                                |
| `colors`     | tokyo-night-ish        | `{ bg, line, accent }`, hex strings                 |
| `onUpdate`   | `null`                 | called once per rendered frame with the state below |

`onUpdate` receives `{ x, y, cx, cy, hx, hy, energy, measuring, holding,
w, h, measureAlpha, release }` — `x/y` are the snapped coordinates, `cx/cy`
the eased crosshair position (use it to place a readout), `hx/hy` the
measure head, `w/h` the measurement in CSS px (frozen once released),
`holding` true while the completed area holds before dissolving, and
`release` the 0→1 progress of the post-release sweep.

## Three.js

The same shader, wrapped as a `ShaderMaterial` for scenes that already run
Three (peer dependency — the core never imports it):

```js
import * as THREE from 'three';
import { createVernierBackdrop } from 'vernier-gl/three';

const backdrop = createVernierBackdrop(THREE, renderer);

renderer.setAnimationLoop(t => {
  backdrop.update(t);
  renderer.render(backdrop.scene, backdrop.camera);
  // then render your own scene with renderer.autoClear = false
});
```

Or take just the material via `createVernierMaterial(THREE)` and drive the
uniforms yourself — see `three/VernierMaterial.js` for the uniform contract.

## How it works

The visual is a tiny text program (GLSL, ~90 lines) that the GPU compiles at
page load and then runs **once per pixel, every frame it draws** — on a
2560×1600 retina viewport that's about four million executions per frame.
Nothing is pre-rendered: each frame is computed fresh from a handful of
numbers (pointer position, energy, three colors, time). That's the
difference between a shader and a recording — a Lottie can play or scrub,
this *responds*. It's also why it costs nothing to theme, scales to any
resolution, and never repeats.

Hairlines stay crisp because everything is computed in device-pixel space
with integer grid spacing and analytic ~1px antialiasing — no geometry, no
textures, one fullscreen triangle.

## It's a good citizen

- **Idle means idle** — the render loop runs only while something changes
  (pointer energy, an easing crosshair, a fading measurement) and then
  stops completely: zero `requestAnimationFrame` at rest, measured.
- **Tab hidden** → rendering pauses; **context lost** → the canvas bows out
  and your page background shows.
- **`prefers-reduced-motion`** → no easing, no pulse, no fades, no release
  sweep; snapping and measuring still work, instantly.
- Pointer listeners are passive; clicks on links, buttons, and form
  controls over the backdrop never start measurements (add
  `data-vernier-ignore` to opt out any element).

## License

MIT © [Lucas Porter-Bakker](https://lucasporterbakker.com)

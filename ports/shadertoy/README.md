# vernier on Shadertoy

Two-pass version: `Buffer A` carries state between frames (eased crosshair,
energy, the measurement lifecycle), `Image` draws. This is what makes the
crosshair glide instead of hop, and makes release a one-shot
hold → flash → sweep → gone, exactly like the packaged version.

## Wiring

1. In the editor, press the small **+** tab and add **Buffer A**.
2. **Buffer A tab** — paste `buffer-a.glsl`. Set its **iChannel0** to
   *Misc → Buffer A* (self-feedback).
3. **Image tab** — paste `image.glsl`. Set its **iChannel0** to
   *Misc → Buffer A*.
4. Compile both (Alt/Option-Enter compiles the focused tab).

Drag inside the preview to measure; release to hold. Left alone it runs
its own demo loop until the first click.

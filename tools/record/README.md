# Recording the demo

The drafting table plays its own demo (`demo/drive.js`): it drafts "GL",
tilts the sheet, slides a plate home, pulls three walls up, and orbits.
This script captures that run from a headless Chrome and encodes it.

```sh
cd tools/record
npm install                     # once, for the DevTools websocket client
npx serve ../..                 # or any static server for the repo root
node record.mjs http://localhost:3000/ --out out --size 1280x800 --scale 2
```

Output: `out/vernier-gl.mp4` plus the raw JPEG frames and an ffmpeg concat
list carrying each frame's real timestamp, so pauses in the choreography
survive the encode. Chrome is found at its macOS path by default; point
`CHROME=` elsewhere if needed.

A GIF for places that won't play video:

```sh
ffmpeg -i out/vernier-gl.mp4 -vf "fps=10,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=48[p];[b][p]paletteuse=dither=bayer" out/vernier-gl.gif
```

The demo itself is the same in every run: it sends the pointer, wheel,
and keyboard events a hand would, so what you record is the real table
responding, cursor included.

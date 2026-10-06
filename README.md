# ProtoSpace Analyzer

A browser app for an FAU architecture studio project (Design 7, "Proto-Architectural
Spaces"). Import a render, GIF or video of the cube slab and rate any frame 0–100 on the
studio's twelve descriptors, with every number explained — or go one step further: export
the frame you want **from Blender** and the app rates and models its *real* cube lattice,
in 3D, with the render's own camera, section and plan cuts, and OBJ / STL / GLB export.

Everything runs in the browser — there is no build step and no server code. Files you
import never leave your device. Live at the Vercel deployment of this repository.

## What it does

1. **Import** — drop images, GIFs or videos (or paste an image). The example buttons load
   a frame and a crop from the 250-frame animation.
2. **Animation** — for a GIF or video, play, scrub or step frame by frame, then
   **Analyze this frame** to save that moment as an iteration.
3. **Analyze** — the frame is read as a 1 m cube lattice; every cell is classed by how
   deep the first mass sits (black = front, greys = further back, white = see-through).
   Frames of the animation are recognised automatically. Drag a rectangle to rate only
   part of an image; switch between the image and the depth diagram.
4. **Ratings and why** — twelve descriptors (Modular, Fragmented, Interlocking, Porous,
   Clustered, Decentralized, Networked, Layered, Intimate, Visually Connected, Socially
   Interactive, Village-Like), each with a quantitative score from measured geometry, an
   automatic qualitative interpretation, the evidence behind both, and advice.
5. **Review** — edit the qualitative interpretation, see the combined 70/30 assessment for
   every descriptor, and download the assessment as JSON.
6. **Blender frames** — the real geometry. `blender/export_frame.py`, run inside Blender
   on the slab file, writes one small `frame_NNNN.json` per frame: every point of the
   cube lattice with the size Blender grew its cube to. Drop those files on the page (or
   pick a frame from the built-in library in `frames/`, all 250 frames of the current
   scene) and the frame is rated from its true lattice — a cube counts as mass when it
   reaches the size threshold you set (default 53 %) — and modelled in 3D.
7. **3D model** (`js/model3d.js`, Three.js) — the frame's cube lattice as it is in
   Blender, or the analysed window, or the area chosen in the spatial study. Cubes at the
   size Blender gave them or at full size; a fused block solid; colour by depth, the
   studio-render look, white study model, cube size, spatial class or level. Orbit, pan
   and zoom; preset views; **the render camera** of the Blender scene; turntable; live
   **section** and **plan** cut planes; the fitted 9 × 3 m module grid; click any cube for
   its reading. Export a PNG, a turntable video, an OBJ or GLB (with colours) or an STL
   for printing.
8. **Spatial study** — compares equal windows of the frame against the rubric, picks the
   best area, draws a section A–A through it (SVG) and hands the area to the 3D model.

## Exporting frames from Blender

```
Blender → Scripting workspace → Python console:
  import os; os.environ["PS_FRAMES"] = "1-250"          # or "93", or "10,20,30"
  exec(open("/path/to/protospace-analyzer/blender/export_frame.py").read())
```

Or from a terminal, without opening Blender's window:

```bash
blender -b "Voxel Animation Controls.blend" -P blender/export_frame.py -- --frames 1-250 --out frames
```

The files land in `protospace_frames/` next to the .blend (or `--out`), with an
`index.json` and an `export_log.txt`. To refresh the built-in library after changing the
Blender scene, copy that folder's contents into `frames/` and push. The exporter reads the
slab object's Geometry Nodes instances (positions and sizes), snaps them to the point
spacing (0.14 Blender units = 1 m) and records the render camera; it never changes the
scene. A frame file is ~50 KB; 4-bit cube sizes, base64.

## Running it

It is a static site. Open it through any local web server (opening `index.html`
straight from disk works too, but then the browser blocks frame recognition):

```bash
npx serve .          # or: python3 -m http.server 8000
```

then open the URL it prints.

## Deploying

The site is deployed on Vercel from this repository: every push to `main` redeploys.
There is nothing to configure — no build command, output directory `.` — see
`vercel.json`.

## Layout

```
index.html            The page: import, animation player, analysis bench, ratings, review,
                      3D model, spatial study, method notes
css/style.css         All styles (light and dark)
js/analyzer.js        PSA — reads a render as a depth grid and measures the 12 descriptors
js/rubric.js          PSARubric — qualitative interpretation rules and combined scoring
js/space.js           PSASpace — window search, section drawing
js/model3d.js         PSModel3D — the Three.js model of a Blender frame (ES module)
js/app.js             Page logic: importing, media player, Blender frames, rendering, review, spatial study
js/data.js            Calibration data: criteria text, agreement, the 1,250-zone database
blender/export_frame.py   The Blender exporter (see above)
frames/               The built-in library: frame_0001 … frame_0250.json + index.json
assets/               Frame sprite for recognition, sample images, favicon
vendor/three/         Three.js r186 and the addons used (OrbitControls, RoundedBox, OBJ/STL/GLTF exporters)
```

## How the image is read

The cube lattice gives the scale (1 cube = 1 m). Each metre of the face is classed by its
mean tone, which in these renders tracks how deep the first cube sits. Modules are
9 × 9 m, floors 3 m; the module grid is fitted where the full/empty reading is clearest.
Quantitative scores are a weighted sum of normalised metrics against the project's
targets; qualitative scores are automatic 0–4 interpretations of visible patterns. Both
describe fit to this rubric, not design quality. A Blender frame skips the tone reading:
each column's first solid cube gives its depth exactly, so the depth bands, the module grid
and all twelve ratings come from the real lattice.

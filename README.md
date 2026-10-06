# ProtoSpace Analyzer

A browser app for an FAU architecture studio project (Design 7, "Proto-Architectural
Spaces"). Import a render, GIF or video of the cube slab, pick the frame you want, and
the app rates that frame 0–100 on the studio's twelve descriptors, explains every
number, lets you review the qualitative reading, finds the best area to explore, and
builds a 3D model of the frame that you can orbit, cut and export.

Everything runs in the browser — there is no build step and no server code. Files you
import never leave your device.

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
6. **3D model** (`js/model3d.js`, Three.js) — the analysed frame, or the selected area,
   becomes a relief model: each cell sits at the depth its tone implies (read
   continuously 0–26 m, or in the four depth bands) and is extruded as a shell or as a
   solid massing. Colour it with the frame's own pixels projected onto the relief, by
   depth, by spatial class (gathering pockets, streets, bridges, terraces) or by level.
   Orbit, pan and zoom; preset views; turntable; live **section** and **plan** cut planes;
   the fitted 9 × 3 m module grid; click any cell for its reading. Export a PNG, an OBJ or
   GLB (with colours and the projected image) or an STL for printing.
7. **Spatial study** — compares equal windows of the frame against the rubric, picks the
   best area, draws a section A–A through it (SVG) and hands the area to the 3D model.

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
js/model3d.js         PSModel3D — the Three.js 3D generator (ES module)
js/app.js             Page logic: importing, media player, rendering, review, spatial study
js/data.js            Calibration data: criteria text, agreement, the 1,250-zone database
assets/               Frame sprite for recognition, sample images, favicon
vendor/three/         Three.js r186 and the addons used (OrbitControls, OBJ/STL/GLTF exporters)
```

## How the image is read

The cube lattice gives the scale (1 cube = 1 m). Each metre of the face is classed by its
mean tone, which in these renders tracks how deep the first cube sits. Modules are
9 × 9 m, floors 3 m; the module grid is fitted where the full/empty reading is clearest.
Quantitative scores are a weighted sum of normalised metrics against the project's
targets; qualitative scores are automatic 0–4 interpretations of visible patterns. Both
describe fit to this rubric, not design quality. The 3D model is an interpretation of one
picture: tone sets the depth of the first mass only, nothing behind it is recovered.

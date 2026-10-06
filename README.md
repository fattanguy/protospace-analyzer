# ProtoSpace Analyzer

A browser app for an FAU architecture studio project (Design 7, "Proto-Architectural
Spaces"). The Blender voxel animation runs **live in the browser**: pick the field (Noise or
Voronoi), play or scrub the frames, change the modifiers of the geometry-nodes group, and any
frame is rated 0–100 on the studio's twelve descriptors and modelled in 3D — with a crop box,
section and plan cuts, the render camera, and exports (PNG, video, OBJ, GLB, STL, or the
settings as a .py for Blender).

Everything runs in the browser — no build step, no server code, nothing leaves the device.
Live at the Vercel deployment of this repository.

## The four tabs

- **Generator** — the animation. The *Modifiers* dropdown inside the picture holds every
  control of the Blender group with the same meaning (Pattern, Motion, Growth, Noise /
  Voronoi, Slab) plus the Look of the model; every change shows at once. The timeline at
  the bottom plays, steps and scrubs the frames. Below: *Analyze this frame*, *Save
  animation* (a named set of modifier values, kept in the browser), picture, turntable
  video, and the Blender settings file. The twelve ratings of the frame on screen update
  live.
- **Analyze** — pick an animation (what is on screen in the Generator, the built-in Blender
  scene and Noise loop, or any animation you saved) and a frame. The actual frame is shown
  through the render camera in the studio-render look; pick a square of it (two 9 m bays)
  or the whole frame to rate, and tick *Depth diagram* to see the flat reading behind the
  ratings with what the selected rating looks at drawn on it. Each rating has a one-line
  question, a score, what the frame shows, what was measured and how to raise it. The full
  rubric-v3 assessment (editable interpretation, combined score, JSON download) and the
  method notes are folded away underneath.
- **Program** — every 9 m bay of the frame, rated on all twelve descriptors and on its own
  cubes (solids, floors with headroom, sheltered floors, a roofed hall at the ground, open
  ground, see-through columns, pockets, streets, openings), then scored 0–100 for three uses —
  **Lobby**, **Gathering**, **Working** (`js/program.js`: 60 % descriptors that matter for
  the use, 40 % counts). The best bay for each use is picked out; any bay opens a deep
  analysis: the bay alone in 3D with what a reading counts lit in red (solids, voids, floors…),
  the three scores with every piece behind them, the counts, the twelve ratings, and the bay's
  depth diagram with the selected rating's reading drawn in red. *Scan the whole animation*
  rates every bay of every sampled frame and lists the best frame + bay for each use.
- **3D model** — the same frame as a model. Orbit, preset views, the render camera,
  turntable; **crop box** — tick it and a cube appears: drag it with the mouse to move it
  around the slab (the green arrow lifts it), make it bigger or smaller, and everything
  outside it is cut away, with the twelve ratings of what is inside the box underneath;
  section and plan cuts; colour by depth, studio render, white model, cube size, spaces or
  levels; export PNG, turntable video, OBJ, GLB or STL (the cropped part when the box is on).

## The field

`js/field.js` is a port of the "ProtoSpace Voxel Controls" node group: Blender's own Perlin
noise (Jenkins lookup3 hash, 0.982 scaling, fBM with detail / roughness / lacunarity /
distortion) and 4D Voronoi F1 (PCG hash, Euclidean / Manhattan / Chebychev, randomness, W,
detail), the two-offset cross-fade that makes the loop seamless, the growth ramp (grow from
→ full size at), invert, size steps, smallest / largest cube, and a keyframed Offset axis
with Blender's Bezier easing. Checked against frames exported from the .blend: 99.6–99.99 %
of cubes agree (the rest is 4-bit export rounding). A pool of Web Workers evaluates the
72,447 points of the slab per frame. A cube counts as mass when it reaches 53 % of its full
size.

## How a frame is rated

The frame is read from the front as a 1 m cube lattice: every column is classed by how deep
its first solid cube sits (black at the front, greys further back, white = see-through).
Modules are 9 m wide and 3 m tall; the module grid is fitted where the full/empty reading is
clearest. Twelve descriptors — Modular, Fragmented, Interlocking, Porous, Clustered,
Decentralized, Networked, Layered, Intimate, Visually Connected, Socially Interactive,
Village-Like — each get a quantitative score (a weighted sum of normalised measurements
against the project's targets) and, in the full assessment, an automatic 0–4 interpretation
of the measured patterns; combined = 70 % measured + 30 % interpreted. Scores describe fit to
this rubric, not design quality.

## Running it

It is a static site: open it through any local web server.

```bash
npx serve .          # or: python3 -m http.server 8000
```

## Deploying

The site is deployed on Vercel from this repository: every push to `main` redeploys. No
build command, output directory `.` — see `vercel.json`.

## Layout

```
index.html            The page: Generator, Analyze, 3D model
css/style.css         All styles (light and dark)
js/analyzer.js        PSA — reads the depth grid and measures the 12 descriptors
js/rubric.js          PSARubric — interpretation rules and combined scoring
js/field.js           The pattern field: Blender-exact noise / Voronoi, loop, growth (ES module, also in Node)
js/gen.worker.js      Web Worker evaluating depth slices of the field
js/generator.js       The Generator tab, the saved-animation store, the worker pools (PSGen)
js/viewer.js          createViewer() — the Three.js lattice viewer with crop box, cuts and exports
js/program.js         Bays, their counts, the Lobby / Gathering / Working scores, the red highlights (ES module, also in Node)
js/app.js             Page logic: pickers, ratings, drawing, full assessment, Program tab, 3D model tab, tabs
assets/favicon.svg
vendor/three/         Three.js r186 and the addons used (OrbitControls, TransformControls, RoundedBox, exporters)
```

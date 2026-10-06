/* ProtoSpace Analyzer — the 3D model of a frame.
   A frame is a cube lattice: every point of the slab with the size of the cube that grew on it (generated in the
   browser by js/field.js, exactly as the Blender geometry nodes do it). The model is drawn with Three.js: orbit,
   the render's own camera, a crop box you can drag around (everything outside it is cut away), section and plan
   cuts (GPU clipping planes), colour by depth / level / spatial class, and exports (PNG, turntable video, OBJ,
   STL, GLB).

   createViewer(root, options):
     panel     'side' (settings beside the viewport) | 'none' (no settings; the host builds its own, see panelEl)
     panelEl   an element to render the settings sections into (used by the Generator's dropdown)
     sections  which settings sections to show: ['look', 'crop', 'cut', 'export']
     overlay   true → the view buttons float inside the viewport
     onBox     fn(box | null) — the crop box changed ({ x0, x1, y0, y1, z0, z1 } in lattice cells, or null when off)
     onReady   fn(api) */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const BAND_NAMES = ['mass at the front', 'first mass 3–8 m back', 'recess 9–18 m deep', 'recess 19 m or deeper', 'see-through'];
const CLASS_NAMES = ['', 'work (face mass)', 'gathering pocket', 'street', 'bridge', 'terrace', 'covered recess', 'see-through opening'];
const CLASS_COLORS = { 0: 0xd6d1cc, 1: 0xd6d1cc, 2: 0x6b5bd2, 3: 0xe07b2a, 4: 0xf0b56b, 5: 0x7aa98f, 6: 0x8a8a8a, 7: 0xffffff };
const LEVEL_COLORS = [0xdcdcdc, 0xb8b8b8, 0x969696];
const CUT = 0xe07b2a, BOX_LINE = 0x222222;
const ROUNDED_LIMIT = 6000;                                               // bevelled cubes for small models; plain boxes for the whole slab

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtN = n => Math.round(n).toLocaleString('en-US');

const STAGE = (o) => `
    <div class="m3d ${o.panel === 'none' ? 'nopanel' : 'side'}${o.overlay ? ' overlay' : ''}">
      <div class="m3d-stage">
        <div data-v="viewport" class="m3d-viewport">
          <p data-v="empty" class="m3d-empty">${o.emptyText || 'Pick a frame to see its 3D model.'}</p>
          <div class="m3d-toolbar" data-v="toolbar">
            <div class="seg" role="group" aria-label="View">
              <button type="button" data-view="iso" class="on">Iso</button><button type="button" data-view="front">Front</button><button type="button" data-view="top">Top</button><button type="button" data-view="left">Left</button><button type="button" data-view="right">Right</button><button type="button" data-view="camera" title="Look through the render camera of the Blender scene">Camera</button>
            </div>
            <label class="chip" title="Spin the model slowly"><input data-v="turntable" type="checkbox"> Turn</label>
          </div>
        </div>
        <p data-v="stats" class="status num"></p>
        <p data-v="info" class="hint"></p>
      </div>
      ${o.panel === 'none' ? '' : '<aside class="m3d-panel" data-v="panel" aria-label="3D model settings"></aside>'}
    </div>`;

const SECTIONS = {
  look: (o) => `
        <details ${o.open.look ? 'open' : ''} data-section="look">
          <summary>Look</summary>
          <label>Style
            <select data-v="style">
              <option value="cubes">Cubes · every cube of the lattice</option>
              <option value="blocks">Blocks · fused solid, smooth</option>
            </select></label>
          <label>Cube sizes
            <select data-v="sizes">
              <option value="actual">As grown · the size the pattern gave each cube</option>
              <option value="full">Full size · every cube over the threshold</option>
            </select></label>
          <label>Colour
            <select data-v="color">
              <option value="depth">Depth · dark at the front, light at the back</option>
              <option value="render">Studio render · black front, grey depth, unlit</option>
              <option value="foam">White study model</option>
              <option value="size">Cube size · purple near the threshold</option>
              <option value="class">Spaces · pockets, streets, bridges</option>
              <option value="level">Levels · 3 m floors</option>
            </select></label>
          <label><input data-v="shadows" type="checkbox" checked> Shadows</label>
          <ul class="legend" data-v="legend"></ul>
        </details>`,
  crop: (o) => `
        <details ${o.open.crop ? 'open' : ''} data-section="crop">
          <summary>Crop box</summary>
          <label><input data-v="cropOn" type="checkbox"> Crop to a box</label>
          <div data-v="cropFields" hidden>
            <p class="hint">Everything outside the box is cut away. Drag the box to slide it around the slab (the green arrow lifts it), or use the sliders. Metres (1 cube = 1 m).</p>
            <div class="m3d-axis"><span>Along the slab</span>
              <label>Start <input data-v="boxX" type="range" min="0" max="10" step="1" value="0"><output data-v="boxXv"></output></label>
              <label>Width <input data-v="boxW" type="range" min="1" max="10" step="1" value="10"><output data-v="boxWv"></output></label></div>
            <div class="m3d-axis"><span>Up</span>
              <label>Start <input data-v="boxY" type="range" min="0" max="10" step="1" value="0"><output data-v="boxYv"></output></label>
              <label>Height <input data-v="boxH" type="range" min="1" max="10" step="1" value="10"><output data-v="boxHv"></output></label></div>
            <div class="m3d-axis"><span>Deep</span>
              <label>Start <input data-v="boxZ" type="range" min="0" max="10" step="1" value="0"><output data-v="boxZv"></output></label>
              <label>Depth <input data-v="boxD" type="range" min="1" max="10" step="1" value="10"><output data-v="boxDv"></output></label></div>
            <div class="m3d-exports"><button type="button" data-v="boxZoom" class="btn quiet">Zoom to the box</button><button type="button" data-v="boxReset" class="btn quiet">Reset the box</button></div>
          </div>
        </details>`,
  cut: (o) => `
        <details ${o.open.cut ? 'open' : ''} data-section="cut">
          <summary>Cut</summary>
          <label><input data-v="section" type="checkbox"> Section plane (across)</label>
          <label hidden>Cut at <input data-v="sectionX" type="range" min="0" max="10" step="1" value="5" data-fresh="1"><output data-v="sectionValue"></output> <button type="button" data-v="sectionFlip" class="btn quiet" title="Keep the other side">Flip</button></label>
          <label><input data-v="plan" type="checkbox"> Plan cut (level)</label>
          <label hidden>Cut at <input data-v="planY" type="range" min="0" max="10" step="1" value="5" data-fresh="1"><output data-v="planValue"></output> <button type="button" data-v="planFlip" class="btn quiet" title="Keep the other side">Flip</button></label>
          <p class="hint">Cuts clip the model live; the orange sheet marks the plane. Combine both for a cut-away corner.</p>
        </details>`,
  export: (o) => `
        <details ${o.open.export ? 'open' : ''} data-section="export">
          <summary>Export</summary>
          <div class="m3d-exports">
            <button type="button" data-v="snapshot" class="btn">Image · PNG</button>
            <button type="button" data-v="record" class="btn">Turntable · video</button>
            <button type="button" data-v="exportOBJ" class="btn quiet">Model · OBJ</button>
            <button type="button" data-v="exportGLB" class="btn quiet">Model · GLB</button>
            <button type="button" data-v="exportSTL" class="btn quiet">Print · STL</button>
          </div>
          <label>Turn length <input data-v="turnSeconds" type="range" min="4" max="30" step="1" value="8" oninput="this.nextElementSibling.textContent=this.value+' s'"><output>8 s</output></label>
          <p class="hint">Metres; X along the slab, Y up, Z toward you. With the crop box on, only what is inside the box is exported. OBJ and GLB carry the colours; STL is the bare solid for printing.</p>
        </details>`,
};

export function createViewer(root, opts = {}) {
  const sections = opts.sections || ['look', 'crop', 'cut', 'export'];
  const open = Object.assign({ look: true, crop: true, cut: false, export: false }, opts.open || {});
  root.innerHTML = STAGE(opts);
  const panelEl = opts.panelEl || root.querySelector('[data-v="panel"]');
  if (panelEl) { panelEl.classList.add('m3d-sections'); panelEl.innerHTML = sections.map(s => SECTIONS[s] ? SECTIONS[s]({ open }) : '').join(''); }
  const V = name => root.querySelector(`[data-v="${name}"]`) || (panelEl && panelEl.querySelector(`[data-v="${name}"]`));
  const api = {};
  // ------------------------------------------------------------------ state
  const M = {
    ready: false, el: root, renderer: null, scene: null, camera: null, controls: null, gizmo: null, pivot: null,
    source: null, cells: null, mesh: null, base: null, boxLines: null, boxFill: null, planes: {}, light: null, fill: null, hemi: null,
    bbox: null, raf: null, visible: true, pending: null, viewName: 'iso', recording: null, lastKey: '', boxTimer: null,
    box: { on: false, x0: 0, x1: 1, y0: 0, y1: 1, z0: 0, z1: 1 },
    settings: { style: 'cubes', sizes: 'actual', color: 'depth', shadows: true, section: false, sectionX: 0, sectionFlip: false, plan: false, planY: 0, planFlip: false, turntable: false },
  };

  // ------------------------------------------------------------------ init
  function init() {
    const viewport = V('viewport');
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    } catch (e) {
      viewport.innerHTML = '<p class="m3d-empty">This browser could not start WebGL, so the 3D model cannot be shown here. The ratings and the drawing still work.</p>';
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.localClippingEnabled = true;
    renderer.domElement.setAttribute('aria-label', 'Interactive 3D model of the frame. Drag to orbit, right-drag or two fingers to pan, scroll or pinch to zoom.');
    renderer.domElement.tabIndex = 0;
    viewport.insertBefore(renderer.domElement, viewport.firstChild);
    M.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf3f1ee);
    M.scene = scene;
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 4000);
    camera.position.set(-30, 30, 60);
    M.camera = camera;
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08; controls.autoRotateSpeed = 1.2;
    controls.maxPolarAngle = Math.PI * 0.52;
    controls.listenToKeyEvents(renderer.domElement);
    controls.addEventListener('start', () => { if (M.viewName === 'camera') leaveCameraView(); });
    M.controls = controls;

    M.hemi = new THREE.HemisphereLight(0xffffff, 0xb5aea6, 1.05); scene.add(M.hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 2.3);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
    scene.add(sun); scene.add(sun.target); M.light = sun;
    M.fill = new THREE.DirectionalLight(0xffffff, 0.45); M.fill.position.set(60, 20, -40); scene.add(M.fill);

    for (const k of ['section', 'plan']) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: CUT, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
      m.visible = false; scene.add(m); M.planes[k] = m;
    }
    // the crop box: a wire box with a faint fill, and a gizmo to drag it around
    M.boxLines = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: BOX_LINE, transparent: true, opacity: 0.9 }));
    M.boxFill = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x3a3a3a, transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide }));
    M.boxLines.visible = M.boxFill.visible = false; M.boxLines.renderOrder = 2;
    scene.add(M.boxLines); scene.add(M.boxFill);
    M.pivot = new THREE.Object3D(); scene.add(M.pivot);
    if (sections.includes('crop')) {
      const tc = new TransformControls(camera, renderer.domElement);
      tc.setMode('translate'); tc.size = 1.1; tc.enabled = false;
      const helper = tc.getHelper(); helper.visible = false; scene.add(helper);
      tc.attach(M.pivot);
      tc.addEventListener('dragging-changed', e => { controls.enabled = !e.value; if (!e.value) boxChanged(); });
      tc.addEventListener('objectChange', () => boxFromPivot());
      M.gizmo = tc;
    }

    new ResizeObserver(resize).observe(viewport);
    resize();
    new IntersectionObserver(entries => { M.visible = entries[0].isIntersecting; if (M.visible) loop(); }, { threshold: 0 }).observe(viewport);
    renderer.domElement.addEventListener('click', pick);
    wireBoxDrag(renderer.domElement);
    wireControls();
    M.ready = true;
    loop();
    if (M.pending) { const p = M.pending; M.pending = null; setSource(p); }
    if (opts.onReady) opts.onReady(api);
  }

  function resize() {
    const viewport = V('viewport');
    const w = Math.max(280, viewport.clientWidth);
    const cam = M.source && M.source.camera;
    const ratio = M.viewName === 'camera' && cam && cam.resolution ? cam.resolution[1] / cam.resolution[0] : (opts.ratio || 0.58);
    const h = clamp(Math.round(w * ratio), 300, 760);
    M.renderer.setSize(w, h, false);
    M.renderer.domElement.style.width = '100%'; M.renderer.domElement.style.height = h + 'px';
    M.camera.aspect = w / h; M.camera.updateProjectionMatrix();
    if (M.viewName === 'camera') cameraView();
  }

  function loop() {
    if (M.raf) return;
    const step = () => {
      M.raf = null;
      if (!M.visible) return;
      M.controls.update();
      M.renderer.render(M.scene, M.camera);
      M.raf = requestAnimationFrame(step);
    };
    M.raf = requestAnimationFrame(step);
  }

  // ------------------------------------------------------------------ source
  /* src = null | { name, frame, vox: { nx, ny, nz, sizes: Uint8Array (x fastest, then y, then z), max, threshold },
                    camera: null | { position, forward, lens_mm, sensor_mm, sensor_fit, resolution, lattice: fn(world) → [across, up, depth] },
                    result (the analysis of the whole slab, for the "Spaces" colouring), message }   */
  function setSource(src) {
    if (!M.ready) { M.pending = src; return; }
    if (src && src.vox && !src.vox.max) src.vox.max = 15;
    const prev = M.source;
    M.source = src;
    if ((!src || !src.vox) && M.viewName === 'camera') leaveCameraView();
    if (src && src.vox && !(prev && prev.vox && prev.vox.nx === src.vox.nx && prev.vox.ny === src.vox.ny && prev.vox.nz === src.vox.nz)) resetBox(false);
    const camBtn = M.el.querySelector('[data-view="camera"]'); if (camBtn) camBtn.disabled = !(src && src.camera);
    rebuild();
  }

  // ------------------------------------------------------------------ the crop box
  function resetBox(notify = true) {
    const v = M.source && M.source.vox; if (!v) return;
    Object.assign(M.box, { x0: 0, x1: v.nx, y0: 0, y1: v.ny, z0: 0, z1: v.nz });
    syncBoxControls(); if (notify) boxChanged(true);
  }
  function boxFromPivot() {                                                   // the gizmo moved: snap the box back onto the lattice
    const v = M.source && M.source.vox, b = M.box; if (!v) return;
    const w = b.x1 - b.x0, h = b.y1 - b.y0, d = b.z1 - b.z0, p = M.pivot.position;
    b.x0 = clamp(Math.round(p.x - w / 2), 0, v.nx - w); b.x1 = b.x0 + w;
    b.y0 = clamp(Math.round(p.y - h / 2), 0, v.ny - h); b.y1 = b.y0 + h;
    b.z0 = clamp(Math.round(-p.z - d / 2), 0, v.nz - d); b.z1 = b.z0 + d;
    syncBoxControls(); applyClipping(); drawBox();
  }
  function boxFromSliders() {
    const v = M.source && M.source.vox, b = M.box; if (!v) return;
    const w = clamp(+V('boxW').value, 1, v.nx), h = clamp(+V('boxH').value, 1, v.ny), d = clamp(+V('boxD').value, 1, v.nz);
    b.x0 = clamp(+V('boxX').value, 0, v.nx - w); b.x1 = b.x0 + w;
    b.y0 = clamp(+V('boxY').value, 0, v.ny - h); b.y1 = b.y0 + h;
    b.z0 = clamp(+V('boxZ').value, 0, v.nz - d); b.z1 = b.z0 + d;
    syncBoxControls(); applyClipping(); drawBox(); boxChanged();
  }
  function syncBoxControls() {
    const v = M.source && M.source.vox, b = M.box; if (!v || !V('boxX')) return;
    const w = b.x1 - b.x0, h = b.y1 - b.y0, d = b.z1 - b.z0;
    const put = (id, val, max) => { const el = V(id); el.max = max; el.value = val; V(id + 'v').textContent = val + ' m'; };
    put('boxX', b.x0, Math.max(0, v.nx - w)); put('boxW', w, v.nx);
    put('boxY', b.y0, Math.max(0, v.ny - h)); put('boxH', h, v.ny);
    put('boxZ', b.z0, Math.max(0, v.nz - d)); put('boxD', d, v.nz);
    V('cropOn').checked = b.on; V('cropFields').hidden = !b.on;
  }
  function drawBox() {
    const b = M.box, on = b.on && !!(M.source && M.source.vox);
    M.boxLines.visible = M.boxFill.visible = on;
    if (M.gizmo) { M.gizmo.enabled = on; M.gizmo.getHelper().visible = on; }
    if (!on) return;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, cz = -(b.z0 + b.z1) / 2;
    for (const o of [M.boxLines, M.boxFill]) { o.position.set(cx, cy, cz); o.scale.set(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0); }
    M.pivot.position.set(cx, cy, cz);
  }
  /* The box settled (slider, gizmo drop, toggle): rebuild the exact geometry and tell the host. */
  function boxChanged(now = false) {
    clearTimeout(M.boxTimer);
    const fire = () => { rebuild(); if (opts.onBox) opts.onBox(M.box.on ? Object.assign({}, M.box) : null); };
    if (now) fire(); else M.boxTimer = setTimeout(fire, 120);
  }
  function setBox(box) {                                                      // host → viewer
    const v = M.source && M.source.vox; if (!v) return;
    if (!box) { M.box.on = false; } else { Object.assign(M.box, box, { on: true }); }
    syncBoxControls(); applyClipping(); drawBox(); boxChanged(true);
  }
  function inBox(x, y, z) { const b = M.box; return !b.on || (x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1 && z >= b.z0 && z < b.z1); }

  // ------------------------------------------------------------------ lattice → columns
  /* Columns of the slab (classes, levels, picking, the fused export) and the solid test, with the crop box applied. */
  function computeCells() {
    const s = M.source, v = s.vox, thr = v.threshold, b = M.box;
    const F = s.result && !s.result.features.empty ? s.result.features : null, cls = F ? F.classes : null;
    const idx = (x, y, z) => x + v.nx * (y + v.ny * z);
    const solidAt = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < v.nx && y < v.ny && z < v.nz && v.sizes[idx(x, y, z)] >= thr && inBox(x, y, z);
    const cells = [], map = new Int32Array(v.nx * v.ny).fill(-1);
    let solidCount = 0;
    const x0 = b.on ? b.x0 : 0, x1 = b.on ? b.x1 : v.nx, y0 = b.on ? b.y0 : 0, y1 = b.on ? b.y1 : v.ny, za = b.on ? b.z0 : 0, zb = b.on ? b.z1 : v.nz;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      let z0 = -1, n = 0;
      for (let z = za; z < zb; z++) if (v.sizes[idx(x, y, z)] >= thr) { if (z0 < 0) z0 = z; n++; }
      if (z0 < 0) continue;
      solidCount += n;
      const dz = z0 - za, band = dz < 3 ? 0 : dz < 9 ? 1 : dz < 19 ? 2 : 3;
      map[y * v.nx + x] = cells.length;
      cells.push({ x, y, z0, n, band, cls: cls ? cls[y * v.nx + x] : 0, level: 0 });
    }
    const rowCount = new Int32Array(v.ny); for (const k of cells) rowCount[k.y]++;
    let rBase = 0; for (let r = 0; r < v.ny; r++) if (rowCount[r] >= 3) { rBase = r; break; }
    for (const k of cells) k.level = Math.max(0, Math.floor((k.y - rBase) / 3));
    return { cells, map, rBase, F, solidAt, solidCount, idx };
  }

  function cellColor(k, z) {
    const mode = M.settings.color, v = M.source.vox;
    if (mode === 'depth') { const t = clamp(z / Math.max(1, v.nz - 1), 0, 1); return new THREE.Color(0x1e1e1e).lerp(new THREE.Color(0xd8d8d8), t); }
    if (mode === 'render') { const t = clamp(z / 26, 0, 1); return new THREE.Color(0x0c0c0c).lerp(new THREE.Color(0xd4d4d4), t); }
    if (mode === 'class') return new THREE.Color(CLASS_COLORS[k.cls] ?? 0xd6d1cc);
    if (mode === 'level') return new THREE.Color(LEVEL_COLORS[k.level % 3]);
    if (mode === 'size') { const t = clamp(v.sizes[M.cells.idx(k.x, k.y, z)] / v.max, 0, 1); return new THREE.Color(0x6b5bd2).lerp(new THREE.Color(0xf2efe9), t); }
    return new THREE.Color(0xf2efe9);
  }

  // ------------------------------------------------------------------ geometry
  /* Every solid cube as one instance; cubes boxed in on all six sides are skipped unless a cut can reveal them. */
  function buildCubes(C) {
    const { cells, solidAt } = C, v = M.source.vox, s = M.settings;
    const keepInner = s.section || s.plan;
    const list = [];                                                           // [cellIndex, z]
    cells.forEach((k, ci) => {
      for (let z = 0; z < v.nz; z++) {
        if (!solidAt(k.x, k.y, z)) continue;
        const inner = !keepInner && solidAt(k.x - 1, k.y, z) && solidAt(k.x + 1, k.y, z) && solidAt(k.x, k.y - 1, z) && solidAt(k.x, k.y + 1, z) && solidAt(k.x, k.y, z - 1) && solidAt(k.x, k.y, z + 1);
        if (!inner) list.push(ci, z);
      }
    });
    const count = list.length / 2, rounded = count <= ROUNDED_LIMIT;
    const geo = rounded ? new RoundedBoxGeometry(1, 1, 1, 1, 0.07) : new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.InstancedMesh(geo, null, count);
    const m = new THREE.Matrix4(), color = new THREE.Color(), cubeCell = new Int32Array(count), cubeZ = new Int32Array(count);
    for (let i = 0; i < count; i++) {
      const k = cells[list[2 * i]], z = list[2 * i + 1];
      const sz = s.sizes === 'actual' ? clamp(v.sizes[C.idx(k.x, k.y, z)] / v.max, 0.08, 1) * 0.94 : 0.94;
      m.makeScale(sz, sz, sz); m.setPosition(k.x + 0.5, k.y + 0.5, -(z + 0.5));
      mesh.setMatrixAt(i, m);
      color.copy(cellColor(k, z)); mesh.setColorAt(i, color);
      cubeCell[i] = list[2 * i]; cubeZ[i] = z;
    }
    mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.userData.cubeCell = cubeCell; mesh.userData.cubeZ = cubeZ; mesh.userData.cubes = count;
    mesh.userData.tris = count * (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    return mesh;
  }

  /* Fused solid: one face wherever a solid cube meets an empty one (the block style and the exports). */
  function buildFused(C, colored = true) {
    const { cells, solidAt } = C, v = M.source.vox;
    const pos = [], nor = [], col = [], idx = [], faceCell = [];
    let n = 0;
    function quad(a, b, c, d, nx, ny, nz, color, ci) {
      for (const p of [a, b, c, d]) { pos.push(p[0], p[1], -p[2]); nor.push(nx, ny, nz); if (colored) col.push(color.r, color.g, color.b); }
      idx.push(n, n + 1, n + 2, n, n + 2, n + 3); faceCell.push(ci, ci); n += 4;
    }
    cells.forEach((k, ci) => {
      const x0 = k.x, x1 = k.x + 1, y0 = k.y, y1 = k.y + 1;
      for (let z = 0; z < v.nz; z++) {
        if (!solidAt(k.x, k.y, z)) continue;
        const color = colored ? cellColor(k, z) : null, z0 = z, z1 = z + 1;
        if (!solidAt(k.x, k.y, z - 1)) quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], 0, 0, 1, color, ci);
        if (!solidAt(k.x, k.y, z + 1)) quad([x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1], 0, 0, -1, color, ci);
        if (!solidAt(k.x + 1, k.y, z)) quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], 1, 0, 0, color, ci);
        if (!solidAt(k.x - 1, k.y, z)) quad([x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1], -1, 0, 0, color, ci);
        if (!solidAt(k.x, k.y + 1, z)) quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], 0, 1, 0, color, ci);
        if (!solidAt(k.x, k.y - 1, z)) quad([x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0], 0, -1, 0, color, ci);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    if (colored) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.userData.faceCell = faceCell;
    return geo;
  }

  function clear() {
    for (const k of ['mesh', 'base']) { const o = M[k]; if (!o) continue; M.scene.remove(o); if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); M[k] = null; }
  }

  function rebuild() {
    if (!M.ready) return;
    clear();
    const empty = V('empty'), stats = V('stats'), info = V('info');
    if (!M.source || !M.source.vox) {
      empty.hidden = false; empty.innerHTML = (M.source && M.source.message) || opts.emptyText || 'Pick a frame to see its 3D model.';
      stats.textContent = ''; info.textContent = ''; M.planes.section.visible = M.planes.plan.visible = false; M.bbox = null; M.cells = null;
      M.boxLines.visible = M.boxFill.visible = false; if (M.gizmo) { M.gizmo.enabled = false; M.gizmo.getHelper().visible = false; }
      return;
    }
    const C = computeCells(); M.cells = C;
    const s = M.settings, v = M.source.vox, unlit = s.color === 'render', b = M.box;
    empty.hidden = C.cells.length > 0;
    if (!C.cells.length) { empty.textContent = b.on ? 'Nothing solid inside the box — move it or make it bigger.' : 'No cube reaches the mass threshold, so there is nothing to model.'; }
    const matOpts = { side: THREE.DoubleSide, clipShadows: true };
    let cubeCount = 0, tris = 0;
    if (C.cells.length) {
      if (s.style === 'cubes') {
        const mesh = buildCubes(C);
        mesh.material = unlit ? new THREE.MeshBasicMaterial(matOpts) : new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...matOpts });
        mesh.castShadow = s.shadows; mesh.receiveShadow = s.shadows; mesh.name = 'ProtoSpace frame';
        M.scene.add(mesh); M.mesh = mesh; cubeCount = mesh.userData.cubes; tris = mesh.userData.tris;
      } else {
        const geo = buildFused(C);
        const mat = unlit ? new THREE.MeshBasicMaterial({ vertexColors: true, ...matOpts }) : new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, vertexColors: true, ...matOpts });
        const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = s.shadows; mesh.receiveShadow = s.shadows; mesh.name = 'ProtoSpace frame';
        M.scene.add(mesh); M.mesh = mesh; tris = geo.index.count / 3;
      }
      M.mesh.userData.style = s.style;
    }
    M.scene.background = new THREE.Color(unlit ? 0xffffff : 0xf3f1ee);
    M.hemi.visible = M.light.visible = M.fill.visible = !unlit;
    const depth = v.nz;
    if (!unlit) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(v.nx + 6, 0.6, depth + 6), new THREE.MeshStandardMaterial({ color: 0xe6e1db, roughness: 1 }));
      base.position.set(v.nx / 2, C.rBase - 0.3, -depth / 2 + 1); base.receiveShadow = s.shadows; M.scene.add(base); M.base = base;
    }
    M.bbox = new THREE.Box3(new THREE.Vector3(0, C.rBase, -depth), new THREE.Vector3(v.nx, v.ny, 0));
    const ctr = M.bbox.getCenter(new THREE.Vector3()), span = Math.max(v.nx, v.ny, depth);
    M.light.position.copy(ctr).add(new THREE.Vector3(-0.55, 1, 0.75).multiplyScalar(span * 1.6)); M.light.target.position.copy(ctr);
    const sc = M.light.shadow.camera; sc.left = sc.bottom = -span * 0.9; sc.right = sc.top = span * 0.9; sc.near = 1; sc.far = span * 5; sc.updateProjectionMatrix();
    M.light.castShadow = s.shadows;
    const sx = V('sectionX'), sy = V('planY');
    if (sx && sy) {
      sx.max = v.nx; sy.max = v.ny;
      if (+sx.value > v.nx || sx.dataset.fresh !== '0') { sx.value = Math.round(v.nx / 2); sx.dataset.fresh = '0'; }
      if (+sy.value > v.ny || sy.dataset.fresh !== '0') { sy.value = Math.round(v.ny / 2); sy.dataset.fresh = '0'; }
      s.sectionX = +sx.value; s.planY = +sy.value;
    }
    syncBoxControls(); applyClipping(); drawBox();
    const what = b.on ? `box ${b.x1 - b.x0} × ${b.y1 - b.y0} m, ${b.z1 - b.z0} m deep` : `${v.nx} × ${v.ny} m slab, ${depth} m deep`;
    stats.textContent = `${M.source.name} · ${what} · ${fmtN(C.solidCount)} solid cubes${s.style === 'cubes' && cubeCount ? ` (${fmtN(cubeCount)} drawn)` : ''} · ${fmtN(tris)} triangles`;
    info.textContent = C.cells.length ? 'Click a cube for its reading.' : '';
    const key = `${v.nx}x${v.ny}x${v.nz}`;
    if (M.lastKey !== key) { M.lastKey = key; view(M.viewName === 'camera' ? 'camera' : 'iso'); } else if (M.viewName === 'camera') view('camera');
    renderLegend();
  }

  function applyClipping() {
    const s = M.settings, planes = [];
    if (!M.cells || !M.source || !M.source.vox) return;
    const v = M.source.vox, depth = v.nz, b = M.box;
    if (s.section) {
      planes.push(s.sectionFlip ? new THREE.Plane(new THREE.Vector3(1, 0, 0), -s.sectionX) : new THREE.Plane(new THREE.Vector3(-1, 0, 0), s.sectionX));
      const p = M.planes.section; p.visible = true; p.geometry.dispose(); p.geometry = new THREE.PlaneGeometry(depth + 2, v.ny + 2);
      p.rotation.set(0, Math.PI / 2, 0); p.position.set(s.sectionX, v.ny / 2, -depth / 2 + 0.5);
    } else M.planes.section.visible = false;
    if (s.plan) {
      planes.push(s.planFlip ? new THREE.Plane(new THREE.Vector3(0, 1, 0), -s.planY) : new THREE.Plane(new THREE.Vector3(0, -1, 0), s.planY));
      const p = M.planes.plan; p.visible = true; p.geometry.dispose(); p.geometry = new THREE.PlaneGeometry(v.nx + 2, depth + 2);
      p.rotation.set(-Math.PI / 2, 0, 0); p.position.set(v.nx / 2, s.planY, -depth / 2 + 0.5);
    } else M.planes.plan.visible = false;
    if (b.on) {                                                                 // instant crop while the box moves; the rebuild makes it exact
      planes.push(new THREE.Plane(new THREE.Vector3(1, 0, 0), -b.x0), new THREE.Plane(new THREE.Vector3(-1, 0, 0), b.x1),
        new THREE.Plane(new THREE.Vector3(0, 1, 0), -b.y0), new THREE.Plane(new THREE.Vector3(0, -1, 0), b.y1),
        new THREE.Plane(new THREE.Vector3(0, 0, 1), b.z1), new THREE.Plane(new THREE.Vector3(0, 0, -1), -b.z0));
    }
    if (M.mesh) { M.mesh.material.clippingPlanes = planes; M.mesh.material.needsUpdate = true; }
    const sxl = V('sectionX'); if (sxl) { sxl.parentElement.hidden = !s.section; V('sectionValue').textContent = s.sectionX + ' m'; }
    const syl = V('planY'); if (syl) { syl.parentElement.hidden = !s.plan; V('planValue').textContent = s.planY + ' m'; }
  }

  // ------------------------------------------------------------------ camera
  const VIEW_DIRS = { iso: [-0.95, 0.72, 1.25], front: [0, 0.06, 1], top: [0, 1, 0.001], left: [-1, 0.08, 0.001], right: [1, 0.08, 0.001], back: [0, 0.06, -1] };
  function view(name) {
    if (!M.bbox) return;
    if (name === 'camera' && !(M.source && M.source.camera)) name = 'front';
    const was = M.viewName; M.viewName = name;
    M.el.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === name));
    if (name === 'camera') { if (was !== 'camera') { resize(); return; } cameraView(); return; }
    if (was === 'camera') { M.camera.fov = 38; M.camera.updateProjectionMatrix(); resize(); }
    const dir = new THREE.Vector3(...(VIEW_DIRS[name] || VIEW_DIRS.iso)).normalize();
    const ctr = M.bbox.getCenter(new THREE.Vector3()), size = M.bbox.getSize(new THREE.Vector3());
    const radius = size.length() / 2, dist = radius / Math.sin(THREE.MathUtils.degToRad(M.camera.fov) / 2) * 1.08;
    M.camera.position.copy(ctr).add(dir.multiplyScalar(dist));
    M.camera.near = Math.max(0.1, dist / 100); M.camera.far = dist * 20; M.camera.updateProjectionMatrix();
    M.controls.target.copy(ctr); M.controls.update();
  }
  /* The render's own camera, in lattice metres: what Blender renders is what this view shows. */
  function cameraView() {
    const src = M.source, cam = src.camera;
    const p = cam.lattice(cam.position), f = cam.lattice([cam.position[0] + cam.forward[0], cam.position[1] + cam.forward[1], cam.position[2] + cam.forward[2]]);
    const pos = new THREE.Vector3(p[0], p[1], -p[2]), dir = new THREE.Vector3(f[0] - p[0], f[1] - p[1], -(f[2] - p[2])).normalize();
    const w = M.renderer.domElement.width / M.renderer.getPixelRatio(), h = M.renderer.domElement.height / M.renderer.getPixelRatio();
    const aspect = cam.resolution ? cam.resolution[0] / cam.resolution[1] : w / h;
    const hfov = 2 * Math.atan((cam.sensor_mm || 36) / 2 / (cam.lens_mm || 50));
    const fitH = cam.sensor_fit === 'VERTICAL' || (cam.sensor_fit === 'AUTO' && aspect < 1);
    M.camera.fov = THREE.MathUtils.radToDeg(fitH ? hfov : 2 * Math.atan(Math.tan(hfov / 2) / aspect));
    M.camera.position.copy(pos); M.controls.target.copy(pos.clone().add(dir.multiplyScalar(Math.max(1, pos.z))));
    M.camera.near = 0.5; M.camera.far = 4000; M.camera.aspect = w / h; M.camera.updateProjectionMatrix();
    M.controls.update();
  }
  /* Frame the crop box from the current direction. */
  function zoomToBox() {
    const b = M.box; if (!b.on || !M.bbox) return;
    if (M.viewName === 'camera') leaveCameraView();
    const box = new THREE.Box3(new THREE.Vector3(b.x0, b.y0, -b.z1), new THREE.Vector3(b.x1, b.y1, -b.z0));
    const ctr = box.getCenter(new THREE.Vector3()), radius = box.getSize(new THREE.Vector3()).length() / 2;
    const dir = M.camera.position.clone().sub(M.controls.target).normalize();
    const dist = Math.max(4, radius / Math.sin(THREE.MathUtils.degToRad(M.camera.fov) / 2) * 1.15);
    M.camera.position.copy(ctr).add(dir.multiplyScalar(dist));
    M.camera.near = Math.max(0.1, dist / 100); M.camera.far = dist * 40; M.camera.updateProjectionMatrix();
    M.controls.target.copy(ctr); M.controls.update();
  }
  function leaveCameraView() { M.viewName = 'orbit'; M.el.querySelectorAll('[data-view]').forEach(b => b.classList.remove('on')); M.camera.fov = 38; M.camera.updateProjectionMatrix(); resize(); }

  // ------------------------------------------------------------------ dragging the box itself
  /* Grab the box anywhere and slide it along the slab and in depth (on the level plane through the grab point);
     the gizmo's arrows move one axis at a time, the green one lifts it. */
  function wireBoxDrag(el) {
    let drag = null;
    const hitBox = e => { if (!M.box.on || !M.boxFill.visible) return null; castRay(e); return ray.intersectObject(M.boxFill, false)[0] || null; };
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0 || (M.gizmo && M.gizmo.axis)) return;
      const hit = hitBox(e); if (!hit) return;
      drag = { plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -hit.point.y), start: hit.point.clone(), c0: M.pivot.position.clone(), id: e.pointerId };
      M.controls.enabled = false; el.setPointerCapture(e.pointerId); el.style.cursor = 'grabbing';
      e.stopImmediatePropagation(); e.preventDefault();
    }, true);
    el.addEventListener('pointermove', e => {
      if (!drag) { if (M.box.on && M.boxFill.visible && !(M.gizmo && M.gizmo.axis)) el.style.cursor = hitBox(e) ? 'move' : ''; return; }
      castRay(e);
      const p = new THREE.Vector3(); if (!ray.ray.intersectPlane(drag.plane, p)) return;
      M.pivot.position.set(drag.c0.x + (p.x - drag.start.x), drag.c0.y, drag.c0.z + (p.z - drag.start.z));
      boxFromPivot();
      e.stopImmediatePropagation();
    }, true);
    const end = e => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null; M.controls.enabled = true; el.style.cursor = ''; M.dragEnd = performance.now(); try { el.releasePointerCapture(e.pointerId); } catch (err) {}
      boxChanged(); e.stopImmediatePropagation();
    };
    el.addEventListener('pointerup', end, true); el.addEventListener('pointercancel', end, true);
  }

  // ------------------------------------------------------------------ inspection
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function castRay(e) {
    const r = M.renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, M.camera);
  }
  function pick(e) {
    if (!M.mesh || !M.cells) return;
    if (M.gizmo && (M.gizmo.dragging || M.gizmo.axis)) return;
    if (performance.now() - (M.dragEnd || 0) < 300) return;
    castRay(e);
    const hit = ray.intersectObject(M.mesh, false)[0];
    const info = V('info');
    if (!hit) { info.textContent = 'Click a cube for its reading.'; return; }
    const cubes = M.mesh.userData.style === 'cubes';
    const ci = cubes ? M.mesh.userData.cubeCell[hit.instanceId] : M.mesh.geometry.userData.faceCell[hit.faceIndex];
    const k = M.cells.cells[ci], v = M.source.vox;
    const z = cubes ? M.mesh.userData.cubeZ[hit.instanceId] : Math.max(0, Math.min(v.nz - 1, Math.floor(-hit.point.z)));
    const size = v.sizes[M.cells.idx(k.x, k.y, z)] / v.max;
    info.textContent = `Column ${k.x + 1} along the slab, ${k.y + 1} up · cube ${z + 1} deep (${Math.round(size * 100)}% size) · first mass ${k.z0} m back: ${BAND_NAMES[k.band]} · ${k.n} solid ${k.n === 1 ? 'cube' : 'cubes'} in this column · level ${k.level + 1}${k.cls ? ' · ' + CLASS_NAMES[k.cls] : ''}`;
  }

  // ------------------------------------------------------------------ exports
  function download(blob, name) { const u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 4000); }
  function baseName() { const n = (M.source && M.source.name || 'frame').replace(/[^\w.-]+/g, '_').slice(0, 60); return `ProtoSpace-${n}${M.box.on ? '-box' : ''}-3D`; }
  function snapshot() {
    if (!M.mesh) return;
    const r = M.renderer, w = r.domElement.clientWidth, h = r.domElement.clientHeight, dpr = r.getPixelRatio();
    const helper = M.gizmo && M.gizmo.getHelper(), wasHelper = helper && helper.visible; if (helper) helper.visible = false;
    r.setPixelRatio(Math.min(4, dpr * 2)); r.setSize(w, h, false); r.render(M.scene, M.camera);
    r.domElement.toBlob(b => { download(b, baseName() + '.png'); r.setPixelRatio(dpr); r.setSize(w, h, false); if (helper) helper.visible = wasHelper; }, 'image/png');
  }
  function exportMesh() {
    const geo = buildFused(M.cells, true);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    mesh.name = 'ProtoSpace frame'; return mesh;
  }
  function exportOBJ() {
    if (!M.cells) return;
    const text = `# ProtoSpace Analyzer — ${M.source.name}. The cube lattice (1 cube = 1 m). X along the slab, Y up, Z toward the viewer (front face at z = 0).\n` + new OBJExporter().parse(exportMesh());
    download(new Blob([text], { type: 'text/plain' }), baseName() + '.obj');
  }
  function exportSTL() { if (!M.cells) return; download(new Blob([new STLExporter().parse(exportMesh(), { binary: true })], { type: 'model/stl' }), baseName() + '.stl'); }
  function exportGLB() {
    if (!M.cells) return;
    const group = new THREE.Group(); group.add(exportMesh());
    new GLTFExporter().parse(group, result => download(new Blob([result], { type: 'model/gltf-binary' }), baseName() + '.glb'), err => { V('info').textContent = 'GLB export failed: ' + err.message; }, { binary: true });
  }
  function recordTurn() {
    const info = V('info'), btn = V('record');
    if (!M.mesh) return;
    if (M.recording) { M.recording.stop(); return; }
    if (!('MediaRecorder' in window) || !M.renderer.domElement.captureStream) { info.textContent = 'This browser cannot record the viewport. Use the PNG snapshot, or try Chrome or Firefox.'; return; }
    const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t));
    if (!type) { info.textContent = 'No video format is available for recording in this browser.'; return; }
    const seconds = clamp(+(V('turnSeconds') ? V('turnSeconds').value : 8) || 8, 3, 60);
    const stream = M.renderer.domElement.captureStream(30), chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 10e6 });
    const wasAuto = M.controls.autoRotate, wasSpeed = M.controls.autoRotateSpeed, wasDamping = M.controls.enableDamping;
    const helper = M.gizmo && M.gizmo.getHelper(), wasHelper = helper && helper.visible; if (helper) helper.visible = false;
    if (M.viewName === 'camera') view('iso');
    M.controls.autoRotate = true; M.controls.autoRotateSpeed = 60 / seconds; M.controls.enableDamping = false;
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      M.controls.autoRotate = wasAuto || M.settings.turntable; M.controls.autoRotateSpeed = wasSpeed; M.controls.enableDamping = wasDamping;
      if (helper) helper.visible = wasHelper;
      M.recording = null; if (btn) { btn.textContent = 'Turntable · video'; btn.classList.remove('on'); }
      download(new Blob(chunks, { type: type.split(';')[0] }), baseName() + '-turntable.' + (type.startsWith('video/mp4') ? 'mp4' : 'webm'));
      info.textContent = `Recorded one full turn (${seconds} s).`;
    };
    rec.start(250);
    M.recording = { stop: () => rec.state !== 'inactive' && rec.stop() };
    if (btn) { btn.textContent = 'Stop recording'; btn.classList.add('on'); }
    info.textContent = `Recording one turn over ${seconds} s… keep the model on screen.`;
    setTimeout(() => M.recording && M.recording.stop(), seconds * 1000 + 300);
  }

  // ------------------------------------------------------------------ UI
  function renderLegend() {
    const el = V('legend'); if (!el) return;
    const s = M.settings, items = [];
    const sw = (hex, label) => `<li><span class="sw" style="background:#${hex.toString(16).padStart(6, '0')}"></span>${label}</li>`;
    if (s.color === 'depth') items.push(sw(0x1e1e1e, 'front of the slab'), sw(0x7b7b7b, 'half way back'), sw(0xd8d8d8, 'back of the slab'));
    else if (s.color === 'render') items.push(sw(0x0c0c0c, 'front (0 m)'), sw(0x707070, 'about 13 m back'), sw(0xd4d4d4, '26 m back · drawn unlit, as the studio render'));
    else if (s.color === 'class') [1, 2, 3, 4, 5, 6].forEach(k => items.push(sw(CLASS_COLORS[k], CLASS_NAMES[k])));
    else if (s.color === 'level') items.push(sw(LEVEL_COLORS[0], 'level 1, 4, 7 …'), sw(LEVEL_COLORS[1], 'level 2, 5, 8 …'), sw(LEVEL_COLORS[2], 'level 3, 6, 9 …'));
    else if (s.color === 'size') items.push(sw(0x6b5bd2, 'just over the mass threshold'), sw(0xf2efe9, 'full-size cube'));
    else items.push(sw(0xf2efe9, 'white study model · shadows carry the depth'));
    el.innerHTML = items.join('');
  }

  function wireControls() {
    const s = M.settings;
    const on = (id, ev, fn) => { const el = V(id); if (el) el.addEventListener(ev, fn); };
    on('style', 'change', e => { s.style = e.target.value; const sz = V('sizes'); if (sz) sz.parentElement.hidden = s.style !== 'cubes'; rebuild(); });
    on('sizes', 'change', e => { s.sizes = e.target.value; rebuild(); });
    on('color', 'change', e => { s.color = e.target.value; rebuild(); });
    on('shadows', 'change', e => { s.shadows = e.target.checked; rebuild(); });
    on('turntable', 'change', e => { s.turntable = e.target.checked; M.controls.autoRotate = s.turntable; if (s.turntable && M.viewName === 'camera') view('iso'); });
    on('section', 'change', e => { s.section = e.target.checked; rebuild(); });
    on('sectionX', 'input', e => { s.sectionX = +e.target.value; applyClipping(); });
    on('sectionFlip', 'click', () => { s.sectionFlip = !s.sectionFlip; applyClipping(); });
    on('plan', 'change', e => { s.plan = e.target.checked; rebuild(); });
    on('planY', 'input', e => { s.planY = +e.target.value; applyClipping(); });
    on('planFlip', 'click', () => { s.planFlip = !s.planFlip; applyClipping(); });
    on('cropOn', 'change', e => { M.box.on = e.target.checked; if (M.box.on && M.source && M.source.vox) { const v = M.source.vox; if (M.box.x1 - M.box.x0 >= v.nx && M.box.y1 - M.box.y0 >= v.ny && M.box.z1 - M.box.z0 >= v.nz) Object.assign(M.box, { x0: Math.round(v.nx * 0.3), x1: Math.round(v.nx * 0.7), y0: 0, y1: v.ny, z0: 0, z1: Math.min(v.nz, 12) }); } syncBoxControls(); applyClipping(); drawBox(); boxChanged(true); });
    for (const id of ['boxX', 'boxW', 'boxY', 'boxH', 'boxZ', 'boxD']) on(id, 'input', boxFromSliders);
    on('boxReset', 'click', () => resetBox(true));
    on('boxZoom', 'click', zoomToBox);
    M.el.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => view(b.dataset.view)));
    on('snapshot', 'click', snapshot);
    on('record', 'click', recordTurn);
    on('exportOBJ', 'click', exportOBJ);
    on('exportSTL', 'click', exportSTL);
    on('exportGLB', 'click', exportGLB);
    const put = (id, prop) => { const el = V(id); if (!el) return; if (el.type === 'checkbox') el.checked = s[prop]; else el.value = s[prop]; };
    put('style', 'style'); put('sizes', 'sizes'); put('color', 'color'); put('shadows', 'shadows');
  }

  Object.assign(api, { setSource, setBox, view, rebuild, snapshot, exportOBJ, exportSTL, exportGLB, recordTurn, resize, get ready() { return M.ready; }, get box() { return M.box.on ? Object.assign({}, M.box) : null; }, settings: M.settings, el: root, V });
  init();
  return api;
}

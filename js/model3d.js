/* ProtoSpace Analyzer — the real 3D model of a Blender frame.
   The frame's cube lattice comes straight from Blender (blender/export_frame.py): every point of the slab
   with the size of the cube that grew on it. Nothing here is inferred from a picture — this is the geometry
   the render was made from. The model is drawn with Three.js: orbit, the render's own camera, section and
   plan cuts (GPU clipping planes), colour by depth / level / spatial class, and exports (PNG, turntable
   video, OBJ, STL, GLB). Loaded as an ES module; exposes window.PSModel3D for the classic page script. */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const BAND_NAMES = ['mass at the front', 'first mass 3–8 m back', 'recess 9–18 m deep', 'recess 19 m or deeper', 'see-through'];
const CLASS_NAMES = ['', 'work (face mass)', 'gathering pocket', 'street', 'bridge', 'terrace', 'covered recess', 'see-through opening'];
const CLASS_COLORS = { 0: 0xd6d1cc, 1: 0xd6d1cc, 2: 0xc62828, 3: 0xe07b2a, 4: 0xf0b56b, 5: 0x7aa98f, 6: 0x8a8a8a, 7: 0xffffff };
const LEVEL_COLORS = [0xdcdcdc, 0xb8b8b8, 0x969696];
const ACCENT = 0xc62828, CUT = 0xe07b2a, WINDOW_LINE = 0x1a1a1a;
const ROUNDED_LIMIT = 6000;                                               // bevelled cubes for windows and areas; plain boxes for the whole slab

const $ = (s, root = document) => root.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtN = n => Math.round(n).toLocaleString('en-US');

// ------------------------------------------------------------------ state
const M = {
  ready: false, el: null, renderer: null, scene: null, camera: null, controls: null,
  source: null, cells: null, mesh: null, edges: null, grid: null, base: null, planes: {}, light: null, fill: null, hemi: null,
  bbox: null, raf: null, visible: true, pending: null, viewName: 'iso', recording: null, scrollAfterBuild: false, lastKey: '',
  settings: { scope: 'frame', style: 'cubes', sizes: 'actual', color: 'depth', edges: false, overlays: true, shadows: true,
    section: false, sectionX: 0, sectionFlip: false, plan: false, planY: 0, planFlip: false, turntable: false },
};

// ------------------------------------------------------------------ init
function init(section) {
  M.el = section;
  const viewport = $('#m3dViewport', section);
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  } catch (e) {
    viewport.innerHTML = '<p class="m3d-empty">This browser could not start WebGL, so the 3D model cannot be shown here. The ratings, section drawing and exports still work.</p>';
    return;
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.localClippingEnabled = true;
  renderer.domElement.setAttribute('aria-label', 'Interactive 3D model of the Blender frame. Drag to orbit, right-drag or two fingers to pan, scroll or pinch to zoom.');
  renderer.domElement.tabIndex = 0;
  viewport.appendChild(renderer.domElement);
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

  new ResizeObserver(resize).observe(viewport);
  resize();
  new IntersectionObserver(entries => { M.visible = entries[0].isIntersecting; if (M.visible) loop(); }, { threshold: 0 }).observe(viewport);
  renderer.domElement.addEventListener('click', pick);
  wireControls(section);
  M.ready = true;
  loop();
  if (M.pending) { const p = M.pending; M.pending = null; setSource(p); }
  window.dispatchEvent(new Event('psmodel-ready'));
}

function resize() {
  const viewport = $('#m3dViewport', M.el);
  const w = Math.max(280, viewport.clientWidth);
  const cam = M.source && M.source.camera;
  const ratio = M.viewName === 'camera' && cam && cam.resolution ? cam.resolution[1] / cam.resolution[0] : 0.62;
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
/* src = null | { name, frame, vox: { nx, ny, nz, sizes: Uint8Array (0..15, x fastest, then y, then z), threshold (0..15) },
                  camera: null | { position, forward, lens_mm, sensor_mm, sensor_fit, resolution, lattice: fn(world) → [across, up, depth] },
                  grid, R: { c0, r0 } (window offset in lattice cells), result, area: null | { c, r, w, h }, message }   */
function setSource(src) {
  if (!M.ready) { M.pending = src; return; }
  M.source = src;
  if ((!src || !src.vox) && M.viewName === 'camera') leaveCameraView();
  if (!src || !src.area) { if (M.settings.scope === 'area') M.settings.scope = 'frame'; }
  if (M.settings.scope === 'window' && !windowDiffers()) M.settings.scope = 'frame';
  updateScopeButtons();
  rebuild();
}
function setArea(area) {
  if (!M.source) return;
  M.source.area = area || null;
  if (!area && M.settings.scope === 'area') M.settings.scope = 'frame';
  updateScopeButtons();
  rebuild();
}
function setScope(scope, build = true) {
  if (scope === 'area' && !(M.source && M.source.area)) scope = 'frame';
  if (scope === 'window' && !windowDiffers()) scope = 'frame';
  M.settings.scope = scope;
  updateScopeButtons();
  if (build) rebuild();
}
function windowDiffers() {
  const s = M.source; if (!s || !s.vox || !s.grid) return false;
  return !(s.R.c0 === 0 && s.R.r0 === 0 && s.grid.cols === s.vox.nx && s.grid.rows === s.vox.ny);
}
function updateScopeButtons() {
  const hasArea = !!(M.source && M.source.area), hasWin = windowDiffers();
  const bArea = $('#m3dScopeArea', M.el), bWin = $('#m3dScopeWindow', M.el), bAll = $('#m3dScopeFrame', M.el);
  bArea.disabled = !hasArea; bArea.title = hasArea ? '' : 'Run “Find best area” in the spatial study first';
  bWin.disabled = !hasWin; bWin.title = hasWin ? '' : 'The analysed window is the whole slab';
  const sc = M.settings.scope;
  bArea.classList.toggle('on', sc === 'area'); bWin.classList.toggle('on', sc === 'window'); bAll.classList.toggle('on', sc === 'frame');
  const camBtn = $('[data-view="camera"]', M.el); if (camBtn) camBtn.disabled = !(M.source && M.source.camera);
}

// ------------------------------------------------------------------ scope → lattice window
/* The lattice window of the current scope: x0, y0 (cells) and cols, rows; window cell (c, r) is lattice (x0 + c, y0 + r). */
function lattice() {
  const s = M.source, sc = M.settings.scope, v = s.vox;
  if (sc === 'area' && s.area && s.grid) return { x0: s.R.c0 + s.area.c, y0: s.R.r0 + s.area.r, cols: s.area.w, rows: s.area.h };
  if (sc === 'window' && s.grid) return { x0: s.R.c0, y0: s.R.r0, cols: s.grid.cols, rows: s.grid.rows };
  return { x0: 0, y0: 0, cols: v.nx, rows: v.ny };
}
function gridIndex(x, y) {                                                  // window-grid cell of a lattice column, or -1
  const s = M.source; if (!s.grid) return -1;
  const c = x - s.R.c0, r = y - s.R.r0;
  if (c < 0 || r < 0 || c >= s.grid.cols || r >= s.grid.rows) return -1;
  return r * s.grid.cols + c;
}

/* Columns of the window (classes, levels, picking, the fused export) and the solid test. */
function computeCells() {
  const s = M.source, v = s.vox, L = lattice(), thr = v.threshold;
  const F = s.result && !s.result.features.empty ? s.result.features : null, cls = F ? F.classes : null;
  const idx = (x, y, z) => x + v.nx * (y + v.ny * z);
  const solidAt = (x, y, z) => x >= L.x0 && y >= L.y0 && x < L.x0 + L.cols && y < L.y0 + L.rows && z >= 0 && z < v.nz && v.sizes[idx(x, y, z)] >= thr;
  const cells = [], map = new Int32Array(L.cols * L.rows).fill(-1);
  let solidCount = 0;
  for (let r = 0; r < L.rows; r++) for (let c = 0; c < L.cols; c++) {
    const x = L.x0 + c, y = L.y0 + r;
    let z0 = -1, n = 0;
    for (let z = 0; z < v.nz; z++) if (v.sizes[idx(x, y, z)] >= thr) { if (z0 < 0) z0 = z; n++; }
    if (z0 < 0) continue;
    solidCount += n;
    const gi = gridIndex(x, y);
    const band = z0 < 3 ? 0 : z0 < 9 ? 1 : z0 < 19 ? 2 : 3;
    map[r * L.cols + c] = cells.length;
    cells.push({ c, r, x, y, z0, n, band, cls: cls && gi >= 0 ? cls[gi] : 0, level: 0 });
  }
  const rowCount = new Int32Array(L.rows); for (const k of cells) rowCount[k.r]++;
  let rBase = 0; for (let r = 0; r < L.rows; r++) if (rowCount[r] >= 3) { rBase = r; break; }
  if (F && M.settings.scope !== 'frame') rBase = Math.max(0, F.envelope.r0 - (L.y0 - s.R.r0));
  for (const k of cells) k.level = Math.max(0, Math.floor((k.r - rBase) / 3));
  return { cells, map, L, rBase, F, solidAt, solidCount, idx };
}

function cellColor(k, z) {
  const mode = M.settings.color, v = M.source.vox;
  if (mode === 'depth') { const t = clamp(z / Math.max(1, v.nz - 1), 0, 1); return new THREE.Color(0x1e1e1e).lerp(new THREE.Color(0xd8d8d8), t); }
  if (mode === 'render') { const t = clamp(z / 26, 0, 1); return new THREE.Color(0x0c0c0c).lerp(new THREE.Color(0xd4d4d4), t); }
  if (mode === 'class') return new THREE.Color(CLASS_COLORS[k.cls] ?? 0xd6d1cc);
  if (mode === 'level') return new THREE.Color(LEVEL_COLORS[k.level % 3]);
  if (mode === 'size') { const t = clamp(v.sizes[M.cells.idx(k.x, k.y, z)] / 15, 0, 1); return new THREE.Color(0xc62828).lerp(new THREE.Color(0xf2efe9), t); }
  return new THREE.Color(0xf2efe9);
}

// ------------------------------------------------------------------ geometry
/* Every solid cube of the window as one instance; cubes boxed in on all six sides are skipped. */
function buildCubes(C) {
  const { cells, solidAt } = C, v = M.source.vox, s = M.settings;
  const list = [];                                                           // [cellIndex, z]
  cells.forEach((k, ci) => {
    for (let z = 0; z < v.nz; z++) {
      if (!solidAt(k.x, k.y, z)) continue;
      const inner = solidAt(k.x - 1, k.y, z) && solidAt(k.x + 1, k.y, z) && solidAt(k.x, k.y - 1, z) && solidAt(k.x, k.y + 1, z) && solidAt(k.x, k.y, z - 1) && solidAt(k.x, k.y, z + 1);
      if (!inner) list.push(ci, z);
    }
  });
  const count = list.length / 2, rounded = count <= ROUNDED_LIMIT;
  const geo = rounded ? new RoundedBoxGeometry(1, 1, 1, 1, 0.07) : new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.InstancedMesh(geo, null, count);
  const m = new THREE.Matrix4(), color = new THREE.Color(), cubeCell = new Int32Array(count), cubeZ = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const k = cells[list[2 * i]], z = list[2 * i + 1];
    const sz = s.sizes === 'actual' ? clamp(v.sizes[C.idx(k.x, k.y, z)] / 15, 0.08, 1) * 0.94 : 0.94;
    m.makeScale(sz, sz, sz); m.setPosition(k.c + 0.5, k.r + 0.5, -(z + 0.5));
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
    const x0 = k.c, x1 = k.c + 1, y0 = k.r, y1 = k.r + 1;
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
  for (const k of ['mesh', 'edges', 'grid', 'base']) { const o = M[k]; if (!o) continue; M.scene.remove(o); if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); M[k] = null; }
}

function rebuild() {
  if (!M.ready) return;
  clear();
  const empty = $('#m3dEmpty', M.el), stats = $('#m3dStats', M.el), info = $('#m3dInfo', M.el);
  if (!M.source || !M.source.vox) {
    empty.hidden = false; empty.innerHTML = (M.source && M.source.message) || 'Pick a Blender frame to see its real 3D model.';
    stats.textContent = ''; info.textContent = ''; M.planes.section.visible = M.planes.plan.visible = false; M.bbox = null; M.cells = null; return;
  }
  const C = computeCells(); M.cells = C;
  if (!C.cells.length) { empty.hidden = false; empty.textContent = 'No cube in this window reaches the mass threshold, so there is nothing to model. Lower the threshold in the import panel.'; stats.textContent = ''; return; }
  empty.hidden = true;
  const s = M.settings, L = C.L, v = M.source.vox, unlit = s.color === 'render';
  const matOpts = { side: THREE.DoubleSide, clipShadows: true };
  let cubeCount = 0, tris = 0;
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
    if (s.edges) { const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 10), new THREE.LineBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.3 })); M.scene.add(edges); M.edges = edges; }
  }
  M.mesh.userData.style = s.style;
  M.scene.background = new THREE.Color(unlit ? 0xffffff : 0xf3f1ee);
  M.hemi.visible = M.light.visible = M.fill.visible = !unlit;
  const depth = v.nz;
  if (!unlit) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(L.cols + 6, 0.6, depth + 6), new THREE.MeshStandardMaterial({ color: 0xe6e1db, roughness: 1 }));
    base.position.set(L.cols / 2, C.rBase - 0.3, -depth / 2 + 1); base.receiveShadow = s.shadows; M.scene.add(base); M.base = base;
  }
  if (s.overlays) buildOverlays(C);
  M.bbox = new THREE.Box3(new THREE.Vector3(0, C.rBase, -depth), new THREE.Vector3(L.cols, L.rows, 0));
  const ctr = M.bbox.getCenter(new THREE.Vector3()), span = Math.max(L.cols, L.rows, depth);
  M.light.position.copy(ctr).add(new THREE.Vector3(-0.55, 1, 0.75).multiplyScalar(span * 1.6)); M.light.target.position.copy(ctr);
  const sc = M.light.shadow.camera; sc.left = sc.bottom = -span * 0.9; sc.right = sc.top = span * 0.9; sc.near = 1; sc.far = span * 5; sc.updateProjectionMatrix();
  M.light.castShadow = s.shadows;
  const sx = $('#m3dSectionX', M.el), sy = $('#m3dPlanY', M.el);
  sx.max = L.cols; sy.max = L.rows;
  if (+sx.value > L.cols || sx.dataset.fresh !== '0') { sx.value = Math.round(L.cols / 2); sx.dataset.fresh = '0'; }
  if (+sy.value > L.rows || sy.dataset.fresh !== '0') { sy.value = Math.round(L.rows / 2); sy.dataset.fresh = '0'; }
  s.sectionX = +sx.value; s.planY = +sy.value;
  applyClipping();
  const what = s.scope === 'frame' ? 'whole slab' : s.scope === 'area' ? 'selected area' : 'analysed window';
  stats.textContent = `${M.source.name} · ${what} · ${L.cols} × ${L.rows} m face, ${depth} m deep · ${fmtN(C.cells.length)} built columns · ${fmtN(C.solidCount)} solid cubes${s.style === 'cubes' ? ` (${fmtN(cubeCount)} drawn)` : ''} · ${fmtN(tris)} triangles · mass at ≥ ${Math.round(v.threshold / 15 * 100)}% cube size`;
  info.textContent = 'Click a cube for its reading.';
  const key = `${s.scope}:${L.cols}x${L.rows}`;
  if (M.lastKey !== key) { M.lastKey = key; view(M.viewName === 'camera' ? 'camera' : 'iso'); } else if (M.viewName === 'camera') view('camera');
  renderLegend();
  if (M.scrollAfterBuild) { M.scrollAfterBuild = false; M.el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}

/* Overlays on the front plane: the fitted 9 × 3 m module grid, the analysed window and the study area. */
function buildOverlays(C) {
  const s = M.source, L = C.L, st = M.settings, pts = [], cols = [];
  const lx = x => x - L.x0, ly = y => y - L.y0;                                 // lattice → window coordinates
  const seg = (a, b, color, z = 0.06) => { pts.push(a[0], a[1], z, b[0], b[1], z); const c = new THREE.Color(color); cols.push(c.r, c.g, c.b, c.r, c.g, c.b); };
  if (C.F && s.grid) {
    const F = C.F, E = F.envelope, Mo = F.modules, gx = c => lx(s.R.c0 + c), gy = r => ly(s.R.r0 + r);
    for (let m = 0; m <= Mo.nm; m++) seg([gx(Mo.mo + m * 9), gy(E.r0)], [gx(Mo.mo + m * 9), gy(E.r0 + Mo.nf * 3)], ACCENT);
    for (let f = 0; f <= Mo.nf; f++) seg([gx(Mo.mo), gy(E.r0 + f * 3)], [gx(Mo.mo + Mo.nm * 9), gy(E.r0 + f * 3)], ACCENT);
  }
  if (st.scope === 'frame' && windowDiffers()) {
    const a = [lx(s.R.c0), ly(s.R.r0)], b = [lx(s.R.c0 + s.grid.cols), ly(s.R.r0)], c = [lx(s.R.c0 + s.grid.cols), ly(s.R.r0 + s.grid.rows)], d = [lx(s.R.c0), ly(s.R.r0 + s.grid.rows)];
    seg(a, b, WINDOW_LINE, 0.1); seg(b, c, WINDOW_LINE, 0.1); seg(c, d, WINDOW_LINE, 0.1); seg(d, a, WINDOW_LINE, 0.1);
  }
  if (st.scope !== 'area' && s.area && s.grid) {
    const A = s.area, ax = lx(s.R.c0 + A.c), ay = ly(s.R.r0 + A.r);
    const a = [ax, ay], b = [ax + A.w, ay], c = [ax + A.w, ay + A.h], d = [ax, ay + A.h];
    seg(a, b, ACCENT, 0.12); seg(b, c, ACCENT, 0.12); seg(c, d, ACCENT, 0.12); seg(d, a, ACCENT, 0.12);
  }
  if (!pts.length) return;
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  gg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const lines = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }));
  M.scene.add(lines); M.grid = lines;
}

function applyClipping() {
  const s = M.settings, planes = [];
  if (!M.cells) return;
  const L = M.cells.L, depth = M.source.vox.nz;
  if (s.section) {
    planes.push(s.sectionFlip ? new THREE.Plane(new THREE.Vector3(1, 0, 0), -s.sectionX) : new THREE.Plane(new THREE.Vector3(-1, 0, 0), s.sectionX));
    const p = M.planes.section; p.visible = true; p.geometry.dispose(); p.geometry = new THREE.PlaneGeometry(depth + 2, L.rows + 2);
    p.rotation.set(0, Math.PI / 2, 0); p.position.set(s.sectionX, L.rows / 2, -depth / 2 + 0.5);
  } else M.planes.section.visible = false;
  if (s.plan) {
    planes.push(s.planFlip ? new THREE.Plane(new THREE.Vector3(0, 1, 0), -s.planY) : new THREE.Plane(new THREE.Vector3(0, -1, 0), s.planY));
    const p = M.planes.plan; p.visible = true; p.geometry.dispose(); p.geometry = new THREE.PlaneGeometry(L.cols + 2, depth + 2);
    p.rotation.set(-Math.PI / 2, 0, 0); p.position.set(L.cols / 2, s.planY, -depth / 2 + 0.5);
  } else M.planes.plan.visible = false;
  for (const o of [M.mesh, M.edges]) if (o) { o.material.clippingPlanes = planes; o.material.needsUpdate = true; }
  $('#m3dSectionX', M.el).parentElement.hidden = !s.section;
  $('#m3dPlanY', M.el).parentElement.hidden = !s.plan;
  $('#m3dSectionValue', M.el).textContent = s.sectionX + ' m';
  $('#m3dPlanValue', M.el).textContent = s.planY + ' m';
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
/* The render's own camera, in lattice metres: what Blender rendered is what this view shows. */
function cameraView() {
  const src = M.source, cam = src.camera, L = M.cells.L;
  const p = cam.lattice(cam.position), f = cam.lattice([cam.position[0] + cam.forward[0], cam.position[1] + cam.forward[1], cam.position[2] + cam.forward[2]]);
  const pos = new THREE.Vector3(p[0] - L.x0, p[1] - L.y0, -p[2]), dir = new THREE.Vector3(f[0] - p[0], f[1] - p[1], -(f[2] - p[2])).normalize();
  const w = M.renderer.domElement.width / M.renderer.getPixelRatio(), h = M.renderer.domElement.height / M.renderer.getPixelRatio();
  const aspect = cam.resolution ? cam.resolution[0] / cam.resolution[1] : w / h;
  const hfov = 2 * Math.atan((cam.sensor_mm || 36) / 2 / (cam.lens_mm || 50));
  const fitH = cam.sensor_fit === 'VERTICAL' || (cam.sensor_fit === 'AUTO' && aspect < 1);
  M.camera.fov = THREE.MathUtils.radToDeg(fitH ? hfov : 2 * Math.atan(Math.tan(hfov / 2) / aspect));
  M.camera.position.copy(pos); M.controls.target.copy(pos.clone().add(dir.multiplyScalar(Math.max(1, pos.z))));
  M.camera.near = 0.5; M.camera.far = 4000; M.camera.aspect = w / h; M.camera.updateProjectionMatrix();
  M.controls.update();
}
function leaveCameraView() { M.viewName = 'orbit'; M.el.querySelectorAll('[data-view]').forEach(b => b.classList.remove('on')); M.camera.fov = 38; M.camera.updateProjectionMatrix(); resize(); }

// ------------------------------------------------------------------ inspection
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pick(e) {
  if (!M.mesh || !M.cells) return;
  const r = M.renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, M.camera);
  const hit = ray.intersectObject(M.mesh, false)[0];
  const info = $('#m3dInfo', M.el);
  if (!hit) { info.textContent = 'Click a cube for its reading.'; return; }
  const cubes = M.mesh.userData.style === 'cubes';
  const ci = cubes ? M.mesh.userData.cubeCell[hit.instanceId] : M.mesh.geometry.userData.faceCell[hit.faceIndex];
  const k = M.cells.cells[ci], v = M.source.vox;
  const z = cubes ? M.mesh.userData.cubeZ[hit.instanceId] : Math.max(0, Math.min(v.nz - 1, Math.floor(-hit.point.z)));
  const size = v.sizes[M.cells.idx(k.x, k.y, z)] / 15;
  info.textContent = `Column ${k.x + 1} along the slab, ${k.y + 1} up · cube ${z + 1} deep (${Math.round(size * 100)}% size) · first mass at ${k.z0} m: ${BAND_NAMES[k.band]} · ${k.n} solid ${k.n === 1 ? 'cube' : 'cubes'} in this column · level ${k.level + 1}${k.cls ? ' · ' + CLASS_NAMES[k.cls] : ''}`;
}

// ------------------------------------------------------------------ exports
function download(blob, name) { const u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 4000); }
function baseName() { const n = (M.source && M.source.name || 'frame').replace(/[^\w.-]+/g, '_').slice(0, 60); return `ProtoSpace-${n}-${M.settings.scope}-3D`; }
function snapshot() {
  if (!M.mesh) return;
  const r = M.renderer, w = r.domElement.clientWidth, h = r.domElement.clientHeight, dpr = r.getPixelRatio();
  r.setPixelRatio(Math.min(4, dpr * 2)); r.setSize(w, h, false); r.render(M.scene, M.camera);
  r.domElement.toBlob(b => { download(b, baseName() + '.png'); r.setPixelRatio(dpr); r.setSize(w, h, false); }, 'image/png');
}
function exportMesh() {
  const geo = buildFused(M.cells, true);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  mesh.name = 'ProtoSpace frame'; return mesh;
}
function exportOBJ() {
  if (!M.cells) return;
  const text = `# ProtoSpace Analyzer — ${M.source.name}. The Blender cube lattice (1 cube = 1 m). X along the slab, Y up, Z toward the viewer (front face at z = 0).\n` + new OBJExporter().parse(exportMesh());
  download(new Blob([text], { type: 'text/plain' }), baseName() + '.obj');
}
function exportSTL() { if (!M.cells) return; download(new Blob([new STLExporter().parse(exportMesh(), { binary: true })], { type: 'model/stl' }), baseName() + '.stl'); }
function exportGLB() {
  if (!M.cells) return;
  const group = new THREE.Group(); group.add(exportMesh());
  new GLTFExporter().parse(group, result => download(new Blob([result], { type: 'model/gltf-binary' }), baseName() + '.glb'), err => { $('#m3dInfo', M.el).textContent = 'GLB export failed: ' + err.message; }, { binary: true });
}
function recordTurn() {
  const info = $('#m3dInfo', M.el), btn = $('#m3dRecord', M.el);
  if (!M.mesh) return;
  if (M.recording) { M.recording.stop(); return; }
  if (!('MediaRecorder' in window) || !M.renderer.domElement.captureStream) { info.textContent = 'This browser cannot record the viewport. Use the PNG snapshot, or try Chrome or Firefox.'; return; }
  const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t));
  if (!type) { info.textContent = 'No video format is available for recording in this browser.'; return; }
  const seconds = clamp(+$('#m3dTurnSeconds', M.el).value || 8, 3, 60);
  const stream = M.renderer.domElement.captureStream(30), chunks = [];
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 10e6 });
  const wasAuto = M.controls.autoRotate, wasSpeed = M.controls.autoRotateSpeed, wasDamping = M.controls.enableDamping;
  if (M.viewName === 'camera') view('iso');
  M.controls.autoRotate = true; M.controls.autoRotateSpeed = 60 / seconds; M.controls.enableDamping = false;
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    M.controls.autoRotate = wasAuto || M.settings.turntable; M.controls.autoRotateSpeed = wasSpeed; M.controls.enableDamping = wasDamping;
    M.recording = null; btn.textContent = 'Turntable · video'; btn.classList.remove('on');
    download(new Blob(chunks, { type: type.split(';')[0] }), baseName() + '-turntable.' + (type.startsWith('video/mp4') ? 'mp4' : 'webm'));
    info.textContent = `Recorded one full turn (${seconds} s).`;
  };
  rec.start(250);
  M.recording = { stop: () => rec.state !== 'inactive' && rec.stop() };
  btn.textContent = 'Stop recording'; btn.classList.add('on');
  info.textContent = `Recording one turn over ${seconds} s… keep this section on screen.`;
  setTimeout(() => M.recording && M.recording.stop(), seconds * 1000 + 300);
}

// ------------------------------------------------------------------ UI
function renderLegend() {
  const el = $('#m3dLegend', M.el), s = M.settings, items = [];
  const sw = (hex, label) => `<li><span class="sw" style="background:#${hex.toString(16).padStart(6, '0')}"></span>${label}</li>`;
  if (s.color === 'depth') items.push(sw(0x1e1e1e, 'front of the slab'), sw(0x7b7b7b, 'half way back'), sw(0xd8d8d8, 'back of the slab'));
  else if (s.color === 'render') items.push(sw(0x0c0c0c, 'front (0 m)'), sw(0x707070, 'about 13 m back'), sw(0xd4d4d4, '26 m back · drawn unlit, as the studio render'));
  else if (s.color === 'class') [1, 2, 3, 4, 5, 6].forEach(k => items.push(sw(CLASS_COLORS[k], CLASS_NAMES[k])));
  else if (s.color === 'level') items.push(sw(LEVEL_COLORS[0], 'level 1, 4, 7 …'), sw(LEVEL_COLORS[1], 'level 2, 5, 8 …'), sw(LEVEL_COLORS[2], 'level 3, 6, 9 …'));
  else if (s.color === 'size') items.push(sw(0xc62828, 'just over the mass threshold'), sw(0xf2efe9, 'full-size cube'));
  else items.push(sw(0xf2efe9, 'white study model · shadows carry the depth'));
  if (s.overlays) { items.push(sw(ACCENT, '9 × 3 m module grid where the analyzer fitted it · red outline = study area')); if (s.scope === 'frame' && windowDiffers()) items.push(sw(WINDOW_LINE, 'black outline = the analysed window')); }
  el.innerHTML = items.join('');
}

function wireControls(section) {
  const s = M.settings;
  const on = (id, ev, fn) => { const el = $('#' + id, section); if (el) el.addEventListener(ev, fn); };
  on('m3dScopeFrame', 'click', () => setScope('frame'));
  on('m3dScopeWindow', 'click', () => setScope('window'));
  on('m3dScopeArea', 'click', () => setScope('area'));
  on('m3dStyle', 'change', e => { s.style = e.target.value; $('#m3dEdges', section).parentElement.hidden = s.style !== 'blocks'; $('#m3dSizes', section).parentElement.hidden = s.style !== 'cubes'; rebuild(); });
  on('m3dSizes', 'change', e => { s.sizes = e.target.value; rebuild(); });
  on('m3dColor', 'change', e => { s.color = e.target.value; rebuild(); });
  on('m3dEdges', 'change', e => { s.edges = e.target.checked; rebuild(); });
  on('m3dOverlays', 'change', e => { s.overlays = e.target.checked; rebuild(); });
  on('m3dShadows', 'change', e => { s.shadows = e.target.checked; rebuild(); });
  on('m3dTurntable', 'change', e => { s.turntable = e.target.checked; M.controls.autoRotate = s.turntable; if (s.turntable && M.viewName === 'camera') view('iso'); });
  on('m3dSection', 'change', e => { s.section = e.target.checked; applyClipping(); });
  on('m3dSectionX', 'input', e => { s.sectionX = +e.target.value; applyClipping(); });
  on('m3dSectionFlip', 'click', () => { s.sectionFlip = !s.sectionFlip; applyClipping(); });
  on('m3dPlan', 'change', e => { s.plan = e.target.checked; applyClipping(); });
  on('m3dPlanY', 'input', e => { s.planY = +e.target.value; applyClipping(); });
  on('m3dPlanFlip', 'click', () => { s.planFlip = !s.planFlip; applyClipping(); });
  section.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => view(b.dataset.view)));
  on('m3dSnapshot', 'click', snapshot);
  on('m3dRecord', 'click', recordTurn);
  on('m3dExportOBJ', 'click', exportOBJ);
  on('m3dExportSTL', 'click', exportSTL);
  on('m3dExportGLB', 'click', exportGLB);
  $('#m3dStyle', section).value = s.style; $('#m3dSizes', section).value = s.sizes; $('#m3dColor', section).value = s.color;
  $('#m3dEdges', section).checked = s.edges; $('#m3dEdges', section).parentElement.hidden = s.style !== 'blocks';
  $('#m3dOverlays', section).checked = s.overlays; $('#m3dShadows', section).checked = s.shadows;
}

function setSectionFromStudy(x, enable) {
  const s = M.settings; s.sectionX = clamp(Math.round(x), 0, +$('#m3dSectionX', M.el).max || x);
  $('#m3dSectionX', M.el).value = s.sectionX;
  if (enable != null) { s.section = enable; $('#m3dSection', M.el).checked = enable; }
  applyClipping();
}
function scrollAfterNextBuild() { M.scrollAfterBuild = true; }

window.PSModel3D = { init, setSource, setArea, setScope, view, rebuild, snapshot, exportOBJ, exportSTL, exportGLB, recordTurn, setSectionFromStudy, scrollAfterNextBuild, get ready() { return M.ready; }, settings: M.settings };
const section = document.getElementById('model3d');
if (section) init(section);

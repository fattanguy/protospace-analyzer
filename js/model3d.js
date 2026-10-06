/* ProtoSpace Analyzer — "Frame → 3D model".
   Builds a Three.js model of the analysed frame (or of the selected area) from the depth grid the
   analyzer reads: every 1 m cell of the face becomes a box whose front sits at the depth the tone implies
   and whose back is either a fixed thickness behind it (shell) or a common back plane (massing).
   The frame image can be projected onto the model, or the cells coloured by depth band, spatial class
   or level. Section and plan cuts use GPU clipping planes. Exports: PNG, OBJ, STL, GLB.
   Loaded as an ES module; exposes window.PSModel3D for the classic page script. */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const BAND_DEPTHS = [0, 5.5, 13.5, 22];                       // representative depth of each tone band (m)
const TONE_TO_DEPTH = [[0, 0], [0.09, 3], [0.20, 8.5], [0.40, 18], [0.72, 26]];   // continuous relief calibration
const BAND_NAMES = ['mass at the front', 'first mass 3–8 m back', 'recess 9–18 m deep', 'recess 19 m or deeper', 'see-through'];
const CLASS_NAMES = ['', 'work (face mass)', 'gathering pocket', 'street', 'bridge', 'terrace', 'covered recess', 'see-through opening'];
const BAND_GREYS = [0x2a2a2a, 0x5e5e5e, 0x949494, 0xc9c9c9];
const CLASS_COLORS = { 0: 0xd6d1cc, 1: 0xd6d1cc, 2: 0xc62828, 3: 0xe07b2a, 4: 0xf0b56b, 5: 0x7aa98f, 6: 0x8a8a8a, 7: 0xffffff };
const LEVEL_COLORS = [0xdcdcdc, 0xb8b8b8, 0x969696, 0xc62828];
const ACCENT = 0xc62828, CUT = 0xe07b2a;

const $ = (s, root = document) => root.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function toneDepth(t) {
  if (t <= TONE_TO_DEPTH[0][0]) return 0;
  for (let i = 1; i < TONE_TO_DEPTH.length; i++) {
    const [t0, d0] = TONE_TO_DEPTH[i - 1], [t1, d1] = TONE_TO_DEPTH[i];
    if (t <= t1) return d0 + (d1 - d0) * (t - t0) / (t1 - t0);
  }
  return TONE_TO_DEPTH.at(-1)[1];
}

// ------------------------------------------------------------------ the model
const M = {
  ready: false, el: null, renderer: null, scene: null, camera: null, controls: null,
  source: null, cells: null, mesh: null, edges: null, grid: null, base: null, planes: {}, light: null,
  texture: null, bbox: null, raf: null, visible: true, pending: null,
  settings: { scope: 'frame', depth: 'relief', solid: 'shell', thickness: 3, color: 'image', edges: true, moduleGrid: true, shadows: true, section: false, sectionX: 0, sectionFlip: false, plan: false, planY: 0, planFlip: false, turntable: false },
};

function init(section) {
  M.el = section;
  const viewport = $('#m3dViewport', section);
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch (e) {
    viewport.innerHTML = '<p class="m3d-empty">This browser could not start WebGL, so the 3D model cannot be shown here. The section drawing, ratings and exports still work.</p>';
    return;
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.localClippingEnabled = true;
  renderer.domElement.setAttribute('aria-label', 'Interactive 3D model of the analysed frame. Drag to orbit, right-drag or two fingers to pan, scroll or pinch to zoom.');
  renderer.domElement.tabIndex = 0;
  viewport.appendChild(renderer.domElement);
  M.renderer = renderer;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf3f1ee);
  M.scene = scene;
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 2000);
  camera.position.set(-30, 30, 60);
  M.camera = camera;
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.autoRotateSpeed = 1.2;
  controls.maxPolarAngle = Math.PI * 0.52;
  controls.listenToKeyEvents(renderer.domElement);
  M.controls = controls;

  scene.add(new THREE.HemisphereLight(0xffffff, 0xb5aea6, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  scene.add(sun); scene.add(sun.target); M.light = sun;
  const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(60, 20, -40); scene.add(fill);

  // the cut planes, shown as translucent orange sheets
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
  const w = Math.max(280, viewport.clientWidth), h = clamp(Math.round(w * 0.62), 340, 640);
  M.renderer.setSize(w, h, false);
  M.renderer.domElement.style.width = '100%'; M.renderer.domElement.style.height = h + 'px';
  M.camera.aspect = w / h; M.camera.updateProjectionMatrix();
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

// ------------------------------------------------------------------ source → cells
/* src = { name, grid, result, image: { canvas, R }, area: null | { c, r, w, h } } */
function setSource(src) {
  if (!M.ready) { M.pending = src; return; }
  M.source = src;
  if (!src || !src.area) { if (M.settings.scope === 'area') setScope('frame', false); }
  updateScopeButtons();
  makeTexture();
  rebuild();
}
function setArea(area) {
  if (!M.source) return;
  M.source.area = area || null;
  if (!area && M.settings.scope === 'area') setScope('frame', false);
  updateScopeButtons();
  if (M.settings.scope === 'area') rebuild();
}
function setScope(scope, build = true) {
  M.settings.scope = scope;
  updateScopeButtons();
  if (build) rebuild();
}
function updateScopeButtons() {
  const has = !!(M.source && M.source.area);
  const bArea = $('#m3dScopeArea', M.el), bFrame = $('#m3dScopeFrame', M.el);
  bArea.disabled = !has; bArea.title = has ? '' : 'Run “Find best area” in the spatial study first';
  bArea.classList.toggle('on', M.settings.scope === 'area'); bFrame.classList.toggle('on', M.settings.scope !== 'area');
}

function window_() {
  const g = M.source.grid, a = M.settings.scope === 'area' && M.source.area;
  return a ? { c0: a.c, r0: a.r, cols: a.w, rows: a.h } : { c0: 0, r0: 0, cols: g.cols, rows: g.rows };
}

function computeCells() {
  const src = M.source, g = src.grid, s = M.settings, W = window_();
  const F = src.result && !src.result.features.empty ? src.result.features : null;
  const cls = F ? F.classes : null;
  const cells = []; let maxD = 0;
  for (let r = 0; r < W.rows; r++) for (let c = 0; c < W.cols; c++) {
    const gi = (r + W.r0) * g.cols + c + W.c0, b = g.band[gi];
    if (b === 4) continue;
    let d;
    if (s.depth === 'bands') d = BAND_DEPTHS[b];
    else if (s.depth === 'flat') d = 0;
    else d = toneDepth(g.tone ? g.tone[gi] : (b === 0 ? 0.05 : b === 1 ? 0.145 : b === 2 ? 0.3 : 0.56));
    d = Math.round(d * 100) / 100;
    if (d > maxD) maxD = d;
    cells.push({ c, r, gc: c + W.c0, gr: r + W.r0, band: b, cls: cls ? cls[gi] : 0, z0: d, z1: 0, level: 0 });
  }
  const back = s.solid === 'massing' ? maxD + s.thickness : null;
  const r0 = F ? F.envelope.r0 : 0;
  for (const k of cells) { k.z1 = back != null ? back : k.z0 + s.thickness; k.level = Math.max(0, Math.floor((k.gr - r0) / 3)); }
  const map = new Int32Array(W.cols * W.rows).fill(-1);
  cells.forEach((k, i) => map[k.r * W.cols + k.c] = i);
  return { cells, map, W, maxD, back: back != null ? back : maxD + s.thickness, r0, F };
}

function cellColor(k) {
  const s = M.settings;
  if (s.color === 'bands') {
    if (s.depth === 'relief') { const t = clamp(k.z0 / 26, 0, 1); return new THREE.Color(0x2a2a2a).lerp(new THREE.Color(0xd2d2d2), t); }
    return new THREE.Color(BAND_GREYS[k.band]);
  }
  if (s.color === 'class') return new THREE.Color(CLASS_COLORS[k.cls] ?? 0xd6d1cc);
  if (s.color === 'level') return new THREE.Color(LEVEL_COLORS[k.level % 3]);
  return new THREE.Color(0xffffff);                     // image projection: the texture carries the colour
}

/* Builds one merged BufferGeometry. Side faces are emitted only where they are exposed (the neighbour's
   solid interval is subtracted), so no two faces are coplanar and nothing z-fights. */
function buildGeometry(C) {
  const { cells, map, W } = C, g = M.source.grid, s = M.settings;
  const pos = [], nor = [], uv = [], col = [], idx = [], faceCell = [];
  const rw = M.source.image ? M.source.image.R.x1 - M.source.image.R.x0 : 1, rh = M.source.image ? M.source.image.R.y1 - M.source.image.R.y0 : 1;
  const U = x => (g.px + (x + W.c0) * g.pitch) / rw, V = y => 1 - (g.py + (g.rows - (y + W.r0)) * g.pitch) / rh;
  let n = 0;
  function quad(a, b, c, d, nx, ny, nz, color, ci) {
    for (const p of [a, b, c, d]) { pos.push(p[0], p[1], -p[2]); nor.push(nx, ny, nz); uv.push(U(p[0]), V(p[1])); col.push(color.r, color.g, color.b); }
    idx.push(n, n + 1, n + 2, n, n + 2, n + 3); faceCell.push(ci, ci); n += 4;
  }
  const interval = (c, r) => { if (c < 0 || r < 0 || c >= W.cols || r >= W.rows) return null; const i = map[r * W.cols + c]; return i < 0 ? null : cells[i]; };
  // the parts of [z0,z1] not covered by the neighbour's [n.z0,n.z1]
  const exposed = (k, nb) => { if (!nb) return [[k.z0, k.z1]]; const out = []; if (k.z0 < nb.z0) out.push([k.z0, Math.min(k.z1, nb.z0)]); if (k.z1 > nb.z1) out.push([Math.max(k.z0, nb.z1), k.z1]); return out.filter(([a, b]) => b - a > 1e-6); };
  cells.forEach((k, ci) => {
    const color = cellColor(k), x0 = k.c, x1 = k.c + 1, y0 = k.r, y1 = k.r + 1;
    quad([x0, y0, k.z0], [x1, y0, k.z0], [x1, y1, k.z0], [x0, y1, k.z0], 0, 0, 1, color, ci);           // front
    quad([x1, y0, k.z1], [x0, y0, k.z1], [x0, y1, k.z1], [x1, y1, k.z1], 0, 0, -1, color, ci);          // back
    for (const [z0, z1] of exposed(k, interval(k.c + 1, k.r))) quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], 1, 0, 0, color, ci);   // +x
    for (const [z0, z1] of exposed(k, interval(k.c - 1, k.r))) quad([x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1], -1, 0, 0, color, ci); // -x
    for (const [z0, z1] of exposed(k, interval(k.c, k.r + 1))) quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], 0, 1, 0, color, ci);   // top
    for (const [z0, z1] of exposed(k, interval(k.c, k.r - 1))) quad([x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0], 0, -1, 0, color, ci);  // bottom
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.userData.faceCell = faceCell;
  return geo;
}

function makeTexture() {
  if (M.texture) { M.texture.dispose(); M.texture = null; }
  const im = M.source && M.source.image; if (!im) return;
  const { canvas, R } = im, c = document.createElement('canvas');
  c.width = R.x1 - R.x0; c.height = R.y1 - R.y0;
  const x = c.getContext('2d');
  x.drawImage(canvas, R.x0, R.y0, c.width, c.height, 0, 0, c.width, c.height);
  x.fillStyle = 'rgba(255,255,255,0.16)'; x.fillRect(0, 0, c.width, c.height);   // lift pure black a little so the lighting still shapes the front mass
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, M.renderer.capabilities.getMaxAnisotropy());
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  M.texture = t;
}

function clear() {
  for (const k of ['mesh', 'edges', 'grid', 'base']) { const o = M[k]; if (!o) continue; M.scene.remove(o); o.geometry.dispose(); if (o.material.dispose) o.material.dispose(); M[k] = null; }
}

function rebuild() {
  if (!M.ready) return;
  clear();
  const empty = $('#m3dEmpty', M.el), stats = $('#m3dStats', M.el), info = $('#m3dInfo', M.el);
  if (!M.source || !M.source.grid || !M.source.grid.cols) { empty.hidden = false; stats.textContent = ''; info.textContent = ''; M.planes.section.visible = M.planes.plan.visible = false; return; }
  const C = computeCells(); M.cells = C;
  if (!C.cells.length) { empty.hidden = false; empty.textContent = 'No built cells were read in this frame, so there is nothing to model. Adjust the scale, tone or crop.'; stats.textContent = ''; return; }
  empty.hidden = true;
  const s = M.settings;
  const geo = buildGeometry(C);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, side: THREE.DoubleSide, vertexColors: s.color !== 'image', map: s.color === 'image' ? M.texture : null, clipShadows: true });
  const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = s.shadows; mesh.receiveShadow = s.shadows; mesh.name = 'ProtoSpace frame model';
  M.scene.add(mesh); M.mesh = mesh;
  if (s.edges) {
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 10), new THREE.LineBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: s.color === 'image' ? 0.22 : 0.35 }));
    M.scene.add(edges); M.edges = edges;
  }
  // base plate under the model, like a physical model's board
  const W = C.W, depth = C.back;
  const base = new THREE.Mesh(new THREE.BoxGeometry(W.cols + 4, 0.6, depth + 4), new THREE.MeshStandardMaterial({ color: 0xe4dfd9, roughness: 1 }));
  base.position.set(W.cols / 2, -0.3, -depth / 2 + 1); base.receiveShadow = s.shadows; M.scene.add(base); M.base = base;
  // 9 × 3 m module grid on the front plane, at the offset the analyzer fitted
  if (s.moduleGrid && C.F) {
    const F = C.F, E = F.envelope, Mo = F.modules, pts = [];
    const cx0 = Mo.mo - W.c0, cx1 = cx0 + Mo.nm * 9, cy0 = E.r0 - W.r0, cy1 = cy0 + Mo.nf * 3, z = 0.08;
    for (let m = 0; m <= Mo.nm; m++) pts.push(cx0 + m * 9, cy0, z, cx0 + m * 9, cy1, z);
    for (let f = 0; f <= Mo.nf; f++) pts.push(cx0, cy0 + f * 3, z, cx1, cy0 + f * 3, z);
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const grid = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.85 }));
    M.scene.add(grid); M.grid = grid;
  }
  M.bbox = new THREE.Box3(new THREE.Vector3(0, 0, -depth), new THREE.Vector3(W.cols, W.rows, 0));
  // light and shadow camera follow the model
  const ctr = M.bbox.getCenter(new THREE.Vector3()), span = Math.max(W.cols, W.rows, depth);
  M.light.position.copy(ctr).add(new THREE.Vector3(-0.55, 1, 0.75).multiplyScalar(span * 1.6)); M.light.target.position.copy(ctr);
  const sc = M.light.shadow.camera; sc.left = sc.bottom = -span * 0.9; sc.right = sc.top = span * 0.9; sc.near = 1; sc.far = span * 5; sc.updateProjectionMatrix();
  M.light.castShadow = s.shadows;
  // sliders for the cuts
  const sx = $('#m3dSectionX', M.el), sy = $('#m3dPlanY', M.el);
  sx.max = W.cols; sy.max = W.rows;
  if (+sx.value > W.cols || sx.dataset.fresh !== '0') { sx.value = Math.round(W.cols / 2); sx.dataset.fresh = '0'; }
  if (+sy.value > W.rows || sy.dataset.fresh !== '0') { sy.value = Math.round(W.rows / 2); sy.dataset.fresh = '0'; }
  s.sectionX = +sx.value; s.planY = +sy.value;
  applyClipping();
  // stats
  const cubes = C.cells.reduce((a, k) => a + (k.z1 - k.z0), 0);
  const tris = geo.index.count / 3;
  stats.textContent = `${W.cols} × ${W.rows} m face · ${Math.round(depth)} m deep · ${C.cells.length.toLocaleString('en-US')} built cells ≈ ${Math.round(cubes).toLocaleString('en-US')} m³ · ${tris.toLocaleString('en-US')} triangles`;
  info.textContent = 'Click a cell for its reading.';
  if (!M.fitted || M.lastKey !== `${W.cols}x${W.rows}`) { view('iso'); M.fitted = true; M.lastKey = `${W.cols}x${W.rows}`; }
  renderLegend();
}

function applyClipping() {
  const s = M.settings, planes = [];
  if (!M.cells) return;
  const W = M.cells.W, depth = M.cells.back;
  if (s.section) {
    planes.push(s.sectionFlip ? new THREE.Plane(new THREE.Vector3(1, 0, 0), -s.sectionX) : new THREE.Plane(new THREE.Vector3(-1, 0, 0), s.sectionX));
    const p = M.planes.section; p.visible = true; p.geometry.dispose(); p.geometry = new THREE.PlaneGeometry(depth + 2, W.rows + 2);
    p.rotation.set(0, Math.PI / 2, 0); p.position.set(s.sectionX, W.rows / 2, -depth / 2 + 0.5);
  } else M.planes.section.visible = false;
  if (s.plan) {
    planes.push(s.planFlip ? new THREE.Plane(new THREE.Vector3(0, 1, 0), -s.planY) : new THREE.Plane(new THREE.Vector3(0, -1, 0), s.planY));
    const p = M.planes.plan; p.visible = true; p.geometry.dispose(); p.geometry = new THREE.PlaneGeometry(W.cols + 2, depth + 2);
    p.rotation.set(-Math.PI / 2, 0, 0); p.position.set(W.cols / 2, s.planY, -depth / 2 + 0.5);
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
  const dir = new THREE.Vector3(...(VIEW_DIRS[name] || VIEW_DIRS.iso)).normalize();
  const ctr = M.bbox.getCenter(new THREE.Vector3()), size = M.bbox.getSize(new THREE.Vector3());
  const radius = size.length() / 2, dist = radius / Math.sin(THREE.MathUtils.degToRad(M.camera.fov) / 2) * 1.08;
  M.camera.position.copy(ctr).add(dir.multiplyScalar(dist));
  M.camera.near = Math.max(0.1, dist / 100); M.camera.far = dist * 20; M.camera.updateProjectionMatrix();
  M.controls.target.copy(ctr); M.controls.update();
}

// ------------------------------------------------------------------ inspection
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pick(e) {
  if (!M.mesh || !M.cells) return;
  const r = M.renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, M.camera);
  const hit = ray.intersectObject(M.mesh, false)[0];
  const info = $('#m3dInfo', M.el);
  if (!hit) { info.textContent = 'Click a cell for its reading.'; return; }
  const k = M.cells.cells[M.mesh.geometry.userData.faceCell[hit.faceIndex]];
  const g = M.source.grid, t = g.tone ? g.tone[k.gr * g.cols + k.gc] : null;
  info.textContent = `Cell ${k.gc + 1} across, ${k.gr + 1} up · ${BAND_NAMES[k.band]}${t != null ? ` (tone ${t.toFixed(2)})` : ''} · front at ${k.z0.toFixed(1)} m, solid to ${k.z1.toFixed(1)} m · level ${k.level + 1}${k.cls ? ' · ' + CLASS_NAMES[k.cls] : ''}`;
}

// ------------------------------------------------------------------ exports
function download(blob, name) { const u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 2000); }
function baseName() { const n = (M.source && M.source.name || 'frame').replace(/[^\w.-]+/g, '_').slice(0, 60); return `ProtoSpace-${n}-${M.settings.scope === 'area' ? 'area' : 'frame'}-3D`; }
function snapshot() {
  if (!M.mesh) return;
  const r = M.renderer, w = r.domElement.clientWidth, h = r.domElement.clientHeight, dpr = r.getPixelRatio();
  r.setPixelRatio(Math.min(4, dpr * 2)); r.setSize(w, h, false); r.render(M.scene, M.camera);
  r.domElement.toBlob(b => { download(b, baseName() + '.png'); r.setPixelRatio(dpr); r.setSize(w, h, false); }, 'image/png');
}
function exportOBJ() {
  if (!M.mesh) return;
  const text = '# ProtoSpace Analyzer inferred frame model. Units: metres. X across, Y up, Z toward the viewer (front face at z = 0).\n# Depths are read from tone, then extruded by the chosen thickness: an interpretation, not recovered geometry.\n' + new OBJExporter().parse(M.mesh);
  download(new Blob([text], { type: 'text/plain' }), baseName() + '.obj');
}
function exportSTL() {
  if (!M.mesh) return;
  const data = new STLExporter().parse(M.mesh, { binary: true });
  download(new Blob([data], { type: 'model/stl' }), baseName() + '.stl');
}
function exportGLB() {
  if (!M.mesh) return;
  const group = new THREE.Group(); group.add(M.mesh.clone());
  new GLTFExporter().parse(group, result => download(new Blob([result], { type: 'model/gltf-binary' }), baseName() + '.glb'), err => { $('#m3dInfo', M.el).textContent = 'GLB export failed: ' + err.message; }, { binary: true });
}

// ------------------------------------------------------------------ UI
function renderLegend() {
  const el = $('#m3dLegend', M.el), s = M.settings, items = [];
  const sw = (hex, label) => `<li><span class="sw" style="background:#${hex.toString(16).padStart(6, '0')}"></span>${label}</li>`;
  if (s.color === 'bands') { if (s.depth === 'relief') items.push(sw(0x2a2a2a, 'front (0 m)'), sw(0x7e7e7e, 'about 13 m back'), sw(0xd2d2d2, '26 m back')); else BAND_GREYS.forEach((c, i) => items.push(sw(c, BAND_NAMES[i]))); }
  else if (s.color === 'class') [1, 2, 3, 4, 5, 6].forEach(k => items.push(sw(CLASS_COLORS[k], CLASS_NAMES[k])));
  else if (s.color === 'level') items.push(sw(LEVEL_COLORS[0], 'level 1, 4, 7 …'), sw(LEVEL_COLORS[1], 'level 2, 5, 8 …'), sw(LEVEL_COLORS[2], 'level 3, 6, 9 …'));
  else items.push('<li><span class="sw" style="background:linear-gradient(135deg,#111 0 50%,#ddd 50%)"></span>the frame’s own pixels, projected straight onto the relief</li>');
  if (s.moduleGrid) items.push(sw(ACCENT, '9 × 3 m module grid where the analyzer fitted it'));
  el.innerHTML = items.join('');
}

function wireControls(section) {
  const s = M.settings;
  const on = (id, ev, fn) => $('#' + id, section).addEventListener(ev, fn);
  on('m3dScopeFrame', 'click', () => setScope('frame'));
  on('m3dScopeArea', 'click', () => { if (M.source && M.source.area) setScope('area'); });
  on('m3dDepth', 'change', e => { s.depth = e.target.value; rebuild(); });
  on('m3dSolid', 'change', e => { s.solid = e.target.value; rebuild(); });
  on('m3dThickness', 'input', e => { s.thickness = +e.target.value; $('#m3dThicknessValue', section).textContent = s.thickness + ' m'; rebuild(); });
  on('m3dColor', 'change', e => { s.color = e.target.value; rebuild(); });
  on('m3dEdges', 'change', e => { s.edges = e.target.checked; rebuild(); });
  on('m3dModuleGrid', 'change', e => { s.moduleGrid = e.target.checked; rebuild(); });
  on('m3dShadows', 'change', e => { s.shadows = e.target.checked; rebuild(); });
  on('m3dTurntable', 'change', e => { s.turntable = e.target.checked; M.controls.autoRotate = s.turntable; });
  on('m3dSection', 'change', e => { s.section = e.target.checked; applyClipping(); });
  on('m3dSectionX', 'input', e => { s.sectionX = +e.target.value; applyClipping(); });
  on('m3dSectionFlip', 'click', () => { s.sectionFlip = !s.sectionFlip; applyClipping(); });
  on('m3dPlan', 'change', e => { s.plan = e.target.checked; applyClipping(); });
  on('m3dPlanY', 'input', e => { s.planY = +e.target.value; applyClipping(); });
  on('m3dPlanFlip', 'click', () => { s.planFlip = !s.planFlip; applyClipping(); });
  section.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => view(b.dataset.view)));
  on('m3dSnapshot', 'click', snapshot);
  on('m3dExportOBJ', 'click', exportOBJ);
  on('m3dExportSTL', 'click', exportSTL);
  on('m3dExportGLB', 'click', exportGLB);
  // reflect defaults
  $('#m3dDepth', section).value = s.depth; $('#m3dSolid', section).value = s.solid; $('#m3dColor', section).value = s.color;
  $('#m3dThickness', section).value = s.thickness; $('#m3dThicknessValue', section).textContent = s.thickness + ' m';
  $('#m3dEdges', section).checked = s.edges; $('#m3dModuleGrid', section).checked = s.moduleGrid; $('#m3dShadows', section).checked = s.shadows;
}

/* Used by the spatial study: "Model this area in 3D" sets the scope, and the study's cut slider
   drives the section plane while the area is being modelled. */
function setSectionFromStudy(x, enable) {
  const s = M.settings; s.sectionX = clamp(Math.round(x), 0, +$('#m3dSectionX', M.el).max || x);
  $('#m3dSectionX', M.el).value = s.sectionX;
  if (enable != null) { s.section = enable; $('#m3dSection', M.el).checked = enable; }
  applyClipping();
}

window.PSModel3D = { init, setSource, setArea, setScope, view, rebuild, snapshot, exportOBJ, exportSTL, exportGLB, setSectionFromStudy, get ready() { return M.ready; }, settings: M.settings };
const section = document.getElementById('model3d');
if (section) init(section);

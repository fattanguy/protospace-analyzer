/* ProtoSpace Analyzer — the Assemble tab: the fifteen spaces (and any tile sent over from the Explorer) as modules of
   an office for Valve on the One Herald Plaza lot, laid out with a sliding-tile plan game and built in 3D.

   The site: 100 × 250 m, long side north–south, Biscayne Bay along the east edge, Herald Plaza and the street along
   the west, causeways north and south. The ground floods (Irma put ~1.5 m of surge in the streets), so the ground
   layer stands on pilotis 3 m up and the levels above hold the cabals; lobbies make the public edge on the west,
   offices the cabal floors, gathering spaces the rooms for the whole company; one red stair ties it all together.

   Plan game: the lot is a board of 7 × 3 slots (one module bay each, 31 × 31 m, with a 3 m seam between bays).
   Modules are tiles — their roof plans — that slide into empty slots; a tile can be turned; the board has three layers
   (ground, level 2, level 3). The 3D building follows the board, fused into one surface: across every seam the two
   neighbours morph into each other (js/fuse.js), a bridge is added only where floors meet but no mass does, windows
   are cut in the thin walls, a core rises wherever modules stack, and the red stair. Every module carries a callout of what it is and where
   it came from (animation, frame, bay — or the Explorer map and tile it was taken from).

   mount(root) → { show, addModule({ name, occ, N, note, use }) } ; the Explorer sends tiles with addModule. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { voxelize } from './voxelize.js';
import { organicGeometry } from './isosurface.js';
import { fusedGeometry, morphSeam } from './fuse.js';

const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ------------------------------------------------------------------ the site and the board
const N = 32, LAT = 31 / 30, SLOT_V = 30, GAP_V = 3, PITCH_V = 21, PODIUM_V = 3, MARGIN_V = 2;   // lattice · metres per voxel · bay, seam, layer pitch, pilotis, grid margin (voxels)
export const SITE = { length: 250, width: 100, cols: 7, rows: 3, slotX: SLOT_V * LAT, slotZ: SLOT_V * LAT, gapX: GAP_V * LAT, gapZ: GAP_V * LAT };   // x runs north → south, z runs west → east (negative)
SITE.boardX = SITE.cols * SITE.slotX + (SITE.cols - 1) * SITE.gapX; SITE.boardZ = SITE.rows * SITE.slotZ + (SITE.rows - 1) * SITE.gapZ;
SITE.x0 = (SITE.length - SITE.boardX) / 2; SITE.z0 = (SITE.width - SITE.boardZ) / 2;                                   // the board sits centred on the lot
const PODIUM = PODIUM_V * LAT, PITCH = PITCH_V * LAT, MOD_H = 19;                                                          // pilotis height · layer pitch · module height (m)
const LAYERS = ['Ground · on pilotis', 'Level 2', 'Level 3'];
const USE = { lobby: { name: 'Lobby', c: '#6d8f98' }, office: { name: 'Office', c: '#c0994f' }, social: { name: 'Gathering', c: '#b4584a' }, som: { name: 'Explorer tile', c: '#7b7aa3' } };
const slotOrigin = (c, r) => ({ x: SITE.x0 + c * (SITE.slotX + SITE.gapX), z: -(SITE.z0 + r * (SITE.slotZ + SITE.gapZ)) });   // the slot's north-west corner
const slotCentre = (c, r) => { const o = slotOrigin(c, r); return { x: o.x + SITE.slotX / 2, z: o.z - SITE.slotZ / 2 }; };
/* A module's lattice footprint turned on the board: (x, z) of the 32 × 32 lattice → (u, v), u along the lot (south = +u), v across it (east = +v). */
const latToSlot = (x, z, rot) => [[x, z], [N - 1 - z, x], [N - 1 - x, N - 1 - z], [z, N - 1 - x]][rot & 3];
// the building's voxel grid: the board plus a margin all round; grid (gx, gy, gz) ↔ world
const GX = 2 * MARGIN_V + SITE.cols * SLOT_V + (SITE.cols - 1) * GAP_V, GZ = 2 * MARGIN_V + SITE.rows * SLOT_V + (SITE.rows - 1) * GAP_V, GY = PODIUM_V + 3 * PITCH_V + 2;
const gridX = gx => SITE.x0 + (gx - MARGIN_V + 0.5) * LAT, gridY = gy => (gy + 0.5) * LAT, gridZ = gz => -(SITE.z0 + (gz - MARGIN_V + 0.5) * LAT);   // voxel centres
const gridBase = (c, r, L) => ({ gx0: MARGIN_V + c * (SLOT_V + GAP_V), gz0: MARGIN_V + r * (SLOT_V + GAP_V), gy0: PODIUM_V + L * PITCH_V - 1 });   // lattice (u, v, y) → (gx0 + u − 1, gy0 + y, gz0 + v − 1)

const A = {
  modules: [], boards: [[], [], []], layer: 0, sel: null, pick: null, custom: 0,
  three: null, ready: false, pairs: null, uid: 0, history: [], future: [], hover: null, opts: { fuse: true, bridges: true, walls: false, windows: true, cores: true, labels: true },
};
for (let L = 0; L < 3; L++) A.boards[L] = Array.from({ length: SITE.cols * SITE.rows }, () => null);   // { mod, rot }
let R = {};

// ------------------------------------------------------------------ modules: geometry in metres, voxels for plans, floors and windows
function analyse(occ, n) {                                                       // floors, roof heights, edge ports and window panels of a voxel solid
  const at = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < n && y < n && z < n && occ[x + n * (y + n * z)];
  const roof = new Int8Array(n * n).fill(-1), floors = [];                          // roof[x + n z] = top voxel; floors = [x, y, z] standable cells
  let xmin = n, xmax = 0, zmin = n, zmax = 0, ymin = n, ymax = 0, cells = 0;
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (at(x, y, z)) { cells++; if (y > roof[x + n * z]) roof[x + n * z] = y; if (x < xmin) xmin = x; if (x > xmax) xmax = x; if (z < zmin) zmin = z; if (z > zmax) zmax = z; if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
    else if (y > 0 && at(x, y - 1, z) && !at(x, y + 1, z) && !at(x, y + 2, z)) floors.push([x, y, z]);
  }
  // ports: floor cells within three voxels of each side of the solid, per level: side → { level: [along-coordinates] }
  const ports = { px: {}, nx: {}, pz: {}, nz: {} };
  for (const [x, y, z] of floors) {
    if (x >= xmax - 2) (ports.px[y] ||= []).push(z); if (x <= xmin + 2) (ports.nx[y] ||= []).push(z);
    if (z >= zmax - 2) (ports.pz[y] ||= []).push(x); if (z <= zmin + 2) (ports.nz[y] ||= []).push(x);
  }
  // windows: exterior faces of thin walls (air outside for two voxels, air within two voxels behind, a wall not a slab),
  // kept only at the two voxel rows that fall mid-floor (so they read as strip windows, one band per storey)
  const panels = [];
  for (let z = 0; z < n; z++) for (let y = 1; y < n; y++) for (let x = 0; x < n; x++) {
    if (!at(x, y, z) || !(at(x, y + 1, z) || at(x, y - 1, z))) continue;
    if (!(at(x, y + 1, z) && at(x, y - 1, z))) continue;                            // a wall voxel with wall above and below (not a slab edge)
    if ((y % 3) !== 1) continue;                                                     // one band per 3 m storey
    for (const [dx, dz, side] of [[1, 0, 'px'], [-1, 0, 'nx'], [0, 1, 'pz'], [0, -1, 'nz']]) {
      if (at(x + dx, y, z + dz) || at(x + 2 * dx, y, z + 2 * dz)) continue;
      if (at(x - dx, y, z - dz) && at(x - 2 * dx, y, z - 2 * dz)) continue;
      panels.push([x, y, z, side]);
    }
  }
  return { roof, floors, ports, panels, bounds: { xmin, xmax, zmin, zmax, ymin, ymax }, cells };
}
async function loadBuiltins() {
  const index = await (await fetch('assets/spaces/index.json')).json(), loader = new GLTFLoader();
  for (const it of index) {
    const gl = await loader.loadAsync(it.file), tris = [], v = new THREE.Vector3();
    gl.scene.updateMatrixWorld(true); gl.scene.traverse(o => { if (!o.isMesh) return; const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry, p = g.getAttribute('position'); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); tris.push(v.x, v.y, v.z); } });
    const T = new Float32Array(tris), vx = voxelize(T, N);
    let geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(T, 3)); geo = mergeVertices(geo, 1e-3); geo.computeVertexNormals(); geo.computeBoundingBox();
    const m = { id: it.id, name: it.name, use: it.cat, typology: it.typology, note: `${it.anim} · frame ${it.frame} · bay ${it.bay} · ${USE[it.cat].name} ${it.score}/100 · ${it.rating}`, source: 'catalogue', geo, occ: vx.occ, fit: vx.fit, an: analyse(vx.occ, N), plans: {} };
    A.modules.push(m);
  }
}
/* A tile from the Explorer (voxels in its lattice) as a module: an organic surface in metres, like the catalogue ones. */
export function addModule({ name, occ, N: n = N, note = '', use = 'som' }) {
  const g = organicGeometry(occ, n); g.scale(LAT, LAT, LAT); g.computeBoundingBox();
  const b = g.boundingBox, shift = [-b.min.x, -b.min.y, -b.max.z]; g.translate(...shift); g.computeBoundingBox();
  const id = `X${++A.custom}`;
  const m = { id, name: name || `Explorer tile ${A.custom}`, use, typology: 'from the map', note, source: 'explorer', geo: g, occ, fit: null, shift, an: analyse(occ, n), plans: {} };
  A.modules.push(m); renderPalette(); return m;
}
/* The module's plan picture (its roof plan, with the ground-floor rooms marked), for a rotation, as a canvas. */
function planOf(m, rot) {
  if (m.plans[rot]) return m.plans[rot];
  const S = 120, c = document.createElement('canvas'); c.width = S; c.height = S; const g = c.getContext('2d');
  const { roof, floors } = m.an, col = USE[m.use] ? USE[m.use].c : '#888';
  const n = N, cell = S / n;
  // lattice (x across, z deep: z = 0 at the front) → tile pixels with the rotation; north is up on the tile
  const map = (x, z) => { const p = latToSlot(x, z, rot); return [p[0] * cell, p[1] * cell]; };
  g.fillStyle = '#0a0a0a'; g.fillRect(0, 0, S, S);
  let top = 1; for (let i = 0; i < roof.length; i++) if (roof[i] > top) top = roof[i];
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    const h = roof[x + n * z]; if (h < 0) continue;
    const [px, py] = map(x, z), t = 0.35 + 0.65 * (h / top);
    g.fillStyle = shade(col, t); g.fillRect(px, py, cell + 0.5, cell + 0.5);
  }
  g.fillStyle = 'rgba(255,255,255,0.55)';
  for (const [x, y, z] of floors) if (y <= 2) { const [px, py] = map(x, z); g.fillRect(px + cell * 0.3, py + cell * 0.3, cell * 0.4, cell * 0.4); }
  m.plans[rot] = c; return c;
}
function shade(hex, t) { const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16); return `rgb(${Math.round(r * t)},${Math.round(g * t)},${Math.round(b * t)})`; }

// ------------------------------------------------------------------ the board (the plan game)
const idx = (c, r) => c + SITE.cols * r;
function cellOf(k) { return [k % SITE.cols, (k / SITE.cols) | 0]; }
function place(L, k, mod, rot = 1) { A.boards[L][k] = { mod, rot, uid: ++A.uid }; }
function clearLayer(L) { A.boards[L] = A.boards[L].map(() => null); }
function moveTile(L, from, to) { const b = A.boards[L]; if (b[to]) [b[from], b[to]] = [b[to], b[from]]; else { b[to] = b[from]; b[from] = null; } }
function adjacent(a, b) { const [ca, ra] = cellOf(a), [cb, rb] = cellOf(b); return Math.abs(ca - cb) + Math.abs(ra - rb) === 1; }

/* A sensible start, by the brief: lobbies as the public edge along the street (west row) at ground, gathering in the
   middle of the ground floor, the cabal floors above with a gathering room in the middle of each; the seed varies it. */
function autoArrange(seed = Date.now() % 1000) {
  let sd = (seed * 9301 + 49297) % 233280; const rnd = () => (sd = (sd * 9301 + 49297) % 233280) / 233280;
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const by = u => A.modules.filter(m => m.use === u), L = by('lobby'), O = by('office'), G = by('social'), X = by('som');
  for (let i = 0; i < 3; i++) clearLayer(i);
  const rot = () => (rnd() < 0.75 ? 1 : 3);
  // a compact block in the middle of the lot, every module touching a neighbour: the lobbies in a row along the street,
  // the gathering rooms behind them, the cabal floors stacked on top with a gathering room among them
  const c0 = 1 + Math.floor(rnd() * 1.999);                                           // the block starts at bay B or C
  const lob = shuffle(L.slice()); lob.forEach((m, i) => { if (c0 + i < SITE.cols) place(0, idx(c0 + i, 0), m, rot()); });
  const gat = shuffle(G.slice());
  [1, 2, 3].forEach((dc, i) => { if (gat[i] && c0 + dc < SITE.cols) place(0, idx(c0 + dc, 1), gat[i], rot()); });
  const ground = A.boards[0].map((t, k) => t ? k : -1).filter(k => k >= 0), offices = shuffle(O.concat(X).slice());
  const over = ground.slice(); offices.forEach((m, i) => { if (over[i] != null) place(1, over[i], m, rot()); });
  if (gat[3] && over[offices.length] != null) place(1, over[offices.length], gat[3], rot());
  const level2 = A.boards[1].map((t, k) => t ? k : -1).filter(k => k >= 0), over3 = level2.filter(k => cellOf(k)[0] >= c0 + 1 && cellOf(k)[0] <= c0 + 3);
  shuffle(O.slice()).slice(0, 3).forEach((m, i) => { if (over3[i] != null) place(2, over3[i], m, rot()); });
  if (gat[4] && over3[3] != null) place(2, over3[3], gat[4], rot());
  A.sel = null; renderBoard(); build();
}
/* All fifteen catalogue modules on one floor: the other layers are emptied and the ground floor gets a 5 × 3 block centred on
   the lot — the lobbies along the street row, the gathering rooms in the middle, the offices on the bay side — with the
   end bays empty, so there is room to slide. */
function fillFloor(L = 0) {
  const by = u => A.modules.filter(m => m.use === u), rows = [by('lobby'), by('social'), by('office')];
  for (let i = 0; i < 3; i++) clearLayer(i); A.layer = L;
  rows.forEach((ms, r) => { const c0 = Math.max(0, Math.floor((SITE.cols - ms.length) / 2)); ms.forEach((m, i) => { if (c0 + i < SITE.cols) place(L, idx(c0 + i, r), m, 1); }); });
  A.sel = null; renderBoard(); build();
}

// ------------------------------------------------------------------ connections: bridges, walls, cores
/* The module's lattice side facing a world direction, given its quarter turns. Lattice: +x, −x across; z = 0 front,
   z = n back. The mesh's local z is −lattice z. At rot 0 local +x → world +x (south), local −z (front) → world −z (east). */
const FACE = { 0: { S: 'px', N: 'nx', E: 'pz', W: 'nz' }, 1: { E: 'px', W: 'nx', S: 'nz', N: 'pz' }, 2: { N: 'px', S: 'nx', W: 'pz', E: 'nz' }, 3: { W: 'px', E: 'nx', N: 'nz', S: 'pz' } };
function connections(L) {
  const b = A.boards[L], out = [];
  for (let r = 0; r < SITE.rows; r++) for (let c = 0; c < SITE.cols; c++) {
    const k = idx(c, r), t = b[k]; if (!t) continue;
    for (const [dc, dr, dirA, dirB] of [[1, 0, 'S', 'N'], [0, 1, 'E', 'W']]) {
      const c2 = c + dc, r2 = r + dr; if (c2 >= SITE.cols || r2 >= SITE.rows) continue;
      const t2 = b[idx(c2, r2)]; if (!t2) continue;
      const pa = t.mod.an.ports[FACE[t.rot][dirA]], pb = t2.mod.an.ports[FACE[t2.rot][dirB]];
      const levels = [];
      for (const ya of Object.keys(pa)) for (const yb of Object.keys(pb)) if (Math.abs(ya - yb) <= 1) levels.push({ y: (+ya + +yb) / 2, na: pa[ya].length, nb: pb[yb].length });
      levels.sort((u, v) => v.na + v.nb - u.na - u.nb);
      const picked = []; for (const l of levels) { if (picked.some(p => Math.abs(p.y - l.y) < 3)) continue; picked.push(l); if (picked.length === 2) break; }
      out.push({ L, a: k, b: idx(c2, r2), axis: dc ? 'x' : 'z', levels: picked.sort((u, v) => u.y - v.y) });
    }
  }
  return out;
}
function stacks() {                                                               // slots with modules on more than one layer, or any above ground
  const out = [];
  for (let k = 0; k < SITE.cols * SITE.rows; k++) { const ls = [0, 1, 2].filter(L => A.boards[L][k]); if (ls.length > 1 || (ls.length === 1 && ls[0] > 0)) out.push({ k, top: Math.max(...ls) }); }
  return out;
}
function pairsOf(L) {                                                             // neighbour pairs on a layer, with whether they are joined
  if (A.pairs) return A.pairs.filter(p => p.L === L);
  return connections(L).map(cn => ({ ...cn, joined: A.opts.bridges && cn.levels.length > 0, through: false }));
}
function connectedGroups() {                                                      // modules joined by seams, bridges and stacking (through a core)
  const nodes = [], id = new Map();
  for (let L = 0; L < 3; L++) A.boards[L].forEach((t, k) => { if (t) { id.set(`${L}:${k}`, nodes.length); nodes.push(`${L}:${k}`); } });
  const parent = nodes.map((_, i) => i), find = i => parent[i] === i ? i : (parent[i] = find(parent[i])), union = (a, b) => { parent[find(a)] = find(b); };
  for (let L = 0; L < 3; L++) for (const pr of pairsOf(L)) if (pr.joined) union(id.get(`${L}:${pr.a}`), id.get(`${L}:${pr.b}`));
  for (const s of stacks()) { const ls = [0, 1, 2].filter(L => A.boards[L][s.k]); for (let i = 1; i < ls.length; i++) union(id.get(`${ls[0]}:${s.k}`), id.get(`${ls[i]}:${s.k}`)); }
  const groups = new Set(nodes.map((_, i) => find(i))); return { modules: nodes.length, groups: groups.size };
}

// ------------------------------------------------------------------ the 3D building
function initThree(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.5, 4000); camera.position.set(SITE.length + 110, 70, 140);
  const controls = new OrbitControls(camera, canvas); controls.target.set(SITE.length / 2, 18, -SITE.width / 2 + 10); controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxPolarAngle = Math.PI / 2 - 0.02;
  const hemi = new THREE.HemisphereLight(0xffffff, 0x4a4a4a, 0.9); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.0); sun.position.set(-150, 220, 160); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -220; sc.right = 220; sc.top = 220; sc.bottom = -220; sc.near = 10; sc.far = 800; sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.3; sun.target.position.set(SITE.length / 2, 0, -SITE.width / 2); scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35); fill.position.set(200, 80, -200); scene.add(fill);
  // the site: the lot, the bay to the east, the street and plaza to the west, the causeways north and south
  const site = new THREE.Group(); scene.add(site);
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0, ...extra });
  const plane = (w, d, color, x, z, y = 0, extra = {}) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(color, extra)); p.rotation.x = -Math.PI / 2; p.position.set(x, y, z); p.receiveShadow = true; site.add(p); return p; };
  plane(SITE.length, SITE.width, 0xdcd8d0, SITE.length / 2, -SITE.width / 2, 0.02);                        // the lot
  plane(SITE.length + 400, 400, 0x9db4c0, SITE.length / 2, -SITE.width - 200, -0.3, { roughness: 0.25, metalness: 0.05 });   // Biscayne Bay
  plane(SITE.length + 400, 60, 0xb9b9b9, SITE.length / 2, 30, -0.05);                                      // Herald Plaza / the street
  plane(SITE.length + 400, 400, 0xc9c5bd, SITE.length / 2, 260, -0.1);                                    // the city behind
  plane(60, SITE.width + 60, 0xb9b9b9, -30, -SITE.width / 2, -0.05); plane(60, SITE.width + 60, 0xb9b9b9, SITE.length + 30, -SITE.width / 2, -0.05);   // causeways
  const building = new THREE.Group(); scene.add(building);
  const labels = new THREE.Group(); scene.add(labels);
  A.three = { renderer, scene, camera, controls, building, labels, canvas };
  const resize = () => { const w = canvas.clientWidth || 800, h = canvas.clientHeight || 500; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  resize(); window.addEventListener('resize', resize);
  (function loop() { requestAnimationFrame(loop); if (canvas.isConnected && !R.root.closest('.tab')?.hidden) { controls.update(); renderer.render(scene, camera); } })();
}
const MATS = {};
function matFor(use) { if (!MATS[use]) { const c = new THREE.Color(0xe9e5de).lerp(new THREE.Color(USE[use] ? USE[use].c : '#888'), 0.22); MATS[use] = new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }); } return MATS[use]; }
const GLASS = new THREE.MeshPhysicalMaterial({ color: 0x9fc3d6, roughness: 0.15, metalness: 0, transmission: 0.55, transparent: true, opacity: 0.75, side: THREE.DoubleSide });
const FRAME = new THREE.MeshStandardMaterial({ color: 0x2e2e2e, roughness: 0.6 });
const SLAB = new THREE.MeshStandardMaterial({ color: 0xbdb7ae, roughness: 0.95 });
const RED = new THREE.MeshStandardMaterial({ color: 0xc62828, roughness: 0.7 });
const CORE = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.85 });
const COLUMN = new THREE.MeshStandardMaterial({ color: 0xcfcac2, roughness: 0.9 });
const WINDOW = new THREE.MeshStandardMaterial({ color: 0x16222a, roughness: 0.15, metalness: 0.4, emissive: 0x1a2c38, emissiveIntensity: 0.5, side: THREE.DoubleSide });

/* The transform that puts a module's local frame (x 0…27, y 0…19, z −31…0) into its slot at a layer with a rotation. */
function placement(k, L, rot, geo) {
  const [c, r] = cellOf(k), ctr = slotCentre(c, r), y = PODIUM + L * PITCH;
  const m = new THREE.Matrix4().makeRotationY(rot * Math.PI / 2);
  const bb = geo.boundingBox.clone().applyMatrix4(m), cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
  return new THREE.Matrix4().makeTranslation(ctr.x - cx, y - bb.min.y, ctr.z - cz).multiply(m);
}
function latticeToLocal(m, x, y, z) {                                             // a lattice voxel centre → the module's local metres
  if (m.fit) { const { min, scale, off } = m.fit; return [(x + 0.5 - off[0]) / scale + min[0], (y + 0.5 - off[1]) / scale + min[1], (N - z - 0.5 - off[2]) / scale + min[2]]; }
  return [(x + 0.5) * LAT + m.shift[0], (y + 0.5) * LAT + m.shift[1], -(z + 0.5) * LAT + m.shift[2]];
}
const FUSED = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
function tintOf(use) { return '#' + new THREE.Color(0xece8e1).lerp(new THREE.Color(USE[use] ? USE[use].c : '#888'), 0.5).getHexString(); }
function clearBuilding() {
  const { building, labels } = A.three;
  for (const g of [building, labels]) while (g.children.length) { const o = g.children.pop(); o.traverse?.(c => { if (c.geometry && !c.userData.shared) c.geometry.dispose(); }); }
}
/* Columns, deck and letter for a placed module — the parts both building modes share. */
function furnish(t, k, L, tag, building, labels) {
  const [c, r] = cellOf(k);
  if (L === 0) {                                                                  // pilotis under the ground layer: columns on a 6 m grid, and a deck
    const o = slotOrigin(c, r), cols = [];
    for (let x = 3; x < SITE.slotX; x += 6.2) for (let z = 3; z < SITE.slotZ; z += 6) cols.push([o.x + x, o.z - z]);
    const geo = new THREE.CylinderGeometry(0.35, 0.35, PODIUM + 0.6, 12), inst = new THREE.InstancedMesh(geo, COLUMN, cols.length), tmp = new THREE.Object3D();
    cols.forEach(([x, z], i) => { tmp.position.set(x, (PODIUM + 0.6) / 2 - 0.3, z); tmp.updateMatrix(); inst.setMatrixAt(i, tmp.matrix); });
    inst.castShadow = true; building.add(inst);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(SITE.slotX + SITE.gapX, 0.5, SITE.slotZ + SITE.gapZ), SLAB); deck.position.set(o.x + SITE.slotX / 2, PODIUM - 0.25, o.z - SITE.slotZ / 2); deck.receiveShadow = deck.castShadow = true; building.add(deck);
  }
  if (A.opts.labels) labels.add(label(tag, slotCentre(c, r).x, PODIUM + L * PITCH + MOD_H + 4, slotCentre(c, r).z, USE[t.mod.use] ? USE[t.mod.use].c : '#888'));
}
function cores(building) {                                                        // wherever modules stack, a stair-and-lift tower at the slot's north-west corner; the first is the red stair
  if (!A.opts.cores) return;
  stacks().forEach((s, i) => {
    const [c, r] = cellOf(s.k), ctr = slotCentre(c, r), h = PODIUM + s.top * PITCH + MOD_H * 0.8;   // inside the body, at the centre of the stack
    const core = new THREE.Mesh(new THREE.BoxGeometry(6, h, 5), i === 0 ? RED : CORE); core.position.set(ctr.x - 6, h / 2, ctr.z + 5); core.castShadow = core.receiveShadow = true; building.add(core);
    if (i === 0) { const cap = new THREE.Mesh(new THREE.BoxGeometry(7, 0.4, 6), RED); cap.position.set(ctr.x - 6, h + 0.2, ctr.z + 5); building.add(cap); }
  });
}
const WDIR = { S: [1, 0, 0, Math.PI / 2], N: [-1, 0, 0, -Math.PI / 2], E: [0, 0, -1, Math.PI], W: [0, 0, 1, 0] };   // world direction → offset and plane rotation
function build() {
  if (!A.three) return;
  clearTimeout(A.buildTimer); if (R.stats) R.stats.classList.add('busy');
  A.buildTimer = setTimeout(() => { const t0 = performance.now(); if (A.opts.fuse) buildFused(); else buildSeparate(); A.buildMs = Math.round(performance.now() - t0); renderCallouts(); renderBoard(false); applyHighlight(); R.stats.classList.remove('busy'); }, 30);
}
/* One building: every module stamped into the grid, every seam morphed, one surface. */
function buildFused() {
  const { building, labels } = A.three; clearBuilding();
  // the grid is cropped to the placed modules plus a margin (the whole board would be 1.6 M voxels; this is a fraction)
  let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, minZ = 1e9, maxZ = -1;
  for (let L = 0; L < 3; L++) A.boards[L].forEach((t, k) => {
    if (!t) return;
    const [c, r] = cellOf(k), { gx0, gy0, gz0 } = gridBase(c, r, L), b = t.mod.an.bounds;
    for (const [x, z] of [[b.xmin, b.zmin], [b.xmax, b.zmin], [b.xmin, b.zmax], [b.xmax, b.zmax]]) { const [u, v] = latToSlot(x, z, t.rot); minX = Math.min(minX, gx0 + u - 1); maxX = Math.max(maxX, gx0 + u - 1); minZ = Math.min(minZ, gz0 + v - 1); maxZ = Math.max(maxZ, gz0 + v - 1); }
    minY = Math.min(minY, gy0 + b.ymin); maxY = Math.max(maxY, gy0 + b.ymax);
  });
  const OX = Math.max(0, minX - 2), OY = Math.max(0, minY - 2), OZ = Math.max(0, minZ - 2);
  const DX = maxX < 0 ? 1 : Math.min(GX, maxX + 3) - OX, DY = maxX < 0 ? 1 : Math.min(GY, maxY + 3) - OY, DZ = maxX < 0 ? 1 : Math.min(GZ, maxZ + 3) - OZ;
  const occ = new Uint8Array(DX * DY * DZ), lab = new Int16Array(DX * DY * DZ);
  const gid = (x, y, z) => x + DX * (y + DY * z);
  const placed = [], bySlot = {};                                                  // placements with their grid bounding boxes
  const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; let letter = 0; const callouts = [];
  for (let L = 0; L < 3; L++) A.boards[L].forEach((t, k) => {
    if (!t) return;
    const [c, r] = cellOf(k), { gx0, gy0, gz0 } = gridBase(c, r, L), pid = placed.length + 1, m = t.mod, n = N;
    const bb = { minX: 1e9, maxX: -1, minY: 1e9, maxY: -1, minZ: 1e9, maxZ: -1 };
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (!m.occ[x + n * (y + n * z)]) continue;
      const [u, v] = latToSlot(x, z, t.rot), gx = gx0 + u - 1 - OX, gy = gy0 + y - OY, gz = gz0 + v - 1 - OZ;
      if (gx < 0 || gy < 0 || gz < 0 || gx >= DX || gy >= DY || gz >= DZ) continue;
      const j = gid(gx, gy, gz); occ[j] = 1; lab[j] = pid;
      if (gx < bb.minX) bb.minX = gx; if (gx > bb.maxX) bb.maxX = gx; if (gy < bb.minY) bb.minY = gy; if (gy > bb.maxY) bb.maxY = gy; if (gz < bb.minZ) bb.minZ = gz; if (gz > bb.maxZ) bb.maxZ = gz;
    }
    const tag = LETTERS[letter++ % LETTERS.length];
    placed.push({ pid, t, k, L, c, r, bb, tag }); bySlot[`${L}:${k}`] = placed[placed.length - 1];
    callouts.push({ tag, L, c, r, t });
  });
  // the seams: along the lot, across it, and between stacked layers — each one a morph between the two sections
  const pairs = [], BIAS = 0.15;
  const seam = (P, Q, axis) => {
    const a = P.bb, b = Q.bb;
    const lo = k1 => Math.max(0, Math.min(a[k1], b[k1]) - 2), hi = (k2, lim) => Math.min(lim, Math.max(a[k2], b[k2]) + 3);
    if (axis === 0) return morphSeam(occ, lab, DX, DY, DZ, 0, a.maxX, b.minX, P.pid, Q.pid, lo('minY'), hi('maxY', DY), lo('minZ'), hi('maxZ', DZ), 3, BIAS);
    if (axis === 2) return morphSeam(occ, lab, DX, DY, DZ, 2, a.maxZ, b.minZ, P.pid, Q.pid, lo('minX'), hi('maxX', DX), lo('minY'), hi('maxY', DY), 3, BIAS);
    return morphSeam(occ, lab, DX, DY, DZ, 1, a.maxY, b.minY, P.pid, Q.pid, lo('minX'), hi('maxX', DX), lo('minZ'), hi('maxZ', DZ), 3, BIAS);
  };
  const cns = [0, 1, 2].map(L => connections(L));
  for (const P of placed) {
    if (P.bb.maxX < 0) continue;
    const east = bySlot[`${P.L}:${P.k + SITE.cols}`], south = P.c + 1 < SITE.cols ? bySlot[`${P.L}:${P.k + 1}`] : null, up = bySlot[`${P.L + 1}:${P.k}`];
    if (south && south.bb.maxX >= 0) { const cn = cns[P.L].find(x => x.a === P.k && x.b === P.k + 1); const through = seam(P, south, 0); pairs.push({ L: P.L, a: P.k, b: P.k + 1, axis: 'x', levels: cn ? cn.levels : [], through, joined: through }); }
    if (east && east.bb.maxX >= 0) { const cn = cns[P.L].find(x => x.a === P.k && x.b === P.k + SITE.cols); const through = seam(P, east, 2); pairs.push({ L: P.L, a: P.k, b: P.k + SITE.cols, axis: 'z', levels: cn ? cn.levels : [], through, joined: through }); }
    if (up && up.bb.maxX >= 0) seam(P, up, 1);
  }
  // bridges only where a seam did not join two neighbours but they share a floor height
  const links = [];
  for (const pr of pairs) {
    if (!pr.through && A.opts.bridges && pr.levels.length) {
      const [ca, ra] = cellOf(pr.a), [cb, rb] = cellOf(pr.b), A0 = slotOrigin(ca, ra), B0 = slotOrigin(cb, rb), y0 = PODIUM + pr.L * PITCH;
      if (pr.axis === 'x') pr.levels.forEach((lv, i) => bridge(building, A0.x + SITE.slotX - 1.5, B0.x + 1.5, y0 + lv.y * LAT, A0.z - SITE.slotZ / 2 + (i ? 6 : -4), 'x'));
      else pr.levels.forEach((lv, i) => bridge(building, A0.z - SITE.slotZ + 1.5, B0.z - 1.5, y0 + lv.y * LAT, A0.x + SITE.slotX / 2 + (i ? 6 : -4), 'z'));
      pr.joined = true;
    }
    links.push({ L: pr.L, through: pr.through, bridged: pr.joined && !pr.through });
  }
  A.pairs = pairs;
  // the surface
  if (placed.length) {
    const colorOf = pid => { const P = placed[pid - 1]; return P ? tintOf(P.t.mod.use) : '#e9e5de'; };
    const g = fusedGeometry(occ, lab, DX, DY, DZ, colorOf, 10);
    const P = g.getAttribute('position'), arr = P.array;
    for (let i = 0; i < P.count; i++) { arr[i * 3] = gridX(arr[i * 3] + OX); arr[i * 3 + 1] = gridY(arr[i * 3 + 1] + OY); arr[i * 3 + 2] = gridZ(arr[i * 3 + 2] + OZ); }
    P.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, FUSED); mesh.castShadow = mesh.receiveShadow = true; mesh.name = 'Valve HQ · fused'; building.add(mesh);
  }
  // windows, columns, decks, letters, cores
  for (const P of placed) {
    const { t, k, L, c, r } = P;
    if (A.opts.windows && t.mod.an.panels.length) {
      const { gx0, gy0, gz0 } = gridBase(c, r, L), inv = Object.fromEntries(Object.entries(FACE[t.rot]).map(([d, side]) => [side, d]));
      const geo = new THREE.PlaneGeometry(1.0 * LAT, 0.62 * LAT), inst = new THREE.InstancedMesh(geo, WINDOW, t.mod.an.panels.length), tmp = new THREE.Object3D();
      t.mod.an.panels.forEach(([x, y, z, side], i) => {
        const [u, v] = latToSlot(x, z, t.rot), d = WDIR[inv[side]];
        tmp.position.set(gridX(gx0 + u - 1) + d[0] * 0.66 * LAT, gridY(gy0 + y), gridZ(gz0 + v - 1) + d[2] * 0.66 * LAT); tmp.rotation.set(0, d[3], 0); tmp.updateMatrix(); inst.setMatrixAt(i, tmp.matrix);
      });
      inst.instanceMatrix.needsUpdate = true; building.add(inst);
    }
    furnish(t, k, L, P.tag, building, labels);
  }
  cores(building);
  A.three.callouts = callouts; A.three.links = links; A.three.placed = placed;
  applyHighlight();
}
/* The older building: every module its own mesh in its bay, bridges and garden walls between. */
function buildSeparate() {
  const { building, labels } = A.three; clearBuilding(); A.pairs = null;
  const callouts = [];
  let letter = 0; const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (let L = 0; L < 3; L++) A.boards[L].forEach((t, k) => {
    if (!t) return;
    const M = placement(k, L, t.rot, t.mod.geo);
    const mesh = new THREE.Mesh(t.mod.geo, matFor(t.mod.use)); mesh.applyMatrix4(M); mesh.castShadow = mesh.receiveShadow = true; mesh.userData.shared = true; mesh.name = `${t.mod.id} ${t.mod.name}`; building.add(mesh);
    const [c, r] = cellOf(k), tag = LETTERS[letter++ % LETTERS.length];
    callouts.push({ tag, L, c, r, t });
    if (A.opts.windows && t.mod.an.panels.length) {
      const geo = new THREE.PlaneGeometry(1.0 * LAT, 0.62 * LAT), inst = new THREE.InstancedMesh(geo, WINDOW, t.mod.an.panels.length), tmp = new THREE.Object3D();
      const rotFor = { px: [0, Math.PI / 2, 0], nx: [0, -Math.PI / 2, 0], pz: [0, Math.PI, 0], nz: [0, 0, 0] };
      t.mod.an.panels.forEach(([x, y, z, side], i) => {
        const [lx, ly, lz] = latticeToLocal(t.mod, x, y, z);
        const off = { px: [LAT * 0.52, 0, 0], nx: [-LAT * 0.52, 0, 0], pz: [0, 0, -LAT * 0.52], nz: [0, 0, LAT * 0.52] }[side];
        tmp.position.set(lx + off[0], ly, lz + off[2]); tmp.rotation.set(...rotFor[side]); tmp.updateMatrix(); inst.setMatrixAt(i, tmp.matrix);
      });
      inst.applyMatrix4(M); inst.instanceMatrix.needsUpdate = true; building.add(inst);
    }
    furnish(t, k, L, tag, building, labels);
  });
  const links = [];
  for (let L = 0; L < 3; L++) for (const cn of connections(L)) {
    const [ca, ra] = cellOf(cn.a), [cb, rb] = cellOf(cn.b), A0 = slotOrigin(ca, ra), B0 = slotOrigin(cb, rb), y0 = PODIUM + L * PITCH;
    if (cn.axis === 'x') {
      const x0 = A0.x + SITE.slotX, x1 = B0.x, zc = A0.z - SITE.slotZ / 2;
      if (A.opts.bridges && cn.levels.length) cn.levels.forEach((lv, i) => bridge(building, x0 - 1.5, x1 + 1.5, y0 + lv.y * LAT, zc + (i ? 6 : -4), 'x'));
      else if (A.opts.walls && L === 0) wall(building, x0, x1, y0, zc, 'x');
    } else {
      const z0 = A0.z - SITE.slotZ, z1 = B0.z, xc = A0.x + SITE.slotX / 2;
      if (A.opts.bridges && cn.levels.length) cn.levels.forEach((lv, i) => bridge(building, z0 + 1.5, z1 - 1.5, y0 + lv.y * LAT, xc + (i ? 6 : -4), 'z'));
      else if (A.opts.walls && L === 0) wall(building, z1, z0, y0, xc, 'z');
    }
    links.push({ L, through: false, bridged: A.opts.bridges && cn.levels.length > 0 });
  }
  cores(building);
  A.three.callouts = callouts; A.three.links = links; A.three.placed = null;
}
function bridge(group, a0, a1, y, across, axis) {                                 // a glazed link, 4 m wide, 3.3 m tall, from a0 to a1 along the axis
  const len = Math.abs(a1 - a0), mid = (a0 + a1) / 2, W = 4, H = 3.3;
  const parts = [[new THREE.BoxGeometry(len, 0.35, W), SLAB, 0.17], [new THREE.BoxGeometry(len, 0.25, W + 0.4), FRAME, H - 0.12], [new THREE.BoxGeometry(len, H - 0.6, 0.08), GLASS, H / 2, W / 2 - 0.1], [new THREE.BoxGeometry(len, H - 0.6, 0.08), GLASS, H / 2, -(W / 2 - 0.1)]];
  for (const [geo, mat, dy, dz = 0] of parts) {
    const m = new THREE.Mesh(geo, mat); if (axis === 'x') m.position.set(mid, y + dy, across + dz); else { m.rotation.y = Math.PI / 2; m.position.set(across + dz, y + dy, mid); }
    m.castShadow = mat !== GLASS; m.receiveShadow = true; group.add(m);
  }
}
function wall(group, a0, a1, y, across, axis) {                                   // a garden wall closing the gap at ground, with a door-sized gap left in it
  const len = Math.abs(a1 - a0), mid = (a0 + a1) / 2, h = 3.2;
  for (const dz of [-6, 6]) { const m = new THREE.Mesh(new THREE.BoxGeometry(len, h, 0.4), SLAB); if (axis === 'x') m.position.set(mid, y + h / 2, across + dz); else { m.rotation.y = Math.PI / 2; m.position.set(across + dz, y + h / 2, mid); } m.castShadow = m.receiveShadow = true; group.add(m); }
}
function label(text, x, y, z, color) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = color; g.beginPath(); g.roundRect(14, 14, 100, 100, 22); g.fill(); g.fillStyle = '#fff'; g.font = '600 64px Poppins, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 68);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false })); s.position.set(x, y, z); s.scale.set(6, 6, 1); return s;
}

/* Camera presets framed on the building: its bounding box (or the lot's middle when the board is empty). */
function setView(name) {
  const { camera, controls, building } = A.three, bb = new THREE.Box3();
  building.children.forEach(o => { if (o.isMesh || o.isInstancedMesh) bb.expandByObject(o); });
  if (bb.isEmpty()) bb.set(new THREE.Vector3(SITE.length / 2 - 60, 0, -SITE.width / 2 - 30), new THREE.Vector3(SITE.length / 2 + 60, 40, -SITE.width / 2 + 30));
  const c = bb.getCenter(new THREE.Vector3()), size = bb.getSize(new THREE.Vector3()), span = Math.max(size.x, size.z, size.y * 1.5), d = span * 1.3 + 50;
  const v = {
    street: [[c.x + d * 0.55, size.y * 0.9 + 22, c.z + d * 0.8], [c.x, size.y * 0.35, c.z]],            // from the street, south-west, looking at the bay
    bay: [[c.x - d * 0.55, size.y * 0.9 + 22, c.z - d * 0.8], [c.x, size.y * 0.35, c.z]],               // from the water, north-east
    aerial: [[c.x + d * 0.45, d * 0.95, c.z + d * 0.7], [c.x, 0, c.z]],
    plan: [[c.x, d * 1.4, c.z + 0.01], [c.x, 0, c.z]],
  }[name];
  camera.position.set(...v[0]); controls.target.set(...v[1]); controls.update();
}

// ------------------------------------------------------------------ the page
function renderPalette() {
  R.palette.innerHTML = A.modules.map(m => `<button type="button" class="as-pal${A.pick === m.id ? ' on' : ''}" data-pick="${m.id}" title="${esc(m.name)} · ${esc(m.note)}"><canvas width="120" height="120"></canvas><span><b style="color:${USE[m.use] ? USE[m.use].c : '#888'}">${esc(m.id)}</b>${esc(m.name)}</span></button>`).join('');
  $$('.as-pal canvas', R.palette).forEach((c, i) => c.getContext('2d').drawImage(planOf(A.modules[i], 1), 0, 0));
}
// ------------------------------------------------------------------ the game: history, sliding, dragging, hovering, scoring
function snapshot() { return A.boards.map(b => b.map(t => t ? { id: t.mod.id, rot: t.rot, uid: t.uid } : null)); }
function restore(snap) { snap.forEach((b, L) => b.forEach((t, k) => { const m = t && A.modules.find(x => x.id === t.id); A.boards[L][k] = m ? { mod: m, rot: t.rot, uid: t.uid } : null; })); }
function pushHistory() { A.history.push(snapshot()); if (A.history.length > 60) A.history.shift(); A.future = []; }
function undo() { if (!A.history.length) return; A.future.push(snapshot()); restore(A.history.pop()); A.sel = null; renderBoard(); build(); }
function redo() { if (!A.future.length) return; A.history.push(snapshot()); restore(A.future.pop()); A.sel = null; renderBoard(); build(); }
const neighboursOf = k => { const [c, r] = cellOf(k), out = []; for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const c2 = c + dc, r2 = r + dr; if (c2 >= 0 && r2 >= 0 && c2 < SITE.cols && r2 < SITE.rows) out.push(idx(c2, r2)); } return out; };
/* The classic move: a tile slides into the one empty bay beside it. Returns where it went, or −1. */
function slide(L, k) {
  const b = A.boards[L], empties = neighboursOf(k).filter(j => !b[j]); if (empties.length !== 1) return -1;
  pushHistory(); moveTile(L, k, empties[0]); return empties[0];
}
function scramble(L, n = 14) {                                                      // a run of random legal slides, one every quarter second
  if (A.scrambling) return; A.scrambling = true; pushHistory(); A.sel = null;
  const step = i => {
    const b = A.boards[L], movable = b.map((t, k) => t && neighboursOf(k).some(j => !b[j]) ? k : -1).filter(k => k >= 0);
    if (i >= n || !movable.length) { A.scrambling = false; build(); return; }
    const k = movable[Math.floor(Math.random() * movable.length)], empties = neighboursOf(k).filter(j => !b[j]);
    moveTile(L, k, empties[Math.floor(Math.random() * empties.length)]); renderBoard(); setTimeout(() => step(i + 1), 240);
  };
  step(0);
}
/* FLIP: tiles that moved glide from where they were to where they are. */
function rectsNow() { const m = new Map(); $$('.as-slot[data-uid]', R.board).forEach(el => m.set(el.dataset.uid, el.getBoundingClientRect())); return m; }
function glide(before) {
  $$('.as-slot[data-uid]', R.board).forEach(el => {
    const was = before.get(el.dataset.uid); if (!was) { el.classList.add('pop'); return; }
    const now = el.getBoundingClientRect(), dx = was.left - now.left, dy = was.top - now.top; if (!dx && !dy) return;
    el.style.transition = 'none'; el.style.transform = `translate(${dx}px, ${dy}px)`; el.style.zIndex = 3; el.getBoundingClientRect();
    el.style.transition = 'transform .34s cubic-bezier(.2, .8, .2, 1)'; el.style.transform = '';
    el.addEventListener('transitionend', () => { el.style.transition = ''; el.style.zIndex = ''; }, { once: true });
  });
}
function tileInfo(L, k) {                                                          // what a tile is and how it joins its neighbours, for the tooltip
  const t = A.boards[L][k]; if (!t) return '';
  const lines = [`<b>${esc(t.mod.id)} ${esc(t.mod.name)}</b> <small>· ${esc(t.mod.typology)} · turned ${t.rot * 90}°</small>`];
  const names = { S: 'south', N: 'north', E: 'east (bay side)', W: 'west (street side)' };
  for (const pr of pairsOf(L)) {
    if (pr.a !== k && pr.b !== k) continue; const other = A.boards[L][pr.a === k ? pr.b : pr.a]; if (!other) continue;
    const dir = pr.axis === 'x' ? (pr.a === k ? 'S' : 'N') : (pr.a === k ? 'E' : 'W');
    lines.push(pr.through ? `morphs into ${esc(other.mod.id)} ${esc(other.mod.name)} to the ${names[dir]}` : pr.joined ? `bridge to ${esc(other.mod.id)} ${esc(other.mod.name)} to the ${names[dir]} at ${pr.levels.map(l => Math.round(l.y * LAT) + ' m').join(', ')}` : `beside ${esc(other.mod.id)} to the ${names[dir]} — no floor meets, open seam`);
  }
  const below = L > 0 && A.boards[L - 1][k], above = L < 2 && A.boards[L + 1][k];
  if (below) lines.push(`stacked on ${esc(below.mod.id)} ${esc(below.mod.name)}`); else if (L > 0) lines.push('<i>nothing below — it floats; stack it on a module</i>');
  if (above) lines.push(`${esc(above.mod.id)} ${esc(above.mod.name)} stacked on top`);
  if (!lines.some((l, i) => i > 0 && !/float/.test(l))) lines.push('<i>no neighbours yet — slide it next to another module</i>');
  return lines.join('<br>');
}
function showTip(L, k, slot) {                                                      // under the tile (above it near the bottom of the window), never over its neighbours' row
  R.tip.innerHTML = tileInfo(L, k); R.tip.hidden = false;
  const r = R.tip.getBoundingClientRect(), s = slot.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
  R.tip.style.left = `${Math.max(8, Math.min(s.left, vw - r.width - 12))}px`;
  R.tip.style.top = `${s.bottom + 10 + r.height > vh - 8 ? s.top - r.height - 10 : s.bottom + 10}px`;
}
function hideTip() { R.tip.hidden = true; }
/* The building score: five things the brief asks for, each 0–100, and goals ticked when they are met. */
function score() {
  const mods = []; for (let L = 0; L < 3; L++) A.boards[L].forEach((t, k) => { if (t) mods.push({ t, k, L }); });
  if (!mods.length) return { total: 0, parts: [], goals: [] };
  const g = connectedGroups(), lob = mods.filter(m => m.t.mod.use === 'lobby'), off = mods.filter(m => m.t.mod.use === 'office'), gat = mods.filter(m => m.t.mod.use === 'social');
  const joined = 100 * (1 - (g.groups - 1) / Math.max(1, mods.length - 1));
  const street = lob.length ? 100 * lob.filter(m => m.L === 0 && cellOf(m.k)[1] === 0).length / lob.length : 100;
  const flood = off.length ? 100 * off.filter(m => m.L > 0).length / off.length : 100;
  const touching = m => { let n = 0; for (const j of neighboursOf(m.k)) if (A.boards[m.L][j]) n++; if (m.L > 0 && A.boards[m.L - 1][m.k]) n++; if (m.L < 2 && A.boards[m.L + 1][m.k]) n++; return n; };
  const shared = gat.length ? 100 * gat.filter(m => touching(m) >= 2).length / gat.length : 100;
  const floating = mods.filter(m => m.L > 0 && !A.boards[m.L - 1][m.k]).length, grounded = 100 * (1 - floating / mods.length);
  let seams = 0, faces = 0; for (const m of mods) { seams += touching(m); faces += m.L > 0 ? 5 : 4; }
  const compact = Math.min(100, 100 * seams / Math.max(1, faces) * 2.2);
  const parts = [['Joined', joined, 'one building, not separate pieces'], ['Street edge', street, 'lobbies in the west row, at ground'], ['Above the flood', flood, 'offices a level up'], ['Shared rooms', shared, 'each gathering room touching two or more modules'], ['Grounded', grounded, 'nothing floating'], ['Compact', compact, 'modules touching, not scattered']];
  const total = Math.round(parts.reduce((s, p) => s + p[1], 0) / parts.length);
  const goals = [['One connected building', g.groups === 1], ['Every lobby lines the street', lob.length > 0 && street === 100], ['No office on the flooding ground', off.length > 0 && flood === 100], ['Every gathering room is shared', gat.length > 0 && shared === 100], ['All fifteen modules placed', new Set(mods.map(m => m.t.mod.id)).size >= 15], ['Nothing floats', floating === 0]];
  return { total, parts, goals, floating };
}
function renderScore() {
  const sc = score();
  if (!sc.parts.length) { R.score.innerHTML = '<p class="hint">Place modules to start scoring the building.</p>'; return; }
  const done = sc.goals.filter(g => g[1]).length;
  R.score.innerHTML = `<div class="as-total"><b>${sc.total}</b><span>building<br>score</span></div>
    <div class="as-bars">${sc.parts.map(([n, v, h]) => `<div class="as-bar" title="${esc(h)}"><span>${n}</span><i><b style="width:${v.toFixed(0)}%"></b></i><em>${v.toFixed(0)}</em></div>`).join('')}</div>
    <div class="as-goals"><div class="eyebrow">Goals · ${done} of ${sc.goals.length}</div>${sc.goals.map(([n, ok]) => `<div class="${ok ? 'ok' : ''}"><i>${ok ? '✓' : '○'}</i>${n}</div>`).join('')}</div>`;
}
/* The selected (or hovered) module lit in the 3D view: its part of the fused body brightens, the rest dims a little. */
function applyHighlight() {
  const T = A.three; if (!T || !T.building) return;
  const mesh = T.building.children.find(o => o.name === 'Valve HQ · fused'); if (!mesh) return;
  const g = mesh.geometry, labels = g.userData.labels, base = g.userData.baseColor, col = g.getAttribute('color'); if (!labels) return;
  const want = A.hover || (A.sel != null ? `${A.layer}:${A.sel}` : null), P = want && (T.placed || []).find(p => `${p.L}:${p.k}` === want), pid = P ? P.pid : 0;
  const arr = col.array;
  for (let v = 0, n = labels.length; v < n; v++) {
    const hit = labels[v] === pid, f = pid ? (hit ? 1.0 : 0.72) : 1.0, lift = pid && hit ? 0.35 : 0;
    for (let c = 0; c < 3; c++) { const b = base[v * 3 + c]; arr[v * 3 + c] = b * f + lift * (1 - b); }
  }
  col.needsUpdate = true;
}
function focusOn(L, k) {                                                            // the camera target glides to the module
  const T = A.three; if (!T) return; const [c, r] = cellOf(k), ctr = slotCentre(c, r), to = new THREE.Vector3(ctr.x, PODIUM + L * PITCH + MOD_H * 0.45, ctr.z);
  const from = T.controls.target.clone(), cam0 = T.camera.position.clone(), d = to.clone().sub(from), t0 = performance.now();
  cancelAnimationFrame(T.focusRaf);
  const tick = now => { const u = Math.min(1, (now - t0) / 480), e = 1 - Math.pow(1 - u, 3); T.controls.target.copy(from).addScaledVector(d, e); T.camera.position.copy(cam0).addScaledVector(d, e); if (u < 1) T.focusRaf = requestAnimationFrame(tick); };
  T.focusRaf = requestAnimationFrame(tick);
}

function renderBoard(animate = true) {
  const L = A.layer, b = A.boards[L], below = L > 0 ? A.boards[L - 1] : null;
  const before = animate && R.board.children.length ? rectsNow() : null;
  $$('[data-layer]', R.root).forEach(x => x.classList.toggle('on', +x.dataset.layer === L));
  const prs = pairsOf(L), nb = A.sel != null ? neighboursOf(A.sel) : [];
  R.board.innerHTML = b.map((t, k) => {
    const [c, r] = cellOf(k), under = below && below[k], floats = t && L > 0 && !under, slideable = t && neighboursOf(k).filter(j => !b[j]).length === 1;
    const cls = ['as-slot', t ? '' : 'empty', A.sel === k ? 'sel' : '', nb.includes(k) ? 'nb' : '', floats ? 'float' : '', slideable ? 'can-slide' : ''].filter(Boolean).join(' ');
    return `<div class="${cls}" data-k="${k}"${t ? ` data-uid="${t.uid}"` : ''} style="grid-column:${c + 1};grid-row:${r + 1}">${t ? `<canvas width="120" height="120"></canvas><em>${esc(t.mod.id)}</em>${floats ? '<s title="nothing below: it floats">⚠</s>' : ''}` : under ? `<canvas class="below" width="120" height="120"></canvas><em class="below-tag">below · ${esc(under.mod.id)}</em>` : ''}</div>`;
  }).join('')
    + prs.map(x => { const [c, r] = cellOf(x.a); const cls = x.through ? ' fused' : x.joined ? '' : ' wall'; const title = x.through ? 'the two modules morph into each other across the seam' : x.joined ? `bridge at ${x.levels.map(l => Math.round(l.y * LAT) + ' m').join(', ')}` : 'no shared floor: the seam stays open'; return `<i class="as-link ${x.axis}${cls}" style="--c:${c};--r:${r}" title="${title}"></i>`; }).join('');
  $$('.as-slot canvas', R.board).forEach(cv => { const k = +cv.parentElement.dataset.k, t = cv.classList.contains('below') ? below[k] : b[k]; cv.getContext('2d').drawImage(planOf(t.mod, t.rot), 0, 0); });
  if (before) glide(before);
  renderStats(); renderScore(); save();
}
function renderStats() {
  const g = connectedGroups(), uses = { lobby: 0, office: 0, social: 0, som: 0 }; let area = 0;
  for (let l = 0; l < 3; l++) A.boards[l].forEach(t => { if (!t) return; uses[t.mod.use]++; area += t.mod.an.floors.length * LAT * LAT; });
  const hint = g.modules ? (g.groups === 1 ? 'Every module is reachable — the seams, bridges and cores join them all.' : `${g.groups} separate groups: slide a module beside another, or stack one, to join them.`) : 'Drag a module from the palette onto a bay, or click one then click a bay.';
  R.stats.innerHTML = `<b>${g.modules}</b> modules · <b>${Math.round(area).toLocaleString('en-US')}</b> m² of floor · ${uses.lobby} lobby · ${uses.office} office · ${uses.social} gathering${uses.som ? ` · ${uses.som} from the map` : ''}<br><span class="hint">${hint}</span>`;
}
function renderCallouts() {
  const cs = A.three && A.three.callouts || [];
  R.callouts.innerHTML = cs.length ? cs.map(({ tag, L, c, r, t }) => `<div class="as-call"><b style="background:${USE[t.mod.use] ? USE[t.mod.use].c : '#888'}">${tag}</b><div><div class="n">${esc(t.mod.id)} ${esc(t.mod.name)} <small>· ${esc(t.mod.typology)}</small></div><div class="hint">Bay ${'ABCDEFG'[c]}${r + 1} · ${LAYERS[L].split(' ·')[0]} · turned ${t.rot * 90}° · ${esc(t.mod.note)}</div></div></div>`).join('') : '<p class="hint">The building follows the board: place modules to see them here, each with where it came from.</p>';
  const links = A.three && A.three.links || [], nf = links.filter(l => l.through).length, nb = links.filter(l => l.bridged).length, no = links.length - nf - nb;
  R.linkNote.textContent = links.length ? `${nf} seams where neighbours morph into each other, ${nb} bridges where they share a floor height but no mass meets, ${no} open seams, ${stacks().length} cores where modules stack (the first is the red stair).` : '';
}
function download(blob, name) { const u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 4000); }
function planPicture() {                                                          // the board as a site plan, for the deck
  const S = 2000, pad = 120, sx = (S - 2 * pad) / SITE.length, c = document.createElement('canvas'); c.width = S; c.height = Math.round(SITE.width * sx + 2 * pad + 140); const g = c.getContext('2d');
  g.fillStyle = '#0b0b0b'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#15181b'; g.fillRect(pad, pad, SITE.length * sx, SITE.width * sx);
  g.strokeStyle = '#4e4e4e'; g.lineWidth = 2; g.strokeRect(pad, pad, SITE.length * sx, SITE.width * sx);
  const L = A.layer;
  A.boards[L].forEach((t, k) => { const [col, r] = cellOf(k), o = slotOrigin(col, r), x = pad + o.x * sx, y = pad - o.z * sx; g.strokeStyle = '#333'; g.strokeRect(x, y, SITE.slotX * sx, SITE.slotZ * sx); if (t) { g.drawImage(planOf(t.mod, t.rot), x + 2, y + 2, SITE.slotX * sx - 4, SITE.slotZ * sx - 4); g.fillStyle = '#fff'; g.font = '600 26px Poppins, sans-serif'; g.fillText(t.mod.id, x + 10, y + 34); } });
  for (const cn of connections(L)) { const [ca, ra] = cellOf(cn.a), o = slotOrigin(ca, ra); g.fillStyle = cn.levels.length ? '#e8e8e8' : '#6a6a6a'; if (cn.axis === 'x') g.fillRect(pad + (o.x + SITE.slotX) * sx, pad + (-o.z + SITE.slotZ / 2) * sx - 6, SITE.gapX * sx, 12); else g.fillRect(pad + (o.x + SITE.slotX / 2) * sx - 6, pad + (-o.z + SITE.slotZ) * sx, 12, SITE.gapZ * sx); }
  g.fillStyle = '#b4b4b4'; g.font = '500 28px Poppins, sans-serif'; g.fillText('HERALD PLAZA · STREET · ACCESS FROM THE WEST', pad, pad - 30); g.fillText('BISCAYNE BAY · SURGE FROM THE EAST', pad, pad + SITE.width * sx + 48);
  g.save(); g.translate(pad - 36, pad + SITE.width * sx / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText('NORTH · VENETIAN CAUSEWAY', 0, 0); g.restore();
  g.save(); g.translate(pad + SITE.length * sx + 48, pad + SITE.width * sx / 2); g.rotate(Math.PI / 2); g.textAlign = 'center'; g.fillText('SOUTH · MACARTHUR CAUSEWAY', 0, 0); g.restore();
  g.fillStyle = '#f5f5f5'; g.font = '300 40px Poppins, sans-serif'; g.fillText(`VALVE HQ · ${LAYERS[L].toUpperCase()} · ${SITE.length} × ${SITE.width} M`, pad, c.height - 50);
  return c;
}
function save() { try { localStorage.setItem('protospace.assemble', JSON.stringify({ v: 1, layer: A.layer, boards: A.boards.map(b => b.map(t => t ? { id: t.mod.id, rot: t.rot } : null)) })); } catch (e) {} }
function load() { try { const j = JSON.parse(localStorage.getItem('protospace.assemble') || 'null'); if (!j || j.v !== 1) return false; A.layer = j.layer || 0; j.boards.forEach((b, L) => b.forEach((t, k) => { const m = t && A.modules.find(x => x.id === t.id); A.boards[L][k] = m ? { mod: m, rot: t.rot, uid: ++A.uid } : null; })); return A.boards.some(b => b.some(Boolean)); } catch (e) { return false; } }

const HTML = `
<div class="as">
  <aside class="xp-controls as-controls" aria-label="Assemble controls">
    <h2 class="eyebrow">The modules</h2>
    <p class="hint">Drag a module onto a bay (or click it, then a bay). Fifteen from the catalogue; tiles sent from the Explorer (“Build with it”) appear here too.</p>
    <div class="as-palette" data-v="palette"></div>
    <h2 class="eyebrow" style="margin-top:16px">The board</h2>
    <div class="xp-row"><button type="button" class="btn" data-v="auto">Auto-arrange</button><button type="button" class="btn" data-v="fill" title="One floor with all fifteen modules: lobbies on the street row, gathering rooms in the middle, offices on the bay side, six empty bays to slide into">All 15 on one floor</button><button type="button" class="btn quiet" data-v="shuffle">Scramble</button><button type="button" class="btn quiet" data-v="clear">Clear layer</button></div>
    <div class="xp-row"><button type="button" class="btn quiet" data-v="undo" title="Ctrl/⌘ Z">Undo</button><button type="button" class="btn quiet" data-v="redo" title="Ctrl/⌘ Shift Z">Redo</button><button type="button" class="btn quiet" data-v="rotate" title="R, or double-click a tile">Turn 90°</button><button type="button" class="btn quiet" data-v="remove" title="Delete, or drag a tile off the board">Remove</button></div>
    <p class="hint">It is a sliding puzzle: click a tile with one empty bay beside it and it slides there; drag any tile to any bay (onto another tile to swap); drag it off the board to take it out; arrow keys slide the selected tile, R turns it, 1 2 3 change layer. Three layers: ground on pilotis, two above — a tile on an upper layer needs a module below it.</p>
    <h2 class="eyebrow" style="margin-top:16px">The building</h2>
    <label class="chk"><input type="checkbox" data-opt="fuse" checked> Fuse the modules — they morph into each other across the seams</label>
    <label class="chk"><input type="checkbox" data-opt="bridges" checked> Bridges where floors meet but no mass does</label>
    <label class="chk"><input type="checkbox" data-opt="walls"> Garden walls (separate modules only)</label>
    <label class="chk"><input type="checkbox" data-opt="windows" checked> Windows in the thin walls</label>
    <label class="chk"><input type="checkbox" data-opt="cores" checked> Cores where modules stack</label>
    <label class="chk"><input type="checkbox" data-opt="labels" checked> Letters over the modules</label>
    <div class="xp-row"><button type="button" class="btn quiet" data-v="png">Picture · PNG</button><button type="button" class="btn quiet" data-v="plan">Plan · PNG</button><button type="button" class="btn quiet" data-v="glb">Model · GLB</button><button type="button" class="btn quiet" data-v="obj">Model · OBJ</button></div>
    <p class="hint" data-v="linkNote"></p>
  </aside>
  <div class="as-main">
    <div class="as-boardwrap">
      <div class="as-edge top"><span>Herald Plaza · street · access from the west</span><span class="seg" role="group" aria-label="Layer">${LAYERS.map((l, i) => `<button type="button" data-layer="${i}"${i === 0 ? ' class="on"' : ''}>${l.split(' ·')[0]}</button>`).join('')}</span></div>
      <div class="as-boardrow"><div class="as-edge left">N · Venetian Causeway</div><div class="as-board" data-v="board" style="--cols:${SITE.cols};--rows:${SITE.rows}" tabindex="0" aria-label="Plan board"></div><div class="as-edge right">S · MacArthur Causeway</div></div>
      <div class="as-edge bottom"><span>Biscayne Bay · surge from the east · the ground floods, so the ground layer stands 3 m up on pilotis</span></div>
    </div>
    <div class="as-under"><p class="status" data-v="stats"></p><div class="as-score" data-v="score"></div></div>
    <div class="as-viewer"><canvas data-v="canvas" aria-label="The building in 3D"></canvas><div class="as-compass">drag to orbit · scroll to zoom · <button type="button" data-view="street">street</button> <button type="button" data-view="bay">bay</button> <button type="button" data-view="aerial">aerial</button> <button type="button" data-view="plan">plan</button></div></div>
    <h2 class="eyebrow" style="margin-top:18px">Callouts · what each module is and where it came from</h2>
    <div class="as-callouts" data-v="callouts"></div>
  </div>
  <div class="as-tip" data-v="tip" hidden></div>
</div>`;

export function mount(root) {
  root.innerHTML = HTML; R = { root }; $$('[data-v]', root).forEach(el => { R[el.dataset.v] = el; });
  initThree(R.canvas);
  const slotAt = (x, y) => { const el = document.elementFromPoint(x, y); return el && el.closest ? el.closest('.as-slot') : null; };
  const select = k => { A.sel = k; A.hover = null; renderBoard(false); applyHighlight(); if (k != null) focusOn(A.layer, k); };
  // ---- dragging: from the palette onto a bay, from bay to bay (onto a tile swaps), off the board to remove; a short press is a click
  let drag = null;
  const startDrag = (e, d) => { if (e.button !== 0) return; drag = { ...d, x0: e.clientX, y0: e.clientY, moved: false, ghost: null }; window.addEventListener('pointermove', onDragMove); window.addEventListener('pointerup', onDragEnd, { once: true }); window.addEventListener('pointercancel', onDragEnd, { once: true }); };
  const onDragMove = e => {
    if (!drag) return; const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.moved) { if (Math.hypot(dx, dy) < 6) return; drag.moved = true; hideTip(); const g = document.createElement('div'); g.className = 'as-ghost'; const cv = document.createElement('canvas'); cv.width = cv.height = 120; cv.getContext('2d').drawImage(drag.canvas, 0, 0); g.appendChild(cv); document.body.appendChild(g); drag.ghost = g; document.body.classList.add('as-dragging'); if (drag.src === 'board') { const el = R.board.querySelector(`.as-slot[data-k="${drag.k}"]`); if (el) el.classList.add('lifted'); } }
    drag.ghost.style.transform = `translate(${e.clientX - 46}px, ${e.clientY - 46}px)`;
    const over = slotAt(e.clientX, e.clientY); $$('.as-slot.over', R.board).forEach(x => x.classList.remove('over')); if (over) over.classList.add('over');
    R.board.classList.toggle('drop-out', drag.src === 'board' && !over && !R.board.contains(document.elementFromPoint(e.clientX, e.clientY)));
    e.preventDefault();
  };
  const onDragEnd = e => {
    window.removeEventListener('pointermove', onDragMove); const d = drag; drag = null; if (!d) return;
    if (!d.moved) { onTap(d); return; }
    d.ghost.remove(); document.body.classList.remove('as-dragging'); R.board.classList.remove('drop-out'); $$('.as-slot.over, .as-slot.lifted', R.board).forEach(x => x.classList.remove('over', 'lifted'));
    const over = slotAt(e.clientX, e.clientY), k = over ? +over.dataset.k : -1, L = A.layer, b = A.boards[L];
    if (d.src === 'palette') { if (k < 0) return; const m = A.modules.find(x => x.id === d.id); if (!m) return; pushHistory(); place(L, k, m, 1); A.pick = null; renderPalette(); A.sel = k; renderBoard(); build(); focusOn(L, k); return; }
    if (k >= 0 && k !== d.k) { pushHistory(); moveTile(L, d.k, k); A.sel = k; renderBoard(); build(); focusOn(L, k); return; }
    if (k < 0 && !R.board.contains(document.elementFromPoint(e.clientX, e.clientY))) { pushHistory(); b[d.k] = null; A.sel = null; renderBoard(); build(); return; }
    renderBoard(false);
  };
  const onTap = d => {
    const L = A.layer, b = A.boards[L];
    if (d.src === 'palette') { A.pick = A.pick === d.id ? null : d.id; A.sel = null; renderPalette(); renderBoard(false); return; }
    const k = d.k;
    if (A.pick && !b[k]) { const m = A.modules.find(x => x.id === A.pick); if (m) { pushHistory(); place(L, k, m, 1); } A.pick = null; renderPalette(); A.sel = k; renderBoard(); build(); focusOn(L, k); return; }
    if (b[k]) {
      const to = slide(L, k);                                                        // the puzzle move: one empty bay beside it → it slides there (and stays selected, so a second click slides it back)
      if (to >= 0) { A.sel = to; A.hover = null; renderBoard(); build(); flash(to); return; }
      select(k === A.sel ? null : k); return;                                        // otherwise a click selects it, a click on the selected one lets go
    }
    if (A.sel != null) { pushHistory(); moveTile(L, A.sel, k); A.sel = k; renderBoard(); build(); focusOn(L, k); } // selected tile + empty bay: it jumps there
  };
  const flash = k => { const el = R.board.querySelector(`.as-slot[data-k="${k}"]`); if (el) { el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 500); } };
  R.palette.addEventListener('pointerdown', e => { const bt = e.target.closest('[data-pick]'); if (!bt) return; startDrag(e, { src: 'palette', id: bt.dataset.pick, canvas: bt.querySelector('canvas') }); });
  R.board.addEventListener('pointerdown', e => { const slot = e.target.closest('.as-slot'); if (!slot) return; R.board.focus({ preventScroll: true }); const k = +slot.dataset.k; if (slot.classList.contains('empty')) { startDrag(e, { src: 'empty', k, canvas: null }); return; } startDrag(e, { src: 'board', k, canvas: slot.querySelector('canvas') }); });
  R.board.addEventListener('dblclick', e => { const slot = e.target.closest('.as-slot'); if (!slot || slot.classList.contains('empty')) return; turn(+slot.dataset.k); });
  const turn = k => { const t = A.boards[A.layer][k]; if (!t) return; pushHistory(); t.rot = (t.rot + 1) % 4; A.sel = k; renderBoard(false); const el = R.board.querySelector(`.as-slot[data-k="${k}"] canvas`); if (el) { el.classList.add('spin'); setTimeout(() => el.classList.remove('spin'), 400); } build(); };
  // ---- hovering: the tile's neighbours light up and a tooltip says how it joins them; the module lights up in 3D
  R.board.addEventListener('pointerover', e => { const slot = e.target.closest('.as-slot'); if (!slot || slot.classList.contains('empty') || drag) return; const k = +slot.dataset.k; A.hover = `${A.layer}:${k}`; applyHighlight(); showTip(A.layer, k, slot); neighboursOf(k).forEach(j => { const el = R.board.querySelector(`.as-slot[data-k="${j}"]`); if (el && !el.classList.contains('empty')) el.classList.add('nb-hover'); }); });
  R.board.addEventListener('pointerout', e => { const slot = e.target.closest('.as-slot'); if (!slot) return; A.hover = null; applyHighlight(); hideTip(); $$('.as-slot.nb-hover', R.board).forEach(x => x.classList.remove('nb-hover')); });
  // ---- keys
  R.board.addEventListener('keydown', e => {
    const key = e.key, meta = e.metaKey || e.ctrlKey;
    if (meta && key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (key === '1' || key === '2' || key === '3') { A.layer = +key - 1; A.sel = null; renderBoard(false); applyHighlight(); return; }
    if (key.toLowerCase() === 'r' && A.sel != null) { turn(A.sel); return; }
    if ((key === 'Delete' || key === 'Backspace') && A.sel != null) { pushHistory(); A.boards[A.layer][A.sel] = null; A.sel = null; renderBoard(); build(); e.preventDefault(); return; }
    if (key === 'Escape') { select(null); return; }
    if (A.sel == null) return; const [c, r] = cellOf(A.sel), d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key]; if (!d) return;
    const c2 = c + d[0], r2 = r + d[1]; if (c2 < 0 || r2 < 0 || c2 >= SITE.cols || r2 >= SITE.rows) return; const k2 = idx(c2, r2);
    if (!A.boards[A.layer][k2]) { pushHistory(); moveTile(A.layer, A.sel, k2); A.sel = k2; renderBoard(); build(); focusOn(A.layer, k2); } e.preventDefault();
  });
  $$('[data-layer]', root).forEach(bt => bt.addEventListener('click', () => { A.layer = +bt.dataset.layer; A.sel = null; renderBoard(false); applyHighlight(); }));
  $$('[data-view]', root).forEach(bt => bt.addEventListener('click', () => setView(bt.dataset.view)));
  R.auto.addEventListener('click', () => { pushHistory(); autoArrange(); });
  R.fill.addEventListener('click', () => { pushHistory(); fillFloor(0); setTimeout(() => setView('aerial'), 200); });
  R.shuffle.addEventListener('click', () => scramble(A.layer));
  R.clear.addEventListener('click', () => { pushHistory(); clearLayer(A.layer); A.sel = null; renderBoard(); build(); });
  R.undo.addEventListener('click', undo); R.redo.addEventListener('click', redo);
  R.rotate.addEventListener('click', () => { if (A.sel != null) turn(A.sel); });
  R.remove.addEventListener('click', () => { if (A.sel != null) { pushHistory(); A.boards[A.layer][A.sel] = null; A.sel = null; renderBoard(); build(); } });
  $$('[data-opt]', root).forEach(x => x.addEventListener('change', () => { A.opts[x.dataset.opt] = x.checked; build(); }));
  R.png.addEventListener('click', () => { const { renderer, scene, camera } = A.three; renderer.render(scene, camera); renderer.domElement.toBlob(b => download(b, 'ProtoSpace-ValveHQ-building.png')); });
  R.plan.addEventListener('click', () => planPicture().toBlob(b => download(b, `ProtoSpace-ValveHQ-plan-${['ground', 'level2', 'level3'][A.layer]}.png`)));
  R.glb.addEventListener('click', () => new GLTFExporter().parse(A.three.building, out => download(new Blob([out], { type: 'model/gltf-binary' }), 'ProtoSpace-ValveHQ.glb'), err => console.error(err), { binary: true }));
  R.obj.addEventListener('click', () => download(new Blob([new OBJExporter().parse(A.three.building)], { type: 'text/plain' }), 'ProtoSpace-ValveHQ.obj'));
  R.stats.textContent = 'Loading the fifteen modules…';
  loadBuiltins().then(() => { A.ready = true; renderPalette(); if (!load()) autoArrange(7); else { renderBoard(false); build(); } setTimeout(() => setView('street'), 400); }).catch(err => { R.stats.textContent = 'The modules could not be loaded: ' + (err.message || err); });
  return { show() { window.dispatchEvent(new Event('resize')); }, addModule };
}

/* ProtoSpace Analyzer — the Assemble tab: the fifteen spaces (and any tile sent over from the Explorer) as modules of
   an office for Valve on the One Herald Plaza lot, laid out with a sliding-tile plan game and built in 3D.

   The site: 100 × 250 m, long side north–south, Biscayne Bay along the east edge, Herald Plaza and the street along
   the west, causeways north and south. The ground floods (Irma put ~1.5 m of surge in the streets), so the ground
   layer stands on pilotis 3 m up and the levels above hold the cabals; lobbies make the public edge on the west,
   offices the cabal floors, gathering spaces the rooms for the whole company; one red stair ties it all together.

   Plan game: the lot is a board of 7 × 3 slots (one module bay each, 31 × 31 m, with a 1 m seam between bays).
   Modules are tiles — their roof plans — that slide into empty slots; a tile can be turned; the board has three layers
   (ground, level 2, level 3). The 3D building follows the board, fused into one surface: across every seam the two
   neighbours morph into each other (js/fuse.js), a core rises wherever modules stack, and the red stair. A module can
   be picked on the board, in the callout list or by clicking it in the 3D view; it lights up in all three. Every module
   carries a callout of what it is and where it came from (animation, frame, bay — or the Explorer map and tile).

   mount(root) → { show, addModule({ name, occ, N, note, use }) } ; the Explorer sends tiles with addModule. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { voxelize } from './voxelize.js';
import { organicGeometry } from './isosurface.js';
import { fusedGeometry, morphSeam, surfaceNets, taubin } from './fuse.js';

const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ------------------------------------------------------------------ the site and the board
const N = 32, LAT = 31 / 30, SLOT_V = 30, GAP_V = 1, PITCH_V = 20, PODIUM_V = 3, MARGIN_V = 4;   // lattice · metres per voxel · bay, seam (1 m), layer pitch (a 1 m gap over a full-height module), pilotis, grid margin (voxels)
export const SITE = { length: 250, width: 100, cols: 7, rows: 3, slotX: SLOT_V * LAT, slotZ: SLOT_V * LAT, gapX: GAP_V * LAT, gapZ: GAP_V * LAT };   // x runs north → south, z runs west → east (negative)
SITE.boardX = SITE.cols * SITE.slotX + (SITE.cols - 1) * SITE.gapX; SITE.boardZ = SITE.rows * SITE.slotZ + (SITE.rows - 1) * SITE.gapZ;
SITE.x0 = (SITE.length - SITE.boardX) / 2; SITE.z0 = (SITE.width - SITE.boardZ) / 2;                                   // the board sits centred on the lot
const PODIUM = PODIUM_V * LAT, PITCH = PITCH_V * LAT, MOD_H = 19;                                                          // pilotis height · layer pitch · module height (m)
const LAYERS = ['Ground · on pilotis', 'Level 2', 'Level 3'];
const USE = { lobby: { name: 'Lobby', c: '#6d8f98' }, office: { name: 'Office', c: '#c0994f' }, social: { name: 'Gathering', c: '#b4584a' }, hybrid: { name: 'Hybrid', c: '#8e6f9b' }, som: { name: 'Explorer tile', c: '#7b7aa3' } };
const CATS = [['lobby', 'Lobbies'], ['office', 'Workspaces'], ['social', 'Gathering'], ['hybrid', 'Hybrid spaces'], ['som', 'From the Explorer']];   // the palette's drop-down
const slotOrigin = (c, r) => ({ x: SITE.x0 + c * (SITE.slotX + SITE.gapX), z: -(SITE.z0 + r * (SITE.slotZ + SITE.gapZ)) });   // the slot's north-west corner
const slotCentre = (c, r) => { const o = slotOrigin(c, r); return { x: o.x + SITE.slotX / 2, z: o.z - SITE.slotZ / 2 }; };
/* A module's lattice footprint turned on the board: (x, z) of the 32 × 32 lattice → (u, v), u along the lot (south = +u), v across it (east = +v). */
const latToSlot = (x, z, rot) => [[x, z], [N - 1 - z, x], [N - 1 - x, N - 1 - z], [z, N - 1 - x]][rot & 3];
// the building's voxel grid: the board plus a margin all round; grid (gx, gy, gz) ↔ world
const GX = 2 * MARGIN_V + SITE.cols * SLOT_V + (SITE.cols - 1) * GAP_V, GZ = 2 * MARGIN_V + SITE.rows * SLOT_V + (SITE.rows - 1) * GAP_V, GY = PODIUM_V + 3 * PITCH_V + 2;
const gridX = gx => SITE.x0 + (gx - MARGIN_V + 0.5) * LAT, gridY = gy => (gy + 0.5) * LAT, gridZ = gz => -(SITE.z0 + (gz - MARGIN_V + 0.5) * LAT);   // voxel centres
const gridBase = (c, r, L) => ({ gx0: MARGIN_V + c * (SLOT_V + GAP_V), gz0: MARGIN_V + r * (SLOT_V + GAP_V), gy0: PODIUM_V + L * PITCH_V - 1 });   // lattice (u, v, y) → (gx0 + u − 1, gy0 + y, gz0 + v − 1)

const A = {
  modules: [], boards: [[], [], []], layer: 0, sel: null, pick: null, custom: 0, cat: 'lobby',
  three: null, ready: false, pairs: null, uid: 0, history: [], future: [], hover: null, opts: { fuse: true, cores: true, labels: true },
};
for (let L = 0; L < 3; L++) A.boards[L] = Array.from({ length: SITE.cols * SITE.rows }, () => null);   // { mod, rot }
let R = {};

// ------------------------------------------------------------------ modules: geometry in metres, voxels for plans and floors
function analyse(occ, n) {                                                       // floors, roof heights and edge ports of a voxel solid
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
  return { roof, floors, ports, bounds: { xmin, xmax, zmin, zmax, ymin, ymax }, cells };
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
  // the picks of the combination maps (assets/spaces/picks.json, made by the boards' bake script): the best
  // in-betweens of Lobby × Workspace, Lobby × Gathering, Gathering × Workspace and the hybrid map, sorted by use
  try {
    const picks = await (await fetch('assets/spaces/picks.json')).json();
    for (const it of picks) A.modules.push(moduleFromOcc({ id: it.id, name: it.name, use: it.use, typology: it.typology, note: it.note, source: 'map', occ: unpack(it.occ, it.N || N), N: it.N || N }));
  } catch (e) { console.warn('no map picks', e); }
}
const unpack = (b64, n) => { const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)), occ = new Uint8Array(n * n * n); for (let i = 0; i < occ.length; i++) occ[i] = (bytes[i >> 3] >> (i & 7)) & 1; return occ; };
/* A module from voxels in the lattice: an organic surface in metres, like the catalogue ones. */
function moduleFromOcc({ id, name, use, typology, note, source, occ, N: n = N }) {
  const m = { id, name, use, typology, note, source, occ, fit: null, shift: null, an: analyse(occ, n), plans: {} };
  let g = null;                                                                  // the surface is only needed for the unfused building and the exports: made on first use
  Object.defineProperty(m, 'geo', { enumerable: true, get() { if (!g) { g = organicGeometry(occ, n); g.scale(LAT, LAT, LAT); g.computeBoundingBox(); const b = g.boundingBox; m.shift = [-b.min.x, -b.min.y, -b.max.z]; g.translate(...m.shift); g.computeBoundingBox(); } return g; } });
  return m;
}
/* A tile sent from the Explorer. */
export function addModule({ name, occ, N: n = N, note = '', use = 'som' }) {
  const m = moduleFromOcc({ id: `X${++A.custom}`, name: name || `Explorer tile ${A.custom}`, use, typology: 'from the map', note, source: 'explorer', occ, N: n });
  A.modules.push(m); A.cat = use; renderPalette(); return m;
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
A.boardAt = ({ L, k }) => A.boards[L][k];
function clearLayer(L) { A.boards[L] = A.boards[L].map(() => null); }
function moveTile(L, from, to) { const b = A.boards[L]; if (b[to]) [b[from], b[to]] = [b[to], b[from]]; else { b[to] = b[from]; b[from] = null; } }
function adjacent(a, b) { const [ca, ra] = cellOf(a), [cb, rb] = cellOf(b); return Math.abs(ca - cb) + Math.abs(ra - rb) === 1; }

/* A sensible start, by the brief, with the uses mixed: the street row is lobbies and gathering rooms alternating along
   the whole front (the public rooms), then the rest grows one module at a time — each goes where it touches modules of
   other uses, never beside its own kind if it can help it; lobbies stay at ground on a public edge (the street row or a
   causeway side), offices lean to the upper floors, gathering rooms to the middle of things, nothing floats and
   everything touches. Then, wherever a module's seams would stay open, hybrids are added beside or on it to make the
   joins. The seed varies the result. */
function autoArrange(seed = Date.now() % 1000) {
  let sd = (seed * 9301 + 49297) % 233280; const rnd = () => (sd = (sd * 9301 + 49297) % 233280) / 233280;
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const by = u => A.modules.filter(m => m.use === u && (m.source === 'catalogue' || u === 'som')), rot = () => (rnd() < 0.75 ? 1 : 3);
  for (let i = 0; i < 3; i++) clearLayer(i);
  // the programme: every module once, two offices and a gathering room twice (the cabal floors), dealt out lobby · office · gathering in turn
  const pools = { lobby: shuffle(by('lobby')), office: shuffle(by('office').concat(by('som'))), social: shuffle(by('social')) };
  pools.office = pools.office.concat(pools.office.slice(0, 2)); pools.social = pools.social.concat(pools.social.slice(0, 1));   // the cabal floors: two offices and a gathering room again
  // the street row first: lobbies and gathering rooms alternating along the whole front, starting with either
  let u = rnd() < 0.5 ? 'lobby' : 'social';
  for (let c = 0; c < SITE.cols; c++) { const m = pools[u].shift(); if (m) place(0, idx(c, 0), m, rot()); u = u === 'lobby' ? 'social' : 'lobby'; }
  const queue = []; while (pools.lobby.length || pools.office.length || pools.social.length) for (const w of ['lobby', 'office', 'social']) if (pools[w].length) queue.push(pools[w].shift());
  const publicEdge = (c, r) => r === 0 || c === 0 || c === SITE.cols - 1;
  const usesAround = (L, k) => { const out = []; for (const j of neighboursOf(k)) if (A.boards[L][j]) out.push(A.boards[L][j].mod.use); if (L > 0 && A.boards[L - 1][k]) out.push(A.boards[L - 1][k].mod.use); if (L < 2 && A.boards[L + 1][k]) out.push(A.boards[L + 1][k].mod.use); return out; };
  for (const m of queue) {
    let best = null, bestS = -1e9;
    for (let L = 0; L < 3; L++) for (let k = 0; k < SITE.cols * SITE.rows; k++) {
      if (A.boards[L][k]) continue; const [c, r] = cellOf(k);
      if (L > 0 && !A.boards[L - 1][k]) continue;                                                              // nothing floats
      if (m.use === 'lobby' && (L > 0 || !publicEdge(c, r))) continue;                                         // lobbies at ground, on a public edge
      const nb = usesAround(L, k); if (!nb.length) continue;                                                   // it must touch the building
      let sc = 0; for (const u of nb) sc += u === m.use ? -2 : 2.5;                                            // mixed: other uses beside it, its own kind kept apart
      sc += Math.min(nb.length, 3) * 0.6 + (L > 0 && nb.length > 1 ? 2.2 : 0);                                 // compact: upstairs, beside another module rather than alone on a roof
      if (m.use === 'office') sc += L * 1.4 - (L === 0 ? 1 : 0);                                               // offices up where the views are
      if (m.use === 'social') sc += (r === 1 ? 1 : 0) + (L === 0 ? 0.4 : 0);                                    // gathering rooms in the middle of things
      if (L === 0 && r === 2) sc -= 0.6;                                                                       // the bay row fills last
      sc += rnd() * 1.6;
      if (sc > bestS) { bestS = sc; best = { L, k }; }
    }
    if (best) place(best.L, best.k, m, rot());
  }
  // hybrids where the connections are not optimal: a module is weakly joined when one of its seams would stay open
  // (no mass of its neighbour meets its own). For every empty bay beside such a module — or on top of it — every
  // hybrid is tried at every turn, and the one that joins the weak module through the seam, and as many other
  // neighbours as it can, is placed; up to five of them
  const hybrids = A.modules.filter(m => m.use === 'hybrid'), used = new Set();
  const weakOnes = () => { const w = new Set(); for (let L = 0; L < 3; L++) A.boards[L].forEach((t, k) => { if (!t) return; const cn = joinsAt(L, k, t.mod, t.rot); if (cn.length && cn.some(x => !x.through)) w.add(`${L}:${k}`); }); return w; };
  for (let added = 0; added < 5 && hybrids.length; added++) {
    const weak = weakOnes(); if (!weak.size) break;
    let best = null;
    for (let L = 0; L < 3; L++) for (let k = 0; k < SITE.cols * SITE.rows; k++) {
      if (A.boards[L][k] || (L > 0 && !A.boards[L - 1][k])) continue;
      if (!joinsAt(L, k, hybrids[0], 0).some(x => weak.has(`${x.L}:${x.k}`))) continue;                          // only beside (or on) a weakly joined module
      for (const h of hybrids) { if (used.has(h.id)) continue; for (let rot = 0; rot < 4; rot++) {
        const cn = joinsAt(L, k, h, rot), sc = cn.reduce((acc, x) => acc + (x.through ? (weak.has(`${x.L}:${x.k}`) ? 2 : 1) : 0), 0) + cn.length * 0.1 - L * 0.05 + rnd() * 0.3;   // the seed picks among equals
        if (sc >= 2 && (!best || sc > best.sc)) best = { L, k, h, rot, sc };
      } }
    }
    if (!best) break;
    place(best.L, best.k, best.h, best.rot); used.add(best.h.id);
  }
  A.sel = null; renderBoard(); build();
}
/* Would a module, turned so, placed at a bay, join each of its neighbours through the seam? The seam morph runs
   straight through wherever the two facing sections (the three voxel slices at each one's edge) have mass at the same
   place, so each module keeps, per turn, a bit-mask of its six faces and the test is an overlap of masks. */
function sidesOf(m, rot) {
  m.sides ||= {}; if (m.sides[rot]) return m.sides[rot];
  const n = N, occS = new Uint8Array(n * n * n); let umin = n, umax = -1, vmin = n, vmax = -1, ymin = n, ymax = -1;
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!m.occ[x + n * (y + n * z)]) continue; const [u, v] = latToSlot(x, z, rot); occS[u + n * (y + n * v)] = 1;
    if (u < umin) umin = u; if (u > umax) umax = u; if (v < vmin) vmin = v; if (v > vmax) vmax = v; if (y < ymin) ymin = y; if (y > ymax) ymax = y;
  }
  const S = new Uint32Array(n), Nn = new Uint32Array(n), E = new Uint32Array(n), W = new Uint32Array(n), T = new Uint32Array(n), B = new Uint32Array(n);   // S/N over (y → bits v), E/W over (y → bits u), T/B over (u → bits v)
  for (let v = 0; v < n; v++) for (let y = 0; y < n; y++) for (let u = 0; u < n; u++) {
    if (!occS[u + n * (y + n * v)]) continue;
    if (u >= umax - 2) S[y] |= 1 << v; if (u <= umin + 2) Nn[y] |= 1 << v;
    if (v >= vmax - 2) E[y] |= 1 << u; if (v <= vmin + 2) W[y] |= 1 << u;
    if (y >= ymax - 2) T[u] |= 1 << v; if (y <= ymin + 2) B[u] |= 1 << v;
  }
  return (m.sides[rot] = { S, N: Nn, E, W, T, B });
}
const overlap = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] & b[i]) return true; return false; };
function joinsAt(L, k, m, rot) {
  const [c, r] = cellOf(k), mine = sidesOf(m, rot), out = [];
  const test = (L2, k2, a, b) => { const t2 = A.boards[L2][k2]; if (t2) out.push({ L: L2, k: k2, through: overlap(mine[a], sidesOf(t2.mod, t2.rot)[b]) }); };
  if (c + 1 < SITE.cols) test(L, idx(c + 1, r), 'S', 'N'); if (c > 0) test(L, idx(c - 1, r), 'N', 'S');
  if (r + 1 < SITE.rows) test(L, idx(c, r + 1), 'E', 'W'); if (r > 0) test(L, idx(c, r - 1), 'W', 'E');
  if (L > 0) test(L - 1, k, 'B', 'T'); if (L < 2) test(L + 1, k, 'T', 'B');
  return out;
}
// ------------------------------------------------------------------ connections: seams, cores
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
  return connections(L).map(cn => ({ ...cn, joined: false, through: false }));
}
function connectedGroups() {                                                      // modules joined by morphed seams and by stacking (through a core)
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
const SLAB = new THREE.MeshStandardMaterial({ color: 0xbdb7ae, roughness: 0.95, side: THREE.DoubleSide });
const RED = new THREE.MeshStandardMaterial({ color: 0xc62828, roughness: 0.7 });
const CORE = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.85 });
const COLUMN = new THREE.MeshStandardMaterial({ color: 0xcfcac2, roughness: 0.9 });

/* The transform that puts a module's local frame (x 0…27, y 0…19, z −31…0) into its slot at a layer with a rotation. */
function placement(k, L, rot, geo) {
  const [c, r] = cellOf(k), ctr = slotCentre(c, r), y = PODIUM + L * PITCH;
  const m = new THREE.Matrix4().makeRotationY(rot * Math.PI / 2);
  const bb = geo.boundingBox.clone().applyMatrix4(m), cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
  return new THREE.Matrix4().makeTranslation(ctr.x - cx, y - bb.min.y, ctr.z - cz).multiply(m);
}
const FUSED = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
const CORE_PID = 30000;                                                             // grid labels from here up are cores (the first the red stair), not modules
function tintOf(use) { return '#' + new THREE.Color(0xece8e1).lerp(new THREE.Color(USE[use] ? USE[use].c : '#888'), 0.5).getHexString(); }
function clearBuilding() {
  const { building, labels } = A.three;
  for (const g of [building, labels]) while (g.children.length) { const o = g.children.pop(); o.traverse?.(c => { if (c.geometry && !c.userData.shared) c.geometry.dispose(); }); }
}
/* Continuous lattice coordinates (voxel x spans [x, x + 1)) → the module's local metres, its mesh frame. */
function latticeToLocal(m, X, Y, Z) {
  if (m.fit) { const { min, scale, off } = m.fit; return [(X - off[0]) / scale + min[0], (Y - off[1]) / scale + min[1], (N - Z - off[2]) / scale + min[2]]; }
  return [X * LAT + m.shift[0], Y * LAT + m.shift[1], -Z * LAT + m.shift[2]];
}
const DECK_T = 0.7;                                                                 // the pad's thickness (m)
/* The deck and the pilotis under a ground module, only where it stands: the footprint of its lowest two voxel layers,
   closed and grown by two voxels so nearby feet share one pad, as a slab contoured at half-voxel resolution (so its
   edge is smooth, not stepped), with a column on a 6 m grid wherever the pad is. The pad is drawn in the module's own
   lattice and put where the module is: through the lattice frame when the building is fused, through the mesh's
   placement matrix when the modules are separate. */
function deckFor(t, k, building, M = null) {
  const m = t.mod, n = N, y0 = m.an.bounds.ymin, [c, r] = cellOf(k), o = slotOrigin(c, r);
  const M0 = -4, W = n + 8, at = (x, z) => (x - M0) + W * (z - M0);
  let mask = new Uint8Array(W * W);
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) if (m.occ[x + n * (y0 + n * z)] || m.occ[x + n * (y0 + 1 + n * z)]) mask[at(x, z)] = 1;
  const grow = (src, rad, all) => { const out = new Uint8Array(src.length); for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) { let n1 = 0, tot = 0; for (let dj = -rad; dj <= rad; dj++) for (let di = -rad; di <= rad; di++) { const I = i + di, J = j + dj; tot++; if (I >= 0 && J >= 0 && I < W && J < W && src[I + W * J]) n1++; } out[i + W * j] = all ? (n1 === tot ? 1 : 0) : (n1 ? 1 : 0); } return out; };
  mask = grow(grow(mask, 3, false), 1, true);                                     // dilate 3, erode 1: +2 all round, gaps up to 6 voxels bridged
  if (!mask.some(Boolean)) return;
  // continuous lattice (X, Z) → world (x, z)
  const toWorld = (X, Z) => {
    if (M) { const [lx, , lz] = latticeToLocal(m, X, 0, Z); const v = new THREE.Vector3(lx, 0, lz).applyMatrix4(M); return [v.x, v.z]; }
    const [U, V] = [[X, Z], [n - Z, X], [n - X, n - Z], [Z, n - X]][t.rot & 3];   // the lattice turned on the board (latToSlot for a continuous coordinate)
    return [o.x + (U - 1) * LAT, o.z - (V - 1) * LAT];
  };
  // the slab: the mask at twice the resolution, one cell thick, contoured and smoothed
  const S = 2 * W + 2, H = 4, occ = new Uint8Array(S * H * S);
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) if (mask[i + W * j]) for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) occ[(2 * i + 1 + di) + S * (1 + H * (2 * j + 1 + dj))] = 1;
  const { pos, index } = surfaceNets(occ, new Int16Array(occ.length), S, H, S); taubin(pos, index, 6);
  for (let i = 0; i < pos.length; i += 3) { const [wx, wz] = toWorld((pos[i] - 0.5) / 2 + M0, (pos[i + 2] - 0.5) / 2 + M0); pos[i] = wx; pos[i + 1] = PODIUM - DECK_T / 2 + (pos[i + 1] - 1) * DECK_T; pos[i + 2] = wz; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(index, 1)); g.computeVertexNormals();
  const deck = new THREE.Mesh(g, SLAB); deck.receiveShadow = deck.castShadow = true; building.add(deck);
  // the pilotis: a column under every 6 m grid point of the bay the pad covers
  const cols = [];
  for (let z = M0; z < M0 + W; z++) for (let x = M0; x < M0 + W; x++) {
    if (!mask[at(x, z)]) continue; const [wx, wz] = toWorld(x + 0.5, z + 0.5), sx = Math.round((wx - o.x) / LAT - 0.5), sz = Math.round((o.z - wz) / LAT - 0.5);
    if (((sx - 3) % 6 + 6) % 6 === 0 && ((sz - 3) % 6 + 6) % 6 === 0) cols.push([wx, wz]);
  }
  if (!cols.length) return;
  const geo = new THREE.CylinderGeometry(0.35, 0.35, PODIUM - DECK_T + 0.3, 12), inst = new THREE.InstancedMesh(geo, COLUMN, cols.length), tmp = new THREE.Object3D();
  cols.forEach(([x, z], i) => { tmp.position.set(x, (PODIUM - DECK_T + 0.3) / 2 - 0.3, z); tmp.updateMatrix(); inst.setMatrixAt(i, tmp.matrix); });
  inst.castShadow = true; building.add(inst);
}
/* Deck, pilotis and letter for a placed module — the parts both building modes share. */
function furnish(t, k, L, tag, building, labels, M = null) {
  const [c, r] = cellOf(k);
  if (L === 0) deckFor(t, k, building, M);
  if (A.opts.labels) { const sp = label(tag, slotCentre(c, r).x, PODIUM + L * PITCH + MOD_H + 4, slotCentre(c, r).z, USE[t.mod.use] ? USE[t.mod.use].c : '#888'); sp.userData.slot = `${L}:${k}`; labels.add(sp); }
}
function cores(building) {                                                        // separate modules only: a stair-and-lift tower beside each stack; the first is the red stair (the fused body grows its own)
  if (!A.opts.cores) return;
  stacks().forEach((s, i) => {
    const [c, r] = cellOf(s.k), ctr = slotCentre(c, r), h = PODIUM + s.top * PITCH + MOD_H * 0.8;   // inside the body, at the centre of the stack
    const core = new THREE.Mesh(new THREE.BoxGeometry(6, h, 5), i === 0 ? RED : CORE); core.position.set(ctr.x - 6, h / 2, ctr.z + 5); core.castShadow = core.receiveShadow = true; building.add(core);
    if (i === 0) { const cap = new THREE.Mesh(new THREE.BoxGeometry(7, 0.4, 6), RED); cap.position.set(ctr.x - 6, h + 0.2, ctr.z + 5); building.add(cap); }
  });
}
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
  const OX = Math.max(0, minX - 3), OY = 0, OZ = Math.max(0, minZ - 3);                                         // y from the ground, so the cores can reach it
  const DX = maxX < 0 ? 1 : Math.min(GX, maxX + 4) - OX, DY = maxX < 0 ? 1 : Math.min(GY, maxY + 6) - OY, DZ = maxX < 0 ? 1 : Math.min(GZ, maxZ + 4) - OZ;
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
  // the cores, part of the body: wherever modules stack (or one sits above the ground), a stair-and-lift shaft is stamped
  // into the grid where the stack is most solid — it fills the voids and the gaps between floors on its way from the
  // ground to a bulkhead over the top roof, and the surface flows around it; the first is the red stair
  let coreCount = 0;
  if (A.opts.cores && placed.length) stacks().forEach((st, i) => {
    const [c, r] = cellOf(st.k), { gx0, gz0 } = gridBase(c, r, 0), x0 = gx0 - 1 - OX, z0 = gz0 - 1 - OZ, W = 6, D = 5;
    const colN = new Int32Array(SLOT_V * SLOT_V), colTop = new Int32Array(SLOT_V * SLOT_V);                  // solid per column of the bay, and its top
    for (let dz = 0; dz < SLOT_V; dz++) for (let dx = 0; dx < SLOT_V; dx++) {
      const x = x0 + dx, z = z0 + dz; if (x < 0 || z < 0 || x >= DX || z >= DZ) continue; let n = 0, top = -1;
      for (let y = 0; y < DY; y++) { const j = gid(x, y, z); if (occ[j] && lab[j] > 0 && lab[j] < CORE_PID) { n++; top = y; } }
      colN[dx + SLOT_V * dz] = n; colTop[dx + SLOT_V * dz] = top;
    }
    let best = null, bestS = -1e9;
    for (let dz = 2; dz + D <= SLOT_V - 2; dz++) for (let dx = 2; dx + W <= SLOT_V - 2; dx++) {
      let n = 0, top = -1; for (let v = 0; v < D; v++) for (let u = 0; u < W; u++) { const q = dx + u + SLOT_V * (dz + v); n += colN[q]; if (colTop[q] > top) top = colTop[q]; }
      const sc = n - 0.8 * (Math.abs(dx + W / 2 - SLOT_V / 2) + Math.abs(dz + D / 2 - SLOT_V / 2));          // the most solid column, near the middle of the bay
      if (top >= 0 && sc > bestS) { bestS = sc; best = { dx, dz, top }; }
    }
    if (!best) return;
    const pid = CORE_PID + (coreCount++ ? 1 : 0), yTop = Math.min(DY - 3, best.top + 3);
    for (let y = 0; y <= yTop; y++) for (let v = 0; v < D; v++) for (let u = 0; u < W; u++) {
      const x = x0 + best.dx + u, z = z0 + best.dz + v; if (x < 0 || z < 0 || x >= DX || z >= DZ) continue;
      const j = gid(x, y, z); if (!occ[j]) { occ[j] = 1; lab[j] = pid; }                                       // only where the modules are not: the shaft shows in voids, gaps and above the roof
    }
  });
  const links = pairs.map(pr => ({ L: pr.L, through: pr.through }));
  A.pairs = pairs;
  // the surface
  if (placed.length) {
    const colorOf = pid => { if (pid >= CORE_PID) return pid === CORE_PID ? '#c62828' : '#3a3a3a'; const P = placed[pid - 1]; return P ? tintOf(P.t.mod.use) : '#e9e5de'; };
    const g = fusedGeometry(occ, lab, DX, DY, DZ, colorOf, 10);
    const P = g.getAttribute('position'), arr = P.array;
    for (let i = 0; i < P.count; i++) { arr[i * 3] = gridX(arr[i * 3] + OX); arr[i * 3 + 1] = gridY(arr[i * 3 + 1] + OY); arr[i * 3 + 2] = gridZ(arr[i * 3 + 2] + OZ); }
    P.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, FUSED); mesh.castShadow = mesh.receiveShadow = true; mesh.name = 'Valve HQ · fused'; building.add(mesh);
  }
  // columns, decks, letters, cores
  for (const P of placed) {
    const { t, k, L } = P;
    furnish(t, k, L, P.tag, building, labels);
  }
  A.three.callouts = callouts; A.three.links = links; A.three.placed = placed;
  applyHighlight();
}
/* The older building: every module its own mesh in its bay. */
function buildSeparate() {
  const { building, labels } = A.three; clearBuilding(); A.pairs = null;
  const callouts = [];
  let letter = 0; const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (let L = 0; L < 3; L++) A.boards[L].forEach((t, k) => {
    if (!t) return;
    const M = placement(k, L, t.rot, t.mod.geo);
    const mesh = new THREE.Mesh(t.mod.geo, matFor(t.mod.use)); mesh.applyMatrix4(M); mesh.castShadow = mesh.receiveShadow = true; mesh.userData.shared = true; mesh.userData.slot = { L, k }; mesh.name = `${t.mod.id} ${t.mod.name}`; building.add(mesh);
    const [c, r] = cellOf(k), tag = LETTERS[letter++ % LETTERS.length];
    callouts.push({ tag, L, c, r, t });
    furnish(t, k, L, tag, building, labels, M);
  });
  const links = []; for (let L = 0; L < 3; L++) for (const cn of connections(L)) links.push({ L, through: false });
  cores(building);
  A.three.callouts = callouts; A.three.links = links; A.three.placed = null;
  applyHighlight();
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
  const counts = Object.fromEntries(CATS.map(([u]) => [u, A.modules.filter(m => m.use === u).length]));
  if (!counts[A.cat]) A.cat = CATS.find(([u]) => counts[u])?.[0] || 'lobby';
  R.cat.innerHTML = CATS.filter(([u]) => counts[u] || u !== 'som').map(([u, nm]) => `<option value="${u}"${u === A.cat ? ' selected' : ''}>${nm} · ${counts[u]}</option>`).join('');
  const ms = A.modules.filter(m => m.use === A.cat);
  R.palette.innerHTML = ms.map(m => `<button type="button" class="as-pal${A.pick === m.id ? ' on' : ''}${m.source === 'map' ? ' map' : ''}" data-pick="${m.id}" title="${esc(m.name)} · ${esc(m.note)}"><canvas width="120" height="120"></canvas><span><b style="color:${USE[m.use] ? USE[m.use].c : '#888'}">${esc(m.id)}</b>${esc(m.name)}</span></button>`).join('');
  $$('.as-pal canvas', R.palette).forEach((c, i) => c.getContext('2d').drawImage(planOf(ms[i], 1), 0, 0));
  const nCat = ms.filter(m => m.source === 'catalogue').length, nMap = ms.filter(m => m.source === 'map').length;
  R.catNote.textContent = A.cat === 'som' ? 'Tiles sent over from the Explorer with “Build with it”.' : A.cat === 'hybrid' ? `${nMap} from the maps — blends of two or three kinds of space.` : `${nCat} from the catalogue, then ${nMap} from the combination maps. Scroll for more.`;
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
function scramble(L, n = 10) {                                                      // the modules change places among themselves — the footprint of the building stays, nothing drifts apart
  if (A.scrambling) return; A.scrambling = true; pushHistory(); A.sel = null;
  const step = i => {
    const b = A.boards[L], filled = b.map((t, k) => t ? k : -1).filter(k => k >= 0);
    if (i >= n || filled.length < 2) { A.scrambling = false; build(); return; }
    const a = filled[Math.floor(Math.random() * filled.length)]; let c = filled[Math.floor(Math.random() * filled.length)]; if (c === a) c = filled[(filled.indexOf(a) + 1) % filled.length];
    moveTile(L, a, c); renderBoard(); setTimeout(() => step(i + 1), 240);         // moveTile swaps two occupied bays
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
    lines.push(pr.through ? `morphs into ${esc(other.mod.id)} ${esc(other.mod.name)} to the ${names[dir]}` : `beside ${esc(other.mod.id)} ${esc(other.mod.name)} to the ${names[dir]} — no mass meets, open seam`);
  }
  const below = L > 0 && A.boards[L - 1][k], above = L < 2 && A.boards[L + 1][k];
  if (below) lines.push(`stacked on ${esc(below.mod.id)} ${esc(below.mod.name)}`); else if (L > 0) lines.push('<i>nothing below — it floats; stack it on a module</i>');
  if (above) lines.push(`${esc(above.mod.id)} ${esc(above.mod.name)} stacked on top`);
  if (!lines.some((l, i) => i > 0 && !/float/.test(l))) lines.push('<i>no neighbours yet — slide it next to another module</i>');
  return lines.join('<br>');
}
function showTip(L, k, at) {                                                        // under the tile (above it near the bottom of the window), or under a point in the 3D view
  R.tip.innerHTML = tileInfo(L, k); R.tip.hidden = false;
  const r = R.tip.getBoundingClientRect(), s = at.getBoundingClientRect ? at.getBoundingClientRect() : { left: at.x - 8, top: at.y - 12, bottom: at.y + 12 }, vw = window.innerWidth, vh = window.innerHeight;
  R.tip.style.left = `${Math.max(8, Math.min(s.left, vw - r.width - 12))}px`;
  R.tip.style.top = `${s.bottom + 10 + r.height > vh - 8 ? s.top - r.height - 10 : s.bottom + 10}px`;
}
function hideTip() { R.tip.hidden = true; }
/* The building score: six things the brief asks for, each 0–100, and goals ticked when they are met. */
function score() {
  const mods = []; for (let L = 0; L < 3; L++) A.boards[L].forEach((t, k) => { if (t) mods.push({ t, k, L }); });
  if (!mods.length) return { total: 0, parts: [], goals: [] };
  const g = connectedGroups(), lob = mods.filter(m => m.t.mod.use === 'lobby'), gat = mods.filter(m => m.t.mod.use === 'social');
  const joined = 100 * (1 - (g.groups - 1) / Math.max(1, mods.length - 1));
  const onEdge = m => { const [c, r] = cellOf(m.k); return m.L === 0 && (r === 0 || c === 0 || c === SITE.cols - 1); };
  const street = lob.length ? 100 * lob.filter(onEdge).length / lob.length : 100;
  const around = m => { const out = []; for (const j of neighboursOf(m.k)) if (A.boards[m.L][j]) out.push(A.boards[m.L][j].mod.use); if (m.L > 0 && A.boards[m.L - 1][m.k]) out.push(A.boards[m.L - 1][m.k].mod.use); if (m.L < 2 && A.boards[m.L + 1][m.k]) out.push(A.boards[m.L + 1][m.k].mod.use); return out; };
  const withNb = mods.filter(m => around(m).length), mixed = withNb.length ? 100 * withNb.filter(m => around(m).some(u => u !== m.t.mod.use)).length / withNb.length : 100;
  const touching = m => around(m).length;
  const shared = gat.length ? 100 * gat.filter(m => touching(m) >= 2).length / gat.length : 100;
  const floating = mods.filter(m => m.L > 0 && !A.boards[m.L - 1][m.k]).length, grounded = 100 * (1 - floating / mods.length);
  let seams = 0, faces = 0; for (const m of mods) { seams += touching(m); faces += m.L > 0 ? 5 : 4; }
  const compact = Math.min(100, 100 * seams / Math.max(1, faces) * 2.2);
  const parts = [['Joined', joined, 'one building, not separate pieces'], ['Public edge', street, 'lobbies at ground on the street row or a causeway side'], ['Mixed', mixed, 'every module touching a module of another use — no block of one kind'], ['Shared rooms', shared, 'each gathering room touching two or more modules'], ['Grounded', grounded, 'nothing floating'], ['Compact', compact, 'modules touching, not scattered']];
  const total = Math.round(parts.reduce((s, p) => s + p[1], 0) / parts.length);
  const goals = [['One connected building', g.groups === 1], ['Every lobby on a public edge', lob.length > 0 && street === 100], ['Uses mixed, no block of one kind', withNb.length > 0 && mixed === 100], ['Every gathering room is shared', gat.length > 0 && shared === 100], ['All fifteen modules placed', new Set(mods.map(m => m.t.mod.id)).size >= 15], ['Nothing floats', floating === 0]];
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
/* The picked module — hovered, or else selected — lit everywhere: its part of the fused body brightens while the rest
   dims and greys, its letter grows, its tile and its callout are marked. (With separate modules, its mesh brightens.) */
const HI = {};
function hiMat(use) { if (!HI[use]) { const m = matFor(use).clone(); m.color.lerp(new THREE.Color(0xffffff), 0.45); m.emissive = new THREE.Color(0x3a2a28); HI[use] = m; } return HI[use]; }
function pickedSlot() { return A.hover || (A.sel != null ? `${A.layer}:${A.sel}` : null); }
function applyHighlight() {
  const T = A.three; if (!T || !T.building) return;
  const want = pickedSlot(), P = want && (T.placed || []).find(p => `${p.L}:${p.k}` === want), pid = P ? P.pid : 0;
  const mesh = T.building.children.find(o => o.name === 'Valve HQ · fused');
  if (mesh) {
    const g = mesh.geometry, labels = g.userData.labels, base = g.userData.baseColor, col = g.getAttribute('color'), arr = col.array;
    if (labels) {
      for (let v = 0, n = labels.length; v < n; v++) {
        const hit = labels[v] === pid, f = pid ? (hit ? 1.0 : 0.66) : 1.0, lift = pid && hit ? 0.42 : 0;
        for (let c = 0; c < 3; c++) { const b = base[v * 3 + c]; let x = b * f + lift * (1 - b); if (pid && !hit) { const grey = 0.299 * base[v * 3] + 0.587 * base[v * 3 + 1] + 0.114 * base[v * 3 + 2]; x = (x + grey * f) / 2; } arr[v * 3 + c] = x; }
      }
      col.needsUpdate = true;
    }
  } else T.building.children.forEach(o => { const t = o.userData.slot && A.boardAt(o.userData.slot); if (t) o.material = `${o.userData.slot.L}:${o.userData.slot.k}` === want ? hiMat(t.mod.use) : matFor(t.mod.use); });
  T.labels.children.forEach(sp => { const on = want && sp.userData.slot === want; sp.scale.set(on ? 9 : 6, on ? 9 : 6, 1); sp.material.opacity = want && !on ? 0.55 : 1; sp.material.transparent = true; });
  $$('.as-slot.hot', R.board).forEach(x => x.classList.remove('hot')); if (want && want.split(':')[0] == A.layer) { const el = R.board.querySelector(`.as-slot[data-k="${want.split(':')[1]}"]`); if (el) el.classList.add('hot'); }
  $$('.as-call', R.callouts).forEach(x => x.classList.toggle('on', x.dataset.slot === want));
}
/* Picking in the 3D view: the ray through the pointer, the face it hits, the module that face belongs to. */
function pick3d(x, y) {
  const T = A.three; if (!T) return null;
  const rect = T.canvas.getBoundingClientRect(), v = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
  const ray = T.ray || (T.ray = new THREE.Raycaster()); ray.setFromCamera(v, T.camera);
  const targets = T.building.children.filter(o => o.name === 'Valve HQ · fused' || o.userData.slot);
  const hit = ray.intersectObjects(targets, false)[0]; if (!hit) return null;
  if (hit.object.userData.slot) return hit.object.userData.slot;
  const labels = hit.object.geometry.userData.labels, f = hit.face; if (!labels || !f) return null;
  const votes = [labels[f.a], labels[f.b], labels[f.c]], pid = votes.sort((u, w) => votes.filter(q => q === w).length - votes.filter(q => q === u).length)[0];
  const P = (T.placed || []).find(p => p.pid === pid); return P ? { L: P.L, k: P.k } : null;
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
    + prs.map(x => { const [c, r] = cellOf(x.a); const cls = x.through ? ' fused' : ' wall'; const title = x.through ? 'the two modules morph into each other across the seam' : 'no mass meets: the seam stays open'; return `<i class="as-link ${x.axis}${cls}" style="--c:${c};--r:${r}" title="${title}"></i>`; }).join('');
  $$('.as-slot canvas', R.board).forEach(cv => { const k = +cv.parentElement.dataset.k, t = cv.classList.contains('below') ? below[k] : b[k]; cv.getContext('2d').drawImage(planOf(t.mod, t.rot), 0, 0); });
  if (before) glide(before);
  renderStats(); renderScore(); save();
}
function renderStats() {
  const g = connectedGroups(), uses = { lobby: 0, office: 0, social: 0, hybrid: 0, som: 0 }; let area = 0;
  for (let l = 0; l < 3; l++) A.boards[l].forEach(t => { if (!t) return; uses[t.mod.use]++; area += t.mod.an.floors.length * LAT * LAT; });
  const hint = g.modules ? (g.groups === 1 ? 'Every module is reachable — the seams and cores join them all.' : `${g.groups} separate groups: slide a module beside another, or stack one, to join them.`) : 'Drag a module from the palette onto a bay, or click one then click a bay.';
  R.stats.innerHTML = `<b>${g.modules}</b> modules · <b>${Math.round(area).toLocaleString('en-US')}</b> m² of floor · ${uses.lobby} lobby · ${uses.office} office · ${uses.social} gathering${uses.hybrid ? ` · ${uses.hybrid} hybrid` : ''}${uses.som ? ` · ${uses.som} from the Explorer` : ''}<br><span class="hint">${hint}</span>`;
}
function renderCallouts() {
  const cs = A.three && A.three.callouts || [];
  R.callouts.innerHTML = cs.length ? cs.map(({ tag, L, c, r, t }) => `<div class="as-call" data-slot="${L}:${idx(c, r)}" title="click to select the module"><b style="background:${USE[t.mod.use] ? USE[t.mod.use].c : '#888'}">${tag}</b><div><div class="n">${esc(t.mod.id)} ${esc(t.mod.name)} <small>· ${esc(t.mod.typology)}</small></div><div class="hint">Bay ${'ABCDEFG'[c]}${r + 1} · ${LAYERS[L].split(' ·')[0]} · turned ${t.rot * 90}° · ${esc(t.mod.note)}</div></div></div>`).join('') : '<p class="hint">The building follows the board: place modules to see them here, each with where it came from.</p>';
  const links = A.three && A.three.links || [], nf = links.filter(l => l.through).length, no = links.length - nf;
  R.linkNote.textContent = links.length ? `${nf} seams where neighbours morph into each other, ${no} open seams, ${stacks().length} cores where modules stack (the first is the red stair).` : '';
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
    <p class="hint">Drag a module onto a bay (or click it, then a bay). Pick a kind of space in the drop-down: the fifteen of the catalogue, the best in-betweens of the combination maps, and the hybrids.</p>
    <div class="as-palhead"><select data-v="cat" class="as-cat" aria-label="Kind of space"></select><span class="hint" data-v="catNote"></span></div>
    <div class="as-palette" data-v="palette"></div>
    <h2 class="eyebrow" style="margin-top:16px">The board</h2>
    <div class="xp-row"><button type="button" class="btn" data-v="auto">Auto-arrange</button><button type="button" class="btn quiet" data-v="shuffle" title="The modules on this layer change places among themselves; the footprint stays">Scramble</button><button type="button" class="btn quiet" data-v="clear">Clear layer</button></div>
    <div class="xp-row"><button type="button" class="btn quiet" data-v="undo" title="Ctrl/⌘ Z">Undo</button><button type="button" class="btn quiet" data-v="redo" title="Ctrl/⌘ Shift Z">Redo</button><button type="button" class="btn quiet" data-v="remove" title="Delete, or drag a tile off the board">Remove</button></div>
    <p class="hint">It is a sliding puzzle: click a tile with one empty bay beside it and it slides there; drag any tile to any bay (onto another tile to swap); drag it off the board to take it out; arrow keys slide the selected tile, R (or a double-click) turns it, 1 2 3 change layer. Three layers: ground on pilotis, two above — a tile on an upper layer needs a module below it.</p>
    <h2 class="eyebrow" style="margin-top:16px">The building</h2>
    <label class="chk"><input type="checkbox" data-opt="fuse" checked> Fuse the modules — they morph into each other across the seams</label>
    <label class="chk"><input type="checkbox" data-opt="cores" checked> Cores where modules stack, grown into the body</label>
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
  // ---- picking in the 3D view
  let p3 = null, hoverRaf = 0;
  const goTo = slot => { if (A.layer !== slot.L) A.layer = slot.L; A.sel = slot.k; A.hover = null; renderBoard(false); applyHighlight(); };
  R.canvas.addEventListener('pointerdown', e => { p3 = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  R.canvas.addEventListener('pointerup', e => {
    const d = p3; p3 = null; if (!d || e.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;    // a still press is a click; a drag is the orbit
    const hit = pick3d(e.clientX, e.clientY);
    if (hit) { if (A.sel === hit.k && A.layer === hit.L) select(null); else goTo(hit); } else select(null);
  });
  R.canvas.addEventListener('pointermove', e => {
    if (p3 || drag) return; const x = e.clientX, y = e.clientY;
    cancelAnimationFrame(hoverRaf); hoverRaf = requestAnimationFrame(() => {
      const hit = pick3d(x, y), key = hit ? `${hit.L}:${hit.k}` : null;
      R.canvas.style.cursor = hit ? 'pointer' : '';
      if (key !== A.hover) { A.hover = key; applyHighlight(); }
      if (hit) showTip(hit.L, hit.k, { x, y }); else hideTip();
    });
  });
  R.canvas.addEventListener('pointerleave', () => { cancelAnimationFrame(hoverRaf); if (A.hover) { A.hover = null; applyHighlight(); } hideTip(); R.canvas.style.cursor = ''; });
  R.callouts.addEventListener('click', e => { const c = e.target.closest('.as-call'); if (!c) return; const [L, k] = c.dataset.slot.split(':').map(Number); if (A.sel === k && A.layer === L) select(null); else { goTo({ L, k }); focusOn(L, k); } });
  R.callouts.addEventListener('pointerover', e => { const c = e.target.closest('.as-call'); if (!c) return; A.hover = c.dataset.slot; applyHighlight(); });
  R.callouts.addEventListener('pointerleave', () => { A.hover = null; applyHighlight(); });
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
  R.shuffle.addEventListener('click', () => scramble(A.layer));
  R.clear.addEventListener('click', () => { pushHistory(); clearLayer(A.layer); A.sel = null; renderBoard(); build(); });
  R.undo.addEventListener('click', undo); R.redo.addEventListener('click', redo);
  R.remove.addEventListener('click', () => { if (A.sel != null) { pushHistory(); A.boards[A.layer][A.sel] = null; A.sel = null; renderBoard(); build(); } });
  $$('[data-opt]', root).forEach(x => x.addEventListener('change', () => { A.opts[x.dataset.opt] = x.checked; build(); }));
  R.cat.addEventListener('change', () => { A.cat = R.cat.value; A.pick = null; renderPalette(); R.palette.scrollTop = 0; });
  R.png.addEventListener('click', () => { const { renderer, scene, camera } = A.three; renderer.render(scene, camera); renderer.domElement.toBlob(b => download(b, 'ProtoSpace-ValveHQ-building.png')); });
  R.plan.addEventListener('click', () => planPicture().toBlob(b => download(b, `ProtoSpace-ValveHQ-plan-${['ground', 'level2', 'level3'][A.layer]}.png`)));
  R.glb.addEventListener('click', () => new GLTFExporter().parse(A.three.building, out => download(new Blob([out], { type: 'model/gltf-binary' }), 'ProtoSpace-ValveHQ.glb'), err => console.error(err), { binary: true }));
  R.obj.addEventListener('click', () => download(new Blob([new OBJExporter().parse(A.three.building)], { type: 'text/plain' }), 'ProtoSpace-ValveHQ.obj'));
  R.stats.textContent = 'Loading the fifteen modules…';
  loadBuiltins().then(() => { A.ready = true; renderPalette(); if (!load()) autoArrange(7); else { renderBoard(false); build(); } setTimeout(() => setView('street'), 400); }).catch(err => { R.stats.textContent = 'The modules could not be loaded: ' + (err.message || err); });
  return { show() { window.dispatchEvent(new Event('resize')); }, addModule };
}

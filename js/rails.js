/* ProtoSpace Analyzer — the public floor that folds (Rationalize tab).

   The ground of the building is the public's, and the foot of its ground modules — the lobbies, the gathering rooms,
   the hybrids — folds into itself to clear the floor, and unfolds again to make the rooms.

   Only the lowest storeys of the ground modules do this (two by default: the line is `yFold`); what is above them
   stays in the merged body, with its floors. To do it the foot of every ground module is redrawn as a vault: the
   module's own silhouette, seen along the building, pressed down under that line and swept the length of its bay. A vault is open at both ends and stands on its two long walls, which run on rails: there are no columns
   on the public floor, the walls of the vaults carry everything.

   A vault keeps its skin only near the mass of the module it was drawn from: where the module is open, the vault is
   open, between a sill along each rail and a frame at each end. So a lobby that was an open hall is an open frame,
   and a closed room stays closed.

   One or two vaults in every row do not move. They are the garages: the other vaults slide along the rails into the
   nearer garage and nest there, each one inside the one before. So that they can, a vault is trimmed to fit inside the
   one it slides into (a wall's thickness and a hand's width smaller all round) — the nearer to its garage, the larger.
   The garages stand under the rest of the building and carry it on a wall across each of their two ends, which the sliding
   vaults pass through.

   Unfolded: one vault to a bay, the rooms opening into each other end to end.
   Folded: the vaults nested in their garages, the rest of the deck open.

   planRails(b, fields, { yBase, H, tf, yFold })  → the plan (or null when nothing stands on the ground layer)
   buildRails(plan, mats)                 → a THREE.Group: the deck, the rails, the vaults, the garage walls
   moveBlocks(group, s)                   → the vaults at s = 0 (unfolded) … 1 (folded) */
import * as THREE from 'three';
import { netsField, voronoi3 } from './sdf.js';
import { taubin } from './fuse.js';

const WALL = 0.5, GAP = 0.3, STEP = 0.3, NEAR = 1.6, SILL = 0.9, RING = 1.2;                                             // a vault's wall · the play between two nested vaults · the sampling step · how far from its module's mass a vault keeps its skin · the sill along the rails · the frame at each end (m)
const ROOM = 4.5, RIB = 0.6;                                                         // the least height of a vault over its own footprint · the garage walls' thickness (m)

/* Signed distance (m, negative inside) to the edge of a mask on a grid of step h: to the midpoints of the cell edges
   where the mask changes. Small grids only. */
function distance2(mask, W, H, h) {
  const bx = [], by = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const m = mask[x + W * y]; if (x + 1 < W && mask[x + 1 + W * y] !== m) { bx.push(x + 0.5); by.push(y); } if (y + 1 < H && mask[x + W * (y + 1)] !== m) { bx.push(x); by.push(y + 0.5); } }
  const out = new Float32Array(W * H), n = bx.length;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let best = 1e9; for (let k = 0; k < n; k++) { const dx = bx[k] - x, dy = by[k] - y, d = dx * dx + dy * dy; if (d < best) best = d; }
    out[x + W * y] = (mask[x + W * y] ? -1 : 1) * (n ? Math.sqrt(best) : 1e3) * h;
  }
  return out;
}
function blur2(a, W, H, passes) {
  let s = a, t = new Float32Array(W * H);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let v = 0, n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; v += s[X + W * Y]; n++; } t[x + W * y] = v / n; }
    [s, t] = [t, s];
  }
  return s;
}

export function planRails(b, fields, { yBase, H, tf, yFold = Infinity, vor = null }) {
  const site = b.site, ground = b.mods.map((m, i) => ({ m, i })).filter(q => q.m.L === 0); if (!ground.length || !site || !fields) return null;
  const yDeck = yBase + tf, yTop = Math.min((b.PODIUM_V + b.PITCH_V) * b.LAT, yFold), LAT = b.LAT;      // the deck's top · the underside of what stays above: the level above, or the ground modules' own upper storeys
  const z0w = -b.gridZ(0), dzw = -(b.gridZ(1) - b.gridZ(0)), y0w = b.gridY(0), dyw = b.gridY(1) - b.gridY(0);   // lattice → depth from the street edge, height
  const pitchX = site.slotX + site.gapX, pitchZ = site.slotZ + site.gapZ, h = STEP, PADY = 4;
  const yRoom = yDeck + ROOM, squash = Math.min(1, Math.max(0, (yTop - GAP - yRoom) / ((b.PODIUM_V + b.PITCH_V) * b.LAT - GAP - yRoom)));   // a module's roofline above a room's height is pressed into what the part that folds leaves: 1 when the whole ground level folds
  const rows = [], decks = [], rails = [], vaults = [], ribs = [];
  for (const r of [...new Set(ground.map(q => q.m.r))].sort()) {
    const here = ground.filter(q => q.m.r === r).sort((a, c) => a.m.c - c.m.c), n = here.length;
    const dW = site.z0 + r * pitchZ, dE = dW + site.slotZ, dA = dW - 1.5, W = Math.round((dE - dW + 3) / h) + 1, yA = yDeck - PADY, Hh = Math.round((yTop - yA + 1.5) / h) + 1;
    const deckRow = Math.ceil((yDeck - yA) / h);                                    // the first row of the profile above the deck
    // every module's silhouette along the building, as a mask on (depth, height): its skyline, at least a room high
    const profile = F => {
      const hz = new Float32Array(F.nz), tops = [];                                 // per depth: the height that three quarters of the columns along the building stay under
      for (let z = 0; z < F.nz; z++) {
        tops.length = 0;
        for (let x = 0; x < F.nx; x++) { let top = -1; for (let y = F.ny - 1; y >= 0; y--) if (F.d[x + F.nx * (y + F.ny * z)] < 0) { top = y; break; } if (top >= 0) tops.push(top); }
        if (tops.length >= 3) { tops.sort((a, c) => a - c); hz[z] = y0w + (F.y0 + tops[Math.floor(0.75 * (tops.length - 1))] + 0.5) * dyw; }
      }
      const occ = new Float32Array(W * Hh);
      for (let k = 0; k < W; k++) {
        const gz = (dA + k * h - z0w) / dzw - F.z0; if (gz < 0 || gz > F.nz - 1) continue; const zi = Math.min(F.nz - 2, Math.floor(gz)), tz = gz - zi;
        if (!hz[zi] && !hz[zi + 1]) continue;
        const raw = Math.max(hz[zi] * (1 - tz) + hz[zi + 1] * tz, hz[zi] && hz[zi + 1] ? 0 : Math.max(hz[zi], hz[zi + 1]), yRoom);
        const top = Math.min(yRoom + (raw - yRoom) * squash, yTop - GAP);          // the module's own skyline, pressed under what stays above, a hand's width clear of it
        for (let j = deckRow; j < Hh && yA + j * h <= top; j++) occ[k + W * j] = 1;
      }
      const soft = blur2(occ, W, Hh, 8), mask = new Uint8Array(W * Hh);
      for (let j = deckRow; j < Hh; j++) for (let k = 0; k < W; k++) mask[k + W * j] = soft[k + W * j] > 0.5 ? 1 : 0;
      return mask;
    };
    const grounded = mask => { for (let j = 0; j < deckRow; j++) for (let k = 0; k < W; k++) mask[k + W * j] = mask[k + W * deckRow]; return mask; };   // the walls go on below the deck, so trimming never lifts them off it
    // the garages: one for a short row, two for a long one, under the middle of the building; every other vault goes to the nearer
    const gar = n >= 5 ? [Math.round((n - 1) / 3), Math.round(2 * (n - 1) / 3)] : [Math.floor((n - 1) / 2)];
    const home = here.map((q, k) => gar.reduce((best, gk) => Math.abs(k - gk) < Math.abs(k - best) ? gk : best, gar[0]));
    const row = { r, dW, dE, xa: site.x0 + here[0].m.c * pitchX, xb: site.x0 + here[n - 1].m.c * pitchX + site.slotX, vaults: [] };
    for (const gk of gar) {
      const pack = here.map((q, k) => k).filter(k => home[k] === gk).sort((a, c) => Math.abs(a - gk) - Math.abs(c - gk) || a - c);   // the garage first, then outwards
      let prev = null;
      pack.forEach((k, order) => {
        const q = here[k], mask = grounded(profile(fields[q.i]));
        if (prev) for (let p = 0; p < mask.length; p++) if (prev[p] > -(WALL + GAP)) mask[p] = 0;     // trimmed to slide inside the vault before it
        const sd = distance2(mask, W, Hh, h); prev = sd;
        let ka = W, kb = -1; for (let kk = 0; kk < W; kk++) if (mask[kk + W * (deckRow + 1)]) { if (kk < ka) ka = kk; if (kk > kb) kb = kk; }
        let top = deckRow; for (let j = deckRow; j < Hh; j++) for (let kk = 0; kk < W; kk++) if (mask[kk + W * j]) top = j;
        const xc = site.x0 + q.m.c * pitchX + site.slotX / 2, xg = site.x0 + here[gk].m.c * pitchX + site.slotX / 2;
        const v = { i: q.i, id: q.m.id, use: q.m.use, garage: k === gk, order, xc, xg, L: site.slotX, F: fields[q.i], sd, W, H: Hh, dA, yA, d0: dA + ka * h, d1: dA + kb * h, top: yA + top * h };
        vaults.push(v); row.vaults.push(v);
        if (!v.garage && kb > ka) for (const d of [v.d0 + WALL / 2, v.d1 - WALL / 2]) rails.push({ x0: Math.min(xc, xg) - v.L / 2, x1: Math.max(xc, xg) + v.L / 2, d });
        if (v.garage) for (const x of [xc - v.L / 2 + RIB / 2, xc + v.L / 2 - RIB / 2]) ribs.push({ x, v });
      });
    }
    decks.push({ x0: row.xa, x1: row.xb, d0: dW, d1: dE }); rows.push(row);
  }
  const hall = rows.reduce((a, q) => a + (q.xb - q.xa) * (q.dE - q.dW), 0), gar = vaults.filter(v => v.garage), room = v => v.L * Math.max(0, v.d1 - v.d0 - 2 * WALL);
  return { yBase, yDeck, yTop, tf, h, vor, rows, decks, rails, vaults, ribs, map: { x0w: b.gridX(0), dxw: b.gridX(1) - b.gridX(0), y0w, dyw, z0w, dzw },
    stats: { hall, height: yTop - yBase, storeys: Math.round((yTop - yBase) / H), open: hall - gar.reduce((a, v) => a + v.L * (v.d1 - v.d0), 0), rooms: vaults.length, roomArea: vaults.reduce((a, v) => a + room(v), 0), garages: gar.map(v => v.id), sliding: vaults.length - gar.length, length: Math.max(...rows.map(q => q.xb - q.xa)), depth: rows[0].dE - rows[0].dW } };
}

/* A field on a box of the world, sampled every `h` and meshed. fn(x, y, depth) → metres, negative inside. */
function meshOf(fn, x0, x1, y0, y1, d0, d1, h, smooth = 2) {
  const NX = Math.ceil((x1 - x0) / h) + 1, NY = Math.ceil((y1 - y0) / h) + 1, NZ = Math.ceil((d1 - d0) / h) + 1, F = new Float32Array(NX * NY * NZ); let o = 0;
  for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) F[o++] = fn(x0 + i * h, y0 + j * h, d0 + k * h, i, j, k);
  const { pos, index } = netsField(F, NX, NY, NZ); if (!index.length) return null;
  if (smooth) taubin(pos, index, smooth);
  for (let v = 0; v < pos.length; v += 3) { pos[v] = x0 + pos[v] * h; pos[v + 1] = y0 + pos[v + 1] * h; pos[v + 2] = -(d0 + pos[v + 2] * h); }
  for (let t = 0; t < index.length; t += 3) { const a = index[t + 1]; index[t + 1] = index[t + 2]; index[t + 2] = a; }   // z is mirrored: turn the faces back out
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(index, 1)); g.computeVertexNormals(); return g;
}

export function buildRails(plan, mats) {
  const group = new THREE.Group(); group.name = 'Valve HQ · the public floor that folds';
  const { yBase, yDeck, yTop, tf, h } = plan, moving = [], mp = plan.map;
  const massOf = F => (x, y, d) => {                                                 // the module's own signed distance (m) at a point of the world
    const gx = Math.min(F.nx - 1.001, Math.max(0, (x - mp.x0w) / mp.dxw - F.x0)), gy = Math.min(F.ny - 1.001, Math.max(0, (y - mp.y0w) / mp.dyw - F.y0)), gz = Math.min(F.nz - 1.001, Math.max(0, (d - mp.z0w) / mp.dzw - F.z0));
    const xi = Math.floor(gx), yi = Math.floor(gy), zi = Math.floor(gz), tx = gx - xi, ty = gy - yi, tz = gz - zi, i = xi + F.nx * (yi + F.ny * zi), sxy = F.nx * F.ny, f = F.d;
    const c00 = f[i] + (f[i + 1] - f[i]) * tx, c10 = f[i + F.nx] + (f[i + F.nx + 1] - f[i + F.nx]) * tx, c01 = f[i + sxy] + (f[i + sxy + 1] - f[i + sxy]) * tx, c11 = f[i + sxy + F.nx] + (f[i + sxy + F.nx + 1] - f[i + sxy + F.nx]) * tx;
    const c0 = c00 + (c10 - c00) * ty, c1 = c01 + (c11 - c01) * ty; return c0 + (c1 - c0) * tz;
  };
  const box = (name, el, mat, list) => {
    if (!list.length) return; const geo = new THREE.BoxGeometry(1, 1, 1), im = new THREE.InstancedMesh(geo, mat, list.length), M = new THREE.Matrix4(), Q = new THREE.Quaternion(); im.castShadow = im.receiveShadow = true; im.name = name;
    list.forEach((q, k) => { M.compose(q.p, Q, q.s); im.setMatrixAt(k, M); }); im.userData = { element: el, items: list.map(() => ({ i: -1, n: 0 })), shared: true }; group.add(im);
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  box('deck', 1, mats.solid, plan.decks.map(q => ({ p: V((q.x0 + q.x1) / 2, yBase + tf / 2, -(q.d0 + q.d1) / 2), s: V(q.x1 - q.x0, tf, q.d1 - q.d0) })));
  box('rails', 7, mats.dark, plan.rails.map(q => ({ p: V((q.x0 + q.x1) / 2, yDeck + 0.03, -q.d), s: V(q.x1 - q.x0, 0.06, 0.12) })));
  const at = (v, y, d) => { const k = Math.min(v.W - 1, Math.max(0, Math.round((d - v.dA) / h))), j = Math.min(v.H - 1, Math.max(0, Math.round((y - v.yA) / h))); return v.sd[k + v.W * j]; };
  const add = (g, v, el, mat, name) => { if (!g) return null; const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; m.name = name; m.userData = { element: el, mods: new Int16Array(g.getAttribute('position').count).fill(v.i) }; group.add(m); return m; };
  for (const v of plan.vaults) {
    const mass = massOf(v.F), near = NEAR + v.order * (WALL + GAP), VO = {}, web = plan.vor;   // a trimmed vault stands further in from its module's surface
    /* With the Voronoi web the skin is a net of ribs: a cell is closed where its seed lies in or near the module's mass and
       open elsewhere. Without it, the skin simply stops where the module's mass is far. */
    const skin = web ? (x, y, d) => { voronoi3(x, y, d, web.cell, web.jit, VO); return mass(VO.sx, VO.sy, VO.sz) < near ? -1 : VO.edge - Math.max(web.rib, 1.1 * STEP); } : (x, y, d) => mass(x, y, d) - near;
    const g = meshOf((x, y, d) => { const s = at(v, y, d), sh = Math.max(s, -(s + WALL)), ax = Math.abs(x - v.xc); if (sh > 0.6) return sh;
      return Math.max(sh, ax - (v.L / 2 - 0.15), yDeck - y, Math.min(skin(x, y, d), y - (yDeck + SILL), (v.L / 2 - RING) - ax)); }, v.xc - v.L / 2 - h, v.xc + v.L / 2 + h, yDeck - h, v.top + 2 * h, v.d0 - 2 * h, v.d1 + 2 * h, h);
    const m = add(g, v, v.garage ? 0 : 8, v.garage ? mats.solid : mats.block, `${v.id} · ${v.garage ? 'garage vault' : 'sliding vault'}`);
    if (m && !v.garage) moving.push({ m, dx: v.xg - v.xc });
  }
  for (const q of plan.ribs) {                                                       // across each end of a garage: from its vault up to the level above, open where the vaults pass
    const v = q.v, VO = {}, web = plan.vor, rb = web ? Math.max(web.rib, 1.1 * STEP) : 0;
    const g = meshOf((x, y, d) => {
      const w = Math.max(Math.abs(x - q.x) - RIB / 2, -(at(v, y, d) + WALL - 0.05), v.d0 - d, d - v.d1, yDeck - y, y - yTop); if (!web || w > 0.6) return w;
      if (at(v, y, d) < 0.5 || y > yTop - 0.7 || d < v.d0 + 0.6 || d > v.d1 - 0.6) return w;   // a frame round the opening, under the level above and down both sides
      voronoi3(q.x, y, d, web.cell, web.jit, VO); return Math.max(w, VO.edge - rb); }, q.x - RIB / 2 - 2 * h, q.x + RIB / 2 + 2 * h, yDeck - h, yTop + h, v.d0 - 2 * h, v.d1 + 2 * h, h, 0);
    add(g, v, 0, mats.solid, `${v.id} · garage wall`);
  }
  group.userData = { moving };
  return group;
}

export function moveBlocks(group, s) {
  const k = Math.min(1, Math.max(0, s)), e = k * k * (3 - 2 * k);
  for (const q of group.userData.moving || []) q.m.position.x = q.dx * e;
}

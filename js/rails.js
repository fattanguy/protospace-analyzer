/* ProtoSpace Analyzer — the public floor on rails (Rationalize tab).

   The ground storey of the building is given to the public. The shells of the ground modules are lifted: they start at
   the first storey line (one storey above the deck) and stand on thin posts, so the deck under them is one open floor.
   What divides that floor are blocks on tracks: ten tracks run the length of every row of bays, a tenth of a bay apart,
   and a block stands on each track at every seam between two bays. Walls in: the blocks line up on the seams, one room
   to a bay. Walls out: they roll along their tracks onto the deck beyond the two ends of the building, and the rooms
   merge into one hall.

   The posts stand only on the lines between two tracks, under the places where a shell wall crosses that line, so no
   post is ever in the way of a block.

   planRails(U, b, { yBase, H, t, tf }) → the plan (or null when nothing stands on the ground layer)
   buildRails(plan, mats)              → a THREE.Group of instanced boxes (deck, rails, posts, blocks)
   moveBlocks(group, s)                → the blocks at s = 0 (in) … 1 (out) */
import * as THREE from 'three';

const TRACKS = 10;                                                                  // tracks to a bay's depth
const BLOCK_H = 3.6, POST = 0.3, CLEAR = 0.15;                                       // a block's height · a post's side · the gap either side of a block (m)
const LEAD = 4, PARK_GAP = 0.9;                                                      // from the building's end to the first parked block · between parked blocks (m)

export function planRails(U, b, { yBase, H, t, tf }) {
  const site = b.site, ground = b.mods.filter(m => m.L === 0); if (!ground.length || !site) return null;
  const yDeck = yBase + tf, yCut = yBase + H;                                       // the deck's top (a plate lies on its level line) · where the shells now start
  const gx0 = b.gridX(0), dgx = b.gridX(1) - gx0, gy0 = b.gridY(0), dgy = b.gridY(1) - gy0, gz0 = b.gridZ(0), dgz = b.gridZ(1) - gz0;
  const { nx, ny, nz, f } = U, sxy = nx * ny;
  const F = (wx, wy, wz) => {                                                        // the union's signed distance (m) at a point in the world
    const x = Math.min(nx - 1.001, Math.max(0, (wx - gx0) / dgx - U.x0)), y = Math.min(ny - 1.001, Math.max(0, (wy - gy0) / dgy - U.y0)), z = Math.min(nz - 1.001, Math.max(0, (wz - gz0) / dgz - U.z0));
    const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z), tx = x - x0, ty = y - y0, tz = z - z0, i = x0 + nx * (y0 + ny * z0);
    const c00 = f[i] + (f[i + 1] - f[i]) * tx, c10 = f[i + nx] + (f[i + nx + 1] - f[i + nx]) * tx, c01 = f[i + sxy] + (f[i + sxy + 1] - f[i + sxy]) * tx, c11 = f[i + sxy + nx] + (f[i + sxy + nx + 1] - f[i + sxy + nx]) * tx;
    const c0 = c00 + (c10 - c00) * ty, c1 = c01 + (c11 - c01) * ty; return c0 + (c1 - c0) * tz;
  };
  const inWall = (wx, wz) => { const v = F(wx, yCut + 0.3, wz); return v < 0 && v > -(t + 0.05); };
  const pitchX = site.slotX + site.gapX, pitchZ = site.slotZ + site.gapZ, bw = site.slotZ / TRACKS, bl = bw;   // a block is as long as a track is wide: three cells
  const rows = [], decks = [], rails = [], posts = [], blocks = [];
  for (const r of [...new Set(ground.map(m => m.r))].sort()) {
    const cs = [...new Set(ground.filter(m => m.r === r).map(m => m.c))].sort((a, c) => a - c), has = new Set(cs);
    const xa = site.x0 + cs[0] * pitchX, xb = site.x0 + cs[cs.length - 1] * pitchX + site.slotX, dW = site.z0 + r * pitchZ, dE = dW + site.slotZ;   // depth from the street edge of the lot (z = −depth)
    const seams = []; for (const c of cs) if (has.has(c + 1)) seams.push(site.x0 + (c + 1) * pitchX - site.gapX / 2);
    const nN = Math.ceil(seams.length / 2), nS = seams.length - nN, step = bl + PARK_GAP;
    const apron = n => n ? LEAD + n * step + 1.2 : 0, aN = Math.min(apron(nN), Math.max(0, xa - 0.5)), aS = Math.min(apron(nS), Math.max(0, site.length - xb - 0.5));
    const park = (n, room) => n && LEAD + n * step > room ? Math.max(bl + 0.1, (room - LEAD - 0.6) / n) : step;   // closer together where the lot runs out
    const stN = park(nN, aN), stS = park(nS, aS);
    decks.push({ x0: xa - aN, x1: xb + aS, d0: dW, d1: dE });
    for (let j = 0; j < TRACKS; j++) {
      const d = dW + bw * (j + 0.5);
      for (const off of [-0.72, 0.72]) rails.push({ x0: xa - aN + 0.4, x1: xb + aS - 0.4, d: d + off });
      seams.forEach((sx, k) => {
        const out = k < nN ? xa - LEAD - bl / 2 - (nN - 1 - k) * stN : xb + LEAD + bl / 2 + (k - nN) * stS;
        blocks.push({ d, xin: sx, xout: out, row: r, seam: k, track: j });
      });
    }
    for (let j = 0; j <= TRACKS; j++) {                                              // posts: on the lines between tracks, under a shell wall
      const d = dW + bw * j; let start = null, last = null;
      const flush = () => { if (start == null) return; const len = last - start, n = Math.max(1, Math.round(len / 5.4)); for (let q = 0; q < n; q++) posts.push({ x: start + len * (q + 0.5) / n, d }); start = null; };
      for (let x = xa; x <= xb + 1e-6; x += 0.3) { if (inWall(x, -d)) { if (start != null && x - last > 1.5) flush(); if (start == null) start = x; last = x; } }
      flush();
    }
    rows.push({ r, xa, xb, dW, dE, seams, bays: cs.length });
  }
  const hall = rows.reduce((a, q) => a + (q.xb - q.xa) * (q.dE - q.dW), 0), nSeams = rows.reduce((a, q) => a + q.seams.length, 0);
  return { yBase, yDeck, yCut, tf, bw, bl, rows, decks, rails, posts, blocks,
    stats: { hall, blocks: blocks.length, tracks: rows.length * TRACKS, posts: posts.length, rooms: rows.reduce((a, q) => a + q.bays, 0), room: nSeams ? (hall - blocks.length * bl * (bw - 2 * CLEAR)) / rows.reduce((a, q) => a + q.bays, 0) : hall, length: Math.max(...rows.map(q => q.xb - q.xa)), depth: rows[0].dE - rows[0].dW } };
}

export function buildRails(plan, mats) {
  const group = new THREE.Group(); group.name = 'Valve HQ · public floor on rails';
  const geo = new THREE.BoxGeometry(1, 1, 1), M = new THREE.Matrix4(), Q = new THREE.Quaternion();
  const inst = (name, el, mat, list) => {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, list.length); im.castShadow = im.receiveShadow = true; im.name = name;
    list.forEach((q, k) => { M.compose(q.p, Q, q.s); im.setMatrixAt(k, M); });
    im.userData = { element: el, items: list.map(() => ({ i: -1, n: 0 })), shared: true }; group.add(im); return im;
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z), { yBase, yDeck, yCut, tf, bw, bl } = plan;
  inst('deck', 1, mats.solid, plan.decks.map(q => ({ p: V((q.x0 + q.x1) / 2, yBase + tf / 2, -(q.d0 + q.d1) / 2), s: V(q.x1 - q.x0, tf, q.d1 - q.d0) })));
  inst('rails', 7, mats.dark, plan.rails.map(q => ({ p: V((q.x0 + q.x1) / 2, yDeck + 0.03, -q.d), s: V(q.x1 - q.x0, 0.06, 0.09) })));
  inst('posts', 0, mats.solid, plan.posts.map(q => ({ p: V(q.x, (yDeck + yCut) / 2 + 0.1, -q.d), s: V(POST, yCut - yDeck + 0.2, POST) })));
  const size = V(bl, BLOCK_H, bw - 2 * CLEAR), im = inst('blocks', 8, mats.block, plan.blocks.map(q => ({ p: V(q.xin, yDeck + 0.12 + BLOCK_H / 2, -q.d), s: size })));
  group.userData = { blocks: im, plan, size };
  return group;
}

export function moveBlocks(group, s) {
  const { blocks: im, plan, size } = group.userData; if (!im) return;
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), p = new THREE.Vector3(), k = Math.min(1, Math.max(0, s)), e = k * k * (3 - 2 * k);
  plan.blocks.forEach((q, n) => { p.set(q.xin + (q.xout - q.xin) * e, plan.yDeck + 0.12 + BLOCK_H / 2, -q.d); M.compose(p, Q, size); im.setMatrixAt(n, M); });
  im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere?.();
}

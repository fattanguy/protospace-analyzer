/* ProtoSpace Analyzer — roots (Rationalize tab).

   When the public floor folds, what stays above it has to stand on something once the vaults have slid away. So as
   the modules merge, the building grows four roots, one towards each far corner of the row of ground bays (its two
   ends, on both long edges). A root does not simply hang from the corner: it stands as near the corner as the
   building has real mass over it — it looks, up to a bay and a half in, for the place with the most material
   standing above (the inside of a thick body counting for more than a thin wall or a neck), and starts its branches
   at the lowest points of the body there. The branches run to the edge, join into one thick trunk outside the path
   of the sliding vaults, and that trunk comes down past the deck as a straight pillar, plumb for its last metres,
   so that it meets the ground as a circle. No foot, no toes.

   The outer shell is the structure: where a root flares out of it, and in a pier straight above every pillar, the
   shell keeps no openings, so the load of the levels above has a wall to come down in; and beyond the last root, where
   an end of the building overhangs, the shell is a closed tube.

   Roots extend with the merge: none at 0, hanging part of the way down at a small merge, on the ground at 3 m, and
   thicker beyond. The merge also sets how far a root flares into the body it grows from (a smooth union with the
   body, like every other merge on this page). No two of the four are alike: each has its own girth, its own number
   of branches, its own slight lean.

   Nothing of a root is in the way of the vaults: inside the row it stays above the line the vaults pass under, and
   it only comes down outside the deck's edge.

   planRoots(b, U, rails, { k })  → the plan (or null), with near(x, y, depth): must the shell stay closed here; stats.span and
                                    stats.overhang: the longest stretch between two supports and beyond the last one (m)
   buildRoots(plan, mats)         → a THREE.Group */
import * as THREE from 'three';
import { meshOf } from './rails.js';

const EDGE = 1.0, STEP = 0.3, FULL = 3;                                    // where a branch crosses the row's edge, outside it · the sampling step · the merge at which the roots reach the ground (m)
const hash = (a, b, c) => { let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

/* A path through points [x, y, d, r], its corners cut twice (the ends stay). */
function soften(P) {
  for (let pass = 0; pass < 2; pass++) {
    const Q = [P[0]];
    for (let i = 0; i < P.length - 1; i++) { const a = P[i], b = P[i + 1]; if (i > 0) Q.push(a.map((v, j) => 0.75 * v + 0.25 * b[j])); if (i < P.length - 2) Q.push(a.map((v, j) => 0.25 * v + 0.75 * b[j])); }
    Q.push(P[P.length - 1]); P = Q;
  }
  return P;
}

export function planRoots(b, U, rails, { k, kMax = 20 }) {
  if (!rails || !U) return null;
  const grow = Math.min(1, Math.max(0, k / FULL)), kr = 0.8 * Math.min(FULL, k), more = Math.min(1, Math.max(0, (k - FULL) / Math.max(1, kMax - FULL))); if (grow < 0.03) return null;   // 0…1 down to the ground · 0…1 beyond that
  const fat = (0.78 + 0.22 * grow) * (1 + 0.3 * more);                               // a root also thickens as the merge grows
  const mp = rails.map, yFold = rails.yTop, f = U.f, sxy = U.nx * U.ny;
  const body = (x, y, d) => {                                                        // the merged body's own distance (m) at a point of the world
    const gx = (x - mp.x0w) / mp.dxw - U.x0, gy = (y - mp.y0w) / mp.dyw - U.y0, gz = (d - mp.z0w) / mp.dzw - U.z0; if (gx < 0 || gy < 0 || gz < 0 || gx > U.nx - 1.001 || gy > U.ny - 1.001 || gz > U.nz - 1.001) return 9;
    const xi = Math.floor(gx), yi = Math.floor(gy), zi = Math.floor(gz), tx = gx - xi, ty = gy - yi, tz = gz - zi, i = xi + U.nx * (yi + U.ny * zi);
    const c00 = f[i] + (f[i + 1] - f[i]) * tx, c10 = f[i + U.nx] + (f[i + U.nx + 1] - f[i + U.nx]) * tx, c01 = f[i + sxy] + (f[i + sxy + 1] - f[i + sxy]) * tx, c11 = f[i + sxy + U.nx] + (f[i + sxy + U.nx + 1] - f[i + sxy + U.nx]) * tx;
    const c0 = c00 + (c10 - c00) * ty, c1 = c01 + (c11 - c01) * ty; return c0 + (c1 - c0) * tz;
  };
  const trees = [];
  /* How much of the building stands over a spot of the plan (m², roughly): its material counted up a column, the inside
     of a thick mass for more than a thin wall or a neck. This is what a root looks for. */
  const mass = (x, d, y0 = yFold, h = 24) => { let m = 0; for (let y = y0; y < y0 + h; y += 0.9) m += Math.min(4, Math.max(0, -body(x, y, d))) * 0.9; return m; };
  rails.rows.forEach((row, ri) => {
    const reachX = 1.5 * Math.max(...row.vaults.map(v => v.L));                         // a root may stand up to a bay and a half in from its corner
    [[row.xa, 1, row.vaults.reduce((a, v) => (v.xc < a.xc ? v : a))], [row.xb, -1, row.vaults.reduce((a, v) => (v.xc > a.xc ? v : a))]].forEach(([xEnd, inw, vEnd], ci) => { for (const side of [-1, 1]) {   // the two ends of the row × the street edge, the bay edge
      const dEdge = side < 0 ? row.dW : row.dE, out = side, id = ri * 1000 + ci * 2 + (side > 0 ? 1 : 0), j = n => hash(id, n, 77) - 0.5;   // `out` points away from the row, `inw` along it towards its middle
      /* No two alike. thick: the pillar's girth · tips: how many branches it gathers · jy: how far under the line they join · lx, lo: its slight lean (m) */
      const K = [{ thick: 1.12, tips: 7, jy: -2.4, lx: 0.2, lo: 0.1 }, { thick: 0.94, tips: 5, jy: -1.8, lx: -0.5, lo: 0.3 }, { thick: 0.98, tips: 6, jy: -3.0, lx: 0.4, lo: 0.5 }, { thick: 1.3, tips: 5, jy: -2.6, lx: -0.2, lo: 0.2 }][(id + ri) % 4];
      // where it stands: as near its corner as the building has real mass to carry — not under a thin end or a neck
      let best = null;
      for (let s = 2.5; s <= reachX; s += 1.5) { const x = xEnd + inw * s; let m = 0; for (const dx of [-3, 0, 3]) for (const din of [1.5, 4, 6.5]) m += mass(x + dx, dEdge - out * din); const sc = m * (1 - 0.3 * s / reachX); if (!best || sc > best.sc) best = { x, sc, m, s }; }
      if (!best || best.m < 30) continue;
      // where its branches start: the lowest points of the body round that place, the ones with the most building over them
      const cand = []; let n = 0;
      for (const dx of [-6, -3, 0, 3, 6]) for (const din of [1.6, 4, 6.5, 9]) {
        const x = best.x + dx + 1.2 * j(++n), d = dEdge - out * (din + 0.8 * j(n + 40)); if (x < row.xa + 0.6 || x > row.xb - 0.6) continue;
        for (let y = yFold - 0.2; y < yFold + 7; y += 0.3) if (body(x, y, d) < -0.25) { cand.push({ x, y, d, m: mass(x, d, y, 14) }); break; }
      }
      cand.sort((a, c) => c.m - a.m); const tips = cand.filter(c => c.m >= 0.35 * cand[0].m).slice(0, K.tips).map(c => [c.x, Math.max(c.y + 0.6, yFold + 0.95), c.d, 0.55]);
      if (tips.length < 2) continue;
      const rJ = Math.min(2.1, Math.max(1.6, 0.72 * Math.sqrt(tips.length))) * K.thick, OUT = 1.3 * rJ + 0.5, xJ = tips.reduce((a, t) => a + t[0], 0) / tips.length;   // the pillar stands under the middle of its branches, tight against the row's edge
      const J = [xJ, yFold + K.jy + 0.4 * j(22), dEdge + out * OUT], paths = [];       // where the branches join: outside the edge, under the line
      for (const T of tips) {
        const E = [xJ + (T[0] - xJ) * 0.5, yFold + 0.95 + Math.min(1.8, 0.3 * (T[1] - yFold - 0.95)), dEdge + out * EDGE, 0.72];
        paths.push({ pts: soften([T, [T[0] + (E[0] - T[0]) * 0.45, (T[1] + E[1]) / 2, T[2] + (E[2] - T[2]) * 0.55, 0.64], E, [...J, 0.8]]), from: 'tip' });
      }
      /* one straight pillar from the join to the ground, plumb for its last metres, so that it meets the ground as a circle: no foot, no toes */
      const F = [xJ + K.lx, dEdge + out * (OUT + K.lo)];
      paths.push({ pts: soften([[...J, rJ], [(J[0] + F[0]) / 2, (J[1] + 4.5) / 2, (J[2] + F[1]) / 2, rJ], [F[0], 4.5, F[1], rJ]]), from: 'join' });
      paths.push({ pts: [[F[0], 4.5, F[1], rJ], [F[0], -2.5, F[1], rJ]], from: 'split' });
      // every piece with how far down the tree it is (from the tips), so the roots can be drawn part grown
      const segs = [], len = p => { let L = 0; for (let i = 0; i < p.length - 1; i++) L += Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1], p[i + 1][2] - p[i][2]); return L; };
      const lay = (p, s0) => { let s = s0; for (let i = 0; i < p.length - 1; i++) { const a = p[i], q = p[i + 1], l = Math.hypot(q[0] - a[0], q[1] - a[1], q[2] - a[2]); segs.push({ a, b: q, s0: s, s1: s + l }); s += l; } return s; };
      const sJoin = Math.max(...paths.filter(p => p.from === 'tip').map(p => len(p.pts))); let sSplit = sJoin, total = sJoin;
      for (const p of paths) if (p.from === 'tip') lay(p.pts, sJoin - len(p.pts));    // a short branch starts later, so all arrive at the join together
      for (const p of paths) if (p.from === 'join') sSplit = lay(p.pts, sJoin);
      for (const p of paths) if (p.from === 'split') total = lay(p.pts, sSplit);
      const reach = grow * (total - 2.5) + (grow >= 0.999 ? 2.5 : 0), live = [];       // down to the ground by a merge of 3 m
      for (const q of segs) for (const e of [q.a, q.b]) if (!e.fat) { e[3] *= fat; e.fat = true; }
      for (const q of segs) { if (q.s0 >= reach) continue; if (q.s1 <= reach) { live.push(q); continue; } const t = (reach - q.s0) / (q.s1 - q.s0); live.push({ a: q.a, b: q.a.map((v, i) => v + (q.b[i] - v) * t) }); }
      const box = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9]; for (const q of live) for (const p of [q.a, q.b]) for (let i = 0; i < 3; i++) { box[i] = Math.min(box[i], p[i] - p[3]); box[i + 3] = Math.max(box[i + 3], p[i] + p[3]); }
      trees.push({ id, mod: vEnd.i, x: F[0], r: rJ * fat, inw, inFromEnd: Math.abs(F[0] - xEnd), dEdge, out, row, segs: live, box, grounded: grow >= 0.999 });
    } });
  });
  if (!trees.length) return null;
  const root = (t, x, y, d) => {                                                     // distance to a tree's roots (m, negative inside)
    let r = 9;
    for (const q of t.segs) { const a = q.a, c = q.b, ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2], L2 = ux * ux + uy * uy + uz * uz || 1e-9, h = Math.min(1, Math.max(0, ((x - a[0]) * ux + (y - a[1]) * uy + (d - a[2]) * uz) / L2));
      const v = Math.hypot(x - a[0] - ux * h, y - a[1] - uy * h, d - a[2] - uz * h) - (a[3] + (c[3] - a[3]) * h); r = r > 8 ? v : smin(r, v, 0.9); }
    return r;
  };
  const pad = 0.9 * kr + 0.4;
  /* Beyond its last root an end of the building overhangs: there the shell is the whole structure, a closed tube with no openings. */
  const closed = []; for (const row of rails.rows) for (const inw of [1, -1]) { const xs = trees.filter(t => t.row === row && t.inw === inw && t.grounded).map(t => t.x); if (xs.length) closed.push(inw > 0 ? [-1e9, Math.min(...xs), row.dW - 3, row.dE + 3] : [Math.max(...xs), 1e9, row.dW - 3, row.dE + 3]); }
  const near = (x, y, d) => {                                                        // the shell stays closed where a root flares out of it, and in a pier straight above every pillar: the outer wall carries the load down to it
    if (y < yFold - 1) return false;
    for (const c of closed) if (x > c[0] && x < c[1] && d > c[2] && d < c[3]) return true;
    for (const t of trees) { if (Math.abs(x - t.x) < t.r + 1.2) { const inRow = -t.out * (d - t.dEdge); if (inRow > -1.5 && inRow < 4.5) return true; } const B = t.box; if (x < B[0] - pad || x > B[3] + pad || y > B[4] + pad || d < B[2] - pad || d > B[5] + pad) continue; if (root(t, x, y, d) < pad) return true; }
    return false;
  };
  /* What the building stands on once the vaults have slid away: the roots and the walls across the ends of the vaults that stay.
     The longest stretch of the row between two of them, and the longest stretch beyond the last one (m). */
  const row0 = rails.rows[0], sup = [...new Set([...trees.filter(t => t.row === row0).map(t => t.x), ...rails.ribs.filter(q => row0.vaults.includes(q.v)).map(q => q.x)].map(x => Math.round(x)))].sort((a, c) => a - c);
  let span = 0; for (let i = 1; i < sup.length; i++) span = Math.max(span, sup[i] - sup[i - 1]);
  const overhang = sup.length ? Math.max(sup[0] - row0.xa, row0.xb - sup[sup.length - 1]) : 0;
  return { trees, body, root, near, kr, yFold, grow, stats: { count: trees.length, grounded: trees.filter(t => t.grounded).length, span, overhang, walls: rails.ribs.length, inFromEnd: trees.map(t => Math.round(t.inFromEnd)), girth: trees.map(t => +(2 * t.r).toFixed(1)) } };
}

export function buildRoots(plan, mats) {
  const group = new THREE.Group(); group.name = 'Valve HQ · roots'; const { kr, yFold } = plan, lim = Math.max(0.3, 0.9 * kr);
  for (const t of plan.trees) {
    const B = t.box, m = lim + 0.6;
    const g = meshOf((x, y, d) => {
      const r = plan.root(t, x, y, d); if (r > lim + 0.5) return r - lim;
      const bf = plan.body(x, y, d), inRow = -t.out * (d - t.dEdge);                 // how far inside the row's edge
      return Math.max(kr > 0.05 ? smin(r, bf, kr) : r, r - lim, -(bf + 0.3), -y, Math.min(inRow + 0.1, yFold - 0.05 - y));   // flared into the body · only round the root · not inside the body · cut at the ground · never under the line inside the row
    }, B[0] - m, B[3] + m, Math.max(-STEP, B[1] - m), B[4] + m, B[2] - m, B[5] + m, STEP, 2);
    if (!g) continue;
    const mesh = new THREE.Mesh(g, mats.root || mats.vault || mats.solid); mesh.castShadow = mesh.receiveShadow = true; mesh.name = `root ${t.id}`;
    mesh.userData = { element: 0, mods: new Int16Array(g.getAttribute('position').count).fill(t.mod) }; group.add(mesh);
  }
  return group;
}

/* ProtoSpace Analyzer — roots (Rationalize tab).

   When the public floor folds, what stays above it has to stand on something once the vaults have slid away. So as
   the modules merge, the lowest parts of the building grow roots: at the four far corners of a row of ground bays —
   its two ends, on both long edges — branches leave the underside of the modules beside the corner, run to the
   edge, join into one thick trunk outside the path of the sliding vaults, and come down past the deck to the ground,
   where the trunk splits into toes. They are pillars, drawn as a tree's roots. (The middle of the row stands on the
   two vaults that stay.)

   Roots come with the merge: none at 0, hanging part of the way down at a small merge, on the ground from 3 m. The
   merge also sets how far a root flares into the module it grows from (a smooth union with the body, like every
   other merge on this page).

   Nothing of a root is in the way of the vaults: inside the row it stays above the line the vaults pass under, and
   it only comes down outside the deck's edge.

   planRoots(b, U, rails, { k })  → the plan (or null), with near(x, y, depth): is this point of the shell at the head of a root
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

export function planRoots(b, U, rails, { k }) {
  if (!rails || !U) return null;
  const grow = Math.min(1, Math.max(0, k / FULL)), kr = 0.8 * Math.min(FULL, k); if (grow < 0.03) return null;
  const mp = rails.map, yFold = rails.yTop, f = U.f, sxy = U.nx * U.ny;
  const body = (x, y, d) => {                                                        // the merged body's own distance (m) at a point of the world
    const gx = (x - mp.x0w) / mp.dxw - U.x0, gy = (y - mp.y0w) / mp.dyw - U.y0, gz = (d - mp.z0w) / mp.dzw - U.z0; if (gx < 0 || gy < 0 || gz < 0 || gx > U.nx - 1.001 || gy > U.ny - 1.001 || gz > U.nz - 1.001) return 9;
    const xi = Math.floor(gx), yi = Math.floor(gy), zi = Math.floor(gz), tx = gx - xi, ty = gy - yi, tz = gz - zi, i = xi + U.nx * (yi + U.ny * zi);
    const c00 = f[i] + (f[i + 1] - f[i]) * tx, c10 = f[i + U.nx] + (f[i + U.nx + 1] - f[i + U.nx]) * tx, c01 = f[i + sxy] + (f[i + sxy + 1] - f[i + sxy]) * tx, c11 = f[i + sxy + U.nx] + (f[i + sxy + U.nx + 1] - f[i + sxy + U.nx]) * tx;
    const c0 = c00 + (c10 - c00) * ty, c1 = c01 + (c11 - c01) * ty; return c0 + (c1 - c0) * tz;
  };
  const trees = [];
  rails.rows.forEach((row, ri) => {
    const xs = []; for (const v of [...row.vaults].sort((a, c) => a.xc - c.xc)) for (const x of [v.xc - v.L / 2, v.xc + v.L / 2]) { const last = xs[xs.length - 1]; if (last && x - last.x < 3) { last.x = (last.x * last.n + x) / (last.n + 1); last.n++; last.i = v.i; } else xs.push({ x, n: 1, i: v.i }); }
    const ends = xs.length > 1 ? [[xs[0], -1], [xs[xs.length - 1], 1]] : [];           // only the far corners: the two ends of the row
    ends.forEach(([c, end], ci) => { for (const side of [-1, 1]) {                    // the street edge, the bay edge
      const dEdge = side < 0 ? row.dW : row.dE, out = side, id = ri * 1000 + ci * 2 + (side > 0 ? 1 : 0), j = n => hash(id, n, 77) - 0.5;   // `out` points away from the row, `end` away from its middle
      // where the branches start: the lowest point of the body over a few spots in from the corner
      const tips = [];
      for (const [dx, din] of [[1.6, 3.4], [4.2, 2.4], [8.2, 3.0], [12.5, 2.6], [3.4, 8.2], [7.6, 9.6], [12.0, 7.4]]) {
        const x = c.x - end * (dx + 1.6 * j(tips.length + 1)), d = dEdge - out * (din + 1.4 * j(tips.length + 11)); if (x < row.xa + 0.6 || x > row.xb - 0.6) continue;
        for (let y = yFold - 0.2; y < yFold + 16; y += 0.3) if (body(x, y, d) < -0.25) { tips.push([x, Math.max(y + 0.6, yFold + 0.95), d, 0.55, dx]); break; }
      }
      if (tips.length < 2) continue;
      const rJ = Math.min(1.8, Math.max(1.3, 0.6 * Math.sqrt(tips.length))), OUT = rJ + 1.0;   // the trunk carries what its branches bring; its axis stands clear of the row's edge
      const J = [c.x + end * (0.8 + 0.6 * j(21)), yFold - 3.4 + 0.8 * j(22), dEdge + out * OUT], paths = [];   // where the branches join: outside the edge, a little past the end, under the line
      for (const T of tips) {
        const E = [c.x + (T[0] - c.x) * 0.42, yFold + 0.95 + Math.min(1.8, 0.3 * (T[1] - yFold - 0.95)), dEdge + out * EDGE, 0.72], tip = T.slice(0, 4);
        paths.push({ pts: soften([tip, [T[0] + (E[0] - T[0]) * 0.45, (T[1] + E[1]) / 2, T[2] + (E[2] - T[2]) * 0.55, 0.64], E, [...J, 0.8]]), from: 'tip' });
        /* further along the edge, a thinner root of its own: off the branch where it crosses the edge, straight to the ground */
        if (T[4] > 7 && T[2] * out > (dEdge - out * 4) * out) { const n = 50 + paths.length, F = [E[0] - end * (1.5 + 1.2 * (j(n) + 0.5)), -0.5, dEdge + out * (EDGE + 1.6 + 1.6 * (j(n + 1) + 0.5)), 0.4];
          paths.push({ pts: soften([[E[0], E[1], E[2], 0.5], [E[0] + (F[0] - E[0]) * 0.3, yFold - 3.2, dEdge + out * (EDGE + 1.1), 0.5], [E[0] + (F[0] - E[0]) * 0.8, 3.4 + 0.8 * j(n + 2), F[2] - out * 0.4, 0.46], F]), from: 'prop' }); }
      }
      const ySplit = 7.4 + 1.2 * j(31), S = [J[0] + end * 0.4 + 0.8 * j(32), ySplit, dEdge + out * (OUT + 0.5 + 0.5 * (j(33) + 0.5)), rJ * 1.1];
      paths.push({ pts: soften([[...J, rJ], [J[0] + 0.9 * j(34), (J[1] + ySplit) / 2 + 0.6 * j(35), dEdge + out * (OUT + 0.35 + 0.5 * (j(36) + 0.5)), rJ * 0.95], S]), from: 'join' });
      for (const [tx, to, n] of [[end * 5.6, 0.6, 41], [-end * 5.2, 1.4, 42], [end * 1.2, 5.6, 43], [end * 4.6, 4.2, 44], [-end * 2.2, 4.8, 45]]) {   // toes: past the end, back along the building, straight out, and between
        const F = [S[0] + tx + 1.2 * j(n), -0.6, dEdge + out * (OUT + to + 0.8 * (j(n + 10) + 0.5)), 0.5];
        paths.push({ pts: soften([[...S.slice(0, 3), 0.86], [S[0] + (F[0] - S[0]) * 0.58, 2.9 + 0.8 * j(n + 20), S[2] + (F[2] - S[2]) * 0.58, 0.72], F]), from: 'split' });
      }
      // every piece with how far down the tree it is (from the tips), so the roots can be drawn part grown
      const segs = [], len = p => { let L = 0; for (let i = 0; i < p.length - 1; i++) L += Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1], p[i + 1][2] - p[i][2]); return L; };
      const lay = (p, s0) => { let s = s0; for (let i = 0; i < p.length - 1; i++) { const a = p[i], q = p[i + 1], l = Math.hypot(q[0] - a[0], q[1] - a[1], q[2] - a[2]); segs.push({ a, b: q, s0: s, s1: s + l }); s += l; } return s; };
      const sJoin = Math.max(...paths.filter(p => p.from === 'tip').map(p => len(p.pts))); let sSplit = sJoin, total = sJoin;
      for (const p of paths) if (p.from === 'tip') lay(p.pts, sJoin - len(p.pts));    // a short branch starts later, so all arrive at the join together
      for (const p of paths) if (p.from === 'join') sSplit = lay(p.pts, sJoin);
      for (const p of paths) if (p.from === 'split') total = Math.max(total, lay(p.pts, sSplit));
      for (const p of paths) if (p.from === 'prop') lay(p.pts, Math.max(0, total - len(p.pts)));          // the thin roots touch down with the toes
      const reach = grow * total, live = [];
      for (const q of segs) { if (q.s0 >= reach) continue; if (q.s1 <= reach) { live.push(q); continue; } const t = (reach - q.s0) / (q.s1 - q.s0); live.push({ a: q.a, b: q.a.map((v, i) => v + (q.b[i] - v) * t) }); }
      const box = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9]; for (const q of live) for (const p of [q.a, q.b]) for (let i = 0; i < 3; i++) { box[i] = Math.min(box[i], p[i] - p[3]); box[i + 3] = Math.max(box[i + 3], p[i] + p[3]); }
      trees.push({ id, mod: c.i, x: c.x, dEdge, out, segs: live, box, grounded: grow >= 0.999 });
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
  const near = (x, y, d) => {                                                        // the shell stays closed where a root flares out of it
    if (y < yFold - 1) return false;
    for (const t of trees) { const B = t.box; if (x < B[0] - pad || x > B[3] + pad || y > B[4] + pad || d < B[2] - pad || d > B[5] + pad) continue; if (root(t, x, y, d) < pad) return true; }
    return false;
  };
  return { trees, body, root, near, kr, yFold, grow, stats: { count: trees.length, grounded: trees.filter(t => t.grounded).length } };
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

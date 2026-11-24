/* ProtoSpace Analyzer — roots (Rationalize tab).

   When the public floor folds, what stays above it has to stand on something once the vaults have slid away. So as
   the modules merge, the lowest parts of the building grow roots: at the four far corners of a row of ground bays —
   its two ends, on both long edges — branches leave the underside of the modules beside the corner, run to the
   edge, join into one thick trunk outside the path of the sliding vaults, and come down past the deck to the ground
   in one piece — no toes. They are pillars, drawn as a tree's roots. (The middle of the row stands on the
   two vaults that stay.)

   Roots extend with the merge: none at 0, hanging part of the way down at a small merge, on the ground at 3 m, and
   from there on along the ground, further and thicker the more the building merges. The merge also sets how far a
   root flares into the module it grows from (a smooth union with the body, like every other merge on this page).
   No two of the four are alike: each has its own girth, its own number of branches, its own slight lean,
   and runs on along the ground its own way.

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

export function planRoots(b, U, rails, { k, kMax = 20 }) {
  if (!rails || !U) return null;
  const grow = Math.min(1, Math.max(0, k / FULL)), kr = 0.8 * Math.min(FULL, k), more = Math.min(1, Math.max(0, (k - FULL) / Math.max(1, kMax - FULL))); if (grow < 0.03) return null;   // 0…1 down to the ground · 0…1 on along it
  const fat = (0.78 + 0.22 * grow) * (1 + 0.3 * more);                               // a root also thickens as the merge grows
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
      const dEdge = side < 0 ? row.dW : row.dE, out = side, id = ri * 1000 + ci * 2 + (side > 0 ? 1 : 0), j = n => hash(id, n, 77) - 0.5;
      /* No two alike. thick: the trunk's girth · tips: how many branches it gathers · jy: how far under the line they join ·
         fx, fo: where it lands, a little past the end (+) or back along the building (−), and further out · bx, bo: how little it bows on the way ·
         hx, ho, curl, run: which way it runs on along the ground, how it curls, how far (m) */
      const K = [{ thick: 1.12, tips: 7, jy: -2.4, fx: 0.3, fo: 0.15, bx: 0.1, bo: 0.15, hx: 0.45, ho: 1, curl: 0.5, run: 12 },   // stout and plumb, then straight out
                 { thick: 0.82, tips: 4, jy: -1.8, fx: 1.6, fo: 0.4, bx: 0.3, bo: 0.3, hx: 1, ho: 0.12, curl: -0.4, run: 17 },     // the slimmest, leaning a little past the end, running on away from the building
                 { thick: 0.98, tips: 6, jy: -3.0, fx: -1.4, fo: 0.7, bx: 0.2, bo: 0.4, hx: -1, ho: 0.3, curl: 0.7, run: 15 },     // leaning a little back along the building, then on along its edge
                 { thick: 1.34, tips: 5, jy: -2.6, fx: 0.7, fo: 1.0, bx: -0.2, bo: 0.1, hx: 0.25, ho: 1, curl: -0.9, run: 9 }][(id + ri) % 4];   // the heaviest, stepping a little out, a short hooked run
      // where the branches start: the lowest point of the body over a few spots in from the corner
      const tips = [];
      for (const [dx, din] of [[1.6, 3.4], [4.2, 2.4], [7.4, 3.0], [2.6, 6.4], [5.6, 7.6], [9.0, 2.6], [8.6, 6.8]]) {   // nearest the corner first
        const x = c.x - end * (dx + 1.6 * j(tips.length + 1)), d = dEdge - out * (din + 1.4 * j(tips.length + 11)); if (x < row.xa + 0.6 || x > row.xb - 0.6) continue;
        for (let y = yFold - 0.2; y < yFold + 16; y += 0.3) if (body(x, y, d) < -0.25) { tips.push([x, Math.max(y + 0.6, yFold + 0.95), d, 0.55, dx]); break; }
      }
      if (tips.length < 2) continue; tips.length = Math.min(tips.length, K.tips);
      const rJ = Math.min(2.1, Math.max(1.6, 0.72 * Math.sqrt(tips.length))) * K.thick, OUT = rJ + 0.7, xJ = tips.reduce((a, t) => a + t[0], 0) / tips.length;   // the pillar stands under the middle of its branches, tight against the row's edge   // the trunk carries what its branches bring; its axis stands clear of the row's edge
      const J = [xJ, yFold + K.jy + 0.4 * j(22), dEdge + out * OUT], paths = [];   // where the branches join: outside the edge, a little past the end, under the line
      for (const T of tips) {
        const E = [xJ + (T[0] - xJ) * 0.5, yFold + 0.95 + Math.min(1.8, 0.3 * (T[1] - yFold - 0.95)), dEdge + out * EDGE, 0.72], tip = T.slice(0, 4);
        paths.push({ pts: soften([tip, [T[0] + (E[0] - T[0]) * 0.45, (T[1] + E[1]) / 2, T[2] + (E[2] - T[2]) * 0.55, 0.64], E, [...J, 0.8]]), from: 'tip' });
      }
      /* one thick piece from the join to the ground — no toes — and then on along the ground as the merge goes on growing */
      const G = [J[0] + end * K.fx + 0.3 * j(34), 0.5, J[2] + out * K.fo, rJ * 1.3];    // where it lands
      const M = [(J[0] + G[0]) / 2 + end * K.bx, (J[1] + G[1]) / 2 + 0.6 * j(35), (J[2] + G[2]) / 2 + out * K.bo, rJ * 0.97];   // the trunk is a straight pillar, a few hands off plumb
      paths.push({ pts: soften([[...J, rJ], M, [G[0] - end * K.fx * 0.12, 3.4, G[2] - out * K.fo * 0.1, rJ * 1.08], G]), from: 'join' });
      const run = [G]; { let hx = end * K.hx, ho = K.ho; const n = 9, st = K.run / n, turn = K.curl / n;
        for (let i = 1; i <= n; i++) { const c0 = Math.cos(turn * end * out), s0 = Math.sin(turn * end * out), nx = hx * c0 - ho * s0, no = hx * s0 + ho * c0, L = Math.hypot(nx, no) || 1; hx = nx / L; ho = Math.max(0.05, no / L);   // it never turns back in under the building
          const q = run[run.length - 1], r = rJ * (1.3 - 0.85 * i / n); run.push([q[0] + hx * st, 0.25 * r, q[2] + out * ho * st, r]); } }
      paths.push({ pts: run, from: 'split' });
      // every piece with how far down the tree it is (from the tips), so the roots can be drawn part grown
      const segs = [], len = p => { let L = 0; for (let i = 0; i < p.length - 1; i++) L += Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1], p[i + 1][2] - p[i][2]); return L; };
      const lay = (p, s0) => { let s = s0; for (let i = 0; i < p.length - 1; i++) { const a = p[i], q = p[i + 1], l = Math.hypot(q[0] - a[0], q[1] - a[1], q[2] - a[2]); segs.push({ a, b: q, s0: s, s1: s + l }); s += l; } return s; };
      const sJoin = Math.max(...paths.filter(p => p.from === 'tip').map(p => len(p.pts))); let sSplit = sJoin, total = sJoin;
      for (const p of paths) if (p.from === 'tip') lay(p.pts, sJoin - len(p.pts));    // a short branch starts later, so all arrive at the join together
      for (const p of paths) if (p.from === 'join') sSplit = lay(p.pts, sJoin);
      for (const p of paths) if (p.from === 'split') total = Math.max(total, lay(p.pts, sSplit));
      const reach = grow * sSplit + Math.pow(more, 0.8) * (total - sSplit), live = [];   // down to the ground by a merge of 3 m, then on along it
      for (const q of segs) for (const e of [q.a, q.b]) if (!e.fat) { e[3] *= fat; e.fat = true; }
      for (const q of segs) if (q.s0 >= sSplit - 1e-6) for (const [e, sv] of [[q.a, q.s0], [q.b, q.s1]]) {     // along the ground it tapers to wherever its tip is now
        const fr = Math.min(1, (sv - sSplit) / Math.max(0.5, reach - sSplit)); e[3] = rJ * fat * (1.3 - 0.85 * fr); if (fr > 0) e[1] = 0.25 * e[3]; }
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
  return { trees, body, root, near, kr, yFold, grow, stats: { count: trees.length, grounded: trees.filter(t => t.grounded).length, running: more > 0.02 } };
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

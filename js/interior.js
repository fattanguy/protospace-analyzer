/* ProtoSpace Analyzer — the interior of the rationalized building (js/rationalize.js).

   From the merged, hollow volume (the union field of js/sdf.js) this plans what a big company's building has inside,
   storey by storey, and builds it:
   · rooms — where each module has space in each storey, with the walls kept clear;
   · double-height voids — in every module the largest round void that fits through two or more storeys; its plates are
     cut every other storey (stacked double-height spaces), and in the module with the tallest void every one of them
     (the main atrium, through the whole height);
   · a glass lift per module, where the most storeys line up;
   · a feature stair between every pair of storeys in every module (the red stair, switching back where it can), its
     stairwell cut out of the plate above;
   · partitions with doors on a grid — glass meeting rooms in the workspaces, solid rooms in the hybrids, open plan in the
     lobbies and gathering rooms — kept off the walls, the voids, the stairs and the lifts;
   · glass balustrades with handrails round every void and stairwell.
   Positions are in the building grid (x, z in voxels, as js/sdf.js) and heights in metres; the openings are handed back
   to the field (holeAt) so the plates are really cut, and the parts are built as instanced boxes. toPLY writes the
   lot as a point cloud or a mesh, every point carrying what it is (element), which module, which storey and which use. */
import * as THREE from 'three';

export const ELEMENTS = ['wall', 'floor', 'stair', 'lift', 'glass partition', 'solid partition', 'balustrade', 'metal'];
export const ELEMENT_COLOR = ['#e9e5de', '#a79f93', '#c62828', '#3a3a3a', '#9fc3d1', '#d8d2c8', '#b9d3dc', '#6e6e6e'];
const USES = ['lobby', 'office', 'social', 'hybrid'];

// ------------------------------------------------------------------ planning
/* U: the union field; mods: the placed modules (use); LAT: metres per voxel; yBase: the first level line (m);
   H: storey height; t: wall thickness; tf: plate thickness; opts: which parts. */
export function planInterior(U, mods, { LAT, yBase, H, t, tf, opts }) {
  const { nx, ny, nz, f, lab } = U, sxy = nx * ny;
  const F = (gx, wy, gz) => {                                                      // the field (m) at grid x, z and height wy (m), trilinear
    const x = Math.min(nx - 1.001, Math.max(0, gx - U.x0)), y = Math.min(ny - 1.001, Math.max(0, wy / LAT - 0.5 - U.y0)), z = Math.min(nz - 1.001, Math.max(0, gz - U.z0));
    const x0 = x | 0, y0 = y | 0, z0 = z | 0, tx = x - x0, ty = y - y0, tz = z - z0, b = x0 + nx * (y0 + ny * z0);
    const c00 = f[b] + (f[b + 1] - f[b]) * tx, c10 = f[b + nx] + (f[b + nx + 1] - f[b + nx]) * tx, c01 = f[b + sxy] + (f[b + sxy + 1] - f[b + sxy]) * tx, c11 = f[b + sxy + nx] + (f[b + sxy + nx + 1] - f[b + sxy + nx]) * tx;
    const c0 = c00 + (c10 - c00) * ty, c1 = c01 + (c11 - c01) * ty; return c0 + (c1 - c0) * tz;
  };
  const L = (gx, wy, gz) => { const x = Math.round(gx - U.x0), y = Math.round(wy / LAT - 0.5 - U.y0), z = Math.round(gz - U.z0); if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return -1; return lab[x + nx * (y + ny * z)] - 1; };
  const clear = (gx, wy, gz, c) => F(gx, wy, gz) <= -(t + c);                         // inside, at least c metres off the wall
  const top = (U.y0 + ny - 1 + 0.5) * LAT, levels = [];
  for (let n = 0; yBase + n * H + 1.5 < top; n++) levels.push(yBase + n * H);
  const NL = levels.length, M = mods.length, m2g = 1 / LAT;
  // rooms: per storey, the module whose space is at every column (mid-storey, 0.3 m off the walls)
  const rooms = levels.map(y => { const r = new Int16Array(nx * nz).fill(-1); for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) { const gx = U.x0 + x, gz = U.z0 + z, ym = y + H * 0.5; if (clear(gx, ym, gz, 0.3) && clear(gx, y + 0.4, gz, 0.1)) r[x + nx * z] = L(gx, ym, gz); } return r; });
  const cellsOf = Array.from({ length: M }, () => []), centroid = Array.from({ length: M }, () => [0, 0, 0]);
  rooms.forEach((r, n) => { for (let i = 0; i < r.length; i++) if (r[i] >= 0) { const c = centroid[r[i]]; c[0] += i % nx; c[1] += (i / nx) | 0; c[2]++; } });
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) { const any = new Set(); rooms.forEach(r => { if (r[x + nx * z] >= 0) any.add(r[x + nx * z]); }); any.forEach(i => cellsOf[i].push([U.x0 + x, U.z0 + z])); }
  const cen = centroid.map(c => c[2] ? [U.x0 + c[0] / c[2], U.z0 + c[1] / c[2]] : null);
  const holes = Array.from({ length: NL + 1 }, () => []), parts = [], plan = { levels, holes, parts, atria: [], lifts: [], stairs: [], rooms, NL };
  const addHole = (n, h) => { if (n >= 0 && n <= NL) holes[n].push(h); };
  const holeDist = (n, gx, gz) => {                                                // metres, negative inside an opening of level n
    let d = 1e9; for (const h of holes[n] || []) { const dx = gx - h.x, dz = gz - h.z;
      const v = h.r != null ? (Math.hypot(dx, dz) - h.r) * LAT : (() => { const qx = Math.abs(dx) - h.hx, qz = Math.abs(dz) - h.hz; return (Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0)) * LAT; })();
      if (v < d) d = v; }
    return d;
  };
  plan.holeAt = holeDist;
  const run = (fits) => { let best = [0, -1], cur = 0; for (let n = 0; n < NL; n++) { cur = fits(n) ? cur + 1 : 0; if (cur > best[0]) best = [cur, n - cur + 1]; } return best; };   // [length, first storey]
  // 1 · voids: the biggest round void per module through two or more storeys
  if (opts.voids) {
    const found = [];
    for (let i = 0; i < M; i++) {
      const mine = [];                                                             // up to two per module, the widest that fit first, apart from each other
      for (const R of [6, 4.5, 3.2, 2.4]) {
        while (mine.length < 2) {
          let best = null;
          for (const [gx, gz] of cellsOf[i]) {
            if (mine.some(v => Math.hypot(gx - v.x, gz - v.z) < (v.R + R + 6) * m2g)) continue;
            const fits = n => L(gx, levels[n] + H / 2, gz) === i && clear(gx, levels[n] + H / 2, gz, R) && clear(gx, levels[n] + 1, gz, R * 0.7);
            const [len, a] = run(fits); if (len < 2) continue;
            const sc = len * 1000 - Math.hypot(gx - cen[i][0], gz - cen[i][1]);
            if (!best || sc > best.sc) best = { sc, i, x: gx, z: gz, r: R * m2g, R, a, len };
          }
          if (!best) break; mine.push(best);
        }
        if (mine.length >= 2) break;
      }
      found.push(...mine);
    }
    const main = found.reduce((m, v) => (!m || v.len > m.len || (v.len === m.len && v.R > m.R)) ? v : m, null);
    for (const v of found) {
      v.main = v === main; v.cut = [];
      for (let n = v.a + 1; n < v.a + v.len; n++) if (v.main || (n - v.a) % 2 === 1) v.cut.push(n);
      v.cut.forEach(n => addHole(n, { x: v.x, z: v.z, r: v.r, kind: 'void', i: v.i }));
      plan.atria.push(v);
    }
  }
  const voidAt = (n, gx, gz, pad) => plan.atria.some(v => v.cut.includes(n) && Math.hypot(gx - v.x, gz - v.z) < v.r + pad * m2g);
  // 2 · lifts: a 2.6 m glass shaft per module where the most storeys line up
  const LIFT = 2.6, taken = [];                                                    // footprints already used: [gx, gz, half x, half z] in grid units
  const free = (gx, gz, hx, hz, pad = 0.6) => taken.every(([x, z, a, c]) => Math.abs(gx - x) > hx + a + pad * m2g || Math.abs(gz - z) > hz + c + pad * m2g);
  if (opts.lifts) for (let i = 0; i < M; i++) {
    let best = null;
    for (const [gx, gz] of cellsOf[i]) {
      if (!free(gx, gz, LIFT / 2 * m2g, LIFT / 2 * m2g, 1.5)) continue;
      const fits = n => L(gx, levels[n] + H / 2, gz) === i && clear(gx, levels[n] + 0.5, gz, 2.2) && clear(gx, levels[n] + H - 0.6, gz, 2.2) && !voidAt(n, gx, gz, 3) && !voidAt(n + 1, gx, gz, 3);
      const [len, a] = run(fits); if (len < 2) continue;
      const sc = len * 1000 - Math.hypot(gx - cen[i][0], gz - cen[i][1]) * 0.5;
      if (!best || sc > best.sc) best = { sc, i, x: gx, z: gz, a, len };
    }
    if (!best) continue;
    const h = LIFT / 2 * m2g; taken.push([best.x, best.z, h, h]);
    for (let n = best.a + 1; n < best.a + best.len; n++) addHole(n, { x: best.x, z: best.z, hx: h + 0.1 * m2g, hz: h + 0.1 * m2g, kind: 'lift', i: best.i });
    plan.lifts.push(best);
  }
  // 3 · stairs: a straight run between every pair of storeys in every module, switching back over the one below
  const risers = Math.ceil(H / 0.18), rise = H / risers, going = 0.28, runM = (risers - 1) * going, W = 1.8;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  if (opts.stairs) for (let i = 0; i < M; i++) {
    let prev = null;
    for (let n = 0; n + 1 < NL; n++) {
      const here = cellsOf[i].filter(([gx, gz]) => rooms[n][gx - U.x0 + nx * (gz - U.z0)] === i && rooms[n + 1][gx - U.x0 + nx * (gz - U.z0)] === i);
      if (here.length < 30) { prev = null; continue; }
      let best = null;
      for (let q = 0; q < here.length; q += 2) {
        const [sx, sz] = here[q];
        for (const [dx, dz] of DIRS) {
          const at = (s, w) => [sx + (dx * s - dz * w) * m2g, sz + (dz * s + dx * w) * m2g];      // s along the run (m), w across it (m)
          let ok = true;
          for (let s = -1.2; s <= runM + 1.2 && ok; s += 0.8) for (const w of [-W / 2 - 0.2, 0, W / 2 + 0.2]) {
            const [gx, gz] = at(s, w);
            if (s <= runM && !(clear(gx, levels[n] + 1.2, gz, 0.2) && L(gx, levels[n] + 1.2, gz) === i)) { ok = false; break; }
            if (s >= 0 && !clear(gx, levels[n + 1] + 1.2, gz, 0.2)) { ok = false; break; }
          }
          if (!ok) continue;
          const [bx, bz] = at(-0.8, 0), [ex, ez] = at(runM + 0.8, 0), [cx, cz] = at(runM / 2, 0);
          if (holeDist(n, bx, bz) < 0.5 || holeDist(n + 1, ex, ez) < 0.5 || holeDist(n, cx, cz) < 0) continue;      // a floor to start from and one to arrive on
          const hx = (Math.abs(dx) * (runM / 2 + 0.4) + Math.abs(dz) * (W / 2 + 0.25)) * m2g, hz = (Math.abs(dz) * (runM / 2 + 0.4) + Math.abs(dx) * (W / 2 + 0.25)) * m2g;
          if (!free(cx, cz, hx, hz, 0.8)) continue;
          let sc = -Math.hypot(cx - cen[i][0], cz - cen[i][1]) * 0.15;
          const v = plan.atria.find(a => a.i === i); if (v) sc -= Math.abs(Math.hypot(cx - v.x, cz - v.z) - v.r - 3 * m2g) * 0.6;   // beside the void
          if (prev) sc -= Math.hypot(sx - prev.ex, sz - prev.ez) * 1.2 + (dx === -prev.dx && dz === -prev.dz ? 0 : 4);         // switch back over the one below
          if (!best || sc > best.sc) best = { sc, i, n, sx, sz, dx, dz, cx, cz, hx, hz, ex: at(runM, 0)[0], ez: at(runM, 0)[1] };
        }
      }
      if (!best) { prev = null; continue; }
      taken.push([best.cx, best.cz, best.hx, best.hz]);
      addHole(n + 1, { x: best.cx, z: best.cz, hx: best.hx, hz: best.hz, kind: 'stair', i, st: best });
      plan.stairs.push(best); prev = best;
    }
  }
  Object.assign(plan, { rise, going, risers, runM, W });
  // 4 · partitions with doors, on a grid: glass rooms in the workspaces, solid rooms in the hybrids
  plan.walls = [];
  if (opts.partitions) for (let n = 0; n < NL; n++) {
    const y = levels[n];
    for (let i = 0; i < M; i++) {
      const use = mods[i].use, P = use === 'office' ? 12 : use === 'hybrid' ? 15 : 0; if (!P) continue;
      const step = Math.round(P / LAT), ok = (gx, gz) => rooms[n][Math.round(gx - U.x0) + nx * Math.round(gz - U.z0)] === i && clear(gx, y + 0.4, gz, 0.5) && clear(gx, y + H - 0.8, gz, 0.5) && holeDist(n, gx, gz) > 1 && holeDist(n + 1, gx, gz) > 1 && free(gx, gz, 0, 0, 0.8);
      const cs = cellsOf[i]; if (!cs.length) continue;
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const [gx, gz] of cs) { x0 = Math.min(x0, gx); x1 = Math.max(x1, gx); z0 = Math.min(z0, gz); z1 = Math.max(z1, gz); }
      for (const axis of [0, 1]) {                                                 // lines along x (fixed z), then along z (fixed x)
        const [a0, a1, b0, b1] = axis === 0 ? [x0, x1, z0, z1] : [z0, z1, x0, x1];
        for (let line = Math.ceil(b0 / step) * step; line <= b1; line += step) {
          let start = null;
          const flush = end => { if (start == null) return; const len = (end - start) * LAT; if (len >= 1.5) cutDoors(start, end); start = null; };
          const cutDoors = (s0, s1) => {                                           // a 1.4 m door in the middle of every bay of the grid the piece crosses
            let pieces = [[s0, s1]];
            for (let d = Math.ceil(s0 / step) * step - step / 2; d <= s1; d += step) {
              const half = 0.7 * m2g; pieces = pieces.flatMap(([p, q]) => d - half > p && d + half < q ? [[p, d - half], [d + half, q]] : d + half <= p || d - half >= q ? [[p, q]] : d <= p ? [[d + half, q]] : [[p, d - half]]);
            }
            for (const [p, q] of pieces) if ((q - p) * LAT >= 0.6) plan.walls.push({ n, i, axis, line, a: p, b: q, glass: use === 'office' });
          };
          for (let a = a0; a <= a1 + 1; a++) { const gx = axis === 0 ? a : line, gz = axis === 0 ? line : a; if (a <= a1 && ok(gx, gz)) { if (start == null) start = a - 0.5; } else flush(a - 0.5); }
        }
      }
    }
  }
  return plan;
}

// ------------------------------------------------------------------ building
/* The parts as instanced boxes, grouped by material: → THREE.Group, each mesh with userData { element, items: [{ i, n }] }. */
export function buildInterior(plan, { LAT, gridX, gridZ, mats, H, tf, t }) {
  const group = new THREE.Group(); group.name = 'Valve HQ · interior';
  const buckets = new Map(), m2g = 1 / LAT;
  const box = (el, mat, wx, wy, wz, sx, sy, sz, q = null, i = -1, n = -1) => {      // world centre, size, optional rotation
    const key = el + ':' + mat.uuid;                                               // by element as well as material: glass is a balustrade, a partition or a lift
    if (!buckets.has(key)) buckets.set(key, { el, mat, list: [] });
    buckets.get(key).list.push({ p: new THREE.Vector3(wx, wy, wz), s: new THREE.Vector3(sx, sy, sz), q: q || new THREE.Quaternion(), i, n });
  };
  const W = (gx, gz) => [gridX(gx), gridZ(gz)];
  const { rise, going, risers, runM } = plan, levels = plan.levels.map(y => y + tf);   // the floor tops: each plate lies on its level line
  const ceil = n => levels[n] + H - tf;                                            // the underside of the plate above
  // balustrades: glass 1.1 m with a handrail, round voids and three sides of stairwells
  const rail = (n, i, x0, z0, x1, z1) => {
    const [ax, az] = W(x0, z0), [bx, bz] = W(x1, z1), len = Math.hypot(bx - ax, bz - az); if (len < 0.2) return;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(bz - az, bx - ax)), y = levels[n];
    box(6, mats.glass, (ax + bx) / 2, y + 0.55, (az + bz) / 2, len, 1.1, 0.03, q, i, n);
    box(7, mats.metal, (ax + bx) / 2, y + 1.12, (az + bz) / 2, len, 0.05, 0.07, q, i, n);
  };
  for (const v of plan.atria) for (const n of v.cut) { const seg = Math.max(18, Math.round(v.R * 5)); for (let k = 0; k < seg; k++) { const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2; rail(n, v.i, v.x + Math.cos(a0) * v.r, v.z + Math.sin(a0) * v.r, v.x + Math.cos(a1) * v.r, v.z + Math.sin(a1) * v.r); } }
  // stairs: red treads, dark stringers, glass and a handrail up both sides
  for (const s of plan.stairs) {
    const y0 = levels[s.n], along = (d, w) => [s.sx + (s.dx * d - s.dz * w) * m2g, s.sz + (s.dz * d + s.dx * w) * m2g];
    const yaw = -Math.atan2(-s.dz, s.dx), qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);   // the run's direction in the world (z is flipped)
    for (let k = 0; k < risers - 1; k++) { const [gx, gz] = along((k + 0.5) * going, 0), [wx, wz] = W(gx, gz); box(2, mats.stair, wx, y0 + (k + 1) * rise - 0.06, wz, going + 0.02, 0.12, plan.W, qy, s.i, s.n); }
    const slope = Math.atan2(H, runM), len = Math.hypot(H, runM), qs = qy.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), slope));
    for (const w of [-plan.W / 2 - 0.04, plan.W / 2 + 0.04]) {
      const [gx, gz] = along(runM / 2, w), [wx, wz] = W(gx, gz);
      box(7, mats.dark, wx, y0 + H / 2 - 0.1, wz, len, 0.36, 0.06, qs, s.i, s.n);                      // stringer
      box(6, mats.glass, wx, y0 + H / 2 + 0.55, wz, len, 0.95, 0.025, qs, s.i, s.n);                   // glass up the flight
      box(7, mats.metal, wx, y0 + H / 2 + 1.05, wz, len, 0.05, 0.06, qs, s.i, s.n);                    // handrail
    }
    // the stairwell in the plate above: rails on both long sides and the low end
    const n1 = s.n + 1, [a1, b1] = along(0, -plan.W / 2 - 0.25), [a2, b2] = along(runM, -plan.W / 2 - 0.25), [a3, b3] = along(runM, plan.W / 2 + 0.25), [a4, b4] = along(0, plan.W / 2 + 0.25);
    if (n1 < levels.length) { rail(n1, s.i, a1, b1, a2, b2); rail(n1, s.i, a4, b4, a3, b3); rail(n1, s.i, a1, b1, a4, b4); }
  }
  // lifts: a glass shaft with dark corner posts and a cab, through the storeys they serve
  for (const l of plan.lifts) {
    const [wx, wz] = W(l.x, l.z), y0 = levels[l.a], y1 = ceil(l.a + l.len - 1), h = y1 - y0, S = 2.6;
    for (const [ox, oz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) box(3, mats.dark, wx + ox * S / 2, y0 + h / 2, wz + oz * S / 2, 0.16, h, 0.16, null, l.i, l.a);
    for (const [ox, oz, sx, sz] of [[0, -1, S, 0.03], [0, 1, S, 0.03], [-1, 0, 0.03, S], [1, 0, 0.03, S]]) box(4, mats.glass, wx + ox * S / 2, y0 + h / 2, wz + oz * S / 2, sx, h, sz, null, l.i, l.a);
    for (let n = l.a; n < l.a + l.len; n++) box(3, mats.dark, wx, ceil(n) - 0.08, wz, S, 0.16, S, null, l.i, n);   // the frame at every storey
    box(3, mats.cab, wx, y0 + 1.25, wz, S - 0.5, 2.4, S - 0.5, null, l.i, l.a);   // the cab, waiting on the lowest floor
  }
  // partitions: glass with a frame (workspaces) or solid (hybrids), floor to the plate above
  for (const p of plan.walls) {
    const y0 = levels[p.n], h = ceil(p.n) - y0, mid = (p.a + p.b) / 2, len = (p.b - p.a) * LAT;
    const [wx, wz] = p.axis === 0 ? W(mid, p.line) : W(p.line, mid), [sx, sz] = p.axis === 0 ? [len, p.glass ? 0.04 : 0.15] : [p.glass ? 0.04 : 0.15, len];
    if (p.glass) {
      box(4, mats.glass, wx, y0 + h / 2, wz, sx, h, sz, null, p.i, p.n);
      box(7, mats.metal, wx, y0 + h - 0.04, wz, Math.max(sx, 0.08), 0.08, Math.max(sz, 0.08), null, p.i, p.n);
      box(7, mats.metal, wx, y0 + 0.04, wz, Math.max(sx, 0.08), 0.08, Math.max(sz, 0.08), null, p.i, p.n);
      for (const e of [p.a, p.b]) { const [ex, ez] = p.axis === 0 ? W(e, p.line) : W(p.line, e); box(7, mats.metal, ex, y0 + h / 2, ez, 0.08, h, 0.08, null, p.i, p.n); }   // posts at the ends: the door frames
    } else box(5, mats.solid, wx, y0 + h / 2, wz, sx, h, sz, null, p.i, p.n);
  }
  const geo = new THREE.BoxGeometry(1, 1, 1), M = new THREE.Matrix4();
  for (const { el, mat, list } of buckets.values()) {
    const im = new THREE.InstancedMesh(geo, mat, list.length); im.castShadow = el !== 4 && el !== 6; im.receiveShadow = true;
    list.forEach((b, k) => { M.compose(b.p, b.q, b.s); im.setMatrixAt(k, M); });
    im.userData = { element: el, items: list.map(b => ({ i: b.i, n: b.n })), shared: true }; im.name = ELEMENTS[el];
    group.add(im);
  }
  return group;
}

// ------------------------------------------------------------------ PLY
/* Every surface as triangles in world space with what it is: [{ pos (Float32Array, world), index, element, modOf(v),
   levelOf(y) }] → a point cloud (density points per m²) or a mesh, binary PLY, Z up for Blender. colorBy: 'element' |
   'module' | 'level' | 'use'. */
export function toPLY(surfaces, { mode = 'points', density = 8, colorBy = 'element', mods, levelOf, max = 2e6 }) {
  const useIdx = u => Math.max(0, USES.indexOf(u)), pal = ELEMENT_COLOR.map(h => new THREE.Color(h));
  const USE_COL = { lobby: '#6d8f98', office: '#c0994f', social: '#b4584a', hybrid: '#8e6f9b' };
  const tmp = new THREE.Color(), NLV = 8;
  const colour = (el, mod, lv) => {
    if (colorBy === 'module') tmp.setHSL(((mod < 0 ? 0 : mod) * 0.618) % 1, mod < 0 ? 0 : 0.55, mod < 0 ? 0.6 : 0.55);
    else if (colorBy === 'level') tmp.setHSL(0.62 - 0.62 * Math.min(1, Math.max(0, lv) / NLV), 0.6, 0.5);
    else if (colorBy === 'use') tmp.set(mod >= 0 && mods[mod] ? USE_COL[mods[mod].use] || '#888888' : '#888888');
    else tmp.copy(pal[el]);
    const hex = tmp.getHex(); return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];   // sRGB bytes
  };
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3(), p = new THREE.Vector3();
  const triArea = (s, t) => { a.fromArray(s.pos, s.index[t] * 3); b.fromArray(s.pos, s.index[t + 1] * 3); c.fromArray(s.pos, s.index[t + 2] * 3); return e1.subVectors(b, a).cross(e2.subVectors(c, a)).length() / 2; };
  let area = 0; if (mode === 'points') for (const s of surfaces) for (let t = 0; t < s.index.length; t += 3) area += triArea(s, t);
  const dens = Math.min(density, max / Math.max(1, area));
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // pass 1: how many points (or vertices and faces), so the file is written straight into one buffer
  let total = 0, nf = 0; const counts = [];
  for (const s of surfaces) {
    if (mode === 'mesh') { total += s.pos.length / 3; nf += s.index.length / 3; counts.push(null); continue; }
    const cnt = new Uint16Array(s.index.length / 3); for (let t = 0; t < s.index.length; t += 3) { const k = Math.floor(triArea(s, t) * dens + rnd()); cnt[t / 3] = k; total += k; } counts.push(cnt);
  }
  const head = ['ply', 'format binary_little_endian 1.0', 'comment ProtoSpace Analyzer · Valve HQ, rationalized · metres, Z up', `comment element: ${ELEMENTS.map((e, i) => `${i} ${e}`).join(', ')}`, `comment use: ${USES.map((u, i) => `${i} ${u === 'office' ? 'workspace' : u === 'social' ? 'gathering' : u}`).join(', ')}, 255 none`, 'comment module: index of the module on the board (-1 none) · level: storey from 0 at the first floor',
    `element vertex ${total}`, 'property float x', 'property float y', 'property float z', 'property float nx', 'property float ny', 'property float nz', 'property uchar red', 'property uchar green', 'property uchar blue', 'property uchar element', 'property short module', 'property short level', 'property uchar use'];
  if (mode === 'mesh') head.push(`element face ${nf}`, 'property list uchar int vertex_indices');
  head.push('end_header', '');
  const h = new TextEncoder().encode(head.join('\n')), VB = 33, buf = new ArrayBuffer(h.length + total * VB + nf * 13), dv = new DataView(buf);
  new Uint8Array(buf).set(h); let o = h.length;
  const put = (q, n, el, mod) => {                                                 // Blender is Z up: (x, y, z) → (x, −z, y)
    const lv = levelOf(q.y), [r, g, bl] = colour(el, mod, lv);
    dv.setFloat32(o, q.x, true); dv.setFloat32(o + 4, -q.z, true); dv.setFloat32(o + 8, q.y, true); dv.setFloat32(o + 12, n.x, true); dv.setFloat32(o + 16, -n.z, true); dv.setFloat32(o + 20, n.y, true); o += 24;
    dv.setUint8(o++, r); dv.setUint8(o++, g); dv.setUint8(o++, bl); dv.setUint8(o++, el); dv.setInt16(o, mod, true); o += 2; dv.setInt16(o, lv, true); o += 2; dv.setUint8(o++, mod >= 0 && mods[mod] ? useIdx(mods[mod].use) : 255);
  };
  // pass 2: the points (or the vertices), then the faces
  seed = 11; let vbase = 0; const faceList = [];
  surfaces.forEach((s, si) => {
    if (mode === 'mesh') {
      const nv = s.pos.length / 3, vn = new Float32Array(nv * 3);
      for (let t = 0; t < s.index.length; t += 3) { const i0 = s.index[t], i1 = s.index[t + 1], i2 = s.index[t + 2]; a.fromArray(s.pos, i0 * 3); b.fromArray(s.pos, i1 * 3); c.fromArray(s.pos, i2 * 3); nrm.subVectors(b, a).cross(e2.subVectors(c, a)); for (const i of [i0, i1, i2]) { vn[i * 3] += nrm.x; vn[i * 3 + 1] += nrm.y; vn[i * 3 + 2] += nrm.z; } }
      for (let v = 0; v < nv; v++) { p.fromArray(s.pos, v * 3); nrm.fromArray(vn, v * 3).normalize(); put(p, nrm, s.element, s.modOf(v)); }
      faceList.push([vbase, s.index]); vbase += nv; return;
    }
    const cnt = counts[si];
    for (let t = 0; t < s.index.length; t += 3) {
      let k = cnt[t / 3]; if (!k) continue;
      a.fromArray(s.pos, s.index[t] * 3); b.fromArray(s.pos, s.index[t + 1] * 3); c.fromArray(s.pos, s.index[t + 2] * 3);
      e1.subVectors(b, a); e2.subVectors(c, a); nrm.crossVectors(e1, e2).normalize(); const mod = s.modOf(s.index[t]);
      while (k-- > 0) { let u = rnd(), v = rnd(); if (u + v > 1) { u = 1 - u; v = 1 - v; } p.copy(a).addScaledVector(e1, u).addScaledVector(e2, v); put(p, nrm, s.element, mod); }
    }
  });
  for (const [base, idx] of faceList) for (let t = 0; t < idx.length; t += 3) { dv.setUint8(o++, 3); dv.setInt32(o, base + idx[t], true); dv.setInt32(o + 4, base + idx[t + 1], true); dv.setInt32(o + 8, base + idx[t + 2], true); o += 12; }
  return { blob: new Blob([buf], { type: 'application/octet-stream' }), count: total, faces: nf };
}

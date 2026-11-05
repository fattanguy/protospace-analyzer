/* ProtoSpace Analyzer — signed distance fields for the Rationalize tab (js/rationalize.js).

   Every module of the building becomes its own signed distance field (metres; negative inside), from its voxels by an
   exact Euclidean distance transform (Felzenszwalb & Huttenlocher), in a box around it wide enough for the widest
   blend. The building is the smooth union of those fields: at every point the two nearest modules are blended with a
   polynomial smooth-minimum whose radius k is set per pair (a global value, overridden pair by pair) — k = 0 keeps the
   two apart, a larger k grows a fillet between them until they read as one mass. The union is then made hollow (a wall
   of thickness t inside the surface), given floor plates every storey inside the walls, and contoured with surface nets
   on the continuous field at up to twice the voxel resolution. */

const INF = 1e20;

/* 1-D squared distance transform of f (length n) into d; v, z are scratch. */
function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const dq = q - v[k]; d[q] = dq * dq + f[v[k]]; }
}
/* 3-D squared EDT in place: g holds 0 at the seeds and INF elsewhere (x fastest). */
function edt3d(g, NX, NY, NZ) {
  const n = Math.max(NX, NY, NZ), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let zz = 0; zz < NZ; zz++) for (let y = 0; y < NY; y++) { const o = NX * (y + NY * zz); for (let x = 0; x < NX; x++) f[x] = g[o + x]; edt1d(f, NX, d, v, z); for (let x = 0; x < NX; x++) g[o + x] = d[x]; }
  for (let zz = 0; zz < NZ; zz++) for (let x = 0; x < NX; x++) { const o = x + NX * NY * zz; for (let y = 0; y < NY; y++) f[y] = g[o + NX * y]; edt1d(f, NY, d, v, z); for (let y = 0; y < NY; y++) g[o + NX * y] = d[y]; }
  for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) { const o = x + NX * y, S = NX * NY; for (let zz = 0; zz < NZ; zz++) f[zz] = g[o + S * zz]; edt1d(f, NZ, d, v, z); for (let zz = 0; zz < NZ; zz++) g[o + S * zz] = d[zz]; }
}

/* A module's signed distance field from its voxels (flat [x, y, z, …] in the building grid), in a box `margin` voxels
   wider than the module all round. `scale` = metres per voxel; `soft` = passes of a [1 2 1] blur, which rounds the
   voxel steps. → { x0, y0, z0, nx, ny, nz, d: Float32Array (metres), bb } */
export function moduleField(vox, margin, scale, soft = 1) {
  let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
  for (let i = 0; i < vox.length; i += 3) { const x = vox[i], y = vox[i + 1], z = vox[i + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  const bb = { x0, y0, z0, x1, y1, z1 };
  const bx = x0 - margin, by = y0 - margin, bz = z0 - margin, nx = x1 - x0 + 1 + 2 * margin, ny = y1 - y0 + 1 + 2 * margin, nz = z1 - z0 + 1 + 2 * margin, n = nx * ny * nz;
  const mask = new Uint8Array(n);
  for (let i = 0; i < vox.length; i += 3) mask[(vox[i] - bx) + nx * ((vox[i + 1] - by) + ny * (vox[i + 2] - bz))] = 1;
  const gOut = new Float64Array(n), gIn = new Float64Array(n);
  for (let i = 0; i < n; i++) { gOut[i] = mask[i] ? 0 : INF; gIn[i] = mask[i] ? INF : 0; }
  edt3d(gOut, nx, ny, nz); edt3d(gIn, nx, ny, nz);
  let d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = (mask[i] ? -(Math.sqrt(gIn[i]) - 0.5) : Math.sqrt(gOut[i]) - 0.5) * scale;
  for (let p = 0; p < soft; p++) d = blur3(d, nx, ny, nz);
  return { x0: bx, y0: by, z0: bz, nx, ny, nz, d, bb };
}
function blur3(a, NX, NY, NZ) {
  const S = [1, NX, NX * NY], dims = [NX, NY, NZ];
  let src = a, dst = new Float32Array(a.length);
  for (let ax = 0; ax < 3; ax++) {
    const st = S[ax], len = dims[ax];
    for (let i = 0; i < src.length; i++) {
      const c = ax === 0 ? i % NX : ax === 1 ? ((i / NX) | 0) % NY : (i / (NX * NY)) | 0;
      const l = c > 0 ? src[i - st] : src[i], r = c < len - 1 ? src[i + st] : src[i];
      dst[i] = 0.25 * l + 0.5 * src[i] + 0.25 * r;
    }
    [src, dst] = [dst, src];
  }
  return src;
}

/* The smooth union of the module fields over the crop box that holds them all (plus `pad` voxels).
   kOf(i, j) → blend radius in metres for modules i and j. → { x0, y0, z0, nx, ny, nz, f, lab (module index + 1 of the
   nearest), blend (0…1, how much of a point is fillet) } */
export function unionField(fields, pad, kOf) {
  let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
  for (const F of fields) { const b = F.bb; x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); z0 = Math.min(z0, b.z0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); z1 = Math.max(z1, b.z1); }
  x0 -= pad; y0 -= pad; z0 -= pad; x1 += pad; y1 += pad; z1 += pad;
  const nx = x1 - x0 + 1, ny = y1 - y0 + 1, nz = z1 - z0 + 1, n = nx * ny * nz;
  const d1 = new Float32Array(n).fill(1e9), d2 = new Float32Array(n).fill(1e9), l1 = new Int16Array(n).fill(-1), l2 = new Int16Array(n).fill(-1);
  fields.forEach((F, fi) => {
    const ax0 = Math.max(x0, F.x0), ay0 = Math.max(y0, F.y0), az0 = Math.max(z0, F.z0), ax1 = Math.min(x1, F.x0 + F.nx - 1), ay1 = Math.min(y1, F.y0 + F.ny - 1), az1 = Math.min(z1, F.z0 + F.nz - 1);
    for (let z = az0; z <= az1; z++) for (let y = ay0; y <= ay1; y++) {
      let i = (ax0 - x0) + nx * ((y - y0) + ny * (z - z0)), j = (ax0 - F.x0) + F.nx * ((y - F.y0) + F.ny * (z - F.z0));
      for (let x = ax0; x <= ax1; x++, i++, j++) {
        const v = F.d[j];
        if (v < d1[i]) { d2[i] = d1[i]; l2[i] = l1[i]; d1[i] = v; l1[i] = fi; } else if (v < d2[i]) { d2[i] = v; l2[i] = fi; }
      }
    }
  });
  const f = new Float32Array(n), lab = new Int16Array(n), blend = new Uint8Array(n), kc = new Map();
  for (let i = 0; i < n; i++) {
    const a = d1[i], b = d2[i]; lab[i] = l1[i] + 1;
    if (l2[i] < 0) { f[i] = a; continue; }
    const key = l1[i] < l2[i] ? l1[i] * 4096 + l2[i] : l2[i] * 4096 + l1[i];
    let k = kc.get(key); if (k === undefined) { k = kOf(Math.min(l1[i], l2[i]), Math.max(l1[i], l2[i])); kc.set(key, k); }
    if (k <= 0) { f[i] = a; continue; }
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    f[i] = a - h * h * k * 0.25;
    if (h > 0 && a > 0) blend[i] = Math.min(255, Math.round(h * 255));
  }
  return { x0, y0, z0, nx, ny, nz, f, lab, blend };
}

/* The union resampled `s` times finer (trilinear) and turned into the field to contour:
   kind 'shell' → hollow walls of thickness t (or the solid when t ≤ 0); kind 'floors' → plates of thickness tf every
   H metres from yBase (metres), only inside the walls. yOf(gy) → world height of grid y (metres). */
export function detailField(U, s, kind, { t = 0.6, tf = 0.35, H = 4.13, yBase = 0, yOf }) {
  const FX = (U.nx - 1) * s + 1, FY = (U.ny - 1) * s + 1, FZ = (U.nz - 1) * s + 1, out = new Float32Array(FX * FY * FZ);
  const { nx, ny, f } = U, sxy = nx * ny;
  const ys = new Float32Array(FY); for (let y = 0; y < FY; y++) ys[y] = yOf(U.y0 + y / s);
  let o = 0;
  for (let z = 0; z < FZ; z++) {
    const zc = z / s, z0 = Math.min(U.nz - 2, Math.floor(zc)), tz = zc - z0;
    for (let y = 0; y < FY; y++) {
      const yc = y / s, y0 = Math.min(ny - 2, Math.floor(yc)), ty = yc - y0, wy = ys[y];
      let plate = 0;
      if (kind === 'floors') { let q = (wy - yBase) % H; if (q < 0) q += H; if (q > H / 2) q -= H; plate = Math.abs(q + tf / 2) - tf / 2; }   // the plate's top on the level line
      for (let x = 0; x < FX; x++, o++) {
        const xc = x / s, x0 = Math.min(nx - 2, Math.floor(xc)), tx = xc - x0, b = x0 + nx * (y0 + ny * z0);
        const c00 = f[b] + (f[b + 1] - f[b]) * tx, c10 = f[b + nx] + (f[b + nx + 1] - f[b + nx]) * tx;
        const c01 = f[b + sxy] + (f[b + sxy + 1] - f[b + sxy]) * tx, c11 = f[b + sxy + nx] + (f[b + sxy + nx + 1] - f[b + sxy + nx]) * tx;
        const c0 = c00 + (c10 - c00) * ty, c1 = c01 + (c11 - c01) * ty, v = c0 + (c1 - c0) * tz;
        if (kind === 'shell') out[o] = t > 0 ? Math.max(v, -(v + t)) : v;
        else out[o] = Math.max(plate, v + t);
      }
    }
  }
  return { F: out, FX, FY, FZ };
}

/* Surface nets on a continuous field (negative inside, x fastest): one vertex per sign-changing cell at the mean of
   its edge crossings, one quad across every sign-changing grid edge, wound outward. → { pos (grid units), index } */
export function netsField(F, NX, NY, NZ) {
  const R = [1, NX, NX * NY], vIdx = new Int32Array(NX * NY * NZ).fill(-1);
  const C = [0, 1, 2, 3, 4, 5, 6, 7].map(c => [c & 1, (c >> 1) & 1, (c >> 2) & 1]), COFF = C.map(c => c[0] + NX * c[1] + NX * NY * c[2]);
  const E = []; for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) { const x = a ^ b; if (x === 1 || x === 2 || x === 4) E.push([a, b]); }
  const pos = [], idx = [], g = new Float32Array(8);
  for (let z = 0; z < NZ - 1; z++) for (let y = 0; y < NY - 1; y++) {
    let m = NX * (y + NY * z);
    for (let x = 0; x < NX - 1; x++, m++) {
      let mask = 0;
      for (let c = 0; c < 8; c++) { const v = F[m + COFF[c]]; g[c] = v; if (v < 0) mask |= 1 << c; }
      if (mask === 0 || mask === 255) continue;
      let px = 0, py = 0, pz = 0, ne = 0;
      for (const [a, b] of E) {
        if (((mask >> a) & 1) === ((mask >> b) & 1)) continue;
        const t = g[a] / (g[a] - g[b]);
        px += C[a][0] + (C[b][0] - C[a][0]) * t; py += C[a][1] + (C[b][1] - C[a][1]) * t; pz += C[a][2] + (C[b][2] - C[a][2]) * t; ne++;
      }
      vIdx[m] = pos.length / 3; pos.push(x + px / ne, y + py / ne, z + pz / ne);
      const xs = [x, y, z];
      for (let i = 0; i < 3; i++) {
        if (((mask & 1) !== 0) === ((mask >> (1 << i)) & 1 ? true : false)) continue;   // the edge from corner 0 along axis i
        const iu = (i + 1) % 3, iv = (i + 2) % 3; if (xs[iu] === 0 || xs[iv] === 0) continue;
        const du = R[iu], dv = R[iv], a = vIdx[m], b = vIdx[m - du], c = vIdx[m - du - dv], d = vIdx[m - dv];
        if (b < 0 || c < 0 || d < 0) continue;
        if (mask & 1) idx.push(a, b, c, a, c, d); else idx.push(a, d, c, a, c, b);
      }
    }
  }
  return { pos: new Float32Array(pos), index: idx.length > 65535 * 3 || pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx) };
}

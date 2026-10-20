/* ProtoSpace Analyzer — closed solids → voxels (js/explorer.js).
   loadModel(file)        OBJ, STL, GLB or GLTF → one merged triangle list (Float32Array of xyz triples, 9 per triangle)
   voxelize(tris, N)      the solid as an N×N×N occupancy grid (Uint8Array, 1 = inside), fitted into the cube with a
                          one-voxel margin, standing on the ground; x along, y up, z = 0 at the front (the viewer's lattice)
   signedDistance(occ, N) the occupancy as a signed distance field (negative inside), in voxels, clamped to ±R and scaled
                          to [-1, 1]: what the map learns and blends, so in-between designs keep crisp surfaces
   toVox(occ, N)          the viewer's source: { nx, ny, nz, sizes, max, threshold } */
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const EXT = f => (f.name.split('.').pop() || '').toLowerCase();
export const ACCEPTS = ['obj', 'stl', 'glb', 'gltf'];

/* Every mesh in the file, in world space, as one flat triangle list. */
export async function loadModel(file) {
  const ext = EXT(file), tris = [];
  const add = (geo, matrix) => {
    let g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.getAttribute('position'); if (!p) return;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); if (matrix) v.applyMatrix4(matrix); tris.push(v.x, v.y, v.z); }
  };
  if (ext === 'stl') {
    add(new STLLoader().parse(await file.arrayBuffer()));
  } else if (ext === 'obj') {
    const root = new OBJLoader().parse(await file.text());
    root.updateMatrixWorld(true); root.traverse(o => { if (o.isMesh) add(o.geometry, o.matrixWorld); });
  } else if (ext === 'glb' || ext === 'gltf') {
    const gltf = await new GLTFLoader().parseAsync(await file.arrayBuffer(), '');
    gltf.scene.updateMatrixWorld(true); gltf.scene.traverse(o => { if (o.isMesh) add(o.geometry, o.matrixWorld); });
  } else throw new Error(`"${file.name}": only OBJ, STL, GLB and GLTF files can be read.`);
  if (tris.length < 9) throw new Error(`"${file.name}" has no triangles.`);
  return new Float32Array(tris);
}

/* A model served by the site itself (assets/spaces/*.glb), as the same flat triangle list. */
export async function loadModelUrl(url) {
  const gltf = await new GLTFLoader().loadAsync(url), tris = [], v = new THREE.Vector3();
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(o => { if (!o.isMesh) return; const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry, p = g.getAttribute('position'); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); tris.push(v.x, v.y, v.z); } });
  return new Float32Array(tris);
}

/* Parity fill: for every (x, y) column a ray along z crosses the surface an even number of times when the solid is
   closed; the voxels between the 1st and 2nd crossing, the 3rd and 4th… are inside. Triangles are bucketed by the
   columns they cover, so big SubD exports (hundreds of thousands of triangles) still take well under a second. */
export function voxelize(tris, N) {
  const T = tris.length / 9;
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) for (let a = 0; a < 3; a++) { const v = tris[i + a]; if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v; }
  const size = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]], big = Math.max(...size) || 1;
  const s = (N - 2) / big;                                                        // one voxel of air around the solid
  const off = [1 + ((N - 2) - size[0] * s) / 2, 1, 1 + ((N - 2) - size[2] * s) / 2];   // centred in x and z, standing on y = 1
  const P = new Float32Array(tris.length);
  for (let i = 0; i < tris.length; i += 3) for (let a = 0; a < 3; a++) P[i + a] = (tris[i + a] - mn[a]) * s + off[a];
  // crossings per column
  const cross = new Array(N * N); for (let i = 0; i < cross.length; i++) cross[i] = null;
  for (let t = 0; t < T; t++) {
    const o = t * 9;
    const ax = P[o], ay = P[o + 1], az = P[o + 2], bx = P[o + 3], by = P[o + 4], bz = P[o + 5], cx = P[o + 6], cy = P[o + 7], cz = P[o + 8];
    const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(det) < 1e-12) continue;                                          // edge-on to the z rays
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - 0.5)), x1 = Math.min(N - 1, Math.ceil(Math.max(ax, bx, cx) - 0.5));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy) - 0.5)), y1 = Math.min(N - 1, Math.ceil(Math.max(ay, by, cy) - 0.5));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5 + 1.1e-4, py = y + 0.5 + 2.3e-4;                     // a hair off the grid: no ray lands on a shared edge
      const l1 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) / det;
      const l2 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) / det;
      const l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      const z = l1 * az + l2 * bz + l3 * cz, i = y * N + x;
      (cross[i] || (cross[i] = [])).push(z);
    }
  }
  const occ = new Uint8Array(N * N * N);
  let filled = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const c = cross[y * N + x]; if (!c || c.length < 2) continue;
    c.sort((a, b) => a - b);
    for (let k = 0; k + 1 < c.length; k += 2) {
      const za = Math.max(0, Math.ceil(c[k] - 0.5)), zb = Math.min(N - 1, Math.floor(c[k + 1] - 0.5));
      for (let z = za; z <= zb; z++) { const zi = N - 1 - z; occ[x + N * (y + N * zi)] = 1; filled++; }      // z = 0 is the front
    }
  }
  return { occ, filled, triangles: T, scale: s, size, fit: { min: mn, scale: s, off } };   // fit: model → lattice units, P = (p − min) · scale + off
}

/* Squared Euclidean distance transform (Felzenszwalb & Huttenlocher), one axis at a time. */
function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s;
    while (true) { s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); if (s <= z[k]) k--; else break; }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}
function edt3d(inside, N) {                                                       // squared distance to the nearest 'inside' voxel
  const INF = 1e12, D = new Float32Array(N * N * N);
  for (let i = 0; i < D.length; i++) D[i] = inside[i] ? 0 : INF;
  const f = new Float64Array(N), d = new Float64Array(N), v = new Int32Array(N), z = new Float64Array(N + 1);
  const pass = (stride, outer1, outer2) => {
    for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
      const base = outer1(a, b);
      for (let i = 0; i < N; i++) f[i] = D[base + i * stride];
      edt1d(f, N, d, v, z);
      for (let i = 0; i < N; i++) D[base + i * stride] = d[i];
    }
  };
  pass(1, (y, zz) => N * (y + N * zz));                                           // along x
  pass(N, (x, zz) => x + N * N * zz);                                             // along y
  pass(N * N, (x, y) => x + N * y);                                               // along z
  return D;
}
export function signedDistance(occ, N, R = 6) {
  const n = N * N * N, out = new Uint8Array(n); for (let i = 0; i < n; i++) out[i] = occ[i] ? 0 : 1;
  const dIn = edt3d(occ, N), dOut = edt3d(out, N), sdf = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = occ[i] ? -Math.sqrt(dOut[i]) + 0.5 : Math.sqrt(dIn[i]) - 0.5; sdf[i] = Math.max(-1, Math.min(1, v / R)); }
  return sdf;
}
/* The solid of a (blended) field: inside where the field is negative — or, given a share of the cube to fill, the
   voxels with the lowest field values up to that share, so a blend of thin solids does not thin out to nothing. */
export function isoOf(sdf, fill) {                                                // the field level the solid is cut at
  if (fill == null) return 0;
  const n = Math.round(Math.min(0.9, Math.max(0, fill)) * sdf.length); if (n === 0) return -Infinity;
  const sorted = Float32Array.from(sdf).sort(); return Math.min(0.6, Math.max(sorted[n - 1], -0.0001));
}
export function occupancyOf(sdf, fill) {
  const o = new Uint8Array(sdf.length), thr = isoOf(sdf, fill);
  if (thr === -Infinity) return o;
  for (let i = 0; i < sdf.length; i++) o[i] = sdf[i] <= thr ? 1 : 0;
  return o;
}

/* The signed distance field of an imported surface: near the surface, the true distance from each voxel centre to the
   triangles (so the field, and every blend of it, contours back into the smooth surface, not into its stair-steps);
   further out, the voxel field, which is what distance is anyway once a couple of voxels away. Same units as
   signedDistance: voxels / R, clamped to [-1, 1], negative inside (inside by the parity fill). */
export function meshSignedDistance(tris, fit, occ, N, R = 6) {
  const sdf = signedDistance(occ, N, R), { min, scale, off } = fit, T = tris.length / 9;
  const P = new Float32Array(tris.length);                                        // the triangles in lattice coordinates (voxelize's frame)
  for (let i = 0; i < tris.length; i += 3) for (let a = 0; a < 3; a++) P[i + a] = (tris[i + a] - min[a]) * scale + off[a];
  const cell = new Array(N * N * N), key = (x, y, z) => x + N * (y + N * z);     // triangles bucketed by the voxel cells their boxes cover
  for (let t = 0; t < T; t++) {
    const o = t * 9, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < 9; v += 3) for (let a = 0; a < 3; a++) { const c = P[o + v + a]; if (c < lo[a]) lo[a] = c; if (c > hi[a]) hi[a] = c; }
    const x0 = Math.max(0, Math.floor(lo[0])), x1 = Math.min(N - 1, Math.floor(hi[0])), y0 = Math.max(0, Math.floor(lo[1])), y1 = Math.min(N - 1, Math.floor(hi[1])), z0 = Math.max(0, Math.floor(lo[2])), z1 = Math.min(N - 1, Math.floor(hi[2]));
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const k = key(x, y, z); (cell[k] || (cell[k] = [])).push(t); }
  }
  const BAND = 2.0, FADE = 1.4, reach = 2;                                        // exact distance within BAND voxels of the voxel surface; blended out to the voxel field by BAND
  for (let zi = 0; zi < N; zi++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = x + N * (y + N * zi), dv = Math.abs(sdf[i]) * R; if (dv > BAND) continue;
    const px = x + 0.5, py = y + 0.5, pz = N - zi - 0.5;                            // the voxel centre, in the triangles' frame (z runs the other way)
    const cx = Math.floor(px), cy = Math.floor(py), cz = Math.floor(pz);
    let best = Infinity;
    for (let dz = -reach; dz <= reach; dz++) for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      const X = cx + dx, Y = cy + dy, Z = cz + dz; if (X < 0 || Y < 0 || Z < 0 || X >= N || Y >= N || Z >= N) continue;
      const l = cell[key(X, Y, Z)]; if (!l) continue;
      for (let j = 0; j < l.length; j++) { const d = triDist2(P, l[j] * 9, px, py, pz); if (d < best) best = d; }
    }
    if (best === Infinity) continue;
    const de = Math.sqrt(best) * (occ[i] ? -1 : 1) / R, w = dv <= FADE ? 1 : 1 - (dv - FADE) / (BAND - FADE);
    sdf[i] = Math.max(-1, Math.min(1, w * de + (1 - w) * sdf[i]));
  }
  return sdf;
}
/* Squared distance from a point to triangle (P[o..o+8]) — Ericson, Real-Time Collision Detection 5.1.5. */
function triDist2(P, o, px, py, pz) {
  const ax = P[o], ay = P[o + 1], az = P[o + 2], bx = P[o + 3], by = P[o + 4], bz = P[o + 5], cx = P[o + 6], cy = P[o + 7], cz = P[o + 8];
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az, apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let qx, qy, qz;
  if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; }
  else {
    const bpx = px - bx, bpy = py - by, bpz = pz - bz, d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { qx = bx; qy = by; qz = bz; }
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); qx = ax + v * abx; qy = ay + v * aby; qz = az + v * abz; }
      else {
        const cpx = px - cx, cpy = py - cy, cpz = pz - cz, d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) { qx = cx; qy = cy; qz = cz; }
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); qx = ax + w * acx; qy = ay + w * acy; qz = az + w * acz; }
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); qx = bx + w * (cx - bx); qy = by + w * (cy - by); qz = bz + w * (cz - bz); }
            else { const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w; }
          }
        }
      }
    }
  }
  return (px - qx) * (px - qx) + (py - qy) * (py - qy) + (pz - qz) * (pz - qz);
}
export function toVox(occ, N) {
  const sizes = new Uint8Array(occ.length); for (let i = 0; i < occ.length; i++) sizes[i] = occ[i] ? 255 : 0;
  return { nx: N, ny: N, nz: N, sizes, max: 255, threshold: 128 };
}

/* The symmetry variants of a cube grid: mirrored across x, across z, and turned a quarter about y. */
export function mirrorX(a, N) { const b = new a.constructor(a.length); for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) b[x + N * (y + N * z)] = a[(N - 1 - x) + N * (y + N * z)]; return b; }
export function mirrorZ(a, N) { const b = new a.constructor(a.length); for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) b[x + N * (y + N * z)] = a[x + N * (y + N * (N - 1 - z))]; return b; }
export function rotateY(a, N) { const b = new a.constructor(a.length); for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) b[x + N * (y + N * z)] = a[z + N * (y + N * (N - 1 - x))]; return b; }

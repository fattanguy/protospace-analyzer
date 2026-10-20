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
export function occupancyOf(sdf, fill) {
  const o = new Uint8Array(sdf.length);
  let thr = 0;
  if (fill != null) { const n = Math.round(Math.min(0.9, Math.max(0, fill)) * sdf.length); const sorted = Float32Array.from(sdf).sort(); thr = n > 0 ? Math.min(0.6, Math.max(sorted[n - 1], -0.0001)) : -Infinity; if (n === 0) return o; }
  for (let i = 0; i < sdf.length; i++) o[i] = sdf[i] <= thr ? 1 : 0;
  return o;
}
export function toVox(occ, N) {
  const sizes = new Uint8Array(occ.length); for (let i = 0; i < occ.length; i++) sizes[i] = occ[i] ? 255 : 0;
  return { nx: N, ny: N, nz: N, sizes, max: 255, threshold: 128 };
}

/* The symmetry variants of a cube grid: mirrored across x, across z, and turned a quarter about y. */
export function mirrorX(a, N) { const b = new a.constructor(a.length); for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) b[x + N * (y + N * z)] = a[(N - 1 - x) + N * (y + N * z)]; return b; }
export function mirrorZ(a, N) { const b = new a.constructor(a.length); for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) b[x + N * (y + N * z)] = a[x + N * (y + N * (N - 1 - z))]; return b; }
export function rotateY(a, N) { const b = new a.constructor(a.length); for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) b[x + N * (y + N * z)] = a[z + N * (y + N * (N - 1 - x))]; return b; }

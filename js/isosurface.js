/* ProtoSpace Analyzer — a signed distance field as one smooth surface (js/explorer.js: every tile of the map).
   The field is contoured at `iso` with marching cubes (three.js's addon), the surface position interpolated along
   each edge from the field values and the normals taken from the field's gradient — so a design's field gives back
   its smooth surface and a blended field gives a smooth in-between, with no cube stair-steps.
   Coordinates are the lattice's: voxel (x, y, z) is centred at (x + ½, y + ½, −z − ½), the same frame as the cube
   geometry drawn before. */
import * as THREE from 'three';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';

let mc = null, mcSize = 0;
/* sdf: N³ values, negative inside; the solid is where sdf <= iso. Returns a non-indexed BufferGeometry with normals. */
export function fieldGeometry(sdf, N, iso = 0) {
  const PAD = 2, S = N + 2 * PAD, S2 = S * S;                                    // two padding layers of 'outside' round the grid (the addon skips its outer layer, and the next must be empty)
  if (!mc || mcSize !== S) { mc = new MarchingCubes(S, new THREE.MeshBasicMaterial(), false, false, 240000); mcSize = S; }
  const f = mc.field; f.fill(-1);                                                 // inside is high: the field is −sdf, cut at −iso
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) f[(x + PAD) + S * ((y + PAD) + S * (z + PAD))] = -sdf[x + N * (y + N * z)];
  mc.isolation = -iso; mc.normal_cache.fill(0); mc.update();
  const n = mc.count, half = S / 2, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  const P = mc.geometry.getAttribute('position').array, Nn = mc.geometry.getAttribute('normal').array;
  for (let i = 0; i < n; i++) {
    const t = i - i % 3, o = t + (i === t ? 0 : i === t + 1 ? 2 : 1);              // the z flip mirrors the winding: swap two corners of every triangle back
    pos[o * 3] = (P[i * 3] + 1) * half - PAD + 0.5; pos[o * 3 + 1] = (P[i * 3 + 1] + 1) * half - PAD + 0.5; pos[o * 3 + 2] = -((P[i * 3 + 2] + 1) * half - PAD + 0.5);
    nor[o * 3] = Nn[i * 3]; nor[o * 3 + 1] = Nn[i * 3 + 1]; nor[o * 3 + 2] = -Nn[i * 3 + 2];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

/* A voxel solid as a SubD-like surface — the same recipe the printed/imported SubDs were made with: the cubes
   up-sampled 2×, blurred by a small radius (≈ 0.4 voxel, so faces stay flat and edges round by that much), and
   contoured at the half level. The map's in-betweens are drawn this way, so they keep the designs' square edges. */
const UP = 2, SIG = 0.8, KR = 2;
const kernel = (() => { const k = []; let s = 0; for (let i = -KR; i <= KR; i++) { const w = Math.exp(-(i * i) / (2 * SIG * SIG)); k.push(w); s += w; } return k.map(w => w / s); })();
let fa = null, fb = null, faSize = 0;
export function blockGeometry(occ, N) {
  const M = N * UP, PAD = 2, S = M + 2 * PAD, S2 = S * S, S3 = S2 * S;          // two layers of 'outside' round the grid: the addon skips its outer layer, and the next one must be empty too
  if (!mc || mcSize !== S) { mc = new MarchingCubes(S, new THREE.MeshBasicMaterial(), false, false, 400000); mcSize = S; }
  if (!fa || faSize !== S3) { fa = new Float32Array(S3); fb = new Float32Array(S3); faSize = S3; }
  fa.fill(0);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!occ[x + N * (y + N * z)]) continue;
    for (let dz = 0; dz < UP; dz++) for (let dy = 0; dy < UP; dy++) for (let dx = 0; dx < UP; dx++) fa[(x * UP + dx + PAD) + S * ((y * UP + dy + PAD) + S * (z * UP + dz + PAD))] = 1;
  }
  const pass = (src, dst, stride) => { for (let i = 0; i < S3; i++) { let v = 0; for (let k = -KR; k <= KR; k++) { const j = i + k * stride; if (j >= 0 && j < S3) v += kernel[k + KR] * src[j]; } dst[i] = v; } };
  pass(fa, fb, 1); pass(fb, fa, S); pass(fa, fb, S2);
  mc.field.set(fb); mc.isolation = 0.5; mc.normal_cache.fill(0); mc.update();
  const n = mc.count, half = S / 2, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  const P = mc.geometry.getAttribute('position').array, Nn = mc.geometry.getAttribute('normal').array;
  for (let i = 0; i < n; i++) {
    const t = i - i % 3, o = t + (i === t ? 0 : i === t + 1 ? 2 : 1);
    const X = ((P[i * 3] + 1) * half - PAD + 0.5) / UP, Y = ((P[i * 3 + 1] + 1) * half - PAD + 0.5) / UP, Z = ((P[i * 3 + 2] + 1) * half - PAD + 0.5) / UP;
    pos[o * 3] = X; pos[o * 3 + 1] = Y; pos[o * 3 + 2] = -Z;
    nor[o * 3] = Nn[i * 3]; nor[o * 3 + 1] = Nn[i * 3 + 1]; nor[o * 3 + 2] = -Nn[i * 3 + 2];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

/* A voxel solid as an organic SubD-like surface — the recipe the fifteen inputs were made with, so the map's
   in-betweens keep their character (large open rooms, thin branching walls) instead of turning into boxes:
   specks dropped, one-voxel grooves closed (2³ closing), the cubes up-sampled 2×, blurred by ≈ 0.45 voxel and
   contoured a little fat (so thin walls survive), then the mesh Taubin-smoothed (rounds the stair-steps without
   shrinking) and given smooth normals. Returns an indexed BufferGeometry. */
export function cleanOccupancy(occ, N, speck = 8) {
  const n = N * N * N, lab = new Int32Array(n), out = new Uint8Array(n), stack = [];
  let comp = 0;
  const idx = (x, y, z) => x + N * (y + N * z);
  for (let i = 0; i < n; i++) {
    if (!occ[i] || lab[i]) continue;
    comp++; lab[i] = comp; stack.length = 0; stack.push(i); const cells = [i];
    while (stack.length) {
      const j = stack.pop(), x = j % N, y = ((j / N) | 0) % N, z = (j / (N * N)) | 0;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const X = x + dx, Y = y + dy, Z = z + dz; if (X < 0 || Y < 0 || Z < 0 || X >= N || Y >= N || Z >= N) continue;
        const k = idx(X, Y, Z); if (!occ[k] || lab[k]) continue; lab[k] = comp; stack.push(k); cells.push(k);
      }
    }
    if (cells.length >= speck) for (const k of cells) out[k] = 1;
  }
  // closing with a 2 × 2 × 2 element: dilate, then erode (fills one-voxel grooves and notches, keeps thin walls)
  const dil = new Uint8Array(n), ero = new Uint8Array(n);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0; for (let dz = 0; dz < 2 && !v; dz++) for (let dy = 0; dy < 2 && !v; dy++) for (let dx = 0; dx < 2 && !v; dx++) { const X = x - dx, Y = y - dy, Z = z - dz; if (X >= 0 && Y >= 0 && Z >= 0 && out[idx(X, Y, Z)]) v = 1; }
    dil[idx(x, y, z)] = v;
  }
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 1; for (let dz = 0; dz < 2 && v; dz++) for (let dy = 0; dy < 2 && v; dy++) for (let dx = 0; dx < 2 && v; dx++) { const X = x + dx, Y = y + dy, Z = z + dz; if (X >= N || Y >= N || Z >= N || !dil[idx(X, Y, Z)]) v = 0; }
    ero[idx(x, y, z)] = v;
  }
  for (let i = 0; i < n; i++) if (out[i]) ero[i] = 1;                              // never lose what was there
  return ero;
}
const OUP = 2, OSIG = 0.9, OKR = 2, OISO = 0.44, TAUBIN = 24;
const okernel = (() => { const k = []; let s = 0; for (let i = -OKR; i <= OKR; i++) { const w = Math.exp(-(i * i) / (2 * OSIG * OSIG)); k.push(w); s += w; } return k.map(w => w / s); })();
let oa = null, ob = null, oaSize = 0;
export function organicGeometry(occ, N) {
  const M = N * OUP, PAD = 2, S = M + 2 * PAD, S2 = S * S, S3 = S2 * S;
  if (!mc || mcSize !== S) { mc = new MarchingCubes(S, new THREE.MeshBasicMaterial(), false, false, 400000); mcSize = S; }
  if (!oa || oaSize !== S3) { oa = new Float32Array(S3); ob = new Float32Array(S3); oaSize = S3; }
  oa.fill(0);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!occ[x + N * (y + N * z)]) continue;
    for (let dz = 0; dz < OUP; dz++) for (let dy = 0; dy < OUP; dy++) for (let dx = 0; dx < OUP; dx++) oa[(x * OUP + dx + PAD) + S * ((y * OUP + dy + PAD) + S * (z * OUP + dz + PAD))] = 1;
  }
  const pass = (src, dst, stride) => { for (let i = 0; i < S3; i++) { let v = 0; for (let k = -OKR; k <= OKR; k++) { const j = i + k * stride; if (j >= 0 && j < S3) v += okernel[k + OKR] * src[j]; } dst[i] = v; } };
  pass(oa, ob, 1); pass(ob, oa, S); pass(oa, ob, S2);
  mc.field.set(ob); mc.isolation = OISO; mc.normal_cache.fill(0); mc.update();
  // weld the triangle soup into an indexed mesh (positions quantised), with the z flip and winding fix
  const n = mc.count, half = S / 2, P = mc.geometry.getAttribute('position').array;
  const key2i = new Map(), pos = [], index = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i - i % 3, o = t + (i === t ? 0 : i === t + 1 ? 2 : 1);
    const X = ((P[i * 3] + 1) * half - PAD + 0.5) / OUP, Y = ((P[i * 3 + 1] + 1) * half - PAD + 0.5) / OUP, Z = -(((P[i * 3 + 2] + 1) * half - PAD + 0.5) / OUP);
    const key = `${Math.round(X * 2000)},${Math.round(Y * 2000)},${Math.round(Z * 2000)}`;
    let id = key2i.get(key); if (id === undefined) { id = pos.length / 3; key2i.set(key, id); pos.push(X, Y, Z); }
    index[o] = id;
  }
  const V = pos.length / 3, p = new Float32Array(pos);
  // Taubin smoothing (λ = 0.5, μ = −0.53) over the one-ring neighbours
  const nbr = Array.from({ length: V }, () => []);
  for (let t = 0; t < n; t += 3) { const a = index[t], b = index[t + 1], c = index[t + 2]; nbr[a].push(b, c); nbr[b].push(a, c); nbr[c].push(a, b); }
  const q = new Float32Array(V * 3);
  const step = (lam) => { for (let v = 0; v < V; v++) { const nb = nbr[v]; if (!nb.length) { q[v * 3] = p[v * 3]; q[v * 3 + 1] = p[v * 3 + 1]; q[v * 3 + 2] = p[v * 3 + 2]; continue; } let sx = 0, sy = 0, sz = 0; for (const u of nb) { sx += p[u * 3]; sy += p[u * 3 + 1]; sz += p[u * 3 + 2]; } const k = nb.length; q[v * 3] = p[v * 3] + lam * (sx / k - p[v * 3]); q[v * 3 + 1] = p[v * 3 + 1] + lam * (sy / k - p[v * 3 + 1]); q[v * 3 + 2] = p[v * 3 + 2] + lam * (sz / k - p[v * 3 + 2]); } p.set(q); };
  for (let it = 0; it < TAUBIN; it++) { step(0.5); step(-0.53); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setIndex(new THREE.BufferAttribute(index, 1)); g.computeVertexNormals();
  return g;
}

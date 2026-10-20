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
  const S = N + 2, S2 = S * S;                                                   // one padding layer of 'outside' round the grid (the addon skips its outer layer)
  if (!mc || mcSize !== S) { mc = new MarchingCubes(S, new THREE.MeshBasicMaterial(), false, false, 240000); mcSize = S; }
  const f = mc.field; f.fill(-1);                                                 // inside is high: the field is −sdf, cut at −iso
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) f[(x + 1) + S * ((y + 1) + S * (z + 1))] = -sdf[x + N * (y + N * z)];
  mc.isolation = -iso; mc.normal_cache.fill(0); mc.update();
  const n = mc.count, half = S / 2, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  const P = mc.geometry.getAttribute('position').array, Nn = mc.geometry.getAttribute('normal').array;
  for (let i = 0; i < n; i++) {
    const t = i - i % 3, o = t + (i === t ? 0 : i === t + 1 ? 2 : 1);              // the z flip mirrors the winding: swap two corners of every triangle back
    pos[o * 3] = (P[i * 3] + 1) * half - 0.5; pos[o * 3 + 1] = (P[i * 3 + 1] + 1) * half - 0.5; pos[o * 3 + 2] = -((P[i * 3 + 2] + 1) * half - 0.5);
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
  const M = N * UP, S = M + 2, S2 = S * S, S3 = S2 * S;
  if (!mc || mcSize !== S) { mc = new MarchingCubes(S, new THREE.MeshBasicMaterial(), false, false, 400000); mcSize = S; }
  if (!fa || faSize !== S3) { fa = new Float32Array(S3); fb = new Float32Array(S3); faSize = S3; }
  fa.fill(0);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!occ[x + N * (y + N * z)]) continue;
    for (let dz = 0; dz < UP; dz++) for (let dy = 0; dy < UP; dy++) for (let dx = 0; dx < UP; dx++) fa[(x * UP + dx + 1) + S * ((y * UP + dy + 1) + S * (z * UP + dz + 1))] = 1;
  }
  const pass = (src, dst, stride) => { for (let i = 0; i < S3; i++) { let v = 0; for (let k = -KR; k <= KR; k++) { const j = i + k * stride; if (j >= 0 && j < S3) v += kernel[k + KR] * src[j]; } dst[i] = v; } };
  pass(fa, fb, 1); pass(fb, fa, S); pass(fa, fb, S2);
  mc.field.set(fb); mc.isolation = 0.5; mc.normal_cache.fill(0); mc.update();
  const n = mc.count, half = S / 2, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  const P = mc.geometry.getAttribute('position').array, Nn = mc.geometry.getAttribute('normal').array;
  for (let i = 0; i < n; i++) {
    const t = i - i % 3, o = t + (i === t ? 0 : i === t + 1 ? 2 : 1);
    const X = ((P[i * 3] + 1) * half - 1 + 0.5) / UP, Y = ((P[i * 3 + 1] + 1) * half - 1 + 0.5) / UP, Z = ((P[i * 3 + 2] + 1) * half - 1 + 0.5) / UP;
    pos[o * 3] = X; pos[o * 3 + 1] = Y; pos[o * 3 + 2] = -Z;
    nor[o * 3] = Nn[i * 3]; nor[o * 3 + 1] = Nn[i * 3 + 1]; nor[o * 3 + 2] = -Nn[i * 3 + 2];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

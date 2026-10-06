/* ProtoSpace Analyzer — the pattern field of the Blender animation, in the browser.
   This is the maths of the "ProtoSpace Voxel Controls" geometry-nodes group (blender/protospace_controls.py):
   a grid of points 0.14 apart fills the slab; a pattern (Noise, Voronoi, Wave or Pure Tone) is read at each
   point, slid through the slab over one loop (two evaluations cross-faded so the loop is seamless), mapped
   through the growth ramp (grow from → full size at), optionally inverted and stepped, and turned into the
   size of the cube on that point. Pure ES module, no DOM: it runs in a Web Worker and in Node. */

export const DEFAULTS = {
  pattern: 'noise',                       // noise | voronoi | wave | tone
  scale: 0.49, offset: [0, 0, 0], invert: false,
  animate: true, loopLength: 250, travel: [0, 0, 25], frameOffset: 0,
  keyed: { enabled: false, axis: 2, f0: 0, v0: 0, f1: 300, v1: 50, ease: 'bezier' },   // a keyframed Offset component, as in the .blend
  growFrom: 0.52, fullSizeAt: 0.54, smallest: 0, largest: 1, sizeSteps: 0,
  cubeSize: 0.13, bevel: 0.01,
  spacing: 0.14, dims: [123, 19, 31],      // across, up, deep (points) — the exported Blender slab
  noise: { detail: 2, roughness: 0.5, lacunarity: 2, distortion: 0 },
  voronoi: { metric: 'chebychev', randomness: 1, w: 0, detail: 0 },
  wave: { type: 'rings', distortion: 38.2, detail: 4.1, detailScale: 1, detailRoughness: 0.4621 },
  tone: { bandSpacing: 9, amplitude: 3, wavelength: 40, depthSkew: 135, travelCycles: 3, riseCycles: 1, growFrom: 0.68, fullSizeAt: 0.82 },
};
const GRID_ORIGIN_M = [13, 61, 9];        // metres from the slab's corner at the object origin (pure tone)
const TAU = Math.PI * 2;

// ------------------------------------------------------------------ Blender's hashes (Cycles util/hash.h: Bob Jenkins' lookup3)
const rot = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;
let _a = 0, _b = 0, _c = 0;
function jmix() {
  _a = (_a - _c) >>> 0; _a ^= rot(_c, 4); _c = (_c + _b) >>> 0;
  _b = (_b - _a) >>> 0; _b ^= rot(_a, 6); _a = (_a + _c) >>> 0;
  _c = (_c - _b) >>> 0; _c ^= rot(_b, 8); _b = (_b + _a) >>> 0;
  _a = (_a - _c) >>> 0; _a ^= rot(_c, 16); _c = (_c + _b) >>> 0;
  _b = (_b - _a) >>> 0; _b ^= rot(_a, 19); _a = (_a + _c) >>> 0;
  _c = (_c - _b) >>> 0; _c ^= rot(_b, 4); _b = (_b + _a) >>> 0;
}
function jfinal() {
  _c ^= _b; _c = (_c - rot(_b, 14)) >>> 0;
  _a ^= _c; _a = (_a - rot(_c, 11)) >>> 0;
  _b ^= _a; _b = (_b - rot(_a, 25)) >>> 0;
  _c ^= _b; _c = (_c - rot(_b, 16)) >>> 0;
  _a ^= _c; _a = (_a - rot(_c, 4)) >>> 0;
  _b ^= _a; _b = (_b - rot(_a, 14)) >>> 0;
  _c ^= _b; _c = (_c - rot(_b, 24)) >>> 0;
}
export function hashUint3(kx, ky, kz) {
  _a = _b = _c = (0xdeadbeef + (3 << 2) + 13) >>> 0;
  _c = (_c + kz) >>> 0; _b = (_b + ky) >>> 0; _a = (_a + kx) >>> 0;
  jfinal(); return _c;
}
export function hashUint4(kx, ky, kz, kw) {
  _a = _b = _c = (0xdeadbeef + (4 << 2) + 13) >>> 0;
  _a = (_a + kx) >>> 0; _b = (_b + ky) >>> 0; _c = (_c + kz) >>> 0;
  jmix();
  _a = (_a + kw) >>> 0;
  jfinal(); return _c;
}
let _p0 = 0, _p1 = 0, _p2 = 0, _p3 = 0;
const TO01 = 1 / 0x7fffffff;
/* Blender's hash_pcg4d_i → int_to_float_01: four floats in [0, 1] for an integer 4D cell */
export function pcg4(x, y, z, w) {
  x = (Math.imul(x, 1664525) + 1013904223) | 0; y = (Math.imul(y, 1664525) + 1013904223) | 0;
  z = (Math.imul(z, 1664525) + 1013904223) | 0; w = (Math.imul(w, 1664525) + 1013904223) | 0;
  x = (x + Math.imul(y, w)) | 0; y = (y + Math.imul(z, x)) | 0; z = (z + Math.imul(x, y)) | 0; w = (w + Math.imul(y, z)) | 0;
  x ^= x >> 16; y ^= y >> 16; z ^= z >> 16; w ^= w >> 16;
  x = (x + Math.imul(y, w)) | 0; y = (y + Math.imul(z, x)) | 0; z = (z + Math.imul(x, y)) | 0; w = (w + Math.imul(y, z)) | 0;
  _p0 = (x & 0x7fffffff) * TO01; _p1 = (y & 0x7fffffff) * TO01; _p2 = (z & 0x7fffffff) * TO01; _p3 = (w & 0x7fffffff) * TO01;
}

// ------------------------------------------------------------------ Blender's Perlin noise (Cycles svm/noise.h)
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
function grad3(h, x, y, z) { h &= 15; const u = h < 8 ? x : y, v = h < 4 ? y : (h === 12 || h === 14 ? x : z); return ((h & 1) ? -u : u) + ((h & 2) ? -v : v); }
/* signed Perlin noise, bit-for-bit the construction of Blender's perlin_signed (values in about [-1, 1]).
   Neighbouring lattice points share noise cells, so the eight corner hashes are kept in a small cache. */
const CACHE_N = 256, cacheKey = new Int32Array(CACHE_N * 3).fill(0x7fffffff), cacheH = new Uint32Array(CACHE_N * 8);
export function perlin(x, y, z) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  const fx = x - X, fy = y - Y, fz = z - Z;
  const u = fade(fx), v = fade(fy), w = fade(fz);
  const slot = ((Math.imul(X, 73856093) ^ Math.imul(Y, 19349663) ^ Math.imul(Z, 83492791)) & (CACHE_N - 1)), k3 = slot * 3, k8 = slot * 8;
  if (cacheKey[k3] !== X || cacheKey[k3 + 1] !== Y || cacheKey[k3 + 2] !== Z) {
    const X0 = X >>> 0, X1 = (X + 1) >>> 0, Y0 = Y >>> 0, Y1 = (Y + 1) >>> 0, Z0 = Z >>> 0, Z1 = (Z + 1) >>> 0;
    cacheH[k8] = hashUint3(X0, Y0, Z0); cacheH[k8 + 1] = hashUint3(X1, Y0, Z0); cacheH[k8 + 2] = hashUint3(X0, Y1, Z0); cacheH[k8 + 3] = hashUint3(X1, Y1, Z0);
    cacheH[k8 + 4] = hashUint3(X0, Y0, Z1); cacheH[k8 + 5] = hashUint3(X1, Y0, Z1); cacheH[k8 + 6] = hashUint3(X0, Y1, Z1); cacheH[k8 + 7] = hashUint3(X1, Y1, Z1);
    cacheKey[k3] = X; cacheKey[k3 + 1] = Y; cacheKey[k3 + 2] = Z;
  }
  const r = lerp(lerp(lerp(grad3(cacheH[k8], fx, fy, fz), grad3(cacheH[k8 + 1], fx - 1, fy, fz), u), lerp(grad3(cacheH[k8 + 2], fx, fy - 1, fz), grad3(cacheH[k8 + 3], fx - 1, fy - 1, fz), u), v),
    lerp(lerp(grad3(cacheH[k8 + 4], fx, fy, fz - 1), grad3(cacheH[k8 + 5], fx - 1, fy, fz - 1), u), lerp(grad3(cacheH[k8 + 6], fx, fy - 1, fz - 1), grad3(cacheH[k8 + 7], fx - 1, fy - 1, fz - 1), u), v), w);
  return isFinite(r) ? 0.9820 * r : 0;
}
/* Blender's fBM (Noise Texture, normalised): octaves = floor(detail) + a blended remainder; returns 0..1 */
export function noiseFbm(x, y, z, detail, roughness, lacunarity) {
  let fscale = 1, amp = 1, maxamp = 0, sum = 0;
  const n = Math.floor(detail), rmd = detail - n;
  for (let i = 0; i <= n; i++) { sum += perlin(x * fscale, y * fscale, z * fscale) * amp; maxamp += amp; amp *= roughness; fscale *= lacunarity; }
  if (rmd !== 0) { const sum2 = sum + perlin(x * fscale, y * fscale, z * fscale) * amp; return lerp(0.5 * sum / maxamp + 0.5, 0.5 * sum2 / (maxamp + amp) + 0.5, rmd); }
  return 0.5 * sum / maxamp + 0.5;
}
function noiseTexture(x, y, z, scale, N) {
  x *= scale; y *= scale; z *= scale;
  if (N.distortion) {                                         // Blender warps the input by three offset noises
    const d = N.distortion;
    const dx = perlin(x + 100.46, y + 112.47, z + 155.52) * d, dy = perlin(x + 150.07, y + 103.38, z + 187.03) * d, dz = perlin(x + 170.82, y + 191.4, z + 126.96) * d;
    x += dx; y += dy; z += dz;
  }
  return noiseFbm(x, y, z, N.detail, N.roughness, N.lacunarity);
}

// ------------------------------------------------------------------ Blender's 4D Voronoi, F1 distance (Cycles svm/voronoi.h)
/* The 81 candidate points of a 4D cell are hashed once and kept in a 4-entry cache (the pattern is read at
   two offsets per point, and consecutive points stay in the same cells). */
const VC_N = 4, vcKey = new Float64Array(VC_N * 5).fill(NaN), vcPts = new Float64Array(VC_N * 324), vcOff = new Int8Array(324);
{ let n = 0; for (let u = -1; u <= 1; u++) for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { vcOff[n++] = i; vcOff[n++] = j; vcOff[n++] = k; vcOff[n++] = u; } }
let vcNext = 0;
function voronoiF1(x, y, z, w, randomness, metric) {
  const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z), cw = Math.floor(w);
  const fx = x - cx, fy = y - cy, fz = z - cz, fw = w - cw;
  let slot = -1;
  for (let s = 0; s < VC_N; s++) { const k = s * 5; if (vcKey[k] === cx && vcKey[k + 1] === cy && vcKey[k + 2] === cz && vcKey[k + 3] === cw && vcKey[k + 4] === randomness) { slot = s; break; } }
  if (slot < 0) {
    slot = vcNext; vcNext = (vcNext + 1) % VC_N;
    const k = slot * 5; vcKey[k] = cx; vcKey[k + 1] = cy; vcKey[k + 2] = cz; vcKey[k + 3] = cw; vcKey[k + 4] = randomness;
    let n = slot * 324;
    for (let m = 0; m < 324; m += 4) {
      pcg4(cx + vcOff[m], cy + vcOff[m + 1], cz + vcOff[m + 2], cw + vcOff[m + 3]);
      vcPts[n++] = vcOff[m] + _p0 * randomness; vcPts[n++] = vcOff[m + 1] + _p1 * randomness; vcPts[n++] = vcOff[m + 2] + _p2 * randomness; vcPts[n++] = vcOff[m + 3] + _p3 * randomness;
    }
  }
  const P = vcPts, base = slot * 324, cheb = metric === 'chebychev', manh = metric === 'manhattan';
  let best = Infinity;
  for (let n = base; n < base + 324; n += 4) {
    const px = P[n] - fx, py = P[n + 1] - fy, pz = P[n + 2] - fz, pw = P[n + 3] - fw;
    const ax = px < 0 ? -px : px, ay = py < 0 ? -py : py, az = pz < 0 ? -pz : pz, aw = pw < 0 ? -pw : pw;
    const d = cheb ? (ax > ay ? (ax > az ? (ax > aw ? ax : aw) : (az > aw ? az : aw)) : (ay > az ? (ay > aw ? ay : aw) : (az > aw ? az : aw))) : manh ? ax + ay + az + aw : px * px + py * py + pz * pz + pw * pw;
    if (d < best) best = d;
  }
  return cheb || manh ? best : Math.sqrt(best);
}
function voronoiTexture(x, y, z, scale, V) {
  x *= scale; y *= scale; z *= scale; const w = V.w * scale;
  const n = Math.floor(V.detail), rmd = V.detail - n;
  let amp = 1, fscale = 1, sum = 0;
  for (let i = 0; i <= n; i++) { sum += voronoiF1(x * fscale, y * fscale, z * fscale, w * fscale, V.randomness, V.metric) * amp; amp *= 0.5; fscale *= 2; }
  if (rmd > 0) sum += voronoiF1(x * fscale, y * fscale, z * fscale, w * fscale, V.randomness, V.metric) * amp * rmd;
  return sum;
}

// ------------------------------------------------------------------ Wave texture (bands / rings along X, sine profile)
function waveTexture(x, y, z, scale, W) {
  x *= scale; y *= scale; z *= scale;
  let n = W.type === 'rings' ? Math.sqrt(x * x + y * y + z * z) * 20 : x * 20;
  if (W.distortion) n += W.distortion * (noiseFbm(x * W.detailScale, y * W.detailScale, z * W.detailScale, W.detail, W.detailRoughness, 2) * 2 - 1);
  return 0.5 + 0.5 * Math.sin(n - Math.PI / 2);
}

// ------------------------------------------------------------------ the pattern group
export function patternValue(S, x, y, z) {
  switch (S.pattern) {
    case 'voronoi': return voronoiTexture(x, y, z, S.scale, S.voronoi);
    case 'wave': return waveTexture(x, y, z, S.scale, S.wave);
    case 'tone': return 0;
    default: return noiseTexture(x, y, z, S.scale, S.noise);
  }
}
const mapRange = (v, a, b) => { if (b === a) return v >= b ? 1 : 0; const t = (v - a) / (b - a); return t < 0 ? 0 : t > 1 ? 1 : t; };

/* A keyframed Offset component (two keys with flat Bezier handles, i.e. an ease in and out) at a frame. */
export function keyedValue(K, frame) {
  if (!K || !K.enabled) return null;
  const f0 = Math.min(K.f0, K.f1), f1 = Math.max(K.f0, K.f1), v0 = K.f0 <= K.f1 ? K.v0 : K.v1, v1 = K.f0 <= K.f1 ? K.v1 : K.v0;
  if (f1 === f0) return v1;
  let u = (frame - f0) / (f1 - f0); u = u < 0 ? 0 : u > 1 ? 1 : u;
  if (K.ease === 'bezier') u = u * u * (3 - 2 * u);
  return v0 + (v1 - v0) * u;
}
/* The settings as they stand at one frame: the keyframed Offset component applied. */
export function settingsAt(S, frame) {
  const v = keyedValue(S.keyed, frame);
  if (v == null) return S;
  const offset = S.offset.slice(); offset[S.keyed.axis] = v;
  return Object.assign({}, S, { offset });
}

/* The time of a frame: t runs 0 → 1 over one loop. */
export function loopTime(S, frame) {
  const f = frame * (S.animate ? 1 : 0) + S.frameOffset;
  const t = f / Math.max(1, S.loopLength);
  return t - Math.floor(t);
}

/* The cube size at one point of the lattice (object-space position px, py, pz in Blender units). */
export function sizeAt(S, t, px, py, pz) {
  let s;
  if (S.pattern === 'tone') {
    const T = S.tone, sp = S.spacing;
    const mx = (px + S.offset[0]) / sp + GRID_ORIGIN_M[0], my = (py + S.offset[1]) / sp + GRID_ORIGIN_M[1], mz = (pz + S.offset[2]) / sp + GRID_ORIGIN_M[2];
    const d = Math.sin(TAU * (my / T.wavelength + mx / T.depthSkew - T.travelCycles * t)) * T.amplitude;
    const v = 0.5 + 0.5 * Math.sin(TAU * ((mz - d) / T.bandSpacing - T.riseCycles * t));
    s = mapRange(v, T.growFrom, T.fullSizeAt);
  } else {
    const ax = px + S.travel[0] * t + S.offset[0], ay = py + S.travel[1] * t + S.offset[1], az = pz + S.travel[2] * t + S.offset[2];
    const bx = px + S.travel[0] * (t - 1) + S.offset[0], by = py + S.travel[1] * (t - 1) + S.offset[1], bz = pz + S.travel[2] * (t - 1) + S.offset[2];
    const a = patternValue(S, ax, ay, az);
    const b = t === 0 ? a : patternValue(S, bx, by, bz);
    s = mapRange(a + (b - a) * t, S.growFrom, S.fullSizeAt);
  }
  if (S.invert) s = 1 - s;
  if (S.sizeSteps > 0) { const n = Math.max(1, S.sizeSteps); s = Math.round(s * n) / n; }
  return s * (S.largest - S.smallest) + S.smallest;
}

/* The whole lattice at one frame: sizes 0..255 (clamped at "Largest Cube" = 1), x fastest, then y, then z —
   the same layout and axes as blender/export_frame.py (across = Blender +Y, up = +Z, depth = −X). */
export function generateFrame(S, frame, out) {
  const [nx, ny, nz] = S.dims;
  return generateRange(S, frame, 0, nz, out && out.length === nx * ny * nz ? out : new Uint8Array(nx * ny * nz), 0);
}
/* Depth slices z0 ≤ z < z1 of the lattice, written into `out` starting at offset `at` (for worker pools). */
export function generateRange(S0, frame, z0, z1, out, at = 0) {
  const S = settingsAt(S0, frame);
  const [nx, ny, nz] = S.dims, sp = S.spacing, t = loopTime(S, frame);
  const sizes = out || new Uint8Array(nx * ny * (z1 - z0));
  // the grid is centred on the object origin, like the Blender slab
  const ox = -(nz - 1) / 2 * sp, oy = -(nx - 1) / 2 * sp, oz = -(ny - 1) / 2 * sp;
  let i = at;
  for (let z = z0; z < z1; z++) {
    const px = ox + (nz - 1 - z) * sp;                      // depth index 0 = nearest the camera (+X)
    for (let y = 0; y < ny; y++) {
      const pz = oz + y * sp;
      for (let x = 0; x < nx; x++, i++) {
        const py = oy + x * sp;
        const s = sizeAt(S, t, px, py, pz);
        sizes[i] = s <= 0 ? 0 : s >= 1 ? 255 : Math.round(s * 255);
      }
    }
  }
  return sizes;
}

/* Merge a partial settings object into a full one (deep for the per-pattern groups). */
export function withDefaults(partial) {
  const S = JSON.parse(JSON.stringify(DEFAULTS));
  if (!partial) return S;
  for (const k of Object.keys(partial)) {
    if (partial[k] && typeof partial[k] === 'object' && !Array.isArray(partial[k])) S[k] = Object.assign({}, S[k], partial[k]);
    else if (partial[k] !== undefined) S[k] = Array.isArray(partial[k]) ? partial[k].slice() : partial[k];
  }
  return S;
}

/* The export-file form of a generated frame (what blender/export_frame.py writes, size_bits 8). */
export function frameFile(S, frame, sizes, extra = {}) {
  const [nx, ny, nz] = S.dims, sp = S.spacing;
  let bin = ''; for (let i = 0; i < sizes.length; i += 0x8000) bin += String.fromCharCode.apply(null, sizes.subarray(i, i + 0x8000));
  return Object.assign({
    format: 'protospace-voxels', version: 2, source: 'ProtoSpace generator', object: 'Plane', frame,
    frame_range: [1, S.loopLength], fps: 24, spacing: sp, cube_metres: 1.0,
    origin: [-(nz - 1) / 2 * sp, -(nx - 1) / 2 * sp, -(ny - 1) / 2 * sp],
    axes: { across: '+Y', up: '+Z', depth: '-X' }, dims: [nx, ny, nz], points: sizes.length,
    size_bits: 8, sizes: btoa(bin), settings: S,
    camera: { name: 'Camera', position: [15.5, 0, 0], right: [0, 1, 0], up: [0, 0, 1], forward: [-1, 0, 0], lens_mm: 50, sensor_mm: 36, sensor_fit: 'AUTO', type: 'PERSP', resolution: [1920, 1080] },
  }, extra);
}

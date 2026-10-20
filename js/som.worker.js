/* ProtoSpace Analyzer — the self-organizing map behind the Explorer tab (js/explorer.js), trained off the main thread.

   A map is W × H nodes. Each node holds a vector: the signed-distance field of a solid (N³ values in [-1, 1]), its
   criteria scores (nC values in [0, 1]) and, last, how solid it is (the share of filled voxels). Averaged distance
   fields of thin, different solids thin out, so the tile's solid is carved from its field down to that learned share. Training shows the map one sample at a time — one of the uploaded
   designs, or a synthetic in-between (two designs blended at a random mix, and, if asked, mirrored or turned); the
   closest node and its neighbours move toward it, the neighbourhood shrinking as training goes on. The result: every
   design has a home tile, neighbouring tiles blend smoothly between them, and the tiles in between are new designs.

   in   { cmd: 'train', N, nC, W, H, designs: [{ sdf, crit }], iters, mode, synth, symmetry, influence, seed }
        { cmd: 'stop' }
   out  { type: 'progress', it, iters }
        { type: 'done' | 'progress-map', it, weights (Float32Array W·H·D), bmu (per design), nearest, nearDist (per node) } */
let stop = false;
self.onmessage = e => {
  const m = e.data;
  if (m.cmd === 'stop') { stop = true; return; }
  if (m.cmd === 'train') { stop = false; train(m); }
};

function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

function mirrorX(a, N) { const b = new Float32Array(a.length); for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) b[x + N * (y + N * z)] = a[(N - 1 - x) + N * (y + N * z)]; return b; }
function mirrorZ(a, N) { const b = new Float32Array(a.length); for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) b[x + N * (y + N * z)] = a[x + N * (y + N * (N - 1 - z))]; return b; }
function rotateY(a, N) { const b = new Float32Array(a.length); for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) b[x + N * (y + N * z)] = a[z + N * (y + N * (N - 1 - x))]; return b; }

function train(m) {
  const { N, nC, W, H, iters, mode, synth, symmetry, influence } = m;
  const V = N * N * N, D = V + nC + 1, K = W * H, rand = rng(m.seed || 7);
  // the sample pool: designs, plus their symmetry variants when asked
  const pool = [];
  for (const d of m.designs) {
    const crit = Float32Array.from(d.crit); let f = 0; for (let i = 0; i < V; i++) if (d.sdf[i] < 0) f++; const fill = f / V;
    pool.push({ sdf: d.sdf, crit, fill, own: true });
    if (symmetry) { pool.push({ sdf: mirrorX(d.sdf, N), crit, fill }); pool.push({ sdf: mirrorZ(d.sdf, N), crit, fill }); pool.push({ sdf: rotateY(d.sdf, N), crit, fill }); }
  }
  const nOwn = m.designs.length;
  // weights: start from random blends of the designs, so the map is plausible from the first frame
  const Wt = new Float32Array(K * D);
  const tmp = new Float32Array(D);
  const blendInto = (out, a, b, t) => { for (let i = 0; i < V; i++) out[i] = a.sdf[i] * (1 - t) + b.sdf[i] * t; for (let c = 0; c < nC; c++) out[V + c] = a.crit[c] * (1 - t) + b.crit[c] * t; out[V + nC] = a.fill * (1 - t) + b.fill * t; };
  for (let k = 0; k < K; k++) {
    const a = pool[Math.floor(rand() * pool.length)], b = pool[Math.floor(rand() * pool.length)];
    blendInto(tmp, a, b, rand()); Wt.set(tmp, k * D);
  }
  // training schedule
  const span = Math.max(W, H);
  const sigma0 = mode === 'cluster' ? Math.max(0.8, span * 0.3) : Math.max(1, span * 0.6), sigma1 = mode === 'cluster' ? 0.45 : 0.55;
  const lr0 = 0.6, lr1 = mode === 'cluster' ? 0.02 : 0.04;
  const wv = (1 - influence) / V, wc = nC ? influence / nC : 0;                 // the two halves of the distance
  const dist = (k, s) => {
    const o = k * D; let dv = 0, dc = 0;
    for (let i = 0; i < V; i++) { const d = Wt[o + i] - s.sdf[i]; dv += d * d; }
    for (let c = 0; c < nC; c++) { const d = Wt[o + V + c] - s.crit[c]; dc += d * d; }
    return wv * dv + wc * dc;
  };
  const bmuOf = s => { let best = 0, bd = Infinity; for (let k = 0; k < K; k++) { const d = dist(k, s); if (d < bd) { bd = d; best = k; } } return [best, bd]; };
  const pSynth = synth / (synth + pool.length);
  const sample = { sdf: new Float32Array(V), crit: new Float32Array(nC), fill: 0 };
  let last = performance.now();
  for (let it = 0; it < iters; it++) {
    if (stop) break;
    const f = it / Math.max(1, iters - 1);
    const sigma = sigma0 * Math.pow(sigma1 / sigma0, f), lr = lr0 * Math.pow(lr1 / lr0, f);
    let s;
    if (pool.length > 1 && rand() < pSynth) {
      const a = pool[Math.floor(rand() * pool.length)]; let b = pool[Math.floor(rand() * pool.length)];
      if (b === a) b = pool[(pool.indexOf(a) + 1) % pool.length];
      const t = 0.15 + 0.7 * rand();
      for (let i = 0; i < V; i++) sample.sdf[i] = a.sdf[i] * (1 - t) + b.sdf[i] * t;
      for (let c = 0; c < nC; c++) sample.crit[c] = a.crit[c] * (1 - t) + b.crit[c] * t;
      sample.fill = a.fill * (1 - t) + b.fill * t;
      s = sample;
    } else s = pool[Math.floor(rand() * pool.length)];
    const [b] = bmuOf(s), bx = b % W, by = (b / W) | 0, s2 = 2 * sigma * sigma;
    for (let k = 0; k < K; k++) {
      const dx = k % W - bx, dy = ((k / W) | 0) - by, g = Math.exp(-(dx * dx + dy * dy) / s2);
      if (g < 0.01) continue;
      const a = lr * g, o = k * D;
      for (let i = 0; i < V; i++) Wt[o + i] += a * (s.sdf[i] - Wt[o + i]);
      for (let c = 0; c < nC; c++) Wt[o + V + c] += a * (s.crit[c] - Wt[o + V + c]);
      Wt[o + V + nC] += a * (s.fill - Wt[o + V + nC]);
    }
    const now = performance.now();
    if (now - last > 400) { last = now; self.postMessage({ type: 'progress', it: it + 1, iters }); }
  }
  // where every design lives, and how far every node is from the nearest design (its 'explored-ness')
  const bmu = [], bmuD = [];
  for (let i = 0; i < nOwn; i++) { const [k, d] = bmuOf(pool[i * (symmetry ? 4 : 1)]); bmu.push(k); bmuD.push(d); }
  const nearest = new Int32Array(K), nearDist = new Float32Array(K);
  for (let k = 0; k < K; k++) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < nOwn; i++) { const d = dist(k, pool[i * (symmetry ? 4 : 1)]); if (d < bd) { bd = d; best = i; } }
    nearest[k] = best; nearDist[k] = bd;
  }
  self.postMessage({ type: 'done', it: iters, weights: Wt, bmu, bmuD, nearest, nearDist, stopped: stop }, [Wt.buffer, nearest.buffer, nearDist.buffer]);
}

/* ProtoSpace Analyzer — fusing the modules of a building into one surface (js/assemble.js).
   The whole building is one voxel grid: every placed module is stamped into it, then every seam between neighbours
   (along the lot, across it, and between stacked layers) is filled with a morph — the section of one module blends
   into the section of the other across the seam, so where both have mass they join and where only one does it tapers
   toward the other — and the grid is contoured as one continuous surface (naive surface nets, which work on a
   rectangular grid, then Taubin smoothing and smooth normals). Vertex colours carry which module each part came from,
   so the morphs show as one colour grading into the next. */
import * as THREE from 'three';

/* Signed distance (chessboard, in voxels) of a 2-D mask: negative inside, −0.5 / +0.5 at the boundary. */
export function signed2d(mask, W, H) {
  const n = W * H, out = new Float32Array(n), dIn = new Int32Array(n).fill(-1), dOut = new Int32Array(n).fill(-1);
  const bfs = (seedIs, dist) => {                                                  // multi-source BFS, 8-connected
    const q = []; for (let i = 0; i < n; i++) if (seedIs(i)) { dist[i] = 0; q.push(i); }
    let h = 0;
    while (h < q.length) { const i = q[h++], x = i % W, y = (i / W) | 0, d = dist[i] + 1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const j = X + W * Y; if (dist[j] < 0) { dist[j] = d; q.push(j); } } }
  };
  let any = 0; for (let i = 0; i < n; i++) any += mask[i];
  if (!any) { out.fill(1e3); return out; }
  bfs(i => mask[i] === 1, dIn); bfs(i => mask[i] === 0, dOut);
  for (let i = 0; i < n; i++) out[i] = mask[i] ? -((dOut[i] < 0 ? 1e3 : dOut[i]) - 0.5) : ((dIn[i] < 0 ? 1e3 : dIn[i]) - 0.5);
  return out;
}

/* Naive surface nets on a 0/1 grid (x fastest): one vertex per cell with a sign change, placed at the mean of the
   crossing points of its edges; one quad across every sign-changing voxel edge. Returns positions (in voxel-centre
   units: i means the centre of voxel i), an index, and per-vertex labels (the label of an inside corner). */
export function surfaceNets(occ, lab, GX, GY, GZ) {
  const SX = 1, SY = GX, SZ = GX * GY, vIndex = new Int32Array(GX * GY * GZ).fill(-1);
  const C = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const COFF = C.map(c => c[0] * SX + c[1] * SY + c[2] * SZ);
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const EMID = EDGES.map(([a, b]) => [(C[a][0] + C[b][0]) / 2, (C[a][1] + C[b][1]) / 2, (C[a][2] + C[b][2]) / 2]);
  const pos = [], vlab = [], tris = [];
  for (let z = 0; z < GZ - 1; z++) for (let y = 0; y < GY - 1; y++) {
    let i = SY * y + SZ * z;
    for (let x = 0; x < GX - 1; x++, i++) {
      let mask = 0, inside = -1;
      for (let c = 0; c < 8; c++) if (occ[i + COFF[c]]) { mask |= 1 << c; if (inside < 0) inside = c; }
      if (mask === 0 || mask === 255) continue;
      let sx = 0, sy = 0, sz = 0, cnt = 0;
      for (let e = 0; e < 12; e++) { const [a, b] = EDGES[e]; if (((mask >> a) & 1) === ((mask >> b) & 1)) continue; const m = EMID[e]; sx += m[0]; sy += m[1]; sz += m[2]; cnt++; }
      vIndex[i] = pos.length / 3; pos.push(x + sx / cnt, y + sy / cnt, z + sz / cnt);
      vlab.push(lab[i + COFF[inside]]);
    }
  }
  // faces: for each cell with a vertex, the three edges from its first corner; a quad across each that changes sign
  const S = [SX, SY, SZ];
  for (let z = 1; z < GZ - 1; z++) for (let y = 1; y < GY - 1; y++) {
    let i = SX + SY * y + SZ * z;
    for (let x = 1; x < GX - 1; x++, i++) {
      const v0 = vIndex[i]; if (v0 < 0) continue;
      const o0 = occ[i];
      for (let d = 0; d < 3; d++) {
        if (occ[i + S[d]] === o0) continue;
        const a = (d + 1) % 3, b = (d + 2) % 3;
        const v1 = vIndex[i - S[a]], v2 = vIndex[i - S[a] - S[b]], v3 = vIndex[i - S[b]]; if (v1 < 0 || v2 < 0 || v3 < 0) continue;
        if (o0) tris.push(v0, v1, v2, v0, v2, v3); else tris.push(v0, v3, v2, v0, v2, v1);
      }
    }
  }
  return { pos: new Float32Array(pos), index: new Uint32Array(tris), lab: vlab };
}

/* Taubin smoothing in place (λ = 0.5, μ = −0.53): rounds the stair-steps and bevels without shrinking. */
export function taubin(p, index, iters = 12) {
  const V = p.length / 3, deg = new Int32Array(V + 1);
  for (let t = 0; t < index.length; t++) deg[index[t] + 1] += 2;
  for (let v = 0; v < V; v++) deg[v + 1] += deg[v];                                // CSR offsets
  const adj = new Int32Array(deg[V]), fill = deg.slice(0, V);
  for (let t = 0; t < index.length; t += 3) { const a = index[t], b = index[t + 1], c = index[t + 2]; adj[fill[a]++] = b; adj[fill[a]++] = c; adj[fill[b]++] = a; adj[fill[b]++] = c; adj[fill[c]++] = a; adj[fill[c]++] = b; }
  const q = new Float32Array(V * 3);
  const step = lam => {
    for (let v = 0; v < V; v++) {
      const s0 = deg[v], s1 = deg[v + 1], k = s1 - s0, o = v * 3;
      if (!k) { q[o] = p[o]; q[o + 1] = p[o + 1]; q[o + 2] = p[o + 2]; continue; }
      let sx = 0, sy = 0, sz = 0; for (let j = s0; j < s1; j++) { const u = adj[j] * 3; sx += p[u]; sy += p[u + 1]; sz += p[u + 2]; }
      q[o] = p[o] + lam * (sx / k - p[o]); q[o + 1] = p[o + 1] + lam * (sy / k - p[o + 1]); q[o + 2] = p[o + 2] + lam * (sz / k - p[o + 2]);
    }
    p.set(q);
  };
  for (let it = 0; it < iters; it++) { step(0.5); step(-0.53); }
}

/* The fused building: occ/lab grid → an indexed, coloured, smoothed BufferGeometry in grid units. */
export function fusedGeometry(occ, lab, GX, GY, GZ, colorOf, iters = 12) {
  const { pos, index, lab: vlab } = surfaceNets(occ, lab, GX, GY, GZ);
  taubin(pos, index, iters);
  const col = new Float32Array(pos.length), tmp = new THREE.Color();
  for (let v = 0; v < vlab.length; v++) { tmp.set(colorOf(vlab[v])); col[v * 3] = tmp.r; col[v * 3 + 1] = tmp.g; col[v * 3 + 2] = tmp.b; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeVertexNormals();
  return g;
}

/* A morph across a seam. `axis` is the seam's direction (0 x, 1 y, 2 z); the two masses end at a0 (A's last slice)
   and begin at b0 (B's first slice); the profile plane is the other two axes over [p0, p1) × [q0, q1). Fills the
   slices strictly between a0 and b0 wherever the interpolated signed distance of the two face sections is below
   `bias` (0 = the exact morph; a little above fattens the join), labelling each voxel A or B by which side it is
   nearer to. Returns true if any (p, q) runs straight through (both sections have mass there). */
export function morphSeam(occ, lab, GX, GY, GZ, axis, a0, b0, labA, labB, p0, p1, q0, q1, depth = 3, bias = 0) {
  if (b0 - a0 < 2) return false;
  const ST = [1, GX, GX * GY], ax = [0, 1, 2].filter(d => d !== axis), [pa, qa] = ax, W = p1 - p0, H = q1 - q0;
  const sAx = ST[axis], sP = ST[pa], sQ = ST[qa];
  const maskA = new Uint8Array(W * H), maskB = new Uint8Array(W * H);
  for (let q = q0; q < q1; q++) for (let p = p0; p < p1; p++) {
    const base = p * sP + q * sQ, i = (p - p0) + W * (q - q0);
    for (let s = 0; s < depth; s++) { const c = a0 - s; if (c >= 0 && lab[base + c * sAx] === labA) { maskA[i] = 1; break; } }
    for (let s = 0; s < depth; s++) { const c = b0 + s; if (lab[base + c * sAx] === labB) { maskB[i] = 1; break; } }
  }
  const sA = signed2d(maskA, W, H), sB = signed2d(maskB, W, H);
  let through = false;
  for (let q = q0; q < q1; q++) for (let p = p0; p < p1; p++) {
    const i = (p - p0) + W * (q - q0); if (maskA[i] && maskB[i]) through = true;
    const base = p * sP + q * sQ;
    for (let s = a0 + 1; s < b0; s++) {
      const t = (s - a0) / (b0 - a0), v = (1 - t) * sA[i] + t * sB[i];
      if (v < bias) { const j = base + s * sAx; if (!occ[j]) { occ[j] = 1; lab[j] = t < 0.5 ? labA : labB; } }
    }
  }
  return through;
}

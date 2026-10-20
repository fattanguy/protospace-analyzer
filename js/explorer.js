/* ProtoSpace Analyzer — Explorer: a design space map.
   Drop closed solids (OBJ, STL, GLB, GLTF — SubD exports, massing studies, printed bays) or add the bays of the frame on
   screen; each becomes an N³ voxel solid with scores on criteria you name. A self-organizing map (js/som.worker.js)
   lays them out on a W × H grid: every design gets a home tile, and every other tile is a blend of its neighbours —
   a new in-between design you can open in 3D, export, compare, trace a path through, or steer toward target scores.
   mount(root, hooks) → { show }    hooks.frameBays() → [{ name, vox, box }] | null, hooks.rate(vox) → { word: 0–100 } */
import * as THREE from 'three';
import { createViewer } from './viewer.js';
import { ACCEPTS, loadModel, loadModelUrl, voxelize, signedDistance, occupancyOf, toVox } from './voxelize.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const HUES = [4, 36, 56, 96, 152, 190, 214, 262, 300, 330];
const colorOf = i => `hsl(${HUES[i % HUES.length]} 62% ${i < HUES.length ? 56 : 42}%)`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const E = {
  N: 32, W: 5, H: 5, mode: 'explore', iters: 1600, synth: 60, symmetry: false, influence: 0.3, seed: 7,
  designs: [], criteria: [], map: null, tool: 'inspect', overlay: 'none', sel: null, pins: [], path: { a: null, b: null, cells: null },
  targets: [], worker: null, busy: false, thumbs: null, viewer: null, hooks: {},
};

// ------------------------------------------------------------------ thumbnails: one hidden renderer draws every tile
function makeThumbs() {
  const S = 216, renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(S, S); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight(0xffffff, 0x3a3a3a, 1.0); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.08; scene.add(sun); scene.add(sun.target);
  const fill = new THREE.DirectionalLight(0xffffff, 0.4); fill.position.set(60, 20, -40); scene.add(fill);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 2000);
  const mat = new THREE.MeshStandardMaterial({ color: 0xf2efe9, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  const dark = () => { const t = document.documentElement.dataset.theme; return t === 'dark' || (t !== 'light' && !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches)); };
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 1 });
  let mesh = null, base = null;
  function geometryOf(occ, N) {                                                   // the solid's outer faces, one quad each
    const at = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < N && y < N && z < N && occ[x + N * (y + N * z)];
    const pos = [], nor = [], idx = []; let n = 0;
    const quad = (a, b, c, d, nx, ny, nz) => { for (const p of [a, b, c, d]) { pos.push(p[0], p[1], -p[2]); nor.push(nx, ny, nz); } idx.push(n, n + 1, n + 2, n, n + 2, n + 3); n += 4; };
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (!occ[x + N * (y + N * z)]) continue;
      const x0 = x, x1 = x + 1, y0 = y, y1 = y + 1, z0 = z, z1 = z + 1;
      if (!at(x, y, z - 1)) quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], 0, 0, 1);
      if (!at(x, y, z + 1)) quad([x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1], 0, 0, -1);
      if (!at(x + 1, y, z)) quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], 1, 0, 0);
      if (!at(x - 1, y, z)) quad([x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1], -1, 0, 0);
      if (!at(x, y + 1, z)) quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], 0, 1, 0);
      if (!at(x, y - 1, z)) quad([x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0], 0, -1, 0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx);
    return g;
  }
  function render(occ, N) {
    if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); } if (base) scene.remove(base);
    mesh = new THREE.Mesh(geometryOf(occ, N), mat); mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh);
    base = new THREE.Mesh(new THREE.BoxGeometry(N + 4, 0.5, N + 4), baseMat); base.position.set(N / 2, 0.75, -N / 2); base.receiveShadow = true; scene.add(base);
    const ctr = new THREE.Vector3(N / 2, N * 0.38, -N / 2), dir = new THREE.Vector3(-0.95, 0.72, 1.25).normalize();
    camera.position.copy(ctr).addScaledVector(dir, N * 2.55); camera.lookAt(ctr); camera.updateProjectionMatrix();
    sun.position.copy(ctr).add(new THREE.Vector3(-0.55, 1, 0.75).multiplyScalar(N * 1.6)); sun.target.position.copy(ctr);
    const sc = sun.shadow.camera; sc.left = sc.bottom = -N; sc.right = sc.top = N; sc.near = 1; sc.far = N * 5; sc.updateProjectionMatrix();
    baseMat.color.set(dark() ? 0x1c1c1c : 0xe6e1db); hemi.groundColor.set(dark() ? 0x3a3a3a : 0xb5aea6);
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  }
  return { render };
}

// ------------------------------------------------------------------ designs
function addDesign(name, occ, N, extra = {}) {
  const sdf = signedDistance(occ, N);
  const d = { id: Math.random().toString(36).slice(2, 8), name, occ, N, sdf, crit: E.criteria.map(() => 0.5), ...extra };
  d.letter = LETTERS[E.designs.length % LETTERS.length]; d.color = colorOf(E.designs.length);
  E.designs.push(d);
  if (E.hooks.rate && E.criteria.length) autoRate(d);
  return d;
}
/* A piece of the slab (a bay, a crop box, a whole frame) as a design: the solid cubes re-sampled into the N cube. */
function occFromVox(vox, box, N) {
  const b = box || { x0: 0, x1: vox.nx, y0: 0, y1: vox.ny, z0: 0, z1: vox.nz };
  const sx = b.x1 - b.x0, sy = b.y1 - b.y0, sz = b.z1 - b.z0, big = Math.max(sx, sy, sz), s = (N - 2) / big;
  const ox = 1 + ((N - 2) - sx * s) / 2, oz = 1 + ((N - 2) - sz * s) / 2, occ = new Uint8Array(N * N * N);
  let filled = 0;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const vx = Math.floor((x + 0.5 - ox) / s), vy = Math.floor((y + 0.5 - 1) / s), vz = Math.floor((z + 0.5 - oz) / s);
    if (vx < 0 || vy < 0 || vz < 0 || vx >= sx || vy >= sy || vz >= sz) continue;
    if (vox.sizes[(b.x0 + vx) + vox.nx * ((b.y0 + vy) + vox.ny * (b.z0 + vz))] >= vox.threshold) { occ[x + N * (y + N * z)] = 1; filled++; }
  }
  return { occ, filled };
}
function designFromVox(name, vox, box) {
  const { occ, filled } = occFromVox(vox, box, E.N);
  return addDesign(name, occ, E.N, { filled, source: 'frame', vox, box });
}
function autoRate(d) {
  const r = E.hooks.rate(toVox(d.occ, E.N)); if (!r) return;
  E.criteria.forEach((c, i) => { if (r[c] != null) d.crit[i] = clamp(r[c] / 100, 0, 1); });
}
function removeDesign(id) { E.designs = E.designs.filter(d => d.id !== id); E.designs.forEach((d, i) => { d.letter = LETTERS[i % LETTERS.length]; d.color = colorOf(i); }); E.map = null; renderAll(); }

// ------------------------------------------------------------------ the map
function train() {
  if (E.busy || E.designs.length < 2) return;
  const N = E.N, V = N * N * N, K = E.W * E.H;
  E.busy = true; E.map = null; E.sel = null; E.pins = []; E.path = { a: null, b: null, cells: null };
  setRun(`Training · 0 / ${E.iters}`, 0);
  const w = E.worker = new Worker('js/som.worker.js', { type: 'module' });
  w.onmessage = e => {
    const m = e.data;
    if (m.type === 'progress') { setRun(`Training · ${m.it} / ${m.iters}`, m.it / m.iters); return; }
    if (m.type === 'done') {
      const nodes = [];
      for (let k = 0; k < K; k++) {
        const D = V + E.criteria.length + 1, o = k * D, sdf = m.weights.subarray(o, o + V), crit = Array.from(m.weights.subarray(o + V, o + V + E.criteria.length)), fill = m.weights[o + V + E.criteria.length];
        const occ = occupancyOf(sdf, fill); let filled = 0; for (let i = 0; i < occ.length; i++) filled += occ[i];
        nodes.push({ k, x: k % E.W, y: (k / E.W) | 0, sdf, occ, crit, filled, nearest: m.nearest[k], nearDist: m.nearDist[k], thumb: null });
      }
      E.map = { nodes, weights: m.weights, bmu: m.bmu, bmuD: m.bmuD, W: E.W, H: E.H, N, criteria: E.criteria.slice(), umax: 0, nearMax: Math.max(1e-9, ...nodes.map(n => n.nearDist)) };
      E.map.u = umatrix(E.map);
      E.busy = false; w.terminate(); E.worker = null;
      setRun(m.stopped ? `Stopped at ${m.it} iterations` : `Done · ${E.iters} iterations · ${E.W}×${E.H} tiles`, 1);
      renderMap(); E.sel = E.map.bmu[0] ?? 0; renderDetail();
    }
  };
  w.onerror = err => { E.busy = false; setRun('The map could not be trained: ' + (err.message || 'worker error'), 0); };
  const designs = E.designs.map(d => ({ sdf: d.sdf, crit: d.crit }));
  w.postMessage({ cmd: 'train', N, nC: E.criteria.length, W: E.W, H: E.H, designs, iters: E.iters, mode: E.mode, synth: E.synth, symmetry: E.symmetry, influence: E.influence, seed: E.seed });
  renderMap();
}
function stopTraining() { if (E.worker) E.worker.postMessage({ cmd: 'stop' }); }
function nodeDist(a, b) {                                                        // the same distance the worker trains with
  const V = a.sdf.length, nC = a.crit.length, wv = (1 - E.influence) / V, wc = nC ? E.influence / nC : 0;
  let dv = 0, dc = 0;
  for (let i = 0; i < V; i++) { const d = a.sdf[i] - b.sdf[i]; dv += d * d; }
  for (let c = 0; c < nC; c++) { const d = a.crit[c] - b.crit[c]; dc += d * d; }
  return Math.sqrt(wv * dv + wc * dc);
}
function umatrix(map) {                                                          // how different each tile is from its neighbours
  const { W, H, nodes } = map, u = new Float32Array(W * H); let mx = 0;
  for (const n of nodes) {
    let s = 0, c = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = n.x + dx, y = n.y + dy; if (x < 0 || y < 0 || x >= W || y >= H) continue; s += nodeDist(n, nodes[y * W + x]); c++; }
    u[n.k] = c ? s / c : 0; mx = Math.max(mx, u[n.k]);
  }
  map.umax = mx || 1; return u;
}
function matchScore(node) {                                                      // 1 = the tile's criteria equal the targets
  if (!E.criteria.length) return 1;
  let s = 0; for (let c = 0; c < E.criteria.length; c++) { const d = node.crit[c] - (E.targets[c] ?? 0.5); s += d * d; }
  return 1 - Math.sqrt(s / E.criteria.length);
}
function shortestPath(a, b) {                                                    // Dijkstra on the grid, cost = how much the design changes
  const { W, H, nodes } = E.map, K = W * H, dist = new Float64Array(K).fill(Infinity), prev = new Int32Array(K).fill(-1), done = new Uint8Array(K);
  dist[a] = 0;
  for (;;) {
    let k = -1, best = Infinity; for (let i = 0; i < K; i++) if (!done[i] && dist[i] < best) { best = dist[i]; k = i; }
    if (k < 0 || k === b) break; done[k] = 1;
    const n = nodes[k];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = n.x + dx, y = n.y + dy; if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const j = y * W + x, d = dist[k] + nodeDist(n, nodes[j]); if (d < dist[j]) { dist[j] = d; prev[j] = k; }
    }
  }
  const cells = []; for (let k = b; k >= 0; k = prev[k]) { cells.unshift(k); if (k === a) break; }
  return cells[0] === a ? cells : null;
}

// ------------------------------------------------------------------ rendering
let R = {};                                                                      // the elements
function setRun(text, frac) { R.run.textContent = text; R.bar.style.width = `${Math.round(frac * 100)}%`; R.start.disabled = E.busy || E.designs.length < 2; R.stop.hidden = !E.busy; R.start.hidden = E.busy; }
function renderDesigns() {
  R.designs.innerHTML = E.designs.map(d => `<div class="xp-design" data-id="${d.id}">
      <span class="xp-letter" style="--c:${d.color}">${d.letter}</span>
      <span class="xp-name" title="${esc(d.note ? d.name + ' · ' + d.note : d.name)}">${esc(d.name)}</span>
      <span class="xp-fill num">${(d.filled / (E.N ** 3) * 100).toFixed(0)}%</span>
      <button type="button" class="xp-x" data-remove="${d.id}" aria-label="Remove ${esc(d.name)}">×</button>
      ${E.criteria.length ? `<div class="xp-scores">${E.criteria.map((c, i) => `<label><span>${esc(c)}</span><input type="range" min="0" max="1" step="0.01" value="${d.crit[i]}" data-score="${d.id}:${i}"><output class="num">${d.crit[i].toFixed(2)}</output></label>`).join('')}</div>` : ''}
    </div>`).join('') || '<p class="hint">No designs yet. Drop closed solids above, or add the bays of the frame on screen.</p>';
  R.count.textContent = E.designs.length ? `${E.designs.length} design${E.designs.length > 1 ? 's' : ''} · ${E.N}³ voxels` : '';
  R.start.disabled = E.busy || E.designs.length < 2;
  R.startHint.textContent = E.designs.length < 2 ? 'Two or more designs make a map.' : '';
}
function renderCriteria() {
  R.criteria.innerHTML = E.criteria.map((c, i) => `<div class="xp-crit"><input type="text" value="${esc(c)}" data-crit="${i}" maxlength="24" aria-label="Criterion ${i + 1}"><button type="button" class="xp-x" data-critx="${i}" aria-label="Remove criterion">×</button></div>`).join('');
  R.rate.hidden = !(E.hooks.rate && E.criteria.some(c => E.hooks.words.includes(c)) && E.designs.length);
  renderTargets();
}
function renderTargets() {
  const el = R.targets;
  if (!E.criteria.length) { el.innerHTML = '<span class="hint">Add criteria in Controls to steer the map by scores.</span>'; return; }
  el.innerHTML = `<span class="lbl">Targets</span>` + E.criteria.map((c, i) => `<label title="${esc(c)}"><span>${esc(c)}</span><input type="range" min="0" max="1" step="0.01" value="${E.targets[i] ?? 0.5}" data-target="${i}"><output class="num">${(E.targets[i] ?? 0.5).toFixed(2)}</output></label>`).join('') + `<span class="hint">Bright tiles are close to these scores.</span>`;
}
function tileStyle(n) {
  const m = E.map;
  if (E.overlay === 'mix' && n.nearest >= 0) { const d = E.designs[n.nearest]; return d ? `--tint:${d.color};--tintA:${(0.12 + 0.5 * Math.max(0, 1 - n.nearDist / m.nearMax)).toFixed(2)}` : ''; }
  if (E.overlay === 'distance') return `--tint:#fff;--tintA:${(0.55 * m.u[n.k] / m.umax).toFixed(2)}`;
  if (E.overlay === 'match') return `--dim:${(1 - Math.pow(Math.max(0, matchScore(n)), 2)).toFixed(2)}`;
  return '';
}
function renderMap() {
  const m = E.map, grid = R.grid;
  grid.style.setProperty('--w', E.W); grid.style.setProperty('--h', E.H);
  R.size.textContent = `${E.W}×${E.H}`;
  if (!m) {
    grid.innerHTML = Array.from({ length: E.W * E.H }, (_, k) => `<div class="xp-tile empty"${E.busy ? ' data-busy' : ''}></div>`).join('');
    R.mapHint.textContent = E.designs.length < 2 ? 'Add two or more designs in Controls, then Start.' : E.busy ? 'Training…' : 'Press Start to lay the designs out.';
    return;
  }
  R.mapHint.textContent = { inspect: 'Click a tile to open it below.', compare: 'Click tiles to pin them (up to three) and compare them side by side.', path: 'Click two tiles to trace the smoothest design transition between them.', navigate: 'Drag a target: tiles close to it stay bright, tiles that miss it go dark.' }[E.tool];
  const home = new Map(); m.bmu.forEach((k, i) => { (home.get(k) || home.set(k, []).get(k)).push(E.designs[i]); });
  const pathSet = new Map(); if (E.path.cells) E.path.cells.forEach((k, i) => pathSet.set(k, i + 1));
  let best = -1; if (E.tool === 'navigate' && E.criteria.length) { let bs = -Infinity; m.nodes.forEach(n => { const s = matchScore(n); if (s > bs) { bs = s; best = n.k; } }); }
  grid.innerHTML = m.nodes.map(n => {
    const owners = home.get(n.k), pin = E.pins.indexOf(n.k), onPath = pathSet.get(n.k);
    const cls = ['xp-tile', n.k === E.sel ? 'on' : '', pin >= 0 ? 'pinned' : '', onPath ? 'path' : '', n.k === E.path.a ? 'pa' : '', n.k === E.path.b ? 'pb' : '', n.k === best ? 'best' : '', E.overlay].filter(Boolean).join(' ');
    return `<button type="button" class="${cls}" data-k="${n.k}" style="${tileStyle(n)}" aria-label="Tile ${n.x}, ${n.y}">
      ${n.thumb ? `<img src="${n.thumb}" alt="">` : ''}
      <span class="xp-badge">${owners ? owners.map(d => `<b style="--c:${d.color}">${d.letter}</b>`).join('') : '<i></i>'}</span>
      ${pin >= 0 ? `<span class="xp-pin">${pin + 1}</span>` : ''}${onPath ? `<span class="xp-step">${onPath}</span>` : ''}
    </button>`;
  }).join('');
  renderThumbs();
}
function renderThumbs() {                                                        // a few tiles per frame, so the page stays alive
  const m = E.map; if (!m) return;
  if (!E.thumbs) E.thumbs = makeThumbs();
  const todo = m.nodes.filter(n => !n.thumb);
  const step = () => {
    if (E.map !== m) return;
    const t0 = performance.now();
    while (todo.length && performance.now() - t0 < 24) {
      const n = todo.shift(); n.thumb = E.thumbs.render(n.occ, m.N);
      const el = R.grid.querySelector(`[data-k="${n.k}"]`); if (el && !el.querySelector('img')) el.insertAdjacentHTML('afterbegin', `<img src="${n.thumb}" alt="">`);
    }
    if (todo.length) requestAnimationFrame(step); else renderStrip();
  };
  requestAnimationFrame(step);
}
function nodeName(n) {
  const m = E.map, owners = m.bmu.map((k, i) => k === n.k ? E.designs[i] : null).filter(Boolean);
  return owners.length ? owners.map(d => d.name).join(' + ') : 'Generated blend';
}
function critBars(crit, compare) {
  return E.criteria.map((c, i) => `<div class="xp-bar"><span>${esc(c)}</span><span class="track"><span class="bar" style="width:${Math.round(crit[i] * 100)}%"></span>${compare ? `<span class="mark" style="left:${Math.round((E.targets[i] ?? 0.5) * 100)}%"></span>` : ''}</span><span class="num">${crit[i].toFixed(2)}</span></div>`).join('');
}
function renderDetail() {
  const m = E.map, n = m && m.nodes[E.sel];
  R.detail.hidden = !n;
  if (!n) { if (E.viewer) E.viewer.setSource(null); return; }
  const near = E.designs[n.nearest], owners = m.bmu.map((k, i) => k === n.k ? E.designs[i] : null).filter(Boolean);
  R.detailHead.innerHTML = `<span class="xp-letter" style="--c:${near ? near.color : 'var(--ink3)'}">${owners.length ? owners[0].letter : '·'}</span><b>Tile (${n.x}, ${n.y})</b><span class="hint">${esc(nodeName(n))}${near && !owners.length ? ` · closest to ${esc(near.name)}` : ''} · ${(n.filled / m.N ** 3 * 100).toFixed(0)}% solid</span>`;
  R.detailCrit.innerHTML = E.criteria.length ? critBars(n.crit, E.tool === 'navigate') : '<p class="hint">No criteria yet.</p>';
  R.pin.textContent = E.pins.includes(n.k) ? 'Unpin' : 'Pin';
  if (!E.viewer) E.viewer = createViewer(R.viewer, { panel: 'none', overlay: true, sections: [], boxDrag: false, showBox: false, view: 'iso', color: 'foam', style: 'blocks', ratio: 0.72, emptyText: 'Pick a tile.' });
  E.viewer.setSource({ name: `explorer tile ${n.x}-${n.y}`, vox: toVox(n.occ, m.N) }, null);
}
function renderStrip() {                                                         // Compare and Path: the pinned tiles or the path, side by side
  const m = E.map, el = R.strip; if (!m) { el.hidden = true; return; }
  let ks = E.tool === 'compare' ? E.pins : E.tool === 'path' ? (E.path.cells || []) : [];
  el.hidden = !ks.length;
  if (!ks.length) return;
  el.innerHTML = ks.map((k, i) => { const n = m.nodes[k]; return `<button type="button" class="xp-card${k === E.sel ? ' on' : ''}" data-k="${k}">
      <img src="${n.thumb || ''}" alt=""><div class="t"><em>${E.tool === 'path' ? i + 1 : ''}</em> Tile (${n.x}, ${n.y})</div><div class="hint">${esc(nodeName(n))}</div>${E.criteria.length ? critBars(n.crit) : ''}</button>`; }).join('');
  if (E.tool === 'path' && E.path.cells) R.pathNote.textContent = `${E.path.cells.length} tiles · the design changes as little as possible from one step to the next.`;
}
function renderTools() {
  $$('[data-tool]', R.root).forEach(b => b.classList.toggle('on', b.dataset.tool === E.tool));
  R.navigate.hidden = E.tool !== 'navigate'; R.pathBar.hidden = E.tool !== 'path'; R.targets.hidden = E.tool === 'inspect';
  if (E.tool === 'navigate') { E.overlay = 'match'; R.overlay.value = 'match'; renderLeast(); }
  R.pathNote.textContent = E.path.a == null ? 'Start: click a tile.' : E.path.b == null ? `Start: tile (${E.map.nodes[E.path.a].x}, ${E.map.nodes[E.path.a].y}) · End: click a tile.` : '';
  renderMap(); renderStrip(); renderDetail();
}
function renderLeast() {
  const m = E.map; if (!m) { R.least.textContent = ''; return; }
  let k = 0; m.nodes.forEach(n => { if (n.nearDist > m.nodes[k].nearDist) k = n.k; });
  const n = m.nodes[k];
  R.least.innerHTML = `<span class="xp-dot"></span> Least explored: tile <button type="button" class="xp-link" data-k="${k}">(${n.x}, ${n.y})</button> is furthest from every uploaded design — a new design like it would widen the map the most.`;
}
function renderAll() { renderDesigns(); renderCriteria(); renderMap(); renderStrip(); renderDetail(); }

// ------------------------------------------------------------------ files
async function addFiles(files) {
  const list = [...files].filter(f => ACCEPTS.includes((f.name.split('.').pop() || '').toLowerCase()));
  if (!list.length) { R.dropMsg.textContent = 'Only OBJ, STL, GLB and GLTF files can be read.'; return; }
  for (const f of list) {
    R.dropMsg.textContent = `Reading ${f.name}…`;
    try {
      const tris = await loadModel(f), v = voxelize(tris, E.N);
      if (!v.filled) throw new Error(`"${f.name}" came out empty — it has to be a closed solid (no open edges).`);
      addDesign(f.name.replace(/\.[^.]+$/, ''), v.occ, E.N, { filled: v.filled, triangles: v.triangles, source: 'file', tris });
      R.dropMsg.textContent = `${f.name}: ${v.triangles.toLocaleString()} triangles → ${v.filled.toLocaleString()} voxels.`;
    } catch (err) { R.dropMsg.textContent = err.message || String(err); }
    E.map = null; renderAll();
  }
}
function reVoxelize(N) {                                                         // resolution changed: every design's solid is re-sampled into the new cube
  E.map = null;
  for (const d of E.designs) {
    const v = d.tris ? voxelize(d.tris, N) : occFromVox(d.vox, d.box, N);
    d.occ = v.occ; d.filled = v.filled; d.N = N; d.sdf = signedDistance(v.occ, N);
  }
  E.N = N; renderAll();
}

// ------------------------------------------------------------------ mount
const HTML = `
<div class="xp">
  <aside class="xp-controls" aria-label="Controls">
    <h2 class="eyebrow">Designs</h2>
    <label class="xp-drop" data-v="drop"><input type="file" multiple accept=".obj,.stl,.glb,.gltf" hidden><b>Drop closed solids</b><span>OBJ · STL · GLB · GLTF → <output data-v="N">32</output>³ voxels</span><span class="hint" data-v="dropMsg"></span></label>
    <div class="xp-row"><button type="button" class="btn quiet" data-v="addSpaces" title="The fifteen lobbies, workspaces and social areas picked from the loops, as the smooth solids they were printed from">Add the fifteen printed spaces</button><button type="button" class="btn quiet" data-v="addBays" title="The five bays of the frame open in Analyze / Program / 3D model, each as a design">Add the bays of the frame on screen</button><span class="hint" data-v="count"></span></div>
    <div data-v="designs" class="xp-designs"></div>

    <div class="xp-sect"><h2 class="eyebrow">Criteria</h2><div class="xp-row"><button type="button" class="btn quiet" data-v="addCrit">Add criterion</button><button type="button" class="btn quiet" data-v="addWords" title="The twelve descriptors of the project as criteria">The twelve descriptors</button></div></div>
    <p class="hint">Names are shared; each design gets its own score per criterion (0–1), set by hand below the design or rated automatically.</p>
    <div data-v="criteria" class="xp-crits"></div>
    <button type="button" class="btn quiet" data-v="rate" hidden title="Reads each design the way the Analyze tab reads a frame, one voxel as one metre, and fills the descriptor scores">Rate the designs on the descriptors</button>

    <div class="xp-sect"><h2 class="eyebrow">Map</h2></div>
    <div class="xp-grid2">
      <label>Width <input type="number" min="2" max="12" step="1" value="5" data-v="W"></label>
      <label>Height <input type="number" min="2" max="12" step="1" value="5" data-v="H"></label>
      <label>Mode <select data-v="mode"><option value="explore">Explore</option><option value="cluster">Cluster</option></select></label>
      <label>Resolution <select data-v="res"><option value="24">24³</option><option value="32" selected>32³</option><option value="40">40³</option><option value="48">48³</option></select></label>
    </div>
    <p class="hint" data-v="modeHint">Explore spreads the designs across the map and keeps their territories apart — coverage, when the designs differ. Cluster lets similar designs share a corner — grouping, when there are many.</p>
    <label class="xp-slider">Iterations · <output data-v="itersOut">1600</output><input type="range" min="200" max="6000" step="100" value="1600" data-v="iters"></label>

    <div class="xp-sect"><h2 class="eyebrow">In-betweens</h2></div>
    <label class="xp-slider">Synthetic designs per 100 samples · <output data-v="synthOut">60</output><input type="range" min="0" max="200" step="10" value="60" data-v="synth"></label>
    <label class="chk"><input type="checkbox" data-v="symmetry"> Symmetry variants (mirrored, turned)</label>
    <p class="hint">With few uploads, blends of two designs at a time fill the map in between. Letters mark your designs' home tiles; the dot marks a generated blend.</p>
    <details class="xp-more"><summary>More settings</summary>
      <label class="xp-slider">Criteria weight in the layout · <output data-v="influenceOut">0.30</output><input type="range" min="0" max="0.9" step="0.05" value="0.3" data-v="influence"></label>
      <p class="hint">0 lays the map out by shape alone; higher values let the scores pull designs together.</p>
      <label class="xp-slider">Seed · <input type="number" min="1" max="9999" value="7" data-v="seed"></label>
    </details>

    <div class="xp-run"><span class="eyebrow">Run</span><span class="hint num" data-v="run">Idle</span></div>
    <div class="xp-track"><span class="xp-progress" data-v="bar"></span></div>
    <button type="button" class="btn xp-start" data-v="start" disabled>Start</button>
    <button type="button" class="btn quiet xp-start" data-v="stop" hidden>Stop</button>
    <p class="hint" data-v="startHint"></p>
  </aside>

  <div class="xp-main">
    <div class="xp-bar"><span class="status" data-v="mapHint"></span><span class="hint num" data-v="size">5×5</span></div>
    <div class="xp-map"><div class="xp-tiles" data-v="grid" role="grid"></div></div>
    <div class="xp-tools">
      <div class="seg" role="group" aria-label="Tool"><button type="button" data-tool="inspect" class="on">Inspect</button><button type="button" data-tool="compare">Compare</button><button type="button" data-tool="path">Path</button><button type="button" data-tool="navigate">Navigate</button></div>
      <label class="xp-overlay">Overlay <select data-v="overlay"><option value="none">None</option><option value="mix">Nearest design</option><option value="distance">Change between tiles</option><option value="match">Criteria match</option></select></label>
    </div>
    <div class="xp-targets" data-v="targets" hidden></div>
    <div class="xp-navigate" data-v="navigate" hidden><p class="hint" data-v="least"></p></div>
    <div class="xp-pathbar" data-v="pathBar" hidden><span class="hint" data-v="pathNote"></span><button type="button" class="btn quiet" data-v="pathClear">Clear path</button></div>
    <div class="xp-strip" data-v="strip" hidden></div>
    <div class="xp-detail" data-v="detail" hidden>
      <div class="xp-detailhead"><div data-v="detailHead" class="xp-title"></div><div class="xp-row"><button type="button" class="btn quiet" data-v="pin">Pin</button><button type="button" class="btn quiet" data-v="obj" title="1 unit = 1 voxel. In Rhino: Map OBJ Y to Rhino Z">OBJ · Rhino</button><button type="button" class="btn quiet" data-v="stl" title="Scale it in the slicer">STL · 3D print</button></div></div>
      <div class="xp-detailbody"><div data-v="viewer"></div><div class="xp-detailcrit" data-v="detailCrit"></div></div>
    </div>
  </div>
</div>`;

export function mount(root, hooks = {}) {
  E.hooks = Object.assign({ words: [] }, hooks);
  root.innerHTML = HTML;
  R = { root };
  $$('[data-v]', root).forEach(el => { R[el.dataset.v] = el; });
  // files
  const drop = R.drop, input = drop.querySelector('input');
  input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => addFiles(e.dataTransfer.files));
  R.addBays.addEventListener('click', () => {
    const bays = E.hooks.frameBays && E.hooks.frameBays();
    if (!bays || !bays.length) { R.dropMsg.textContent = 'Pick an animation and a frame in Analyze, Program or 3D model first.'; return; }
    bays.forEach(b => designFromVox(b.name, b.vox, b.box)); E.map = null; renderAll();
    R.dropMsg.textContent = `${bays.length} bays added from ${bays[0].frame}.`;
  });
  R.addSpaces.addEventListener('click', async () => {
    R.addSpaces.disabled = true;
    try {
      const list = await (await fetch('assets/spaces/index.json')).json();
      for (const it of list) {
        if (E.designs.some(d => d.space === it.id)) continue;
        R.dropMsg.textContent = `Reading ${it.id} ${it.name}…`;
        const tris = await loadModelUrl(it.file), v = voxelize(tris, E.N);
        addDesign(`${it.id} ${it.name}`, v.occ, E.N, { filled: v.filled, triangles: v.triangles, source: 'space', space: it.id, tris, note: `${it.anim} · frame ${it.frame} · bays ${it.bay}–${it.bay + 2} · ${it.rating}` });
        E.map = null; renderDesigns();
      }
      R.dropMsg.textContent = `${list.length} spaces: the fifteen from the boards, smoothed the way they were printed.`;
    } catch (err) { R.dropMsg.textContent = 'The spaces could not be loaded: ' + (err.message || err); }
    R.addSpaces.disabled = false; renderAll();
  });
  R.designs.addEventListener('click', e => { const b = e.target.closest('[data-remove]'); if (b) removeDesign(b.dataset.remove); });
  R.designs.addEventListener('input', e => { const s = e.target.closest('[data-score]'); if (!s) return; const [id, i] = s.dataset.score.split(':'); const d = E.designs.find(d => d.id === id); if (d) { d.crit[+i] = +s.value; s.nextElementSibling.textContent = (+s.value).toFixed(2); E.map = null; } });
  // criteria
  R.addCrit.addEventListener('click', () => { E.criteria.push(`Criterion ${E.criteria.length + 1}`); E.designs.forEach(d => d.crit.push(0.5)); E.targets.push(0.5); E.map = null; renderAll(); });
  R.addWords.addEventListener('click', () => { for (const w of E.hooks.words) if (!E.criteria.includes(w)) { E.criteria.push(w); E.designs.forEach(d => d.crit.push(0.5)); E.targets.push(0.5); } E.designs.forEach(autoRate); E.map = null; renderAll(); });
  R.criteria.addEventListener('input', e => { const t = e.target.closest('[data-crit]'); if (t) { E.criteria[+t.dataset.crit] = t.value; renderTargets(); renderDesigns(); } });
  R.criteria.addEventListener('click', e => { const b = e.target.closest('[data-critx]'); if (!b) return; const i = +b.dataset.critx; E.criteria.splice(i, 1); E.targets.splice(i, 1); E.designs.forEach(d => d.crit.splice(i, 1)); E.map = null; renderAll(); });
  R.rate.addEventListener('click', () => { E.designs.forEach(autoRate); E.map = null; renderAll(); });
  // map settings
  R.W.addEventListener('change', () => { E.W = clamp(+R.W.value || 5, 2, 12); R.W.value = E.W; E.map = null; renderMap(); });
  R.H.addEventListener('change', () => { E.H = clamp(+R.H.value || 5, 2, 12); R.H.value = E.H; E.map = null; renderMap(); });
  R.mode.addEventListener('change', () => { E.mode = R.mode.value; });
  R.res.addEventListener('change', () => { R.N.textContent = R.res.value; reVoxelize(+R.res.value); });
  R.iters.addEventListener('input', () => { E.iters = +R.iters.value; R.itersOut.textContent = E.iters; });
  R.synth.addEventListener('input', () => { E.synth = +R.synth.value; R.synthOut.textContent = E.synth; });
  R.symmetry.addEventListener('change', () => { E.symmetry = R.symmetry.checked; });
  R.influence.addEventListener('input', () => { E.influence = +R.influence.value; R.influenceOut.textContent = E.influence.toFixed(2); if (E.map) { E.map.u = umatrix(E.map); renderMap(); } });
  R.seed.addEventListener('change', () => { E.seed = +R.seed.value || 7; });
  R.start.addEventListener('click', train); R.stop.addEventListener('click', stopTraining);
  // tools
  $$('[data-tool]', root).forEach(b => b.addEventListener('click', () => { E.tool = b.dataset.tool; if (E.tool !== 'navigate' && E.overlay === 'match') { E.overlay = 'none'; R.overlay.value = 'none'; } renderTools(); }));
  R.overlay.addEventListener('change', () => { E.overlay = R.overlay.value; renderMap(); });
  R.targets.addEventListener('input', e => { const t = e.target.closest('[data-target]'); if (!t) return; E.targets[+t.dataset.target] = +t.value; t.nextElementSibling.textContent = (+t.value).toFixed(2); renderMap(); renderDetail(); });
  R.pathClear.addEventListener('click', () => { E.path = { a: null, b: null, cells: null }; renderTools(); });
  R.pin.addEventListener('click', () => togglePin(E.sel));
  R.obj.addEventListener('click', () => E.viewer && E.viewer.exportOBJ(tileName()));
  R.stl.addEventListener('click', () => E.viewer && E.viewer.exportSTL(tileName()));
  root.addEventListener('click', e => {
    const t = e.target.closest('[data-k]'); if (!t || !E.map) return;
    const k = +t.dataset.k;
    if (t.classList.contains('xp-tile')) {
      if (E.tool === 'compare') { togglePin(k); E.sel = k; }
      else if (E.tool === 'path') { if (E.path.a == null || E.path.b != null) E.path = { a: k, b: null, cells: null }; else { E.path.b = k; E.path.cells = shortestPath(E.path.a, k); } E.sel = k; renderTools(); return; }
      else E.sel = k;
    } else E.sel = k;
    renderMap(); renderStrip(); renderDetail();
  });
  R.navigate.hidden = true;
  renderAll();
  return { show() { if (E.viewer) E.viewer.resize(); } };
}
function togglePin(k) { if (k == null) return; const i = E.pins.indexOf(k); if (i >= 0) E.pins.splice(i, 1); else { if (E.pins.length >= 3) E.pins.shift(); E.pins.push(k); } renderMap(); renderStrip(); renderDetail(); }
function tileName() { const n = E.map && E.map.nodes[E.sel]; return n ? `ProtoSpace-explorer-tile-${n.x}-${n.y}-${E.map.N}vox` : 'ProtoSpace-explorer-tile'; }

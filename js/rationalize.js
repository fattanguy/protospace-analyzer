/* ProtoSpace Analyzer — the Rationalize tab: the building laid out on the Assemble board, rebuilt from signed distance
   fields (js/sdf.js) so the modules merge into each other as real, hollow volumes with rooms inside.

   Every module is its own signed distance field; the building is their smooth union, blended pair by pair: one Merge
   value for every pair, and any two modules can be picked (click one, then the other) and given their own. The union is
   made hollow — walls of a chosen thickness — with floor plates every storey inside the walls, and drawn with a shell
   that can be made see-through and cut in plan or in section to look at the rooms the merges make.

   mount(root, { getBuilding }) → { show } ; getBuilding() is the Assemble tab's placements(). */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { moduleField, unionField, detailField, netsField } from './sdf.js';
import { taubin } from './fuse.js';

const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KMAX = 20;                                                                     // the widest blend the sliders allow (m)
const DEF = { k: 3, t: 0.8, view: 'solid', floors: true, H: 4.13, tf: 0.35, res: 2, soft: 1, opacity: 0.35, cutY: 70, cutZ: 0, cutX: 0, overrides: {} };
const S = load();
const hollow = () => S.view === 'hollow';                                          // 'solid': the modules as they look, opaque · 'hollow': walls, floors, see-through
const B = { building: null, key: '', fields: null, union: null, sel: [], hover: -1, three: null, busy: false, again: false, timer: 0, ms: {} };
let R = {};

function load() { try { const j = JSON.parse(localStorage.getItem('protospace.rationalize') || 'null'); return { ...DEF, ...(j || {}), overrides: { ...((j && j.overrides) || {}) } }; } catch (e) { return { ...DEF, overrides: {} }; } }
function save() { try { localStorage.setItem('protospace.rationalize', JSON.stringify(S)); } catch (e) {} }

// ------------------------------------------------------------------ the modules and their pairs
const pairKey = (a, b) => [a, b].sort().join('|');                                   // by board slot ("L:k"), so overrides survive a rebuild
const bayName = m => `${'ABCDEFG'[m.c]}${m.r + 1}`;
const modName = m => `${m.id} · ${bayName(m)} ${['ground', 'level 2', 'level 3'][m.L]}`;
function neighbours(mods, cols) {                                                    // modules side by side on a layer, or stacked
  const at = new Map(mods.map((m, i) => [m.slot, i])), out = [];
  mods.forEach((m, i) => {
    const try_ = (slot, how) => { const j = at.get(slot); if (j != null) out.push({ i, j, how }); };
    if (m.c + 1 < cols) try_(`${m.L}:${m.k + 1}`, 'along the lot');
    try_(`${m.L}:${m.k + cols}`, 'across the lot');
    try_(`${m.L + 1}:${m.k}`, 'stacked');
  });
  return out;
}
const kFor = (i, j) => { const mods = B.building.mods, v = S.overrides[pairKey(mods[i].slot, mods[j].slot)]; return v != null ? v : S.k; };

// ------------------------------------------------------------------ computing
/* Three stages, each cached: the module fields (when the board or the softening change), the union (when a merge
   changes), the meshes (when the walls, floors or resolution change). */
function schedule(stage, delay = 120) {
  B.need = Math.min(B.need ?? 9, stage);
  clearTimeout(B.timer); B.timer = setTimeout(run, delay);
}
async function run() {
  if (B.busy) { B.again = true; return; }
  const b = B.building; if (!b || !b.mods.length) { clearMeshes(); status(b ? 'The Assemble board is empty: place some modules there first.' : 'Loading the modules from the Assemble tab…'); return; }
  B.busy = true; const need = B.need ?? 9; B.need = 9;
  status('Rationalizing…'); await new Promise(r => setTimeout(r, 30));
  try {
    const t0 = performance.now();
    if (need <= 0 || !B.fields) { B.fields = b.mods.map(m => moduleField(m.vox, Math.ceil(KMAX / b.LAT) + 4, b.LAT, S.soft)); B.ms.fields = performance.now() - t0; }
    const t1 = performance.now();
    if (need <= 1 || !B.union) { B.union = unionField(B.fields, 4, kFor); B.ms.union = performance.now() - t1; }
    const t2 = performance.now();
    makeMeshes(); B.ms.mesh = performance.now() - t2;
    report();
  } catch (e) { console.error(e); status('Could not rationalize: ' + (e.message || e)); }
  B.busy = false;
  if (B.again) { B.again = false; run(); }
}
function makeMeshes() {
  const b = B.building, U = B.union, s = S.res, yOf = gy => b.gridY(gy);                 // the same mapping as the mesh
  clearMeshes();
  const toWorld = (pos, fine) => {
    for (let i = 0; i < pos.length; i += 3) { const gx = U.x0 + pos[i] / fine, gy = U.y0 + pos[i + 1] / fine, gz = U.z0 + pos[i + 2] / fine; pos[i] = b.gridX(gx); pos[i + 1] = b.gridY(gy); pos[i + 2] = b.gridZ(gz); }
  };
  const labelsOf = (pos, fine) => { const L = new Int16Array(pos.length / 3); for (let v = 0; v < L.length; v++) { const x = Math.round(pos[v * 3] / fine), y = Math.round(pos[v * 3 + 1] / fine), z = Math.round(pos[v * 3 + 2] / fine); L[v] = U.lab[Math.min(U.nx - 1, x) + U.nx * (Math.min(U.ny - 1, y) + U.ny * Math.min(U.nz - 1, z))] - 1; } return L; };
  const mesh = (kind, mat) => {
    const step = b.LAT / s, D = detailField(U, s, kind, { t: hollow() ? Math.max(S.t, 1.1 * step) : 0, tf: Math.max(S.tf, 1.1 * step), H: S.H, yBase: b.PODIUM_V * b.LAT, yOf });   // nothing thinner than the sampling step, or it falls between samples
    const { pos, index } = netsField(D.F, D.FX, D.FY, D.FZ);
    if (!index.length) return null;
    const labels = labelsOf(pos, s);
    taubin(pos, index, kind === 'shell' ? 3 : 1);
    toWorld(pos, s);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(index, 1));
    g.computeVertexNormals();
    const col = new Float32Array(pos.length); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.userData.labels = labels; g.userData.base = new THREE.Color(kind === 'shell' ? 0xe9e5de : 0xa79f93);
    const m = new THREE.Mesh(g, mat); m.name = kind === 'shell' ? 'Valve HQ · shell' : 'Valve HQ · floor plates'; m.castShadow = m.receiveShadow = true;
    B.three.building.add(m); return { m, cells: D.F.reduce((n, v) => n + (v < 0 ? 1 : 0), 0) };
  };
  const sh = mesh('shell', B.three.SHELL);
  const fl = hollow() && S.floors ? mesh('floors', B.three.FLOOR) : null;
  const cell = Math.pow(b.LAT / s, 3);
  B.stats = { tris: [sh, fl].reduce((n, x) => n + (x ? x.m.geometry.index.count / 3 : 0), 0), floorArea: fl ? fl.cells * cell / Math.max(S.tf, 1.1 * b.LAT / s) : 0, wallVol: sh ? sh.cells * cell : 0 };
  B.box = new THREE.Box3(); B.three.building.children.forEach(o => { o.geometry.computeBoundingBox(); B.box.union(o.geometry.boundingBox); });
  paint(); applyCuts(); applyLook();
}
function clearMeshes() { if (!B.three) return; const g = B.three.building; while (g.children.length) { const o = g.children.pop(); o.geometry?.dispose(); } }

// ------------------------------------------------------------------ the look: colours, highlight, see-through, cuts
function paint() {
  const sel = B.sel, hi = new THREE.Color(0xe4312b), hov = new THREE.Color(0xffffff), tmp = new THREE.Color();
  for (const m of B.three.building.children) {
    const g = m.geometry, L = g.userData.labels, col = g.getAttribute('color'), a = col.array, base = g.userData.base;
    for (let v = 0; v < L.length; v++) {
      tmp.copy(base);
      if (sel.includes(L[v])) tmp.lerp(hi, 0.55); else if (L[v] === B.hover) tmp.lerp(hov, 0.5); else if (sel.length === 2) tmp.lerp(new THREE.Color(0x8a8a8a), 0.25);
      a[v * 3] = tmp.r; a[v * 3 + 1] = tmp.g; a[v * 3 + 2] = tmp.b;
    }
    col.needsUpdate = true;
  }
}
function applyLook() {
  const { SHELL } = B.three, o = hollow() ? S.opacity : 1;
  SHELL.opacity = o; SHELL.transparent = o < 0.999; SHELL.depthWrite = o >= 0.999; SHELL.needsUpdate = true;
}
function applyCuts() {
  const b = B.building; if (!b || !B.three) return;
  const { planes } = B.three, bx = B.box && !B.box.isEmpty() ? B.box : null; if (!bx) return;   // the sections run across the building itself, not the whole board
  planes[0].constant = S.cutY >= 70 ? 1e6 : S.cutY;                                        // plan cut (m above the ground): keep what is below
  planes[1].constant = S.cutZ <= 0 ? 1e6 : bx.max.z - (S.cutZ / 100) * (bx.max.z - bx.min.z);   // section from the street (z falls to the east): keep what is east of it
  planes[2].constant = S.cutX <= 0 ? 1e6 : -(bx.min.x + (S.cutX / 100) * (bx.max.x - bx.min.x));   // section from the north: keep what is south of it
}

// ------------------------------------------------------------------ the page
const slider = (key, label, min, max, step, unit, hint = '') => `<div class="xp-slider rz-slider"><label><span>${label}</span><b data-out="${key}"></b></label><input type="range" data-s="${key}" min="${min}" max="${max}" step="${step}" aria-label="${esc(label)}">${hint ? `<p class="hint">${hint}</p>` : ''}</div>`;
const HTML = `
<div class="as rz">
  <aside class="xp-controls as-controls" aria-label="Rationalize controls">
    <h2 class="eyebrow">Show the modules</h2>
    <div class="xp-row rz-mode" role="group" aria-label="Show the modules"><button type="button" class="btn quiet" data-mode="solid">As they look</button><button type="button" class="btn quiet" data-mode="hollow">Hollow · see-through</button></div>
    <p class="hint" data-v="modeNote"></p>
    <h2 class="eyebrow" style="margin-top:16px">Merging</h2>
    ${slider('k', 'Merge · every pair', 0, KMAX, 0.25, 'm', 'How far the modules reach for each other: 0 keeps them apart across their 1 m seams; a few metres grows a fillet between neighbours until they read as one mass, and their rooms open into each other.')}
    <div class="rz-pair" data-v="pair"></div>
    <h2 class="eyebrow" style="margin-top:16px">Pairs</h2>
    <p class="hint">Click a module in the view, then a second one, to set how much those two merge. Or pick a pair here.</p>
    <div class="rz-pairs" data-v="pairs"></div>
    <h2 class="eyebrow" style="margin-top:16px">The volume</h2>
    ${slider('t', 'Wall thickness', 0.3, 2.5, 0.05, 'm')}
    <label class="chk"><input type="checkbox" data-c="floors"> Floor plates every storey, inside the walls</label>
    ${slider('H', 'Storey height', 3, 6.2, 0.05, 'm')}
    ${slider('soft', 'Soften the voxel steps', 0, 3, 1, '')}
    <div class="xp-row rz-res"><span class="hint">Detail</span><button type="button" class="btn quiet" data-res="1">1 m</button><button type="button" class="btn quiet" data-res="2">0.5 m</button></div>
    <h2 class="eyebrow" style="margin-top:16px">Seeing inside</h2>
    ${slider('opacity', 'Shell opacity', 0.05, 1, 0.05, '')}
    ${slider('cutY', 'Plan cut · height', 0, 70, 0.25, 'm')}
    ${slider('cutZ', 'Section · from the street', 0, 100, 1, '%')}
    ${slider('cutX', 'Section · from the north', 0, 100, 1, '%')}
    <div class="xp-row"><button type="button" class="btn quiet" data-v="reset">Reset all</button><button type="button" class="btn quiet" data-v="glb">Model · GLB</button><button type="button" class="btn quiet" data-v="obj">Model · OBJ</button><button type="button" class="btn quiet" data-v="png">Picture · PNG</button></div>
  </aside>
  <div class="as-main">
    <p class="status" data-v="stats"></p>
    <div class="as-viewer rz-viewer"><canvas data-v="canvas" aria-label="The rationalized building in 3D"></canvas><div class="as-compass">drag to orbit · scroll to zoom · click a module, then another · <button type="button" data-view="street">street</button> <button type="button" data-view="bay">bay</button> <button type="button" data-view="aerial">aerial</button> <button type="button" data-view="plan">plan</button> <button type="button" data-view="inside">inside</button></div></div>
    <p class="hint" data-v="tip">&nbsp;</p>
  </div>
</div>`;

function status(t) { if (R.stats) R.stats.textContent = t; }
function report() {
  const b = B.building, st = B.stats || {}, nP = neighbours(b.mods, b.cols).length, nO = Object.keys(S.overrides).length;
  status(`${b.mods.length} modules · ${nP} neighbouring pairs${nO ? ` · ${nO} set by hand` : ''} · ${Math.round(st.tris || 0).toLocaleString()} triangles` + (hollow() && S.floors ? ` · ≈ ${Math.round(st.floorArea).toLocaleString()} m² of floor plates` : '') + ` · ${Math.round((B.ms.union || 0) + (B.ms.mesh || 0))} ms`);
}
function syncControls() {
  $$('[data-s]', R.root).forEach(x => { x.value = S[x.dataset.s]; });
  $$('[data-out]', R.root).forEach(o => { const k = o.dataset.out, v = S[k]; o.textContent = k === 'opacity' ? `${Math.round(v * 100)} %` : k === 'soft' ? ['off', 'a little', 'more', 'most'][v] : /^cut/.test(k) ? (k === 'cutY' ? (v >= 70 ? 'off' : `${(+v).toFixed(1)} m`) : (v <= 0 ? 'off' : `${v} %`)) : `${(+v).toFixed(2).replace(/\.?0+$/, '')} m`; });
  $$('[data-c]', R.root).forEach(x => { x.checked = !!S[x.dataset.c]; });
  $$('[data-res]', R.root).forEach(x => x.classList.toggle('on', +x.dataset.res === S.res));
  $$('[data-mode]', R.root).forEach(x => x.classList.toggle('on', x.dataset.mode === S.view));
  R.modeNote.textContent = hollow() ? 'Walls inside the surface, floor plates every storey, and a shell you can fade or cut away to see the rooms.' : 'The merged modules as solid, opaque volumes — how the building looks from outside.';
  R.root.querySelector('[data-s=t]').disabled = !hollow(); R.root.querySelector('[data-c=floors]').disabled = !hollow(); R.root.querySelector('[data-s=opacity]').disabled = !hollow(); R.root.querySelector('[data-s=H]').disabled = !hollow() || !S.floors;
}
function renderPairs() {
  const b = B.building; if (!b) { R.pairs.innerHTML = ''; R.pair.innerHTML = ''; return; }
  const ps = neighbours(b.mods, b.cols);
  R.pairs.innerHTML = ps.length ? ps.map(p => { const A = b.mods[p.i], C = b.mods[p.j], key = pairKey(A.slot, C.slot), v = S.overrides[key], on = B.sel.length === 2 && B.sel.includes(p.i) && B.sel.includes(p.j);
    return `<button type="button" class="rz-prow${on ? ' on' : ''}${v != null ? ' set' : ''}" data-pi="${p.i}" data-pj="${p.j}"><span>${esc(A.id)} ↔ ${esc(C.id)}</span><small>${bayName(A)}${A.L !== C.L ? ` ${['G', 'L2', 'L3'][A.L]}→${['G', 'L2', 'L3'][C.L]}` : ''} · ${p.how}</small><b>${(v != null ? v : S.k).toFixed(1)} m</b></button>`; }).join('') : '<p class="hint">No modules touch on the board.</p>';
  // the selected pair
  if (B.sel.length === 0) { R.pair.innerHTML = ''; return; }
  const A = b.mods[B.sel[0]];
  if (B.sel.length === 1) { R.pair.innerHTML = `<div class="rz-card"><b>${esc(modName(A))}</b><span class="hint">${esc(A.name)} — now click a second module.</span></div>`; return; }
  const C = b.mods[B.sel[1]], key = pairKey(A.slot, C.slot), v = S.overrides[key], near = ps.some(p => (p.i === B.sel[0] && p.j === B.sel[1]) || (p.i === B.sel[1] && p.j === B.sel[0]));
  R.pair.innerHTML = `<div class="rz-card on"><b>${esc(A.id)} ↔ ${esc(C.id)}</b><span class="hint">${esc(modName(A))} and ${esc(modName(C))}${near ? '' : ' — not neighbours on the board: they merge only where they come within reach of each other'}</span>
    <div class="xp-slider rz-slider"><label><span>Merge · these two</span><b data-pout>${(v != null ? v : S.k).toFixed(2)} m${v != null ? '' : ' (all pairs)'}</b></label><input type="range" data-pk min="0" max="${KMAX}" step="0.25" value="${v != null ? v : S.k}" aria-label="Merge for this pair"></div>
    <div class="xp-row"><button type="button" class="btn quiet" data-papart>Keep apart</button><button type="button" class="btn quiet" data-pone>As one</button><button type="button" class="btn quiet" data-pclear${v == null ? ' disabled' : ''}>Use the global value</button><button type="button" class="btn quiet" data-pdone>Done</button></div></div>`;
}
function setPair(v) {
  const b = B.building, A = b.mods[B.sel[0]], C = b.mods[B.sel[1]], key = pairKey(A.slot, C.slot);
  if (v == null) delete S.overrides[key]; else S.overrides[key] = v;
  save(); renderPairs(); schedule(1);
}
function pick(x, y) {
  const { camera, canvas, building, raycaster } = B.three, r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camera);
  const hits = raycaster.intersectObjects(building.children, false).filter(h => {
    const p = h.point; return B.three.planes.every(pl => pl.distanceToPoint(p) >= 0);    // not in the cut-away part
  });
  if (!hits.length) return -1;
  const h = hits[0], L = h.object.geometry.userData.labels; return L[h.face.a];
}
function setView(name) {
  const { camera, controls, building } = B.three, bb = new THREE.Box3();
  building.children.forEach(o => bb.expandByObject(o));
  if (bb.isEmpty()) return;
  const c = bb.getCenter(new THREE.Vector3()), size = bb.getSize(new THREE.Vector3()), span = Math.max(size.x, size.z, size.y * 1.5), d = span * 1.3 + 50;
  const v = {
    street: [[c.x + d * 0.55, size.y * 0.9 + 22, c.z + d * 0.8], [c.x, size.y * 0.35, c.z]],
    bay: [[c.x - d * 0.55, size.y * 0.9 + 22, c.z - d * 0.8], [c.x, size.y * 0.35, c.z]],
    aerial: [[c.x + d * 0.45, d * 0.95, c.z + d * 0.7], [c.x, 0, c.z]],
    plan: [[c.x, d * 1.4, c.z + 0.01], [c.x, 0, c.z]],
    inside: [[c.x + span * 0.18, size.y * 0.45, c.z + span * 0.06], [c.x - span * 0.1, size.y * 0.35, c.z - span * 0.05]],
  }[name];
  camera.position.set(...v[0]); controls.target.set(...v[1]); controls.update();
}
function initThree(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.localClippingEnabled = true;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.3, 4000); camera.position.set(360, 70, 140);
  const controls = new OrbitControls(camera, canvas); controls.target.set(125, 18, -40); controls.enableDamping = true; controls.dampingFactor = 0.08;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x4a4a4a, 0.95));
  const sun = new THREE.DirectionalLight(0xffffff, 1.9); sun.position.set(-150, 220, 160); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -220; sc.right = 220; sc.top = 220; sc.bottom = -220; sc.near = 10; sc.far = 800; sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.3; sun.target.position.set(125, 0, -50); scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xffffff, 0.45); fill.position.set(200, 80, -200); scene.add(fill);
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0, ...extra });
  const plane = (w, d, color, x, z, y = 0, extra = {}) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(color, extra)); p.rotation.x = -Math.PI / 2; p.position.set(x, y, z); p.receiveShadow = true; scene.add(p); };
  plane(250, 100, 0xdcd8d0, 125, -50, 0.02); plane(650, 400, 0x9db4c0, 125, -300, -0.3, { roughness: 0.25 }); plane(650, 60, 0xb9b9b9, 125, 30, -0.05); plane(650, 400, 0xc9c5bd, 125, 260, -0.1);
  plane(60, 160, 0xb9b9b9, -30, -50, -0.05); plane(60, 160, 0xb9b9b9, 280, -50, -0.05);
  const planes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6), new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e6), new THREE.Plane(new THREE.Vector3(1, 0, 0), 1e6)];
  const SHELL = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, clippingPlanes: planes, clipShadows: true, transparent: true, opacity: 0.35, depthWrite: false });
  const FLOOR = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, clippingPlanes: planes, clipShadows: true });
  const building = new THREE.Group(); scene.add(building);
  B.three = { renderer, scene, camera, controls, building, canvas, planes, SHELL, FLOOR, raycaster: new THREE.Raycaster() };
  const resize = () => { const w = canvas.clientWidth || 800, h = canvas.clientHeight || 500; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  resize(); window.addEventListener('resize', resize);
  (function loop() { requestAnimationFrame(loop); if (canvas.isConnected && !R.root.closest('.tab')?.hidden) { controls.update(); renderer.render(scene, camera); } })();
}
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }

export function mount(root, { getBuilding }) {
  root.innerHTML = HTML; R = { root }; $$('[data-v]', root).forEach(el => { R[el.dataset.v] = el; });
  initThree(R.canvas); syncControls();
  // sliders and switches: each one re-runs only the stage it changes
  const STAGE = { k: 1, t: 2, H: 2, soft: 0 };
  $$('[data-s]', root).forEach(x => x.addEventListener('input', () => {
    const k = x.dataset.s; S[k] = +x.value; syncControls(); save();
    if (k === 'opacity') applyLook(); else if (/^cut/.test(k)) applyCuts(); else { if (k === 'k') renderPairs(); schedule(STAGE[k], 220); }
  }));
  $$('[data-c]', root).forEach(x => x.addEventListener('change', () => { S[x.dataset.c] = x.checked; syncControls(); save(); schedule(2, 0); }));
  $$('[data-res]', root).forEach(x => x.addEventListener('click', () => { S.res = +x.dataset.res; syncControls(); save(); schedule(2, 0); }));
  $$('[data-mode]', root).forEach(x => x.addEventListener('click', () => { if (S.view === x.dataset.mode) return; S.view = x.dataset.mode; syncControls(); save(); applyLook(); schedule(2, 0); }));
  $$('[data-view]', root).forEach(x => x.addEventListener('click', () => setView(x.dataset.view)));
  R.reset.addEventListener('click', () => { Object.assign(S, { ...DEF, overrides: {} }); B.sel = []; syncControls(); save(); renderPairs(); schedule(0, 0); });
  R.glb.addEventListener('click', () => new GLTFExporter().parse(B.three.building, out => download(new Blob([out], { type: 'model/gltf-binary' }), 'ProtoSpace-ValveHQ-rationalized.glb'), err => console.error(err), { binary: true }));
  R.obj.addEventListener('click', () => download(new Blob([new OBJExporter().parse(B.three.building)], { type: 'text/plain' }), 'ProtoSpace-ValveHQ-rationalized.obj'));
  R.png.addEventListener('click', () => { const { renderer, scene, camera } = B.three; renderer.render(scene, camera); renderer.domElement.toBlob(b => download(b, 'ProtoSpace-ValveHQ-rationalized.png')); });
  // the pair card and the list
  R.pairs.addEventListener('click', e => { const r = e.target.closest('[data-pi]'); if (!r) return; B.sel = [+r.dataset.pi, +r.dataset.pj]; renderPairs(); paint(); });
  R.pair.addEventListener('input', e => { if (!e.target.matches('[data-pk]')) return; const v = +e.target.value; R.pair.querySelector('[data-pout]').textContent = `${v.toFixed(2)} m`; clearTimeout(B.pt); B.pt = setTimeout(() => setPair(v), 220); });
  R.pair.addEventListener('click', e => {
    if (e.target.matches('[data-papart]')) setPair(0); else if (e.target.matches('[data-pone]')) setPair(KMAX); else if (e.target.matches('[data-pclear]')) setPair(null);
    else if (e.target.matches('[data-pdone]')) { B.sel = []; renderPairs(); paint(); }
  });
  // picking: a still click selects (first, then second module); a drag orbits
  let p0 = null, raf = 0;
  R.canvas.addEventListener('pointerdown', e => { p0 = { x: e.clientX, y: e.clientY }; });
  R.canvas.addEventListener('pointerup', e => {
    const d = p0; p0 = null; if (!d || e.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5 || !B.building) return;
    const i = pick(e.clientX, e.clientY);
    if (i < 0) B.sel = []; else if (B.sel.includes(i)) B.sel = B.sel.filter(x => x !== i); else if (B.sel.length === 1) B.sel = [B.sel[0], i]; else B.sel = [i];
    renderPairs(); paint();
  });
  R.canvas.addEventListener('pointermove', e => {
    if (p0 || !B.building) return; const x = e.clientX, y = e.clientY;
    cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { const i = pick(x, y); R.canvas.style.cursor = i >= 0 ? 'pointer' : ''; if (i !== B.hover) { B.hover = i; paint(); R.tip.textContent = i >= 0 ? `${modName(B.building.mods[i])} — ${B.building.mods[i].name}` : ' '; } });
  });
  R.canvas.addEventListener('pointerleave', () => { if (B.hover >= 0) { B.hover = -1; paint(); R.tip.innerHTML = '&nbsp;'; } });
  let first = true;
  const show = () => {
    window.dispatchEvent(new Event('resize'));
    const b = getBuilding();
    if (!b) { status('Loading the modules from the Assemble tab…'); setTimeout(show, 600); return; }
    if (b.key !== B.key) { B.building = b; B.key = b.key; B.fields = B.union = null; B.sel = []; B.hover = -1; renderPairs(); schedule(0, 0); if (first) { first = false; setTimeout(() => setView('street'), 900); } }
  };
  return { show };
}

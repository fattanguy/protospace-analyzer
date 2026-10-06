/* ProtoSpace Analyzer — the Generator tab: the Blender voxel animation, live in the browser.
   The pattern field (js/field.js) is evaluated for every point of the slab by a small pool of Web Workers and
   drawn by a viewer (js/viewer.js). The modifiers live in a dropdown inside the animation rectangle and every
   change shows at once. Animations (a set of modifier values) can be saved and picked again in Analyze.

   Exports PSGen for the page script (js/app.js):
     mount(hooks)                 build the tab; hooks.analyze(vox, thr) → { grid, result }, hooks.onAnalyzeFrame(settings, frame)
     generate(settings, frame)    → Promise<Uint8Array | null> (null when a newer request superseded it); its own worker pool
     camera(settings), frameMax(settings), threshold(max)
     current()                    → { settings, frame } of the generator right now
     load(settings)               put settings into the generator
     animations                   the saved-animation store: list(), get(id), save(name, settings), remove(id)
     onChange(fn)                 fn() whenever the generator settings or the store change */

import { DEFAULTS, withDefaults } from './field.js';
import { createViewer } from './viewer.js';

const $ = (s, r = document) => r.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtN = n => Math.round(n).toLocaleString('en-US');
const THRESHOLD_FRAC = 8 / 15;                          // a cube counts as mass at ≥ 53% of its full size

// ------------------------------------------------------------------ built-in animations
const SCENE = {                                         // read from Voxel Animation Controls.blend (modifier inputs + keyframes)
  pattern: 'voronoi', scale: 0.54, offset: [0, 8.98, 0], invert: false,
  animate: false, loopLength: 250, travel: [0.98, 2.54, 26.94], frameOffset: 0,
  growFrom: 0.52, fullSizeAt: 0.54, smallest: 0, largest: 1, sizeSteps: 0,
  noise: { detail: 2, roughness: 0.5, lacunarity: 2, distortion: 0 },
  voronoi: { metric: 'chebychev', randomness: 1, w: 0, detail: 0 },
  keyed: { enabled: true, axis: 2, f0: 0, v0: 0, f1: 300, v1: 50, ease: 'bezier' },
};
const BUILTIN = [
  { id: 'scene', name: 'Blender scene · Voronoi', settings: withDefaults(SCENE), builtin: true },
  { id: 'original', name: 'Original loop · Noise', settings: withDefaults({}), builtin: true },
];

// ------------------------------------------------------------------ the saved-animation store (localStorage)
const STORE_KEY = 'protospace.animations';
const listeners = [];
function notify() { for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } }
function readStore() { try { const j = JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); return Array.isArray(j) ? j.filter(a => a && a.id && a.settings).map(a => ({ id: a.id, name: String(a.name || 'Animation'), settings: withDefaults(a.settings), created: a.created || 0 })) : []; } catch (e) { return []; } }
function writeStore(list) { try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch (e) {} }
export const animations = {
  list() { return [...BUILTIN, ...readStore()]; },
  get(id) { return this.list().find(a => a.id === id) || null; },
  save(name, settings) {
    const list = readStore();
    const entry = { id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: (name || '').trim() || `Animation ${list.length + 1}`, settings: withDefaults(JSON.parse(JSON.stringify(settings))), created: Date.now() };
    list.push(entry); writeStore(list); notify(); return entry;
  },
  rename(id, name) { const list = readStore(); const a = list.find(x => x.id === id); if (!a) return; a.name = (name || '').trim() || a.name; writeStore(list); notify(); },
  remove(id) { writeStore(readStore().filter(a => a.id !== id)); notify(); },
};

// ------------------------------------------------------------------ worker pools (latest request wins)
const MAX_POINTS = 450000;
function makePool(n) {
  const workers = []; let reqId = 0, busy = false, pending = null, parts = null, inflight = null;
  try {
    for (let i = 0; i < n; i++) {
      const w = new Worker('js/gen.worker.js', { type: 'module' });
      w.onmessage = e => onPart(e.data);
      w.onerror = e => { console.error('generator worker', e.message); };
      workers.push(w);
    }
  } catch (e) { console.warn('Workers unavailable, generating on the main thread', e); }
  function generate(settings, frame) {
    return new Promise(resolve => {
      if (pending) pending.resolve(null);                                     // superseded before it started
      pending = { settings, frame, resolve };
      if (!busy) dispatch();
    });
  }
  function dispatch() {
    const p = pending; if (!p) return;
    pending = null;
    const S = withDefaults(p.settings), [nx, ny, nz] = S.dims;
    if (nx * ny * nz > MAX_POINTS) { p.resolve(null); return; }
    busy = true; reqId++; inflight = p;
    const id = reqId;
    if (!workers.length) {
      import('./field.js').then(F => { const sizes = F.generateFrame(S, p.frame); busy = false; inflight = null; p.resolve(sizes); if (pending) dispatch(); });
      return;
    }
    parts = { id, nx, ny, nz, got: 0, sizes: new Uint8Array(nx * ny * nz), t0: performance.now() };
    const per = Math.ceil(nz / workers.length);
    let sent = 0;
    for (let i = 0; i < workers.length; i++) {
      const z0 = i * per, z1 = Math.min(nz, z0 + per); if (z0 >= z1) continue;
      sent++; workers[i].postMessage({ id, settings: S, frame: p.frame, z0, z1 });
    }
    parts.expect = sent;
  }
  function onPart(m) {
    const P = parts; if (!P || m.id !== P.id) return;
    P.sizes.set(m.sizes, P.nx * P.ny * m.z0); P.got++;
    if (P.got < P.expect) return;
    busy = false; const p = inflight; inflight = null; parts = null;
    p.resolve(P.sizes);
    if (pending) dispatch();
  }
  return { generate, get busy() { return busy; }, size: workers.length || 1 };
}
const hc = clamp(navigator.hardwareConcurrency || 2, 1, 8);
const livePool = makePool(clamp(hc - 1, 1, 4));          // the Generator's own frames
const sidePool = makePool(clamp(hc >> 1, 1, 2));         // frames asked for by Analyze / 3D model

// ------------------------------------------------------------------ shared helpers
export function cameraFor(S) {
  const [nx, ny, nz] = S.dims, sp = S.spacing, o = [-(nz - 1) / 2 * sp, -(nx - 1) / 2 * sp, -(ny - 1) / 2 * sp];
  const one = (P, i, dim, sign) => { const v = (P[i] - o[i]) / sp + 0.5; return sign > 0 ? v : dim - v; };
  return { name: 'Camera', position: [15.5, 0, 0], forward: [-1, 0, 0], lens_mm: 50, sensor_mm: 36, sensor_fit: 'AUTO', resolution: [1920, 1080], lattice: P => [one(P, 1, nx, 1), one(P, 2, ny, 1), one(P, 0, nz, -1)] };
}
export function frameMaxOf(S) { return Math.max(1, S.loopLength, S.keyed && S.keyed.enabled ? Math.max(S.keyed.f0, S.keyed.f1) : 0); }
export const threshold = (max = 255) => Math.round(THRESHOLD_FRAC * max);

// ------------------------------------------------------------------ the controls, one entry per modifier input
const SCHEMA = [
  { name: 'Pattern', open: true, fields: [
    { k: 'pattern', label: 'Pattern', type: 'select', options: [['noise', 'Noise · soft blobs'], ['voronoi', 'Voronoi · cells']], hint: 'What grows the cubes' },
    { k: 'scale', label: 'Scale', type: 'range', min: 0.02, max: 4, step: 0.01, hint: 'Smaller = bigger blobs of mass, larger = finer grain' },
    { k: 'offset', label: 'Offset · X depth, Y along, Z up', type: 'vec3', step: 0.1, hint: 'Moves the pattern through the slab without moving the cubes' },
    { k: 'invert', label: 'Invert · swap mass and void', type: 'check' },
  ] },
  { name: 'Motion', open: false, fields: [
    { k: 'animate', label: 'Animate · the pattern slides through the slab', type: 'check' },
    { k: 'loopLength', label: 'Loop length · frames', type: 'number', min: 1, max: 5000, step: 1 },
    { k: 'travel', label: 'Travel per loop · X depth, Y along, Z up', type: 'vec3', step: 0.5 },
    { k: 'frameOffset', label: 'Frame offset', type: 'number', min: -5000, max: 5000, step: 1 },
    { k: 'keyed.enabled', label: 'Keyframed offset · one axis driven by two keyframes, as in the .blend', type: 'check' },
    { k: 'keyed.axis', label: 'Keyframed axis', type: 'select', options: [['0', 'X · depth'], ['1', 'Y · along the slab'], ['2', 'Z · up']] },
    { k: 'keyed.f0', label: 'From frame', type: 'number', min: -5000, max: 5000, step: 1 },
    { k: 'keyed.v0', label: 'From value', type: 'number', min: -1000, max: 1000, step: 0.1 },
    { k: 'keyed.f1', label: 'To frame', type: 'number', min: -5000, max: 5000, step: 1 },
    { k: 'keyed.v1', label: 'To value', type: 'number', min: -1000, max: 1000, step: 0.1 },
    { k: 'keyed.ease', label: 'Easing', type: 'select', options: [['bezier', 'Bezier · ease in and out (Blender default)'], ['linear', 'Linear']] },
  ] },
  { name: 'Growth', open: false, fields: [
    { k: 'growFrom', label: 'Grow from · pattern value where cubes appear', type: 'range', min: 0, max: 1, step: 0.005 },
    { k: 'fullSizeAt', label: 'Full size at · pattern value where cubes are full size', type: 'range', min: 0, max: 1, step: 0.005 },
    { k: 'smallest', label: 'Smallest cube · in the voids', type: 'range', min: 0, max: 1, step: 0.01 },
    { k: 'largest', label: 'Largest cube · 1 = touching', type: 'range', min: 0, max: 3, step: 0.01 },
    { k: 'sizeSteps', label: 'Size steps · 0 smooth, 1 on/off, 2+ stepped', type: 'number', min: 0, max: 16, step: 1 },
  ] },
  { name: 'Noise', when: 'noise', fields: [
    { k: 'noise.detail', label: 'Detail · layers of finer noise', type: 'range', min: 0, max: 8, step: 0.1 },
    { k: 'noise.roughness', label: 'Roughness', type: 'range', min: 0, max: 1, step: 0.01 },
    { k: 'noise.lacunarity', label: 'Lacunarity', type: 'range', min: 0, max: 6, step: 0.05 },
    { k: 'noise.distortion', label: 'Distortion', type: 'range', min: -10, max: 10, step: 0.1 },
  ] },
  { name: 'Voronoi', when: 'voronoi', fields: [
    { k: 'voronoi.metric', label: 'Metric', type: 'select', options: [['euclidean', 'Euclidean · round cells'], ['manhattan', 'Manhattan · diamonds'], ['chebychev', 'Chebychev · square cells']] },
    { k: 'voronoi.randomness', label: 'Randomness · 0 = regular grid', type: 'range', min: 0, max: 1, step: 0.01 },
    { k: 'voronoi.w', label: 'W · another slice of the same cells', type: 'range', min: -20, max: 20, step: 0.05 },
    { k: 'voronoi.detail', label: 'Detail · cells within cells', type: 'range', min: 0, max: 6, step: 0.1 },
  ] },
  { name: 'Slab', open: false, fields: [
    { k: 'dims.0', label: 'Points along the slab', type: 'number', min: 8, max: 300, step: 1 },
    { k: 'dims.1', label: 'Points up', type: 'number', min: 4, max: 80, step: 1 },
    { k: 'dims.2', label: 'Points deep', type: 'number', min: 2, max: 80, step: 1 },
    { k: 'spacing', label: 'Point spacing · Blender units per cube (1 m)', type: 'number', min: 0.02, max: 2, step: 0.01 },
  ] },
];

// ------------------------------------------------------------------ state
const G = { S: withDefaults(SCENE), frame: 61, playing: false, fps: 24, timer: null, viewer: null, sizes: null, frameShown: null, hooks: null, lastMs: 0, root: null };
const get = (obj, path) => path.split('.').reduce((o, k) => o[k], obj);
const set = (obj, path, v) => { const ks = path.split('.'); const o = ks.slice(0, -1).reduce((o, k) => o[k], obj); o[ks.at(-1)] = v; };
const fmtVal = v => typeof v === 'number' ? (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2).replace(/\.?0+$/, '')) : String(v);

// ------------------------------------------------------------------ a generated frame
let liveReq = 0;
function request(frame) {
  const id = ++liveReq, S = G.S, t0 = performance.now();
  livePool.generate(S, frame).then(sizes => { if (!sizes || id !== liveReq) return; G.lastMs = performance.now() - t0; onFrame(frame, sizes, S); });
}
function onFrame(frame, sizes, S) {
  G.sizes = sizes; G.frameShown = frame;
  const [nx, ny, nz] = S.dims, thr = threshold(255);
  let solid = 0; for (let i = 0; i < sizes.length; i++) if (sizes[i] >= thr) solid++;
  const live = G.hooks.analyze({ nx, ny, nz, sizes, max: 255 }, thr);
  G.viewer.setSource({ name: `${S.pattern} · frame ${frame}`, frame, vox: { nx, ny, nz, sizes, max: 255, threshold: thr }, camera: cameraFor(S), result: live.result });
  renderRatings(live.result);
  $('#genFrameOut').textContent = `${frame} / ${frameMaxOf(S)}`;
  status(`${fmtN(solid)} solid cubes of ${fmtN(sizes.length)} · ${S.dims[0]} × ${S.dims[1]} m slab, ${S.dims[2]} m deep · ${G.lastMs.toFixed(0)} ms`);
  if (G.playing) scheduleNext();
}
function status(t) { $('#genStatus').textContent = t; }
function renderRatings(result) {
  const el = $('#genRatings'); if (!el) return;
  const W = window.PSA.WORDS;
  if (!result || result.features.empty) { el.innerHTML = '<p class="hint">Too little mass to rate — lower “Grow from” in the modifiers.</p>'; return; }
  el.innerHTML = W.map(w => { const v = result.ratings[w]; return `<div class="gen-row"><span class="wd">${w}</span><span class="track"><span class="bar" style="width:${v ?? 0}%"></span></span><span class="num">${v == null ? '—' : v}</span></div>`; }).join('');
}

// ------------------------------------------------------------------ playback
function play(on) {
  G.playing = on;
  $('#genPlay').textContent = on ? '❚❚' : '▶'; $('#genPlay').setAttribute('aria-label', on ? 'Pause' : 'Play');
  if (on) scheduleNext();
}
function scheduleNext() {
  clearTimeout(G.timer);
  G.timer = setTimeout(() => { if (!G.playing) return; setFrame(G.frame >= frameMaxOf(G.S) ? 1 : G.frame + 1); }, 1000 / G.fps);
}
function setFrame(f, fromSlider = false) {
  G.frame = clamp(Math.round(f), 1, frameMaxOf(G.S));
  if (!fromSlider) $('#genFrame').value = G.frame;
  $('#genFrameNumber').value = G.frame;
  request(G.frame);
}
function setFrameRange() { $('#genFrame').max = frameMaxOf(G.S); $('#genFrameNumber').max = frameMaxOf(G.S); }

// ------------------------------------------------------------------ the modifiers dropdown
function buildControls(root) {
  root.innerHTML = '';
  const presets = document.createElement('label'); presets.className = 'gen-preset';
  presets.innerHTML = `<span>Animation</span><select id="genPreset"></select>`;
  root.appendChild(presets);
  for (const grp of SCHEMA) {
    const d = document.createElement('details'); d.open = !!grp.open; d.dataset.when = grp.when || '';
    d.innerHTML = `<summary>${grp.name}</summary>`;
    for (const f of grp.fields) d.appendChild(fieldEl(f));
    root.appendChild(d);
  }
  const look = document.createElement('div'); look.id = 'genLook'; root.appendChild(look);      // the viewer's Look section goes here
  const foot = document.createElement('div'); foot.className = 'gen-foot';
  foot.innerHTML = `<button type="button" class="btn quiet" id="genReset">Reset to the Blender scene</button>`;
  root.appendChild(foot);
  $('#genPreset').addEventListener('change', e => { const a = animations.get(e.target.value); if (a) applySettings(withDefaults(JSON.parse(JSON.stringify(a.settings)))); });
  $('#genReset').addEventListener('click', () => applySettings(withDefaults(SCENE)));
  fillPresets(); refreshControls();
}
function fillPresets() {
  const sel = $('#genPreset'); if (!sel) return;
  const cur = JSON.stringify(G.S);
  const list = animations.list();
  sel.innerHTML = list.map(a => `<option value="${a.id}">${a.name}</option>`).join('') + '<option value="custom">Custom · unsaved changes</option>';
  const match = list.find(a => JSON.stringify(a.settings) === cur);
  sel.value = match ? match.id : 'custom';
}
function fieldEl(f) {
  const lab = document.createElement('label'); lab.className = 'gen-field'; lab.dataset.field = f.k;
  if (f.type === 'select') lab.innerHTML = `<span>${f.label}</span><select data-k="${f.k}">${f.options.map(([val, txt]) => `<option value="${val}">${txt}</option>`).join('')}</select>`;
  else if (f.type === 'check') lab.innerHTML = `<input type="checkbox" data-k="${f.k}"> <span>${f.label}</span>`;
  else if (f.type === 'vec3') lab.innerHTML = `<span>${f.label}</span><span class="vec3">${[0, 1, 2].map(i => `<input type="number" data-k="${f.k}.${i}" step="${f.step}" aria-label="${f.label} ${'XYZ'[i]}">`).join('')}</span>`;
  else if (f.type === 'number') lab.innerHTML = `<span>${f.label}</span><input type="number" data-k="${f.k}" min="${f.min}" max="${f.max}" step="${f.step}">`;
  else lab.innerHTML = `<span>${f.label}</span><span class="rangeRow"><input type="range" data-k="${f.k}" min="${f.min}" max="${f.max}" step="${f.step}"><output class="num"></output></span>`;
  if (f.hint) lab.title = f.hint;
  lab.querySelectorAll('[data-k]').forEach(inp => {
    const path = inp.dataset.k;
    const apply = () => {
      let val = inp.type === 'checkbox' ? inp.checked : inp.tagName === 'SELECT' ? inp.value : +inp.value;
      if (path === 'keyed.axis') val = +val;
      if (typeof val === 'number' && !isFinite(val)) return;
      if (inp.type === 'number' && inp.min !== '') val = clamp(val, +inp.min, +inp.max);
      if (path.startsWith('dims.')) val = Math.round(val);
      set(G.S, path, val);
      const out = inp.parentElement.querySelector('output'); if (out) out.textContent = fmtVal(val);
      if (path === 'pattern') refreshControls();
      if (path === 'loopLength' || path.startsWith('keyed.')) { setFrameRange(); G.frame = clamp(G.frame, 1, frameMaxOf(G.S)); $('#genFrame').value = G.frame; $('#genFrameNumber').value = G.frame; }
      fillPresets(); saveSettings(); request(G.frame); notify();
    };
    inp.addEventListener('input', apply);
    if (inp.type === 'number' || inp.tagName === 'SELECT') inp.addEventListener('change', apply);
  });
  return lab;
}
function refreshControls() {
  document.querySelectorAll('#genMods [data-k]').forEach(inp => {
    const v = get(G.S, inp.dataset.k);
    if (inp.type === 'checkbox') inp.checked = !!v; else inp.value = v;
    const out = inp.parentElement.querySelector('output'); if (out) out.textContent = fmtVal(v);
  });
  document.querySelectorAll('#genMods details[data-when]').forEach(d => { const w = d.dataset.when; d.hidden = !!w && w !== G.S.pattern; });
}
function applySettings(S) {
  G.S = S; refreshControls(); fillPresets();
  setFrameRange(); G.frame = clamp(G.frame, 1, frameMaxOf(G.S)); $('#genFrame').value = G.frame; $('#genFrameNumber').value = G.frame;
  saveSettings(); request(G.frame); notify();
}
function saveSettings() { try { localStorage.setItem('protospace.generator', JSON.stringify({ v: 2, S: G.S, frame: G.frame })); } catch (e) {} }
function loadSettings() { try { const j = JSON.parse(localStorage.getItem('protospace.generator') || 'null'); if (j && j.S && j.v === 2) { G.S = withDefaults(j.S); G.frame = clamp(+j.frame || 1, 1, 100000); return true; } } catch (e) {} return false; }

// ------------------------------------------------------------------ exports
function download(blob, name) { const u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 4000); }
function downloadBlenderSettings() {
  const S = G.S, menu = { noise: 0, voronoi: 1 }, metric = { euclidean: 0, manhattan: 1, chebychev: 2 };
  const V = [
    ['Pattern', 'Pattern', menu[S.pattern]], ['Pattern', 'Scale', S.scale], ['Pattern', 'Offset', S.offset], ['Pattern', 'Invert', S.invert],
    ['Motion', 'Animate', S.animate], ['Motion', 'Loop Length', S.loopLength], ['Motion', 'Travel', S.travel], ['Motion', 'Frame Offset', S.frameOffset],
    ['Growth', 'Grow From', S.growFrom], ['Growth', 'Full Size At', S.fullSizeAt], ['Growth', 'Smallest Cube', S.smallest], ['Growth', 'Largest Cube', S.largest], ['Growth', 'Size Steps', S.sizeSteps],
    ['Cubes', 'Cube Size', S.cubeSize], ['Cubes', 'Bevel', S.bevel], ['Slab', 'Point Spacing', S.spacing],
    ['Noise', 'Detail', S.noise.detail], ['Noise', 'Roughness', S.noise.roughness], ['Noise', 'Lacunarity', S.noise.lacunarity], ['Noise', 'Distortion', S.noise.distortion],
    ['Voronoi', 'Metric', metric[S.voronoi.metric]], ['Voronoi', 'Randomness', S.voronoi.randomness], ['Voronoi', 'W', S.voronoi.w], ['Voronoi', 'Detail', S.voronoi.detail],
  ];
  const py = `# ProtoSpace Analyzer — apply these generator settings to the "ProtoSpace Voxel Controls" modifier.
# Blender: Scripting workspace → Python console → exec(open("/path/to/this/file.py").read())
import bpy
VALUES = ${JSON.stringify(V.map(([p, n, v]) => [p, n, v]), null, 0).replace(/true/g, 'True').replace(/false/g, 'False')}
ob = next(o for o in bpy.data.objects if any(m.type == "NODES" and m.node_group and "Voxel" in m.node_group.name for m in o.modifiers))
mod = next(m for m in ob.modifiers if m.type == "NODES" and m.node_group and "Voxel" in m.node_group.name)
items = [it for it in mod.node_group.interface.items_tree if getattr(it, "item_type", "") == "SOCKET" and it.in_out == "INPUT"]
done = 0
for panel, name, value in VALUES:
    for it in items:
        if it.name == name and (it.parent.name if it.parent else "") == panel:
            try:
                g = mod.properties.inputs[it.identifier]
                g["value"] = list(value) if isinstance(value, list) else value
                done += 1
            except Exception as exc:
                print("ProtoSpace: could not set", panel, name, exc)
KEYED = ${S.keyed && S.keyed.enabled ? JSON.stringify([S.keyed.axis, S.keyed.f0, S.keyed.v0, S.keyed.f1, S.keyed.v1]) : 'None'}
if KEYED:
    axis, f0, v0, f1, v1 = KEYED
    off = next(it for it in items if it.name == "Offset" and (it.parent.name if it.parent else "") == "Pattern")
    path = f'modifiers["{mod.name}"].properties.inputs.{off.identifier}.value'
    for frame, value in ((f0, v0), (f1, v1)):
        vec = list(mod.properties.inputs[off.identifier]["value"]); vec[axis] = value
        mod.properties.inputs[off.identifier]["value"] = vec
        ob.keyframe_insert(data_path=path, index=axis, frame=frame)
ob.update_tag(); bpy.context.view_layer.update()
bpy.context.scene.frame_set(${G.frame})
print(f"ProtoSpace: set {done} of {len(VALUES)} inputs on {ob.name} ▸ {mod.name}; frame ${G.frame}")
`;
  download(new Blob([py], { type: 'text/x-python' }), 'protospace_generator_settings.py');
}

// ------------------------------------------------------------------ mount
const OVERLAYS = `
  <div class="gen-top">
    <div class="gen-dd">
      <button type="button" class="btn gen-ddbtn" id="genModBtn" aria-expanded="false" aria-controls="genMods">Modifiers ▾</button>
      <div class="gen-ddpanel" id="genMods" hidden></div>
    </div>
  </div>
  <div class="gen-timeline">
    <button type="button" class="btn" id="genPlay" aria-label="Play">▶</button>
    <button type="button" class="btn quiet" id="genPrev" aria-label="Previous frame">‹</button>
    <button type="button" class="btn quiet" id="genNext" aria-label="Next frame">›</button>
    <input id="genFrame" type="range" min="1" max="250" step="1" value="1" aria-label="Frame">
    <input id="genFrameNumber" type="number" min="1" max="250" value="1" class="num" aria-label="Frame number">
    <output id="genFrameOut" class="num"></output>
    <select id="genFps" aria-label="Frames per second"><option value="6">6 fps</option><option value="12">12 fps</option><option value="24" selected>24 fps</option></select>
  </div>`;

export function mount(hooks) {
  G.hooks = hooks;
  const root = $('#genViewer');
  loadSettings();
  // the viewer, with its Look section rendered later into the dropdown
  const pre = document.createElement('div');                                 // temporary host for the sections until the dropdown exists
  G.viewer = createViewer(root, { panel: 'none', overlay: true, sections: ['look'], panelEl: pre, emptyText: 'Generating the first frame…', ratio: 0.56 });
  const viewport = G.viewer.V('viewport');
  viewport.insertAdjacentHTML('beforeend', OVERLAYS);
  buildControls($('#genMods'));
  $('#genLook').appendChild(pre);                                             // the viewer's Look section lives in the dropdown
  // dropdown
  const btn = $('#genModBtn'), panel = $('#genMods');
  const openDD = on => { panel.hidden = !on; btn.setAttribute('aria-expanded', String(on)); btn.textContent = on ? 'Modifiers ▴' : 'Modifiers ▾'; };
  btn.addEventListener('click', () => openDD(panel.hidden));
  new ResizeObserver(() => { panel.style.setProperty('--dd-max', Math.max(200, viewport.clientHeight - 112) + 'px'); }).observe(viewport);
  document.addEventListener('pointerdown', e => { if (!panel.hidden && !e.target.closest('.gen-dd')) openDD(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) openDD(false); });
  // timeline
  G.frame = clamp(G.frame, 1, frameMaxOf(G.S));
  setFrameRange(); $('#genFrame').value = G.frame; $('#genFrameNumber').value = G.frame;
  $('#genFrame').addEventListener('input', e => { play(false); setFrame(+e.target.value, true); saveSettings(); });
  $('#genFrameNumber').addEventListener('change', e => { play(false); setFrame(+e.target.value); saveSettings(); });
  $('#genPlay').addEventListener('click', () => play(!G.playing));
  $('#genPrev').addEventListener('click', () => { play(false); setFrame(G.frame - 1); });
  $('#genNext').addEventListener('click', () => { play(false); setFrame(G.frame + 1); });
  $('#genFps').addEventListener('change', e => { G.fps = +e.target.value; });
  // buttons below the rectangle
  $('#genAnalyze').addEventListener('click', () => { play(false); hooks.onAnalyzeFrame(withDefaults(JSON.parse(JSON.stringify(G.S))), G.frameShown || G.frame); });
  $('#genSave').addEventListener('click', () => { const row = $('#genSaveRow'); row.hidden = !row.hidden; if (!row.hidden) { $('#genSaveName').value = ''; $('#genSaveName').focus(); } });
  const doSave = () => { const a = animations.save($('#genSaveName').value, G.S); $('#genSaveRow').hidden = true; fillPresets(); status(`Saved “${a.name}” — pick it in Analyze or in the Modifiers list.`); };
  $('#genSaveOk').addEventListener('click', doSave);
  $('#genSaveName').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSave(); } if (e.key === 'Escape') $('#genSaveRow').hidden = true; });
  $('#genSaveCancel').addEventListener('click', () => { $('#genSaveRow').hidden = true; });
  $('#genPng').addEventListener('click', () => G.viewer.snapshot());
  $('#genVideo').addEventListener('click', () => G.viewer.recordTurn());
  $('#genPy').addEventListener('click', downloadBlenderSettings);
  listeners.push(fillPresets);
  request(G.frame);
}

export const PSGen = {
  mount,
  generate: (settings, frame) => sidePool.generate(settings, frame),
  camera: cameraFor, frameMax: frameMaxOf, threshold,
  current: () => ({ settings: withDefaults(JSON.parse(JSON.stringify(G.S))), frame: G.frameShown || G.frame }),
  load: S => { applySettings(withDefaults(JSON.parse(JSON.stringify(S)))); },
  setFrame: f => { play(false); setFrame(f); },
  animations,
  onChange: fn => listeners.push(fn),
  DEFAULTS,
};

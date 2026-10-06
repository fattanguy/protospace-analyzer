/* ProtoSpace Analyzer — the page: three tabs.
   Generator  the Blender voxel animation live in the browser (js/generator.js)
   Analyze    pick an animation and a frame → the twelve ratings, in plain words, with the drawing behind them
   3D model   the same frame as a model you can orbit, crop with a movable box, cut and export (js/viewer.js)
   The ratings come from js/analyzer.js + js/rubric.js (classic scripts), read from the generated cube lattice. */

import { PSGen } from './generator.js';
import { createViewer } from './viewer.js';
import { bayBoxes, measureBay, programScores, highlightCells, HIGHLIGHTS, PROGRAMS, PROGRAM_KEYS, MEASURE_NAMES } from './program.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const WORDS = PSA.WORDS;
const CELL = 12;                                                             // screen pixels per cube in the drawing
const THR = PSGen.threshold(255);

// what each descriptor asks, in plain words
const SIMPLE = {
  'Modular': 'Is it built from repeating pieces of the same size?',
  'Fragmented': 'Does it break into separate chunks instead of one big block?',
  'Interlocking': 'Do the pieces overlap and hook into each other?',
  'Porous': 'Are there plenty of holes and openings to see and walk through?',
  'Clustered': 'Do the pieces gather into little groups?',
  'Decentralized': 'Are the shared spaces spread around, not just in one spot?',
  'Networked': 'Are there many ways to get from one place to another?',
  'Layered': 'Do different kinds of space stack on top of each other?',
  'Intimate': 'Are there small, cosy places for a few people?',
  'Visually Connected': 'Can people see each other from place to place?',
  'Socially Interactive': 'Do paths pass by shared spaces where people can meet?',
  'Village-Like': 'Does it feel like a small village: groups, streets and squares?',
};

// ------------------------------------------------------------------ cube lattice → the elevation the analyzer reads
const TONE_OF_DEPTH = [[0, 0.02], [3, 0.09], [8.5, 0.20], [18, 0.40], [26, 0.70]];
function toneOfDepth(d) {
  if (d <= 0) return 0.02;
  for (let i = 1; i < TONE_OF_DEPTH.length; i++) { const [d0, t0] = TONE_OF_DEPTH[i - 1], [d1, t1] = TONE_OF_DEPTH[i]; if (d <= d1) return t0 + (t1 - t0) * (d - d0) / (d1 - d0); }
  return 0.70;
}
/* Every column of the slab (or of a box of it) at the tone of its first solid cube. */
function voxGrid(vox, thr, box) {
  const { nx, ny, nz, sizes } = vox;
  const b = box || { x0: 0, x1: nx, y0: 0, y1: ny, z0: 0, z1: nz };
  const cols = b.x1 - b.x0, rows = b.y1 - b.y0;
  const tone = new Float32Array(cols * rows), band = new Uint8Array(cols * rows), depth = new Int16Array(cols * rows).fill(-1);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = b.x0 + c, y = b.y0 + r;
    let z0 = -1; for (let z = b.z0; z < b.z1; z++) if (sizes[x + nx * (y + ny * z)] >= thr) { z0 = z - b.z0; break; }
    const i = r * cols + c; depth[i] = z0;
    if (z0 < 0) { tone[i] = 1; band[i] = 4; } else { tone[i] = toneOfDepth(z0); band[i] = z0 < 3 ? 0 : z0 < 9 ? 1 : z0 < 19 ? 2 : 3; }
  }
  return { cols, rows, tone, band, depth, pitch: CELL, px: 0, py: 0, invert: false, w: cols * CELL, h: rows * CELL };
}
function analyzeVox(vox, thr, box) { const grid = voxGrid(vox, thr, box); return { grid, result: PSA.analyze(grid) }; }
// ------------------------------------------------------------------ state
const A = { animId: 'current', frame: 61, item: null, word: 'Modular', win: null, depth: false, token: 0, dirty: false, tab: 'generator', model: null, anv: null, boxTimer: null,
  bay: null, hl: 'none', progDepth: false, progWord: 'Modular', pv: null, scan: null };
// the five bays of a frame (the same ones the Program tab rates): equal parts across the slab, the full height and depth
function winBox(vox, i) { if (i == null) return null; const b = bayBoxes(vox)[i]; return b ? { x0: b.x0, x1: b.x1, y0: 0, y1: vox.ny, z0: 0, z1: vox.nz } : null; }
function winLabel(vox, i) { return i == null ? 'the whole frame' : `bay ${i + 1}`; }

function animationsList() { return [{ id: 'current', name: 'Generator · what is on screen now', builtin: true }, ...PSGen.animations.list()]; }
function settingsOf(id) { if (id === 'current') return PSGen.current().settings; const a = PSGen.animations.get(id); return a ? a.settings : null; }
function animName(id) { const a = animationsList().find(a => a.id === id); return a ? a.name : 'Animation'; }

// ------------------------------------------------------------------ the pickers (one in Analyze, one in 3D model, kept in step)
function fillPickers() {
  const list = animationsList();
  for (const sel of $$('.pick-anim')) {
    sel.innerHTML = list.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
    sel.value = list.some(a => a.id === A.animId) ? A.animId : 'current';
  }
  if (!list.some(a => a.id === A.animId)) A.animId = 'current';
  const S = settingsOf(A.animId), max = S ? PSGen.frameMax(S) : 250;
  A.frame = Math.max(1, Math.min(max, A.frame));
  for (const r of $$('.pick-frame')) { r.max = max; r.value = A.frame; }
  for (const n of $$('.pick-frameNumber')) { n.max = max; n.value = A.frame; }
  for (const o of $$('.pick-frameOut')) o.textContent = `${A.frame} / ${max}`;
  const a = PSGen.animations.get(A.animId);
  for (const b of $$('.pick-delete')) { b.hidden = !(a && !a.builtin); b.textContent = 'Delete'; b.dataset.armed = ''; }
}
function wirePicker(root) {
  const sel = $('.pick-anim', root), range = $('.pick-frame', root), num = $('.pick-frameNumber', root);
  sel.addEventListener('change', () => { A.animId = sel.value; fillPickers(); loadFrame(); });
  let t = null;
  range.addEventListener('input', () => { A.frame = +range.value; for (const o of $$('.pick-frameOut')) o.textContent = `${A.frame} / ${range.max}`; for (const n of $$('.pick-frameNumber')) n.value = A.frame; for (const r of $$('.pick-frame')) r.value = A.frame; clearTimeout(t); t = setTimeout(loadFrame, 90); });
  num.addEventListener('change', () => { A.frame = +num.value; fillPickers(); loadFrame(); });
  $('.pick-prev', root).addEventListener('click', () => { A.frame -= 1; fillPickers(); loadFrame(); });
  $('.pick-next', root).addEventListener('click', () => { A.frame += 1; fillPickers(); loadFrame(); });
  $('.pick-open', root).addEventListener('click', () => { const S = settingsOf(A.animId); if (S && A.animId !== 'current') PSGen.load(S); PSGen.setFrame(A.frame); showTab('generator'); });
  $('.pick-delete', root).addEventListener('click', e => {
    const b = e.currentTarget;
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Really delete?'; setTimeout(() => { if (b.dataset.armed === '1') { b.dataset.armed = ''; b.textContent = 'Delete'; } }, 4000); return; }
    PSGen.animations.remove(A.animId); A.animId = 'current'; fillPickers(); loadFrame();
  });
}

// ------------------------------------------------------------------ load the picked frame
async function loadFrame() {
  const S = settingsOf(A.animId); if (!S) return;
  const token = ++A.token, frame = A.frame;
  A.dirty = false;
  setStatus('Generating the frame…');
  const sizes = await PSGen.generate(S, frame);
  if (!sizes || token !== A.token) return;
  const [nx, ny, nz] = S.dims;
  const vox = { nx, ny, nz, sizes, max: 255, threshold: THR };
  let solid = 0; for (let i = 0; i < sizes.length; i++) if (sizes[i] >= THR) solid++;
  A.item = { name: `${animName(A.animId)} · frame ${frame}`, animId: A.animId, frame, settings: S, vox, solid, camera: PSGen.camera(S) };
  if (A.win != null && !winBox(vox, A.win)) A.win = null;
  rateWindow();
}
/* Rate the chosen part of the frame (a quadrant or the whole frame) and show it everywhere. */
function rateWindow() {
  const it = A.item; if (!it) return;
  const box = winBox(it.vox, A.win);
  const { grid, result } = analyzeVox(it.vox, THR, box);
  Object.assign(it, { box, grid, result, R: { x0: 0, y0: 0, x1: grid.cols * CELL, y1: grid.rows * CELL }, reviews: {} });
  renderQuads();
  renderAll();
}
function setStatus(t, tModel) { $$('.pick-status').forEach(el => { el.textContent = tModel != null && el.closest('.tab[data-tab=model]') ? tModel : t; }); }

// ------------------------------------------------------------------ render
function renderAll() {
  const it = A.item; if (!it) return;
  const base = `${it.name} · ${it.vox.nx} × ${it.vox.ny} m slab, ${it.vox.nz} m deep · ${it.solid.toLocaleString('en-US')} solid cubes`;
  setStatus(`${base} · rating ${winLabel(it.vox, A.win)}`, base);
  renderRatings(it); renderWhy(it); drawView(it);
  const src = { name: it.name, frame: it.frame, vox: it.vox, camera: it.camera, result: it.result };
  if (A.anv) A.anv.setSource(src, it.box ? Object.assign({ outline: true }, it.box) : null);
  if (A.model) { A.model.setSource(src); rateBox(A.model.box); }
  it.bays = null; if (A.tab === 'program') renderProgram();
}
function renderQuads() {
  const el = $('#quadButtons'), it = A.item; if (!el || !it) return;
  const boxes = bayBoxes(it.vox), items = [['', 'Whole frame', 'Rate the whole frame'], ...boxes.map(b => [String(b.i), `Bay ${b.i + 1}`, `Rate bay ${b.i + 1} · ${b.x0}–${b.x1} m along the slab`])];
  el.innerHTML = items.map(([v, t, title]) => `<button type="button" data-win="${v}" class="btn quiet${(v === '' ? A.win == null : A.win === +v) ? ' on' : ''}" title="${title}">${t}</button>`).join('');
  el.querySelectorAll('button').forEach(b => b.onclick = () => { A.win = b.dataset.win === '' ? null : +b.dataset.win; rateWindow(); });
}
function renderRatings(item) {
  const list = $('#ratings'); list.innerHTML = '';
  WORDS.forEach((word, i) => {
    const v = item.result.ratings[word], on = word === A.word;
    const row = document.createElement('button'); row.type = 'button'; row.className = 'row' + (on ? ' on' : ''); row.dataset.word = word;
    row.setAttribute('aria-pressed', on ? 'true' : 'false');
    row.innerHTML = `<span class="ab">${String(i + 1).padStart(2, '0')}</span><span class="wd">${word}</span><span class="m"><span class="track"><span class="bar" style="width:${v ?? 0}%"></span></span><span class="num">${v == null ? '—' : v}</span></span>`;
    row.onclick = () => { A.word = word; renderRatings(item); renderWhy(item); drawView(item); };
    list.appendChild(row);
  });
}
function renderWhy(item) {
  const w = A.word, i = WORDS.indexOf(w), ex = item.result.explain[w], score = item.result.ratings[w];
  $('#whyTitle').textContent = `${String(i + 1).padStart(2, '0')}  ${w}`;
  $('#whySimple').textContent = SIMPLE[w];
  $('#whyScore').textContent = score == null ? '—' : score;
  $('#whyLabel').textContent = PSARubric.label(score);
  $('#whyText').textContent = item.result.features.empty ? 'There is too little mass in this frame to rate it. Try another frame or raise the mass in the Generator.' : (ex.text || '');
  $('#whyAdvice').textContent = ex.advice || '';
  $('#whyAdvice').parentElement.hidden = !ex.advice;
  const terms = $('#whyTerms'); terms.innerHTML = '';
  (ex.terms || []).forEach(t => {
    const li = document.createElement('li');
    li.innerHTML = `<div class="tname">${t.name}</div><div class="tval">${t.value}</div><div class="tbar"><span style="width:${Math.round(100 * t.norm)}%"></span></div><div class="tnote">${t.note.split(' Normalization:')[0]} · counts for ${t.weight}% of the score</div>`;
    terms.appendChild(li);
  });
  $('#whyLimit').textContent = PSARubric.definitions[w].limit;
  renderReview(item);
}

// ---- the full assessment (rubric v3): automatic interpretation, editable, with the combined score
function reviewFor(item, word) { item.reviews ||= {}; return item.reviews[word] ||= PSARubric.generate(item.result, word); }
function updateReviewSummary(item) {
  const result = PSARubric.summarize(item.result.ratings[A.word], reviewFor(item, A.word));
  $('#qualScore').textContent = result.qualitative == null ? 'Not assessable' : result.qualitative.toFixed(1) + ' / 100';
  $('#combinedScore').textContent = result.combined == null ? '—' : result.combined + ' / 100';
  $('#combinedLabel').textContent = result.combined == null ? 'Insufficient evidence for a combined score.' : PSARubric.label(result.combined) + ' · 70% measured + 30% interpreted';
  const body = $('#reviewOverview'); body.replaceChildren();
  WORDS.forEach(word => {
    const s = PSARubric.summarize(item.result.ratings[word], reviewFor(item, word));
    const tr = document.createElement('tr');
    [word, s.quantitative ?? 'N/A', s.qualitative == null ? 'N/A' : s.qualitative.toFixed(1), s.combined ?? '—'].forEach(value => { const td = document.createElement('td'); td.textContent = value; tr.appendChild(td); });
    body.appendChild(tr);
  });
}
function renderReview(item) {
  const word = A.word, definition = PSARubric.definitions[word], review = reviewFor(item, word);
  $('#reviewHeading').textContent = word + ' · full assessment';
  $('#reviewIntent').textContent = definition.intent;
  const form = $('#qualQuestions'); form.replaceChildren();
  definition.questions.forEach((q, index) => {
    const field = document.createElement('fieldset');
    const legend = document.createElement('legend'); legend.textContent = q[0]; field.appendChild(legend);
    const anchors = document.createElement('p'); anchors.className = 'hint'; anchors.textContent = '0 — ' + q[1] + '  4 — ' + q[2]; field.appendChild(anchors);
    const rule = review.rules?.[index];
    if (rule) { const detail = document.createElement('p'); detail.className = 'hint'; detail.textContent = 'Automatic rule: ' + rule.operation + ' of [' + rule.metrics.map(m => m.name + ' ' + m.normalized.toFixed(2)).join(', ') + '] = ' + rule.strength.toFixed(2) + ' → ' + rule.judgment + '/4.'; field.appendChild(detail); }
    const label = document.createElement('label'); label.textContent = 'Interpretation (editable) '; const select = document.createElement('select'); select.setAttribute('aria-label', q[0]);
    [['', 'Insufficient evidence'], ['0', '0 · Absent or contradicted'], ['1', '1 · Weak / isolated evidence'], ['2', '2 · Partial / mixed evidence'], ['3', '3 · Clear in most of the region'], ['4', '4 · Strong and consistent evidence']].forEach(([value, text]) => { const option = document.createElement('option'); option.value = value; option.textContent = text; select.appendChild(option); });
    select.value = review.values[index] ?? ''; select.onchange = () => { review.values[index] = select.value === '' ? null : Number(select.value); review.source = 'manual override'; updateReviewSummary(item); }; label.appendChild(select); field.appendChild(label); form.appendChild(field);
  });
  $('#reviewEvidence').value = review.evidence;
  $('#reviewEvidence').oninput = e => { review.evidence = e.target.value; review.source = 'manual override'; updateReviewSummary(item); };
  $('#reviewReset').onclick = () => { item.reviews[word] = PSARubric.generate(item.result, word); renderReview(item); };
  $('#reviewExport').onclick = () => {
    const report = { rubricVersion: PSARubric.version, createdAt: new Date().toISOString(), frame: item.name, animation: animName(item.animId), frameNumber: item.frame, settings: item.settings, method: 'Quantitative = sum(weight × normalized metric). Qualitative = mean of two automatic rule-based 0–4 interpretations × 25; manual edits are identified in the review source. Combined = 70% quantitative + 30% qualitative. Project rubric, not a validated universal standard.', descriptors: WORDS.map(w => ({ descriptor: w, intent: PSARubric.definitions[w].intent, limitations: PSARubric.definitions[w].limit, metrics: item.result.explain[w].terms, questions: PSARubric.definitions[w].questions, review: item.reviews[w] || null, ...PSARubric.summarize(item.result.ratings[w], item.reviews[w]) })) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'ProtoSpace-assessment.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  updateReviewSummary(item);
}

// ------------------------------------------------------------------ the drawing: elevation or depth map, with the reading behind the selected descriptor
function hatchPattern(ctx, color, angle, spacing) {
  const c = document.createElement('canvas'); c.width = c.height = spacing;
  const x = c.getContext('2d'); x.strokeStyle = color; x.lineWidth = 1.4;
  x.beginPath();
  if (angle === 45) { x.moveTo(0, spacing); x.lineTo(spacing, 0); x.moveTo(-1, 1); x.lineTo(1, -1); x.moveTo(spacing - 1, spacing + 1); x.lineTo(spacing + 1, spacing - 1); }
  else { x.moveTo(0, 0); x.lineTo(spacing, spacing); x.moveTo(spacing - 1, -1); x.lineTo(spacing + 1, 1); x.moveTo(-1, spacing - 1); x.lineTo(1, spacing + 1); }
  x.stroke();
  return ctx.createPattern(c, 'repeat');
}
let INK = '#111';                                                              // the overlay colour (red in the Program tab)
function drawView(item) { if (A.depth) drawDiagram($('#view'), item.grid, item.result, A.word, '#111'); }
function drawDiagram(cv, G, res, word, ink) {
  const R = { x0: 0, y0: 0, x1: G.cols * CELL, y1: G.rows * CELL };
  if (!cv.parentElement.clientWidth) return;                                   // hidden
  INK = ink;
  const maxW = cv.parentElement.clientWidth || 900;
  const rw = R.x1 - R.x0, rh = R.y1 - R.y0;
  const k = Math.min(maxW / rw, 620 / rh, 22 / CELL);
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(rw * k * dpr); cv.height = Math.round(rh * k * dpr);
  cv.style.width = Math.round(rw * k) + 'px'; cv.style.height = Math.round(rh * k) + 'px';
  const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cell = G.pitch * k;                                                    // one metre on screen
  const cx = c => G.px * k + c * cell, cy = r => G.py * k + (G.rows - 1 - r) * cell;
  x.fillStyle = '#fff'; x.fillRect(0, 0, rw * k, rh * k);
  for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) {
    const b = G.band[r * G.cols + c]; const t = PSA.BAND_TONES[b];
    x.fillStyle = `rgb(${t},${t},${t})`; x.fillRect(cx(c), cy(r), cell + 0.5, cell + 0.5);
  }
  if (!res.features.empty) {
    const hp = hatchPattern(x, 'rgba(30,30,30,0.9)', 45, 7);
    res.features.pockets.forEach(p => { x.fillStyle = 'rgba(238,238,238,0.85)'; p.cells.forEach(([c, r]) => x.fillRect(cx(c), cy(r), cell + 0.5, cell + 0.5)); x.fillStyle = hp; p.cells.forEach(([c, r]) => x.fillRect(cx(c), cy(r), cell + 0.5, cell + 0.5)); });
    const E = res.features.envelope, Mo = res.features.modules;
    x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 1;
    for (let m = 0; m <= Mo.nm; m++) { const X = cx(Mo.mo + m * 9); x.beginPath(); x.moveTo(X, cy(E.rmax)); x.lineTo(X, cy(E.r0) + cell); x.stroke(); }
    for (let f = 0; f <= Mo.nf; f++) { const Y = cy(E.r0 + f * 3) + cell; x.beginPath(); x.moveTo(cx(E.cmin), Y); x.lineTo(cx(E.cmax) + cell, Y); x.stroke(); }
    drawOverlay(x, { grid: G, result: res }, word, cell, cx, cy);
  }
}
// double stroke so the overlay reads over black cubes and white void alike
function dline(x, pts, w = 2, close = false) {
  x.beginPath(); pts.forEach((p, i) => i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); if (close) x.closePath();
  x.lineWidth = w + 3; x.strokeStyle = 'rgba(255,255,255,0.95)'; x.stroke();
  x.lineWidth = w; x.strokeStyle = INK; x.stroke();
}
function label(x, X, Y, text, size = 12) {
  x.font = `600 ${size}px Poppins, system-ui, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
  const w = x.measureText(text).width + 10;
  x.fillStyle = 'rgba(255,255,255,0.92)'; x.fillRect(X - w / 2, Y - size * 0.75, w, size * 1.5);
  x.strokeStyle = INK; x.lineWidth = 1; x.strokeRect(X - w / 2, Y - size * 0.75, w, size * 1.5);
  x.fillStyle = INK; x.fillText(text, X, Y + 0.5);
}
function cellOutline(x, cells, cell, cx, cy, w = 2) {
  const set = new Set(cells.map(([c, r]) => c + ',' + r));
  const segs = [];
  cells.forEach(([c, r]) => {
    const X = cx(c), Y = cy(r);
    if (!set.has((c - 1) + ',' + r)) segs.push([[X, Y], [X, Y + cell]]);
    if (!set.has((c + 1) + ',' + r)) segs.push([[X + cell, Y], [X + cell, Y + cell]]);
    if (!set.has(c + ',' + (r + 1))) segs.push([[X, Y], [X + cell, Y]]);
    if (!set.has(c + ',' + (r - 1))) segs.push([[X, Y + cell], [X + cell, Y + cell]]);
  });
  x.lineCap = 'square';
  segs.forEach(s => dline(x, s, w));
}
function moduleCells(mo, r0, m, f) { const out = []; for (let dc = 0; dc < 9; dc++) for (let dr = 0; dr < 3; dr++) out.push([mo + m * 9 + dc, r0 + f * 3 + dr]); return out; }
function drawOverlay(x, item, w, cell, cx, cy) {
  const F = item.result.features, Mo = F.modules, E = F.envelope;
  const mc = (m, f) => [cx(Mo.mo + m * 9) + 4.5 * cell, cy(E.r0 + f * 3) - 0.5 * cell + cell];
  const hp = hatchPattern(x, INK === '#111' ? 'rgba(20,20,20,0.85)' : 'rgba(198,40,40,0.85)', 45, 7), hp2 = hatchPattern(x, INK === '#111' ? 'rgba(20,20,20,0.6)' : 'rgba(198,40,40,0.6)', 135, 7);
  const fillCells = (cells, style) => { x.fillStyle = style; cells.forEach(([c, r]) => x.fillRect(cx(c), cy(r), cell + 0.5, cell + 0.5)); };
  const pale = (cells) => fillCells(cells, 'rgba(255,255,255,0.55)');
  switch (w) {
    case 'Modular': {
      for (let m = 0; m < Mo.nm; m++) for (let f = 0; f < Mo.nf; f++) {
        const fl = Mo.fill[f * Mo.nm + m], X = cx(Mo.mo + m * 9), Y = cy(E.r0 + f * 3 + 2);
        if (fl >= 0.7) dline(x, [[X, Y], [X + 9 * cell, Y], [X + 9 * cell, Y + 3 * cell], [X, Y + 3 * cell]], 2.5, true);
        else if (fl <= 0.3) { x.save(); x.setLineDash([5, 4]); dline(x, [[X, Y], [X + 9 * cell, Y], [X + 9 * cell, Y + 3 * cell], [X, Y + 3 * cell]], 1.2, true); x.restore(); }
        else { pale(moduleCells(Mo.mo, E.r0, m, f)); fillCells(moduleCells(Mo.mo, E.r0, m, f), hp2); }
      }
      break;
    }
    case 'Fragmented': {
      F.islandList.forEach((k, i) => { cellOutline(x, k.cells, cell, cx, cy, 2); const [sc, sr] = k.cells.reduce((a, c) => [a[0] + c[0], a[1] + c[1]], [0, 0]); label(x, cx(sc / k.size) + cell / 2, cy(sr / k.size) + cell / 2, `${i + 1} · ${k.size} m²`); });
      break;
    }
    case 'Interlocking': {
      F.connections.forEach(cn => { const a = mc(...cn.a), b = mc(...cn.b); dline(x, [a, b], cn.lock ? 3.5 : 1.5); if (cn.lock) { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; x.fillStyle = '#fff'; x.fillRect(m[0] - 5, m[1] - 5, 10, 10); x.strokeStyle = INK; x.lineWidth = 2; x.strokeRect(m[0] - 5, m[1] - 5, 10, 10); } });
      for (let m = 0; m < Mo.nm; m++) for (let f = 0; f < Mo.nf; f++) if (Mo.fill[f * Mo.nm + m] >= 0.5) { const p = mc(m, f); x.fillStyle = INK; x.beginPath(); x.arc(p[0], p[1], 4, 0, 7); x.fill(); x.strokeStyle = '#fff'; x.lineWidth = 1.5; x.stroke(); }
      break;
    }
    case 'Porous': {
      F.openings.forEach(k => { pale(k.cells); fillCells(k.cells, hp); cellOutline(x, k.cells, cell, cx, cy, 1.5); });
      const cells = []; for (let r = E.r0; r <= E.rmax; r++) for (let c = E.cmin; c <= E.cmax; c++) if (item.grid.band[r * item.grid.cols + c] === 2 || item.grid.band[r * item.grid.cols + c] === 3) cells.push([c, r]);
      fillCells(cells, hp2);
      dline(x, [[cx(E.cmin), cy(E.rmax)], [cx(E.cmax) + cell, cy(E.rmax)], [cx(E.cmax) + cell, cy(E.r0) + cell], [cx(E.cmin), cy(E.r0) + cell]], 1, true);
      break;
    }
    case 'Clustered': {
      F.moduleClusters.comps.forEach((k) => { const cells = []; k.cells.forEach(([m, f]) => cells.push(...moduleCells(Mo.mo, E.r0, m, f))); cellOutline(x, cells, cell, cx, cy, 2.5); const p = k.cells.reduce((a, c) => [a[0] + c[0], a[1] + c[1]], [0, 0]); const q = mc(p[0] / k.size, p[1] / k.size); label(x, q[0], q[1], `${k.size} module${k.size === 1 ? '' : 's'}`); });
      break;
    }
    case 'Decentralized': {
      F.pockets.forEach(k => { pale(k.cells); fillCells(k.cells, hp); cellOutline(x, k.cells, cell, cx, cy, 1.5); });
      F.distLines.forEach(l => { const a = [cx(l.from[0]), cy(l.from[1]) + cell], b = [cx(l.to[0]), cy(l.to[1]) + cell]; dline(x, [a, b], 1.2); x.fillStyle = INK; x.beginPath(); x.arc(a[0], a[1], 3.5, 0, 7); x.fill(); });
      break;
    }
    case 'Networked': {
      F.streets.forEach(s => dline(x, [[cx(s.c0), cy(s.r) + cell / 2], [cx(s.c1) + cell, cy(s.r) + cell / 2]], 5));
      F.links.forEach(s => dline(x, [[cx(s.c0), cy(s.r) + cell / 2], [cx(s.c1) + cell, cy(s.r) + cell / 2]], 2));
      F.perModuleConn.forEach(p => { const q = mc(p.m, p.f); label(x, q[0], q[1], String(p.k), 11); });
      break;
    }
    case 'Layered': {
      const CL = F.CL, G = item.grid, cells = {};
      for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) { const k = F.classes[r * G.cols + c]; if (k && k !== CL.WORK) (cells[k] = cells[k] || []).push([c, r]); }
      if (cells[CL.GATHER]) { pale(cells[CL.GATHER]); fillCells(cells[CL.GATHER], hp); }
      if (cells[CL.COVERED]) fillCells(cells[CL.COVERED], hp2);
      if (cells[CL.TERRACE]) fillCells(cells[CL.TERRACE], 'rgba(120,120,120,0.35)');
      if (cells[CL.OPEN]) cellOutline(x, cells[CL.OPEN], cell, cx, cy, 1);
      F.streets.forEach(s => dline(x, [[cx(s.c0), cy(s.r) + cell / 2], [cx(s.c1) + cell, cy(s.r) + cell / 2]], 5));
      F.links.forEach(s => dline(x, [[cx(s.c0), cy(s.r) + cell / 2], [cx(s.c1) + cell, cy(s.r) + cell / 2]], 2));
      F.perModuleFunc.forEach(p => { const q = mc(p.m, p.f); label(x, q[0], q[1], String(p.k), 11); });
      break;
    }
    case 'Intimate': {
      F.territories.forEach(tt => { cellOutline(x, tt.cells, cell, cx, cy, 1.5); const p = tt.cells.reduce((a, c) => [a[0] + c[0], a[1] + c[1]], [0, 0]); label(x, cx(p[0] / tt.cells.length) + cell / 2, cy(p[1] / tt.cells.length) + cell / 2, `${Math.round(tt.occupants)} p`, 11); });
      break;
    }
    case 'Visually Connected': {
      F.rays.forEach(r => { const a = [cx(r.from[0]) + cell / 2, cy(r.from[1]) + cell / 2], b = [cx(r.to[0]) + cell / 2, cy(r.to[1]) + cell / 2]; dline(x, [a, b], 1.5); x.fillStyle = '#fff'; x.strokeStyle = INK; x.lineWidth = 1.5; x.beginPath(); x.arc(b[0], b[1], 4, 0, 7); x.fill(); x.stroke(); });
      break;
    }
    case 'Socially Interactive': {
      F.pockets.forEach(k => { pale(k.cells); fillCells(k.cells, hp); cellOutline(x, k.cells, cell, cx, cy, 1.5); });
      F.streets.forEach(s => dline(x, [[cx(s.c0), cy(s.r) + cell / 2], [cx(s.c1) + cell, cy(s.r) + cell / 2]], 5));
      F.contacts.forEach(ct => { const s = ct.street, k = F.pockets.find(p => p.id === ct.pocket); if (!k) return; const near = k.cells.filter(([c, r]) => Math.abs(r - s.r) <= 1 && c >= s.c0 - 1 && c <= s.c1 + 1); const p = near.reduce((a, c) => [a[0] + c[0], a[1] + c[1]], [0, 0]); const X = cx(p[0] / near.length) + cell / 2, Y = cy(p[1] / near.length) + cell / 2; x.fillStyle = '#fff'; x.strokeStyle = INK; x.lineWidth = 2.5; x.beginPath(); x.arc(X, Y, 8, 0, 7); x.fill(); x.stroke(); });
      break;
    }
    case 'Village-Like': {
      F.pockets.forEach(k => { pale(k.cells); fillCells(k.cells, hp); });
      F.streets.forEach(s => dline(x, [[cx(s.c0), cy(s.r) + cell / 2], [cx(s.c1) + cell, cy(s.r) + cell / 2]], 5));
      F.moduleClusters.comps.forEach(k => { const cells = []; k.cells.forEach(([m, f]) => cells.push(...moduleCells(Mo.mo, E.r0, m, f))); cellOutline(x, cells, cell, cx, cy, 2.5); });
      break;
    }
  }
}

// ------------------------------------------------------------------ 3D model: the crop box rates what is inside it
function rateBox(box) {
  const wrap = $('#boxRatings'), it = A.item;
  if (!box || !it) { wrap.hidden = true; return; }
  const { result } = analyzeVox(it.vox, THR, box);
  wrap.hidden = false;
  $('#boxRatingsTitle').textContent = `Ratings inside the box · ${box.x1 - box.x0} × ${box.y1 - box.y0} m, ${box.z1 - box.z0} m deep`;
  const el = $('#boxRatingsList');
  if (result.features.empty) { el.innerHTML = '<p class="hint">Too little mass inside the box to rate — make it bigger or move it.</p>'; return; }
  el.innerHTML = WORDS.map(w => { const v = result.ratings[w]; return `<div class="gen-row"><span class="wd">${w}</span><span class="track"><span class="bar" style="width:${v ?? 0}%"></span></span><span class="num">${v == null ? '—' : v}</span></div>`; }).join('');
}

// ------------------------------------------------------------------ Program: every bay of the frame, rated for Lobby / Gathering / Working
function rateBays(it) {
  if (it.bays) return it.bays;
  const bays = bayBoxes(it.vox).map(b => {
    const { grid, result } = analyzeVox(it.vox, THR, b);
    const measures = measureBay(it.vox, THR, b, result);
    const programs = programScores(result.ratings, measures, result.features.empty);
    return { i: b.i, box: b, grid, result, measures, programs };
  });
  const best = {};
  for (const k of PROGRAM_KEYS) best[k] = bays.reduce((m, b) => (m == null || b.programs[k].score > bays[m].programs[k].score ? b.i : m), null);
  it.bays = bays; it.best = best;
  return bays;
}
function renderProgram() {
  const it = A.item; if (!it) return;
  const bays = rateBays(it), best = it.best;
  if (A.bay == null || A.bay >= bays.length) A.bay = best.lobby ?? 0;
  // the winners
  $('#progWinners').innerHTML = PROGRAM_KEYS.map(k => { const b = bays[best[k]]; return `<button type="button" class="prog-win" data-bay="${b.i}"><div class="eyebrow">Best for ${PROGRAMS[k].name.toLowerCase()}</div><b>Bay ${b.i + 1} · ${b.programs[k].score}</b><small>${b.box.x0}–${b.box.x1} m along the slab · ${PROGRAMS[k].blurb}</small></button>`; }).join('');
  $$('#progWinners .prog-win').forEach(el => el.onclick = () => { A.bay = +el.dataset.bay; renderProgram(); });
  // the strip of bays
  $('#progBays').innerHTML = bays.map(b => `<button type="button" class="prog-bay${b.i === A.bay ? ' on' : ''}" data-bay="${b.i}" title="Bay ${b.i + 1} · ${b.box.x0}–${b.box.x1} m"><div class="t"><span>Bay ${b.i + 1}</span>${PROGRAM_KEYS.filter(k => best[k] === b.i).map(k => `<em title="best for ${PROGRAMS[k].name.toLowerCase()}">${PROGRAMS[k].short}</em>`).join('')}</div>${PROGRAM_KEYS.map(k => `<div class="r"><span>${PROGRAMS[k].short}</span><span class="track"><span class="bar${best[k] === b.i ? ' best' : ''}" style="width:${b.programs[k].score}%"></span></span><span class="num">${b.programs[k].score}</span></div>`).join('')}</button>`).join('');
  $$('#progBays .prog-bay').forEach(el => el.onclick = () => { A.bay = +el.dataset.bay; renderProgram(); });
  const sel = $('#progBays .prog-bay.on'); if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  // the deep analysis of the selected bay
  const b = bays[A.bay];
  $('#progBayTitle').textContent = `Bay ${b.i + 1} · ${b.box.x0}–${b.box.x1} m along the slab · ${it.name}`;
  const src = { name: `${it.name} · bay ${b.i + 1}`, frame: it.frame, vox: it.vox, camera: it.camera, result: it.result };
  if (A.pv) { A.pv.setSource(src, b.box); A.pv.setHighlight(highlightCells(it.vox, THR, b.box, A.hl, b.result), hlOpts()); if (!A.pvZoomed || A.pvZoomedBay !== b.i) { A.pv.zoomToBox(); A.pvZoomed = true; A.pvZoomedBay = b.i; } }
  $('#progScores').innerHTML = PROGRAM_KEYS.map(k => { const p = b.programs[k], P = PROGRAMS[k], isBest = best[k] === b.i; return `<div class="prog-card${isBest ? ' best' : ''}"><div class="head"><span class="name">${P.name}${isBest ? '<small>best bay for this</small>' : ''}</span><b class="${isBest ? 'red' : ''}">${p.score}</b></div><p class="blurb">${P.blurb}</p><div class="half">From the ratings · ${p.wordScore}</div><div class="parts">${p.words.map(w => `<div class="part"><span>${w.word} <small>× ${Math.round(w.weight * 100)}%</small></span><span class="track"><span class="bar" style="width:${w.value}%"></span></span><span class="num">${w.value}</span></div>`).join('')}</div><div class="half">From the cubes · ${p.measureScore}</div><div class="parts">${p.parts.map(q => `<div class="part"><span>${q.label} <small>× ${Math.round(q.weight * 100)}%</small></span><span class="track"><span class="bar" style="width:${Math.round(q.value * 100)}%"></span></span><span class="num">${Math.round(q.value * 100)}</span></div>`).join('')}</div></div>`; }).join('');
  const m = b.measures, pct = v => Math.round(v * 100) + '%';
  $('#progMeasures').innerHTML = [['Solid cubes', pct(m.solidShare)], ['Empty cubes', pct(m.voidShare)], ['Floor with headroom', m.floor + ' m²'], ['Sheltered floor', pct(m.coveredShare) + ' of it'], ['Roofed hall at the ground', m.hall + ' m²'], ['Open ground', pct(m.groundVoid)], ['See-through columns', pct(m.seeThrough)], ['Mass at the front', pct(m.frontMass)], ['Gathering pockets', m.pockets], ['Streets', m.streets], ['Openings', m.openings]].map(([k, v]) => `<div><span>${k}</span><span>${v}</span></div>`).join('');
  const top = PROGRAM_KEYS.reduce((m, k) => b.programs[k].score > b.programs[m].score ? k : m, 'lobby'), used = new Set(Object.keys(PROGRAMS[top].words));
  $('#progRatingsNote').textContent = `Red bars feed the ${PROGRAMS[top].name.toLowerCase()} score, this bay's strongest use.`;
  $('#progRatings').innerHTML = WORDS.map(w => { const v = b.result.ratings[w]; return `<div class="gen-row"><span class="wd">${w}</span><span class="track"><span class="bar${used.has(w) ? ' used' : ''}" style="width:${v ?? 0}%"></span></span><span class="num">${v == null ? '—' : v}</span></div>`; }).join('');
  renderProgWords(b);
  if (A.progDepth) drawDiagram($('#progView'), b.grid, b.result, A.progWord, '#c62828');
}
const hlOpts = () => ({ opacity: A.hl === 'voids' ? 0.28 : A.hl === 'seeThrough' || A.hl === 'ground' ? 0.4 : 0.55 });
function renderProgWords(b) {
  const el = $('#progWords');
  el.innerHTML = WORDS.map(w => `<button type="button" class="btn quiet${w === A.progWord ? ' on' : ''}" data-word="${w}">${w} · ${b.result.ratings[w] ?? '—'}</button>`).join('');
  el.querySelectorAll('button').forEach(x => x.onclick = () => { A.progWord = x.dataset.word; renderProgWords(b); drawDiagram($('#progView'), b.grid, b.result, A.progWord, '#c62828'); });
}
/* Scan the animation: every `step` frames, rate every bay, keep the best for each use. */
async function scanAnimation() {
  if (A.scan) return;
  const S = settingsOf(A.animId); if (!S) return;
  const step = +$('#progStep').value || 10, max = PSGen.frameMax(S), out = { lobby: [], gathering: [], working: [] };
  A.scan = { stop: false }; $('#progScanGo').disabled = true; $('#progScanStop').hidden = false;
  const [nx, ny, nz] = S.dims;
  try {
    for (let f = 1; f <= max; f += step) {
      if (A.scan.stop) break;
      $('#progScanStatus').textContent = `Frame ${f} of ${max}… (${Math.round(f / max * 100)}%)`;
      const sizes = await PSGen.generate(S, f); if (!sizes) continue;
      const vox = { nx, ny, nz, sizes, max: 255, threshold: THR };
      for (const b of bayBoxes(vox)) {
        const { result } = analyzeVox(vox, THR, b), measures = measureBay(vox, THR, b, result), p = programScores(result.ratings, measures, result.features.empty);
        for (const k of PROGRAM_KEYS) { out[k].push({ frame: f, bay: b.i, score: p[k].score }); }
      }
      await new Promise(r => setTimeout(r, 0));
    }
    for (const k of PROGRAM_KEYS) out[k].sort((a, c) => c.score - a.score || a.frame - c.frame);
    $('#progResults').innerHTML = PROGRAM_KEYS.map(k => `<table><thead><tr><th colspan="3">Best for ${PROGRAMS[k].name.toLowerCase()}</th></tr></thead><tbody>${out[k].slice(0, 6).map(r => `<tr><td><button type="button" data-frame="${r.frame}" data-bay="${r.bay}">frame ${r.frame}</button></td><td>bay ${r.bay + 1}</td><td>${r.score}</td></tr>`).join('')}</tbody></table>`).join('');
    $$('#progResults button').forEach(bt => bt.onclick = () => { A.frame = +bt.dataset.frame; A.bay = +bt.dataset.bay; fillPickers(); loadFrame(); });
    $('#progScanStatus').textContent = A.scan.stop ? 'Stopped — the results so far are below. Click a frame to open it.' : `Scanned ${Math.floor((max - 1) / step) + 1} frames of ${animName(A.animId)}. Click a frame to open it.`;
  } finally { A.scan = null; $('#progScanGo').disabled = false; $('#progScanStop').hidden = true; }
}

// ------------------------------------------------------------------ tabs
const TAB_OF = { generator: 'generator', analyze: 'analyze', program: 'program', model: 'model' };
function showTab(name) {
  name = TAB_OF[name] || 'generator';
  A.tab = name;
  $$('.tab[data-tab]').forEach(t => t.hidden = t.dataset.tab !== name);
  $$('.topbar a[data-tab]').forEach(a => a.classList.toggle('on', a.dataset.tab === name));
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  window.scrollTo({ top: 0 });
  if (name !== 'generator') { if (A.dirty || !A.item) loadFrame(); else if (name === 'analyze') drawView(A.item); else if (name === 'program') renderProgram(); }
  window.dispatchEvent(new Event('resize'));
}
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="#"]'); if (!a) return;
  const id = a.getAttribute('href').slice(1); if (!TAB_OF[id]) return;
  e.preventDefault(); showTab(id);
});
window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));

// ------------------------------------------------------------------ boot
function boot() {
  $$('.picker').forEach(wirePicker);
  try { A.depth = localStorage.getItem('protospace.depth') === '1'; } catch (e) {}
  const dt = $('#depthToggle'); dt.checked = A.depth; $('#depthWrap').hidden = !A.depth;
  dt.addEventListener('change', () => { A.depth = dt.checked; $('#depthWrap').hidden = !A.depth; try { localStorage.setItem('protospace.depth', A.depth ? '1' : '0'); } catch (e) {} if (A.item) drawView(A.item); });
  window.addEventListener('resize', () => { if (A.item && A.tab === 'analyze') drawView(A.item); if (A.item && A.item.bays && A.tab === 'program' && A.progDepth) drawDiagram($('#progView'), A.item.bays[A.bay].grid, A.item.bays[A.bay].result, A.progWord, '#c62828'); });
  A.anv = createViewer($('#anViewer'), { panel: 'none', overlay: true, sections: [], boxDrag: false, view: 'camera', color: 'render', ratio: 0.5, emptyText: 'Pick an animation and a frame above.' });
  A.pv = createViewer($('#progViewer'), { panel: 'none', overlay: true, sections: [], boxDrag: false, view: 'iso', color: 'foam', ratio: 0.62, emptyText: 'Pick an animation and a frame above.' });
  const hs = $('#progHl'); hs.innerHTML = HIGHLIGHTS.map(([k, t]) => `<option value="${k}">${t}</option>`).join(''); hs.value = A.hl;
  hs.addEventListener('change', () => { A.hl = hs.value; if (A.item && A.item.bays && A.pv) { const b = A.item.bays[A.bay]; A.pv.setHighlight(highlightCells(A.item.vox, THR, b.box, A.hl, b.result), hlOpts()); } });
  const pd = $('#progDepth'); pd.addEventListener('change', () => { A.progDepth = pd.checked; $('#progDepthWrap').hidden = !A.progDepth; if (A.progDepth && A.item && A.item.bays) drawDiagram($('#progView'), A.item.bays[A.bay].grid, A.item.bays[A.bay].result, A.progWord, '#c62828'); });
  $('#progScanGo').addEventListener('click', scanAnimation);
  $('#progScanStop').addEventListener('click', () => { if (A.scan) A.scan.stop = true; });
  A.model = createViewer($('#model3dViewer'), { panel: 'side', sections: ['look', 'crop', 'cut', 'export'], open: { look: true, crop: true, cut: false, export: false }, emptyText: 'Pick an animation and a frame above to see its 3D model.', onBox: rateBox });
  PSGen.mount({
    analyze: (vox, thr) => analyzeVox(vox, thr),
    onAnalyzeFrame: (settings, frame) => { A.animId = 'current'; A.frame = frame; fillPickers(); A.dirty = true; showTab('analyze'); },
  });
  PSGen.onChange(() => { fillPickers(); if (A.animId === 'current') { A.dirty = true; if (A.tab !== 'generator') { clearTimeout(A.boxTimer); A.boxTimer = setTimeout(loadFrame, 150); } } });
  const start = PSGen.current(); A.frame = start.frame;
  fillPickers();
  showTab(location.hash.slice(1) || 'generator');
}
boot();

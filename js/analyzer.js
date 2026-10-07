/* ProtoSpace image analyzer — reads a render of the cube slab (black cubes on white) as a 1 m grid,
   classes every cell by how deep the first mass sits (the tone of the render carries depth: black = mass
   right at the front, greys = further back, white = see-through), and rates the reading 0–100 on the
   twelve descriptors with the measurements behind each rating.  Pure functions; runs in the browser and
   in Node (calibration). */
(function (root) {
  const PSA = {};

  PSA.WORDS = ["Modular", "Fragmented", "Interlocking", "Porous", "Clustered", "Decentralized",
    "Networked", "Layered", "Intimate", "Visually Connected", "Socially Interactive", "Village-Like"];
  PSA.ABBR = ["MOD", "FRA", "INT", "POR", "CLU", "DEC", "NET", "LAY", "INTM", "VIS", "SOC", "VIL"];

  // Depth bands from a cell's mean tone (measured against the point cloud: first cube 0–2 m back ≈ 0.02–0.13,
  // 3–8 m ≈ 0.10–0.20, 9–18 m ≈ 0.20–0.44, 19 m or more ≈ 0.42–0.9, nothing ≈ 1.0).
  PSA.BANDS = [0.09, 0.20, 0.40, 0.72];           // upper tone limits of bands 0..3; above = band 4 (see-through)
  PSA.BAND_NAMES = ["mass at the front", "first mass 3–8 m back", "recess 9–18 m deep", "recess 19 m or deeper", "see-through"];
  PSA.BAND_TONES = [17, 86, 146, 200, 255];         // the boards' depth-diagram greys

  // Calibration — 97th-percentile targets over the 1,250 zones of the animation (see calibrate.js)
  PSA.T = {
    "islands": 5,
    "conn_total": 21,
    "conn_interlock": 9,
    "openings": 2,
    "dist_best": 2.4,
    "dist_worst": 6.1,
    "gather_nodes": 5,
    "circ_per_module": 3.6,
    "functions_per_cell": 4,
    "targets_per_module": 1.6,
    "encounter_points": 3,
    "village_clusters": 3,
    "streets": 3,
    "nodes": 5,
    "scale": {
      "Modular": 0.7255,
      "Fragmented": 0.6246,
      "Interlocking": 0.7451,
      "Porous": 1,
      "Clustered": 1,
      "Decentralized": 0.8944,
      "Networked": 0.8636,
      "Layered": 0.95,
      "Intimate": 0.981,
      "Visually Connected": 0.6667,
      "Socially Interactive": 1,
      "Village-Like": 0.7368
    }
  };
  PSA.MODULE = 9;      // m
  PSA.FLOOR = 3;       // m
  PSA.DEPTH = 9;       // m assumed depth of a territory seen in elevation

  // ---------------------------------------------------------------- image → grid
  PSA.gray = function (rgba, w, h) {
    const g = new Float32Array(w * h);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]) / 255;
    return g;
  };

  /* Cube pitch in pixels. The seams between the front cubes repeat at the pitch, so the autocorrelation of the
     edge signal inside the dark (front) mass peaks there; the second harmonic refines it. */
  PSA.detectPitch = function (g, w, h, opts) {
    opts = opts || {};
    const dark = opts.dark == null ? 0.15 : opts.dark;
    const minD = 4, maxD = Math.max(minD + 4, Math.floor(Math.min(w, h) / 6));
    function acf(alongX) {
      const e = new Float32Array(w * h);
      for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
        const a = g[y * w + x], b = alongX ? g[y * w + x + 1] : g[(y + 1) * w + x];
        if (Math.max(a, b) < dark) e[y * w + x] = Math.abs(b - a);
      }
      let mu = 0; for (let i = 0; i < e.length; i++) mu += e[i]; mu /= e.length;
      let den = 0; for (let i = 0; i < e.length; i++) den += (e[i] - mu) * (e[i] - mu); den /= e.length;
      const out = new Float64Array(maxD + 1);
      if (den <= 0) return out;
      const sy = h > 400 ? 2 : 1, sx = w > 400 ? 2 : 1;
      for (let d = minD; d <= maxD; d++) {
        let s = 0, n = 0;
        if (alongX) { for (let y = 0; y < h; y += sy) { const o = y * w; for (let x = 0; x + d < w; x++) { s += (e[o + x] - mu) * (e[o + x + d] - mu); n++; } } }
        else { for (let x = 0; x < w; x += sx) for (let y = 0; y + d < h; y++) { s += (e[y * w + x] - mu) * (e[(y + d) * w + x] - mu); n++; } }
        out[d] = n ? (s / n) / den : 0;
      }
      return out;
    }
    const ax = acf(true), ay = acf(false);
    const a = new Float64Array(maxD + 1);
    for (let d = minD; d <= maxD; d++) a[d] = 0.5 * (ax[d] + ay[d]);
    const peaks = [];
    for (let d = minD + 2; d <= maxD - 2; d++) if (a[d] > a[d - 1] && a[d] >= a[d + 1] && a[d] > a[d - 2] && a[d] >= a[d + 2] && a[d] > 0.03) peaks.push({ d, v: a[d] });
    if (!peaks.length) return { pitch: null, confidence: 0 };
    peaks.sort((p, q) => q.v - p.v);
    let p1 = peaks[0];
    // a stronger peak at half the lag means we caught the second harmonic
    const half = peaks.find(p => Math.abs(p.d - p1.d / 2) <= 1.5 && p.v > 0.5 * p1.v);
    if (half) p1 = half;
    const refine = d => { const y0 = a[d - 1], y1 = a[d], y2 = a[d + 1], den = y0 - 2 * y1 + y2; return den !== 0 ? d + 0.5 * (y0 - y2) / den : d; };
    let pitch = refine(p1.d);
    const h2 = peaks.find(p => Math.abs(p.d - 2 * p1.d) <= 2.5);
    if (h2) pitch = 0.5 * (pitch + refine(h2.d) / 2);
    return { pitch, confidence: Math.min(1, p1.v / 0.2) };
  };

  /* Depth-band grid at one cell per cube; rows count from the bottom (r = 0 lowest). */
  PSA.makeGrid = function (g, w, h, opts) {
    const pitch = opts.pitch;
    const invert = !!opts.invert;
    const bands = opts.bands || PSA.BANDS;
    const W1 = w + 1;
    const I = new Float64Array((w + 1) * (h + 1));          // integral image of the tone
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        const v = g[y * w + x];
        row += invert ? 1 - v : v;
        I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1] + row;
      }
    }
    function boxMean(x0, y0, x1, y1) {
      x0 = Math.max(0, Math.min(w, x0)); x1 = Math.max(0, Math.min(w, x1)); y0 = Math.max(0, Math.min(h, y0)); y1 = Math.max(0, Math.min(h, y1));
      if (x1 <= x0 || y1 <= y0) return 1;
      return (I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0]) / ((x1 - x0) * (y1 - y0));
    }
    // lattice phase: cells aligned with the cubes are decisively dark or light
    function score(px, py) {
      const cols = Math.floor((w - px) / pitch), rows = Math.floor((h - py) / pitch);
      let s = 0, n = 0;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const m = boxMean(Math.round(px + c * pitch), Math.round(py + r * pitch), Math.round(px + (c + 1) * pitch), Math.round(py + (r + 1) * pitch));
        s += Math.abs(m - 0.5); n++;
      }
      return n ? s / n : 0;
    }
    let best = { px: 0, py: 0, s: -1 };
    if (opts.phaseX == null || opts.phaseY == null) {
      const steps = 6;
      for (let i = 0; i < steps; i++) for (let j = 0; j < steps; j++) {
        const px = (i / steps) * pitch, py = (j / steps) * pitch, s = score(px, py);
        if (s > best.s) best = { px, py, s };
      }
    } else best = { px: opts.phaseX, py: opts.phaseY, s: 0 };
    const px = best.px, py = best.py;
    const cols = Math.floor((w - px) / pitch), rows = Math.floor((h - py) / pitch);
    const tone = new Float32Array(cols * rows), band = new Uint8Array(cols * rows);
    for (let ri = 0; ri < rows; ri++) for (let c = 0; c < cols; c++) {
      const m = boxMean(Math.round(px + c * pitch), Math.round(py + ri * pitch), Math.round(px + (c + 1) * pitch), Math.round(py + (ri + 1) * pitch));
      const r = rows - 1 - ri;
      tone[r * cols + c] = m;
      let b = 4; for (let k = 0; k < bands.length; k++) if (m < bands[k]) { b = k; break; }
      band[r * cols + c] = b;
    }
    return { cols, rows, tone, band, pitch, px, py, invert, w, h };
  };

  // ---------------------------------------------------------------- helpers
  function components(pred, cols, rows) {
    const lab = new Int32Array(cols * rows).fill(-1);
    const comps = [];
    const qx = new Int32Array(cols * rows), qy = new Int32Array(cols * rows);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (lab[r * cols + c] !== -1 || !pred(c, r)) continue;
      const id = comps.length; const cells = [];
      let qh = 0, qt = 0; qx[qt] = c; qy[qt] = r; qt++; lab[r * cols + c] = id;
      while (qh < qt) {
        const x = qx[qh], y = qy[qh]; qh++; cells.push([x, y]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          if (lab[ny * cols + nx] !== -1 || !pred(nx, ny)) continue;
          lab[ny * cols + nx] = id; qx[qt] = nx; qy[qt] = ny; qt++;
        }
      }
      comps.push({ id, cells, size: cells.length });
    }
    return { lab, comps };
  }
  const clamp01 = v => Math.max(0, Math.min(1, v));
  const ramp = (v, lo, hi) => clamp01((v - lo) / (hi - lo));
  const band = (v, a, b, c, d) => v <= a || v >= d ? 0 : v < b ? (v - a) / (b - a) : v <= c ? 1 : (d - v) / (d - c);
  const sum = a => a.reduce((s, v) => s + v, 0);
  const soft = x => 0.25 + 0.75 * clamp01(x);           // a secondary term never zeroes the rating on its own
  const fmt = (v, d = 0) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = v => fmt(100 * v) + "%";
  const plural = (n, s, p) => n === 1 ? s : (p || s + "s");

  // ---------------------------------------------------------------- analysis
  PSA.analyze = function (grid) {
    const { cols, rows, band: B } = grid;
    const M = PSA.MODULE, FH = PSA.FLOOR, T = PSA.T;
    const bandAt = (c, r) => (c < 0 || r < 0 || c >= cols || r >= rows) ? 4 : B[r * cols + c];
    const isMass = (c, r) => bandAt(c, r) <= 1;            // the building's face: first mass within ~8 m
    const isRecess = (c, r) => { const b = bandAt(c, r); return b === 2 || b === 3; };
    const isBuilt = (c, r) => bandAt(c, r) <= 3;
    const res = { grid, measures: {}, features: {}, ratings: {}, explain: {} };
    let massN = 0, builtN = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { if (isMass(c, r)) massN++; if (isBuilt(c, r)) builtN++; }
    res.measures.mass_cells = massN;
    if (massN < 8) {
      PSA.WORDS.forEach(w => { res.ratings[w] = 0; res.explain[w] = { terms: [], text: "Too little mass was read from the image to rate it.", advice: "Check the scale (metres across) and the tone limits, or import a render of the cube slab." }; });
      res.features.empty = true;
      return res;
    }

    // envelope of everything built, floors from its lowest row
    let cmin = cols, cmax = -1, rmin = rows, rmax = -1;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (isBuilt(c, r)) { if (c < cmin) cmin = c; if (c > cmax) cmax = c; if (r < rmin) rmin = r; if (r > rmax) rmax = r; }
    const r0 = rmin, nf = Math.max(1, Math.ceil((rmax - r0 + 1) / FH));
    res.features.envelope = { cmin, cmax, rmin, rmax, nf, r0 };

    // module grid: the offset with the clearest full/empty reading, within the envelope
    const envW = cmax - cmin + 1;
    const nm = Math.max(1, Math.floor(envW / M));
    const modFill = (mo, m, f) => { let s = 0; for (let dc = 0; dc < M; dc++) for (let dr = 0; dr < FH; dr++) s += isMass(mo + m * M + dc, r0 + f * FH + dr) ? 1 : 0; return s / (M * FH); };
    let bestMo = cmin, bestClar = -1;
    for (let mo = cmin; mo <= cmax + 1 - nm * M; mo++) {
      let clear = 0, n = 0;
      for (let m = 0; m < nm; m++) for (let f = 0; f < nf; f++) { const fl = modFill(mo, m, f); if (fl >= 0.7 || fl <= 0.3) clear++; n++; }
      const clar = n ? clear / n : 0;
      if (clar > bestClar + 1e-9) { bestClar = clar; bestMo = mo; }
    }
    const mo = bestMo;
    const mf = new Float32Array(nm * nf), mdepth = new Float32Array(nm * nf);
    for (let m = 0; m < nm; m++) for (let f = 0; f < nf; f++) {
      mf[f * nm + m] = modFill(mo, m, f);
      let front = 0, back = 0;
      for (let dc = 0; dc < M; dc++) for (let dr = 0; dr < FH; dr++) { const b = bandAt(mo + m * M + dc, r0 + f * FH + dr); if (b === 0) front++; else if (b === 1) back++; }
      mdepth[f * nm + m] = front + back ? back / (front + back) : 0;      // 0 = all at the front, 1 = all set back
    }
    const mocc = (m, f) => (m < 0 || f < 0 || m >= nm || f >= nf) ? 0 : (mf[f * nm + m] >= 0.5 ? 1 : 0);
    let occModules = 0; for (let i = 0; i < mf.length; i++) if (mf[i] >= 0.5) occModules++;
    res.features.modules = { mo, nm, nf, fill: mf, depth: mdepth, occupied: occModules };

    // ---- Modular
    {
      let full = 0, empty = 0, inFull = 0, massInMods = 0;
      for (let i = 0; i < mf.length; i++) {
        const cells = Math.round(mf[i] * M * FH); massInMods += cells;
        if (mf[i] >= 0.7) { full++; inFull += cells; } else if (mf[i] <= 0.3) empty++;
      }
      const nmod = nm * nf;
      const share = massInMods ? inFull / massInMods : 0;
      const clarity = nmod ? (full + empty) / nmod : 0;
      const mix = (full + empty) ? 1 - Math.abs(full - empty) / (full + empty) : 0;
      const read = clarity * (0.5 + 0.5 * mix);
      const raw = share * read;
      Object.assign(res.measures, { modular_pct: 100 * share, modules_full: full, modules_empty: empty, modules_total: nmod, module_clarity: clarity });
      res.ratings.Modular = rate("Modular", raw);
      res.explain.Modular = {
        terms: [t("Mass inside complete modules", pct(share), "share of the face that sits in module cells at least 70% filled", share),
          t("Module cells that read clearly", `${full + empty} of ${nmod}`, `${full} full, ${empty} empty, the rest half-filled`, clarity),
          t("Mix of full and empty", pct(mix), "1 = as many empty as full module cells", mix)],
        text: `${pct(share)} of the face falls inside complete ${M} × ${FH} m module cells (${full} complete, ${empty} empty of ${nmod}), and ${pct(clarity)} of the module cells read clearly as either full or empty.`,
        advice: share < 0.6 ? "Fill module cells completely or leave them empty — half-filled cells blur the reading of repeated units." : mix < 0.4 ? "Alternate complete and empty module cells; a solid block reads as one mass, not an assembly." : "Reads as an assembly of repeated units."
      };
    }

    // ---- Fragmented: bodies of face mass
    const isl = components((c, r) => isMass(c, r), cols, rows);
    const islands = isl.comps.filter(k => k.size >= 6);
    const largest = isl.comps.reduce((a, k) => Math.max(a, k.size), 0);
    const cohesion = massN ? largest / massN : 0;
    res.features.islands = isl; res.features.islandList = islands;
    {
      const raw = Math.min(1, islands.length / T.islands) * cohesion;
      Object.assign(res.measures, { islands: islands.length, cohesion });
      res.ratings.Fragmented = rate("Fragmented", raw);
      res.explain.Fragmented = {
        terms: [t("Identifiable territories", `${islands.length}`, `separate bodies of face mass of at least 6 m² · ${T.islands} earns full marks`, Math.min(1, islands.length / T.islands)),
          t("Cohesion", pct(cohesion), "share of the face mass joined into the largest body", cohesion)],
        text: `The face breaks into ${islands.length} identifiable ${plural(islands.length, "territory", "territories")} (bodies of at least 6 m²) while ${pct(cohesion)} of the mass stays joined in one body.`,
        advice: islands.length < T.islands * 0.5 ? "Break the large masses into more, smaller territories with recesses and openings." : cohesion < 0.5 ? "The pieces are too scattered to read as one whole — keep a main body that joins them." : "Well subdivided and still one whole."
      };
    }

    // ---- Interlocking: joints between occupied modules, offset or across depth
    {
      let h = 0, v = 0, il = 0; const conns = [];
      const colProfile = (m, f) => { const p = []; for (let dc = 0; dc < M; dc++) { let s = 0; for (let dr = 0; dr < FH; dr++) s += isMass(mo + m * M + dc, r0 + f * FH + dr) ? 1 : 0; p.push(s >= 2 ? 1 : 0); } return p; };
      const rowProfile = (m, f) => { const p = []; for (let dr = 0; dr < FH; dr++) { let s = 0; for (let dc = 0; dc < M; dc++) s += isMass(mo + m * M + dc, r0 + f * FH + dr) ? 1 : 0; p.push(s >= 5 ? 1 : 0); } return p; };
      const jacc = (a, b) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { if (a[k] && b[k]) i++; if (a[k] || b[k]) u++; } return u ? i / u : 0; };
      const depthStep = (a, b) => Math.abs(mdepth[a[1] * nm + a[0]] - mdepth[b[1] * nm + b[0]]) >= 0.5;
      for (let m = 0; m < nm; m++) for (let f = 0; f < nf; f++) {
        if (!mocc(m, f)) continue;
        if (mocc(m + 1, f)) { h++; const j = jacc(rowProfile(m, f), rowProfile(m + 1, f)); const lock = (j > 0 && j < 1) || depthStep([m, f], [m + 1, f]); if (lock) il++; conns.push({ a: [m, f], b: [m + 1, f], lock }); }
        if (mocc(m, f + 1)) { v++; const j = jacc(colProfile(m, f), colProfile(m, f + 1)); const lock = (j >= 0.2 && j < 0.8) || depthStep([m, f], [m, f + 1]); if (lock) il++; conns.push({ a: [m, f], b: [m, f + 1], lock }); }
      }
      const tot = h + v, balance = tot ? 1 - Math.abs(h - v) / tot : 0;
      const raw = balance * (0.5 * Math.min(1, tot / T.conn_total) + 0.5 * Math.min(1, il / T.conn_interlock));
      Object.assign(res.measures, { conn_h: h, conn_v: v, conn_total: tot, conn_interlock: il, conn_balance: balance });
      res.features.connections = conns;
      res.ratings.Interlocking = rate("Interlocking", raw);
      res.explain.Interlocking = {
        terms: [t("Connections between modules", `${h} horizontal + ${v} vertical`, `${T.conn_total} in total earns full marks`, Math.min(1, tot / T.conn_total)),
          t("Interlocking joints", `${il}`, `joints where the modules overlap only partly or step in depth · ${T.conn_interlock} earns full marks`, Math.min(1, il / T.conn_interlock)),
          t("Balance horizontal / vertical", pct(balance), "1 = as many floor-to-floor as side-by-side connections", balance)],
        text: `Occupied modules touch ${h} ${plural(h, "time")} side by side and ${v} ${plural(v, "time")} floor to floor; ${il} of those joints are offset or step in depth, so the modules interlock rather than stack.`,
        advice: v < h * 0.5 ? "More floor-to-floor relationships — let modules step over the ones below." : il < T.conn_interlock * 0.5 ? "Shift modules half a bay, or a few metres in depth, against their neighbours so the joints interlock." : "Modules relate across levels and depth."
      };
    }

    // ---- recesses, pockets, streets: the void classes
    const inEnv = (c, r) => c >= cmin && c <= cmax && r >= r0 && r <= rmax;
    const rec = components((c, r) => inEnv(c, r) && isRecess(c, r), cols, rows);
    const topOpen = new Uint8Array(rec.comps.length);
    for (const k of rec.comps) for (const [c, r] of k.cells) if (r === rmax || !hasMassAbove(c, r)) { topOpen[k.id] = 1; break; }
    function hasMassAbove(c, r) { for (let rr = r + 1; rr <= rmax; rr++) if (isMass(c, rr)) return true; return false; }
    const pockets = rec.comps.filter(k => k.size >= 12);
    const isPocket = new Uint8Array(rec.comps.length); pockets.forEach(k => isPocket[k.id] = 1);
    const see = components((c, r) => inEnv(c, r) && bandAt(c, r) === 4, cols, rows);
    const openings = see.comps.filter(k => k.size >= 2 && !k.cells.some(([c, r]) => c === cmin || c === cmax || r === r0 || r === rmax));
    // class map: 0 none, 1 work (face mass), 2 gathering pocket, 3 street, 4 bridge/link, 5 terrace, 6 covered recess, 7 see-through
    const CL = { NONE: 0, WORK: 1, GATHER: 2, STREET: 3, LINK: 4, TERRACE: 5, COVERED: 6, OPEN: 7 };
    PSA.CLASS_NAMES = ["", "work (face mass)", "gathering pocket", "street", "bridge", "terrace", "covered recess", "see-through opening"];
    const cls = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (isMass(c, r)) { cls[i] = CL.WORK; continue; }
      if (!inEnv(c, r)) continue;
      const b = bandAt(c, r);
      if (b === 4) { cls[i] = CL.OPEN; continue; }
      const lab = rec.lab[i];
      if (lab >= 0 && isPocket[lab]) { cls[i] = CL.GATHER; continue; }
      const below = isMass(c, r - 1), above = hasMassAbove(c, r);
      cls[i] = below && !above ? CL.TERRACE : CL.COVERED;
    }
    const streets = [], links = [];
    for (let r = r0 + 1; r <= rmax; r++) {
      let c = cmin;
      const isRec = x => { const k = cls[r * cols + x]; return k === CL.COVERED || k === CL.TERRACE || k === CL.GATHER; };
      while (c <= cmax) {
        if (!isRec(c)) { c++; continue; }
        let c1 = c; while (c1 + 1 <= cmax && isRec(c1 + 1)) c1++;
        const L = c1 - c + 1;
        let floor = 0; for (let x = c; x <= c1; x++) if (isMass(x, r - 1)) floor++;
        if (floor >= 0.5 * L) {                                   // a recess with a floor edge under at least half its length
          if (L >= 5) { streets.push({ r, c0: c, c1 }); for (let x = c; x <= c1; x++) if (cls[r * cols + x] !== CL.GATHER) cls[r * cols + x] = CL.STREET; }
          else if (L >= 2) { links.push({ r, c0: c, c1 }); for (let x = c; x <= c1; x++) if (cls[r * cols + x] !== CL.GATHER) cls[r * cols + x] = CL.LINK; }
        }
        c = c1 + 1;
      }
    }
    res.features.classes = cls; res.features.CL = CL; res.features.recesses = rec; res.features.pockets = pockets; res.features.openings = openings;
    res.features.streets = streets; res.features.links = links;

    // ---- Porous
    {
      const envCells = (cmax - cmin + 1) * (rmax - r0 + 1);
      let openN = 0, recN = 0;
      for (let r = r0; r <= rmax; r++) for (let c = cmin; c <= cmax; c++) { const b = bandAt(c, r); if (b === 4) openN++; else if (b >= 2) recN++; }
      const voidPct = 100 * (openN + recN) / envCells;
      const bv = band(voidPct, 15, 50, 66, 90);
      const raw = bv * soft(openings.length / T.openings);
      Object.assign(res.measures, { void_pct: voidPct, see_through_pct: 100 * openN / envCells, recess_pct: 100 * recN / envCells, openings: openings.length });
      res.ratings.Porous = rate("Porous", raw);
      res.explain.Porous = {
        terms: [t("Void within the envelope", fmt(voidPct) + "%", `${fmt(100 * openN / envCells)}% see-through + ${fmt(100 * recN / envCells)}% deep recess · best between 50 and 66%, none at 15% or 90%`, bv),
          t("Openings you see right through", `${openings.length}`, `see-through voids enclosed by the building · ${T.openings} earns full marks`, Math.min(1, openings.length / T.openings))],
        text: `${fmt(voidPct)}% of the envelope is void or deep recess, and ${openings.length} ${plural(openings.length, "opening")} pass right through the mass.`,
        advice: voidPct < 50 ? "More void between the masses — the face is denser than porous." : voidPct > 66 ? "Too open to read as a porous body; the voids need mass around them." : openings.length < T.openings * 0.6 ? "Cut openings that pass right through so the eye connects the spaces behind." : "Porous in both senses: open and pierced."
      };
    }

    // ---- Clustered
    const mcomp = components((m, f) => mocc(m, f) === 1, nm, nf);
    const clusters = mcomp.comps;
    res.features.moduleClusters = mcomp;
    {
      const sizes = clusters.map(k => k.size).sort((a, b) => b - a);
      const nOcc = sum(sizes);
      const good = sizes.filter(s => s >= 3 && s <= 10);
      const share = nOcc ? sum(good) / nOcc : 0;
      const meanSize = sizes.length ? nOcc / sizes.length : 0;
      const bn = band(sizes.length, 0, 2, 6, 14), bs = band(meanSize, 1, 3, 10, 20);
      const raw = bn * bs * soft(share);
      Object.assign(res.measures, { clusters: sizes.length, modules_per_cluster: meanSize, cluster_sizes: sizes, cluster_share: share });
      res.ratings.Clustered = rate("Clustered", raw);
      res.explain.Clustered = {
        terms: [t("Clusters of joined modules", `${sizes.length}`, "best between 2 and 6 clusters", bn),
          t("Modules per cluster", fmt(meanSize, 1), "best between 3 and 10 · sizes " + (sizes.join(", ") || "—"), bs),
          t("Modules in 3–10 module clusters", pct(share), "share of occupied modules that belong to a recognisable group", share)],
        text: `${nOcc} occupied ${plural(nOcc, "module")} form ${sizes.length} ${plural(sizes.length, "cluster")} of ${fmt(meanSize, 1)} modules on average (sizes ${sizes.join(", ") || "—"}); ${pct(share)} of the modules sit in groups of 3 to 10.`,
        advice: meanSize > 10 ? "The clusters are too big to read as groups — separate them with shared voids." : sizes.length < 2 ? "One cluster is a block, not a cluster; separate at least two groups." : share < 0.6 ? "Some modules are loners or lumps — gather them into groups of 3 to 10." : "Reads as recognisable groups of units."
      };
    }

    // ---- Decentralized: distance to gathering pockets
    const modCentre = (m, f) => [mo + m * M + M / 2, r0 + f * FH + FH / 2];
    const pocketCells = []; pockets.forEach(k => k.cells.forEach(cc => pocketCells.push(cc)));
    const pocketFloors = new Set(); pocketCells.forEach(([c, r]) => pocketFloors.add(Math.floor((r - r0) / FH)));
    {
      let dsum = 0, n = 0; const dl = [];
      for (let m = 0; m < nm; m++) for (let f = 0; f < nf; f++) {
        if (!mocc(m, f)) continue; n++;
        const [x, y] = modCentre(m, f); let best = Infinity, bc = null;
        for (const [c, r] of pocketCells) { const d = Math.hypot(c + 0.5 - x, r + 0.5 - y); if (d < best) { best = d; bc = [c, r]; } }
        if (bc) { dsum += best; dl.push({ from: [x, y], to: [bc[0] + 0.5, bc[1] + 0.5], d: best }); }
      }
      const avg = pocketCells.length && n ? dsum / n : NaN;
      const rd = pocketCells.length && n ? 1 - ramp(avg, T.dist_best, T.dist_worst) : 0;
      const rn = Math.sqrt(Math.min(1, pockets.length / T.gather_nodes));
      const rf = Math.sqrt(pocketFloors.size / nf);
      const raw = rd * rn * rf;
      Object.assign(res.measures, { dist_to_gather: avg, gather_nodes: pockets.length, gather_floors: pocketFloors.size });
      res.features.distLines = dl;
      res.ratings.Decentralized = rate("Decentralized", raw);
      res.explain.Decentralized = {
        terms: [t("Distance to the nearest gathering pocket", pocketCells.length ? fmt(avg, 1) + " m" : "—", `average from each occupied module · ${fmt(T.dist_best, 1)} m best, ${fmt(T.dist_worst, 1)} m worst`, rd),
          t("Gathering pockets", `${pockets.length}`, `recesses of at least 12 m² · ${T.gather_nodes} earns full marks`, rn),
          t("Floors with a pocket", `${pocketFloors.size} of ${nf}`, "spread through the height rather than on one level", rf)],
        text: pocketCells.length ? `Each occupied module is ${fmt(avg, 1)} m on average from the nearest of ${pockets.length} gathering ${plural(pockets.length, "pocket")}, spread over ${pocketFloors.size} of ${nf} floors.` : "No recess of 12 m² or more was read, so every function concentrates in the mass.",
        advice: !pocketCells.length ? "Carve pockets of at least 12 m² into the face so gathering is distributed through the building." : pocketFloors.size < nf * 0.5 ? "Put gathering pockets on more floors." : avg > T.dist_best ? "Bring pockets closer to the modules at the edges." : "Gathering is spread through the building."
      };
    }

    // ---- Networked
    {
      let cps = 0, n = 0, multi = 0; const per = [];
      const runs = streets.concat(links);
      for (let m = 0; m < nm; m++) for (let f = 0; f < nf; f++) {
        if (!mocc(m, f)) continue; n++;
        let k = mocc(m + 1, f) + mocc(m - 1, f) + mocc(m, f + 1) + mocc(m, f - 1);
        const c0 = mo + m * M, c1 = c0 + M - 1, rb = r0 + f * FH - 1, rt = r0 + f * FH + FH;
        for (const run of runs) if (run.r >= rb && run.r <= rt && run.c1 >= c0 - 1 && run.c0 <= c1 + 1) k++;
        per.push({ m, f, k }); cps += k; if (k >= 3) multi++;
      }
      const cpm = n ? cps / n : 0, share = n ? multi / n : 0;
      const raw = Math.min(1, cpm / T.circ_per_module) * soft(share);
      Object.assign(res.measures, { circ_per_module: cpm, circ_multi_share: share, street_count: streets.length, link_count: links.length });
      res.features.perModuleConn = per;
      res.ratings.Networked = rate("Networked", raw);
      res.explain.Networked = {
        terms: [t("Potential links per module", fmt(cpm, 1), `neighbouring modules plus the streets and bridges it touches · ${fmt(T.circ_per_module, 1)} earns full marks`, Math.min(1, cpm / T.circ_per_module)),
          t("Modules with three or more", pct(share), "share of occupied modules with at least three geometric adjacencies; routes are unverified", share)],
        text: `Each occupied module has ${fmt(cpm, 1)} circulation connections on average — ${streets.length} ${plural(streets.length, "street")}, ${links.length} ${plural(links.length, "bridge")} and its neighbours; ${pct(share)} of the modules have three or more.`,
        advice: streets.length === 0 ? "No street was read: leave floor-level recesses of 5 m or more running along the face." : share < 0.5 ? "Give the edge modules a second and third link — bridges and streets on more floors." : "Multiple routes between work and social spaces."
      };
    }

    // ---- Layered
    {
      let fsum = 0, n = 0; const per = [];
      for (let m = 0; m < nm; m++) for (let f = 0; f < nf; f++) {
        if (!mocc(m, f)) continue; n++;
        const set = new Set();
        for (let c = mo + m * M - 1; c <= mo + m * M + M; c++) for (let r = r0 + f * FH - 1; r <= r0 + f * FH + FH; r++) {
          if (c < 0 || r < 0 || c >= cols || r >= rows) continue; const k = cls[r * cols + c]; if (k) set.add(k);
        }
        fsum += set.size; per.push({ m, f, k: set.size });
      }
      const fpc = n ? fsum / n : 0;
      let mixCols = 0, ncol = 0;
      for (let c = cmin; c <= cmax; c++) { const set = new Set(); for (let r = r0; r <= rmax; r++) { const k = cls[r * cols + c]; if (k) set.add(k); } ncol++; if (set.size >= 3) mixCols++; }
      const vmix = ncol ? mixCols / ncol : 0;
      const raw = Math.min(1, fpc / T.functions_per_cell) * soft(vmix);
      Object.assign(res.measures, { functions_per_cell: fpc, vertical_mix: vmix });
      res.features.perModuleFunc = per;
      res.ratings.Layered = rate("Layered", raw);
      res.explain.Layered = {
        terms: [t("Spatial types in or beside each module", fmt(fpc, 1), `work, gathering pocket, street, bridge, terrace, covered recess, opening · ${fmt(T.functions_per_cell, 1)} earns full marks`, Math.min(1, fpc / T.functions_per_cell)),
          t("Columns mixing three or more spatial types", pct(vmix), "share of 1 m image columns that stack different spatial types over their height", vmix)],
        text: `An occupied module has ${fmt(fpc, 1)} different functions within or directly beside it, and ${pct(vmix)} of the plan columns stack three or more functions over their height.`,
        advice: vmix < 0.4 ? "Overlap the functions vertically — terraces over streets, pockets under work." : fpc < T.functions_per_cell * 0.6 ? "Bring streets and gathering pockets right up against the work modules." : "Work, circulation and gathering overlap rather than sit in separate zones."
      };
    }

    // ---- Intimate: territories per floor
    {
      const terr = [];
      for (let f = 0; f < nf; f++) {
        const rA = r0 + f * FH, rB = rA + FH - 1;
        const comp = components((c, r) => r >= rA && r <= rB && isMass(c, r), cols, rows);
        for (const k of comp.comps) { const cs = new Set(k.cells.map(cc => cc[0])); const len = cs.size; const area = len * PSA.DEPTH; terr.push({ f, cells: k.cells, len, area, occupants: area / 10 }); }
      }
      const occs = terr.map(tt => tt.occupants);
      const meanOcc = occs.length ? sum(occs) / occs.length : 0;
      const areaTot = sum(terr.map(tt => tt.area));
      const human = sum(terr.filter(tt => tt.area >= 20 && tt.area <= 150).map(tt => tt.area));
      const share = areaTot ? human / areaTot : 0;
      const bo = band(meanOcc, 0, 4, 12, 40);
      const raw = bo * share;
      Object.assign(res.measures, { occupants_per_territory: meanOcc, human_scaled_share: share, territories: terr.length });
      res.features.territories = terr;
      res.ratings.Intimate = rate("Intimate", raw);
      res.explain.Intimate = {
        terms: [t("Estimated capacity per territory", fmt(meanOcc, 1), `at 10 m² per person, territories read ${PSA.DEPTH} m deep · best between 4 and 12`, bo),
          t("Estimated area in 20–150 m² territories", pct(share), "human-scaled rooms rather than halls or cells", share)],
        text: `${terr.length} work ${plural(terr.length, "territory", "territories")} hold ${fmt(meanOcc, 1)} people each on average; ${pct(share)} of the floor area sits in territories of 20 to 150 m².`,
        advice: meanOcc > 12 ? "The territories read as halls — subdivide the long runs of mass on each floor." : meanOcc < 4 ? "Too small to hold a group; join the smallest pieces." : "Human-scaled territories with a sense of enclosure."
      };
    }

    // ---- Visually Connected
    {
      let anyN = 0, bothN = 0, tsum = 0, n = 0; const rays = [];
      for (let m = 0; m < nm; m++) for (let f = 0; f < nf; f++) {
        if (!mocc(m, f)) continue; n++;
        const cc = mo + m * M + Math.floor(M / 2), rr = r0 + f * FH + 1;
        let hz = 0, vt = 0;
        for (const dir of [1, -1]) {
          let c = cc; while (c >= 0 && c < cols && isMass(c, rr)) c += dir;
          const start = c; let d = 0; while (c >= 0 && c < cols && !isMass(c, rr) && d <= 24) { c += dir; d++; }
          if (c >= 0 && c < cols && isMass(c, rr) && d >= 3 && d <= 24) { hz++; rays.push({ from: [start, rr], to: [c, rr], kind: "h" }); }
        }
        for (const dir of [1, -1]) {
          let r = rr; while (r >= 0 && r < rows && isMass(cc, r)) r += dir;
          const start = r; let d = 0; while (r >= 0 && r < rows && !isMass(cc, r) && d <= 24) { r += dir; d++; }
          if (r >= 0 && r < rows && isMass(cc, r) && d >= 3 && d <= 24) { vt++; rays.push({ from: [cc, start], to: [cc, r], kind: "v" }); }
        }
        if (hz + vt) anyN++; if (hz && vt) bothN++; tsum += hz + vt;
      }
      const anyS = n ? anyN / n : 0, bothS = n ? bothN / n : 0, tpm = n ? tsum / n : 0;
      const raw = 0.5 * (anyS + bothS) * Math.min(1, tpm / T.targets_per_module);
      Object.assign(res.measures, { sightline_pct: 100 * anyS, both_view_pct: 100 * bothS, targets_per_module: tpm });
      res.features.rays = rays;
      res.ratings["Visually Connected"] = rate("Visually Connected", raw);
      res.explain["Visually Connected"] = {
        terms: [t("Modules with a sightline", pct(anyS), "a straight view across 3–24 m of void or recess to another territory or level", anyS),
          t("Seeing another territory and another level", pct(bothS), "both along the floor and up or down", bothS),
          t("Views per module", fmt(tpm, 1), `distinct targets in view · ${fmt(T.targets_per_module, 1)} earns full marks`, Math.min(1, tpm / T.targets_per_module))],
        text: `${pct(anyS)} of the occupied modules look across open space at another territory or level; ${pct(bothS)} see both another territory and another level, with ${fmt(tpm, 1)} views per module on average.`,
        advice: anyS < 0.5 ? "Open the face with voids of 3 to 24 m so modules face each other." : bothS < 0.4 ? "Add vertical views — voids that run through several floors." : "Modules keep visual relationships across levels and voids."
      };
    }

    // ---- Socially Interactive
    {
      const near = (c, r, dmax) => { for (const [pc, pr] of pocketCells) if (Math.max(Math.abs(pc - c), Math.abs(pr - r)) <= dmax) return true; return false; };
      const contacts = [];
      for (const s of streets) for (const k of pockets) {
        let hit = false;
        for (const [pc, pr] of k.cells) if (Math.abs(pr - s.r) <= 1 && pc >= s.c0 - 1 && pc <= s.c1 + 1) { hit = true; break; }
        if (hit) contacts.push({ street: s, pocket: k.id });
      }
      let scells = 0, snear = 0;
      for (const s of streets) for (let c = s.c0; c <= s.c1; c++) { scells++; if (near(c, s.r, 5)) snear++; }
      const share = scells ? snear / scells : 0;
      const raw = Math.min(1, contacts.length / T.encounter_points) * soft(share);
      Object.assign(res.measures, { encounter_points: contacts.length, street_near_gather: share, street_cells: scells });
      res.features.contacts = contacts;
      res.ratings["Socially Interactive"] = rate("Socially Interactive", raw);
      res.explain["Socially Interactive"] = {
        terms: [t("Street–pocket contacts", `${contacts.length}`, `candidate pocket–street pairs (a pocket may meet multiple streets) · ${T.encounter_points} earns full marks`, Math.min(1, contacts.length / T.encounter_points)),
          t("Street within 5 m of a pocket", pct(share), "share of street length that passes a gathering pocket", share)],
        text: streets.length ? `${contacts.length} gathering ${plural(contacts.length, "pocket")} open directly onto the ${streets.length} major ${plural(streets.length, "street")}, and ${pct(share)} of the street length runs within 5 m of one.` : "No street (a floor-level recess of 5 m or more running along the face) was read, so circulation does not create encounters.",
        advice: !streets.length ? "Give the form streets: floor-level recesses of 5 m or more running along the face." : contacts.length < T.encounter_points * 0.5 ? "Open the gathering pockets onto the streets instead of burying them in the mass." : "Circulation and shared space meet along the streets."
      };
    }

    // ---- Village-Like
    {
      const a = Math.min(1, clusters.length / T.village_clusters), b = Math.min(1, streets.length / T.streets), c = Math.min(1, pockets.length / T.nodes);
      const raw = Math.cbrt(a * b * c);
      Object.assign(res.measures, { village_clusters: clusters.length, streets: streets.length, nodes: pockets.length });
      res.ratings["Village-Like"] = rate("Village-Like", raw);
      const weakest = [["work clusters", a], ["streets", b], ["gathering nodes", c]].sort((x, y) => x[1] - y[1])[0];
      res.explain["Village-Like"] = {
        terms: [t("Work clusters", `${clusters.length}`, `${T.village_clusters} earns full marks`, a),
          t("Streets", `${streets.length}`, `${T.streets} earns full marks`, b),
          t("Gathering nodes", `${pockets.length}`, `${T.nodes} earns full marks`, c)],
        text: `${clusters.length} work ${plural(clusters.length, "cluster")}, ${streets.length} ${plural(streets.length, "street")} and ${pockets.length} gathering ${plural(pockets.length, "node")} — each counted against its target (3, 3 and 5) and added with the weights shown.`,
        advice: weakest[1] < 0.6 ? `The weakest ingredient is the ${weakest[0]} — a village needs all three.` : "Reads as a community of territories, streets and shared places."
      };
    }

    function rate(word, raw) {
      if (!Number.isFinite(raw)) raw = 0;
      const s = T.scale[word] || 1;
      res.measures["raw_" + word] = raw;
      return Math.max(0, Math.min(100, Math.round(100 * raw / s)));
    }
    function t(name, value, note, norm) { return { name, value, note, norm: clamp01(isNaN(norm) ? 0 : norm) }; }
    return res;
  };


  // ---------------------------------------------------------------- recognising frames of the animation
  /* Box-filter resize of a grey image to tw x th. */
  PSA.resizeGray = function (g, w, h, tw, th) {
    const out = new Float32Array(tw * th);
    for (let ty = 0; ty < th; ty++) {
      const y0 = Math.floor(ty * h / th), y1 = Math.max(y0 + 1, Math.floor((ty + 1) * h / th));
      for (let tx = 0; tx < tw; tx++) {
        const x0 = Math.floor(tx * w / tw), x1 = Math.max(x0 + 1, Math.floor((tx + 1) * w / tw));
        let s = 0, n = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += g[y * w + x]; n++; }
        out[ty * tw + tx] = s / n;
      }
    }
    return out;
  };
  PSA.THUMB = { w: 96, h: 54, pxPerM: 1920 * 50 / 36 * 0.14 / (15.5 - 1.885) * 96 / 1920 };   // frame thumbnails and their scale
  /* Normalised cross-correlation of a small template over every thumbnail. thumbs: array of Float32Array(96*54). */
  PSA.matchFrame = function (g, w, h, thumbs, pitch) {
    const TW = PSA.THUMB.w, TH = PSA.THUMB.h;
    const ncc = (a, b) => { let sa = 0, sb = 0; for (let i = 0; i < a.length; i++) { sa += a[i]; sb += b[i]; } const ma = sa / a.length, mb = sb / a.length; let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < a.length; i++) { const da = a[i] - ma, db = b[i] - mb; sab += da * db; saa += da * da; sbb += db * db; } return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0; };
    const aspect = w / h;
    if (Math.abs(aspect - 16 / 9) < 0.06) {                          // a whole frame
      const t = PSA.resizeGray(g, w, h, TW, TH);
      let best = { frame: 0, corr: -1 };
      thumbs.forEach((th, i) => { const c = ncc(t, th); if (c > best.corr) best = { frame: i + 1, corr: c }; });
      return Object.assign(best, { full: true, x: 0, y: 0, scale: TW / w });
    }
    if (!pitch) return null;
    // template at one scale: zero-mean, with its norm
    const template = k => {
      const s = PSA.THUMB.pxPerM / (pitch * k), cw = Math.round(w * s), ch = Math.round(h * s);
      if (cw < 8 || ch < 6 || cw > TW || ch > TH) return null;
      const a = PSA.resizeGray(g, w, h, cw, ch);
      let ma = 0; for (let i = 0; i < a.length; i++) ma += a[i]; ma /= a.length;
      let saa = 0; for (let i = 0; i < a.length; i++) { a[i] -= ma; saa += a[i] * a[i]; }
      return saa > 0 ? { a, cw, ch, saa, s, k } : null;
    };
    const corrAt = (tp, th, x, y) => {
      const { a, cw, ch, saa } = tp; let sb = 0;
      for (let j = 0; j < ch; j++) { const o = (y + j) * TW + x; for (let i = 0; i < cw; i++) sb += th[o + i]; }
      const mb = sb / a.length; let sab = 0, sbb = 0;
      for (let j = 0; j < ch; j++) { const o = (y + j) * TW + x, oa = j * cw; for (let i = 0; i < cw; i++) { const db = th[o + i] - mb; sab += a[oa + i] * db; sbb += db * db; } }
      return sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
    };
    // stage 1: one scale, every other position, all frames
    const t1 = template(1.0); if (!t1) return null;
    const coarse = thumbs.map((th, f) => {
      let b = { corr: -1, x: 0, y: 0 };
      for (let y = 0; y + t1.ch <= TH; y += 2) for (let x = 0; x + t1.cw <= TW; x += 2) { const c = corrAt(t1, th, x, y); if (c > b.corr) b = { corr: c, x, y }; }
      return Object.assign(b, { frame: f + 1 });
    }).sort((p, q) => q.corr - p.corr).slice(0, 6);
    // stage 2: the best frames, every scale, every position near the coarse hit
    let best = { corr: -1 };
    for (const k of [0.94, 0.97, 1.0, 1.03, 1.06]) {
      const tp = template(k); if (!tp) continue;
      for (const c0 of coarse) {
        const th = thumbs[c0.frame - 1];
        for (let y = Math.max(0, c0.y - 3); y <= Math.min(TH - tp.ch, c0.y + 3); y++) for (let x = Math.max(0, c0.x - 3); x <= Math.min(TW - tp.cw, c0.x + 3); x++) {
          const c = corrAt(tp, th, x, y);
          if (c > best.corr) best = { corr: c, frame: c0.frame, x, y, scale: tp.s, k };
        }
      }
    }
    return best.corr > -1 ? Object.assign(best, { full: false }) : null;
  };
  /* Where a matched image sits on the slab: bays covered, and the nearest of the five analysed zone windows. */
  PSA.locate = function (match, w, h) {
    const F_PX = 1920 * 50 / 36, t = 15.5 - 1.885, ppmFrame = F_PX * 0.14 / t;   // frame px per metre at the front face
    const up = 1920 / PSA.THUMB.w;                                                        // thumb px -> frame px
    const fx0 = match.x * up, fx1 = (match.x + w * match.scale) * up;
    const uBay = b => 960 + F_PX * (-8.54 + 0.14 * (3 + 9 * (b - 1)) - 0.07) / t;           // left edge of bay b
    const mFrom = (fx0 - uBay(1)) / ppmFrame, mTo = (fx1 - uBay(1)) / ppmFrame;              // metres from the start of bay 1
    const centreBay = 1 + (mFrom + mTo) / 2 / 9;                                              // fractional bay at the centre
    const bay = Math.max(4, Math.min(8, Math.round(centreBay - 1.5)));                        // zone = bays bay..bay+2
    return { mFrom, mTo, bay, offsetM: ((mFrom + mTo) / 2) - ((bay - 1) * 9 + 13.5), bayFrom: 1 + mFrom / 9, bayTo: 1 + mTo / 9 };
  };

  if (typeof module !== "undefined" && module.exports) module.exports = PSA; else root.PSA = PSA;
})(typeof window !== "undefined" ? window : globalThis);


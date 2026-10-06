/* ProtoSpace Analyzer — the Program tab's maths: the five bays of a frame, rated for three uses.
   A frame has five bays: equal parts across its length, the full height and depth of the slab. For each bay:
     ratings   the twelve descriptors, read by js/analyzer.js from the bay's own depth grid
     measures  counted straight from the bay's cubes (solids, voids, floors with headroom, cover, ground, see-through)
     programs  Lobby, Gathering and Working, 0–100: 60 % from the descriptors that matter for that use, 40 % from the measures
   Pure ES module (no DOM): the page uses it, and it runs in Node for checks. */

export const BAYS = 5;                                   // five bays per frame, each as square as the slab allows
export const PROGRAMS = {
  lobby: {
    name: 'Lobby', short: 'L', blurb: 'An arrival hall: open at the ground, easy to see across and to move through, and connected to the rest.',
    words: { 'Porous': 0.25, 'Visually Connected': 0.25, 'Networked': 0.2, 'Socially Interactive': 0.15, 'Layered': 0.15 },
    measures: [['hall', 0.4, 'a roofed hall at the ground'], ['groundVoid', 0.35, 'open ground floor'], ['openness', 0.25, 'open, not stuffed with mass']],
  },
  gathering: {
    name: 'Gathering', short: 'G', blurb: 'Places to meet: sheltered pockets off the routes, in clusters, near each other.',
    words: { 'Socially Interactive': 0.25, 'Decentralized': 0.2, 'Clustered': 0.15, 'Village-Like': 0.15, 'Intimate': 0.15, 'Layered': 0.1 },
    measures: [['coveredFloor', 0.4, 'sheltered floor (something overhead)'], ['pockets', 0.35, 'gathering pockets in the face'], ['floor', 0.25, 'floor with headroom']],
  },
  working: {
    name: 'Working', short: 'W', blurb: 'Quiet, repeatable rooms to work in: level floors with headroom, enclosure, a clear module.',
    words: { 'Modular': 0.3, 'Intimate': 0.25, 'Clustered': 0.15, 'Layered': 0.15, 'Interlocking': 0.15 },
    measures: [['floor', 0.4, 'floor with headroom'], ['structure', 0.3, 'enough mass to make rooms'], ['enclosure', 0.3, 'enclosed, not see-through']],
  },
};
export const PROGRAM_KEYS = Object.keys(PROGRAMS);
export const MEASURE_NAMES = {
  solidShare: 'solid cubes', voidShare: 'empty cubes', floor: 'floor with headroom', coveredFloor: 'sheltered floor', hall: 'roofed hall at the ground',
  groundVoid: 'open ground', seeThrough: 'see-through columns', frontMass: 'mass at the front', pockets: 'gathering pockets', streets: 'streets', openings: 'openings',
  openness: 'openness', structure: 'structure', enclosure: 'enclosure',
};

const clamp01 = v => Math.max(0, Math.min(1, v));
/* 0 below `a`, 1 from `b` on (or the reverse when b < a). */
const ramp = (v, a, b) => clamp01((v - a) / (b - a));
/* 1 between lo and hi, falling to 0 at lo − w and hi + w. */
const band = (v, lo, hi, w) => v < lo ? ramp(v, lo - w, lo) : v > hi ? 1 - ramp(v, hi, hi + w) : 1;

/* The bays of a slab: five equal parts across its length, the full height and depth (123 m → 25 / 24 / 25 / 24 / 25 m). */
export function bayBoxes(vox, n = BAYS) {
  const out = [];
  for (let i = 0; i < n; i++) { const x0 = Math.round(i * vox.nx / n), x1 = Math.round((i + 1) * vox.nx / n); if (x1 > x0) out.push({ i, x0, x1, y0: 0, y1: vox.ny, z0: 0, z1: vox.nz }); }
  return out;
}

/* What the cubes of a bay add up to. All shares are 0..1; areas in m² (1 cube = 1 m). */
export function measureBay(vox, thr, b, result) {
  const { nx, ny, nz, sizes } = vox;
  const idx = (x, y, z) => x + nx * (y + ny * z);
  const solidAt = (x, y, z) => y >= 0 && y < ny && z >= 0 && z < nz && sizes[idx(x, y, z)] >= thr;
  const w = b.x1 - b.x0, cells = w * ny * nz;
  let solid = 0, floor = 0, covered = 0, hall = 0, groundVoid = 0, seeThrough = 0, frontMass = 0;
  const overhead = (x, y, z) => { for (let yy = y + 3; yy < ny; yy++) if (solidAt(x, yy, z)) return true; return false; };
  for (let x = b.x0; x < b.x1; x++) for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      if (solidAt(x, y, z)) { solid++; continue; }
      const headroom = !solidAt(x, y + 1, z) && !solidAt(x, y + 2, z);
      if (y < 3) { groundVoid++; if (y === 0 && headroom && overhead(x, y, z)) hall++; }
      // a floor: empty, standing on mass, with 3 m of headroom (the bare ground does not count as a floor)
      if (y > 0 && solidAt(x, y - 1, z) && headroom) { floor++; if (overhead(x, y, z)) covered++; }
    }
  }
  for (let x = b.x0; x < b.x1; x++) for (let y = 0; y < ny; y++) {
    let z0 = -1; for (let z = 0; z < nz; z++) if (solidAt(x, y, z)) { z0 = z; break; }
    if (z0 < 0) seeThrough++; else if (z0 < 3) frontMass++;
  }
  const F = result && !result.features.empty ? result.features : null;
  const face = w * ny, plan = w * nz;
  const m = {
    solidShare: solid / cells, voidShare: 1 - solid / cells,
    floor, floorShare: floor / (plan * Math.max(1, Math.floor(ny / 3) - 1)),       // against one floor per 3 m level above the ground
    coveredFloor: covered, coveredShare: floor ? covered / floor : 0,
    hall, hallShare: hall / plan,
    groundVoid: groundVoid / (w * 3 * nz),
    seeThrough: seeThrough / face, frontMass: frontMass / face,
    pockets: F ? F.pockets.length : 0, streets: F ? F.streets.length : 0, openings: F ? F.openings.length : 0,
  };
  // normalised 0..1 readings the programs use
  m.n = {
    groundVoid: ramp(m.groundVoid, 0.25, 0.75),
    openness: band(m.solidShare, 0.15, 0.4, 0.2),
    hall: ramp(m.hallShare, 0.08, 0.45),
    coveredFloor: ramp(m.coveredShare, 0.15, 0.6),
    pockets: ramp(m.pockets, 0, 3),
    floor: ramp(m.floorShare, 0.05, 0.3),
    structure: band(m.solidShare, 0.3, 0.6, 0.2),
    enclosure: 1 - ramp(m.seeThrough, 0.1, 0.5),
  };
  return m;
}

/* Lobby / Gathering / Working scores for one bay, each 0..100 with its two halves and the pieces behind them. */
export function programScores(ratings, measures, empty) {
  const out = {};
  for (const [key, P] of Object.entries(PROGRAMS)) {
    const wsum = Object.values(P.words).reduce((a, b) => a + b, 0);
    let ws = 0; const words = [];
    for (const [w, wt] of Object.entries(P.words)) { const v = empty ? 0 : (ratings[w] ?? 0); ws += wt * v; words.push({ word: w, weight: wt / wsum, value: v }); }
    const wordScore = ws / wsum;                                              // 0..100
    let ms = 0; const parts = [];
    for (const [k, wt, label] of P.measures) { const v = measures.n[k]; ms += wt * v; parts.push({ key: k, label, weight: wt, value: v }); }
    const measureScore = ms * 100;
    out[key] = { score: Math.round(0.6 * wordScore + 0.4 * measureScore), wordScore: Math.round(wordScore), measureScore: Math.round(measureScore), words, parts };
  }
  return out;
}

/* The cubes to light up in red for one kind of reading of a bay: a list of [x, y, z]. */
export function highlightCells(vox, thr, b, kind, result) {
  const { nx, ny, nz, sizes } = vox;
  const idx = (x, y, z) => x + nx * (y + ny * z);
  const solidAt = (x, y, z) => y >= 0 && y < ny && z >= 0 && z < nz && sizes[idx(x, y, z)] >= thr;
  const out = [];
  const eachCol = fn => { for (let x = b.x0; x < b.x1; x++) for (let z = 0; z < nz; z++) fn(x, z); };
  if (kind === 'solids') { eachCol((x, z) => { for (let y = 0; y < ny; y++) if (solidAt(x, y, z)) out.push([x, y, z]); }); return out; }
  if (kind === 'voids') {                                                     // empty cubes with mass on three or more of their six sides
    const sAt = (x, y, z) => x >= 0 && x < nx && solidAt(x, y, z);
    eachCol((x, z) => { for (let y = 0; y < ny; y++) { if (solidAt(x, y, z)) continue; const n = sAt(x - 1, y, z) + sAt(x + 1, y, z) + sAt(x, y - 1, z) + sAt(x, y + 1, z) + sAt(x, y, z - 1) + sAt(x, y, z + 1); if (n >= 3) out.push([x, y, z]); } });
    return out;
  }
  const overhead = (x, y, z) => { for (let yy = y + 3; yy < ny; yy++) if (solidAt(x, yy, z)) return true; return false; };
  if (kind === 'floor' || kind === 'covered' || kind === 'hall' || kind === 'ground') {
    eachCol((x, z) => { for (let y = 0; y < ny; y++) {
      if (solidAt(x, y, z)) continue;
      const headroom = !solidAt(x, y + 1, z) && !solidAt(x, y + 2, z);
      if (kind === 'ground') { if (y < 3) out.push([x, y, z]); continue; }
      if (kind === 'hall') { if (y === 0 && headroom && overhead(x, y, z)) { out.push([x, 0, z]); out.push([x, 1, z]); out.push([x, 2, z]); } continue; }
      if (!(y > 0 && solidAt(x, y - 1, z) && headroom)) continue;
      if (kind === 'floor' || overhead(x, y, z)) out.push([x, y, z]);
    } });
    return out;
  }
  if (kind === 'seeThrough') { for (let x = b.x0; x < b.x1; x++) for (let y = 0; y < ny; y++) { let any = false; for (let z = 0; z < nz; z++) if (solidAt(x, y, z)) { any = true; break; } if (!any) for (let z = 0; z < nz; z++) out.push([x, y, z]); } return out; }
  const F = result && !result.features.empty ? result.features : null; if (!F) return out;
  // the analyzer's face readings: light the empty run from the face to the first cube of each cell
  const faceRun = (c, r) => { const x = b.x0 + c, y = r; for (let z = 0; z < nz; z++) { if (solidAt(x, y, z)) break; out.push([x, y, z]); } };
  if (kind === 'pockets') F.pockets.forEach(p => p.cells.forEach(([c, r]) => faceRun(c, r)));
  if (kind === 'streets') F.streets.forEach(s => { for (let c = s.c0; c <= s.c1; c++) faceRun(c, s.r); });
  if (kind === 'openings') F.openings.forEach(o => o.cells.forEach(([c, r]) => faceRun(c, r)));
  return out;
}
export const HIGHLIGHTS = [
  ['solids', 'Solids · every cube of mass'], ['voids', 'Voids · empty cubes with mass on three or more sides'], ['floor', 'Floors · standing on mass with 3 m of headroom'],
  ['covered', 'Sheltered floors · floors with mass overhead'], ['hall', 'Roofed hall · ground with headroom and mass overhead'], ['ground', 'Open ground · the empty bottom 3 m'], ['seeThrough', 'See-through · columns with no mass at all'],
  ['pockets', 'Gathering pockets · recesses of 12 m² or more'], ['streets', 'Streets · floor-level recesses 5 m or longer'], ['openings', 'Openings · holes through the face'],
];

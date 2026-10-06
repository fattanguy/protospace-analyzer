/* ProtoSpace Analyzer — page logic. Depends on PSA (analyzer.js) and PSDATA (data.js). */
(function () {
  const $ = s => document.querySelector(s);
  const WORDS = PSA.WORDS, ABBR = PSA.ABBR;
  const D = window.PSDATA;
  const KEYS = D.db.keys;
  const zoneIndex = new Map();
  D.db.zones.forEach(z => zoneIndex.set(z[0] + ":" + z[1], z));
  // rating distributions of the 1,250 zones, for percentiles
  const dist = {}; WORDS.forEach((w, i) => { dist[w] = D.db.zones.map(z => z[2][i]).sort((a, b) => a - b); });
  const percentile = (w, v) => { const a = dist[w]; let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; } return Math.round(100 * lo / a.length); };

  // ---- the point-cloud measures, worded as on the boards
  function measures3D(z) { const m = {}; KEYS.forEach((k, i) => m[k] = z[3][i]); m.cluster_sizes = z[4]; return m; }
  const f0 = v => Math.round(v).toLocaleString("en-US"), f1 = v => (Math.round(v * 10) / 10).toFixed(1), p0 = v => Math.round(100 * v) + "%";
  function rawText3D(w, m) {
    switch (w) {
      case "Modular": return `${f0(m.modular_pct)}% of floor area in complete modules · ${m.modules_full} complete, ${m.modules_empty} empty of 54 cells`;
      case "Fragmented": return `${m.islands} work islands · ${p0(m.cohesion)} of the mass joined in one body`;
      case "Interlocking": return `${m.conn_h} horizontal + ${m.conn_v} vertical connections · ${m.conn_interlock} of them interlocking`;
      case "Porous": return `${f0(m.void_pct)}% void · ${m.openings} openings pierce the zone`;
      case "Clustered": return `${m.clusters} clusters of ${f1(m.modules_per_cluster)} modules on average · sizes ${m.cluster_sizes.join(", ")}`;
      case "Decentralized": return `${f1(m.dist_to_gather)} m average to the nearest gathering space · ${m.gather_nodes} spaces on ${m.gather_floors} floors`;
      case "Networked": return `${f1(m.circ_per_module)} circulation connections per module · ${p0(m.circ_multi_share)} of modules have 3 or more`;
      case "Layered": return `${f1(m.functions_per_cell)} functions per module cell · ${p0(m.vertical_mix)} of plan columns mix 3+ functions`;
      case "Intimate": return `${f1(m.occupants_per_territory)} occupants per territory · ${p0(m.human_scaled_share)} of area in 20–150 m² territories`;
      case "Visually Connected": return `${f0(m.sightline_pct)}% of modules have a sightline · ${f0(m.both_view_pct)}% see another territory and another level`;
      case "Socially Interactive": return `${m.encounter_points} gathering spaces on major streets · ${p0(m.street_near_gather)} of streets within 5 m of one`;
      case "Village-Like": return `${m.village_clusters} work clusters · ${m.streets} streets · ${m.gather_nodes} gathering nodes`;
    }
  }
  function howText(w) {
    const t = D.db.targets, fmtT = {};
    Object.keys(t).forEach(k => fmtT[k] = t[k]);
    return D.criteria[w][2].replace(/\{(\w+):\.(\d)f\}/g, (_, k, d) => Number(fmtT[k]).toFixed(+d));
  }

  // ---- state
  const S = { items: [], current: null, word: "Porous", view: "image", thumbs: null, drag: null };

  // ---- thumbnails of the 250 frames from the sprite
  function loadThumbs() {
    return new Promise(res => {
      const im = new Image();
      im.onload = () => {
        const c = document.createElement("canvas"); c.width = im.width; c.height = im.height;
        const x = c.getContext("2d"); x.drawImage(im, 0, 0);
        let d; try { d = x.getImageData(0, 0, c.width, c.height).data; } catch (e) { console.warn("Frame recognition is off: the frame sprite could not be read. Serve the page over http(s) rather than opening the file directly.", e); res(null); return; }
        const thumbs = [];
        for (let f = 0; f < 250; f++) { const t = new Float32Array(96 * 54); for (let i = 0; i < t.length; i++) t[i] = d[((f * 54 * 96) + i) * 4] / 255; thumbs.push(t); }
        res(thumbs);
      };
      im.onerror = () => res(null);
      im.src = D.sprite;
    });
  }

  // ---- importing
  function addFiles(files) {
    let motion = false;
    for (const file of files) {
      if (file.type === 'image/gif' || /\.gif$/i.test(file.name) || /^video\//.test(file.type) || /\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name)) {
        if (motion) { $('#mediaStatus').textContent += ' Open additional animations one at a time.'; continue; }
        motion = true; openMedia(file);
      } else if (/^image\//.test(file.type)) {
        addImage(URL.createObjectURL(file), file.name.replace(/\.[^.]+$/, ''), false);
      } else setStatus('Unsupported file. Choose an image, GIF, or browser-compatible video.');
    }
  }

  const M = { token: 0, decoder: null, url: null, index: 0, times: [], playing: false, timer: null, busy: false, kind: null, name: '' };
  const video = $('#mediaVideo'), gif = $('#mediaGif'), seek = $('#mediaSeek');
  function stamp(t) { return Math.floor(t / 60) + ':' + (t % 60).toFixed(3).padStart(6, '0'); }
  function mediaButtons(enabled) {
    ['mediaPlay','mediaPrev','mediaNext','mediaSeek','mediaAnalyze'].forEach(id => $('#' + id).disabled = !enabled);
  }
  function pauseMedia() {
    M.playing = false; clearTimeout(M.timer); video.pause(); $('#mediaPlay').textContent = 'Play';
  }
  function mediaPosition() {
    const t = M.kind === 'gif' ? M.times[M.index] || 0 : video.currentTime;
    seek.value = M.kind === 'gif' ? M.index : t;
    $('#mediaTime').textContent = stamp(t) + (M.kind === 'gif' ? ' · frame ' + (M.index + 1) + '/' + M.times.length : ' / ' + stamp(video.duration || 0));
  }
  async function drawGif(index, token = M.token) {
    M.busy = true; mediaButtons(false);
    try {
      const result = await M.decoder.decode({frameIndex: index});
      try {
        if (token !== M.token) return;
        gif.width = result.image.displayWidth; gif.height = result.image.displayHeight;
        gif.getContext('2d').drawImage(result.image, 0, 0);
        M.index = index; mediaPosition();
      } finally { result.image.close(); }
    } finally { if (token === M.token) { M.busy = false; mediaButtons(true); } }
  }
  async function gifTick() {
    if (!M.playing) return;
    const token = M.token;
    const delay = (M.times[M.index + 1] ?? M.duration) - M.times[M.index];
    M.timer = setTimeout(async () => {
      try {
        if (!M.playing || token !== M.token) return;
        await drawGif((M.index + 1) % M.times.length, token);
        if (token === M.token) gifTick();
      } catch (err) { mediaFailure(err, token); }
    }, Math.max(20, delay * 1000));
  }
  function mediaFailure(err, token = M.token) {
    if (token !== M.token) return;
    pauseMedia(); mediaButtons(false);
    $('#mediaStatus').textContent = err.message || 'Unable to read this media file.';
  }
  async function openMedia(file) {
    const token = ++M.token;
    pauseMedia(); mediaButtons(false);
    if (M.decoder) { M.decoder.close(); M.decoder = null; }
    video.removeAttribute('src'); video.load();
    if (M.url) URL.revokeObjectURL(M.url);
    M.url = null; M.busy = false; M.name = file.name;
    $('#mediaPanel').hidden = false; $('#navMedia').hidden = false; $('#mediaName').textContent = file.name;
    $('#mediaStatus').textContent = 'Loading media…';
    M.kind = file.type === 'image/gif' || /\.gif$/i.test(file.name) ? 'gif' : 'video';
    video.hidden = M.kind !== 'video'; gif.hidden = M.kind !== 'gif';
    try {
      if (M.kind === 'gif') {
        if (!('ImageDecoder' in window)) throw new Error('GIF frame controls require a recent Chrome or Edge browser. You can also import this animation as an MP4 video.');
        const data = await file.arrayBuffer();
        if (token !== M.token) return;
        const decoder = new ImageDecoder({data, type: 'image/gif', preferAnimation: true});
        M.decoder = decoder;
        await decoder.tracks.ready;
        const count = decoder.tracks.selectedTrack.frameCount;
        M.times = []; M.duration = 0;
        for (let i = 0; i < count; i++) {
          const {image} = await decoder.decode({frameIndex:i});
          if (token !== M.token) { image.close(); return; }
          M.times.push(M.duration); M.duration += Math.max(20000, image.duration || 100000) / 1000000; image.close();
          if (i % 20 === 0) $('#mediaStatus').textContent = 'Reading GIF frame ' + (i+1) + ' of ' + count + '…';
        }
        seek.max = count - 1; seek.step = 1; M.index = 0;
        await drawGif(0, token);
        if (token !== M.token) return;
        $('#mediaStatus').textContent = 'GIF ready. Choose a frame to analyze.';
      } else {
        M.url = URL.createObjectURL(file); video.src = M.url;
      }
    } catch (err) { mediaFailure(err, token); }
  }
  video.addEventListener('loadeddata', () => {
    if (M.kind !== 'video') return;
    if (!Number.isFinite(video.duration) || video.duration <= 0) return mediaFailure(new Error('This video has no readable duration. Try an MP4 or WebM file.'));
    seek.max = video.duration; seek.step = '0.001'; mediaButtons(true); mediaPosition();
    $('#mediaStatus').textContent = 'Video ready. Choose a moment to analyze.';
  });
  video.addEventListener('error', () => { if (M.kind === 'video' && video.getAttribute('src')) mediaFailure(new Error('This video could not be decoded. Try an MP4 (H.264) or WebM file.')); });
  video.addEventListener('timeupdate', mediaPosition);
  video.addEventListener('play', () => $('#mediaPlay').textContent = 'Pause');
  video.addEventListener('pause', () => $('#mediaPlay').textContent = 'Play');
  video.addEventListener('seeking', () => $('#mediaAnalyze').disabled = true);
  video.addEventListener('seeked', () => { $('#mediaAnalyze').disabled = false; mediaPosition(); });
  $('#mediaPlay').onclick = async () => {
    if (M.kind === 'gif') {
      if (M.playing) pauseMedia();
      else { M.playing = true; $('#mediaPlay').textContent = 'Pause'; gifTick(); }
    } else if (video.paused) { try { await video.play(); } catch (err) { $('#mediaStatus').textContent = err.message; } }
    else pauseMedia();
  };
  async function moveMedia(value) {
    pauseMedia();
    if (M.kind === 'gif') { try { await drawGif(Math.max(0, Math.min(M.times.length - 1, Math.round(value)))); } catch(err) { mediaFailure(err); } }
    else video.currentTime = Math.max(0, Math.min(video.duration, value));
  }
  seek.oninput = () => moveMedia(+seek.value);
  $('#mediaPrev').onclick = () => moveMedia(M.kind === 'gif' ? M.index - 1 : video.currentTime - 0.1);
  $('#mediaNext').onclick = () => moveMedia(M.kind === 'gif' ? M.index + 1 : video.currentTime + 0.1);
  $('#mediaAnalyze').onclick = () => {
    if (M.busy || (M.kind === 'video' && (video.seeking || video.readyState < 2))) return;
    pauseMedia();
    const c = document.createElement('canvas'), src = M.kind === 'gif' ? gif : video;
    c.width = M.kind === 'gif' ? gif.width : video.videoWidth;
    c.height = M.kind === 'gif' ? gif.height : video.videoHeight;
    c.getContext('2d').drawImage(src, 0, 0);
    const name = M.name + ' · ' + stamp(M.kind === 'gif' ? M.times[M.index] : video.currentTime) + (M.kind === 'gif' ? ' · frame ' + (M.index + 1) : '');
    c.toBlob(blob => { if (blob) addImage(URL.createObjectURL(blob), name, false); }, 'image/png');
    $('#mediaStatus').textContent = 'Saved ' + name + ' for analysis below. Choose another moment to compare.';
  };

  function addImage(src, name, isExample) {
    const im = new Image();
    im.onload = () => {
      const item = { id: Math.random().toString(36).slice(2), name, im, isExample, ready: false };
      if (src.startsWith("blob:")) URL.revokeObjectURL(src);
      S.items.push(item);
      renderGallery();
      select(item);
    };
    im.onerror = () => { if (src.startsWith("blob:")) URL.revokeObjectURL(src); setStatus("Unable to read this image. Try another file."); };
    im.src = src;
  }

  // ---- analysis of an item
  function prepare(item) {
    // working copy at most 1400 px wide
    const sc = Math.min(1, 1400 / item.im.naturalWidth);
    const w = Math.round(item.im.naturalWidth * sc), h = Math.round(item.im.naturalHeight * sc);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d"); x.drawImage(item.im, 0, 0, w, h);
    const rgba = x.getImageData(0, 0, w, h).data;
    let g = PSA.gray(rgba, w, h);
    item.inverted = !!item.inverted;                      // white cubes on black: flip the tone (manual switch)
    if (item.inverted) for (let i = 0; i < g.length; i++) g[i] = 1 - g[i];
    item.canvas = c; item.w = w; item.h = h; item.g = g;
    const det = PSA.detectPitch(g, w, h);
    item.detPitch = det.pitch; item.detConf = det.confidence;
    item.match = S.thumbs ? PSA.matchFrame(g, w, h, S.thumbs, det.pitch) : null;
    const strong = item.match && item.match.corr >= (item.match.full ? 0.93 : 0.9);
    item.recognised = !!strong;
    if (item.recognised) {
      if (item.match.full) { item.pitch = (1920 * 50 / 36 * 0.14 / (15.5 - 1.885)) * (w / 1920); item.bay = 6; }
      else { item.pitch = PSA.THUMB.pxPerM / item.match.scale; item.loc = PSA.locate(item.match, w, h); item.bay = item.loc.bay; }
    } else {
      item.pitch = det.pitch || w / 31;                   // fall back to "about 31 m across"
    }
    item.userPitch = null;
    item.region = null;
    item.ready = true;
  }
  function regionOf(item) {
    if (item.region) return item.region;
    if (item.recognised && item.match.full) {             // the selected zone window plus 2 m of context
      const F_PX = 1920 * 50 / 36, t = 15.5 - 1.885, sc = item.w / 1920;
      const iy0 = 3 + 9 * (item.bay - 1), iy1 = iy0 + 26;
      const u0 = (960 + F_PX * (-8.54 + 0.14 * iy0 - 0.07) / t) * sc, u1 = (960 + F_PX * (-8.54 + 0.14 * iy1 + 0.07) / t) * sc;
      const v0 = (540 - F_PX * 1.33 / t) * sc, v1 = (540 + F_PX * 1.33 / t) * sc, ppm = (u1 - u0) / 27;
      return { x0: Math.round(u0 - 2 * ppm), y0: Math.round(v0), x1: Math.round(u1 + 2 * ppm), y1: Math.round(v1) };
    }
    return { x0: 0, y0: 0, x1: item.w, y1: item.h };
  }
  function analyzeItem(item) {
    const R = regionOf(item);
    const rw = R.x1 - R.x0, rh = R.y1 - R.y0;
    const sub = new Float32Array(rw * rh);
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) sub[y * rw + x] = item.g[(R.y0 + y) * item.w + R.x0 + x];
    const pitch = item.userPitch || item.pitch;
    item.grid = PSA.makeGrid(sub, rw, rh, { pitch });
    item.result = PSA.analyze(item.grid);
    item.R = R;
    const reviewKey = JSON.stringify([R, pitch, item.inverted, item.bay]);
    if (item.reviewKey !== reviewKey) item.reviews = {};
    item.reviewKey = reviewKey;
    // point-cloud ratings for the recognised zone
    item.zone3D = item.recognised ? zoneIndex.get(item.match.frame + ":" + item.bay) : null;
  }

  // ---- selection and rendering
  function select(item) {
    S.current = item;
    renderGallery();
    setStatus(item.isExample ? "Reading the example…" : "Reading the image…");
    setTimeout(() => {
      if (S.current !== item) return;
      if (!item.ready) prepare(item);
      analyzeItem(item);
      renderAll();
    }, 20);
  }
  function setStatus(t) { $("#status").textContent = t; }

  function renderGallery() {
    const g = $("#gallery"); g.innerHTML = "";
    S.items.forEach(item => {
      const b = document.createElement("button"); b.className = "thumb" + (item === S.current ? " on" : ""); b.type = "button";
      b.title = item.name; b.setAttribute("aria-label", "Select " + item.name);
      const c = document.createElement("canvas"); c.width = 160; c.height = 90;
      const x = c.getContext("2d"); const r = Math.min(160 / item.im.naturalWidth, 90 / item.im.naturalHeight);
      const w = item.im.naturalWidth * r, h = item.im.naturalHeight * r;
      x.fillStyle = "#fff"; x.fillRect(0, 0, 160, 90); x.drawImage(item.im, (160 - w) / 2, (90 - h) / 2, w, h);
      b.appendChild(c);
      const cap = document.createElement("span"); cap.textContent = item.name + (item.isExample ? " · example" : ""); b.appendChild(cap);
      b.onclick = () => select(item);
      g.appendChild(b);
    });
    $("#galleryWrap").hidden = S.items.length === 0;
  }

  function renderAll() {
    const item = S.current; if (!item) return;
    renderCaption(item);
    renderControls(item);
    renderRatings(item);
    renderWhy(item);
    drawView(item);
    pushModel(item);
    renderExplorer(item);
  }

  function renderCaption(item) {
    const m = item.match, el = $("#status");
    const px = (item.userPitch || item.pitch);
    const across = (item.R.x1 - item.R.x0) / px;
    let s;
    if (item.recognised && m.full) s = `Recognised as frame ${String(m.frame).padStart(4, "0")} of your animation (match ${Math.round(m.corr * 100)}%). Rating the zone at bays ${item.bay}–${item.bay + 2}; choose another window below.`;
    else if (item.recognised) { const L = item.loc; s = `Recognised as frame ${String(m.frame).padStart(4, "0")}, bays ${L.bayFrom.toFixed(1)}–${L.bayTo.toFixed(1)} (match ${Math.round(m.corr * 100)}%). Nearest analysed zone: bays ${item.bay}–${item.bay + 2}${Math.abs(L.offsetM) > 2 ? `, ${Math.abs(L.offsetM).toFixed(0)} m to the ${L.offsetM > 0 ? "left" : "right"} of your crop's centre` : ""}.`; }
    else s = `Not recognised as a frame of the animation — rated from the image alone. ${item.detPitch ? `Cube pitch read at ${px.toFixed(1)} px per metre` : "No cube lattice found; assuming about 31 m across"} (${across.toFixed(0)} m across the reading). Adjust ‘Metres across’ if that is wrong, or drag a rectangle to read part of the image.`;
    if (item.inverted) s += " The image was read as white cubes on black.";
    el.textContent = s;
  }

  function renderControls(item) {
    const bays = $("#bays");
    bays.hidden = !(item.recognised && item.match.full);
    bays.querySelectorAll("button").forEach(b => b.classList.toggle("on", +b.dataset.bay === item.bay));
    $("#scale").value = ((item.R.x1 - item.R.x0) / (item.userPitch || item.pitch)).toFixed(1);
    $("#scaleWrap").hidden = item.recognised;
    $("#regionHint").hidden = item.recognised;
    $("#resetRegion").hidden = !item.region;
    $("#invert").checked = !!item.inverted;
  }

  function meterRow(word, i, vQual, vI) {
    const on = word === S.word;
    const row = document.createElement("button"); row.type = "button"; row.className = "row" + (on ? " on" : ""); row.dataset.word = word;
    row.setAttribute("aria-pressed", on ? "true" : "false");
    row.innerHTML = `<span class="ab">${ABBR[i]}</span><span class="wd">${word}</span>` +
      `<span class="m"><span class="track"><span class="bar" style="width:${vQual == null ? 0 : vQual}%"></span></span><span class="num">${vQual == null ? "—" : vQual}</span></span>` +
      `<span class="m"><span class="track"><span class="bar alt" style="width:${vI ?? 0}%"></span></span><span class="num">${vI ?? "—"}</span></span>`;
    row.onclick = () => { S.word = word; renderRatings(S.current); renderWhy(S.current); drawView(S.current); };
    return row;
  }
  function renderRatings(item) {
    const list = $('#ratings'); list.innerHTML = '';
    WORDS.forEach((word, i) => {
      const score = PSARubric.summarize(item.result.ratings[word], reviewFor(item,word)).qualitative;
      list.appendChild(meterRow(word, i, score, item.result.ratings[word]));
    });
  }

  function reviewFor(item, word) {
    item.reviews ||= {};
    return item.reviews[word] ||= PSARubric.generate(item.result,word);
  }
  function updateReviewSummary(item) {
    const result = PSARubric.summarize(item.result.ratings[S.word], reviewFor(item,S.word));
    renderRatings(item);
    $('#qualCardScore').textContent = result.qualitative == null ? '—' : result.qualitative.toFixed(1);
    $('#qualCardLabel').textContent = result.qualitative == null ? 'Not assessable from the current evidence.' : PSARubric.label(result.qualitative) + ' · ' + (reviewFor(item,S.word).source === 'automatic' ? 'automatic image interpretation' : 'manual override');
    $('#qualCardCriteria').textContent = 'Criteria: ' + PSARubric.definitions[S.word].questions.map(q => q[0]).join(' · ');
    const evidence = reviewFor(item,S.word).evidence.trim();
    $('#qualCardEvidence').textContent = evidence ? (reviewFor(item,S.word).source === 'automatic' ? 'Automatic interpretation: ' : 'Edited interpretation: ') + evidence : 'No written evidence added yet.';
    $('#qualScore').textContent = result.qualitative == null ? 'Not assessable' : result.qualitative.toFixed(1) + ' / 100';
    $('#combinedScore').textContent = result.combined == null ? '—' : result.combined + ' / 100';
    $('#combinedLabel').textContent = result.combined == null ? 'Insufficient evidence for a combined score. Check the image or complete any manually cleared criteria.' : PSARubric.label(result.combined) + ' · 70% quantitative + 30% qualitative';
    const body = $('#reviewOverview'); body.replaceChildren();
    WORDS.forEach(word=>{
      const s=PSARubric.summarize(item.result.ratings[word],reviewFor(item,word));
      const tr=document.createElement('tr');
      [word,s.quantitative ?? 'N/A',s.qualitative == null ? 'N/A' : s.qualitative.toFixed(1),s.combined ?? '—'].forEach(value=>{
        const td=document.createElement('td');td.textContent=value;tr.appendChild(td);
      });body.appendChild(tr);
    });
  }
  function renderReview(item) {
    const word=S.word, definition=PSARubric.definitions[word], review=reviewFor(item,word);
    $('#reviewHeading').textContent = word + ' · automatic qualitative assessment';
    $('#reviewIntent').textContent=definition.intent;
    $('#reviewLimit').textContent=definition.limit;
    $('#quantInterpretation').textContent=PSARubric.label(item.result.ratings[word]) + ' against the quantitative targets. The qualitative assessment interprets the visible patterns automatically using the rules below.';
    $('#reviewSource').textContent='Reviewing: '+item.name+' · '+(item.region ? 'selected crop' : item.recognised && item.match.full ? 'bays '+item.bay+'–'+(item.bay+2) : 'whole image')+'. Assessments stay with this image during this session. Changing its crop, scale, bay or tone regenerates the automatic assessment and clears edits.';
    const form=$('#qualQuestions');form.replaceChildren();
    definition.questions.forEach((q,index)=>{
      const field=document.createElement('fieldset');
      const legend=document.createElement('legend');legend.textContent=q[0];field.appendChild(legend);
      const anchors=document.createElement('p');anchors.className='hint';anchors.textContent='0 — '+q[1]+'  4 — '+q[2];field.appendChild(anchors);
      const rule=review.rules?.[index];
      if(rule){const detail=document.createElement('p');detail.className='hint';detail.textContent='Automatic rule: '+rule.operation+' of ['+rule.metrics.map(m=>m.name+' '+m.normalized.toFixed(2)).join(', ')+'] = '+rule.strength.toFixed(2)+' → '+rule.judgment+'/4.';field.appendChild(detail);}
      const label=document.createElement('label');label.textContent='Interpretation (editable) ';const select=document.createElement('select');select.setAttribute('aria-label',q[0]);
      [['','Insufficient evidence'],['0','0 · Absent or contradicted'],['1','1 · Weak / isolated evidence'],['2','2 · Partial / mixed evidence'],['3','3 · Clear in most of the region'],['4','4 · Strong and consistent evidence']].forEach(([value,text])=>{const option=document.createElement('option');option.value=value;option.textContent=text;select.appendChild(option);});
      select.value=review.values[index] ?? '';select.onchange=()=>{review.values[index]=select.value===''?null:Number(select.value);review.source='manual override';updateReviewSummary(item);};label.appendChild(select);field.appendChild(label);form.appendChild(field);
    });
    $('#reviewEvidence').value=review.evidence;
    $('#reviewEvidence').oninput=e=>{review.evidence=e.target.value;review.source='manual override';updateReviewSummary(item);};
    $('#reviewReset').onclick=()=>{item.reviews[word]=PSARubric.generate(item.result,word);renderReview(item);};
    $('#reviewExport').onclick=()=>{
      const report={rubricVersion:PSARubric.version,createdAt:new Date().toISOString(),image:item.name,scope:{region:item.R,bay:item.bay ?? null,pixelsPerMetre:item.userPitch||item.pitch,inverted:item.inverted,recognizedFrame:item.recognised?item.match.frame:null},method:'Quantitative = sum(weight × normalized metric). Qualitative = mean of two automatic rule-based 0–4 interpretations × 25; manual edits are identified in the review source. Combined = 70% quantitative + 30% qualitative. Project rubric, not a validated universal standard.',descriptors:WORDS.map(w=>({descriptor:w,intent:PSARubric.definitions[w].intent,limitations:PSARubric.definitions[w].limit,metrics:item.result.explain[w].terms,questions:PSARubric.definitions[w].questions,review:item.reviews[w]||null,...PSARubric.summarize(item.result.ratings[w],item.reviews[w])}))};
      const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='ProtoSpace-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
    updateReviewSummary(item);
  }

  function renderWhy(item) {
    const w = S.word, i = WORDS.indexOf(w), ex = item.result.explain[w];
    $("#whyTitle").textContent = `${String(i + 1).padStart(2, "0")}  ${w.toUpperCase()}`;
    $("#whyQual").textContent = PSARubric.definitions[w].intent;
    // image reading card
    $("#imgScore").textContent = item.result.ratings[w] ?? "N/A";
    $("#imgText").textContent = item.result.features.empty ? "Insufficient visible mass for a meaningful score. Adjust the crop, scale or tone, or choose another frame." : "The measurements below are estimates from this view. Counts, areas and distances depend on the selected region and assumed scale.";
    $("#imgAdvice").textContent = "Use the weighted metrics to identify which target is least supported, then inspect the generated spatial interpretation.";
    const terms = $("#imgTerms"); terms.innerHTML = "";
    ex.terms.forEach(t => {
      const li = document.createElement("li");
      li.innerHTML = `<div class="tname">${t.name}</div><div class="tval">${t.value}</div><div class="tbar"><span style="width:${Math.round(100 * t.norm)}%"></span></div><div class="tnote">${t.note} · Weight ${t.weight}% · ${t.contribution.toFixed(1)} points of ${t.weight}</div>`;
      terms.appendChild(li);
    });
    $("#measuredWhat").textContent = PSARubric.definitions[w].limit;
    $('#agree').textContent = 'Rubric v3 combines measured geometry with an automatic interpretation of visible patterns. Both scores use the same image evidence. Tone is treated as depth only for the supplied cube renders; other lighting, materials or perspective can distort the estimates.';
    renderReview(item);
  }

  // ---- the canvas: image or depth diagram, with the overlay for the selected descriptor
  const T = { ink: () => getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() };
  function hatchPattern(ctx, color, angle, spacing) {
    const c = document.createElement("canvas"); c.width = c.height = spacing;
    const x = c.getContext("2d"); x.strokeStyle = color; x.lineWidth = 1.4;
    x.beginPath();
    if (angle === 45) { x.moveTo(0, spacing); x.lineTo(spacing, 0); x.moveTo(-1, 1); x.lineTo(1, -1); x.moveTo(spacing - 1, spacing + 1); x.lineTo(spacing + 1, spacing - 1); }
    else { x.moveTo(0, 0); x.lineTo(spacing, spacing); x.moveTo(spacing - 1, -1); x.lineTo(spacing + 1, 1); x.moveTo(-1, spacing - 1); x.lineTo(1, spacing + 1); }
    x.stroke();
    return ctx.createPattern(c, "repeat");
  }
  function drawView(item) {
    const cv = $("#view"), R = item.R, G = item.grid, res = item.result;
    const maxW = cv.parentElement.clientWidth || 900;
    const rw = R.x1 - R.x0, rh = R.y1 - R.y0;
    const k = Math.min(maxW / rw, 620 / rh);
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(rw * k * dpr); cv.height = Math.round(rh * k * dpr);
    cv.style.width = Math.round(rw * k) + "px"; cv.style.height = Math.round(rh * k) + "px";
    const x = cv.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cell = G.pitch * k;                                  // one metre on screen
    const cx = c => G.px * k + c * cell, cy = r => G.py * k + (G.rows - 1 - r) * cell;   // cell -> screen (top-left)
    if (S.view === "image") {
      x.fillStyle = "#fff"; x.fillRect(0, 0, rw * k, rh * k);
      if (item.inverted) { x.filter = "invert(1)"; }
      x.drawImage(item.canvas, R.x0, R.y0, rw, rh, 0, 0, rw * k, rh * k);
      x.filter = "none";
    } else {
      // the depth diagram, exactly the boards' reading: tones by band, hatched pockets, bay and floor grid
      x.fillStyle = "#fff"; x.fillRect(0, 0, rw * k, rh * k);
      for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) {
        const b = G.band[r * G.cols + c]; const t = PSA.BAND_TONES[b];
        x.fillStyle = `rgb(${t},${t},${t})`; x.fillRect(cx(c), cy(r), cell + 0.5, cell + 0.5);
      }
      if (!res.features.empty) {
        const hp = hatchPattern(x, "rgba(30,30,30,0.9)", 45, 7);
        res.features.pockets.forEach(p => { x.fillStyle = "rgba(238,238,238,0.85)"; p.cells.forEach(([c, r]) => x.fillRect(cx(c), cy(r), cell + 0.5, cell + 0.5)); x.fillStyle = hp; p.cells.forEach(([c, r]) => x.fillRect(cx(c), cy(r), cell + 0.5, cell + 0.5)); });
        const E = res.features.envelope, Mo = res.features.modules;
        x.strokeStyle = "rgba(0,0,0,0.25)"; x.lineWidth = 1;
        for (let m = 0; m <= Mo.nm; m++) { const X = cx(Mo.mo + m * 9); x.beginPath(); x.moveTo(X, cy(E.rmax) ); x.lineTo(X, cy(E.r0) + cell); x.stroke(); }
        for (let f = 0; f <= Mo.nf; f++) { const Y = cy(E.r0 + f * 3) + cell; x.beginPath(); x.moveTo(cx(E.cmin), Y); x.lineTo(cx(E.cmax) + cell, Y); x.stroke(); }
      }
    }
    if (!res.features.empty) drawOverlay(x, item, cell, cx, cy);
    explorerHighlight(item,x,k);
    // drag rectangle in progress
    if (S.drag && S.drag.item === item) { const d = S.drag; x.save(); x.setLineDash([6, 4]); x.strokeStyle = "#000"; x.lineWidth = 1.5; x.strokeRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0); x.setLineDash([]); x.strokeStyle = "#fff"; x.strokeRect(d.x0 + 1.5, d.y0 + 1.5, d.x1 - d.x0 - 3, d.y1 - d.y0 - 3); x.restore(); }
  }
  // double stroke so the overlay reads over black cubes and white void alike
  function dline(x, pts, w = 2, close = false) {
    x.beginPath(); pts.forEach((p, i) => i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); if (close) x.closePath();
    x.lineWidth = w + 3; x.strokeStyle = "rgba(255,255,255,0.95)"; x.stroke();
    x.lineWidth = w; x.strokeStyle = "#111"; x.stroke();
  }
  function label(x, X, Y, text, size = 12) {
    x.font = `600 ${size}px Poppins, system-ui, sans-serif`; x.textAlign = "center"; x.textBaseline = "middle";
    const w = x.measureText(text).width + 10;
    x.fillStyle = "rgba(255,255,255,0.92)"; x.fillRect(X - w / 2, Y - size * 0.75, w, size * 1.5);
    x.strokeStyle = "#111"; x.lineWidth = 1; x.strokeRect(X - w / 2, Y - size * 0.75, w, size * 1.5);
    x.fillStyle = "#111"; x.fillText(text, X, Y + 0.5);
  }
  function cellOutline(x, cells, cell, cx, cy, w = 2) {
    // outline the union of a set of cells
    const set = new Set(cells.map(([c, r]) => c + "," + r));
    const segs = [];
    cells.forEach(([c, r]) => {
      const X = cx(c), Y = cy(r);
      if (!set.has((c - 1) + "," + r)) segs.push([[X, Y], [X, Y + cell]]);
      if (!set.has((c + 1) + "," + r)) segs.push([[X + cell, Y], [X + cell, Y + cell]]);
      if (!set.has(c + "," + (r + 1))) segs.push([[X, Y], [X + cell, Y]]);
      if (!set.has(c + "," + (r - 1))) segs.push([[X, Y + cell], [X + cell, Y + cell]]);
    });
    x.lineCap = "square";
    segs.forEach(s => dline(x, s, w));
  }
  function moduleCells(mo, r0, m, f) { const out = []; for (let dc = 0; dc < 9; dc++) for (let dr = 0; dr < 3; dr++) out.push([mo + m * 9 + dc, r0 + f * 3 + dr]); return out; }
  function drawOverlay(x, item, cell, cx, cy) {
    const F = item.result.features, w = S.word, Mo = F.modules, E = F.envelope;
    const mc = (m, f) => [cx(Mo.mo + m * 9) + 4.5 * cell, cy(E.r0 + f * 3) - 0.5 * cell + cell];   // module centre
    const hp = hatchPattern(x, "rgba(20,20,20,0.85)", 45, 7), hp2 = hatchPattern(x, "rgba(20,20,20,0.6)", 135, 7);
    const fillCells = (cells, style) => { x.fillStyle = style; cells.forEach(([c, r]) => x.fillRect(cx(c), cy(r), cell + 0.5, cell + 0.5)); };
    const pale = (cells) => fillCells(cells, "rgba(255,255,255,0.55)");
    switch (w) {
      case "Modular": {
        for (let m = 0; m < Mo.nm; m++) for (let f = 0; f < Mo.nf; f++) {
          const fl = Mo.fill[f * Mo.nm + m], X = cx(Mo.mo + m * 9), Y = cy(E.r0 + f * 3 + 2);
          if (fl >= 0.7) dline(x, [[X, Y], [X + 9 * cell, Y], [X + 9 * cell, Y + 3 * cell], [X, Y + 3 * cell]], 2.5, true);
          else if (fl <= 0.3) { x.save(); x.setLineDash([5, 4]); dline(x, [[X, Y], [X + 9 * cell, Y], [X + 9 * cell, Y + 3 * cell], [X, Y + 3 * cell]], 1.2, true); x.restore(); }
          else { pale(moduleCells(Mo.mo, E.r0, m, f)); fillCells(moduleCells(Mo.mo, E.r0, m, f), hp2); }
        }
        break;
      }
      case "Fragmented": {
        F.islandList.forEach((k, i) => { cellOutline(x, k.cells, cell, cx, cy, 2); const [sc, sr] = k.cells.reduce((a, c) => [a[0] + c[0], a[1] + c[1]], [0, 0]); label(x, cx(sc / k.size) + cell / 2, cy(sr / k.size) + cell / 2, `${i + 1} · ${k.size} m²`); });
        break;
      }
      case "Interlocking": {
        F.connections.forEach(cn => { const a = mc(...cn.a), b = mc(...cn.b); dline(x, [a, b], cn.lock ? 3.5 : 1.5); if (cn.lock) { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; x.fillStyle = "#fff"; x.fillRect(m[0] - 5, m[1] - 5, 10, 10); x.strokeStyle = "#111"; x.lineWidth = 2; x.strokeRect(m[0] - 5, m[1] - 5, 10, 10); } });
        for (let m = 0; m < Mo.nm; m++) for (let f = 0; f < Mo.nf; f++) if (Mo.fill[f * Mo.nm + m] >= 0.5) { const p = mc(m, f); x.fillStyle = "#111"; x.beginPath(); x.arc(p[0], p[1], 4, 0, 7); x.fill(); x.strokeStyle = "#fff"; x.lineWidth = 1.5; x.stroke(); }
        break;
      }
      case "Porous": {
        F.openings.forEach(k => { pale(k.cells); fillCells(k.cells, hp); cellOutline(x, k.cells, cell, cx, cy, 1.5); });
        const cells = []; for (let r = E.r0; r <= E.rmax; r++) for (let c = E.cmin; c <= E.cmax; c++) if (item.grid.band[r * item.grid.cols + c] === 2 || item.grid.band[r * item.grid.cols + c] === 3) cells.push([c, r]);
        fillCells(cells, hp2);
        dline(x, [[cx(E.cmin), cy(E.rmax)], [cx(E.cmax) + cell, cy(E.rmax)], [cx(E.cmax) + cell, cy(E.r0) + cell], [cx(E.cmin), cy(E.r0) + cell]], 1, true);
        break;
      }
      case "Clustered": {
        F.moduleClusters.comps.forEach((k, i) => { const cells = []; k.cells.forEach(([m, f]) => cells.push(...moduleCells(Mo.mo, E.r0, m, f))); cellOutline(x, cells, cell, cx, cy, 2.5); const p = k.cells.reduce((a, c) => [a[0] + c[0], a[1] + c[1]], [0, 0]); const q = mc(p[0] / k.size, p[1] / k.size); label(x, q[0], q[1], `${k.size} module${k.size === 1 ? "" : "s"}`); });
        break;
      }
      case "Decentralized": {
        F.pockets.forEach(k => { pale(k.cells); fillCells(k.cells, hp); cellOutline(x, k.cells, cell, cx, cy, 1.5); });
        F.distLines.forEach(l => { const a = [cx(l.from[0]), cy(l.from[1]) + cell], b = [cx(l.to[0]), cy(l.to[1]) + cell]; dline(x, [a, b], 1.2); x.fillStyle = "#111"; x.beginPath(); x.arc(a[0], a[1], 3.5, 0, 7); x.fill(); });
        break;
      }
      case "Networked": {
        F.streets.forEach(s => dline(x, [[cx(s.c0), cy(s.r) + cell / 2], [cx(s.c1) + cell, cy(s.r) + cell / 2]], 5));
        F.links.forEach(s => dline(x, [[cx(s.c0), cy(s.r) + cell / 2], [cx(s.c1) + cell, cy(s.r) + cell / 2]], 2));
        F.perModuleConn.forEach(p => { const q = mc(p.m, p.f); label(x, q[0], q[1], String(p.k), 11); });
        break;
      }
      case "Layered": {
        const CL = F.CL, G = item.grid, cells = {};
        for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) { const k = F.classes[r * G.cols + c]; if (k && k !== CL.WORK) (cells[k] = cells[k] || []).push([c, r]); }
        if (cells[CL.GATHER]) { pale(cells[CL.GATHER]); fillCells(cells[CL.GATHER], hp); }
        if (cells[CL.COVERED]) fillCells(cells[CL.COVERED], hp2);
        if (cells[CL.TERRACE]) fillCells(cells[CL.TERRACE], "rgba(120,120,120,0.35)");
        if (cells[CL.OPEN]) cellOutline(x, cells[CL.OPEN], cell, cx, cy, 1);
        F.streets.forEach(s => dline(x, [[cx(s.c0), cy(s.r) + cell / 2], [cx(s.c1) + cell, cy(s.r) + cell / 2]], 5));
        F.links.forEach(s => dline(x, [[cx(s.c0), cy(s.r) + cell / 2], [cx(s.c1) + cell, cy(s.r) + cell / 2]], 2));
        F.perModuleFunc.forEach(p => { const q = mc(p.m, p.f); label(x, q[0], q[1], String(p.k), 11); });
        break;
      }
      case "Intimate": {
        F.territories.forEach(tt => { cellOutline(x, tt.cells, cell, cx, cy, 1.5); const p = tt.cells.reduce((a, c) => [a[0] + c[0], a[1] + c[1]], [0, 0]); label(x, cx(p[0] / tt.cells.length) + cell / 2, cy(p[1] / tt.cells.length) + cell / 2, `${Math.round(tt.occupants)} p`, 11); });
        break;
      }
      case "Visually Connected": {
        F.rays.forEach(r => { const a = [cx(r.from[0]) + cell / 2, cy(r.from[1]) + cell / 2], b = [cx(r.to[0]) + cell / 2, cy(r.to[1]) + cell / 2]; dline(x, [a, b], 1.5); x.fillStyle = "#fff"; x.strokeStyle = "#111"; x.lineWidth = 1.5; x.beginPath(); x.arc(b[0], b[1], 4, 0, 7); x.fill(); x.stroke(); });
        break;
      }
      case "Socially Interactive": {
        F.pockets.forEach(k => { pale(k.cells); fillCells(k.cells, hp); cellOutline(x, k.cells, cell, cx, cy, 1.5); });
        F.streets.forEach(s => dline(x, [[cx(s.c0), cy(s.r) + cell / 2], [cx(s.c1) + cell, cy(s.r) + cell / 2]], 5));
        F.contacts.forEach(ct => { const s = ct.street, k = F.pockets.find(p => p.id === ct.pocket); if (!k) return; const near = k.cells.filter(([c, r]) => Math.abs(r - s.r) <= 1 && c >= s.c0 - 1 && c <= s.c1 + 1); const p = near.reduce((a, c) => [a[0] + c[0], a[1] + c[1]], [0, 0]); const X = cx(p[0] / near.length) + cell / 2, Y = cy(p[1] / near.length) + cell / 2; x.fillStyle = "#fff"; x.strokeStyle = "#111"; x.lineWidth = 2.5; x.beginPath(); x.arc(X, Y, 8, 0, 7); x.fill(); x.stroke(); });
        break;
      }
      case "Village-Like": {
        F.pockets.forEach(k => { pale(k.cells); fillCells(k.cells, hp); });
        F.streets.forEach(s => dline(x, [[cx(s.c0), cy(s.r) + cell / 2], [cx(s.c1) + cell, cy(s.r) + cell / 2]], 5));
        F.moduleClusters.comps.forEach(k => { const cells = []; k.cells.forEach(([m, f]) => cells.push(...moduleCells(Mo.mo, E.r0, m, f))); cellOutline(x, cells, cell, cx, cy, 2.5); });
        break;
      }
    }
  }

  const EX={token:0,item:null,result:null,candidates:[],chosen:null};
  // ---- hand the analysed frame (and the chosen area) to the 3D generator (js/model3d.js)
  function pushModel(item){
    if(!window.PSModel3D||!item||!item.result)return;
    PSModel3D.setSource({name:item.name,grid:item.grid,result:item.result,image:{canvas:item.canvas,R:item.R},area:EX.chosen&&EX.item===item&&EX.result===item.result?{c:EX.chosen.c,r:EX.chosen.r,w:EX.chosen.w,h:EX.chosen.h}:null});
  }
  function pushArea(){
    if(!window.PSModel3D)return;
    const a=EX.chosen;PSModel3D.setArea(a?{c:a.c,r:a.r,w:a.w,h:a.h}:null);
  }
  window.addEventListener('psmodel-ready',()=>pushModel(S.current));
  function explorerCanvas(canvas){
    const width=Math.max(280,canvas.parentElement.clientWidth),height=Math.min(500,Math.max(320,width*.55)),dpr=window.devicePixelRatio||1;
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);canvas.style.width='100%';canvas.style.height=height+'px';
    const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);return {ctx,width,height};
  }
  function explorerHighlight(item,x,k){
    const a=EX.chosen;if(!a||EX.item!==item||EX.result!==item.result)return;
    const g=item.grid,X=(g.px+a.c*g.pitch)*k,Y=(g.py+(g.rows-a.r-a.h)*g.pitch)*k;
    x.save();x.fillStyle='rgba(198,40,40,.14)';x.fillRect(X,Y,a.w*g.pitch*k,a.h*g.pitch*k);x.strokeStyle='#c62828';x.lineWidth=3;x.setLineDash([8,4]);x.strokeRect(X,Y,a.w*g.pitch*k,a.h*g.pitch*k);x.setLineDash([]);x.fillStyle='#a61b1b';x.font='bold 12px Arial';x.fillText('SELECTED AREA',X+6,Y+17);x.restore();
  }
  function renderExplorer(item){
    if(EX.item===item&&EX.result===item.result)return;
    EX.item=item;EX.result=item.result;findExplorerArea();
  }
  async function findExplorerArea(){
    if(!EX.item?.result)return;
    const token=++EX.token,item=EX.item,g=item.grid;
    EX.chosen=null;EX.candidates=[];$('#spaceChoices').replaceChildren();$('#spaceOutputs').hidden=true;$('#spaceFind').disabled=true;pushArea();
    drawView(item);
    if(!g.cols||!g.rows||item.result.features.empty){$('#spaceStatus').textContent='Not enough visible mass to recommend an area. Choose another frame or adjust the scale and tone.';$('#spaceFind').disabled=false;return;}
    const objective=$('#spaceObjective').value;
    const search=PSASpace.windows(g,+$('#spaceWidth').value,+$('#spaceHeight').value);
    const candidates=[];
    try{
      for(let i=0;i<search.windows.length;i++){
        if(token!==EX.token)return;
        if(i%6===0){$('#spaceStatus').textContent='Comparing area '+(i+1)+' of '+search.windows.length+'…';await new Promise(resolve=>setTimeout(resolve,0));if(token!==EX.token)return;}
        const candidate=PSASpace.assess(g,search.windows[i],objective);if(candidate)candidates.push(candidate);
      }
      if(token!==EX.token)return;
      candidates.sort((a,b)=>b.score-a.score||a.r-b.r||a.c-b.c);
      EX.candidates=candidates;
      if(!candidates.length){$('#spaceStatus').textContent='No candidate window contains enough mass to score. Try a larger window.';return;}
      EX.objective=objective;
      $('#spaceStatus').textContent='Compared '+search.windows.length+' equal '+search.width+' × '+search.height+' m windows at approximately '+search.step+' m intervals; '+candidates.length+' were assessable. Best means highest fit to '+(objective==='balanced'?'the equal-weight average of all 12 combined descriptor scores':objective)+'. Search is limited to the image region currently being analyzed. Scores are recomputed for each window; this is a sampled search, not a design-quality guarantee.';
      candidates.slice(0,3).forEach((a,i)=>{const button=document.createElement('button');button.type='button';button.className='btn quiet';button.textContent=(i===0?'Best':'Alternative '+i)+' · '+a.score.toFixed(1)+'/100';button.onclick=()=>chooseExplorerArea(a,i);$('#spaceChoices').appendChild(button);});
      chooseExplorerArea(candidates[0],0);
    }catch(error){if(token===EX.token)$('#spaceStatus').textContent='The area search could not finish: '+error.message;}
    finally{if(token===EX.token)$('#spaceFind').disabled=false;}
  }
  function chooseExplorerArea(area,index){
    EX.chosen=area;$('#spaceOutputs').hidden=false;
    [...$('#spaceChoices').children].forEach((b,i)=>{b.setAttribute('aria-pressed',String(i===index));b.classList.toggle('chosen',i===index);});
    $('#spaceSelection').textContent=EX.item.name+' · window '+area.w+' × '+area.h+' m · origin '+area.c+' m across, '+area.r+' m above current grid bottom · '+area.score.toFixed(1)+'/100';
    $('#spaceEvidence').textContent=area.scores.slice().sort((a,b)=>b.combined-a.combined).map(s=>s.word+': '+s.combined+' (quant. '+s.quantitative+', qual. '+s.qualitative.toFixed(1)+')').join(' · ');
    $('#spaceCut').max=area.w-1;$('#spaceCut').value=Math.floor((area.w-1)/2);
    drawSpaceOverview();drawSpaceSection();drawView(EX.item);
    pushArea();
  }
  function drawSpaceOverview(){
    if(!EX.chosen)return;
    const {ctx:x,width:W,height:H}=explorerCanvas($('#spaceOverview')),item=EX.item,R=item.R,a=EX.chosen,g=item.grid;
    const scale=Math.min((W-30)/(R.x1-R.x0),(H-30)/(R.y1-R.y0)),ox=(W-(R.x1-R.x0)*scale)/2,oy=(H-(R.y1-R.y0)*scale)/2;
    x.fillStyle='#f6f2f2';x.fillRect(0,0,W,H);x.save();x.translate(ox,oy);if(item.inverted)x.filter='invert(1)';x.drawImage(item.canvas,R.x0,R.y0,R.x1-R.x0,R.y1-R.y0,0,0,(R.x1-R.x0)*scale,(R.y1-R.y0)*scale);x.filter='none';explorerHighlight(item,x,scale);
    const cut=+$('#spaceCut').value,X=(g.px+(a.c+cut+.5)*g.pitch)*scale,Y=(g.py+(g.rows-a.r-a.h)*g.pitch)*scale;
    x.strokeStyle='#c3542b';x.lineWidth=2;x.setLineDash([7,4]);x.beginPath();x.moveTo(X,Y);x.lineTo(X,Y+a.h*g.pitch*scale);x.stroke();x.fillStyle='#a43a16';x.font='bold 13px Arial';x.fillText('A',X+4,Y+15);x.fillText('A',X+4,Y+a.h*g.pitch*scale-5);x.restore();
  }
  function drawSpaceSection(){
    if(!EX.chosen)return;const column=+$('#spaceCut').value,thickness=+$('#spaceThickness').value;
    $('#spaceCutValue').textContent=(column+.5).toFixed(1)+' m';$('#spaceThicknessValue').textContent=thickness+' m';
    EX.svg=PSASpace.svg(EX.chosen.grid,column,thickness,EX.item.name);
    $('#spaceSection').innerHTML=EX.svg;
    const hasSolid=PSASpace.section(EX.chosen.grid,column,thickness).length>0;
    $('#spaceSectionNote').textContent=hasSolid?'A–A cuts perpendicular to the image through the orange line. Black areas are intersections with the inferred solids.':'This cut misses all inferred solids. Move the cut line to inspect another part of the selected area.';
  }
  function downloadSpace(content,type,name){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function wireExplorer(){
    WORDS.forEach(word=>{const o=document.createElement('option');o.value=word;o.textContent=word;$('#spaceObjective').appendChild(o);});
    $('#spaceFind').onclick=findExplorerArea;
    ['spaceObjective','spaceWidth','spaceHeight'].forEach(id=>$('#'+id).onchange=findExplorerArea);
    $('#spaceCut').oninput=()=>{drawSpaceOverview();drawSpaceSection();if(window.PSModel3D&&PSModel3D.ready&&PSModel3D.settings.scope==='area')PSModel3D.setSectionFromStudy(+$('#spaceCut').value+1,null);};
    $('#spaceThickness').oninput=()=>{if(!EX.chosen)return;drawSpaceSection();};
    $('#spaceModelArea').onclick=()=>{if(!EX.chosen||!window.PSModel3D)return;pushArea();PSModel3D.setScope('area');PSModel3D.setSectionFromStudy(+$('#spaceCut').value+1,true);document.getElementById('model3d').scrollIntoView({behavior:'smooth',block:'start'});};
    $('#spaceModelFrame').onclick=()=>{if(!window.PSModel3D)return;PSModel3D.setScope('frame');document.getElementById('model3d').scrollIntoView({behavior:'smooth',block:'start'});};
    $('#spaceSaveSection').onclick=()=>{if(EX.svg)downloadSpace(EX.svg,'image/svg+xml','ProtoSpace-inferred-section.svg');};
    window.addEventListener('resize',()=>{if(EX.chosen)drawSpaceOverview();});
  }

  // ---- interactions
  function wire() {
    const drop = $("#drop"), input = $("#file");
    ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", e => addFiles(e.dataTransfer.files));
    input.addEventListener("change", () => { addFiles(input.files); input.value = ""; });
    document.addEventListener("paste", e => { const files = [...(e.clipboardData?.files || [])]; if (files.length) addFiles(files); });
    $("#viewImage").onclick = () => { S.view = "image"; $("#viewImage").classList.add("on"); $("#viewDiagram").classList.remove("on"); drawView(S.current); };
    $("#viewDiagram").onclick = () => { S.view = "diagram"; $("#viewDiagram").classList.add("on"); $("#viewImage").classList.remove("on"); drawView(S.current); };
    $("#bays").querySelectorAll("button").forEach(b => b.onclick = () => { S.current.bay = +b.dataset.bay; S.current.region = null; analyzeItem(S.current); renderAll(); });
    $("#scale").addEventListener("change", () => { const v = parseFloat($("#scale").value); if (v > 3) { const it = S.current; it.userPitch = (it.R.x1 - it.R.x0) / v; analyzeItem(it); renderAll(); } });
    $("#invert").addEventListener("change", () => { const it = S.current; it.inverted = $("#invert").checked; it.ready = false; it.region = null; select(it); });
    $("#resetRegion").onclick = () => { S.current.region = null; S.current.userPitch = null; analyzeItem(S.current); renderAll(); };
    $("#loadFrame").onclick = () => addImage(D.sampleFrame, "frame 0093", true);
    // drag a rectangle on the canvas to read part of an image
    const cv = $("#view");
    const pos = e => { const r = cv.getBoundingClientRect(); return [Math.max(0, Math.min(r.width, e.clientX - r.left)), Math.max(0, Math.min(r.height, e.clientY - r.top))]; };
    cv.addEventListener("pointerdown", e => { if (!S.current || (S.current.recognised && S.current.match.full)) return; const [X, Y] = pos(e); S.drag = { item: S.current, x0: X, y0: Y, x1: X, y1: Y }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener("pointermove", e => { if (!S.drag) return; const [X, Y] = pos(e); S.drag.x1 = X; S.drag.y1 = Y; drawView(S.current); });
    cv.addEventListener("pointerup", e => {
      if (!S.drag) return; const d = S.drag; S.drag = null;
      const it = S.current, r = cv.getBoundingClientRect(), k = (it.R.x1 - it.R.x0) / r.width;
      if (Math.abs(d.x1 - d.x0) > 30 && Math.abs(d.y1 - d.y0) > 30) {
        const region = { x0: it.R.x0 + Math.round(Math.min(d.x0, d.x1) * k), y0: it.R.y0 + Math.round(Math.min(d.y0, d.y1) * k), x1: it.R.x0 + Math.round(Math.max(d.x0, d.x1) * k), y1: it.R.y0 + Math.round(Math.max(d.y0, d.y1) * k) };
        it.region = region; analyzeItem(it); renderAll();
      } else drawView(it);
    });
    window.addEventListener("resize", () => S.current && drawView(S.current));
  }

  // ---- boot
  wireExplorer();
  wire();
  setStatus("Loading the animation's 250 frames for recognition…");
  loadThumbs().then(th => {
    S.thumbs = th;
    if (!th) setStatus("Frame recognition is unavailable (the frame sprite could not be read), so imports are rated from the image alone.");
    addImage(D.sampleCrop, "frame 0139 · bays 4–6", true);
  });
})();


'use strict';
/* Editor de composición ("Componer"): gran pentagrama editable estilo MuseScore.
   - Insertar notas con clic o con el teclado MIDI (entrada por pasos, con acordes)
   - Duraciones, puntillo, alteraciones ♯/♭/♮, goma, deshacer, tríadas con un clic
   - Silencios explícitos, cifra de compás (4/4, 3/4, 2/4, 6/8), armadura/tonalidad
     con alteración automática, barras de repetición 𝄆 𝄇 y dinámicas p/mf/f
   - Composiciones guardadas en localStorage, exportación a .mid
   - Panel de referencia: foto o PDF de una partitura para copiarla a mano
   - "Practicar": convierte la composición en canción del modo juego */

const Composer = {
  active: false,
  comps: [],            // [{ id, title, bpm, key, timesig, notes, rests, repStarts, repEnds }]
  cur: null,            // composición en edición
  cursorBeat: 0,
  scrollBeat: 0,
  tool: { dur: 1, dot: false, acc: null, eraser: false, triad: false, vel: 80 },
  held: new Set(), groupStart: 0,
  undoStack: [],
  playTimers: [], playingPrev: false,
  ref: { pdf: null, page: 1, pages: 0 },

  KEY: 'atril.comps.v1',

  /* ---------------- Persistencia ---------------- */
  load(){
    try{ this.comps = JSON.parse(localStorage.getItem(this.KEY)) || []; }catch(e){ this.comps = []; }
    if (!Array.isArray(this.comps)) this.comps = [];
  },
  save(){
    try{ localStorage.setItem(this.KEY, JSON.stringify(this.comps)); }catch(e){}
  },
  migrate(c){
    c.key = c.key || 0;
    c.timesig = c.timesig || { num: 4, den: 4 };
    c.rests = c.rests || [];
    c.repStarts = c.repStarts || [];
    c.repEnds = c.repEnds || [];
    for (const n of c.notes) if (!n.vel) n.vel = 80;
    return c;
  },
  newComp(){
    const c = this.migrate({ id: Date.now(), title: 'Mi canción ' + (this.comps.length + 1), bpm: 100, notes: [] });
    this.comps.push(c); this.save();
    this.select(c.id);
  },
  select(id){
    this.cur = this.comps.find(c => c.id === id) || this.comps[0] || null;
    if (!this.cur){ this.newComp(); return; }
    this.migrate(this.cur);
    this.cursorBeat = this.maxBeat(); this.scrollBeat = Math.max(0, this.cursorBeat - 8);
    this.undoStack = [];
    $('#cmpTitle').value = this.cur.title;
    $('#cmpBpm').value = this.cur.bpm;
    $('#cmpTs').value = this.cur.timesig.num + '/' + this.cur.timesig.den;
    $('#cmpKey').value = this.cur.key;
    this.rebuildSel();
    this.draw();
  },
  rebuildSel(){
    const sel = $('#cmpSel');
    sel.innerHTML = '';
    for (const c of this.comps){
      const o = document.createElement('option');
      o.value = c.id; o.textContent = '🎼 ' + c.title;
      sel.appendChild(o);
    }
    if (this.cur) sel.value = this.cur.id;
  },
  maxBeat(){
    if (!this.cur) return 0;
    const n = this.cur.notes.length ? Math.max(...this.cur.notes.map(n => n.startBeat + n.beats)) : 0;
    const r = this.cur.rests.length ? Math.max(...this.cur.rests.map(x => x.startBeat + x.beats)) : 0;
    return Math.max(n, r);
  },
  beatsPerBar(){
    const ts = this.cur.timesig;
    return ts.num * 4 / ts.den;
  },

  /* ---------------- Edición ---------------- */
  snapshot(){
    this.undoStack.push(JSON.stringify({
      notes: this.cur.notes, rests: this.cur.rests,
      repStarts: this.cur.repStarts, repEnds: this.cur.repEnds
    }));
    if (this.undoStack.length > 60) this.undoStack.shift();
  },
  undo(){
    const s = this.undoStack.pop();
    if (s == null){ toast('Nada que deshacer'); return; }
    Object.assign(this.cur, JSON.parse(s));
    this.save(); this.draw();
  },
  curDur(){ return this.tool.dur * (this.tool.dot ? 1.5 : 1); },

  // diatónica -> midi aplicando armadura o la alteración elegida (♯/♭/♮)
  diaToMidi(d){
    const li = ((d % 7) + 7) % 7;
    const oct = Math.floor(d / 7);
    const acc = this.tool.acc;
    const alter = acc === '#' ? 1 : acc === 'b' ? -1 : acc === 'nat' ? 0 : keyAlterOfLetter(li, this.cur.key);
    return clamp((oct + 1) * 12 + LSEMI[li] + alter, 21, 108);
  },

  addNote(m, startBeat, hand, vel){
    m = clamp(m, 21, 108);
    if (this.cur.notes.some(n => n.m === m && Math.abs(n.startBeat - startBeat) < 0.01)) return;
    this.snapshot();
    this.cur.notes.push({ m, startBeat, beats: this.curDur(), hand, vel: vel || this.tool.vel });
    this.save(); this.draw();
  },
  // inserta la nota del clic o, con el asistente activado, la tríada diatónica completa
  addAtDia(d, startBeat, hand){
    const dias = this.tool.triad ? [d, d + 2, d + 4] : [d];
    const ms = dias.map(x => this.diaToMidi(x));
    audio();
    for (const m of ms){ synthOn(m, 0.6); setTimeout(() => releaseNote(m), 350); }
    this.snapshot();
    for (const m of ms){
      if (!this.cur.notes.some(n => n.m === m && Math.abs(n.startBeat - startBeat) < 0.01))
        this.cur.notes.push({ m, startBeat, beats: this.curDur(), hand, vel: this.tool.vel });
    }
    this.save(); this.draw();
  },
  insertRest(){
    this.snapshot();
    this.cur.rests.push({ startBeat: this.cursorBeat, beats: this.curDur() });
    this.cursorBeat += this.curDur();
    this.autoScroll();
    this.save(); this.draw();
  },
  eraseAt(beat, m){
    let best = null, bd = 1e9, list = null;
    for (const n of this.cur.notes){
      if (Math.abs(n.m - m) > 1) continue;
      const d = Math.abs(n.startBeat - beat) + Math.abs(n.m - m) * 0.2;
      if (d < bd && Math.abs(n.startBeat - beat) < 0.6){ bd = d; best = n; list = this.cur.notes; }
    }
    for (const r of this.cur.rests){
      const d = Math.abs(r.startBeat - beat) + 0.3;     // las notas tienen prioridad
      if (d < bd && Math.abs(r.startBeat - beat) < 0.6){ bd = d; best = r; list = this.cur.rests; }
    }
    if (best){
      this.snapshot();
      list.splice(list.indexOf(best), 1);
      this.save(); this.draw();
    }
  },
  toggleRepeat(kind){
    const bpb = this.beatsPerBar();
    const arr = kind === 'start' ? this.cur.repStarts : this.cur.repEnds;
    const bar = kind === 'start'
      ? Math.floor(this.cursorBeat / bpb)
      : Math.max(1, Math.ceil((this.cursorBeat + 0.01) / bpb));
    this.snapshot();
    const i = arr.indexOf(bar);
    if (i >= 0){ arr.splice(i, 1); toast('Repetición quitada del compás ' + (bar + (kind === 'start' ? 1 : 0))); }
    else { arr.push(bar); arr.sort((a,b) => a - b); toast(kind === 'start' ? '𝄆 Inicio de repetición en el compás ' + (bar + 1) : '𝄇 Fin de repetición tras el compás ' + bar); }
    this.save(); this.draw();
  },

  // Entrada por pasos desde el teclado MIDI (acorde = teclas superpuestas)
  notePress(m, vel){
    if (!this.cur || this.tool.eraser) return;
    if (this.held.size === 0) this.groupStart = this.cursorBeat;
    this.held.add(m);
    this.addNote(m, this.groupStart, m < 60 ? 'L' : 'R', vel || this.tool.vel);
  },
  noteRelease(m){
    if (!this.held.has(m)) return;
    this.held.delete(m);
    if (this.held.size === 0){
      this.cursorBeat = this.groupStart + this.curDur();
      this.autoScroll();
      this.draw();
    }
  },
  autoScroll(){
    const view = this.viewBeats();
    if (this.cursorBeat > this.scrollBeat + view - 2) this.scrollBeat = this.cursorBeat - view + 4;
    if (this.cursorBeat < this.scrollBeat) this.scrollBeat = Math.max(0, this.cursorBeat - 2);
  },

  /* ---------------- Repeticiones: despliegue de la línea temporal ---------------- */
  expandNotes(){
    const bpb = this.beatsPerBar();
    const maxBeat = this.maxBeat();
    const starts = [...this.cur.repStarts].sort((a,b) => a - b).map(x => x * bpb);
    const ends = [...this.cur.repEnds].sort((a,b) => a - b).map(x => x * bpb);
    const segs = []; let pos = 0;
    for (const eb of ends){
      if (eb <= pos || eb > maxBeat + bpb) continue;
      const cand = starts.filter(x => x < eb);
      const sb = cand.length ? Math.max(...cand) : 0;   // cada 𝄇 vuelve al último 𝄆 anterior
      segs.push([pos, eb], [sb, eb]);
      pos = eb;
    }
    segs.push([pos, Math.max(maxBeat, pos) + 1e-3]);
    const out = []; let acc = 0;
    for (const [a, b] of segs){
      if (b <= a) continue;
      for (const n of this.cur.notes){
        if (n.startBeat >= a - 1e-9 && n.startBeat < b - 1e-9)
          out.push({ ...n, startBeat: acc + (n.startBeat - a) });
      }
      acc += b - a;
    }
    return out.sort((x, y) => x.startBeat - y.startBeat);
  },

  /* ---------------- Reproducción de prueba ---------------- */
  stopPlay(){
    for (const t of this.playTimers) clearTimeout(t);
    this.playTimers = [];
    voices.forEach((_, m) => synthOff(m, true));
    $('#cmpPlayBtn').textContent = '▶ Probar';
    this.playingPrev = false;
  },
  play(){
    if (this.playingPrev){ this.stopPlay(); return; }
    const notes = this.expandNotes();
    if (!notes.length){ toast('Añade alguna nota primero 🎵'); return; }
    audio();
    this.playingPrev = true;
    $('#cmpPlayBtn').textContent = '⏹ Parar';
    const spb = 60 / this.cur.bpm;
    let end = 0;
    for (const n of notes){
      const t0 = n.startBeat * spb * 1000, t1 = (n.startBeat + n.beats) * spb * 950;
      end = Math.max(end, t1);
      this.playTimers.push(setTimeout(() => synthOn(n.m, (n.vel || 80) / 127), t0));
      this.playTimers.push(setTimeout(() => releaseNote(n.m), t1));
    }
    this.playTimers.push(setTimeout(() => this.stopPlay(), end + 400));
  },

  /* ---------------- Integración con el modo juego ---------------- */
  toSong(){
    const spb = 60 / this.cur.bpm;
    const bpb = this.beatsPerBar();
    const clickBeat = this.cur.timesig.den === 8 ? 0.5 : 1;
    const notes = this.expandNotes()
      .map(n => ({ m: n.m, start: n.startBeat * spb, dur: Math.max(0.1, n.beats * spb * 0.92), beats: n.beats, hand: n.hand, vel: n.vel }))
      .sort((a,b) => a.start - b.start);
    const duration = notes.reduce((mx,n) => Math.max(mx, n.start + n.dur), 0);
    const bars = [], clicks = [];
    for (let t = 0; t < duration; t += bpb * spb) bars.push(t);
    for (let b = 0; b * spb < duration; b += clickBeat)
      clicks.push({ t: b * spb, accent: Math.abs(b % bpb) < 1e-6 });
    return { title: '✏️ ' + this.cur.title, notes, pedal: [], duration, bars, clicks, cat: 'user', key: this.cur.key };
  },
  practice(){
    if (!this.cur.notes.length){ toast('Añade alguna nota primero 🎵'); return; }
    const song = this.toSong();
    const i = LIBRARY.findIndex(s => s.title === song.title);
    if (i >= 0) LIBRARY[i] = song; else LIBRARY.push(song);
    rebuildSongSelect();
    $('#songSel').value = LIBRARY.indexOf(song);
    S.loopA = S.loopB = null; updLoopUI();
    setSong(song);
    this.close();
    toast('«' + this.cur.title + '» lista para practicar 🎮');
  },

  /* ---------------- Exportar .mid ---------------- */
  exportMid(){
    const notes = this.expandNotes();
    if (!notes.length){ toast('Añade alguna nota primero 🎵'); return; }
    const TPQ = 480;
    const vlq = n => { const out = [n & 0x7F]; n >>= 7; while (n){ out.unshift(0x80 | (n & 0x7F)); n >>= 7; } return out; };
    const track = evs => {
      evs.sort((a,b) => a.tick - b.tick || a.prio - b.prio);
      const bytes = []; let last = 0;
      for (const e of evs){ bytes.push(...vlq(e.tick - last), ...e.data); last = e.tick; }
      bytes.push(...vlq(0), 0xFF, 0x2F, 0x00);
      return [0x4D,0x54,0x72,0x6B, bytes.length >>> 24 & 255, bytes.length >>> 16 & 255, bytes.length >>> 8 & 255, bytes.length & 255, ...bytes];
    };
    const us = Math.round(60000000 / this.cur.bpm);
    const ts = this.cur.timesig;
    const meta = [
      { tick: 0, prio: 0, data: [0xFF, 0x51, 0x03, us >> 16 & 255, us >> 8 & 255, us & 255] },
      { tick: 0, prio: 0, data: [0xFF, 0x58, 0x04, ts.num, Math.log2(ts.den), 24, 8] },
      { tick: 0, prio: 0, data: [0xFF, 0x59, 0x02, this.cur.key & 0xFF, 0] }
    ];
    const hands = { R: [], L: [] };
    for (const n of notes){
      const on = Math.round(n.startBeat * TPQ), off = Math.round((n.startBeat + n.beats) * TPQ);
      hands[n.hand].push({ tick: on, prio: 2, data: [0x90, n.m, clamp(n.vel || 80, 1, 127)] });
      hands[n.hand].push({ tick: off, prio: 1, data: [0x80, n.m, 0] });
    }
    const file = [0x4D,0x54,0x68,0x64, 0,0,0,6, 0,1, 0,3, TPQ >> 8, TPQ & 255,
      ...track(meta), ...track(hands.R), ...track(hands.L)];
    const blob = new Blob([new Uint8Array(file)], { type: 'audio/midi' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = this.cur.title.replace(/[^\wáéíóúñÁÉÍÓÚÑ -]/g, '') + '.mid';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Exportado como .mid ⬇ (las repeticiones van desplegadas; compatible con MuseScore)');
  },

  /* ---------------- Referencia: foto o PDF ---------------- */
  async loadRef(f){
    const wrap = $('#refWrap'), img = $('#refImg');
    if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)){
      try{
        await ensurePdfJs();
        this.ref.pdf = await pdfjsLib.getDocument({ data: await f.arrayBuffer() }).promise;
        this.ref.pages = this.ref.pdf.numPages; this.ref.page = 1;
        await this.renderRefPage();
      }catch(e){
        toast('⚠️ No se pudo leer el PDF (¿sin conexión para cargar el visor?). Prueba con una foto.', 6000);
        return;
      }
    } else if (f.type.startsWith('image/')){
      this.ref.pdf = null; this.ref.pages = 0;
      img.src = URL.createObjectURL(f);
      $('#refPage').textContent = '';
    } else { toast('Usa una imagen (foto) o un PDF'); return; }
    wrap.style.display = 'flex';
    this.resizeCv();
    toast('Referencia cargada: cópiala al pentagrama 👀 La lectura automática (OMR) llegará con el servidor en la fase 2.', 7000);
  },
  async renderRefPage(){
    const page = await this.ref.pdf.getPage(this.ref.page);
    const vp = page.getViewport({ scale: 2 });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    $('#refImg').src = c.toDataURL();
    $('#refPage').textContent = this.ref.page + ' / ' + this.ref.pages;
  },
  refNav(d){
    if (!this.ref.pdf) return;
    this.ref.page = clamp(this.ref.page + d, 1, this.ref.pages);
    this.renderRefPage();
  },

  /* ---------------- Lienzo del editor ---------------- */
  PPB: 56, LEFT: 46, RULER: 22,
  cw: 0, ch: 0, g: 9, trebleBottom: 0, bassBottom: 0,
  viewBeats(){ return Math.max(4, (this.cw - this.LEFT) / this.PPB); },

  resizeCv(){
    const cvE = $('#cmpCv'), st = $('#cmpStage');
    const r = st.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.cw = r.width; this.ch = r.height;
    cvE.width = Math.round(r.width * dpr); cvE.height = Math.round(r.height * dpr);
    cvE.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    this.g = clamp(this.ch / 22, 7, 14);
    this.trebleBottom = this.ch * 0.40;
    this.bassBottom = this.ch * 0.82;
    this.draw();
  },

  beatToX(b){ return this.LEFT + (b - this.scrollBeat) * this.PPB; },
  xToBeat(x){ return Math.max(0, Math.round((this.scrollBeat + (x - this.LEFT) / this.PPB) * 2) / 2); },

  staffYInfo(y){
    const mid = (this.trebleBottom + this.bassBottom - 4 * this.g) / 2;
    return y < mid
      ? { baseD: DIA_E4, baseY: this.trebleBottom, hand: 'R' }
      : { baseD: DIA_G2, baseY: this.bassBottom, hand: 'L' };
  },
  yToDia(y){
    const inf = this.staffYInfo(y);
    const rel = Math.round((inf.baseY - y) / (this.g / 2));
    return { d: inf.baseD + rel, hand: inf.hand };
  },
  midiToY(m, hand){
    const { d } = spellNote(m, this.cur ? this.cur.key : 0);
    const baseD = hand === 'L' ? DIA_G2 : DIA_E4;
    const baseY = hand === 'L' ? this.bassBottom : this.trebleBottom;
    return { y: baseY - (d - baseD) * this.g / 2, rel: d - baseD, baseY };
  },

  drawRest(c, x, beats, baseY, g){
    c.fillStyle = '#55516E'; c.strokeStyle = '#55516E';
    const plain = [4, 2, 1, 0.5].find(v => Math.abs(beats - v) < 0.01 || Math.abs(beats - v * 1.5) < 0.01) || 1;
    if (plain >= 4){                                       // silencio de redonda: cuelga de la 4ª línea
      c.fillRect(x - g * 0.8, baseY - 3 * g, g * 1.6, g * 0.5);
    } else if (plain >= 2){                                // de blanca: apoyado en la 3ª línea
      c.fillRect(x - g * 0.8, baseY - 2 * g - g * 0.5, g * 1.6, g * 0.5);
    } else if (plain >= 1){                                // de negra: zigzag
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x - 2, baseY - 3.3 * g);
      c.quadraticCurveTo(x + g * 0.8, baseY - 2.7 * g, x - 2, baseY - 2.1 * g);
      c.quadraticCurveTo(x + g * 0.8, baseY - 1.5 * g, x - 2, baseY - 0.9 * g);
      c.stroke();
      c.lineWidth = 1;
    } else {                                               // de corchea: punto con corchete
      c.beginPath(); c.arc(x - g * 0.4, baseY - 2.6 * g, g * 0.26, 0, Math.PI * 2); c.fill();
      c.lineWidth = 2;
      c.beginPath(); c.moveTo(x - g * 0.2, baseY - 2.5 * g); c.lineTo(x + g * 0.5, baseY - 1.1 * g); c.stroke();
      c.lineWidth = 1;
    }
    if (Math.abs(beats - plain * 1.5) < 0.01){             // puntillo
      c.beginPath(); c.arc(x + g * 1.2, baseY - 2.4 * g, 2, 0, Math.PI * 2); c.fill();
    }
  },

  draw(){
    if (!this.active || !this.cur) return;
    const c = $('#cmpCv').getContext('2d');
    const g = this.g, W = this.cw, H = this.ch;
    const bpb = this.beatsPerBar();
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#FBFAF4'; c.fillRect(0, 0, W, H);

    const trebleTop = this.trebleBottom - 4 * g;
    const bassTop = this.bassBottom - 4 * g;
    this.LEFT = 50 + Math.min(7, Math.abs(this.cur.key)) * g * 0.85 + 26;

    // regla de compases
    c.fillStyle = '#EFECE2'; c.fillRect(0, 0, W, this.RULER);
    const firstBar = Math.max(0, Math.floor(this.scrollBeat / bpb));
    for (let bar = firstBar; ; bar++){
      const b = bar * bpb;
      const x = this.beatToX(b);
      if (x > W) break;
      if (x < this.LEFT - 4) continue;
      c.strokeStyle = 'rgba(40,40,60,0.4)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, this.RULER); c.lineTo(x, this.bassBottom); c.stroke();
      c.fillStyle = '#6A6685'; c.font = '700 11px Nunito, sans-serif';
      c.fillText(bar + 1, x + 4, 15);
      // subdivisiones de pulso
      c.strokeStyle = 'rgba(40,40,60,0.10)';
      const sub = this.cur.timesig.den === 8 ? 0.5 : 1;
      for (let k = sub; k < bpb - 1e-6; k += sub){
        const xk = this.beatToX(b + k);
        c.beginPath(); c.moveTo(xk, trebleTop); c.lineTo(xk, this.bassBottom); c.stroke();
      }
    }

    // barras de repetición 𝄆 𝄇
    for (const [arr, isStart] of [[this.cur.repStarts, true], [this.cur.repEnds, false]]){
      for (const bar of arr){
        const x = this.beatToX(bar * bpb);
        if (x < this.LEFT - 20 || x > W + 20) continue;
        c.fillStyle = '#2A2840';
        const thick = isStart ? x : x - 4;
        const thin = isStart ? x + 6 : x - 7;
        c.fillRect(thick, trebleTop, 4, this.bassBottom - trebleTop);
        c.fillRect(thin, trebleTop, 1.5, this.bassBottom - trebleTop);
        const dx = isStart ? x + 11 : x - 12;
        for (const baseY of [this.trebleBottom, this.bassBottom]){
          c.beginPath(); c.arc(dx, baseY - 1.5 * g, 2.4, 0, Math.PI * 2); c.fill();
          c.beginPath(); c.arc(dx, baseY - 2.5 * g, 2.4, 0, Math.PI * 2); c.fill();
        }
      }
    }

    // pentagramas
    c.strokeStyle = '#43415A'; c.lineWidth = 1;
    for (let i = 0; i < 5; i++){
      const y1 = this.trebleBottom - i * g, y2 = this.bassBottom - i * g;
      c.beginPath(); c.moveTo(0, y1); c.lineTo(W, y1); c.stroke();
      c.beginPath(); c.moveTo(0, y2); c.lineTo(W, y2); c.stroke();
    }
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(1, trebleTop); c.lineTo(1, this.bassBottom); c.stroke();
    c.lineWidth = 1;
    c.fillStyle = '#2A2840';
    c.font = (g * 5.6) + 'px serif';
    c.fillText('\u{1D11E}', 6, this.trebleBottom + g * 1.1);
    c.font = (g * 3.6) + 'px serif';
    c.fillText('\u{1D122}', 8, this.bassBottom - g * 0.6);

    // armadura y cifra de compás
    c.fillStyle = '#2A2840';
    const xAfterKey = drawKeySigOn(c, this.cur.key, this.trebleBottom, this.bassBottom, g, 44);
    c.font = '800 ' + (g * 2.1) + 'px serif'; c.textAlign = 'center';
    for (const baseY of [this.trebleBottom, this.bassBottom]){
      c.fillText(this.cur.timesig.num, xAfterKey + g, baseY - 2 * g - 3);
      c.fillText(this.cur.timesig.den, xAfterKey + g, baseY - 2);
    }
    c.textAlign = 'left';

    // cursor de inserción
    const cx = this.beatToX(this.cursorBeat);
    if (cx >= this.LEFT - 2 && cx <= W){
      c.fillStyle = 'rgba(255,160,40,0.85)';
      c.fillRect(cx - 1, this.RULER, 2, this.bassBottom + 3 * g - this.RULER);
      c.beginPath(); c.moveTo(cx - 6, this.RULER); c.lineTo(cx + 6, this.RULER); c.lineTo(cx, this.RULER + 8); c.closePath(); c.fill();
    }

    // silencios (en ambos pentagramas)
    for (const r of this.cur.rests){
      const x = this.beatToX(r.startBeat) + g * 0.9;
      if (x < -40 || x > W + 40) continue;
      this.drawRest(c, x, r.beats, this.trebleBottom, g);
      this.drawRest(c, x, r.beats, this.bassBottom, g);
    }

    // notas y dinámicas
    const sorted = [...this.cur.notes].sort((a,b) => a.startBeat - b.startBeat);
    const bucket = v => v <= 60 ? 'p' : v <= 95 ? 'mf' : 'f';
    let lastDyn = null;
    for (const n of sorted){
      const x = this.beatToX(n.startBeat) + g * 0.9;
      if (x >= -40 && x <= W + 40){
        const dyn = bucket(n.vel || 80);
        if (dyn !== lastDyn){
          c.fillStyle = '#7A4A9E';
          c.font = 'italic 800 ' + (g * 1.6) + 'px serif';
          c.fillText(dyn, x - g * 0.5, this.bassBottom + g * 2.4);
        }
      }
      lastDyn = bucket(n.vel || 80);
    }
    for (const n of this.cur.notes){
      const x = this.beatToX(n.startBeat) + g * 0.9;
      if (x < -40 || x > W + 40) continue;
      const { y, rel, baseY } = this.midiToY(n.m, n.hand);
      const color = n.hand === 'L' ? '#2F77C9' : '#2FA85A';
      const { shown } = spellNote(n.m, this.cur.key);
      // líneas adicionales
      c.strokeStyle = '#43415A';
      for (let k = 10; k <= rel; k += 2){
        const ly = baseY - k * g / 2;
        c.beginPath(); c.moveTo(x - g, ly); c.lineTo(x + g, ly); c.stroke();
      }
      for (let k = -2; k >= rel; k -= 2){
        const ly = baseY - k * g / 2;
        c.beginPath(); c.moveTo(x - g, ly); c.lineTo(x + g, ly); c.stroke();
      }
      const filled = n.beats < 1.9;
      const rx = g * 0.62, ry = g * 0.48;
      c.beginPath(); c.ellipse(x, y, rx, ry, -0.3, 0, Math.PI * 2);
      if (filled){ c.fillStyle = color; c.fill(); }
      else { c.strokeStyle = color; c.lineWidth = 2; c.stroke(); }
      const dotted = [0.75, 1.5, 3, 6].some(v => Math.abs(n.beats - v) < 0.01);
      if (dotted){
        c.beginPath(); c.arc(x + rx + 4, y - 2, 2, 0, Math.PI * 2); c.fillStyle = color; c.fill();
      }
      if (n.beats < 3.5){
        const up = rel < 4;
        const sx = up ? x + rx - 0.5 : x - rx + 0.5;
        const ey = up ? y - g * 3.2 : y + g * 3.2;
        c.strokeStyle = color; c.lineWidth = 1.6;
        c.beginPath(); c.moveTo(sx, y); c.lineTo(sx, ey); c.stroke();
        if (n.beats <= 0.6){
          c.beginPath(); c.moveTo(sx, ey);
          c.quadraticCurveTo(sx + g, ey + (up ? g : -g) * 0.6, sx + g * 0.6, ey + (up ? g : -g) * 1.6);
          c.stroke();
        }
      }
      if (shown){
        c.fillStyle = color;
        c.font = '700 ' + (g * 1.8) + 'px serif';
        c.fillText(shown, x - g * 2.1, y + g * 0.62);
      }
    }

    // pista de ayuda
    c.fillStyle = 'rgba(40,40,60,0.4)'; c.font = '700 11px Nunito, sans-serif';
    c.fillText(this.tool.eraser ? 'Goma: toca una nota o silencio para borrarlo' :
      'Toca el pentagrama o tu piano MIDI para añadir notas · arrastra para desplazarte', 10, H - 8);
  },

  /* ---------------- Apertura / cierre ---------------- */
  open(){
    this.load();
    if (!this.cur){ if (this.comps.length) this.select(this.comps[0].id); else this.newComp(); }
    this.active = true;
    togglePlay(false);
    document.body.classList.add('composing');
    $('#composer').style.display = 'flex';
    this.rebuildSel();
    this.resizeCv();
    toast('Modo composición ✏️ Añade notas con el ratón o tocando tu piano');
  },
  close(){
    this.stopPlay();
    this.active = false;
    document.body.classList.remove('composing');
    $('#composer').style.display = 'none';
    resize();
  }
};

/* Carga diferida de pdf.js (solo si se abre un PDF de referencia) */
function ensurePdfJs(){
  if (window.pdfjsLib) return Promise.resolve();
  return new Promise((ok, ko) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      ok();
    };
    s.onerror = ko;
    document.head.appendChild(s);
  });
}

/* ---------------- Interacción con el lienzo del editor ---------------- */
(function(){
  const cvE = document.getElementById('cmpCv');
  let down = null, dragging = false;
  cvE.addEventListener('pointerdown', e => {
    const r = cvE.getBoundingClientRect();
    down = { x: e.clientX - r.left, y: e.clientY - r.top, scroll0: Composer.scrollBeat };
    dragging = false;
    cvE.setPointerCapture(e.pointerId);
  });
  cvE.addEventListener('pointermove', e => {
    if (!down) return;
    const r = cvE.getBoundingClientRect();
    const dx = (e.clientX - r.left) - down.x;
    if (Math.abs(dx) > 10) dragging = true;
    if (dragging){
      Composer.scrollBeat = Math.max(0, down.scroll0 - dx / Composer.PPB);
      Composer.draw();
    }
  });
  cvE.addEventListener('pointerup', e => {
    if (!down) return;
    const r = cvE.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (!dragging){
      const beat = Composer.xToBeat(x);
      if (y <= Composer.RULER + 8){
        Composer.cursorBeat = beat;                  // colocar el cursor
      } else if (Composer.tool.eraser){
        const { d } = Composer.yToDia(y);
        const li = ((d % 7) + 7) % 7;
        const m = (Math.floor(d / 7) + 1) * 12 + LSEMI[li];
        Composer.eraseAt(beat, m);
      } else {
        const { d, hand } = Composer.yToDia(y);
        Composer.addAtDia(d, beat, hand);
        Composer.cursorBeat = beat;
      }
      Composer.draw();
    }
    down = null; dragging = false;
  });
  cvE.addEventListener('wheel', e => {
    e.preventDefault();
    Composer.scrollBeat = Math.max(0, Composer.scrollBeat + e.deltaY * 0.02);
    Composer.draw();
  }, { passive: false });
  window.addEventListener('resize', () => { if (Composer.active) Composer.resizeCv(); });
})();

/* ---------------- Barra de herramientas ---------------- */
$('#compBtn').onclick = () => Composer.open();
$('#cmpCloseBtn').onclick = () => Composer.close();
$('#cmpTitle').oninput = e => {
  if (!Composer.cur) return;
  Composer.cur.title = e.target.value || 'Sin título';
  Composer.save(); Composer.rebuildSel();
};
$('#cmpBpm').onchange = e => {
  if (!Composer.cur) return;
  Composer.cur.bpm = clamp(parseInt(e.target.value) || 100, 40, 200);
  e.target.value = Composer.cur.bpm;
  Composer.save();
};
$('#cmpTs').onchange = e => {
  if (!Composer.cur) return;
  const [num, den] = e.target.value.split('/').map(Number);
  Composer.cur.timesig = { num, den };
  Composer.save(); Composer.draw();
};
$('#cmpKey').onchange = e => {
  if (!Composer.cur) return;
  Composer.cur.key = parseInt(e.target.value) || 0;
  Composer.save(); Composer.draw();
};
$$('#durTabs button').forEach(b => b.onclick = () => {
  Composer.tool.dur = parseFloat(b.dataset.d);
  Composer.tool.eraser = false; $('#delBtn').classList.remove('primary');
  $$('#durTabs button').forEach(x => x.classList.toggle('sel', x === b));
});
$('#dotBtn').onclick = e => { Composer.tool.dot = !Composer.tool.dot; e.currentTarget.classList.toggle('primary', Composer.tool.dot); };
$$('#accTabs button').forEach(b => b.onclick = () => {
  Composer.tool.acc = Composer.tool.acc === b.dataset.a ? null : b.dataset.a;
  $$('#accTabs button').forEach(x => x.classList.toggle('sel', x.dataset.a === Composer.tool.acc));
});
$('#triadBtn').onclick = e => { Composer.tool.triad = !Composer.tool.triad; e.currentTarget.classList.toggle('primary', Composer.tool.triad); };
$('#restBtn').onclick = () => Composer.insertRest();
$('#repABtn').onclick = () => Composer.toggleRepeat('start');
$('#repBBtn').onclick = () => Composer.toggleRepeat('end');
$('#dynSel').onchange = e => { Composer.tool.vel = parseInt(e.target.value); };
$('#delBtn').onclick = e => { Composer.tool.eraser = !Composer.tool.eraser; e.currentTarget.classList.toggle('primary', Composer.tool.eraser); Composer.draw(); };
$('#undoBtn').onclick = () => Composer.undo();
$('#cmpPlayBtn').onclick = () => Composer.play();
$('#cmpUseBtn').onclick = () => Composer.practice();
$('#cmpMidBtn').onclick = () => Composer.exportMid();
$('#cmpNewBtn').onclick = () => Composer.newComp();
$('#cmpDelBtn').onclick = () => {
  if (!Composer.cur) return;
  if (!confirm('¿Borrar la composición «' + Composer.cur.title + '»?')) return;
  Composer.comps = Composer.comps.filter(c => c !== Composer.cur);
  Composer.cur = null; Composer.save();
  if (Composer.comps.length) Composer.select(Composer.comps[0].id); else Composer.newComp();
};
$('#cmpSel').onchange = e => Composer.select(Number(e.target.value));
$('#refBtn').onclick = () => $('#refIn').click();
$('#refIn').onchange = async e => {
  const f = e.target.files[0]; if (f) await Composer.loadRef(f);
  e.target.value = '';
};
$('#refPrev').onclick = () => Composer.refNav(-1);
$('#refNext').onclick = () => Composer.refNav(1);
$('#refClose').onclick = () => { $('#refWrap').style.display = 'none'; Composer.resizeCv(); };

'use strict';
/* Parser de MusicXML (.musicxml / .xml) y MusicXML comprimido (.mxl).
   Cubre lo que exportan MuseScore / Finale / Sibelius para piano:
   - partwise, divisions, backup/forward, acordes (<chord>), ligaduras (<tie>)
   - tempo (<sound tempo>), pedal (<pedal type>), pentagramas (staff 1/2 = manos)
   Devuelve el mismo formato que parseMidiFile: { notes, pedal, duration, bars }. */

function xmlNum(el, tag){
  const c = el.getElementsByTagName(tag)[0];
  return c ? parseFloat(c.textContent) : null;
}

function parseMusicXML(text){
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('No se pudo leer el MusicXML.');
  const root = doc.documentElement;
  if (root.tagName !== 'score-partwise')
    throw new Error('Solo se admite MusicXML "partwise" (el que exporta MuseScore por defecto).');
  const parts = [...root.children].filter(el => el.tagName === 'part');
  if (!parts.length) throw new Error('El archivo no contiene partes.');

  const tempoEv = [];   // { beat, bpm }   (beat = negras desde el inicio)
  const pedalEv = [];   // { beat, down }
  const rawNotes = [];  // { m, startBeat, beats, staffN, partIdx }
  const barBeats = [];  // inicio de cada compás, en negras

  parts.forEach((part, pi) => {
    let divisions = 1, pos = 0, lastStart = 0;
    const open = {};    // ligaduras abiertas: midi -> nota
    for (const meas of [...part.children].filter(el => el.tagName === 'measure')){
      if (pi === 0) barBeats.push(pos);
      for (const el of meas.children){
        const tag = el.tagName;
        if (tag === 'attributes'){
          const d = xmlNum(el, 'divisions');
          if (d) divisions = d;
        } else if (tag === 'direction' || tag === 'sound'){
          const snd = tag === 'sound' ? el : el.getElementsByTagName('sound')[0];
          const bpm = snd && parseFloat(snd.getAttribute('tempo'));
          if (bpm) tempoEv.push({ beat: pos, bpm });
          const ped = el.getElementsByTagName('pedal')[0];
          if (ped){
            const ty = ped.getAttribute('type');
            if (ty === 'start') pedalEv.push({ beat: pos, down: true });
            else if (ty === 'stop') pedalEv.push({ beat: pos, down: false });
          }
        } else if (tag === 'backup'){
          pos -= (xmlNum(el, 'duration') || 0) / divisions;
        } else if (tag === 'forward'){
          pos += (xmlNum(el, 'duration') || 0) / divisions;
        } else if (tag === 'note'){
          const grace = el.getElementsByTagName('grace').length > 0;
          const chord = el.getElementsByTagName('chord').length > 0;
          const rest  = el.getElementsByTagName('rest').length > 0;
          const durBeats = grace ? 0 : (xmlNum(el, 'duration') || 0) / divisions;
          const start = chord ? lastStart : pos;
          if (!rest && !grace){
            const pitch = el.getElementsByTagName('pitch')[0];
            if (pitch){
              const step = pitch.getElementsByTagName('step')[0].textContent.trim();
              const oct = parseInt(pitch.getElementsByTagName('octave')[0].textContent);
              const alter = xmlNum(pitch, 'alter') || 0;
              const m = Math.round(LETTER_SEMI[step] + alter + (oct + 1) * 12);
              const stEl = el.getElementsByTagName('staff')[0];
              const staffN = stEl ? parseInt(stEl.textContent) : 0;
              const ties = [...el.getElementsByTagName('tie')].map(t => t.getAttribute('type'));
              if (ties.includes('stop') && open[m]){
                open[m].beats += durBeats;            // prolonga la nota ligada
                if (!ties.includes('start')) delete open[m];
              } else {
                const note = { m, startBeat: start, beats: durBeats, staffN, partIdx: pi };
                rawNotes.push(note);
                if (ties.includes('start')) open[m] = note;
              }
            }
          }
          if (!chord){ lastStart = pos; pos += durBeats; }
        }
      }
    }
  });

  if (!rawNotes.length) throw new Error('El archivo no contiene notas.');

  // Mapa de tempo: negras -> segundos (120 bpm si la partitura no lo indica)
  tempoEv.sort((a,b) => a.beat - b.beat);
  if (!tempoEv.length || tempoEv[0].beat > 0) tempoEv.unshift({ beat: 0, bpm: 120 });
  const segs = []; let sec = 0;
  for (let i = 0; i < tempoEv.length; i++){
    if (i > 0) sec += (tempoEv[i].beat - tempoEv[i-1].beat) * 60 / tempoEv[i-1].bpm;
    segs.push({ beat: tempoEv[i].beat, sec, spb: 60 / tempoEv[i].bpm });
  }
  const b2s = b => {
    let s = segs[0];
    for (const x of segs){ if (x.beat <= b) s = x; else break; }
    return s.sec + (b - s.beat) * s.spb;
  };

  // Manos: pentagrama 1 = derecha, 2 = izquierda; sin pentagramas, la parte más grave es la izquierda
  let handOfPart = null;
  if (parts.length >= 2 && !rawNotes.some(n => n.staffN >= 2)){
    const byPart = {};
    rawNotes.forEach(n => { (byPart[n.partIdx] = byPart[n.partIdx] || []).push(n.m); });
    const means = Object.entries(byPart)
      .map(([k, arr]) => [Number(k), arr.reduce((a,b) => a + b, 0) / arr.length])
      .sort((a,b) => a[1] - b[1]);
    const lowHalf = new Set(means.slice(0, Math.max(1, Math.floor(means.length / 2))).map(x => x[0]));
    handOfPart = pIdx => lowHalf.has(pIdx) ? 'L' : 'R';
  }

  const notes = rawNotes.filter(n => n.beats > 0).map(n => {
    const start = b2s(n.startBeat);
    const dur = Math.max(0.08, (b2s(n.startBeat + n.beats) - start) * 0.95);
    const hand = n.staffN ? (n.staffN >= 2 ? 'L' : 'R')
               : handOfPart ? handOfPart(n.partIdx)
               : (n.m < 60 ? 'L' : 'R');
    return { m: n.m, start, dur, beats: n.beats, hand };
  }).sort((a,b) => a.start - b.start);

  const pedal = pedalEv.map(ev => ({ t: b2s(ev.beat), down: ev.down })).sort((a,b) => a.t - b.t);
  const bars = barBeats.map(b2s);
  const duration = notes.reduce((mx,n) => Math.max(mx, n.start + n.dur), 0);
  return { notes, pedal, duration, bars };
}

/* ---------- .mxl = MusicXML dentro de un ZIP ---------- */

function zipEntries(buf){
  const dv = new DataView(buf);
  let eocd = -1;
  const stop = Math.max(0, buf.byteLength - 65558);
  for (let i = buf.byteLength - 22; i >= stop; i--){
    if (dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
  }
  if (eocd < 0) throw new Error('El .mxl no es un ZIP válido.');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let i = 0; i < count; i++){
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const compSize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const cmtLen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buf, off + 46, nameLen));
    entries.push({ name, method, compSize, lho });
    off += 46 + nameLen + extraLen + cmtLen;
  }
  return entries;
}

async function zipRead(buf, entry){
  const dv = new DataView(buf);
  const nameLen = dv.getUint16(entry.lho + 26, true);
  const extraLen = dv.getUint16(entry.lho + 28, true);
  const start = entry.lho + 30 + nameLen + extraLen;
  const slice = buf.slice(start, start + entry.compSize);
  if (entry.method === 0) return new TextDecoder().decode(slice);
  if (entry.method === 8){
    const ds = new DecompressionStream('deflate-raw');
    return await new Response(new Blob([slice]).stream().pipeThrough(ds)).text();
  }
  throw new Error('Método de compresión ZIP no soportado.');
}

async function parseMXL(buf){
  const entries = zipEntries(buf);
  let target = null;
  const container = entries.find(e => e.name === 'META-INF/container.xml');
  if (container){
    const xml = await zipRead(buf, container);
    const cdoc = new DOMParser().parseFromString(xml, 'application/xml');
    const rf = cdoc.getElementsByTagName('rootfile')[0];
    const path = rf && rf.getAttribute('full-path');
    if (path) target = entries.find(e => e.name === path);
  }
  if (!target) target = entries.find(e => /\.(musicxml|xml)$/i.test(e.name) && !e.name.startsWith('META-INF'));
  if (!target) throw new Error('El .mxl no contiene ninguna partitura MusicXML.');
  return parseMusicXML(await zipRead(buf, target));
}

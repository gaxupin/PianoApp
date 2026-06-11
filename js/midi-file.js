'use strict';
/* Parser de archivos MIDI estándar (.mid / .midi).
   Devuelve { notes, pedal, duration, bars }:
   - notes: { m, start, dur, beats, hand }  (hand: 'L' | 'R')
   - pedal: { t, down }                     (CC64 del archivo)
   - bars:  tiempos (s) de las líneas de compás (tempo + compás del archivo)
   La separación de manos usa las pistas (la pista más grave = izquierda);
   con una sola pista se decide por altura (Do central). */

function parseMidiFile(buf){
  const dv = new DataView(buf); let p = 0;
  const str4 = () => { let s=''; for (let i=0;i<4;i++) s += String.fromCharCode(dv.getUint8(p++)); return s; };
  const u32 = () => { const v = dv.getUint32(p); p += 4; return v; };
  const u16 = () => { const v = dv.getUint16(p); p += 2; return v; };
  const u8  = () => dv.getUint8(p++);
  const vlq = () => { let v = 0, b; do { b = u8(); v = (v << 7) | (b & 0x7F); } while (b & 0x80); return v; };

  if (str4() !== 'MThd') throw new Error('No parece un archivo MIDI válido.');
  const hLen = u32(); u16(); const nTrk = u16(); const div = u16();
  p += hLen - 6;
  if (div & 0x8000) throw new Error('Este MIDI usa tiempo SMPTE (poco común); expórtalo de nuevo desde MuseScore.');

  const tempos = [{ tick: 0, us: 500000 }];
  const timesigs = [];   // { tick, num, den }
  const tracks = [];     // [{ notes:[{m,tick,offTick,vel}], pedal:[{tick,down}] }]
  for (let tr = 0; tr < nTrk; tr++){
    if (p >= dv.byteLength) break;
    if (str4() !== 'MTrk') throw new Error('Pista MIDI corrupta.');
    const len = u32(), end = p + len;
    let tick = 0, status = 0;
    const open = {}, notes = [], pedal = [];
    while (p < end){
      tick += vlq();
      let b = u8();
      if (b < 0x80){ p--; b = status; } else status = b;
      if (b === 0xFF){
        const type = u8(), l = vlq();
        if (type === 0x51 && l === 3){
          tempos.push({ tick, us: (u8() << 16) | (u8() << 8) | u8() });
        } else if (type === 0x58 && l >= 2){
          const nn = u8(), dd = u8(); p += l - 2;
          timesigs.push({ tick, num: nn, den: Math.pow(2, dd) });
        } else p += l;
      } else if (b === 0xF0 || b === 0xF7){
        p += vlq();
      } else {
        const hi = b & 0xF0;
        if (hi === 0x90 || hi === 0x80){
          const m = u8(), vel = u8();
          if (hi === 0x90 && vel > 0){
            (open[m] = open[m] || []).push({ m, tick, vel });
          } else {
            const st = (open[m] || []).pop();
            if (st) notes.push({ m, tick: st.tick, offTick: tick, vel: st.vel });
          }
        } else if (hi === 0xB0){
          const cc = u8(), v = u8();
          if (cc === 64) pedal.push({ tick, down: v >= 64 });
        } else if (hi === 0xC0 || hi === 0xD0){ p += 1; }
        else { p += 2; } // 0xA0 / 0xE0
      }
    }
    p = end;
    tracks.push({ notes, pedal });
  }

  // Mapa tempo: tick -> segundos
  tempos.sort((a,b) => a.tick - b.tick);
  const segs = []; let acc = 0;
  for (let i = 0; i < tempos.length; i++){
    if (i > 0) acc += (tempos[i].tick - tempos[i-1].tick) * (tempos[i-1].us / 1e6) / div;
    segs.push({ tick: tempos[i].tick, sec: acc, spt: (tempos[i].us / 1e6) / div });
  }
  const t2s = tick => {
    let s = segs[0];
    for (const x of segs){ if (x.tick <= tick) s = x; else break; }
    return s.sec + (tick - s.tick) * s.spt;
  };

  const withNotes = tracks.filter(t => t.notes.length);
  if (!withNotes.length) throw new Error('El archivo no contiene notas.');
  let handOf;
  if (withNotes.length >= 2){
    const avg = t => t.notes.reduce((s,n) => s + n.m, 0) / t.notes.length;
    const sorted = [...withNotes].sort((a,b) => avg(a) - avg(b));
    const lowSet = new Set(sorted.slice(0, Math.floor(withNotes.length / 2) || 1));
    handOf = trk => lowSet.has(trk) ? 'L' : 'R';
  } else {
    handOf = () => null; // se decide por altura
  }

  const notes = [], pedal = [];
  let maxTick = 0;
  for (const trk of withNotes){
    const h = handOf(trk);
    for (const n of trk.notes){
      const start = t2s(n.tick), dur = Math.max(0.08, t2s(n.offTick) - start);
      notes.push({ m: n.m, start, dur, beats: (n.offTick - n.tick) / div, hand: h || (n.m < 60 ? 'L' : 'R') });
      maxTick = Math.max(maxTick, n.offTick);
    }
  }
  for (const trk of tracks) for (const ev of trk.pedal) pedal.push({ t: t2s(ev.tick), down: ev.down });
  notes.sort((a,b) => a.start - b.start);
  pedal.sort((a,b) => a.t - b.t);

  // Líneas de compás y pulsos de metrónomo a partir del compás del archivo (4/4 si no hay)
  const sigs = timesigs.length && timesigs[0].tick === 0 ? timesigs : [{ tick: 0, num: 4, den: 4 }, ...timesigs];
  sigs.sort((a,b) => a.tick - b.tick);
  const bars = [], clicks = [];
  for (let i = 0; i < sigs.length && bars.length < 4000; i++){
    const beatTicks = div * 4 / sigs[i].den;
    const step = sigs[i].num * beatTicks;
    if (step <= 0 || beatTicks <= 0) continue;
    const segEnd = i + 1 < sigs.length ? sigs[i+1].tick : maxTick;
    for (let t = sigs[i].tick; t < segEnd && bars.length < 4000; t += step) bars.push(t2s(t));
    for (let t = sigs[i].tick, k = 0; t < segEnd && clicks.length < 8000; t += beatTicks, k++)
      clicks.push({ t: t2s(t), accent: k % sigs[i].num === 0 });
  }

  const duration = notes.reduce((mx,n) => Math.max(mx, n.start + n.dur), 0);
  return { notes, pedal, duration, bars, clicks };
}

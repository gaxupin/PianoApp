'use strict';
/* Repertorio de demostración y ejercicios incluidos en la app.
   seq(): convierte [nota | [acorde] | null(silencio), duración en pulsos] en notas. */

function seq(hand, bpm, items){
  const out = []; let beat = 0; const spb = 60 / bpm;
  for (const [n, d] of items){
    if (n){
      const ns = Array.isArray(n) ? n : [n];
      for (const x of ns) out.push({ m: nameToMidi(x), start: beat * spb, dur: d * spb * 0.92, beats: d, hand });
    }
    beat += d;
  }
  return out;
}

function buildSong(title, bpm, rh, lh, opts = {}){
  const beatsPerBar = opts.beatsPerBar || 4;
  const notes = [...seq('R', bpm, rh), ...seq('L', bpm, lh)].sort((a,b) => a.start - b.start);
  const duration = notes.reduce((mx,n) => Math.max(mx, n.start + n.dur), 0);
  const spb = 60 / bpm, bars = [];
  for (let t = 0; t < duration; t += beatsPerBar * spb) bars.push(t);
  return { title, notes, pedal: [], duration, bars, cat: opts.cat || 'song' };
}

const DEMOS = [
  buildSong('Himno de la Alegría (2 manos)', 100,
    [ ['E4',1],['E4',1],['F4',1],['G4',1], ['G4',1],['F4',1],['E4',1],['D4',1],
      ['C4',1],['C4',1],['D4',1],['E4',1], ['E4',1.5],['D4',.5],['D4',2],
      ['E4',1],['E4',1],['F4',1],['G4',1], ['G4',1],['F4',1],['E4',1],['D4',1],
      ['C4',1],['C4',1],['D4',1],['E4',1], ['D4',1.5],['C4',.5],['C4',2] ],
    [ [['C3','G3'],2],['C3',2], ['G2',2],[['G2','D3'],2], [['C3','G3'],2],['C3',2], ['G2',2],['G2',2],
      [['C3','G3'],2],['C3',2], ['G2',2],[['G2','D3'],2], [['C3','G3'],2],['C3',2], ['G2',2],[['C3','G3'],2] ]),

  buildSong('Para Elisa (inicio)', 76,
    [ ['E5',.5],['D#5',.5],['E5',.5],['D#5',.5],['E5',.5],['B4',.5],['D5',.5],['C5',.5],
      ['A4',1],[null,.5],['C4',.5],['E4',.5],['A4',.5],
      ['B4',1],[null,.5],['E4',.5],['G#4',.5],['B4',.5],
      ['C5',1],[null,.5],['E4',.5],
      ['E5',.5],['D#5',.5],['E5',.5],['D#5',.5],['E5',.5],['B4',.5],['D5',.5],['C5',.5],
      ['A4',1],[null,.5],['C4',.5],['E4',.5],['A4',.5],
      ['B4',1],[null,.5],['E4',.5],['C5',.5],['B4',.5],
      ['A4',2] ],
    [ [null,4],['A2',.5],['E3',.5],['A3',.5],[null,1.5],
      ['E2',.5],['E3',.5],['G#3',.5],[null,1.5],
      ['A2',.5],['E3',.5],['A3',.5],[null,4.5],
      ['A2',.5],['E3',.5],['A3',.5],[null,1.5],
      ['E2',.5],['E3',.5],['G#3',.5],[null,1.5],
      [['A2','E3'],2] ],
    { beatsPerBar: 1.5 }),

  buildSong('Estrellita (mano derecha)', 90,
    [ ['C4',1],['C4',1],['G4',1],['G4',1], ['A4',1],['A4',1],['G4',2],
      ['F4',1],['F4',1],['E4',1],['E4',1], ['D4',1],['D4',1],['C4',2],
      ['G4',1],['G4',1],['F4',1],['F4',1], ['E4',1],['E4',1],['D4',2],
      ['G4',1],['G4',1],['F4',1],['F4',1], ['E4',1],['E4',1],['D4',2],
      ['C4',1],['C4',1],['G4',1],['G4',1], ['A4',1],['A4',1],['G4',2],
      ['F4',1],['F4',1],['E4',1],['E4',1], ['D4',1],['D4',1],['C4',2] ],
    []),

  buildSong('Escala de Do (manos paralelas)', 90,
    [ ['C4',1],['D4',1],['E4',1],['F4',1], ['G4',1],['A4',1],['B4',1],['C5',1],
      ['C5',1],['B4',1],['A4',1],['G4',1], ['F4',1],['E4',1],['D4',1],['C4',2] ],
    [ ['C3',1],['D3',1],['E3',1],['F3',1], ['G3',1],['A3',1],['B3',1],['C4',1],
      ['C4',1],['B3',1],['A3',1],['G3',1], ['F3',1],['E3',1],['D3',1],['C3',2] ],
    { cat: 'ex' }),

  buildSong('Acordes I–V–vi–IV (mano izquierda)', 80,
    [],
    [ [['C3','E3','G3'],4], [['G2','B2','D3'],4], [['A2','C3','E3'],4], [['F2','A2','C3'],4],
      [['C3','E3','G3'],4], [['G2','B2','D3'],4], [['A2','C3','E3'],4], [['F2','A2','C3'],4] ],
    { cat: 'ex' })
];

'use strict';
/* Utilidades compartidas: nombres de notas, formato y helpers de teoría. */

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

const NOTE_ES = ['Do','Do♯','Re','Re♯','Mi','Fa','Fa♯','Sol','Sol♯','La','La♯','Si'];
const NOTE_EN = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];

const isBlack = m => [1,3,6,8,10].includes(((m % 12) + 12) % 12);
const fmt = t => { t = Math.max(0, t); return Math.floor(t/60) + ':' + String(Math.floor(t%60)).padStart(2,'0'); };
const clamp = (v,a,b) => Math.min(b, Math.max(a, v));

const LETTER_SEMI = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };

// "C4", "F#3", "Bb2" -> número MIDI
function nameToMidi(n){
  const m = n.match(/^([A-G])([#b]?)(-?\d)$/);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return LETTER_SEMI[m[1]] + acc + (parseInt(m[3]) + 1) * 12;
}

// Deletreo simple en sostenidos: clase de altura -> [índice de letra (0=Do..6=Si), ¿sostenido?]
const PC_SPELL = [[0,0],[0,1],[1,0],[1,1],[2,0],[3,0],[3,1],[4,0],[4,1],[5,0],[5,1],[6,0]];
// Deletreo en bemoles: clase de altura -> [índice de letra, alteración]
const PC_FLAT = [[0,0],[1,-1],[1,0],[2,-1],[2,0],[3,0],[4,-1],[4,0],[5,-1],[5,0],[6,-1],[6,0]];
const LSEMI = [0,2,4,5,7,9,11];          // semitonos de cada letra natural (Do..Si)
const SHARP_ORDER = [3,0,4,1,5,2,6];     // Fa Do Sol Re La Mi Si
const FLAT_ORDER  = [6,2,5,1,4,0,3];     // Si Mi La Re Sol Do Fa

// Alteración que la armadura aplica a una letra (key = nº de sostenidos, negativo = bemoles)
function keyAlterOfLetter(li, key){
  if (key > 0 && SHARP_ORDER.slice(0, key).includes(li)) return 1;
  if (key < 0 && FLAT_ORDER.slice(0, -key).includes(li)) return -1;
  return 0;
}

// Posición diatónica y alteración a mostrar para una nota según la armadura
function spellNote(m, key = 0){
  const pc = ((m % 12) + 12) % 12;
  const oct = Math.floor(m / 12) - 1;
  const [li, acc] = (key < 0 ? PC_FLAT : PC_SPELL)[pc];
  const d = oct * 7 + li;
  const expected = keyAlterOfLetter(li, key);
  const shown = acc === expected ? '' : acc === 1 ? '♯' : acc === -1 ? '♭' : '♮';
  return { d, shown };
}

// Posición diatónica absoluta (para colocar la cabeza de nota en el pentagrama)
function diatonicOf(m){
  const pc = ((m % 12) + 12) % 12;
  const oct = Math.floor(m / 12) - 1;
  const [li, acc] = PC_SPELL[pc];
  return { d: oct * 7 + li, sharp: acc === 1 };
}
const DIA_E4 = diatonicOf(64).d;  // línea inferior de la clave de sol
const DIA_G2 = diatonicOf(43).d;  // línea inferior de la clave de fa

// Posición diatónica de un nombre tipo "F5" (para dibujar armaduras)
function diaOfName(n){
  return (parseInt(n[1]) ) * 7 + ['C','D','E','F','G','A','B'].indexOf(n[0]);
}
// Posiciones estándar de la armadura en cada clave
const KEYSIG_POS = {
  sharp: { treble: ['F5','C5','G5','D5','A4','E5','B4'], bass: ['F3','C3','G3','D3','A2','E3','B2'] },
  flat:  { treble: ['B4','E5','A4','D5','G4','C5','F4'], bass: ['B2','E3','A2','D3','G2','C3','F2'] }
};

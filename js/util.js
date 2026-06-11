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

// Posición diatónica absoluta (para colocar la cabeza de nota en el pentagrama)
function diatonicOf(m){
  const pc = ((m % 12) + 12) % 12;
  const oct = Math.floor(m / 12) - 1;
  const [li, acc] = PC_SPELL[pc];
  return { d: oct * 7 + li, sharp: acc === 1 };
}
const DIA_E4 = diatonicOf(64).d;  // línea inferior de la clave de sol
const DIA_G2 = diatonicOf(43).d;  // línea inferior de la clave de fa

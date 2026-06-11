'use strict';
/* Sintetizador sencillo con WebAudio: dos osciladores + filtro, y pedal de resonancia (CC64). */

let AC = null, master = null;
function audio(){
  if (!AC){
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = 0.5;
    const comp = AC.createDynamicsCompressor();
    master.connect(comp); comp.connect(AC.destination);
  }
  if (AC.state === 'suspended') AC.resume();
  return AC;
}

const voices = new Map();      // midi -> voz activa
const sustained = new Set();   // notas retenidas por el pedal
let pedalDown = false;

function synthOn(m, vel = 0.8){
  if (!AC) return;
  synthOff(m, true); sustained.delete(m);
  const t = AC.currentTime, f = 440 * Math.pow(2, (m - 69) / 12);
  const g = AC.createGain();
  const lp = AC.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.value = Math.min(8000, 900 + f * 4); lp.Q.value = 0.4;
  const o1 = AC.createOscillator(); o1.type = 'triangle'; o1.frequency.value = f;
  const o2 = AC.createOscillator(); o2.type = 'sine';     o2.frequency.value = f * 2;
  const g2 = AC.createGain(); g2.gain.value = 0.25;
  o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(master);
  const peak = 0.16 + vel * 0.30;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
  g.gain.exponentialRampToValueAtTime(peak * 0.32, t + 0.55);
  g.gain.exponentialRampToValueAtTime(peak * 0.16, t + 2.2);
  o1.start(t); o2.start(t);
  voices.set(m, { g, stopAll(){ try{o1.stop()}catch(e){} try{o2.stop()}catch(e){} } });
}

function synthOff(m, hard = false){
  const v = voices.get(m); if (!v) return;
  voices.delete(m);
  const t = AC.currentTime;
  v.g.gain.cancelScheduledValues(t);
  v.g.gain.setValueAtTime(Math.max(v.g.gain.value, 0.0001), t);
  v.g.gain.exponentialRampToValueAtTime(0.0001, t + (hard ? 0.03 : 0.28));
  setTimeout(() => v.stopAll(), hard ? 60 : 380);
}

function releaseNote(m){ if (pedalDown){ sustained.add(m); } else synthOff(m); }

// Clic de metrónomo y cuenta de entrada (acentuado en el primer pulso del compás)
function clickSound(accent){
  if (!AC) return;
  const t = AC.currentTime;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = 'square'; o.frequency.value = accent ? 1568 : 1175;
  g.gain.setValueAtTime(accent ? 0.22 : 0.14, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + 0.08);
}

function setPedal(d){
  pedalDown = d;
  $('#pedalLamp').classList.toggle('on', d);
  if (!d){ sustained.forEach(m => synthOff(m)); sustained.clear(); }
}

'use strict';
/* Progreso persistente (localStorage): puntos totales, estrellas por canción,
   racha de días de práctica y logros desbloqueables. */

const ACHIEVEMENTS = [
  { id:'first',    icon:'🎵', name:'Primera canción',  desc:'Completa una canción en modo Tocar o Espera',
    test: st => st.mode !== 'listen' },
  { id:'stars3',   icon:'⭐', name:'Tres estrellas',   desc:'Consigue 3 estrellas en una canción',
    test: st => st.stars === 3 },
  { id:'combo20',  icon:'🔥', name:'Combo ×20',        desc:'Encadena 20 notas seguidas sin fallar',
    test: st => st.combo >= 20 },
  { id:'combo50',  icon:'🌋', name:'Combo ×50',        desc:'Encadena 50 notas seguidas sin fallar',
    test: st => st.combo >= 50 },
  { id:'perfect10',icon:'🎯', name:'Reloj suizo',      desc:'10 notas perfectas en una misma canción',
    test: st => st.perfect >= 10 },
  { id:'lefty',    icon:'🤚', name:'Zurdo de oro',     desc:'Completa una canción solo con la mano izquierda',
    test: st => st.hands === 'L' && st.mode !== 'listen' },
  { id:'librarian',icon:'📂', name:'Mi biblioteca',    desc:'Carga tu propia partitura (MIDI o MusicXML)',
    test: null },
  { id:'streak3',  icon:'📅', name:'Constancia',       desc:'Practica 3 días seguidos',
    test: (st, P) => P.data.streak >= 3 },
  { id:'five',     icon:'🏅', name:'Repertorio',       desc:'Consigue estrellas en 5 canciones distintas',
    test: (st, P) => Object.values(P.data.songs).filter(s => s.stars > 0).length >= 5 }
];

const Progress = {
  KEY: 'atril.progress.v1',
  data: null,

  load(){
    try{ this.data = JSON.parse(localStorage.getItem(this.KEY)); }catch(e){ this.data = null; }
    if (!this.data || typeof this.data !== 'object')
      this.data = { total: 0, songs: {}, ach: {}, streak: 0, lastDay: '', prof: 'junior' };
    this.data.songs = this.data.songs || {};
    this.data.ach = this.data.ach || {};
  },
  save(){
    try{ localStorage.setItem(this.KEY, JSON.stringify(this.data)); }catch(e){}
  },

  touchDay(){
    const today = new Date().toISOString().slice(0, 10);
    if (this.data.lastDay === today) return;
    const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    this.data.streak = this.data.lastDay === yesterday ? this.data.streak + 1 : 1;
    this.data.lastDay = today;
  },

  // Registra el resultado de una partida (solo modos Tocar / Espera)
  record(song, score, stars){
    this.touchDay();
    const s = this.data.songs[song] = this.data.songs[song] || { stars: 0, best: 0, plays: 0 };
    s.plays++;
    s.best = Math.max(s.best, score);
    s.stars = Math.max(s.stars, stars);
    this.data.total += score;
    this.save();
  },

  // Comprueba logros tras una partida; devuelve los recién desbloqueados
  checkUnlocks(stats){
    const out = [];
    for (const a of ACHIEVEMENTS){
      if (this.data.ach[a.id] || !a.test) continue;
      let ok = false;
      try{ ok = a.test(stats, this); }catch(e){}
      if (ok){ this.data.ach[a.id] = Date.now(); out.push(a); }
    }
    if (out.length) this.save();
    return out;
  },

  // Desbloqueo directo (p. ej. al subir un archivo); null si ya estaba
  unlock(id){
    if (this.data.ach[id]) return null;
    const a = ACHIEVEMENTS.find(x => x.id === id);
    if (!a) return null;
    this.data.ach[id] = Date.now();
    this.save();
    return a;
  }
};
Progress.load();

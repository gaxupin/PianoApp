'use strict';
/* Atril — lógica principal: estado, modos de juego (Escuchar / Tocar / Espera),
   puntuación, perfiles por edad, biblioteca, transporte y bucle de animación. */

/* ---------------- Perfiles por edad ---------------- */
const PROFILES = {
  peque:  { hit: 0.50, perfect: 0.18, missAfter: 0.60, stars: [0.30, 0.55, 0.80] },
  junior: { hit: 0.35, perfect: 0.12, missAfter: 0.45, stars: [0.45, 0.70, 0.90] },
  pro:    { hit: 0.25, perfect: 0.09, missAfter: 0.35, stars: [0.60, 0.80, 0.95] }
};

/* ---------------- Estado ---------------- */
const S = {
  song: null, mode: 'listen', hands: 'both',
  view: ['fall','staff','both'].includes(Progress.data.view) ? Progress.data.view : 'fall',
  names: 'es',
  prof: Progress.data.prof || 'junior',
  // Sonido de la app para las teclas que tocas por MIDI. Apagado por defecto:
  // un piano conectado ya suena por sus altavoces y duplicarlo con el retardo
  // del navegador se percibe como eco/distorsión.
  midiSound: Progress.data.midiSound === true,
  metro: Progress.data.metro === true,
  countdown: null,    // cuenta de entrada: { beats, period, t }
  playing: false, t: 0, rate: 1,
  score: 0, combo: 0, maxCombo: 0, hits: 0, perfect: 0, misses: 0, missLog: [],
  handHit: { L: 0, R: 0 }, handMiss: { L: 0, R: 0 },
  gates: [], gi: 0, waiting: false, required: new Map(), // midi -> ok
  loopA: null, loopB: null,
  pressed: new Set(), fx: [], lo: 48, hi: 84, finished: false
};
const activeHand = h => S.hands === 'both' || S.hands === h;
const prof = () => PROFILES[S.prof] || PROFILES.junior;

function setSong(song){
  S.song = song;
  let lo = 60, hi = 72;
  if (song.notes.length){
    lo = Math.min(...song.notes.map(n => n.m)) - 2;
    hi = Math.max(...song.notes.map(n => n.m)) + 2;
  }
  while (hi - lo < 24){ lo--; hi++; }
  while (isBlack(lo)) lo--;
  while (isBlack(hi)) hi++;
  S.lo = clamp(lo, 21, 96); S.hi = clamp(hi, S.lo + 12, 108);
  $('#tEnd').textContent = fmt(song.duration);
  resetRun(0); resize();
}

function buildGates(){
  const starts = S.song.notes.filter(n => activeHand(n.hand)).sort((a,b) => a.start - b.start);
  const gates = [];
  for (const n of starts){
    const g = gates[gates.length - 1];
    if (g && n.start - g.t < 0.06) g.notes.push(n);
    else gates.push({ t: n.start, notes: [n] });
  }
  return gates;
}

function resetRun(t = 0){
  S.t = t; S.playing = false; S.waiting = false; S.finished = false; S.countdown = null;
  S.score = 0; S.combo = 0; S.maxCombo = 0; S.hits = 0; S.perfect = 0; S.misses = 0; S.missLog = [];
  S.handHit = { L: 0, R: 0 }; S.handMiss = { L: 0, R: 0 };
  S.fx = []; S.required.clear();
  for (const n of S.song.notes){ n.hit = n.start < t; n.missed = false; }
  S.gates = buildGates();
  S.gi = S.gates.findIndex(g => g.t >= t - 0.001);
  if (S.gi < 0) S.gi = S.gates.length;
  voices.forEach((_, m) => synthOff(m, true));
  $('#overlay').style.display = 'none';
  $('#playBtn').textContent = '▶';
  updHud();
}

function updHud(){
  $('#scoreV').textContent = S.score;
  $('#comboV').textContent = S.combo;
  const tot = S.hits + S.misses;
  $('#precV').textContent = tot ? Math.round(100 * S.hits / tot) + '%' : '—';
}

/* ---------------- Lógica de juego ---------------- */
function autoplayHand(h){
  if (S.mode === 'listen') return true;
  return !activeHand(h);
}

// Duración aproximada del pulso en la posición actual (para la cuenta de entrada)
function beatPeriodAt(t){
  const c = S.song && S.song.clicks;
  if (c && c.length > 1){
    let i = c.findIndex(x => x.t >= t);
    if (i < 1) i = i === 0 ? 1 : c.length - 1;
    const p = c[i].t - c[i-1].t;
    if (p > 0.2 && p < 2) return p;
  }
  return 0.6;
}

function step(dt){
  if (!S.playing || !S.song) return;

  // cuenta de entrada: 4 pulsos de metrónomo antes de empezar a sonar
  if (S.countdown){
    const c = S.countdown;
    const before = Math.floor(c.t / c.period);
    c.t += dt;
    const after = Math.floor(c.t / c.period);
    if (after > before && after < c.beats) clickSound(false);
    if (c.t >= c.beats * c.period) S.countdown = null;
    else return;
  }

  const prev = S.t;
  let next = prev + dt * S.rate;

  // metrónomo
  if (S.metro && S.song.clicks){
    for (const c of S.song.clicks)
      if (c.t > prev && c.t <= next) clickSound(c.accent);
  }

  if (S.mode === 'wait'){
    const g = S.gates[S.gi];
    if (g && next >= g.t){
      next = g.t;
      if (!S.waiting){
        S.waiting = true;
        S.required = new Map(g.notes.map(n => [n.m, false]));
      }
    }
  }
  // notas automáticas (acompañamiento o reproducción completa)
  for (const n of S.song.notes){
    if (n.start > prev && n.start <= next && autoplayHand(n.hand)){
      synthOn(n.m, n.vel ? n.vel / 127 : 0.55 + (n.hand === 'L' ? 0 : 0.1));
      setTimeout(() => { releaseNote(n.m); }, (n.dur / S.rate) * 1000);
    }
  }
  // pedal del archivo
  if (S.song.pedal.length){
    for (const ev of S.song.pedal) if (ev.t > prev && ev.t <= next) setPedal(ev.down);
  }
  // fallos en modo Tocar
  if (S.mode === 'play'){
    for (const n of S.song.notes){
      if (!n.hit && !n.missed && activeHand(n.hand) && n.start < next - prof().missAfter){
        n.missed = true; S.misses++; S.combo = 0; S.missLog.push(n.start);
        S.handMiss[n.hand]++;
        addFx(n.m, '✗', 'var(--danger)');
      }
    }
    updHud();
  }
  S.t = next;
  // bucle A-B
  if (S.loopB != null && S.t >= S.loopB){ seek(S.loopA || 0); return; }
  if (S.t > S.song.duration + 0.8) finish();
}

function userPress(m, vel = 0.8, fromMidi = false){
  audio();
  // Por MIDI, el sonido lo pone el propio piano salvo que se active el de la app
  if (!fromMidi || S.midiSound) synthOn(m, vel);
  S.pressed.add(m);
  // en modo composición, las teclas insertan notas en la partitura
  // (con la velocidad real de la pulsación como dinámica)
  if (typeof Composer !== 'undefined' && Composer.active){
    Composer.notePress(m, Math.round(clamp(vel, 0.05, 1) * 127));
    return;
  }
  if (!S.song) return;
  if (S.mode === 'wait' && S.waiting){
    if (S.required.has(m) && !S.required.get(m)){
      S.required.set(m, true);
      const g = S.gates[S.gi];
      const n = g.notes.find(x => x.m === m);
      if (n){ n.hit = true; S.handHit[n.hand]++; }
      S.hits++; S.combo++; S.maxCombo = Math.max(S.maxCombo, S.combo);
      S.score += 10; addFx(m, '✓', 'var(--rh)');
      if ([...S.required.values()].every(Boolean)){
        S.waiting = false; S.gi++;
        S.required.clear();
      }
      updHud();
    }
  } else if (S.mode === 'play' && S.playing){
    let best = null, bestD = prof().hit;
    for (const n of S.song.notes){
      if (n.m !== m || n.hit || n.missed || !activeHand(n.hand)) continue;
      const d = Math.abs(n.start - S.t);
      if (d < bestD){ bestD = d; best = n; }
    }
    if (best){
      best.hit = true; S.hits++; S.combo++; S.maxCombo = Math.max(S.maxCombo, S.combo);
      S.handHit[best.hand]++;
      const mult = 1 + Math.min(3, Math.floor(S.combo / 10));
      if (bestD < prof().perfect){ S.perfect++; S.score += 15 * mult; addFx(m, '¡Perfecto!', 'var(--amber)'); }
      else { S.score += 10 * mult; addFx(m, '¡Bien!', 'var(--rh)'); }
    } else {
      S.combo = 0;
    }
    updHud();
  }
}
function userRelease(m){
  S.pressed.delete(m); releaseNote(m);
  if (typeof Composer !== 'undefined' && Composer.active) Composer.noteRelease(m);
}

function addFx(m, txt, color){
  const k = KEYS.find(k => k.m === m);
  S.fx.push({ x: k ? k.x + k.w / 2 : CW / 2, y: KBTOP - 14, txt, color, age: 0 });
}

function finish(){
  S.playing = false; S.finished = true; $('#playBtn').textContent = '▶';
  const ov = $('#overlay'); ov.style.display = 'flex';
  const tot = S.hits + S.misses;
  const acc = tot ? S.hits / tot : 1;
  const th = prof().stars;
  let starsN = 0, msg = '';
  if (S.mode === 'listen'){
    $('#ovTitle').textContent = 'Fin de la canción 🎵';
    msg = 'Ahora prueba el modo 🐢 Espera para tocarla tú.';
    $('#ovStars').innerHTML = '';
  } else {
    starsN = acc >= th[2] ? 3 : acc >= th[1] ? 2 : acc >= th[0] ? 1 : 0;
    $('#ovTitle').textContent = starsN === 3 ? '¡Increíble! 🏆' : starsN === 2 ? '¡Muy bien! 🎉' : starsN >= 1 ? '¡Buen intento! 💪' : 'Sigue practicando 🌱';
    $('#ovStars').innerHTML = [0,1,2].map(i => `<span class="${i < starsN ? '' : 'off'}">⭐</span>`).join('');
    msg = `Puntos: <b>${S.score}</b> · Aciertos: <b>${S.hits}</b>` +
          (S.mode === 'play' ? ` · Fallos: <b>${S.misses}</b> · Precisión: <b>${Math.round(acc*100)}%</b> · Perfectas: <b>${S.perfect}</b>` : '');

    // progreso y logros
    Progress.record(S.song.title, S.score, starsN);
    const unlocked = Progress.checkUnlocks({
      mode: S.mode, stars: starsN, acc, score: S.score,
      combo: S.maxCombo, perfect: S.perfect, hands: S.hands
    });
    let delay = 400;
    for (const a of unlocked){
      setTimeout(() => toast(`🏅 Logro desbloqueado: ${a.icon} ${a.name}`), delay);
      delay += 2600;
    }
  }
  $('#ovMsg').innerHTML = msg;

  // consejos: fragmento difícil (con bucle de repaso) y mano que más falla
  const tip = $('#ovTip'), loopBtn = $('#ovLoop');
  tip.style.display = 'none'; loopBtn.style.display = 'none';
  const tips = [];
  if (S.mode === 'play' && S.missLog.length >= 3){
    const buckets = {};
    for (const t of S.missLog){ const b = Math.floor(t / 5); buckets[b] = (buckets[b] || 0) + 1; }
    const worst = Object.entries(buckets).sort((a,b) => b[1] - a[1])[0];
    if (worst && worst[1] >= 2){
      const a = Math.max(0, worst[0] * 5 - 1), b = Math.min(S.song.duration, worst[0] * 5 + 6);
      tips.push(`💡 Te costó el tramo <b>${fmt(a)} – ${fmt(b)}</b>. ¡Vamos a repasarlo despacio!`);
      loopBtn.style.display = 'inline-block';
      loopBtn.onclick = () => {
        S.loopA = a; S.loopB = b; updLoopUI();
        setMode('wait'); seek(a); ov.style.display = 'none'; togglePlay(true);
      };
    }
  }
  if (S.mode !== 'listen' && S.hands === 'both'){
    const accOf = h => {
      const t2 = S.handHit[h] + S.handMiss[h];
      return t2 >= 6 ? S.handHit[h] / t2 : null;
    };
    const aL = accOf('L'), aR = accOf('R');
    if (aL != null && aR != null && Math.abs(aL - aR) >= 0.15){
      const worse = aL < aR;
      tips.push(`${worse ? '🤚' : '✋'} La mano ${worse ? 'izquierda' : 'derecha'} falló más ` +
        `(<b>${Math.round(Math.min(aL, aR) * 100)}%</b> frente a <b>${Math.round(Math.max(aL, aR) * 100)}%</b>). ` +
        `Practícala sola con el filtro de manos.`);
    }
  }
  if (tips.length){
    tip.innerHTML = tips.join('<br><br>');
    tip.style.display = 'block';
  }
}

/* ---------------- Transporte ---------------- */
function togglePlay(force){
  if (!S.song) return;
  audio();
  if (S.finished) resetRun(S.loopA || 0);
  const was = S.playing;
  S.playing = force != null ? force : !S.playing;
  $('#playBtn').textContent = S.playing ? '⏸' : '▶';
  // cuenta de entrada de 4 pulsos al empezar en modo Tocar
  if (S.playing && !was && S.mode === 'play'){
    S.countdown = { beats: 4, period: clamp(beatPeriodAt(S.t) / S.rate, 0.25, 1.5), t: 0 };
    clickSound(true);
  }
  if (!S.playing) S.countdown = null;
}
function seek(t){
  t = clamp(t, 0, S.song.duration);
  S.t = t; S.waiting = false; S.required.clear(); S.finished = false; S.countdown = null;
  for (const n of S.song.notes){
    if (n.start >= t - 0.05){ n.hit = false; n.missed = false; }
    else if (!n.hit && !n.missed) n.hit = true;
  }
  S.gi = S.gates.findIndex(g => g.t >= t - 0.001);
  if (S.gi < 0) S.gi = S.gates.length;
  voices.forEach((_, m) => synthOff(m, true));
  $('#overlay').style.display = 'none';
}
function setMode(m){
  S.mode = m;
  $$('#modeTabs button').forEach(b => b.classList.toggle('sel', b.dataset.m === m));
  resetRun(S.loopA || 0);
  toast(m === 'listen' ? 'Escucha la canción y mira las teclas 👀'
      : m === 'play'   ? '¡Toca a la vez que avanza la música! 🎯'
      : 'La canción te espera: pulsa la tecla correcta para avanzar 🐢');
}
function setHands(h){
  S.hands = h;
  $$('#handTabs button').forEach(b => b.classList.toggle('sel', b.dataset.h === h));
  resetRun(S.loopA || 0);
}
function setView(v){
  S.view = v;
  Progress.data.view = v; Progress.save();
  $$('#viewTabs button').forEach(b => b.classList.toggle('sel', b.dataset.v === v));
  toast(v === 'staff' ? 'Vista de partitura: lee las notas en el pentagrama 🎼'
      : v === 'both'  ? 'Vista mixta: partitura arriba y cascada abajo 🎼🌊'
                      : 'Vista cascada: las notas caen hacia las teclas 🌊');
}
function updLoopUI(){
  const has = S.loopA != null && S.loopB != null;
  $('#loopXBtn').style.display = has ? 'inline-block' : 'none';
  const el = $('#barLoop');
  if (has && S.song){
    el.style.display = 'block';
    el.style.left = (100 * S.loopA / S.song.duration) + '%';
    el.style.width = (100 * (S.loopB - S.loopA) / S.song.duration) + '%';
  } else el.style.display = 'none';
}
let toastTimer = null;
function toast(txt, ms = 3200){
  const el = $('#toast'); el.textContent = txt; el.style.display = 'block';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.style.display = 'none', ms);
}

/* ---------------- Biblioteca y carga de archivos ---------------- */
const LIBRARY = [...DEMOS];

function rebuildSongSelect(){
  const sel = $('#songSel');
  const cur = sel.value;
  sel.innerHTML = '';
  const groups = { song: '🎵 Canciones', ex: '🏋️ Ejercicios', user: '📂 Mis archivos' };
  for (const [cat, label] of Object.entries(groups)){
    const items = LIBRARY.map((s, i) => [s, i]).filter(([s]) => (s.cat || 'song') === cat);
    if (!items.length) continue;
    const og = document.createElement('optgroup'); og.label = label;
    for (const [s, i] of items){
      const o = document.createElement('option'); o.value = i; o.textContent = s.title;
      og.appendChild(o);
    }
    sel.appendChild(og);
  }
  if (cur !== '' && LIBRARY[cur]) sel.value = cur;
}

const EXPORT_HELP = {
  mscz: '📄 Los .mscz son el formato interno de MuseScore. Ábrelo en MuseScore y usa «Exportar → MusicXML (.mxl)» o «MIDI», y súbelo aquí.',
  pdf:  '📄 Leer PDF necesita reconocimiento óptico de partituras (OMR, p. ej. Audiveris). Llegará en una fase futura; de momento usa MusicXML o MIDI.',
  mp3:  '🎧 Transcribir audio a notas llegará en una fase futura. De momento usa MusicXML o MIDI.'
};

async function handleFile(f){
  const ext = f.name.split('.').pop().toLowerCase();
  if (EXPORT_HELP[ext]){ toast(EXPORT_HELP[ext], 8000); return; }
  let parsed;
  if (ext === 'mid' || ext === 'midi') parsed = parseMidiFile(await f.arrayBuffer());
  else if (ext === 'mxl') parsed = await parseMXL(await f.arrayBuffer());
  else if (ext === 'xml' || ext === 'musicxml') parsed = parseMusicXML(await f.text());
  else throw new Error('Formato no reconocido. Usa .mid, .musicxml o .mxl.');

  const song = { title: f.name.replace(/\.(mid|midi|musicxml|xml|mxl)$/i, ''), cat: 'user', ...parsed };
  LIBRARY.push(song);
  rebuildSongSelect();
  $('#songSel').value = LIBRARY.length - 1;
  S.loopA = S.loopB = null; updLoopUI();
  setSong(song);
  toast('«' + song.title + '» cargada · ' + song.notes.length + ' notas');
  const a = Progress.unlock('librarian');
  if (a) setTimeout(() => toast(`🏅 Logro desbloqueado: ${a.icon} ${a.name}`), 2600);
}

/* ---------------- Modal de progreso ---------------- */
function openProgress(){
  const P = Progress.data;
  $('#pmTotal').textContent = P.total;
  $('#pmStreak').textContent = P.streak;
  const played = Object.entries(P.songs);
  $('#pmSongs').textContent = played.length;
  $('#pmSongList').innerHTML = played.length
    ? played.map(([name, s]) =>
        `<div class="row"><span>${name}</span><span class="st">${'⭐'.repeat(s.stars) || '—'} · ${s.best} pts</span></div>`
      ).join('')
    : '<div class="row"><span>Todavía no has completado ninguna canción. ¡A por ello! 🎹</span></div>';
  $('#pmAch').innerHTML = ACHIEVEMENTS.map(a => {
    const has = !!P.ach[a.id];
    return `<div class="ach${has ? '' : ' locked'}"><span class="ico">${a.icon}</span><span>${a.name}<small>${a.desc}</small></span></div>`;
  }).join('');
  $('#progressModal').style.display = 'flex';
}

/* ---------------- Conexión de la interfaz ---------------- */
$('#playBtn').onclick = () => togglePlay();
$('#restartBtn').onclick = () => { resetRun(S.loopA || 0); };
$('#back5').onclick = () => seek(S.t - 5);
$('#fwd5').onclick = () => seek(S.t + 5);
$('#bar').addEventListener('pointerdown', e => {
  const r = e.currentTarget.getBoundingClientRect();
  if (S.song) seek(S.song.duration * clamp((e.clientX - r.left) / r.width, 0, 1));
});
$('#loopABtn').onclick = () => { S.loopA = S.t; if (S.loopB != null && S.loopB <= S.loopA) S.loopB = null; updLoopUI(); toast('Inicio del bucle: ' + fmt(S.t)); };
$('#loopBBtn').onclick = () => {
  if (S.loopA == null || S.t <= S.loopA){ toast('Pulsa primero A en el inicio del fragmento'); return; }
  S.loopB = S.t; updLoopUI(); toast('Bucle ' + fmt(S.loopA) + ' – ' + fmt(S.loopB) + ' activado 🔁');
};
$('#loopXBtn').onclick = () => { S.loopA = S.loopB = null; updLoopUI(); };
$$('#modeTabs button').forEach(b => b.onclick = () => setMode(b.dataset.m));
$$('#handTabs button').forEach(b => b.onclick = () => setHands(b.dataset.h));
$$('#viewTabs button').forEach(b => b.onclick = () => setView(b.dataset.v));
$('#tempo').oninput = e => { S.rate = e.target.value / 100; $('#tempoV').textContent = e.target.value + '%'; };
$('#nameBtn').onclick = () => {
  S.names = S.names === 'es' ? 'en' : S.names === 'en' ? 'off' : 'es';
  $('#nameBtn').textContent = S.names === 'es' ? '♪ Do-Re-Mi' : S.names === 'en' ? '♪ C-D-E' : '♪ sin nombres';
};
$('#metBtn').onclick = () => {
  S.metro = !S.metro;
  Progress.data.metro = S.metro; Progress.save();
  $('#metBtn').classList.toggle('primary', S.metro);
  toast(S.metro ? 'Metrónomo activado ⏱ (acento en el primer pulso del compás)' : 'Metrónomo desactivado');
  audio();
};
$('#metBtn').classList.toggle('primary', S.metro);

function updSndBtn(){
  $('#sndBtn').textContent = S.midiSound ? '🔊 Teclas: app + piano' : '🔇 Teclas: solo tu piano';
}
$('#sndBtn').onclick = () => {
  S.midiSound = !S.midiSound;
  Progress.data.midiSound = S.midiSound; Progress.save();
  updSndBtn();
  toast(S.midiSound
    ? 'Tus teclas MIDI también sonarán por la app 🔊 (baja el volumen del piano si se duplica)'
    : 'Tus teclas suenan solo por tu piano; la app pone el acompañamiento 🎹');
};
updSndBtn();
$('#profSel').value = S.prof;
$('#profSel').onchange = e => {
  S.prof = e.target.value;
  Progress.data.prof = S.prof; Progress.save();
  toast(S.prof === 'peque' ? 'Modo Peque: más tiempo para acertar 🧒'
      : S.prof === 'junior' ? 'Modo Júnior: ¡el reto justo! 🎒'
      : 'Modo Avanzado: precisión de concertista 🚀');
};
$('#trophyBtn').onclick = openProgress;
$('#fsBtn').onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => toast('Pantalla completa no disponible aquí'));
};
document.addEventListener('fullscreenchange', () => {
  $('#fsBtn').textContent = document.fullscreenElement ? '🗗' : '⛶';
  resize();
});
$('#pmClose').onclick = () => $('#progressModal').style.display = 'none';
$('#progressModal').addEventListener('pointerdown', e => { if (e.target === e.currentTarget) e.currentTarget.style.display = 'none'; });
$('#ovAgain').onclick = () => { resetRun(S.loopA || 0); togglePlay(true); };
$('#ovClose').onclick = () => $('#overlay').style.display = 'none';
$('#loadBtn').onclick = () => $('#fileIn').click();
$('#fileIn').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try{ await handleFile(f); }
  catch(err){ toast('⚠️ ' + err.message, 6000); }
  e.target.value = '';
};
$('#songSel').onchange = e => {
  S.loopA = S.loopB = null; updLoopUI();
  setSong(LIBRARY[e.target.value]);
};

/* ---------------- Arranque ---------------- */
$$('#viewTabs button').forEach(b => b.classList.toggle('sel', b.dataset.v === S.view));
rebuildSongSelect();
setSong(LIBRARY[0]);
initMidi({
  press: userPress, release: userRelease, pedal: setPedal,
  connected(){
    if (!S.midiSound)
      toast('Piano conectado 🎹 Tus teclas suenan por tu piano; cambia a 🔊 si prefieres el sonido de la app', 5000);
  }
});

let last = performance.now();
function frame(now){
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now; pulseT += dt;
  step(dt);
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
toast('Conecta tu teclado MIDI o toca el piano de la pantalla 🎹');

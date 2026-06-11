'use strict';
/* Renderizado en canvas: vista Cascada (notas que caen, estilo Synthesia),
   vista Partitura (gran pentagrama que avanza, estilo Flowkey) y el teclado. */

const cv = $('#cv'), ctx = cv.getContext('2d');
let CW = 0, CH = 0, KBTOP = 0, KEYS = [], BLACKH = 0;

function resize(){
  const r = cv.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  CW = r.width; CH = r.height;
  cv.width = Math.round(CW * dpr); cv.height = Math.round(CH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const kbH = clamp(CH * 0.30, 88, 190);
  KBTOP = CH - kbH; BLACKH = kbH * 0.62;
  KEYS = [];
  let whites = 0;
  for (let m = S.lo; m <= S.hi; m++) if (!isBlack(m)) whites++;
  const w = CW / whites; let wi = 0;
  const off = { 1: -0.13, 3: 0.13, 6: -0.16, 8: 0, 10: 0.16 };
  for (let m = S.lo; m <= S.hi; m++){
    if (!isBlack(m)){ KEYS.push({ m, x: wi * w, w, black: false }); wi++; }
    else {
      const bw = w * 0.62;
      KEYS.push({ m, x: wi * w + (off[m % 12] || 0) * w - bw / 2, w: bw, black: true });
    }
  }
}
window.addEventListener('resize', resize);

function noteName(m){
  if (S.names === 'off') return '';
  const arr = S.names === 'es' ? NOTE_ES : NOTE_EN;
  return arr[((m % 12) + 12) % 12];
}
function keyOf(m){ return KEYS.find(k => k.m === m); }

function draw(){
  ctx.clearRect(0, 0, CW, CH);

  // notas sonando ahora (para iluminar teclas en ambas vistas)
  const sounding = new Map();
  if (S.song){
    for (const n of S.song.notes)
      if (n.start <= S.t && n.start + n.dur >= S.t) sounding.set(n.m, n.hand);
  }

  if (S.view === 'staff') drawStaff(sounding);
  else drawFalling(sounding);

  // teclado
  const kbH = CH - KBTOP;
  for (const k of KEYS){ if (!k.black) drawKey(k, kbH, sounding); }
  for (const k of KEYS){ if (k.black)  drawKey(k, kbH, sounding); }

  // FX flotantes (¡Bien!, ¡Perfecto!, ✗)
  for (const f of S.fx){
    f.age += 0.016;
    ctx.globalAlpha = clamp(1 - f.age / 0.9, 0, 1);
    ctx.fillStyle = f.color.startsWith('var')
      ? getComputedStyle(document.documentElement).getPropertyValue(f.color.slice(4, -1))
      : f.color;
    ctx.font = '800 16px "Baloo 2", Nunito, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(f.txt, f.x, f.y - f.age * 46);
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
  }
  S.fx = S.fx.filter(f => f.age < 0.9);

  // HUD de tiempo
  $('#tNow').textContent = fmt(S.t);
  if (S.song) $('#barFill').style.width = (100 * clamp(S.t / S.song.duration, 0, 1)) + '%';
}

/* ---------------- Vista Cascada ---------------- */
function drawFalling(sounding){
  const bg = ctx.createLinearGradient(0, 0, 0, KBTOP);
  bg.addColorStop(0, '#161325'); bg.addColorStop(1, '#1C1830');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, CW, KBTOP);
  const spot = ctx.createRadialGradient(CW/2, KBTOP, 40, CW/2, KBTOP, KBTOP);
  spot.addColorStop(0, 'rgba(255,194,75,0.10)'); spot.addColorStop(1, 'rgba(255,194,75,0)');
  ctx.fillStyle = spot; ctx.fillRect(0, 0, CW, KBTOP);

  // líneas de octava
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  for (const k of KEYS) if (!k.black && k.m % 12 === 0){
    ctx.beginPath(); ctx.moveTo(k.x, 0); ctx.lineTo(k.x, KBTOP); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.font = '700 11px Nunito, sans-serif';
    ctx.fillText('Do' + (Math.floor(k.m / 12) - 1), k.x + 4, KBTOP - 8);
  }

  const pps = (KBTOP - 10) / 3.2; // 3,2 s de antelación
  if (S.song){
    for (const n of S.song.notes){
      const yB = KBTOP - (n.start - S.t) * pps;
      const yT = KBTOP - (n.start + n.dur - S.t) * pps;
      if (yT > KBTOP + 40 || yB < -20) continue;
      const k = keyOf(n.m); if (!k) continue;
      const act = activeHand(n.hand);
      const col = n.hand === 'L' ? (act ? '#5FA8F7' : 'rgba(95,168,247,0.35)') : (act ? '#5CD67F' : 'rgba(92,214,127,0.35)');
      const deep = n.hand === 'L' ? '#2F77C9' : '#2FA85A';
      const h = Math.max(10, yB - yT);
      const x = k.x + 1.5, w = Math.max(6, k.w - 3);
      ctx.save();
      if (n.hit){ ctx.globalAlpha = 0.35; }
      ctx.shadowColor = col; ctx.shadowBlur = n.start <= S.t + 0.15 && !n.hit ? 14 : 6;
      roundRect(x, Math.min(yT, KBTOP - 4), w, Math.min(h, KBTOP), 6);
      const g = ctx.createLinearGradient(0, yT, 0, yB);
      g.addColorStop(0, col); g.addColorStop(1, deep);
      ctx.fillStyle = g; ctx.fill();
      ctx.shadowBlur = 0;
      if (n.missed){ ctx.strokeStyle = 'rgba(255,107,129,.9)'; ctx.lineWidth = 2; ctx.stroke(); }
      const nm = noteName(n.m);
      if (nm && h > 20 && w > 18){
        ctx.fillStyle = 'rgba(8,20,10,0.85)';
        ctx.font = '800 ' + Math.min(13, w * 0.42) + 'px "Baloo 2", Nunito, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(nm, x + w / 2, Math.min(yB, KBTOP) - 6);
        ctx.textAlign = 'left';
      }
      ctx.restore();
    }
  }

  // línea de impacto
  ctx.fillStyle = 'rgba(255,194,75,0.9)';
  ctx.shadowColor = 'rgba(255,194,75,0.8)'; ctx.shadowBlur = 10;
  ctx.fillRect(0, KBTOP - 2, CW, 3);
  ctx.shadowBlur = 0;
}

/* ---------------- Vista Partitura ---------------- */
function drawStaff(sounding){
  const H = KBTOP;
  // papel
  ctx.fillStyle = '#FBFAF4'; ctx.fillRect(0, 0, CW, H);

  const g = clamp(H / 24, 6, 13);             // separación entre líneas
  const trebleBottom = H * 0.38;              // línea Mi4 (clave de sol)
  const bassBottom   = H * 0.80;              // línea Sol2 (clave de fa)
  const trebleTop = trebleBottom - 4 * g;
  const pps = clamp(CW / 6.5, 90, 170);       // píxeles por segundo
  const playX = CW * 0.22;

  // banda del cabezal de lectura
  ctx.fillStyle = 'rgba(95,168,247,0.16)';
  ctx.fillRect(playX - g * 1.4, trebleTop - 3 * g, g * 2.8, bassBottom + 3 * g - (trebleTop - 3 * g));
  ctx.fillStyle = 'rgba(95,168,247,0.55)';
  ctx.fillRect(playX - 1, trebleTop - 3 * g, 2, bassBottom + 3 * g - (trebleTop - 3 * g));

  // líneas de compás
  if (S.song && S.song.bars){
    ctx.strokeStyle = 'rgba(40,40,60,0.35)'; ctx.lineWidth = 1;
    for (const bt of S.song.bars){
      const x = playX + (bt - S.t) * pps;
      if (x < -10 || x > CW + 10) continue;
      ctx.beginPath(); ctx.moveTo(x, trebleTop); ctx.lineTo(x, bassBottom); ctx.stroke();
    }
  }

  // los dos pentagramas
  ctx.strokeStyle = '#43415A'; ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++){
    const y1 = trebleBottom - i * g, y2 = bassBottom - i * g;
    ctx.beginPath(); ctx.moveTo(0, y1); ctx.lineTo(CW, y1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, y2); ctx.lineTo(CW, y2); ctx.stroke();
  }

  // claves
  ctx.fillStyle = '#2A2840';
  ctx.font = (g * 5.6) + 'px serif';
  ctx.fillText('\u{1D11E}', 6, trebleBottom + g * 1.1);   // 𝄞
  ctx.font = (g * 3.6) + 'px serif';
  ctx.fillText('\u{1D122}', 8, bassBottom - g * 0.6);     // 𝄢

  if (!S.song) return;

  for (const n of S.song.notes){
    const x = playX + (n.start - S.t) * pps;
    if (x < -60 || x > CW + 60) continue;

    const useBass = n.hand === 'L';
    const { d, sharp } = diatonicOf(n.m);
    const baseD = useBass ? DIA_G2 : DIA_E4;
    const baseY = useBass ? bassBottom : trebleBottom;
    const rel = d - baseD;                    // posición diatónica relativa a la línea inferior
    const y = baseY - rel * g / 2;

    const act = activeHand(n.hand);
    const now = n.start <= S.t && n.start + n.dur >= S.t;
    const past = n.start + n.dur < S.t;
    let color = useBass ? '#2F77C9' : '#2FA85A';
    if (now) color = '#E8950F';
    ctx.save();
    if (!act) ctx.globalAlpha = 0.22;
    else if (past || n.hit) ctx.globalAlpha = 0.35;
    if (n.missed) color = '#E14B63';

    // líneas adicionales
    ctx.strokeStyle = '#43415A'; ctx.lineWidth = 1;
    for (let k = 10; k <= rel; k += 2){
      const ly = baseY - k * g / 2;
      ctx.beginPath(); ctx.moveTo(x - g, ly); ctx.lineTo(x + g, ly); ctx.stroke();
    }
    for (let k = -2; k >= rel; k -= 2){
      const ly = baseY - k * g / 2;
      ctx.beginPath(); ctx.moveTo(x - g, ly); ctx.lineTo(x + g, ly); ctx.stroke();
    }

    // cabeza de nota
    const beats = n.beats || 1;
    const filled = beats < 1.9;
    const rx = g * 0.62, ry = g * 0.48;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, -0.3, 0, Math.PI * 2);
    if (filled){ ctx.fillStyle = color; ctx.fill(); }
    else { ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke(); }

    // puntillo
    if (Math.abs(beats - 1.5) < 0.01 || Math.abs(beats - 3) < 0.01){
      ctx.beginPath(); ctx.arc(x + rx + 4, y - 2, 2, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
    }

    // plica y corchete
    if (beats < 3.5){
      const middle = 4;                       // línea central del pentagrama
      const up = rel < middle;
      const sx = up ? x + rx - 0.5 : x - rx + 0.5;
      const ey = up ? y - g * 3.2 : y + g * 3.2;
      ctx.strokeStyle = color; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(sx, y); ctx.lineTo(sx, ey); ctx.stroke();
      if (beats <= 0.6){
        ctx.beginPath(); ctx.moveTo(sx, ey);
        ctx.quadraticCurveTo(sx + g, ey + (up ? g : -g) * 0.6, sx + g * 0.6, ey + (up ? g : -g) * 1.6);
        ctx.stroke();
      }
    }

    // alteración
    if (sharp){
      ctx.fillStyle = color;
      ctx.font = '700 ' + (g * 1.8) + 'px serif';
      ctx.fillText('♯', x - g * 2.1, y + g * 0.62);
    }

    // nota esperada en modo Espera: anillo que late en el cabezal
    if (S.waiting && S.required.has(n.m) && !S.required.get(n.m) && Math.abs(n.start - S.t) < 0.08){
      ctx.globalAlpha = 1;
      ctx.strokeStyle = pulseColor(); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, g * 1.3, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  // etiquetas de mano
  ctx.fillStyle = 'rgba(40,40,60,0.45)';
  ctx.font = '800 11px Nunito, sans-serif';
  ctx.fillText('MANO DERECHA', CW - 120, trebleTop - 8);
  ctx.fillText('MANO IZQUIERDA', CW - 124, bassBottom - 4 * g - 8);
}

/* ---------------- Teclado ---------------- */
function drawKey(k, kbH, sounding){
  const pressed = S.pressed.has(k.m);
  const sHand = sounding.get(k.m);
  const reqd = S.waiting && S.required.has(k.m) && !S.required.get(k.m);
  const h = k.black ? BLACKH : kbH;
  let fill;
  if (pressed) fill = '#FFC24B';
  else if (reqd) fill = pulseColor();
  else if (sHand) fill = sHand === 'L' ? '#5FA8F7' : '#5CD67F';
  else fill = k.black ? '#1A1626' : '#F7F4EC';
  ctx.fillStyle = fill;
  roundRectB(k.x + (k.black ? 0 : 0.5), KBTOP, k.w - (k.black ? 0 : 1), h, k.black ? 4 : 5);
  ctx.fill();
  if (!k.black){ ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.stroke(); }
  if (reqd){
    ctx.strokeStyle = 'rgba(255,194,75,0.95)'; ctx.lineWidth = 3;
    roundRectB(k.x + 1.5, KBTOP + 1.5, k.w - 3, h - 3, 4); ctx.stroke();
  }
  if (!k.black && k.m % 12 === 0){
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.font = '700 10px Nunito, sans-serif';
    ctx.fillText('Do' + (Math.floor(k.m / 12) - 1), k.x + 3, KBTOP + kbH - 6);
  }
}

let pulseT = 0;
function pulseColor(){
  const a = 0.55 + 0.4 * Math.sin(pulseT * 6);
  return 'rgba(255,194,75,' + a.toFixed(2) + ')';
}

function roundRect(x, y, w, h, r){
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function roundRectB(x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.lineTo(x, y);
  ctx.closePath();
}

/* ---------------- Entrada táctil / ratón en el teclado ---------------- */
const ptr = new Map();
cv.addEventListener('pointerdown', e => {
  const rect = cv.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  if (y < KBTOP) return;
  const m = hitKey(x, y);
  if (m != null){ ptr.set(e.pointerId, m); userPress(m); cv.setPointerCapture(e.pointerId); }
});
const liftPtr = e => { const m = ptr.get(e.pointerId); if (m != null){ userRelease(m); ptr.delete(e.pointerId); } };
cv.addEventListener('pointerup', liftPtr);
cv.addEventListener('pointercancel', liftPtr);
function hitKey(x, y){
  if (y < KBTOP + BLACKH){
    for (const k of KEYS) if (k.black && x >= k.x && x <= k.x + k.w) return k.m;
  }
  for (const k of KEYS) if (!k.black && x >= k.x && x <= k.x + k.w) return k.m;
  return null;
}

# 🎹 Atril — Aprende piano jugando

App web para aprender piano con un teclado MIDI real: conecta el piano por USB,
carga tus propias partituras y toca siguiendo la **cascada de notas** (estilo
Synthesia) o el **pentagrama que avanza** (estilo Flowkey), con puntuaciones,
combos, estrellas y logros.

Pensada tanto para alumnos con base (lectura a dos manos, pedal, teoría) como
para quien empieza de cero (modo Espera, una sola mano, ejercicios guiados).

## Cómo ejecutarla

No hay paso de build: es HTML + JavaScript plano.

```bash
# opción 1: servidor local (recomendado)
python3 -m http.server 8000   # o: npx serve
# y abre http://localhost:8000 en Chrome o Edge

# opción 2: abrir index.html directamente en Chrome/Edge
```

> **Web MIDI API** funciona en Chrome, Edge y Chrome para Android.
> Safari/iOS no la soporta (si el objetivo es iPad, haría falta empaquetar
> la app de forma nativa). Sin teclado MIDI se puede tocar el piano táctil
> de la pantalla.

### Sonido al tocar con un piano conectado

Un piano conectado por MIDI ya suena por sus propios altavoces; si la app
volviera a sintetizar cada tecla, ambos sonidos se superpondrían con unos
milisegundos de retardo y se percibiría eco o distorsión. Por eso, por
defecto, **tus teclas suenan solo por tu piano** y la app reserva su
sintetizador para el acompañamiento y el modo Escuchar. El botón
«🔇 Teclas: solo tu piano / 🔊 Teclas: app + piano» permite cambiarlo
(útil si silencias el piano o usas un teclado controlador sin altavoces;
en ese caso también puedes desactivar *Local Control* en tu piano).

## Qué incluye

- **Entrada MIDI en vivo**: teclas con velocidad y pedal de resonancia (CC64).
- **Tres vistas sincronizadas** (la elección se recuerda):
  - 🌊 **Cascada**: barras de colores que caen hacia el teclado (verde = mano
    derecha, azul = izquierda), con nombres de nota Do-Re-Mi / C-D-E.
  - 🎼 **Partitura**: gran pentagrama (sol + fa) que avanza con cabezal de
    lectura, líneas de compás, alteraciones, plicas y puntillos.
  - 🎼+🌊 **Mixta**: partitura arriba y cascada abajo a la vez, como
    Synthesia — ideal para asociar la lectura con las teclas.
- **Pensada para tablet en horizontal**: barras compactas en pantallas
  apaisadas y botón ⛶ de pantalla completa.
- **Tres modos de juego**:
  - ▶ **Escuchar**: reproducción completa para conocer la pieza.
  - 🎯 **Tocar**: tocas a la vez que avanza; puntúa precisión, combos y "perfectas".
  - 🐢 **Espera**: la partitura se detiene hasta que pulsas la tecla o el
    acorde correcto (ideal para aprender).
- **Filtro de manos** (ambas / derecha / izquierda): la mano desactivada suena
  sola como acompañamiento.
- **Transporte completo**: avanzar/retroceder, barra de progreso, tempo
  50–120 %, bucle A‑B para repetir fragmentos.
- **Metrónomo** con acento en el primer pulso del compás (sigue la cifra de
  compás del archivo, también en 3/4 o 3/8) y **cuenta de entrada** de 4
  pulsos al empezar en modo Tocar.
- **Gamificación**: puntos, combos con multiplicador, precisión, 3 estrellas,
  logros desbloqueables, racha de días y progreso guardado en el navegador.
- **Análisis al terminar**: detecta el tramo con más fallos y ofrece
  practicarlo en bucle en modo Espera; si una mano falla bastante más que
  la otra, sugiere practicarla por separado.
- **Repertorio incluido**: Himno de la Alegría, Para Elisa, Cumpleaños
  feliz, Martinillo, Noche de paz, Minueto en Sol (Petzold), Canon de
  Pachelbel… y ejercicios de escalas (Do y Sol), acordes, arpegios y
  Hanon nº 1.
- **Perfiles por edad** (🧒 Peque / 🎒 Júnior / 🚀 Avanzado): ajustan la
  tolerancia de acierto y los umbrales de estrellas.
- **Biblioteca propia**: sube tus partituras (ver formatos).

## Formatos soportados

| Formato | Estado | Notas |
|---|---|---|
| `.mid` / `.midi` | ✅ | Formato núcleo: notas, timing, velocidad, tempo, compás, **pedal (CC64)** y separación de manos por pistas. Parser propio. |
| `.musicxml` / `.xml` | ✅ | Estándar de intercambio de partituras (MuseScore, Finale, Sibelius). Acordes, ligaduras, tempo, pedal y manos por pentagrama (staff 1/2). |
| `.mxl` | ✅ | MusicXML comprimido (ZIP). Se descomprime en el navegador. |
| `.mscz` | ℹ️ | Formato interno de MuseScore, no documentado. La app explica cómo exportarlo a MusicXML/MIDI. |
| `.pdf` | 🔜 Fase 2 | Requiere OMR (reconocimiento óptico de partituras), p. ej. **Audiveris** en un backend. |
| `.mp3` | 🔜 Fase 3 | Requiere transcripción automática de audio (Basic Pitch, Onsets & Frames). |

## Estructura del código

```
index.html          Maquetación de la interfaz
css/style.css       Estilos
js/util.js          Helpers: nombres de notas, posiciones diatónicas
js/audio.js         Sintetizador WebAudio + pedal
js/midi-input.js    Entrada MIDI en vivo (Web MIDI API)
js/midi-file.js     Parser de archivos .mid (tempo, compás, pedal, manos)
js/musicxml.js      Parser MusicXML + descompresor .mxl
js/songs.js         Repertorio y ejercicios de demostración
js/progress.js      Progreso persistente y logros (localStorage)
js/render.js        Canvas: cascada, partitura, teclado y efectos
js/app.js           Estado, modos de juego, puntuación e interfaz
```

## Hoja de ruta

1. **Fase 1 (esta)**: app 100 % cliente, sin servidor.
2. **Fase 2**: backend (Java/Spring) con usuarios, biblioteca en la nube,
   ranking familiar y OMR de PDF con Audiveris.
3. **Fase 3**: transcripción de MP3, digitaciones sugeridas, lecciones de
   teoría interactivas y editor de ejercicios para profesores.

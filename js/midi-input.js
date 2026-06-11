'use strict';
/* Entrada MIDI en vivo (Web MIDI API): teclas y pedal del teclado físico.
   handlers = { press(midi, vel, fromMidi), release(midi), pedal(down), connected() } */

async function initMidi(handlers){
  const lamp = $('#midiLamp'), txt = $('#midiTxt');
  if (!navigator.requestMIDIAccess){
    txt.textContent = 'MIDI no disponible aquí';
    return;
  }
  try{
    const acc = await navigator.requestMIDIAccess({ sysex: false });
    const onMsg = e => {
      const [st, d1, d2] = e.data;
      const hi = st & 0xF0;
      if (hi === 0x90 && d2 > 0) handlers.press(d1, d2 / 127, true);
      else if (hi === 0x80 || (hi === 0x90 && d2 === 0)) handlers.release(d1);
      else if (hi === 0xB0 && d1 === 64) handlers.pedal(d2 >= 64);
    };
    let wasConnected = false;
    const wire = () => {
      let n = 0;
      acc.inputs.forEach(inp => { n++; inp.onmidimessage = onMsg; });
      lamp.classList.toggle('on', n > 0);
      txt.textContent = n > 0 ? 'MIDI conectado' : 'Conecta tu piano';
      if (n > 0 && !wasConnected && handlers.connected) handlers.connected();
      wasConnected = n > 0;
    };
    acc.onstatechange = wire; wire();
  }catch(e){
    txt.textContent = 'MIDI bloqueado';
  }
}

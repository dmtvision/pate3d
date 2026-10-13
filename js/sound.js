/* Petits sons synthétisés (aucun fichier audio à charger) */
(function (global) {
  'use strict';
  let ctx = null;
  let on = true;
  try { on = localStorage.getItem('pate3d.sound') !== '0'; } catch (e) { /* ignore */ }

  function ensure() {
    if (!ctx) {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, dur, type, vol, to, delay) {
    if (!on) return;
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + (delay || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(vol || 0.08, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.03);
  }

  global.Sfx = {
    add() { tone(280, 0.14, 'sine', 0.1, 520); },
    remove() { tone(460, 0.15, 'triangle', 0.08, 180); },
    pull() { tone(200, 0.25, 'sawtooth', 0.035, 420); },
    smooth() { tone(520, 0.1, 'sine', 0.05, 430); },
    stamp() { tone(180, 0.12, 'square', 0.05, 90); tone(520, 0.08, 'sine', 0.05, 760, 0.03); },
    place() { tone(520, 0.12, 'sine', 0.1); tone(780, 0.2, 'sine', 0.1, null, 0.09); },
    tada() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.09, null, i * 0.1)); },
    undo() { tone(400, 0.12, 'sine', 0.06, 260); },
    toggle() {
      on = !on;
      try { localStorage.setItem('pate3d.sound', on ? '1' : '0'); } catch (e) { /* ignore */ }
      if (on) tone(600, 0.12, 'sine', 0.08);
      return on;
    },
    isOn() { return on; }
  };
})(window);

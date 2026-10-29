// Tastiera -> maschera di bit. La stessa maschera viaggia in rete dal secondo giocatore all'host.
'use strict';

const K = {
  UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, SPRINT: 16,
  PASS: 32, SHOOT: 64, THROUGH: 128, LOB: 256, SWITCH: 512,
  SHIELD: 1024, KNOCK: 2048, FINESSE: 4096, CHIP: 8192, SKILL: 16384, MENTALITY: 32768,
};

const KEYMAP = {
  KeyW: K.UP, ArrowUp: K.UP,
  KeyS: K.DOWN, ArrowDown: K.DOWN,
  KeyA: K.LEFT, ArrowLeft: K.LEFT,
  KeyD: K.RIGHT, ArrowRight: K.RIGHT,
  ShiftLeft: K.SPRINT, ShiftRight: K.SPRINT,
  KeyJ: K.PASS, KeyK: K.SHOOT, KeyL: K.THROUGH, KeyI: K.LOB,
  KeyQ: K.SWITCH, KeyE: K.SHIELD, Space: K.KNOCK,
  KeyO: K.FINESSE, KeyU: K.CHIP, KeyF: K.SKILL, KeyR: K.MENTALITY,
};

const Keyboard = {
  mask: 0,
  gameActive: false,  // durante la partita i tasti non devono scorrere la pagina o usare i pulsanti
  onLocalKey: null,   // callback per tasti non di gioco (pausa, radar, audio...)
  init() {
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      const bit = KEYMAP[e.code];
      if (bit) { this.mask |= bit; if (this.gameActive) e.preventDefault(); }
      if (e.code === 'Tab' && this.gameActive) e.preventDefault();
      if (!e.repeat && this.onLocalKey) this.onLocalKey(e.code);
    });
    window.addEventListener('keyup', (e) => {
      const bit = KEYMAP[e.code];
      if (bit) { this.mask &= ~bit; if (this.gameActive) e.preventDefault(); }
    });
    window.addEventListener('blur', () => { this.mask = 0; });
  },
};

// Stato dei tasti di un giocatore umano visto dalla simulazione (fronti di salita/discesa, durata pressione).
class Controller {
  constructor() {
    this.cur = 0;
    this.prev = 0;
    this.hold = {};
    this.lastHold = {};
    this.lastDir = null;
    this.lastDirT = 99;
  }
  feed(mask, dt) {
    this.prev = this.cur;
    this.cur = mask;
    const d = this.dir();
    if (d.any) { this.lastDir = d; this.lastDirT = 0; } else this.lastDirT += dt;
    for (const name in K) {
      const b = K[name];
      if (this.cur & b) this.hold[b] = (this.hold[b] || 0) + dt;
      else if (this.prev & b) { this.lastHold[b] = this.hold[b] || 0; this.hold[b] = 0; }
    }
  }
  held(b) { return (this.cur & b) !== 0; }
  pressed(b) { return (this.cur & b) !== 0 && (this.prev & b) === 0; }
  released(b) { return (this.cur & b) === 0 && (this.prev & b) !== 0; }
  holdTime(b) { return this.hold[b] || 0; }
  releasedHold(b) { return this.lastHold[b] || 0; }
  // Direzione per mirare: se i tasti sono stati appena lasciati usa l'ultima premuta.
  aim() {
    const d = this.dir();
    if (d.any) return d;
    if (this.lastDir && this.lastDirT < 0.25) return this.lastDir;
    return d;
  }
  dir() {
    let x = 0, y = 0;
    if (this.cur & K.LEFT) x -= 1;
    if (this.cur & K.RIGHT) x += 1;
    if (this.cur & K.UP) y -= 1;
    if (this.cur & K.DOWN) y += 1;
    const l = Math.sqrt(x * x + y * y);
    return l > 0 ? { x: x / l, y: y / l, any: true } : { x: 0, y: 0, any: false };
  }
}

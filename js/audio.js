// Effetti sonori sintetizzati con WebAudio (nessun file da scaricare).
'use strict';

const Sound = {
  ctx: null,
  master: null,
  crowdGain: null,
  muted: false,
  noise: null,

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { return; }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    this.master.connect(c.destination);
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = last * 0.6 + (Math.random() * 2 - 1) * 0.4; d[i] = last; }
    // Pubblico: rumore filtrato in loop
    const src = c.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.6;
    this.crowdGain = c.createGain(); this.crowdGain.gain.value = 0.05;
    src.connect(bp); bp.connect(this.crowdGain); this.crowdGain.connect(this.master);
    src.start();
  },

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.6;
    return this.muted;
  },

  setCrowd(level) {
    if (!this.ctx) return;
    this.crowdGain.gain.setTargetAtTime(0.03 + level * 0.22, this.ctx.currentTime, 0.4);
  },

  kick(strength) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.12);
    g.gain.setValueAtTime(0.5 * (strength || 1), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.16);
    const n = c.createBufferSource(); n.buffer = this.noise;
    const ng = c.createGain(); ng.gain.setValueAtTime(0.25, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500;
    n.connect(hp); hp.connect(ng); ng.connect(this.master);
    n.start(t, Math.random()); n.stop(t + 0.06);
  },

  whistle(long) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const dur = long ? 0.9 : 0.35;
    const o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain();
    o.frequency.value = 2900; o2.frequency.value = 2960;
    const lfo = c.createOscillator(), lg = c.createGain();
    lfo.frequency.value = 28; lg.gain.value = 120;
    lfo.connect(lg); lg.connect(o.frequency);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.02);
    g.gain.setValueAtTime(0.12, t + dur - 0.05); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); o2.connect(g); g.connect(this.master);
    [o, o2, lfo].forEach((x) => { x.start(t); x.stop(t + dur); });
  },

  post() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    for (const f of [620, 930, 1480]) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.6);
    }
  },

  cheer() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const n = c.createBufferSource(); n.buffer = this.noise; n.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.4;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.55, t + 0.4); g.gain.exponentialRampToValueAtTime(0.001, t + 3.5);
    n.connect(bp); bp.connect(g); g.connect(this.master);
    n.start(t); n.stop(t + 3.6);
  },
};

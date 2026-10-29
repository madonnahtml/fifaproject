// Avvio, menu, ciclo di gioco, modalita' contro IA / host online / ospite online.
'use strict';

const $ = (id) => document.getElementById(id);

const App = {
  mode: null,          // 'demo' | 'cpu' | 'host' | 'guest'
  match: null,
  info: null,
  localSide: 0,
  paused: false,
  acc: 0,
  last: 0,
  prevEv: null,
  remoteMask: 0,
  remoteSeq: -1,
  inputSeq: 0,
  guestBuf: [],
  guestOffset: null,
  guestLast: null,
  resultShown: false,
  fullTimeAt: 0,
  lastSettings: null,
  guestHello: null,
  showFps: false,
  fps: 0, fpsN: 0, fpsT: 0,
  crowdT: 0,

  start() {
    this.renderer = new Renderer($('game'));
    Keyboard.init();
    Keyboard.onLocalKey = (code) => this.localKey(code);
    this.bindUI();
    this.load();
    requestAnimationFrame((t) => this.frame(t));
  },

  // ---------- Caricamento ----------
  load() {
    const steps = [
      ['Motore fisico e regole', () => { new Ball().predict(1, 0.1); }],
      ['Intelligenza artificiale', () => { const m = new Match(this.demoSettings()); for (let i = 0; i < 30; i++) m.update(CFG.DT, [0, 0]); }],
      ['Grafica del campo e omini', () => this.renderer.resize()],
      ['Audio', () => {}],
      ['Modulo online', () => { if (!Net.available()) console.warn('PeerJS non disponibile'); }],
      ['Pronto!', () => {}],
    ];
    let i = 0;
    const next = () => {
      if (i >= steps.length) {
        setTimeout(() => { this.startDemo(); this.show('menu'); }, 150);
        return;
      }
      const [label, fn] = steps[i];
      $('load-text').textContent = label + '...';
      try { fn(); } catch (e) { console.error(e); }
      i++;
      $('load-fill').style.width = Math.round((i / steps.length) * 100) + '%';
      setTimeout(next, 120);
    };
    next();
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  },

  // ---------- Schermate ----------
  show(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('show', s.id === id));
    this.screen = id;
  },
  hideAll() { this.show(null); },

  toast(text, ms) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), ms || 4000);
  },

  bindUI() {
    document.addEventListener('pointerdown', () => Sound.init(), { once: false });
    document.addEventListener('keydown', () => Sound.init(), { once: true });
    document.querySelectorAll('[data-go]').forEach((b) => {
      b.addEventListener('click', () => {
        const go = b.dataset.go;
        if (b.dataset.leave) { Net.close(); this.guestHello = null; }
        if (go === 'host') this.openHost();
        else if (go === 'join') this.openJoin();
        else if (go === 'help') { this.helpReturn = 'menu'; this.show('help'); }
        else this.show(go);
      });
    });
    $('help-back').addEventListener('click', () => this.show(this.helpReturn || 'menu'));

    this.cards = {};
    for (const [id, kit] of [['setup-team0', 1], ['setup-team1', 0], ['host-team', 0], ['join-team', 1]]) {
      this.cards[id] = this.makeCard($(id), kit);
    }
    try {
      const saved = JSON.parse(localStorage.getItem('stickcalcio-team') || 'null');
      if (saved) for (const id of ['setup-team0', 'host-team', 'join-team']) this.cards[id].set(saved);
    } catch (e) { /* storage non disponibile */ }

    $('setup-start').addEventListener('click', () => {
      const a = this.cards['setup-team0'].get(), b = this.cards['setup-team1'].get();
      this.saveTeam(a);
      if (a.kit === b.kit) b.kit = (b.kit + 1) % KIT_COLORS.length;
      this.lastSettings = {
        kits: [a.kit, b.kit], names: [a.name, b.name], formations: [a.formation, b.formation],
        humans: [true, false], difficulty: Number($('setup-diff').value), halfMinutes: Number($('setup-len').value),
      };
      this.startCpu();
    });

    $('host-copy').addEventListener('click', () => {
      const code = $('host-code').textContent;
      if (navigator.clipboard) navigator.clipboard.writeText(code).then(() => this.toast('Codice copiato: ' + code, 2000)).catch(() => {});
    });
    $('host-start').addEventListener('click', () => this.hostStartMatch());
    this.cards['host-team'].onChange = () => this.sendLobby();
    $('join-go').addEventListener('click', () => this.doJoin());
    $('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.doJoin(); });

    $('pause-resume').addEventListener('click', () => this.resume());
    $('pause-help').addEventListener('click', () => { this.helpReturn = 'pause'; this.show('help'); });
    $('pause-quit').addEventListener('click', () => this.quitToMenu());
    $('result-menu').addEventListener('click', () => this.quitToMenu());
    $('result-again').addEventListener('click', () => {
      if (this.mode === 'cpu') this.startCpu();
      else if (this.mode === 'host') this.hostStartMatch();
    });

    $('opt-quality').addEventListener('change', (e) => this.renderer.setQuality(Number(e.target.value)));
    $('opt-fps').addEventListener('change', (e) => { this.showFps = e.target.checked; });
    $('opt-radar').addEventListener('change', (e) => { this.renderer.showRadar = e.target.checked; });

    Net.onError = (t) => {
      const st = this.screen === 'join' ? $('join-status') : $('host-status');
      if (st) { st.textContent = t; st.classList.add('err'); }
      if (this.mode === 'host' || this.mode === 'guest') { this.toast(t); this.quitToMenu(); }
    };
    Net.onStatus = (t) => {
      const st = Net.role === 'guest' ? $('join-status') : $('host-status');
      st.classList.remove('err');
      if (Net.role === 'host' && t === 'Stanza pronta') st.textContent = 'Stanza pronta! In attesa del tuo amico...';
      else st.textContent = t;
    };
    Net.onConnected = () => {
      if (Net.role === 'guest') {
        const me = this.cards['join-team'].get();
        this.saveTeam(me);
        Net.send({ t: 'hello', name: me.name, kit: me.kit, formation: me.formation });
      }
    };
    Net.onData = (msg) => this.onNet(msg);
    Net.onClosed = (why) => {
      if (this.mode === 'host' || this.mode === 'guest') { this.toast(why); this.quitToMenu(); }
      else if (this.screen === 'host') {
        this.guestHello = null;
        $('host-guest-info').textContent = 'Non ancora collegato';
        $('host-start').disabled = true;
        $('host-status').textContent = 'Il tuo amico si e\' scollegato. In attesa...';
      } else if (this.screen === 'join') { $('join-status').textContent = why; }
    };
  },

  saveTeam(t) {
    try { localStorage.setItem('stickcalcio-team', JSON.stringify(t)); } catch (e) { /* ignora */ }
  },

  makeCard(el, kit) {
    const sw = el.querySelector('.swatches');
    const card = { kit, onChange: null };
    const btns = KIT_COLORS.map((k, i) => {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.type = 'button';
      b.title = k.name;
      b.setAttribute('aria-label', 'Maglia ' + k.name);
      b.style.background = k.shirt;
      b.style.setProperty('--shorts', k.shorts);
      b.addEventListener('click', () => { card.kit = i; refresh(); if (card.onChange) card.onChange(); });
      sw.appendChild(b);
      return b;
    });
    const refresh = () => btns.forEach((b, i) => b.classList.toggle('sel', i === card.kit));
    refresh();
    el.querySelector('.tname').addEventListener('change', () => card.onChange && card.onChange());
    el.querySelector('.tform').addEventListener('change', () => card.onChange && card.onChange());
    card.get = () => ({
      name: (el.querySelector('.tname').value || 'Squadra').trim().slice(0, 14) || 'Squadra',
      kit: card.kit,
      formation: el.querySelector('.tform').value,
    });
    card.set = (t) => {
      if (t.kit != null && KIT_COLORS[t.kit]) card.kit = t.kit;
      if (t.name) el.querySelector('.tname').value = t.name;
      if (t.formation && FORMATIONS[t.formation]) el.querySelector('.tform').value = t.formation;
      refresh();
    };
    return card;
  },

  // ---------- Modalita' ----------
  demoSettings() {
    const a = U.randInt(0, KIT_COLORS.length - 1);
    let b = U.randInt(0, KIT_COLORS.length - 1);
    if (b === a) b = (a + 3) % KIT_COLORS.length;
    return { kits: [a, b], names: ['Stick United', 'Real Linea'], formations: ['4-4-2', '4-3-3'], humans: [false, false], difficulty: 2, halfMinutes: 10 };
  },

  startDemo() {
    this.mode = 'demo';
    this.match = new Match(this.demoSettings());
    this.info = this.match.info();
    this.localSide = null;
    this.paused = false;
    this.prevEv = null;
    this.renderer.snapCamera(this.match.snapshot());
  },

  startCpu() {
    Net.close();
    this.mode = 'cpu';
    this.match = new Match(this.lastSettings);
    this.info = this.match.info();
    this.localSide = 0;
    this.beginGame();
  },

  beginGame() {
    this.paused = false;
    this.resultShown = false;
    this.fullTimeAt = 0;
    this.prevEv = null;
    this.acc = 0;
    this.hideAll();
    if (this.match) this.renderer.snapCamera(this.match.snapshot());
    Sound.init();
  },

  quitToMenu() {
    if (this.mode === 'host' || this.mode === 'guest') { Net.send({ t: 'bye' }); Net.close(); }
    this.startDemo();
    this.show('menu');
  },

  pause() {
    if (this.mode === 'demo' || this.resultShown) return;
    if (this.mode === 'cpu') this.paused = true;
    $('pause-title').textContent = this.mode === 'cpu' ? 'Pausa' : 'Menu (la partita online continua)';
    this.show('pause');
  },
  resume() { this.paused = false; this.hideAll(); },

  localKey(code) {
    const inGame = this.mode !== 'demo' && !this.screen;
    if (code === 'Escape' && ['options', 'help', 'setup', 'join', 'host'].includes(this.screen)) {
      // Esc torna indietro nei menu
      if (this.screen === 'help') this.show(this.helpReturn || 'menu');
      else {
        if (this.screen === 'join' || this.screen === 'host') { Net.close(); this.guestHello = null; }
        this.show('menu');
      }
    } else if (code === 'Escape' || (code === 'KeyP' && !this.screen) || (code === 'KeyP' && this.screen === 'pause')) {
      if (this.screen === 'pause') this.resume();
      else if (inGame) this.pause();
    } else if (code === 'Tab' && inGame) {
      this.renderer.showRadar = !this.renderer.showRadar;
      $('opt-radar').checked = this.renderer.showRadar;
    } else if (code === 'KeyM') {
      const muted = Sound.toggleMute();
      this.toast(muted ? 'Audio disattivato' : 'Audio attivato', 1200);
    } else if (code === 'KeyH' && (inGame || this.screen === 'pause')) {
      if (this.mode === 'cpu') this.paused = true;
      this.helpReturn = this.mode === 'cpu' ? 'pause' : null;
      this.show('help');
    }
  },

  // ---------- Online: host ----------
  openHost() {
    if (!Net.available()) { this.toast('Modulo online non caricato. Ricarica la pagina con internet attivo.'); return; }
    this.guestHello = null;
    $('host-guest-info').textContent = 'Non ancora collegato';
    $('host-start').disabled = true;
    $('host-status').classList.remove('err');
    const code = Net.host();
    $('host-code').textContent = code;
    this.show('host');
    // Se il codice cambia (gia' in uso) aggiorna la schermata
    const iv = setInterval(() => {
      if (this.screen !== 'host') { clearInterval(iv); return; }
      if (Net.code && $('host-code').textContent !== Net.code) $('host-code').textContent = Net.code;
    }, 300);
  },

  sendLobby() {
    if (Net.role !== 'host' || !this.guestHello) return;
    const me = this.cards['host-team'].get();
    let gk = this.guestHello.kit;
    if (gk === me.kit) gk = (gk + 1) % KIT_COLORS.length;
    this.guestHello.kitFinal = gk;
    Net.send({ t: 'lobby', host: me, guestKit: gk, halfMinutes: Number($('host-len').value) });
    const k = KIT_COLORS[gk];
    $('host-guest-info').innerHTML = '';
    const p = document.createElement('p');
    p.textContent = this.guestHello.name + ' • maglia ' + k.name + ' • ' + this.guestHello.formation;
    $('host-guest-info').appendChild(p);
  },

  hostStartMatch() {
    if (!this.guestHello || !Net.connected()) { this.toast('Il tuo amico non e\' collegato.'); return; }
    const me = this.cards['host-team'].get();
    this.saveTeam(me);
    this.sendLobby();
    const g = this.guestHello;
    this.lastSettings = {
      kits: [me.kit, g.kitFinal], names: [me.name, g.name], formations: [me.formation, g.formation],
      humans: [true, true], difficulty: 2, halfMinutes: Number($('host-len').value),
    };
    this.mode = 'host';
    this.match = new Match(this.lastSettings);
    this.info = this.match.info();
    this.localSide = 0;
    this.remoteMask = 0;
    this.remoteSeq = -1;
    Net.send({ t: 'start', info: this.info, side: 1 });
    this.beginGame();
  },

  // ---------- Online: ospite ----------
  openJoin() {
    if (!Net.available()) { this.toast('Modulo online non caricato. Ricarica la pagina con internet attivo.'); return; }
    $('join-status').textContent = '';
    $('join-status').classList.remove('err');
    this.show('join');
    setTimeout(() => $('join-code').focus(), 50);
  },

  doJoin() {
    const code = $('join-code').value.trim().toUpperCase();
    if (code.length < 5) { $('join-status').textContent = 'Il codice ha 5 caratteri.'; $('join-status').classList.add('err'); return; }
    Net.join(code);
  },

  onNet(msg) {
    if (Net.role === 'host') {
      if (msg.t === 'hello') {
        this.guestHello = { name: String(msg.name || 'Ospite').slice(0, 14), kit: Number(msg.kit) || 0, formation: FORMATIONS[msg.formation] ? msg.formation : '4-4-2' };
        $('host-start').disabled = false;
        $('host-status').textContent = 'Il tuo amico e\' collegato! Premi "Avvia la partita".';
        this.sendLobby();
      } else if (msg.t === 'i') {
        if (msg.q > this.remoteSeq) { this.remoteSeq = msg.q; this.remoteMask = msg.k | 0; }
      } else if (msg.t === 'bye') {
        if (this.mode === 'host') { this.toast('Il tuo amico ha lasciato la partita.'); this.quitToMenu(); }
      }
    } else {
      if (msg.t === 'lobby') {
        const k = KIT_COLORS[msg.guestKit];
        $('join-status').classList.remove('err');
        $('join-status').textContent = 'Collegato alla stanza di "' + msg.host.name + '". Giocherai con la maglia ' + k.name + ' (' + msg.halfMinutes + ' min a tempo). In attesa che l\'host avvii la partita...';
      } else if (msg.t === 'start') {
        this.mode = 'guest';
        this.match = null;
        this.info = msg.info;
        this.localSide = msg.side;
        this.guestBuf = [];
        this.guestOffset = null;
        this.guestLast = null;
        this.beginGame();
      } else if (msg.t === 's') {
        if (this.mode !== 'guest') return;
        const s = msg.d;
        const now = performance.now() / 1000;
        const sample = now - s.tm;
        if (this.guestOffset == null || sample < this.guestOffset || s.tm < (this.guestBuf.length ? this.guestBuf[0].tm : 0)) this.guestOffset = sample;
        else this.guestOffset += (sample - this.guestOffset) * 0.003;
        // inserimento ordinato (i pacchetti possono arrivare in disordine)
        const b = this.guestBuf;
        if (b.length && s.tm < b[b.length - 1].tm - 1) { b.length = 0; }
        let i = b.length;
        while (i > 0 && b[i - 1].tm > s.tm) i--;
        if (!(i > 0 && b[i - 1].tm === s.tm)) b.splice(i, 0, s);
        if (b.length > 40) b.splice(0, b.length - 40);
      } else if (msg.t === 'end') {
        this.guestSummary = msg.sum;
      } else if (msg.t === 'bye') {
        if (this.mode === 'guest') { this.toast('L\'host ha chiuso la partita.'); this.quitToMenu(); }
      }
    }
  },

  guestSnapshot() {
    const b = this.guestBuf;
    if (!b.length) return null;
    const now = performance.now() / 1000;
    const rt = now - this.guestOffset - CFG.INTERP_DELAY;
    while (b.length > 2 && b[1].tm <= rt) b.shift();
    if (b.length === 1 || rt <= b[0].tm) return b[0];
    const a = b[0], c = b[1];
    if (rt >= c.tm) return c;
    return interpSnap(a, c, (rt - a.tm) / (c.tm - a.tm));
  },

  // ---------- Ciclo ----------
  frame(ts) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, (ts - (this.last || ts)) / 1000);
    this.last = ts;
    this.fpsN++; this.fpsT += dt;
    if (this.fpsT >= 0.5) { this.fps = Math.round(this.fpsN / this.fpsT); this.fpsN = 0; this.fpsT = 0; }

    const playing = !this.screen;
    Keyboard.gameActive = playing && this.mode !== 'demo';
    const localMask = playing ? Keyboard.mask : 0;
    let snap = null;

    if (this.mode === 'guest') {
      this.inputSeq++;
      Net.send({ t: 'i', k: localMask, q: this.inputSeq });
      snap = this.guestSnapshot();
      if (snap && snap.ph === PH.FULLTIME && !this.resultShown) {
        if (!this.fullTimeAt) this.fullTimeAt = ts;
        if (ts - this.fullTimeAt > 3000 && this.guestSummary) this.showResult(this.guestSummary);
      }
    } else if (this.match) {
      if (!this.paused) {
        this.acc += dt;
        let steps = 0;
        while (this.acc >= CFG.DT && steps < 6) {
          const masks = this.mode === 'host' ? [localMask, this.remoteMask] : [localMask, 0];
          this.match.update(CFG.DT, masks);
          this.acc -= CFG.DT;
          steps++;
          if (this.mode === 'host' && this.match.tick % 2 === 0) Net.send({ t: 's', d: this.match.snapshot() });
        }
        if (steps >= 6) this.acc = 0;
      }
      snap = this.match.snapshot();
      if (this.mode === 'demo' && this.match.phase === PH.FULLTIME) this.startDemo();
      if ((this.mode === 'cpu' || this.mode === 'host') && this.match.phase === PH.FULLTIME && !this.resultShown) {
        if (!this.fullTimeAt) {
          this.fullTimeAt = ts;
          if (this.mode === 'host') Net.send({ t: 'end', sum: this.match.summary() });
        }
        if (ts - this.fullTimeAt > 3000) this.showResult(this.match.summary());
      }
    }

    if (snap && this.info) {
      let follow = null;
      if (this.localSide != null && snap.hp[this.localSide] >= 0 && !snap.rp) {
        const o = snap.hp[this.localSide] * 7;
        follow = { x: snap.p[o] / 100, y: snap.p[o + 1] / 100 };
      }
      this.renderer.updateCamera(snap, dt, follow);
      this.renderer.draw(snap, this.info, {
        localSide: this.localSide,
        online: this.mode === 'host' || this.mode === 'guest',
        ping: this.mode === 'guest' ? Net.ping : null,
        fps: this.showFps ? this.fps : 0,
      });
      if (this.mode !== 'demo') this.sounds(snap, dt);
    } else {
      const ctx = this.renderer.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#0b1320'; ctx.fillRect(0, 0, this.renderer.cv.width, this.renderer.cv.height);
      if (this.mode === 'guest') {
        ctx.fillStyle = '#fff'; ctx.font = '18px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('In attesa dei dati della partita...', this.renderer.W / 2, this.renderer.H / 2);
      }
    }
  },

  sounds(snap, dt) {
    const ev = snap.ev;
    if (this.prevEv) {
      const p = this.prevEv;
      if (ev[0] > p[0]) Sound.kick(1);
      if (ev[1] > p[1]) Sound.whistle(ev[1] - p[1] >= 3);
      if (ev[2] > p[2]) Sound.cheer();
      if (ev[3] > p[3]) Sound.post();
    }
    this.prevEv = ev.slice();
    this.crowdT -= dt;
    if (this.crowdT <= 0) { this.crowdT = 0.25; Sound.setCrowd(snap.cr / 100); }
  },

  showResult(sum) {
    this.resultShown = true;
    $('result-score').textContent = sum.names[0] + '  ' + sum.score[0] + ' - ' + sum.score[1] + '  ' + sum.names[1];
    $('result-scorers').textContent = sum.scorers.length
      ? sum.scorers.map((s) => s.min + '\' ' + s.name + ' (' + sum.names[s.team] + ')').join(' • ')
      : 'Nessun gol';
    const rows = [
      ['Possesso palla', sum.possession[0] + '%', sum.possession[1] + '%'],
      ['Tiri', sum.shots[0], sum.shots[1]],
      ['Tiri in porta', sum.onTarget[0], sum.onTarget[1]],
      ['Calci d\'angolo', sum.corners[0], sum.corners[1]],
      ['Falli', sum.fouls[0], sum.fouls[1]],
      ['Fuorigioco', sum.offsides[0], sum.offsides[1]],
    ];
    const tb = $('result-stats');
    tb.innerHTML = '';
    for (const r of rows) {
      const tr = document.createElement('tr');
      for (const c of [r[1], r[0], r[2]]) { const td = document.createElement('td'); td.textContent = c; tr.appendChild(td); }
      tb.appendChild(tr);
    }
    $('result-again').disabled = this.mode === 'guest';
    $('result-wait').textContent = this.mode === 'guest' ? 'Per la rivincita aspetta che l\'host la avvii.' : '';
    this.show('result');
  },
};

// Interpolazione tra due snapshot (secondo giocatore online).
function interpSnap(a, b, t) {
  const r = Object.assign({}, b);
  const lerp = (x, y) => x + (y - x) * t;
  const bx = b.b;
  const ax = a.b;
  const jump = Math.abs(bx[0] - ax[0]) > 600 || Math.abs(bx[1] - ax[1]) > 600;
  r.b = jump ? bx : [lerp(ax[0], bx[0]), lerp(ax[1], bx[1]), lerp(ax[2], bx[2]), bx[3]];
  if (a.p.length === b.p.length && a.rp === b.rp) {
    const p = b.p.slice();
    for (let i = 0; i < p.length; i += 7) {
      const dx = b.p[i] - a.p[i], dy = b.p[i + 1] - a.p[i + 1];
      if (Math.abs(dx) > 500 || Math.abs(dy) > 500) continue;
      p[i] = lerp(a.p[i], b.p[i]);
      p[i + 1] = lerp(a.p[i + 1], b.p[i + 1]);
      if (a.p[i + 2] === b.p[i + 2] && Math.abs(b.p[i + 3] - a.p[i + 3]) < 300) p[i + 3] = lerp(a.p[i + 3], b.p[i + 3]);
      let da = b.p[i + 4] - a.p[i + 4];
      if (da > 180) da -= 360; if (da < -180) da += 360;
      p[i + 4] = a.p[i + 4] + da * t;
    }
    r.p = p;
  }
  return r;
}

window.App = App;
window.addEventListener('load', () => App.start());

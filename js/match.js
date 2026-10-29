// Partita: regole, calci piazzati, azioni dei giocatori, controllo umano, snapshot.
// Gira solo sull'host (o in locale contro l'IA): il secondo giocatore online riceve gli snapshot.
'use strict';

const PH = { PLAY: 0, RESTART: 1, GOAL: 2, REPLAY: 3, HALFTIME: 4, FULLTIME: 5 };
const RT = { KICKOFF: 0, THROWIN: 1, CORNER: 2, GOALKICK: 3, FREEKICK: 4, PENALTY: 5 };
const RT_NAMES = ["CALCIO D'INIZIO", 'RIMESSA LATERALE', "CALCIO D'ANGOLO", 'RINVIO DAL FONDO', 'PUNIZIONE', 'CALCIO DI RIGORE'];
const CHARGE_KEYS = [K.PASS, K.SHOOT, K.THROUGH, K.LOB, K.FINESSE, K.CHIP];
const CHARGE_KIND = { [K.PASS]: 1, [K.SHOOT]: 2, [K.THROUGH]: 3, [K.LOB]: 4, [K.FINESSE]: 5, [K.CHIP]: 6 };
const MAX_CHARGE = 1.0;

class Match {
  // opts: { kits:[i,i], names:[s,s], formations:[s,s], humans:[bool,bool], difficulty, halfMinutes }
  constructor(opts) {
    this.opts = opts;
    this.diff = DIFFICULTIES[opts.difficulty != null ? opts.difficulty : 1];
    this.ball = new Ball();
    this.teams = [];
    const usedNames = new Set();
    for (let t = 0; t < 2; t++) {
      const kit = KIT_COLORS[opts.kits[t]];
      const form = FORMATIONS[opts.formations[t]] || FORMATIONS['4-4-2'];
      const team = {
        id: t, name: opts.names[t], kit, kitIndex: opts.kits[t],
        keeperKit: KEEPER_KITS[t === 0 ? 0 : 1], dir: t === 0 ? 1 : -1, score: 0,
        mentality: 0, players: [], press: false, keeperRush: false, formation: opts.formations[t],
      };
      for (let i = 0; i < 11; i++) {
        let n;
        do { n = U.pick(SURNAMES); } while (usedNames.has(n) && usedNames.size < SURNAMES.length);
        usedNames.add(n);
        const p = new Player(t, i, form[i][2], [form[i][0], form[i][1]], n, i + 1, U.pick(SKIN_TONES));
        team.players.push(p);
      }
      this.teams.push(team);
    }
    this.all = this.teams[0].players.concat(this.teams[1].players);
    this.humans = opts.humans.slice();
    this.controllers = [new Controller(), new Controller()];
    this.humanP = [null, null];
    this.charge = [0, 0];
    this.chargeKind = [0, 0];
    this.passPreview = [null, null];
    this.queued = [null, null];
    this.switchCd = [0, 0];
    this.halfLen = (opts.halfMinutes || 3) * 60;
    this.clockRate = 2700 / this.halfLen;
    this.clock = 0;
    this.half = 1;
    this.added = U.randInt(1, 4);
    this.time = 0;
    this.tick = 0;
    this.phase = PH.RESTART;
    this.phaseT = 0;
    this.restart = null;
    this.lastTouch = null;
    this.lastKickTeam = -1;
    this.offsideList = [];
    this.ev = [0, 0, 0, 0, 0, 0]; // calci, fischi, gol, pali, rete, applausi
    this.crowd = 0.3;
    this.msg = ''; this.msgT = 0;
    this.fade = 0;
    this.replayBuf = [];
    this.replayFrames = null;
    this.replayT = 0;
    this.kickoffTeam = 0;
    this.stats = { shots: [0, 0], onTarget: [0, 0], fouls: [0, 0], corners: [0, 0], offsides: [0, 0], possession: [0, 0] };
    this.scorers = [];
    this.icBest = [null, null];
    this.ballPath = null;
    this.seq = 0;
    this.startKickoff(0);
  }

  // ---------- Geometria ----------
  dir(t) { return this.teams[t].dir; }
  rx(t, x) { return x * this.teams[t].dir; }
  goalX(t) { return this.teams[t].dir * CFG.HALF_L; }       // porta che la squadra attacca
  ownGoalX(t) { return -this.teams[t].dir * CFG.HALF_L; }
  inOwnBox(t, x, y) {
    return this.rx(t, x) < -CFG.HALF_L + CFG.BOX_DEPTH && Math.abs(y) < CFG.BOX_HALF_W;
  }
  activePlayers(t) { return this.teams[t].players.filter((p) => p.active); }
  keeper(t) { return this.teams[t].players[0]; }

  possTeam() {
    if (this.ball.owner) return this.ball.owner.team;
    if (this.ball.intended) return this.ball.intended.team;
    return -1;
  }

  pressure(p) {
    let m = 99;
    for (const o of this.teams[1 - p.team].players) {
      if (!o.active) continue;
      const d = U.dist(o.x, o.y, p.x, p.y);
      if (d < m) m = d;
    }
    return U.clamp(1 - (m - 0.8) / 3.2, 0, 1);
  }

  // Penultimo difensore (linea del fuorigioco) della squadra t, in coordinate relative di chi attacca.
  offsideLineFor(attTeam) {
    const def = 1 - attTeam;
    const rxs = this.teams[def].players.filter((p) => p.active).map((p) => this.rx(attTeam, p.x)).sort((a, b) => b - a);
    return rxs.length > 1 ? rxs[1] : 0;
  }

  setMsg(text, t) { this.msg = text; this.msgT = t || 2.2; }

  // ---------- Ciclo principale ----------
  update(dt, masks) {
    this.time += dt;
    this.tick++;
    for (let s = 0; s < 2; s++) {
      this.controllers[s].feed(this.humans[s] ? masks[s] || 0 : 0, dt);
      if (this.humans[s] && this.controllers[s].pressed(K.MENTALITY)) {
        const t = this.teams[s];
        t.mentality = t.mentality >= 1 ? -1 : t.mentality + 1;
        this.setMsg(t.name + ': mentalita\' ' + ['DIFENSIVA', 'EQUILIBRATA', 'OFFENSIVA'][t.mentality + 1], 1.5);
      }
    }
    this.msgT -= dt;
    this.fade = Math.max(0, this.fade - dt * 2.2);
    this.crowd += (0.3 - this.crowd) * dt * 0.4;

    switch (this.phase) {
      case PH.PLAY: this.stepPlay(dt); break;
      case PH.RESTART: this.stepRestart(dt); break;
      case PH.GOAL: this.stepGoal(dt); break;
      case PH.REPLAY: this.stepReplay(dt); break;
      case PH.HALFTIME:
        this.phaseT -= dt;
        this.idlePlayers(dt);
        if (this.phaseT <= 0) this.startSecondHalf();
        break;
      case PH.FULLTIME:
        this.idlePlayers(dt);
        break;
    }

    if ((this.phase === PH.PLAY || this.phase === PH.GOAL || this.phase === PH.RESTART) && this.tick % 2 === 0) {
      this.replayBuf.push(this.snapshot(true));
      if (this.replayBuf.length > CFG.SNAP_HZ * 7) this.replayBuf.shift();
    }
  }

  advanceClock(dt) {
    this.clock += dt * this.clockRate;
    const limit = (this.half === 1 ? 2700 : 5400) + this.added * 60;
    if (this.clock >= limit) {
      const b = this.ball;
      const danger = Math.abs(b.x) > CFG.HALF_L - 25 && this.phase === PH.PLAY;
      if (!danger || this.clock >= limit + 120) this.endHalf();
    }
  }

  endHalf() {
    this.ev[1] += 3;
    this.ball.owner = null;
    if (this.half === 1) {
      this.phase = PH.HALFTIME;
      this.phaseT = 4;
      this.setMsg('INTERVALLO', 4);
    } else {
      this.phase = PH.FULLTIME;
      this.setMsg('FISCHIO FINALE', 99);
      const [a, b] = [this.teams[0].score, this.teams[1].score];
      for (const p of this.all) {
        if (!p.active) continue;
        const won = (p.team === 0 && a > b) || (p.team === 1 && b > a);
        if (a !== b) p.setState(won ? PS.CELEBRATE : PS.SAD, 99);
      }
    }
  }

  startSecondHalf() {
    this.half = 2;
    this.clock = 2700;
    this.added = U.randInt(2, 5);
    for (const t of this.teams) t.dir *= -1;
    for (const p of this.all) p.stamina = Math.min(1, p.stamina + 0.4);
    this.startKickoff(1);
  }

  idlePlayers(dt) {
    for (const p of this.all) {
      if (!p.active) continue;
      p.steer(0, 0, dt);
      p.update(dt);
    }
  }

  stepPlay(dt) {
    this.advanceClock(dt);
    if (this.phase !== PH.PLAY) return;
    this.teams[0].press = this.teams[1].press = false;
    this.teams[0].keeperRush = this.teams[1].keeperRush = false;
    this.computeIntercepts();
    for (let s = 0; s < 2; s++) if (this.humans[s]) this.updateHuman(s, dt);
    if (this.phase !== PH.PLAY) return;
    AI.update(this, dt);
    if (this.phase !== PH.PLAY) return;
    for (const p of this.all) if (p.active) p.update(dt);
    this.separate();
    this.updateBall(dt);
    if (this.phase !== PH.PLAY) return;
    this.checkSlides();
    if (this.phase !== PH.PLAY) return;
    this.checkBounds();
    const pt = this.possTeam();
    if (pt >= 0) this.stats.possession[pt] += dt;
  }

  // ---------- Palla ----------
  updateBall(dt) {
    const b = this.ball;
    const o = b.owner;
    if (o) {
      if (!o.active || o.state === PS.DOWN || o.state === PS.STAGGER || o.state === PS.SLIDE) {
        b.owner = null;
        b.vx = o.vx * 0.8; b.vy = o.vy * 0.8;
        o.holding = false;
      } else if (o.holding) {
        const fp = o.footPoint(0.35);
        b.x = fp.x; b.y = fp.y; b.z = 1.05; b.vx = o.vx; b.vy = o.vy; b.vz = 0;
        o.holdT = (o.holdT || 0) + dt;
        // Il portiere non puo' uscire dall'area con la palla in mano
        if (!this.inOwnBox(o.team, o.x, o.y)) {
          o.holding = false;
        }
        return;
      } else {
        const sp = Math.sqrt(o.vx * o.vx + o.vy * o.vy);
        const reach = 0.42 + Math.min(sp, 9) * 0.06 + (o.sprinting ? Math.max(0, Math.sin(o.phase * 0.5)) * 0.35 : 0);
        const fp = o.footPoint(reach);
        b.x += (fp.x - b.x) * Math.min(1, dt * 24);
        b.y += (fp.y - b.y) * Math.min(1, dt * 24);
        b.z = 0; b.vz = 0;
        b.vx = o.vx; b.vy = o.vy;
        b.rot += (sp * dt) / CFG.BALL_R;
        return;
      }
    }
    const ev = b.step(dt);
    if (ev) { this.ev[3]++; this.crowd = Math.min(1, this.crowd + 0.35); }
    if (!b.inNet) this.checkTouches();
  }

  checkTouches() {
    const b = this.ball;
    const bs = b.speed();
    let best = null, bestD = 99, bestKind = 0;
    for (const p of this.all) {
      if (!p.canTouch() || p.state === PS.SLIDE) continue;
      const d = U.dist(p.x, p.y, b.x, b.y);
      if (d > 2.2) continue;
      let kind = 0;
      const isGK = p.role === 'GK' && this.inOwnBox(p.team, p.x, p.y);
      if (isGK) {
        let hx = p.x, hy = p.y, reach = 0.8, hz = 2.25;
        if (p.state === PS.DIVE) {
          hx = p.x + Math.cos(p.diveDir) * 0.7; hy = p.y + Math.sin(p.diveDir) * 0.7;
          reach = 0.55 + p.attr.keeping * 0.2;
          hz = Math.min(2.4, Math.max(2.1, p.diveZ + 0.6));
        }
        const dh = U.dist(hx, hy, b.x, b.y);
        if (dh < reach && b.z < hz) { kind = 3; if (dh < bestD) { best = p; bestD = dh; bestKind = kind; } continue; }
      }
      if (p.state === PS.DIVE) continue;
      // Chi va sulla palla (destinatario, inseguitore, giocatore umano) ha piu' portata;
      // gli altri intercettano solo se la palla passa proprio vicino.
      const going = b.intended === p || this.icBest[p.team] === p || p.human >= 0;
      let rf = going ? 0.9 : bs > 15 ? 0.5 : 0.65;
      let rb = going ? 0.7 : 0.5;
      // Appena calciata, la palla la ferma solo chi e' proprio sulla traiettoria
      if (this.time - (this.lastKickTime || -9) < 0.15 && this.lastTouch && this.lastTouch.team !== p.team) { rf = 0.42; rb = 0.42; }
      if (b.z < 0.75 && d < rf) kind = 1;
      else if (b.z >= 0.75 && b.z < 2.15 && d < rb) kind = 2;
      if (kind && d < bestD) { best = p; bestD = d; bestKind = kind; }
    }
    if (best) this.touch(best, bestKind);
  }

  // Un giocatore tocca la palla: controllo, deviazione, parata, colpo di testa.
  touch(p, kind) {
    const b = this.ball;
    // Fuorigioco: chi era in posizione irregolare al momento del passaggio tocca la palla
    if (this.offsideList.length && this.offsideList.includes(p)) {
      this.offsideList = [];
      this.stats.offsides[p.team]++;
      this.lastTouch = p;
      this.foulRestartOffside(p);
      return;
    }
    const rvx = b.vx - p.vx, rvy = b.vy - p.vy;
    const rs3 = Math.sqrt(rvx * rvx + rvy * rvy + b.vz * b.vz);
    const rs = Math.sqrt(rvx * rvx + rvy * rvy) + Math.abs(b.vz) * 0.35;
    const prevTeam = this.lastTouch ? this.lastTouch.team : -1;
    const wasIntended = b.intended === p;
    this.offsideList = [];
    this.lastTouch = p;
    b.intended = null;

    if (kind === 3) {
      // Portiere
      const catchLim = 14 + 10 * p.attr.keeping * this.keeperSkill(p.team);
      const fumble = Math.random() > 0.9 + 0.08 * p.attr.keeping;
      if (rs3 < catchLim && !fumble && b.z < 2.3) {
        this.gainBall(p, true);
        if (prevTeam !== p.team && rs3 > 9) { this.setMsg('PARATA!', 1.4); this.crowd = Math.min(1, this.crowd + 0.25); }
      } else {
        // Respinta verso l'esterno
        const out = this.dir(p.team);
        // a volte la respinta va oltre il palo (calcio d'angolo), altrimenti torna in campo
        const ang = Math.random() < 0.4
          ? Math.atan2(U.sign(b.y || U.rand(-1, 1)), -out * U.rand(0.1, 0.6))
          : Math.atan2(U.rand(-1, 1), out) + U.gauss() * 0.5;
        const sp = Math.min(rs3 * 0.42, 11);
        b.kick(Math.cos(ang) * sp, Math.sin(ang) * sp, U.rand(0.5, 3.5), 0);
        p.kickCd = 0.35;
        this.ev[0]++;
        if (prevTeam !== p.team) { this.setMsg('RESPINTA!', 1.2); this.crowd = Math.min(1, this.crowd + 0.3); }
      }
      return;
    }

    if (kind === 2) {
      // Palla alta: colpo di testa se c'e' un'intenzione, altrimenti stop di petto o deviazione
      const head = this.headerIntent(p);
      if (head) { this.doHeader(p, head); return; }
      if (rs < 9 + p.attr.dribble * 3 + (wasIntended ? 5 : 0)) { this.gainBall(p); return; }
      this.deflect(p, rs);
      return;
    }

    // Il destinatario del passaggio e' pronto a riceverlo: stop piu' facile
    const limit = 11 + 10 * p.attr.dribble + (p.human >= 0 ? 3 : 0) + (wasIntended ? 4 : 0);
    if (rs < limit) {
      this.gainBall(p);
    } else {
      this.deflect(p, rs);
    }
  }

  keeperSkill(t) {
    return this.humans[t] ? 0.95 : this.diff.keeper;
  }

  deflect(p, rs) {
    const b = this.ball;
    const sp = rs * U.rand(0.25, 0.45);
    const a = Math.atan2(b.vy, b.vx) + Math.PI + U.gauss() * 1.2;
    b.kick(Math.cos(a) * sp + p.vx * 0.5, Math.sin(a) * sp + p.vy * 0.5, Math.abs(b.vz) * 0.3 + U.rand(0, 1), 0);
    p.kickCd = 0.25;
    this.ev[0]++;
  }

  gainBall(p, hands) {
    const b = this.ball;
    b.owner = p;
    b.vz = 0;
    b.spin = 0;
    b.intended = null;
    p.holding = !!hands;
    p.holdT = 0;
    // Senza pressione si conduce un po' prima di decidere; sotto pressione si decide subito
    p.thinkT = (this.pressure(p) > 0.5 ? U.rand(0.1, 0.25) : U.rand(0.6, 1.2)) + this.diff.react * 0.4;
    p.dribX = null;
    if (!hands) b.z = 0;
    this.lastTouch = p;
    // Il giocatore umano prende subito il controllo; un'azione "di prima" in coda parte ora
    if (this.humans[p.team]) {
      this.setHuman(p.team, p);
      const q = this.queued[p.team];
      if (q && this.time - q.t < 1.3 && !hands) {
        this.queued[p.team] = null;
        this.execAction(p, q.kind, q.aim, q.power);
      }
    }
  }

  // ---------- Azioni ----------
  aimOf(p, aim) {
    if (aim && aim.any) return aim;
    return { x: Math.cos(p.facing), y: Math.sin(p.facing), any: false };
  }

  execAction(p, kind, aim, power) {
    if (p.holding) { this.humanPass(p, kind === 1 ? 'ground' : 'lob', aim, power); return; }
    // Dai e vai: dopo un passaggio corto il centrocampista/attaccante si inserisce
    if ((kind === 1 || kind === 3) && p.role !== 'DF') p.gaT = 1.8;
    switch (kind) {
      case 1: this.humanPass(p, 'ground', aim, power); break;
      case 2: this.doShoot(p, 'normal', aim, power); break;
      case 3: this.humanPass(p, 'through', aim, power); break;
      case 4: this.humanPass(p, 'lob', aim, power); break;
      case 5: this.doShoot(p, 'finesse', aim, power); break;
      case 6: this.doShoot(p, 'chip', aim, power); break;
    }
  }

  // Sceglie il compagno meglio piazzato nella direzione indicata.
  // Sceglie il compagno nella direzione indicata, preferendo chi e' libero e ha la linea di passaggio pulita.
  findPassTarget(p, aim, kind) {
    const a = this.aimOf(p, aim);
    const minCos = kind === 'lob' ? 0.6 : 0.5;
    const maxD = kind === 'lob' ? 65 : kind === 'through' ? 48 : 42;
    const opp = this.teams[1 - p.team].players;
    let best = null, bestS = -99;
    for (const q of this.teams[p.team].players) {
      if (q === p || !q.active || q.state === PS.DOWN) continue;
      const qx = q.x + q.vx * 0.4, qy = q.y + q.vy * 0.4;
      const dx = qx - p.x, dy = qy - p.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 3 || d > maxD) continue;
      const cos = (dx * a.x + dy * a.y) / d;
      if (cos < minCos) continue;
      let tx = qx, ty = qy;
      if (kind === 'through') { const tp = this.throughPoint(p, q, 0.5); tx = tp.x; ty = tp.y; }
      const safety = AI.laneSafety(this, p, tx, ty, kind === 'lob' ? 'lob' : 'ground');
      let open = 8;
      for (const e of opp) if (e.active) open = Math.min(open, U.dist(e.x, e.y, tx, ty));
      const sc = cos * 2.4 - d / (kind === 'lob' ? 110 : 60) + safety * 0.7 + (open / 8) * 0.45;
      if (sc > bestS) { bestS = sc; best = q; }
    }
    return best;
  }

  // Punto nello spazio per il filtrante: dove il compagno arriva prima dei difensori.
  throughPoint(p, recv, power) {
    const t = p.team, fwd = this.dir(t);
    let lx = fwd, ly = 0;
    const rs = Math.sqrt(recv.vx * recv.vx + recv.vy * recv.vy);
    if (rs > 2) { lx = lx * 0.55 + (recv.vx / rs) * 0.45; ly = (recv.vy / rs) * 0.45; }
    // verso il centro se e' molto largo
    if (Math.abs(recv.y) > 18) ly -= U.sign(recv.y) * 0.25;
    const ll = Math.sqrt(lx * lx + ly * ly) || 1;
    lx /= ll; ly /= ll;
    const pref = 5 + 10 * Math.min(power || 0, 1);
    const b = this.ball;
    const rsp = CFG.SPRINT * (0.9 + recv.attr.speed * 0.14) * 0.92;
    let best = null, bestS = -99;
    for (let L = 4; L <= 18; L += 2) {
      const x = U.clamp(recv.x + lx * L, -CFG.HALF_L + 3, CFG.HALF_L - 3);
      const y = U.clamp(recv.y + ly * L, -CFG.HALF_W + 2, CFG.HALF_W - 2);
      const ballT = U.dist(b.x, b.y, x, y) / 13;
      const recvT = U.dist(recv.x, recv.y, x, y) / rsp + 0.1;
      let defT = 9;
      for (const o of this.teams[1 - t].players) {
        if (!o.active) continue;
        defT = Math.min(defT, Math.max(0, U.dist(o.x, o.y, x, y) - 0.7) / (CFG.SPRINT * 0.92) + 0.25);
      }
      const sc = (defT - Math.max(ballT, recvT)) + L * 0.03 - Math.abs(L - pref) * 0.04;
      if (sc > bestS) { bestS = sc; best = { x, y }; }
    }
    return best;
  }

  humanPass(p, kind, aim, power) {
    if (p.holding) {
      // Portiere con la palla in mano: J = rimessa con le mani, I/K = rinvio lungo
      p.holding = false;
      if (kind === 'ground') {
        const q = this.findPassTarget(p, aim, 'ground');
        this.doPassTo(p, 'throwhand', q, null, power);
      } else {
        const q = this.findPassTarget(p, aim, 'lob');
        this.doPassTo(p, 'lob', q, q ? null : this.pointAhead(p, aim, 45 + 15 * power), power + 0.3);
      }
      return;
    }
    const q = this.findPassTarget(p, aim, kind);
    if (q) this.doPassTo(p, kind, q, null, power);
    else {
      const dist = kind === 'lob' ? 18 + 35 * power : kind === 'through' ? 14 + 20 * power : 8 + 24 * power;
      this.doPassTo(p, kind, null, this.pointAhead(p, aim, dist), power);
    }
  }

  pointAhead(p, aim, dist) {
    const a = this.aimOf(p, aim);
    return { x: p.x + a.x * dist, y: p.y + a.y * dist };
  }

  // Tipo: 'ground' rasoterra, 'through' filtrante, 'lob' lancio/cross, 'throw' rimessa laterale, 'throwhand' rimessa del portiere
  doPassTo(p, kind, recv, point, power) {
    const b = this.ball;
    power = U.clamp(power || 0, 0, 1.3);
    let tx, ty;
    if (recv) {
      tx = recv.x; ty = recv.y;
      for (let i = 0; i < 2; i++) {
        const d = U.dist(b.x, b.y, tx, ty);
        const tEst = kind === 'lob' ? 0.9 + d / 26 : d / 17;
        tx = recv.x + recv.vx * tEst * 0.85;
        ty = recv.y + recv.vy * tEst * 0.85;
      }
      if (kind === 'through') {
        const tp = this.throughPoint(p, recv, power);
        tx = tp.x; ty = tp.y;
      }
    } else {
      tx = point.x; ty = point.y;
    }
    tx = U.clamp(tx, -CFG.HALF_L + 0.5, CFG.HALF_L - 0.5);
    ty = U.clamp(ty, -CFG.HALF_W + 0.5, CFG.HALF_W - 0.5);

    const dx = tx - b.x, dy = ty - b.y;
    const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    let ang = Math.atan2(dy, dx);
    const pr = this.pressure(p);
    const accMul = this.humans[p.team] ? 1 : 1.5 - this.diff.acc * 0.7;
    ang += U.gauss() * ((1 - p.attr.pass) * 0.06 + pr * 0.035 + d * 0.0006) * accMul;
    const cx = Math.cos(ang), cy = Math.sin(ang);

    p.faceTo(tx, ty);
    p.setState(PS.KICK, 0.22);
    p.kickCd = 0.3;
    b.owner = null;
    p.holding = false;

    if (kind === 'ground' || kind === 'through') {
      // Passaggi tesi: la palla arriva ancora veloce, cosi' e' difficile intercettarla
      let vEnd = kind === 'through' ? 3 + power * 2.5 : 6.5 + power * 5;
      if (d < 9) vEnd = Math.min(vEnd, 5 + power * 3);
      const v0 = U.clamp(groundPassSpeed(d, vEnd), 7, 32);
      b.kick(cx * v0, cy * v0, 0, 0);
    } else if (kind === 'lob' || kind === 'throw' || kind === 'throwhand') {
      if (kind === 'throwhand') {
        b.z = 1.2;
        const v0 = U.clamp(groundPassSpeed(d, 5), 6, 18);
        b.kick(cx * v0, cy * v0, 1.2, 0);
      } else {
        const z0 = kind === 'throw' ? 2.0 : 0.02;
        let T = 0.55 + d / 30 + Math.min(power, 1) * 0.2;
        if (kind === 'throw') T = 0.45 + d / 24;
        let vh = (d / T) * 1.03;
        if (kind === 'throw') vh = Math.min(vh, 15);
        const vz = (0.5 * CFG.GRAVITY * T * T - z0) / T;
        b.z = z0;
        b.kick(cx * vh, cy * vh, vz, 0);
      }
    }
    if (recv) b.intended = recv;
    this.afterKick(p, kind !== 'throw');
  }

  afterKick(p, offsideApplies) {
    this.ev[0]++;
    this.lastTouch = p;
    this.lastKickTeam = p.team;
    this.lastKickTime = this.time;
    this.offsideList = offsideApplies ? this.computeOffside(p) : [];
  }

  computeOffside(kicker) {
    const t = kicker.team;
    const line = this.offsideLineFor(t);
    const brx = this.rx(t, this.ball.x);
    const res = [];
    for (const q of this.teams[t].players) {
      if (q === kicker || !q.active) continue;
      const qrx = this.rx(t, q.x);
      if (qrx > 0.5 && qrx > brx + 0.3 && qrx > line + 0.3) res.push(q);
    }
    return res;
  }

  // aim: {x,y,any} per l'umano, oppure {goalY} per l'IA
  doShoot(p, kind, aim, power) {
    const b = this.ball;
    power = U.clamp(power || 0, 0, 1.25);
    const t = p.team;
    const gx = this.goalX(t);
    const G = CFG.GOAL_HALF_W;
    let gy;
    if (aim && aim.goalY != null) gy = aim.goalY;
    else if (aim && aim.any && Math.abs(aim.y) > 0.2) gy = U.clamp(aim.y * 1.3, -1, 1) * (G - 0.5);
    else {
      const k = this.keeper(1 - t);
      gy = (k.y > p.y ? -1 : 1) * (G - 0.6);
    }
    const dist = U.dist(b.x, b.y, gx, gy);
    const pr = this.pressure(p);
    const accMul = this.humans[t] ? 1 : 1.5 - this.diff.acc * 0.7;
    const toGoal = Math.atan2(gy - p.y, gx - p.x);
    const facePen = Math.min(1, Math.abs(U.angleDiff(p.facing, toGoal)) / Math.PI) * 0.05;
    let sigma = (0.022 + (1 - p.attr.shot) * 0.045 + Math.pow(Math.min(power, 1.2), 3) * 0.03 + pr * 0.03 + facePen) * accMul;
    if (kind === 'finesse') sigma *= 0.75;
    let vs, vz, spin = 0, ty = gy;
    const z0 = Math.max(0, b.z);

    if (kind === 'chip') {
      const T = U.clamp(dist / 12, 0.9, 1.9);
      vs = (dist - 0.3) / T;
      vz = (2.0 + 0.5 * CFG.GRAVITY * T * T - z0) / T;
      sigma *= 0.8;
    } else if (kind === 'finesse') {
      vs = 16 + 9 * Math.min(power, 1) + p.attr.shot * 2;
      const T = dist / vs;
      const h = 0.5 + 1.2 * Math.min(power, 1) + U.gauss() * 0.25;
      vz = (h + 0.5 * CFG.GRAVITY * T * T - z0) / T;
      // Effetto verso il centro della porta, con mira compensata
      const a0 = Math.atan2(gy - b.y, gx - b.x);
      const nx = -Math.sin(a0), ny = Math.cos(a0);
      const sgn = U.sign(ny * -gy || 1);
      spin = 2.6 * sgn;
      const lat = spin * CFG.SPIN_FORCE * 0.12 * vs * Math.min(1, vs / 12);
      const off = 0.42 * Math.abs(lat) * T * T;
      ty = gy - ny * sgn * off;
      const tx2 = gx - nx * sgn * off;
      const aa = Math.atan2(ty - b.y, tx2 - b.x) + U.gauss() * sigma;
      b.owner = null;
      this.finishShot(p, aa, vs, vz, spin, kind);
      return;
    } else {
      vs = 15 + 15 * Math.min(power, 1.2) + p.attr.shot * 3;
      const T = dist / vs;
      const h = 0.25 + 2.3 * Math.pow(Math.min(power, 1.25), 2.2) + U.gauss() * (0.2 + power * 0.45);
      vz = (h + 0.5 * CFG.GRAVITY * T * T - z0) / T;
    }
    const a = Math.atan2(ty - b.y, gx - b.x) + U.gauss() * sigma;
    b.owner = null;
    this.finishShot(p, a, vs, vz, spin, kind);
  }

  finishShot(p, a, vs, vz, spin, kind) {
    const b = this.ball;
    p.facing = a;
    p.setState(PS.KICK, 0.25);
    p.kickCd = 0.35;
    p.holding = false;
    b.kick(Math.cos(a) * vs, Math.sin(a) * vs, vz, spin);
    b.intended = null;
    this.stats.shots[p.team]++;
    // Tiro nello specchio?
    const path = b.predict(2.5, 1 / 30);
    const gx = this.goalX(p.team);
    for (const pt of path) {
      if (Math.abs(pt.x) >= CFG.HALF_L && U.sign(pt.x) === U.sign(gx)) {
        if (Math.abs(pt.y) < CFG.GOAL_HALF_W && pt.z < CFG.GOAL_H) this.stats.onTarget[p.team]++;
        break;
      }
    }
    this.crowd = Math.min(1, this.crowd + 0.25);
    this.afterKick(p, true);
  }

  headerIntent(p) {
    if (p.human >= 0) {
      const c = this.controllers[p.human];
      if (c.held(K.SHOOT) || c.held(K.PASS) || c.held(K.LOB) || c.held(K.THROUGH)) {
        return { kind: c.held(K.SHOOT) ? 'shot' : 'pass', aim: c.dir() };
      }
      return null;
    }
    // IA: in area avversaria tira di testa, nella propria spazza
    const rx = this.rx(p.team, p.x);
    if (rx > CFG.HALF_L - 18 && Math.abs(p.y) < 14) return { kind: 'shot' };
    if (rx < -CFG.HALF_L + 30) return { kind: 'clear' };
    return Math.random() < 0.5 ? { kind: 'pass' } : null;
  }

  doHeader(p, h) {
    const b = this.ball;
    let tx, ty, sp, vz;
    if (h.kind === 'shot') {
      tx = this.goalX(p.team);
      ty = h.aim && h.aim.any && Math.abs(h.aim.y) > 0.2 ? U.sign(h.aim.y) * 2.8 : U.rand(-3, 3);
      sp = 13 + p.attr.shot * 5; vz = U.rand(-2.5, 1.2);
    } else if (h.kind === 'clear') {
      tx = b.x + this.dir(p.team) * 22; ty = b.y + U.rand(-12, 12);
      sp = 14; vz = 4.5;
    } else {
      const q = this.findPassTarget(p, h.aim && h.aim.any ? h.aim : { x: this.dir(p.team), y: 0, any: true }, 'ground');
      if (q) { tx = q.x; ty = q.y; } else { tx = b.x + this.dir(p.team) * 12; ty = b.y; }
      sp = U.clamp(U.dist(b.x, b.y, tx, ty) * 0.8, 6, 13); vz = 2.5;
    }
    const a = Math.atan2(ty - b.y, tx - b.x) + U.gauss() * 0.12;
    p.setState(PS.HEAD, 0.3);
    p.kickCd = 0.3;
    b.kick(Math.cos(a) * sp, Math.sin(a) * sp, vz, 0);
    if (h.kind === 'shot') this.stats.shots[p.team]++;
    this.afterKick(p, true);
  }

  knockOn(p, aim) {
    const a = this.aimOf(p, aim);
    const b = this.ball;
    p.kickCd = 0.3;
    b.kick(a.x * 10.5 + p.vx * 0.3, a.y * 10.5 + p.vy * 0.3, 0, 0);
    this.ev[0]++;
    this.lastTouch = p;
    this.offsideList = [];
  }

  // Finta: scarto laterale veloce mantenendo la palla; i difensori vicini possono sbilanciarsi.
  skillMove(p, aim) {
    const a = this.aimOf(p, aim);
    let ang = Math.atan2(a.y, a.x);
    if (!aim || !aim.any) ang = p.facing + (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2;
    p.skillT = 0.34;
    p.skillDir = ang;
    for (const o of this.teams[1 - p.team].players) {
      if (!o.active || o.busy) continue;
      if (U.dist(o.x, o.y, p.x, p.y) < 2.6 && Math.random() < 0.25 + p.attr.dribble * 0.45) {
        o.setState(PS.STAGGER, 0.45);
      }
    }
  }

  standingTackle(p) {
    if (p.tackleCd > 0 || p.busy) return;
    p.tackleCd = 0.55;
    p.setState(PS.KICK, 0.2);
    const c = this.ball.owner;
    if (!c || c.team === p.team) {
      // Contrasto su palla vagante vicina
      const b = this.ball;
      if (!c && b.z < 0.6 && U.dist(p.x, p.y, b.x, b.y) < 1.4) this.gainBall(p);
      return;
    }
    const d = U.dist(p.x, p.y, c.x, c.y);
    if (d > 1.65) return;
    if (c.holding) return;
    const toT = Math.atan2(p.y - c.y, p.x - c.x);
    const behind = Math.abs(U.angleDiff(c.facing, toT)) > 2.2;
    let prob = 0.45 + 0.5 * (p.attr.tackle - 0.65) - 0.35 * (c.attr.dribble - 0.65);
    if (c.shield) prob -= 0.25;
    if (c.sprinting) prob += 0.12;
    if (p.jockey) prob += 0.1;
    if (c.skillT > 0) prob -= 0.5;
    if (behind) prob -= 0.15;
    if (p.human < 0) prob += (this.diff.aggr - 0.55) * 0.2 - 0.07;
    if (Math.random() < prob) {
      if (Math.random() < 0.55) this.gainBall(p);
      else {
        const a = toT + U.gauss() * 0.8;
        this.ball.kick(Math.cos(a) * U.rand(3, 6), Math.sin(a) * U.rand(3, 6), 0, 0);
        this.lastTouch = p;
      }
      c.setState(PS.STAGGER, 0.3);
      this.ev[0]++;
      this.offsideList = [];
    } else if (behind && Math.random() < 0.35) {
      this.foul(p, c, false);
    } else {
      p.setState(PS.STAGGER, 0.45);
    }
  }

  slideTackle(p, aim) {
    if (p.busy || p.tackleCd > 0) return;
    const a = aim && aim.any ? Math.atan2(aim.y, aim.x) : p.facing;
    p.slideDir = a;
    p.facing = a;
    p.slideWon = false;
    p.slideHit = false;
    p.setState(PS.SLIDE, 0.62);
    p.tackleCd = 1.2;
    const sp = Math.max(8.8, Math.sqrt(p.vx * p.vx + p.vy * p.vy) + 1.5);
    p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp;
  }

  checkSlides() {
    const b = this.ball;
    for (const p of this.all) {
      if (!p.active || p.state !== PS.SLIDE) continue;
      const fx = p.x + Math.cos(p.slideDir) * 0.75, fy = p.y + Math.sin(p.slideDir) * 0.75;
      if (!p.slideWon && b.z < 0.6 && U.dist(fx, fy, b.x, b.y) < 1.0 && (!b.owner || b.owner.team !== p.team)) {
        const carrier = b.owner;
        p.slideWon = true;
        b.owner = null;
        if (carrier) carrier.holding = false;
        const a = p.slideDir + U.gauss() * 0.4;
        b.kick(Math.cos(a) * U.rand(6, 10), Math.sin(a) * U.rand(6, 10), U.rand(0, 1.5), 0);
        this.lastTouch = p;
        this.offsideList = [];
        b.intended = null;
        this.ev[0]++;
        if (carrier && Math.random() < 0.5) carrier.setState(PS.DOWN, 0.8);
      }
      if (!p.slideHit) {
        for (const o of this.teams[1 - p.team].players) {
          if (!o.active || o.state === PS.DOWN) continue;
          if (U.dist(p.x, p.y, o.x, o.y) < 0.9) {
            p.slideHit = true;
            if (!p.slideWon && (b.owner === o || U.dist(o.x, o.y, b.x, b.y) < 2.5)) {
              this.foul(p, o, true);
              return;
            }
            o.setState(PS.DOWN, 0.7);
          }
        }
      }
    }
  }

  foul(off, victim, slide) {
    if (this.phase !== PH.PLAY) return;
    this.stats.fouls[off.team]++;
    victim.setState(PS.DOWN, 1.2);
    this.ball.owner = null;
    this.ev[1]++;
    const toOff = Math.atan2(off.y - victim.y, off.x - victim.x);
    const behind = Math.abs(U.angleDiff(victim.facing, toOff)) > 2.0;
    let pY = slide ? (behind ? 0.6 : 0.22) : 0.1;
    let text = 'FALLO di ' + off.name;
    if (Math.random() < pY) {
      off.yellow++;
      if (off.yellow >= 2) {
        text = 'ESPULSO ' + off.name + '! (doppio giallo)';
        this.sendOff(off);
      } else text = 'AMMONITO ' + off.name;
    } else if (slide && behind && Math.random() < 0.06) {
      text = 'ROSSO DIRETTO a ' + off.name + '!';
      off.yellow = 3;
      this.sendOff(off);
    }
    this.setMsg(text, 2.5);
    const x = victim.x, y = victim.y;
    if (this.inOwnBox(off.team, x, y)) {
      this.startRestart(RT.PENALTY, victim.team, -this.ownGoalX(victim.team) * (CFG.HALF_L - CFG.PEN_SPOT) / CFG.HALF_L, 0);
    } else {
      this.startRestart(RT.FREEKICK, victim.team, U.clamp(x, -CFG.HALF_L + 1, CFG.HALF_L - 1), U.clamp(y, -CFG.HALF_W + 1, CFG.HALF_W - 1));
    }
  }

  sendOff(p) {
    p.active = false;
    p.x = 0; p.y = CFG.HALF_W + 8;
    p.vx = p.vy = 0;
    if (this.humanP[p.team] === p) { p.human = -1; this.humanP[p.team] = null; }
  }

  foulRestartOffside(p) {
    this.ev[1]++;
    this.setMsg('FUORIGIOCO! ' + p.name, 2.2);
    this.startRestart(RT.FREEKICK, 1 - p.team, U.clamp(p.x, -CFG.HALF_L + 1, CFG.HALF_L - 1), U.clamp(p.y, -CFG.HALF_W + 1, CFG.HALF_W - 1));
  }

  // ---------- Regole: fuori campo e gol ----------
  checkBounds() {
    const b = this.ball;
    if (b.inNet) return;
    const L = CFG.HALF_L, W = CFG.HALF_W;
    if (Math.abs(b.x) > L + CFG.BALL_R * 0.5) {
      if (Math.abs(b.y) < CFG.GOAL_HALF_W && b.z < CFG.GOAL_H) { this.goalScored(b.x > 0 ? 1 : -1); return; }
      const side = U.sign(b.x);
      const defTeam = this.teams[0].dir * side > 0 ? 1 : 0; // squadra che difende quella porta
      const lt = this.lastTouch ? this.lastTouch.team : 1 - defTeam;
      this.ev[1]++;
      if (lt === defTeam) {
        this.stats.corners[1 - defTeam]++;
        this.startRestart(RT.CORNER, 1 - defTeam, side * (L - 0.4), U.sign(b.y) * (W - 0.4));
      } else {
        this.startRestart(RT.GOALKICK, defTeam, side * (L - CFG.SIX_DEPTH), U.sign(b.y) * 5);
      }
      return;
    }
    if (Math.abs(b.y) > W + CFG.BALL_R * 0.5) {
      const lt = this.lastTouch ? this.lastTouch.team : 0;
      this.ev[1]++;
      this.startRestart(RT.THROWIN, 1 - lt, U.clamp(b.x, -L + 1, L - 1), U.sign(b.y) * W);
    }
  }

  goalScored(side) {
    const b = this.ball;
    b.inNet = true;
    b.owner = null;
    const scoring = this.teams[0].dir * side > 0 ? 0 : 1;
    const team = this.teams[scoring];
    team.score++;
    this.ev[2]++;
    this.crowd = 1;
    const lt = this.lastTouch;
    let who = lt ? lt.name : '';
    const own = lt && lt.team !== scoring;
    if (own) who += ' (autogol)';
    this.scorers.push({ team: scoring, name: who, min: Math.min(Math.floor(this.clock / 60) + 1, this.half === 1 ? 45 : 90) });
    this.setMsg('GOOOL! ' + team.name.toUpperCase() + (who ? ' - ' + who : ''), 3.2);
    this.phase = PH.GOAL;
    this.phaseT = 3.2;
    this.kickoffTeam = 1 - scoring;
    for (const p of this.all) {
      if (!p.active) continue;
      if (p.team === scoring && p.role !== 'GK') p.setState(PS.CELEBRATE, 3);
      else if (p.team !== scoring) p.setState(PS.SAD, 3);
    }
    this.goalTeam = scoring;
  }

  stepGoal(dt) {
    this.phaseT -= dt;
    this.ball.step(dt);
    const scorer = this.lastTouch;
    for (const p of this.all) {
      if (!p.active) continue;
      if (p.state === PS.CELEBRATE && scorer && p !== scorer && p.team === scorer.team) p.moveTo(scorer.x, scorer.y, dt, true);
      else if (p === scorer && p.state === PS.CELEBRATE) p.moveTo(0, U.sign(p.y || 1) * (CFG.HALF_W - 1), dt, true);
      else p.steer(0, 0, dt);
      p.update(dt);
    }
    if (this.phaseT <= 0) this.startReplay();
  }

  startReplay() {
    const frames = this.replayBuf.slice(-CFG.SNAP_HZ * 6);
    if (frames.length < 10) { this.startKickoff(this.kickoffTeam); return; }
    this.replayFrames = frames;
    this.replayT = 0;
    this.phase = PH.REPLAY;
    this.fade = 1;
  }

  stepReplay(dt) {
    this.replayT += dt * 0.7;
    let skip = false;
    for (let s = 0; s < 2; s++) {
      const c = this.controllers[s];
      if (this.humans[s] && (c.pressed(K.KNOCK) || c.pressed(K.PASS) || c.pressed(K.SHOOT))) skip = true;
    }
    if (skip || this.replayT * CFG.SNAP_HZ >= this.replayFrames.length - 1) {
      this.replayFrames = null;
      this.startKickoff(this.kickoffTeam);
    }
  }

  // ---------- Calci piazzati ----------
  startKickoff(team) {
    this.kickoffTeam = team;
    this.startRestart(RT.KICKOFF, team, 0, 0);
  }

  startRestart(type, team, x, y) {
    const b = this.ball;
    b.reset(x, y);
    b.intended = null;
    this.offsideList = [];
    this.phase = PH.RESTART;
    this.restart = { type, team, x, y, t: 0, taker: null, wait: U.rand(0.9, 1.6) + this.diff.react, aimed: false };
    this.queued = [null, null];
    for (const p of this.all) {
      if (!p.active) continue;
      p.setState(PS.RUN, 0);
      p.holding = false;
      p.skillT = 0;
      p.vx *= 0.3; p.vy *= 0.3;
    }
    if (type !== RT.THROWIN) this.fade = 1;
    if (type !== RT.KICKOFF) this.setMsg(RT_NAMES[type] + ' - ' + this.teams[team].name, 1.8);
    else this.setMsg(this.half === 1 && this.clock === 0 ? 'CALCIO D\'INIZIO' : RT_NAMES[0], 1.6);

    const taker = AI.chooseTaker(this, type, team, x, y);
    this.restart.taker = taker;

    // Posiziona tutti (tranne la rimessa laterale, dove gli altri continuano a muoversi)
    for (const p of this.all) {
      if (!p.active || p === taker) continue;
      if (type === RT.THROWIN) continue;
      const tg = AI.setPieceTarget(this, p);
      p.x = tg.x + U.rand(-0.4, 0.4); p.y = tg.y + U.rand(-0.4, 0.4);
      p.vx = p.vy = 0;
      p.faceTo(x, y);
    }
    this.placeTaker();
    this.enforceDistance();
    // Il giocatore umano controlla il battitore se tocca a lui, altrimenti il piu' vicino alla palla
    for (let s = 0; s < 2; s++) {
      if (!this.humans[s]) continue;
      if (s === team) this.setHuman(s, taker);
      else this.setHuman(s, this.nearestTo(s, x, y, true));
    }
    b.owner = taker;
    taker.holding = type === RT.THROWIN || false;
    if (type === RT.THROWIN) taker.setState(PS.THROW, 999);
  }

  placeTaker() {
    const r = this.restart, p = r.taker, b = this.ball;
    let ang;
    if (r.type === RT.THROWIN) ang = r.y > 0 ? -Math.PI / 2 : Math.PI / 2;
    else if (r.type === RT.CORNER) ang = Math.atan2(-r.y, -r.x * 0.3 + (this.goalX(r.team) - r.x));
    else if (r.type === RT.GOALKICK) ang = this.dir(r.team) > 0 ? 0 : Math.PI;
    else if (r.type === RT.KICKOFF) ang = Math.PI / 2 * (r.team === 0 ? 1 : -1);
    else ang = Math.atan2(-r.y, this.goalX(r.team) - r.x);
    if (r.aimAng == null) r.aimAng = ang;
    p.facing = r.aimAng;
    if (r.type === RT.THROWIN) {
      p.x = r.x; p.y = r.y + (r.y > 0 ? 0.15 : -0.15);
      b.x = p.x; b.y = r.y - U.sign(r.y) * 0.25; b.z = 2.0;
    } else {
      p.x = r.x - Math.cos(r.aimAng) * 0.55;
      p.y = r.y - Math.sin(r.aimAng) * 0.55;
      b.x = r.x; b.y = r.y; b.z = 0;
    }
    p.vx = p.vy = 0;
  }

  enforceDistance() {
    const r = this.restart;
    const rad = r.type === RT.THROWIN ? 2 : CFG.CIRCLE_R;
    for (const p of this.teams[1 - r.team].players) {
      if (!p.active) continue;
      if (r.type === RT.PENALTY && p.role === 'GK') continue;
      const dx = p.x - r.x, dy = p.y - r.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < rad) {
        const k = d > 0.01 ? rad / d : 0;
        if (k) { p.x = r.x + dx * k; p.y = r.y + dy * k; }
        else { p.x = r.x - this.dir(r.team) * rad; }
      }
    }
    if (r.type === RT.KICKOFF) {
      // Tutti nella propria meta' campo
      for (const p of this.all) {
        if (!p.active || p === r.taker) continue;
        if (this.rx(p.team, p.x) > -0.5) p.x = -this.dir(p.team) * 0.5;
      }
    }
  }

  stepRestart(dt) {
    const r = this.restart;
    r.t += dt;
    if (r.type !== RT.KICKOFF || this.clock > 0) this.advanceClock(dt);
    if (this.phase !== PH.RESTART) return;
    if (r.t > 0.5 && !r.whistled) {
      r.whistled = true;
      if (r.type === RT.KICKOFF || r.type === RT.PENALTY || r.type === RT.FREEKICK) this.ev[1]++;
    }
    this.computeIntercepts();
    const taker = r.taker;
    // Movimento umano dei giocatori non battitori
    for (let s = 0; s < 2; s++) {
      if (!this.humans[s]) continue;
      const p = this.humanP[s];
      const c = this.controllers[s];
      if (s === r.team && p === taker) {
        const d = c.dir();
        if (d.any && r.type !== RT.PENALTY) {
          const want = Math.atan2(d.y, d.x);
          r.aimAng += U.clamp(U.angleDiff(r.aimAng, want), -4 * dt, 4 * dt);
          r.aimed = true;
        }
        this.updateCharge(s);
        if (r.t > 0.6) {
          for (const kb of CHARGE_KEYS) {
            if (c.released(kb)) { this.restartKick(CHARGE_KIND[kb], c.aim(), c.releasedHold(kb) / MAX_CHARGE); return; }
          }
        }
      } else if (p) {
        if (c.pressed(K.SWITCH)) this.switchPlayer(s);
        this.moveHuman(s, this.humanP[s], dt, false);
      }
    }
    // IA
    AI.update(this, dt);
    if (!this.humans[r.team] && r.t > r.wait) {
      AI.takeRestart(this);
      if (this.phase !== PH.RESTART) return;
    }
    for (const p of this.all) if (p.active) p.update(dt);
    this.separate();
    this.placeTaker();
    if (r.type === RT.KICKOFF || r.type === RT.PENALTY) this.enforceDistance();
    else if (r.t < 0.1) this.enforceDistance();
    else this.pushAwayOpponents();
  }

  pushAwayOpponents() {
    const r = this.restart;
    const rad = r.type === RT.THROWIN ? 2 : CFG.CIRCLE_R;
    for (const p of this.teams[1 - r.team].players) {
      if (!p.active) continue;
      const dx = p.x - r.x, dy = p.y - r.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < rad && d > 0.01) { p.x = r.x + (dx / d) * rad; p.y = r.y + (dy / d) * rad; }
    }
  }

  // Calcio del battitore: kind come i tasti (1 passaggio, 2 tiro, 3 filtrante, 4 lancio, 5 a giro, 6 pallonetto)
  restartKick(kind, aim, power) {
    const r = this.restart;
    const p = r.taker;
    p.setState(PS.RUN, 0);
    p.holding = false;
    this.phase = PH.PLAY;
    this.ball.owner = p;
    const aimDir = { x: Math.cos(r.aimAng), y: Math.sin(r.aimAng), any: true };
    if (r.type === RT.THROWIN) {
      const q = this.findPassTarget(p, aimDir, 'ground');
      if (q && U.dist(q.x, q.y, p.x, p.y) < (kind === 4 ? 30 : 20)) this.doPassTo(p, 'throw', q, null, power);
      else this.doPassTo(p, 'throw', null, this.pointAhead(p, aimDir, kind === 4 ? 22 : 12), power);
      this.offsideList = [];
    } else if (r.type === RT.PENALTY) {
      const k = this.keeper(1 - r.team);
      AI.penaltyKeeper(this, k);
      this.doShoot(p, kind === 5 ? 'finesse' : kind === 6 ? 'chip' : 'normal', aim, power);
    } else if (kind === 2 || kind === 5 || kind === 6) {
      this.doShoot(p, kind === 5 ? 'finesse' : kind === 6 ? 'chip' : 'normal', aim && (aim.any || aim.goalY != null) ? aim : aimDir, power);
    } else {
      this.humanPass(p, kind === 4 ? 'lob' : kind === 3 ? 'through' : 'ground', aimDir, power);
    }
    if (r.type === RT.CORNER || r.type === RT.GOALKICK) this.offsideList = [];
    p.kickCd = 0.5;
    this.charge = [0, 0];
  }

  // ---------- Controllo umano ----------
  setHuman(s, p) {
    const old = this.humanP[s];
    if (old === p) return;
    if (old) old.human = -1;
    if (old) { old.shield = false; old.jockey = false; old.sprinting = false; }
    this.humanP[s] = p;
    if (p) p.human = s;
  }

  nearestTo(t, x, y, noKeeper, exclude) {
    let best = null, bd = 1e9;
    for (const p of this.teams[t].players) {
      if (!p.active || p === exclude) continue;
      if (noKeeper && p.role === 'GK') continue;
      const d = U.dist(p.x, p.y, x, y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  switchPlayer(s) {
    const b = this.ball;
    const cur = this.humanP[s];
    const c = this.controllers[s];
    const dir = c.dir();
    let tx = b.x, ty = b.y;
    if (!b.owner && this.ballPath) { const bp = this.icBest[s]; if (bp) { tx = bp.icX; ty = bp.icY; } }
    let best = null, bs = 1e9;
    for (const p of this.teams[s].players) {
      if (!p.active || p === cur || p.role === 'GK') continue;
      let score = U.dist(p.x, p.y, tx, ty);
      if (dir.any && cur) {
        const dx = p.x - cur.x, dy = p.y - cur.y, dl = Math.sqrt(dx * dx + dy * dy) || 1;
        score -= ((dx * dir.x + dy * dir.y) / dl) * 8;
      }
      if (score < bs) { bs = score; best = p; }
    }
    if (best) { this.setHuman(s, best); this.switchCd[s] = 0.6; }
  }

  updateCharge(s) {
    const c = this.controllers[s];
    let ch = 0, kind = 0;
    for (const kb of CHARGE_KEYS) {
      if (c.held(kb) && c.holdTime(kb) > ch) { ch = c.holdTime(kb); kind = CHARGE_KIND[kb]; }
    }
    this.charge[s] = Math.min(1, ch / MAX_CHARGE);
    this.chargeKind[s] = kind;
    // Anteprima del compagno che ricevera' il passaggio
    const p = this.humanP[s];
    const pk = kind === 1 ? 'ground' : kind === 3 ? 'through' : kind === 4 ? 'lob' : null;
    this.passPreview[s] = p && pk && this.ball.owner === p ? this.findPassTarget(p, c.aim(), pk) : null;
  }

  autoSwitch(s, dt) {
    const b = this.ball;
    this.switchCd[s] -= dt;
    const cur = this.humanP[s];
    if (b.owner && b.owner.team === s && b.owner !== cur) { this.setHuman(s, b.owner); return; }
    if (!b.owner && b.intended && b.intended.team === s && b.intended !== cur) { this.setHuman(s, b.intended); return; }
    if (!cur || !cur.active) { this.setHuman(s, this.nearestTo(s, b.x, b.y, true)); return; }
    // Il portiere torna all'IA appena non ha piu' la palla (cosi' puo' tuffarsi)
    if (cur.role === 'GK' && b.owner !== cur) { this.setHuman(s, this.nearestTo(s, b.x, b.y, true)); return; }
    // Palla vagante calciata dagli avversari: passa al compagno che arriva prima
    if (!b.owner && this.switchCd[s] <= 0 && this.lastTouch && this.lastTouch.team !== s) {
      const best = this.icBest[s];
      if (best && best !== cur && best.role !== 'GK' && best.icT + 0.7 < cur.icT) {
        this.setHuman(s, best);
        this.switchCd[s] = 0.8;
      }
    }
    // Possesso avversario e giocatore controllato lontanissimo: avvicina il controllo
    if (b.owner && b.owner.team !== s && this.switchCd[s] <= 0) {
      const dc = U.dist(cur.x, cur.y, b.x, b.y);
      if (dc > 28) {
        const n = this.nearestTo(s, b.x, b.y, true);
        if (n && n !== cur && U.dist(n.x, n.y, b.x, b.y) + 12 < dc) { this.setHuman(s, n); this.switchCd[s] = 1.5; }
      }
    }
  }

  moveHuman(s, p, dt, play) {
    if (!p || p.busy) return;
    const c = this.controllers[s];
    const d = c.dir();
    const b = this.ball;
    const carrier = b.owner === p;
    const opp = b.owner && b.owner.team !== s ? b.owner : null;
    p.sprinting = c.held(K.SPRINT);
    p.shield = carrier && c.held(K.SHIELD);
    p.jockey = play && !!opp && c.held(K.SHIELD) && U.dist(p.x, p.y, opp.x, opp.y) < 9;
    if (p.skillT > 0) {
      p.skillT -= dt;
      const sp = 8.2;
      p.steer(Math.cos(p.skillDir) * sp, Math.sin(p.skillDir) * sp, dt, 3);
      return;
    }
    let sp = p.maxSpeed();
    if (carrier) sp *= CFG.DRIBBLE_SLOW + p.attr.dribble * 0.08;
    if (p.holding) sp = Math.min(sp, 3);
    if (d.any) p.steer(d.x * sp, d.y * sp, dt, carrier ? 0.85 : 1);
    else p.steer(0, 0, dt, 0.8);
    if (p.jockey) p.facing = Math.atan2(opp.y - p.y, opp.x - p.x);
    else if (carrier && d.any) {
      // con la palla la direzione segue i tasti in modo piu' reattivo
      const want = Math.atan2(d.y, d.x);
      p.facing += U.clamp(U.angleDiff(p.facing, want), -14 * dt, 14 * dt);
    }
  }

  updateHuman(s, dt) {
    this.autoSwitch(s, dt);
    let p = this.humanP[s];
    if (!p) return;
    const c = this.controllers[s];
    const b = this.ball;
    const carrier = b.owner === p;
    const oppHas = b.owner && b.owner.team !== s;
    const defending = oppHas || (!b.owner && this.lastTouch && this.lastTouch.team !== s && !(b.intended && b.intended.team === s) && U.dist(p.x, p.y, b.x, b.y) > 2.5);

    if (c.pressed(K.SWITCH) && !carrier) this.switchPlayer(s);
    const hp = this.humanP[s];
    this.passPreview[s] = null;
    // Se il passaggio e' per te e non tocchi le frecce, il giocatore va incontro alla palla da solo
    if (!b.owner && b.intended === hp && !c.dir().any && !hp.busy) AI.goToBall(this, hp, dt);
    else this.moveHuman(s, hp, dt, true);
    if (hp.busy) { this.charge[s] = 0; return; }
    p = hp;

    if (defending) {
      this.charge[s] = 0;
      if (c.pressed(K.PASS)) this.standingTackle(hp);
      if (c.pressed(K.SHOOT)) this.slideTackle(hp, c.dir());
      if (c.held(K.THROUGH)) this.teams[s].press = true;
      if (c.held(K.LOB)) this.teams[s].keeperRush = true;
      return;
    }
    this.updateCharge(s);
    if (carrier) {
      if (c.pressed(K.KNOCK) && !p.holding) { this.knockOn(p, c.dir()); return; }
      if (c.pressed(K.SKILL) && !p.holding) { this.skillMove(p, c.dir()); return; }
      for (const kb of CHARGE_KEYS) {
        if (c.released(kb)) {
          this.execAction(p, CHARGE_KIND[kb], c.aim(), c.releasedHold(kb) / MAX_CHARGE);
          this.charge[s] = 0;
          return;
        }
      }
    } else {
      // Senza palla: azione di prima in coda (scatta appena arriva il pallone)
      for (const kb of CHARGE_KEYS) {
        if (c.released(kb)) {
          this.queued[s] = { kind: CHARGE_KIND[kb], aim: c.aim(), power: c.releasedHold(kb) / MAX_CHARGE, t: this.time };
          this.charge[s] = 0;
        }
      }
      // Palla vagante vicinissima e in aria: colpo di testa / al volo gestito in touch()
    }
  }

  // ---------- Intercetti ----------
  computeIntercepts() {
    const b = this.ball;
    this.icBest = [null, null];
    if (b.owner) {
      this.ballPath = null;
      for (const p of this.all) {
        if (!p.active) continue;
        const d = U.dist(p.x, p.y, b.x, b.y);
        p.icT = d / CFG.SPRINT; p.icX = b.x; p.icY = b.y;
      }
    } else {
      const path = b.predict(3.2, 1 / 20);
      this.ballPath = path;
      for (const p of this.all) {
        if (!p.active) continue;
        const ms = CFG.SPRINT * (0.9 + p.attr.speed * 0.14) * 0.92;
        let found = null;
        for (const pt of path) {
          if (pt.z > 2.0) continue;
          const d = U.dist(p.x, p.y, pt.x, pt.y) - 0.5;
          if (d <= ms * Math.max(0, pt.t - 0.12)) { found = pt; break; }
        }
        if (!found) {
          const last = path[path.length - 1];
          found = { t: last.t + U.dist(p.x, p.y, last.x, last.y) / ms, x: last.x, y: last.y };
        }
        p.icT = found.t; p.icX = U.clamp(found.x, -CFG.HALF_L - 1, CFG.HALF_L + 1); p.icY = U.clamp(found.y, -CFG.HALF_W - 1, CFG.HALF_W + 1);
      }
    }
    for (let t = 0; t < 2; t++) {
      let best = null;
      for (const p of this.teams[t].players) {
        if (!p.active || p.busy) continue;
        if (!best || p.icT < best.icT) best = p;
      }
      this.icBest[t] = best;
    }
  }

  separate() {
    const ps = this.all;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i];
      if (!a.active) continue;
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j];
        if (!b.active) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 0.36 && d2 > 1e-6) {
          const d = Math.sqrt(d2), push = (0.6 - d) * 0.5;
          const nx = dx / d, ny = dy / d;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;
        }
      }
    }
  }

  // ---------- Snapshot (rendering, rete, replay) ----------
  snapshot(forReplay) {
    if (this.phase === PH.REPLAY && this.replayFrames && !forReplay) {
      const i = Math.min(this.replayFrames.length - 1, Math.floor(this.replayT * CFG.SNAP_HZ));
      const f = Object.assign({}, this.replayFrames[i]);
      f.rp = 1; f.s = [this.teams[0].score, this.teams[1].score]; f.ph = PH.REPLAY;
      f.q = ++this.seq; f.tm = this.time; f.fd = Math.round(this.fade * 100); f.m = ''; f.mt = 0;
      f.ev = this.ev.slice();
      f.hp = [-1, -1]; f.ch = [0, 0];
      return f;
    }
    const b = this.ball;
    const p = [];
    for (const pl of this.all) {
      let flags = pl.active ? 1 : 0;
      if (pl.human >= 0) flags |= (pl.human + 1) << 1;
      if (b.owner === pl) flags |= 8;
      flags |= Math.min(3, pl.yellow) << 4;
      const ph = pl.state === PS.DIVE ? Math.round(pl.diveZ * 100) : Math.round((pl.phase % 100) * 10);
      p.push(Math.round(pl.x * 100), Math.round(pl.y * 100), pl.state, ph,
        Math.round(pl.facing * 57.2958) % 360, Math.round(Math.sqrt(pl.vx * pl.vx + pl.vy * pl.vy) * 10), flags);
    }
    const hp = [0, 1].map((s) => (this.humanP[s] ? this.humanP[s].team * 11 + this.humanP[s].idx : -1));
    const st = [0, 1].map((s) => (this.humanP[s] ? Math.round(this.humanP[s].stamina * 100) : 0));
    return {
      q: forReplay ? 0 : ++this.seq,
      tm: Math.round(this.time * 1000) / 1000,
      ph: this.phase,
      rt: this.restart ? this.restart.type : -1,
      rtm: this.restart ? this.restart.team : -1,
      c: Math.floor(this.clock),
      h: this.half,
      ad: this.added,
      s: [this.teams[0].score, this.teams[1].score],
      b: [Math.round(b.x * 100), Math.round(b.y * 100), Math.round(b.z * 100), Math.round(b.rot * 100) % 62832],
      p,
      hp,
      ch: [Math.round(this.charge[0] * 100), Math.round(this.charge[1] * 100)],
      ck: this.chargeKind.slice(),
      st,
      m: this.msgT > 0 ? this.msg : '',
      mt: this.msgT > 0 ? Math.round(Math.min(1, this.msgT * 2) * 100) : 0,
      ev: this.ev.slice(),
      cr: Math.round(this.crowd * 100),
      fd: Math.round(this.fade * 100),
      rp: 0,
      me: [this.teams[0].mentality, this.teams[1].mentality],
      pt: [0, 1].map((s) => {
        const q = this.passPreview[s] || (this.humans[s] && b.intended && b.intended.team === s ? b.intended : null);
        return q ? q.team * 11 + q.idx : -1;
      }),
      dr: this.teams[0].dir,
    };
  }

  // Informazioni statiche per il disegno (inviate una volta al secondo giocatore).
  info() {
    return {
      teams: this.teams.map((t) => ({
        name: t.name, kit: t.kitIndex, keeperKit: t.keeperKit,
        players: t.players.map((p) => ({ n: p.name, no: p.number, sk: p.skin, gk: p.role === 'GK' })),
      })),
      halfMinutes: this.opts.halfMinutes,
    };
  }

  summary() {
    const tot = this.stats.possession[0] + this.stats.possession[1] || 1;
    return {
      names: [this.teams[0].name, this.teams[1].name],
      score: [this.teams[0].score, this.teams[1].score],
      scorers: this.scorers,
      shots: this.stats.shots, onTarget: this.stats.onTarget, fouls: this.stats.fouls,
      corners: this.stats.corners, offsides: this.stats.offsides,
      possession: [Math.round((this.stats.possession[0] / tot) * 100), Math.round((this.stats.possession[1] / tot) * 100)],
    };
  }
}

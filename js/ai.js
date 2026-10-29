// Intelligenza artificiale: schieramento di squadra, pressing, marcature, scelte del portatore, portiere, calci piazzati.
'use strict';

const AI = {
  update(m, dt) {
    const b = m.ball;
    for (let t = 0; t < 2; t++) {
      const team = m.teams[t];
      if (!m.humans[t]) {
        // Mentalita' della CPU: si sbilancia se perde nel finale
        const diff = team.score - m.teams[1 - t].score;
        const late = m.half === 2 && m.clock > 4500;
        team.mentality = late ? (diff < 0 ? 1 : diff > 0 ? -1 : 0) : 0;
      }
      if (m.phase === PH.RESTART) { this.restartMovement(m, t, dt); continue; }

      const opp = 1 - t;
      const carrier = b.owner;
      let presser = null, container = null, chaser = null, supporter = null;
      const eligible = team.players.filter((p) => p.active && p.human < 0 && p.role !== 'GK' && !p.busy);
      const human = m.humanP[t];

      if (carrier && carrier.team === opp) {
        const sorted = eligible.slice().sort((a, c) => this.goalSideDist(m, a, carrier) - this.goalSideDist(m, c, carrier));
        if (m.humans[t]) {
          const hd = human ? U.dist(human.x, human.y, carrier.x, carrier.y) : 99;
          if (team.press) presser = sorted[0];
          else if (hd > 6 && sorted[0]) container = sorted[0];
        } else {
          presser = sorted[0];
          if (sorted[1] && U.dist(sorted[1].x, sorted[1].y, carrier.x, carrier.y) < 15) container = sorted[1];
        }
      } else if (carrier && carrier.team === t) {
        // Il compagno piu' vicino si propone per un appoggio sicuro
        let bd = 22;
        for (const q of eligible) {
          if (q === carrier) continue;
          const d = U.dist(q.x, q.y, carrier.x, carrier.y);
          if (d < bd) { bd = d; supporter = q; }
        }
      } else if (!carrier) {
        const ib = m.icBest[t];
        const intendedOurs = b.intended && b.intended.team === t;
        if (!intendedOurs && ib && ib.human < 0 && ib.role !== 'GK') chaser = ib;
        if (intendedOurs && b.intended.human < 0) chaser = null;
      }

      for (const p of team.players) {
        if (!p.active || p.human >= 0 || p.busy) continue;
        p.shield = false; p.jockey = false;
        if (p.role === 'GK') { this.keeper(m, p, dt); continue; }
        if (carrier === p) { this.carrier(m, p, dt); continue; }
        if (!carrier && b.intended === p) { this.goToBall(m, p, dt); continue; }
        if (p === chaser) { this.goToBall(m, p, dt); this.tryLooseTackle(m, p); continue; }
        if (p === presser) { this.press(m, p, carrier, dt, true); continue; }
        if (p === container) { this.press(m, p, carrier, dt, false); continue; }
        if (p === supporter) {
          p.supT = (p.supT || 0) - dt;
          if (p.supT <= 0 || !p.sup) { p.supT = 0.5; p.sup = this.supportSpot(m, p, carrier); }
          p.moveTo(p.sup.x, p.sup.y, dt, U.dist(p.x, p.y, p.sup.x, p.sup.y) > 6);
          continue;
        }
        if (p.gaT > 0) p.gaT -= dt;
        const tg = this.fieldTarget(m, p, m.possTeam() === t);
        const d = U.dist(p.x, p.y, tg.x, tg.y);
        p.moveTo(tg.x, tg.y, dt, d > 9 || (p.runT > 0));
        if (p.runT > 0) p.runT -= dt;
      }
    }
  },

  // Corre sul punto d'intercetto; da vicino attacca direttamente la palla.
  goToBall(m, p, dt) {
    const b = m.ball;
    const d = U.dist(p.x, p.y, b.x, b.y);
    if (d < 3.5 && b.z < 1.5) {
      const tx = b.x + b.vx * 0.12, ty = b.y + b.vy * 0.12;
      const dx = tx - p.x, dy = ty - p.y, l = Math.sqrt(dx * dx + dy * dy) || 1;
      const sp = p.maxSpeed();
      p.sprinting = true;
      p.steer((dx / l) * sp, (dy / l) * sp, dt, 1.5);
    } else {
      p.moveTo(p.icX, p.icY, dt, true);
      // non fermarsi sul punto: andare incontro alla palla
      if (U.dist(p.x, p.y, p.icX, p.icY) < 1) p.steer((b.x - p.x) * 1.5, (b.y - p.y) * 1.5, dt);
    }
  },

  // Distanza "pesata" per scegliere chi pressa: preferisce chi sta tra palla e porta.
  goalSideDist(m, p, c) {
    const d = U.dist(p.x, p.y, c.x, c.y);
    const behind = m.rx(p.team, p.x) > m.rx(p.team, c.x) + 1;
    return d + (behind ? 6 : 0);
  },

  tryLooseTackle(m, p) {
    const b = m.ball;
    if (b.owner || b.z > 0.6) return;
    const o = m.icBest[1 - p.team];
    if (o && U.dist(p.x, p.y, b.x, b.y) < 2.2 && U.dist(o.x, o.y, b.x, b.y) < 1.2 && Math.random() < 0.02 * m.diff.aggr) {
      m.slideTackle(p, { x: b.x - p.x, y: b.y - p.y, any: true });
    }
  },

  press(m, p, c, dt, tackle) {
    const gx = m.ownGoalX(p.team);
    const dx = gx - c.x, dy = -c.y;
    const dl = Math.sqrt(dx * dx + dy * dy) || 1;
    const dist = U.dist(p.x, p.y, c.x, c.y);
    if (tackle) {
      // Avvicinamento dal lato porta, poi contrasto
      const off = Math.min(1.1, dist * 0.3);
      const tx = c.x + c.vx * 0.25 + (dx / dl) * off, ty = c.y + c.vy * 0.25 + (dy / dl) * off;
      p.moveTo(tx, ty, dt, dist > 3);
      if (dist < 1.5 && p.tackleCd <= 0) {
        const human = m.humans[p.team];
        const rate = human ? 0.06 : 0.015 + m.diff.aggr * 0.035;
        if (Math.random() < rate) m.standingTackle(p);
      } else if (!m.humans[p.team] && dist < 2.6 && dist > 1.3 && Math.random() < 0.004 * m.diff.aggr) {
        const toB = { x: m.ball.x - p.x, y: m.ball.y - p.y, any: true };
        m.slideTackle(p, toB);
      }
    } else {
      const off = 3.2;
      const tx = c.x + (dx / dl) * off, ty = c.y + (dy / dl) * off;
      p.moveTo(tx, ty, dt, U.dist(p.x, p.y, tx, ty) > 4);
      p.jockey = dist < 5;
    }
  },

  fieldTarget(m, p, attacking) {
    const t = p.team, dir = m.dir(t);
    const team = m.teams[t];
    const b = m.ball;
    const brx = m.rx(t, b.x);
    const [bx, byy] = p.base;
    const ment = team.mentality;
    let rx;
    if (attacking) rx = bx * 0.62 + brx * 0.5 + 12 + ment * 4;
    else rx = bx * 0.55 + brx * 0.5 - 2 + ment * 4;
    if (p.role === 'DF') {
      if (attacking) rx = Math.min(rx, brx - 4, 22);
      else rx = Math.min(rx, brx - 3);
    } else if (p.role === 'MF' && !attacking) {
      rx = Math.min(rx, brx + 3);
    } else if (p.role === 'FW' && !attacking) {
      rx = Math.max(rx, -18);
    }
    let wy = byy * dir * (attacking ? 1.05 : 0.72) + b.y * 0.32;
    // Palla nella trequarti: attaccanti e un centrocampista attaccano l'area
    // In attacco le punte restano almeno all'altezza della palla, le mezzali poco dietro
    if (attacking && p.role === 'FW') rx = Math.max(rx, brx + 2);
    if (attacking && p.role === 'MF') rx = Math.max(rx, brx - 8);
    if (attacking && brx > 20 && (p.role === 'FW' || (p.role === 'MF' && Math.abs(byy) < 10))) {
      const slot = p.role === 'FW' ? (p.idx % 3) : 3 + (p.idx % 2);
      const spots = [[-8, -4], [-6, 3.5], [-11, 0], [-17, -5], [-16, 6]];
      const sp = spots[slot];
      rx = CFG.HALF_L + sp[0];
      wy = sp[1] * dir + b.y * 0.15;
    }
    let limit = 99;
    if (attacking && p.role !== 'DF') {
      const line = m.offsideLineFor(t);
      limit = Math.max(line, brx) - 0.5;
      // dai e vai: scatto in avanti restando in linea
      if (p.gaT > 0) rx = Math.max(rx, Math.min(m.rx(t, p.x) + 10, limit));
      if (p.runT > 0) { rx = Math.min(line + 9, CFG.HALF_L - 6); limit = 99; }
      else rx = Math.min(rx, limit);
      // Ogni tanto un attaccante attacca la profondita'
      if (p.role === 'FW' && p.runT <= 0 && brx > -15 && Math.random() < 0.012) p.runT = 1.6;
    }
    rx = U.clamp(rx, -CFG.HALF_L + 4, CFG.HALF_L - 3);
    let x = rx * dir, y = U.clamp(wy, -CFG.HALF_W + 1.5, CFG.HALF_W - 1.5);

    if (attacking && b.owner && b.owner.team === t && b.owner !== p) {
      // Smarcarsi: lontano dai difensori e fuori dalle linee di passaggio coperte
      const c = b.owner;
      for (const o of m.teams[1 - t].players) {
        if (!o.active) continue;
        const d = U.dist(o.x, o.y, x, y);
        if (d < 5 && d > 0.01) { x += ((x - o.x) / d) * (5 - d) * 0.7; y += ((y - o.y) / d) * (5 - d) * 0.7; }
        const sd = U.segDist(o.x, o.y, c.x, c.y, x, y);
        if (sd.d < 1.8 && sd.t > 0.15 && sd.t < 0.92) {
          const lx = x - c.x, ly = y - c.y, ll = Math.sqrt(lx * lx + ly * ly) || 1;
          let nx = -ly / ll, ny = lx / ll;
          if ((o.x - c.x) * nx + (o.y - c.y) * ny > 0) { nx = -nx; ny = -ny; }
          const k = (1.8 - sd.d) * 1.6 + 1.2;
          x += nx * k; y += ny * k;
        }
      }
      const rx2 = Math.min(m.rx(t, x), limit);
      x = U.clamp(rx2, -CFG.HALF_L + 4, CFG.HALF_L - 3) * dir;
      y = U.clamp(y, -CFG.HALF_W + 1.5, CFG.HALF_W - 1.5);
    }

    if (!attacking && p.role !== 'FW') {
      // Marcatura dell'avversario piu' vicino alla zona, dal lato della porta
      let mk = null, md = 11;
      for (const o of m.teams[1 - t].players) {
        if (!o.active || o === b.owner) continue;
        const d = U.dist(o.x, o.y, x, y);
        if (d < md) { md = d; mk = o; }
      }
      if (mk) {
        const gx = m.ownGoalX(t);
        const dx = gx - mk.x, dy = -mk.y, dl = Math.sqrt(dx * dx + dy * dy) || 1;
        const mx = mk.x + (dx / dl) * 1.8, my = mk.y + (dy / dl) * 1.8;
        x = U.lerp(x, mx, 0.65); y = U.lerp(y, my, 0.65);
      }
    }
    return { x, y };
  },

  // Punto di appoggio attorno al portatore: linea di passaggio libera, spazio, un po' in avanti.
  supportSpot(m, p, c) {
    const t = p.team, dir = m.dir(t);
    const line = m.offsideLineFor(t);
    let best = null, bs = -99;
    for (let a = -110; a <= 110; a += 22) {
      for (const r of [9, 13]) {
        const ang = (a * Math.PI) / 180;
        const x = c.x + Math.cos(ang) * r * dir;
        const y = c.y + Math.sin(ang) * r;
        if (Math.abs(y) > CFG.HALF_W - 2 || Math.abs(x) > CFG.HALF_L - 3) continue;
        const rx = m.rx(t, x);
        if (rx > line - 0.5 && rx > m.rx(t, c.x)) continue; // niente fuorigioco
        const safety = this.laneSafety(m, c, x, y, 'ground');
        let open = 8;
        for (const o of m.teams[1 - t].players) if (o.active) open = Math.min(open, U.dist(o.x, o.y, x, y));
        const sc = safety * 1.2 + (open / 8) * 0.8 + ((rx - m.rx(t, c.x)) / 13) * 0.35 - U.dist(p.x, p.y, x, y) * 0.02;
        if (sc > bs) { bs = sc; best = { x, y }; }
      }
    }
    return best || { x: p.x, y: p.y };
  },

  // ---------- Portatore di palla ----------
  carrier(m, p, dt) {
    if (p.holding) return;
    if (p.skillT > 0) {
      p.skillT -= dt;
      p.steer(Math.cos(p.skillDir) * 8, Math.sin(p.skillDir) * 8, dt, 3);
      return;
    }
    p.thinkT -= dt * (1 + m.pressure(p));
    if (p.dribX == null) { const d0 = this.evalDribble(m, p); p.dribX = d0.x; p.dribY = d0.y; p.dribSprint = d0.sprint; }
    if (p.thinkT <= 0) {
      p.thinkT = m.diff.think * U.rand(0.7, 1.3);
      if (this.decide(m, p)) return;
    }
    const d = U.dist(p.x, p.y, p.dribX, p.dribY);
    const sp = p.maxSpeed() * (CFG.DRIBBLE_SLOW + p.attr.dribble * 0.08);
    p.sprinting = p.dribSprint;
    if (d > 0.3) p.steer(((p.dribX - p.x) / d) * sp, ((p.dribY - p.y) / d) * sp, dt, 0.9);
  },

  decide(m, p) {
    const t = p.team, dir = m.dir(t);
    const gx = m.goalX(t);
    const prx = m.rx(t, p.x);
    const pr = m.pressure(p);

    // 1) Tiro
    const shot = this.evalShot(m, p);
    // 2) Passaggi
    const pass = this.bestPass(m, p);
    // 3) Dribbling
    const drib = this.evalDribble(m, p);

    let shotScore = shot ? shot.score : -9;
    let passScore = pass ? pass.score : -9;
    let dribScore = drib.score;
    // Rinvio di sicurezza sotto pressione vicino alla propria area
    if (prx < -CFG.HALF_L + 22 && pr > 0.6 && passScore < 0.3) {
      const ang = Math.atan2(U.rand(-0.6, 0.6), dir);
      m.doPassTo(p, 'lob', null, { x: p.x + Math.cos(ang) * 40, y: U.clamp(p.y + Math.sin(ang) * 40, -30, 30) }, 0.9);
      return true;
    }
    const noise = () => U.gauss() * 0.12 * (1.4 - m.diff.acc);
    shotScore += noise(); passScore += noise(); dribScore += noise();

    const dGoal = U.dist(p.x, p.y, gx, 0);
    const shootMin = dGoal < 18 ? 0.3 : 0.42;
    if (shotScore > shootMin && (shotScore >= passScore * 0.7 || dGoal < 15)) {
      m.doShoot(p, shot.kind, { goalY: shot.gy }, shot.power);
      return true;
    }
    // Con spazio davanti si conduce palla invece di passarla subito
    const margin = drib.space > 7 && pr < 0.3 ? 0.25 : 0.05;
    if (passScore > dribScore + margin && pass) {
      m.doPassTo(p, pass.kind, pass.recv, pass.point || null, pass.power);
      return true;
    }
    // Cross dal fondo verso l'area
    if (prx > CFG.HALF_L - 20 && Math.abs(p.y) > 13) {
      const inBox = m.teams[t].players.filter((q) => q.active && q !== p && m.rx(t, q.x) > CFG.HALF_L - 18 && Math.abs(q.y) < 13);
      const crossScore = 0.35 + inBox.length * 0.15 + (prx > CFG.HALF_L - 10 ? 0.25 : 0) + pr * 0.2;
      if (crossScore > Math.max(passScore, dribScore) && inBox.length) {
        const q = U.pick(inBox);
        m.doPassTo(p, 'lob', null, { x: q.x + q.vx * 0.9 + dir * U.rand(-1, 2), y: q.y + U.rand(-2, 2) * 0.5 }, 0.5);
        return true;
      }
    }
    // Finta se un avversario e' proprio davanti
    if (drib.blocker && Math.random() < 0.18 + p.attr.dribble * 0.25) {
      const side = U.sign(Math.random() - 0.5);
      const a = Math.atan2(drib.dy, drib.dx) + side * 1.2;
      m.skillMove(p, { x: Math.cos(a), y: Math.sin(a), any: true });
      return true;
    }
    p.dribX = drib.x; p.dribY = drib.y; p.dribSprint = drib.sprint;
    // Allungo se c'e' tanto spazio
    if (drib.space > 12 && p.attr.speed > 0.7 && Math.random() < 0.1 && prx < CFG.HALF_L - 20) {
      m.knockOn(p, { x: drib.dx, y: drib.dy, any: true });
      return true;
    }
    return false;
  },

  evalShot(m, p) {
    const t = p.team;
    const gx = m.goalX(t);
    const d = U.dist(p.x, p.y, gx, 0);
    if (d > 31) return null;
    const G = CFG.GOAL_HALF_W;
    const a1 = Math.atan2(-G - p.y, gx - p.x), a2 = Math.atan2(G - p.y, gx - p.x);
    const width = Math.abs(U.angleDiff(a1, a2));
    const k = m.keeper(1 - t);
    // Angolo meno coperto dal portiere
    const gy = (k.y > 0 ? -1 : 1) * (G - 0.55) * (Math.random() < 0.8 ? 1 : -1);
    let blockers = 0;
    for (const o of m.teams[1 - t].players) {
      if (!o.active || o.role === 'GK') continue;
      const s = U.segDist(o.x, o.y, p.x, p.y, gx, gy);
      if (s.d < 1.0 && s.t > 0.05) blockers++;
    }
    let score = Math.pow(1 - d / 31, 1.1) * 0.9 + width * 0.9 - blockers * 0.35;
    if (d < 12) score += 0.25;
    let kind = 'normal';
    const keeperOut = Math.abs(m.rx(1 - t, k.x) + CFG.HALF_L) > 6;
    if (keeperOut && d > 12 && d < 28) { kind = 'chip'; score += 0.2; }
    else if (d > 15 && Math.random() < 0.4) kind = 'finesse';
    const power = U.clamp(0.4 + d / 40, 0.45, 0.95);
    return { score, gy, kind, power };
  },

  bestPass(m, p) {
    const t = p.team;
    const prx = m.rx(t, p.x);
    const pr = m.pressure(p);
    const line = m.offsideLineFor(t);
    let best = null;
    for (const q of m.teams[t].players) {
      if (q === p || !q.active || q.busy) continue;
      if (q.role === 'GK' && pr < 0.5) continue;
      const qrx = m.rx(t, q.x);
      const offside = qrx > 0.5 && qrx > m.rx(t, m.ball.x) + 0.3 && qrx > line + 0.3;
      const opts = [];
      const lx = q.x + q.vx * 0.5, ly = q.y + q.vy * 0.5;
      const d = U.dist(p.x, p.y, lx, ly);
      if (d < 4 || d > 55) continue;
      if (!offside) {
        if (d < 38) opts.push({ kind: 'ground', x: lx, y: ly, d });
        if (d > 18) opts.push({ kind: 'lob', x: lx, y: ly, d });
      }
      // Filtrante nello spazio dietro la difesa
      if (q.role !== 'DF' && qrx > prx + 2) {
        const tp = m.throughPoint(p, q, 0.5);
        const qOff = qrx > line + 0.3 && qrx > 0.5;
        if (!qOff && tp) opts.push({ kind: 'through', x: tp.x, y: tp.y, d: U.dist(p.x, p.y, tp.x, tp.y) });
      }
      for (const o of opts) {
        const safety = this.laneSafety(m, p, o.x, o.y, o.kind);
        if (safety < (o.kind === 'through' ? -0.12 : -0.02)) continue;
        const prog = (m.rx(t, o.x) - prx) / 30;
        let open = 10;
        for (const e of m.teams[1 - t].players) {
          if (!e.active) continue;
          open = Math.min(open, U.dist(e.x, e.y, o.x, o.y));
        }
        let s = prog * 0.75 + (open / 10) * 0.45 + safety * 0.8 - o.d / 70;
        if (o.kind === 'lob') s -= open > 5 ? 0.12 : 0.4;
        if (o.kind === 'through') s += m.rx(t, o.x) > line ? 0.15 : -0.05;
        if (o.kind === 'ground' && o.d < 25) s += 0.1;
        const orx = m.rx(t, o.x);
        if (orx > CFG.HALF_L - 16 && Math.abs(o.y) < 14) s += 0.25;
        // Cross dal fondo
        if (o.kind === 'lob' && prx > CFG.HALF_L - 22 && Math.abs(p.y) > 15 && orx > CFG.HALF_L - 16) s += 0.35;
        if (prx < -20 && orx < prx) s -= 0.15;
        // Indietro solo se pressato; i lanci servono per avanzare
        if (orx < prx - 2) s -= 0.25 * (1 - pr);
        if (o.kind === 'lob' && orx < prx + 8) s -= 0.3;
        s += pr * 0.25;
        if (!best || s > best.score) {
          best = { score: s, recv: q, kind: o.kind, power: o.kind === 'through' ? 0.5 : 0.35, point: o.kind === 'through' ? { x: o.x, y: o.y } : null };
        }
      }
    }
    if (best && best.kind === 'through') best.recv.runT = 1.5;
    return best;
  },

  // Margine di tempo con cui la palla arriva prima degli avversari lungo la traiettoria.
  laneSafety(m, p, tx, ty, kind) {
    const speed = kind === 'lob' ? 20 : 13; // velocita' media reale (la palla rallenta)
    let worst = 2;
    if (kind === 'lob') {
      // Il lancio scavalca chi sta in mezzo: conta chi arriva prima nella zona di atterraggio
      const T = 0.55 + U.dist(p.x, p.y, tx, ty) / 30 + 0.15;
      for (const e of m.teams[1 - p.team].players) {
        if (!e.active) continue;
        const te = Math.max(0, U.dist(e.x, e.y, tx, ty) - 1.2) / 7 + 0.2;
        worst = Math.min(worst, te - T);
      }
      return U.clamp(worst + 0.15, -1, 1);
    }
    // Il ricevitore va incontro alla palla: l'ultimo tratto e' suo
    const dl = U.dist(p.x, p.y, tx, ty) || 1;
    const cut = Math.min(3.5, dl * 0.25);
    tx -= ((tx - p.x) / dl) * cut; ty -= ((ty - p.y) / dl) * cut;
    for (const e of m.teams[1 - p.team].players) {
      if (!e.active) continue;
      const s = U.segDist(e.x, e.y, p.x, p.y, tx, ty);
      const tb = (s.t * U.dist(p.x, p.y, tx, ty)) / speed;
      const te = Math.max(0, s.d - 0.6) / 7 + 0.15;
      worst = Math.min(worst, te - tb);
    }
    return U.clamp(worst, -1, 1);
  },

  evalDribble(m, p) {
    const t = p.team, dir = m.dir(t);
    const gx = m.goalX(t);
    // Direzione: verso la porta, con correzione per evitare gli avversari
    const prx = m.rx(t, p.x);
    // In zona d'attacco punta verso il dischetto (si accentra), altrimenti avanza dritto
    const aimX = prx > 18 ? gx - dir * 11 : gx;
    let dx = aimX - p.x, dy = (0 - p.y) * (prx > 18 ? 1 : 0.12);
    let l = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= l; dy /= l;
    let ax = 0, ay = 0, space = 20, blocker = null;
    for (const o of m.teams[1 - t].players) {
      if (!o.active) continue;
      const ox = o.x - p.x, oy = o.y - p.y;
      const od = Math.sqrt(ox * ox + oy * oy);
      if (od > 9) continue;
      const ahead = (ox * dx + oy * dy) / (od || 1);
      if (ahead > 0.3) { space = Math.min(space, od); if (od < 2.2) blocker = o; }
      const w = (9 - od) / 9;
      ax -= (ox / (od || 1)) * w * 1.4; ay -= (oy / (od || 1)) * w * 1.4;
    }
    dx += ax; dy += ay;
    // Resta lontano dalle linee laterali
    if (Math.abs(p.y) > CFG.HALF_W - 4) dy -= U.sign(p.y) * 0.8;
    l = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= l; dy /= l;
    const look = 6;
    const x = U.clamp(p.x + dx * look, -CFG.HALF_L + 1, CFG.HALF_L - 1);
    const y = U.clamp(p.y + dy * look, -CFG.HALF_W + 1.5, CFG.HALF_W - 1.5);
    let score = 0.18 + Math.min(space, 15) / 15 * 0.6 - m.pressure(p) * 0.35;
    if (prx > CFG.HALF_L - 25) score -= 0.1; // vicino all'area meglio cercare il compagno o il tiro
    return { x, y, dx, dy, space, sprint: space > 6, score, blocker };
  },

  // ---------- Portiere ----------
  keeper(m, p, dt) {
    const t = p.team, dirIn = m.dir(t);
    const gx = m.ownGoalX(t);
    const b = m.ball;
    if (p.state === PS.DIVE) return;

    if (b.owner === p) {
      if (p.holding) {
        p.steer(0, 0, dt);
        if (p.holdT > 1.4 + m.diff.react && (p.human < 0 || p.holdT > 6)) this.distribute(m, p);
      } else {
        p.kickT = (p.kickT || 0) + dt;
        if (p.kickT > 0.5) { p.kickT = 0; this.distribute(m, p, true); }
      }
      return;
    }

    if (!b.owner && m.ballPath) {
      let cross = null;
      for (const pt of m.ballPath) {
        if (m.rx(t, pt.x) <= -CFG.HALF_L + 0.1) { cross = pt; break; }
      }
      const toward = m.rx(t, b.vx) < -4;
      if (cross && toward && Math.abs(cross.y) < CFG.GOAL_HALF_W + 0.9 && cross.z < CFG.GOAL_H + 0.6) {
        p.threatT = (p.threatT || 0) + dt;
        const react = m.humans[t] ? 0.18 : m.diff.react * 0.8;
        if (p.threatT < react) { p.steer(0, 0, dt); return; }
        const krx = m.rx(t, p.x);
        let tg = cross;
        for (const pt of m.ballPath) {
          if (m.rx(t, pt.x) <= krx) { tg = pt; break; }
        }
        const d = U.dist(p.x, p.y, tg.x, tg.y);
        if (d > 0.9 && tg.t < 1.1) {
          // Tuffo: velocita' e portata limitate, cosi' i tiri angolati possono entrare
          p.diveDir = Math.atan2(tg.y - p.y, tg.x - p.x);
          const sk = m.keeperSkill(t);
          const sp = Math.min(d / Math.max(tg.t, 0.12) * 1.6, (3.3 + p.attr.keeping * 1.4) * sk);
          p.vx = Math.cos(p.diveDir) * sp; p.vy = Math.sin(p.diveDir) * sp;
          p.diveZ = U.clamp(tg.z, 0.15, 1.8);
          p.facing = p.diveDir;
          p.setState(PS.DIVE, 0.9);
        } else if (tg.t < 1.1) {
          p.steer(0, 0, dt);
        } else {
          p.moveTo(tg.x, tg.y, dt, false);
        }
        return;
      }
      p.threatT = 0;
    }

    // Uscita sulla palla vagante
    const team = m.teams[t];
    const oppBest = m.icBest[1 - t];
    if (!b.owner && m.inOwnBox(t, p.icX, p.icY) && (b.z < 2.2 || p.icT < 0.8)) {
      if (!oppBest || p.icT < oppBest.icT - 0.1 || team.keeperRush) {
        p.moveTo(p.icX, p.icY, dt, true);
        return;
      }
    }
    if (b.owner && b.owner.team !== t) {
      const c = b.owner;
      const dg = U.dist(c.x, c.y, gx, 0);
      if (team.keeperRush || (dg < 15 && m.inOwnBox(t, c.x, c.y))) {
        const k = Math.max(1, Math.min(dg - 1.5, team.keeperRush ? dg : 6.5));
        const tx = gx + ((c.x - gx) / dg) * k, ty = (c.y / dg) * k;
        p.moveTo(tx, ty, dt, true);
        if (U.dist(p.x, p.y, c.x, c.y) < 1.4 && Math.random() < 0.08) m.standingTackle(p);
        return;
      }
    }
    // Posizionamento sulla bisettrice
    const dx = b.x - gx, dy = b.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    let off = U.clamp(1 + d * 0.07, 1, 5);
    if (d > 55) off = 9;
    const tx = gx + (dx / d) * off;
    const ty = U.clamp((dy / d) * off, -CFG.GOAL_HALF_W - 0.4, CFG.GOAL_HALF_W + 0.4);
    p.moveTo(tx, ty, dt, false);
    p.faceTo(b.x, b.y);
  },

  distribute(m, p, feet) {
    const t = p.team;
    let short = null, sBest = -1, long = null, lBest = -1;
    for (const q of m.teams[t].players) {
      if (q === p || !q.active) continue;
      let open = 20;
      for (const e of m.teams[1 - t].players) if (e.active) open = Math.min(open, U.dist(e.x, e.y, q.x, q.y));
      const d = U.dist(p.x, p.y, q.x, q.y);
      if (d < 32 && open > 7 && open - d * 0.1 > sBest) { sBest = open - d * 0.1; short = q; }
      if (d > 30 && (q.role === 'FW' || q.role === 'MF') && open > lBest) { lBest = open; long = q; }
    }
    p.holding = false;
    if (short && (Math.random() < 0.6 || !long)) m.doPassTo(p, feet ? 'ground' : 'throwhand', short, null, 0.4);
    else if (long) m.doPassTo(p, 'lob', long, null, 0.8);
    else m.doPassTo(p, 'lob', null, { x: p.x + m.dir(t) * 45, y: U.rand(-20, 20) }, 0.9);
  },

  penaltyKeeper(m, k) {
    const r = Math.random();
    const guess = r < 0.42 ? -1 : r < 0.58 ? 0 : 1;
    if (guess === 0) return;
    k.diveDir = guess > 0 ? Math.PI / 2 : -Math.PI / 2;
    k.vx = 0; k.vy = guess * (5 + k.attr.keeping * 1.2);
    k.diveZ = U.rand(0.3, 1.5);
    k.facing = k.diveDir;
    k.setState(PS.DIVE, 0.95);
  },

  // ---------- Calci piazzati ----------
  chooseTaker(m, type, team, x, y) {
    const ps = m.teams[team].players.filter((p) => p.active && p.role !== 'GK');
    if (type === RT.GOALKICK) return m.keeper(team);
    if (type === RT.PENALTY) return ps.slice().sort((a, b) => b.attr.shot - a.attr.shot)[0];
    if (type === RT.KICKOFF) {
      const fw = ps.filter((p) => p.role === 'FW');
      return (fw.length ? fw : ps).sort((a, b) => U.len(a.base[0], a.base[1]) - U.len(b.base[0], b.base[1]))[0];
    }
    if (type === RT.CORNER) return ps.slice().sort((a, b) => b.attr.pass - a.attr.pass)[0];
    if (type === RT.FREEKICK && U.dist(x, y, m.goalX(team), 0) < 30) return ps.slice().sort((a, b) => b.attr.shot - a.attr.shot)[0];
    return ps.slice().sort((a, b) => U.dist(a.x, a.y, x, y) - U.dist(b.x, b.y, x, y))[0];
  },

  setPieceTarget(m, p) {
    const r = m.restart;
    if (!r.arr) r.arr = this.arrange(m);
    const a = r.arr.get(p);
    if (a) return a;
    return this.fieldTarget(m, p, p.team === r.team);
  },

  restartMovement(m, t, dt) {
    const r = m.restart;
    for (const p of m.teams[t].players) {
      if (!p.active || p.human >= 0 || p === r.taker) continue;
      if (p.role === 'GK' && r.type === RT.PENALTY && t !== r.team) { p.steer(0, 0, dt); continue; }
      const tg = r.type === RT.THROWIN ? this.fieldTarget(m, p, t === r.team) : this.setPieceTarget(m, p);
      p.moveTo(tg.x, tg.y, dt, U.dist(p.x, p.y, tg.x, tg.y) > 8);
      if (U.dist(p.x, p.y, tg.x, tg.y) < 0.5) p.faceTo(m.ball.x, m.ball.y);
    }
  },

  arrange(m) {
    const r = m.restart;
    const arr = new Map();
    const att = r.team, def = 1 - att;
    const ga = m.goalX(att);                 // porta attaccata
    const dA = m.dir(att);
    const atts = m.teams[att].players.filter((p) => p.active && p !== r.taker);
    const defs = m.teams[def].players.filter((p) => p.active && p !== r.taker);
    // coordinate relative alla porta attaccata: (u = metri dalla linea verso il campo, v = laterale)
    const P = (u, v) => ({ x: ga - dA * u, y: v });

    for (const tm of [att, def]) {
      const k = m.keeper(tm);
      if (!k.active || k === r.taker) continue;
      const og = m.ownGoalX(tm);
      if (r.type === RT.PENALTY && tm === def) arr.set(k, { x: og + m.dir(tm) * 0.15, y: 0 });
      else if (r.type === RT.KICKOFF) arr.set(k, { x: og + m.dir(tm) * 2, y: 0 });
      else arr.set(k, { x: og + m.dir(tm) * (tm === def ? 0.8 : 6), y: tm === def ? U.clamp(r.y * 0.06, -1.5, 1.5) : 0 });
    }

    if (r.type === RT.KICKOFF) {
      let second = false;
      for (const tm of [att, def]) {
        for (const p of m.teams[tm].players) {
          if (!p.active || p === r.taker || p.role === 'GK') continue;
          let rx = Math.min(p.base[0] * 0.92, -1.5), ry = p.base[1];
          if (tm === att && p.role === 'FW' && !second) { second = true; rx = -1.5; ry = 5; }
          if (tm === def && U.len(rx, ry) < CFG.CIRCLE_R + 0.5) {
            const l = U.len(rx, ry) || 1;
            rx = (rx / l) * (CFG.CIRCLE_R + 0.6); ry = (ry / l) * (CFG.CIRCLE_R + 0.6);
            rx = Math.min(rx, -1);
          }
          arr.set(p, { x: rx * m.dir(tm), y: ry * m.dir(tm) });
        }
      }
      return arr;
    }

    if (r.type === RT.PENALTY) {
      let i = 0;
      for (const p of atts.concat(defs)) {
        if (arr.has(p)) continue;
        const v = -16 + (i % 9) * 4;
        const u = CFG.BOX_DEPTH + 1.5 + Math.floor(i / 9) * 2.5;
        arr.set(p, P(u, v));
        i++;
      }
      return arr;
    }

    const distGoal = U.dist(r.x, r.y, ga, 0);
    const setPlay = r.type === RT.CORNER || (r.type === RT.FREEKICK && distGoal < 34);
    if (setPlay) {
      const cs = U.sign(r.y || 1);
      const spots = r.type === RT.CORNER
        ? [[3.5, cs * 2.5], [6.5, 0], [6, -cs * 4], [10.5, cs * 1.5], [11, -cs * 5.5], [16, 0], [19, cs * 9]]
        : [[9, -4], [9, 4], [12, 0], [13, -9], [13, 9], [20, 0]];
      const order = atts.filter((p) => p.role !== 'GK').sort((a, b) => {
        const pr = (q) => (q.role === 'FW' ? 0 : q.role === 'DF' && Math.abs(q.base[1]) < 12 ? 1 : q.role === 'MF' ? 2 : 3);
        return pr(a) - pr(b);
      });
      const inBox = [];
      order.forEach((p, i) => {
        if (i < spots.length) {
          const s = spots[i];
          let pt = P(s[0], s[1]);
          // Su punizione gli attaccanti restano in linea (fuorigioco) e lontani dalla palla
          if (r.type === RT.FREEKICK) {
            const lineU = Math.max(9, CFG.HALF_L - Math.abs(r.x) - 2);
            pt = P(Math.max(s[0], lineU), s[1] * 1.4);
          }
          arr.set(p, pt); inBox.push(pt);
        } else {
          arr.set(p, { x: -dA * 8 + U.rand(-2, 2), y: (i % 2 ? 1 : -1) * 12 });
        }
      });
      // Difesa: barriera (punizione), uomo sul primo palo e marcature
      let defsLeft = defs.filter((p) => p.role !== 'GK');
      if (r.type === RT.FREEKICK) {
        const n = distGoal < 23 ? 4 : 3;
        const ang = Math.atan2(0 - r.y, ga - r.x);
        const wx = r.x + Math.cos(ang) * CFG.CIRCLE_R, wy = r.y + Math.sin(ang) * CFG.CIRCLE_R;
        const nx = -Math.sin(ang), ny = Math.cos(ang);
        defsLeft.sort((a, b) => U.dist(a.x, a.y, wx, wy) - U.dist(b.x, b.y, wx, wy));
        for (let i = 0; i < n && defsLeft.length; i++) {
          const p = defsLeft.shift();
          const o = (i - (n - 1) / 2) * 0.62;
          arr.set(p, { x: wx + nx * o, y: wy + ny * o });
        }
      } else if (defsLeft.length) {
        const p = defsLeft.shift();
        arr.set(p, P(0.6, cs * 3.2));
      }
      // Un attaccante resta alto per il contropiede
      const fw = defsLeft.find((p) => p.role === 'FW');
      if (fw) { defsLeft = defsLeft.filter((p) => p !== fw); arr.set(fw, { x: -dA * 3, y: U.rand(-6, 6) }); }
      for (const pt of inBox) {
        if (!defsLeft.length) break;
        defsLeft.sort((a, b) => U.dist(a.x, a.y, pt.x, pt.y) - U.dist(b.x, b.y, pt.x, pt.y));
        const p = defsLeft.shift();
        // tra l'attaccante e la porta
        const gdx = ga - pt.x, gdy = -pt.y, gl = Math.sqrt(gdx * gdx + gdy * gdy) || 1;
        arr.set(p, { x: pt.x + (gdx / gl) * 0.9, y: pt.y + (gdy / gl) * 0.9 });
      }
      defsLeft.forEach((p, i) => arr.set(p, P(17 + (i % 2) * 3, -8 + i * 6)));
      return arr;
    }

    // Rinvio dal fondo / punizione lontana: schieramento normale, con distanza dalla palla
    for (const p of atts.concat(defs)) {
      if (arr.has(p)) continue;
      let tg = this.fieldTargetFrom(m, p, p.team === att, r.x, r.y);
      if (r.type === RT.GOALKICK && p.team !== att && m.inOwnBox(att, tg.x, tg.y)) {
        tg = { x: m.ownGoalX(att) + m.dir(att) * (CFG.BOX_DEPTH + 1), y: tg.y };
      }
      arr.set(p, tg);
    }
    return arr;
  },

  fieldTargetFrom(m, p, attacking, bx, by) {
    const b = m.ball;
    const sx = b.x, sy = b.y;
    b.x = bx; b.y = by;
    const tg = this.fieldTarget(m, p, attacking);
    b.x = sx; b.y = sy;
    return tg;
  },

  takeRestart(m) {
    const r = m.restart;
    const p = r.taker;
    const t = r.team;
    const ga = m.goalX(t);
    const aimAt = (x, y) => { r.aimAng = Math.atan2(y - r.y, x - r.x); };
    const mates = m.teams[t].players.filter((q) => q.active && q !== p);
    const openness = (q) => {
      let o = 30;
      for (const e of m.teams[1 - t].players) if (e.active) o = Math.min(o, U.dist(e.x, e.y, q.x, q.y));
      return o;
    };
    switch (r.type) {
      case RT.KICKOFF: {
        const q = mates.filter((q) => q.role !== 'GK').sort((a, b) => U.dist(a.x, a.y, r.x, r.y) - U.dist(b.x, b.y, r.x, r.y))[0];
        aimAt(q.x, q.y); m.restartKick(1, null, 0.2); return;
      }
      case RT.THROWIN: {
        const c = mates.filter((q) => q.role !== 'GK' && U.dist(q.x, q.y, r.x, r.y) < 22)
          .sort((a, b) => openness(b) - U.dist(b.x, b.y, r.x, r.y) * 0.2 - (openness(a) - U.dist(a.x, a.y, r.x, r.y) * 0.2))[0];
        if (c) aimAt(c.x, c.y); else aimAt(r.x + m.dir(t) * 10, 0);
        m.restartKick(1, null, 0.3); return;
      }
      case RT.CORNER: {
        const inBox = mates.filter((q) => m.rx(t, q.x) > CFG.HALF_L - 14 && Math.abs(q.y) < 12);
        const q = inBox.length ? U.pick(inBox) : null;
        if (q) aimAt(q.x, q.y); else aimAt(ga - m.dir(t) * 8, 0);
        if (Math.random() < 0.15 && mates.length) {
          const s = mates.sort((a, b) => U.dist(a.x, a.y, r.x, r.y) - U.dist(b.x, b.y, r.x, r.y))[0];
          aimAt(s.x, s.y); m.restartKick(1, null, 0.3); return;
        }
        m.restartKick(4, null, 0.55); return;
      }
      case RT.GOALKICK: {
        const dfs = mates.filter((q) => q.role === 'DF' && openness(q) > 9);
        if (dfs.length && Math.random() < 0.5) { const q = U.pick(dfs); aimAt(q.x, q.y); m.restartKick(1, null, 0.4); return; }
        const fw = mates.filter((q) => q.role === 'FW' || q.role === 'MF').sort((a, b) => openness(b) - openness(a))[0];
        if (fw) aimAt(fw.x, fw.y);
        m.restartKick(4, null, 0.9); return;
      }
      case RT.PENALTY: {
        const gy = U.sign(Math.random() - 0.5) * U.rand(1.6, CFG.GOAL_HALF_W - 0.45);
        m.restartKick(Math.random() < 0.8 ? 2 : 5, { goalY: gy }, U.rand(0.55, 0.8)); return;
      }
      case RT.FREEKICK: {
        const d = U.dist(r.x, r.y, ga, 0);
        const ang = Math.abs(Math.atan2(r.y, Math.abs(ga - r.x)));
        if (d < 30 && ang < 0.9 && Math.random() < 0.6) {
          const k = m.keeper(1 - t);
          const gy = (k.y > 0 ? -1 : 1) * (CFG.GOAL_HALF_W - 0.5);
          aimAt(ga, gy);
          m.restartKick(5, { goalY: gy }, U.rand(0.6, 0.85)); return;
        }
        if (d < 36) {
          const inBox = mates.filter((q) => m.rx(t, q.x) > CFG.HALF_L - 18 && Math.abs(q.y) < 14);
          if (inBox.length) { const q = U.pick(inBox); aimAt(q.x, q.y); m.restartKick(4, null, 0.5); return; }
        }
        const best = mates.filter((q) => q.role !== 'GK').sort((a, b) => (openness(b) + m.rx(t, b.x) * 0.15) - (openness(a) + m.rx(t, a.x) * 0.15))[0];
        aimAt(best.x, best.y);
        m.restartKick(U.dist(best.x, best.y, r.x, r.y) > 28 ? 4 : 1, null, 0.4); return;
      }
    }
  },
};

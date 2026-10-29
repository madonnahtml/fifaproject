// Calciatore: movimento, stamina, stati di animazione.
'use strict';

// Codici di stato usati anche nello snapshot di rete.
const PS = {
  RUN: 0, SLIDE: 1, DOWN: 2, DIVE: 3, KICK: 4, THROW: 5, HOLD: 6, CELEBRATE: 7, STAGGER: 8, HEAD: 9, SAD: 10,
};

class Player {
  constructor(team, idx, role, base, name, number, skin) {
    this.team = team;
    this.idx = idx;
    this.role = role;
    this.base = base;           // [rx, ry]
    this.name = name;
    this.number = number;
    this.skin = skin;
    const r = () => U.rand(0.55, 0.95);
    this.attr = {
      speed: r(), shot: r(), pass: r(), tackle: r(), dribble: r(), keeping: role === 'GK' ? U.rand(0.7, 0.95) : 0.2,
    };
    if (role === 'FW') { this.attr.shot = Math.min(1, this.attr.shot + 0.12); this.attr.dribble = Math.min(1, this.attr.dribble + 0.06); }
    if (role === 'DF') { this.attr.tackle = Math.min(1, this.attr.tackle + 0.12); }
    if (role === 'MF') { this.attr.pass = Math.min(1, this.attr.pass + 0.1); }
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.facing = 0;
    this.state = PS.RUN;
    this.stateT = 0;
    this.phase = Math.random() * 6;
    this.stamina = 1;
    this.active = true;
    this.yellow = 0;
    this.human = -1;            // indice del lato umano che lo controlla (-1 = IA)
    this.kickCd = 0;            // non puo' ricontrollare la palla subito dopo averla calciata
    this.tackleCd = 0;
    this.slideDir = 0;
    this.diveDir = 0;
    this.diveZ = 0;
    this.sprinting = false;
    this.speedMul = 1;
    this.tx = 0; this.ty = 0;   // obiettivo IA
    this.urgent = false;
    this.shield = false;
    this.jockey = false;
    this.skillT = 0;            // finta in corso
    this.skillDir = 0;
    this.thinkT = Math.random() * 0.3;
  }

  get busy() {
    return this.state === PS.SLIDE || this.state === PS.DOWN || this.state === PS.DIVE || this.state === PS.STAGGER;
  }

  canTouch() {
    return this.active && this.kickCd <= 0 && this.state !== PS.DOWN && this.state !== PS.STAGGER;
  }

  maxSpeed() {
    const base = (this.sprinting && this.stamina > 0.05 ? CFG.SPRINT : CFG.JOG) * (0.9 + this.attr.speed * 0.14) * this.speedMul;
    const tired = 0.86 + 0.14 * this.stamina;
    let s = base * tired;
    if (this.shield) s *= 0.55;
    if (this.jockey) s *= 0.62;
    return s;
  }

  setState(s, t) {
    this.state = s;
    this.stateT = t;
  }

  // Accelera verso la velocita' desiderata.
  steer(dvx, dvy, dt, accelMul) {
    const a = CFG.ACCEL * (accelMul || 1) * dt;
    let ex = dvx - this.vx, ey = dvy - this.vy;
    const el = Math.sqrt(ex * ex + ey * ey);
    if (el > a) { ex *= a / el; ey *= a / el; }
    this.vx += ex; this.vy += ey;
  }

  // Muove il giocatore verso (tx,ty) con frenata in arrivo.
  moveTo(tx, ty, dt, sprint) {
    const dx = tx - this.x, dy = ty - this.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    this.sprinting = !!sprint && d > 4;
    if (d < 0.25) { this.steer(0, 0, dt); return d; }
    const sp = Math.min(this.maxSpeed(), d * 2.2);
    this.steer((dx / d) * sp, (dy / d) * sp, dt);
    return d;
  }

  faceTo(x, y) {
    this.facing = Math.atan2(y - this.y, x - this.x);
  }

  update(dt) {
    this.kickCd -= dt;
    this.tackleCd -= dt;
    if (this.stateT > 0) {
      this.stateT -= dt;
      if (this.stateT <= 0) {
        if (this.state === PS.SLIDE) this.setState(PS.DOWN, 0.55);
        else if (this.state !== PS.THROW && this.state !== PS.HOLD) this.setState(PS.RUN, 0);
      }
    }

    if (this.state === PS.SLIDE) {
      const sp = Math.max(0, Math.sqrt(this.vx * this.vx + this.vy * this.vy) - 9 * dt);
      this.vx = Math.cos(this.slideDir) * sp;
      this.vy = Math.sin(this.slideDir) * sp;
    } else if (this.state === PS.DOWN || this.state === PS.STAGGER) {
      this.vx *= Math.pow(0.02, dt); this.vy *= Math.pow(0.02, dt);
    } else if (this.state === PS.DIVE) {
      this.vx *= Math.pow(0.25, dt); this.vy *= Math.pow(0.25, dt);
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    const sp = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    if (sp > 0.4 && this.state === PS.RUN && !this.jockey) {
      const want = Math.atan2(this.vy, this.vx);
      const turn = 10 * dt;
      const d = U.angleDiff(this.facing, want);
      this.facing += U.clamp(d, -turn, turn);
    }
    this.phase += sp * dt * 1.55;

    if (this.sprinting && sp > CFG.JOG * 0.9) this.stamina = Math.max(0, this.stamina - CFG.STAMINA_DRAIN * dt);
    else this.stamina = Math.min(1, this.stamina + CFG.STAMINA_REGEN * dt * (sp < 3 ? 1.6 : 1));

    // Resta in campo (con un po' di margine fuori dalle linee)
    this.x = U.clamp(this.x, -CFG.HALF_L - 4, CFG.HALF_L + 4);
    this.y = U.clamp(this.y, -CFG.HALF_W - 3, CFG.HALF_W + 3);
  }

  // Punto del piede dove si tiene la palla.
  footPoint(dist) {
    return { x: this.x + Math.cos(this.facing) * dist, y: this.y + Math.sin(this.facing) * dist };
  }
}

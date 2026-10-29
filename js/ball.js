// Fisica della palla: rotolamento, volo con gravita', rimbalzi, effetto, pali e rete.
'use strict';

class Ball {
  constructor() {
    this.reset(0, 0);
  }

  reset(x, y) {
    this.x = x; this.y = y; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.spin = 0;
    this.rot = 0;
    this.owner = null;      // giocatore che ha la palla al piede
    this.inNet = false;
  }

  speed() { return Math.sqrt(this.vx * this.vx + this.vy * this.vy); }

  kick(vx, vy, vz, spin) {
    this.owner = null;
    this.vx = vx; this.vy = vy; this.vz = vz || 0;
    this.spin = spin || 0;
    if (this.z < 0.02 && this.vz > 0) this.z = 0.02;
  }

  // Avanza la palla di dt. Restituisce un evento ('post', 'bar') se colpisce il legno.
  step(dt) {
    if (this.owner) return null;
    let event = null;
    const s = this.speed();
    const airborne = this.z > 0.001 || this.vz > 0.01;

    if (s > 0.05 && this.spin !== 0) {
      const k = this.spin * CFG.SPIN_FORCE * (airborne ? 1 : 0.35) * Math.min(1, s / 12);
      this.vx += (-this.vy / s) * k * dt * s * 0.12;
      this.vy += (this.vx / s) * k * dt * s * 0.12;
      this.spin *= Math.pow(0.55, dt);
    }

    if (airborne) {
      this.vz -= CFG.GRAVITY * dt;
      const drag = 1 - CFG.AIR_DRAG * dt;
      this.vx *= drag; this.vy *= drag;
      this.z += this.vz * dt;
      if (this.z <= 0) {
        this.z = 0;
        if (this.vz < -1.6) {
          this.vz = -this.vz * CFG.BOUNCE;
          this.vx *= 0.86; this.vy *= 0.86;
          this.spin *= 0.5;
        } else {
          this.vz = 0;
        }
      }
    } else {
      this.z = 0; this.vz = 0;
      if (s > 0) {
        const ns = Math.max(0, s - (CFG.ROLL_DECEL + CFG.ROLL_DRAG * s) * dt);
        const f = ns / s;
        this.vx *= f; this.vy *= f;
        if (ns < 0.04) { this.vx = 0; this.vy = 0; this.spin = 0; }
      }
    }

    const px = this.x, py = this.y;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.rot += (s * dt) / CFG.BALL_R;

    event = this.collideGoals(px, py) || event;
    if (this.inNet) this.constrainNet();
    return event;
  }

  collideGoals(px, py) {
    let ev = null;
    const L = CFG.HALF_L, G = CFG.GOAL_HALF_W, H = CFG.GOAL_H;
    for (const gx of [-L, L]) {
      // Pali verticali
      if (this.z < H + CFG.BALL_R) {
        for (const gy of [-G, G]) {
          const dx = this.x - gx, dy = this.y - gy;
          const d = Math.sqrt(dx * dx + dy * dy);
          const rr = 0.06 + CFG.BALL_R;
          if (d < rr && d > 0) {
            const nx = dx / d, ny = dy / d;
            const vn = this.vx * nx + this.vy * ny;
            if (vn < 0) {
              this.vx -= 1.75 * vn * nx;
              this.vy -= 1.75 * vn * ny;
              this.x = gx + nx * rr; this.y = gy + ny * rr;
              ev = 'post';
            }
          }
        }
      }
      // Traversa (cilindro lungo y)
      if (Math.abs(this.y) < G) {
        const dx = this.x - gx, dz = this.z - H;
        const d = Math.sqrt(dx * dx + dz * dz);
        const rr = 0.06 + CFG.BALL_R;
        if (d < rr && d > 0) {
          const nx = dx / d, nz = dz / d;
          const vn = this.vx * nx + this.vz * nz;
          if (vn < 0) {
            this.vx -= 1.7 * vn * nx;
            this.vz -= 1.7 * vn * nz;
            this.x = gx + nx * rr; this.z = H + nz * rr;
            ev = 'bar';
          }
        }
      }
    }
    return ev;
  }

  constrainNet() {
    const L = CFG.HALF_L, G = CFG.GOAL_HALF_W - CFG.BALL_R, D = CFG.GOAL_DEPTH, H = CFG.GOAL_H - CFG.BALL_R;
    const side = this.x > 0 ? 1 : -1;
    const back = side * (L + D - CFG.BALL_R);
    if (side * this.x > side * back) { this.x = back; this.vx *= -0.15; this.vy *= 0.4; }
    if (this.y > G) { this.y = G; this.vy *= -0.2; }
    if (this.y < -G) { this.y = -G; this.vy *= -0.2; }
    if (this.z > H) { this.z = H; this.vz = -Math.abs(this.vz) * 0.2; }
    this.vx *= 0.97; this.vy *= 0.97;
  }

  // Traiettoria futura (senza collisioni) per intercetti e IA del portiere.
  predict(seconds, step) {
    const pts = [];
    let x = this.x, y = this.y, z = this.z, vx = this.vx, vy = this.vy, vz = this.vz, spin = this.spin;
    for (let t = step; t <= seconds + 1e-6; t += step) {
      const s = Math.sqrt(vx * vx + vy * vy);
      const air = z > 0.001 || vz > 0.01;
      if (s > 0.05 && spin !== 0) {
        const k = spin * CFG.SPIN_FORCE * (air ? 1 : 0.35) * Math.min(1, s / 12);
        vx += (-vy / s) * k * step * s * 0.12;
        vy += (vx / s) * k * step * s * 0.12;
        spin *= Math.pow(0.55, step);
      }
      if (air) {
        vz -= CFG.GRAVITY * step;
        vx *= 1 - CFG.AIR_DRAG * step; vy *= 1 - CFG.AIR_DRAG * step;
        z += vz * step;
        if (z <= 0) {
          z = 0;
          if (vz < -1.6) { vz = -vz * CFG.BOUNCE; vx *= 0.86; vy *= 0.86; } else vz = 0;
        }
      } else if (s > 0) {
        const ns = Math.max(0, s - (CFG.ROLL_DECEL + CFG.ROLL_DRAG * s) * step);
        vx *= ns / s; vy *= ns / s;
      }
      x += vx * step; y += vy * step;
      pts.push({ t, x, y, z, s: Math.sqrt(vx * vx + vy * vy) });
    }
    return pts;
  }
}

// Velocita' iniziale per far arrivare un rasoterra a distanza d con velocita' finale vEnd.
function groundPassSpeed(d, vEnd) {
  // Integrazione numerica della decelerazione (costante + proporzionale), invertita per bisezione.
  let lo = 2, hi = 40;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (rollDistance(mid, vEnd) < d) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function rollDistance(v0, vEnd) {
  let v = v0, d = 0;
  const h = 1 / 60;
  while (v > vEnd && v > 0.05) {
    d += v * h;
    v -= (CFG.ROLL_DECEL + CFG.ROLL_DRAG * v) * h;
    if (d > 200) break;
  }
  return d;
}

// Tempo impiegato da un rasoterra lanciato a v0 per percorrere d metri (Infinity se non arriva).
function rollTime(v0, d) {
  let v = v0, x = 0, t = 0;
  const h = 1 / 60;
  while (x < d) {
    x += v * h; t += h;
    v -= (CFG.ROLL_DECEL + CFG.ROLL_DRAG * v) * h;
    if (v <= 0.05) return Infinity;
  }
  return t;
}

// Disegno su canvas 2D: campo in vista dall'alto leggermente inclinata, omini stilizzati in piedi, HUD e radar.
// Lavora solo sugli snapshot, quindi e' identico per host, secondo giocatore online e replay.
'use strict';

const TILT = 0.72;          // schiacciamento verticale del terreno (effetto telecamera inclinata)
const STICK_SCALE = 1.18;   // omini leggermente piu' grandi del reale per leggibilita'
const SIDE_COLORS = ['#ffe14d', '#4dd2ff'];
const SIDE_LABELS = ['G1', 'G2'];

class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.quality = 1;
    this.camX = 0; this.camY = 0;
    this.showRadar = true;
    this.crowdPattern = null;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(q) { this.quality = q; this.resize(); }

  resize() {
    const dpr = this.quality > 1 ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    this.W = window.innerWidth; this.H = window.innerHeight;
    this.cv.width = Math.floor(this.W * dpr); this.cv.height = Math.floor(this.H * dpr);
    this.cv.style.width = this.W + 'px'; this.cv.style.height = this.H + 'px';
    this.dpr = dpr;
    this.ppm = Math.max(this.W / 46, this.H / 30);
    this.makeCrowd();
  }

  makeCrowd() {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = '#1b2231'; g.fillRect(0, 0, 64, 32);
    const cols = ['#c94b4b', '#3d6fd6', '#e8e8e8', '#e3c341', '#5aa865', '#9b59b6', '#333', '#d98b3a'];
    for (let y = 2; y < 32; y += 5) {
      for (let x = (y % 2) * 2; x < 64; x += 4) {
        g.fillStyle = cols[(x * 7 + y * 13) % cols.length];
        g.fillRect(x, y, 2, 2);
        g.fillStyle = '#e0b48a';
        g.fillRect(x, y - 1.5, 2, 1.2);
      }
    }
    this.crowdPattern = this.ctx.createPattern(c, 'repeat');
  }

  // ---------- Proiezioni ----------
  sx(x) { return (x - this.camX) * this.ppm + this.W / 2; }
  sy(y, z) { return (y - this.camY) * this.ppm * TILT - (z || 0) * this.ppm + this.H / 2; }

  updateCamera(snap, dt, follow) {
    const bx = snap.b[0] / 100, by = snap.b[1] / 100;
    let tx = bx, ty = by;
    if (follow) { tx = follow.x * 0.25 + bx * 0.75; ty = follow.y * 0.25 + by * 0.75; }
    const k = Math.min(1, dt * 3.2);
    this.camX += (tx - this.camX) * k;
    this.camY += (ty - this.camY) * k;
    const halfW = this.W / 2 / this.ppm, halfH = this.H / 2 / this.ppm / TILT;
    const mx = Math.max(0, CFG.HALF_L + 7 - halfW), my = Math.max(0, CFG.HALF_W + 6 - halfH);
    this.camX = U.clamp(this.camX, -mx, mx);
    this.camY = U.clamp(this.camY, -my - 1, my + 2);
  }

  snapCamera(snap) {
    this.camX = snap.b[0] / 100; this.camY = snap.b[1] / 100;
  }

  // ---------- Disegno principale ----------
  draw(snap, info, opts) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.crowdPattern || '#1b2231';
    ctx.fillRect(0, 0, this.W, this.H);
    this.drawPitch();
    const dr = snap.dr;

    // Elementi ordinati per profondita'
    const items = [];
    const n = snap.p.length / 7;
    for (let i = 0; i < n; i++) {
      const o = i * 7;
      if (!(snap.p[o + 6] & 1)) continue;
      items.push({ y: snap.p[o + 1] / 100, k: 0, i });
    }
    items.push({ y: snap.b[1] / 100 + 0.01, k: 1 });
    items.push({ y: -CFG.GOAL_HALF_W - 0.05, k: 2 });
    items.push({ y: CFG.GOAL_HALF_W + 0.05, k: 3 });
    items.sort((a, b) => a.y - b.y);

    this.drawBoards(-1);
    // ombre
    for (const it of items) {
      if (it.k !== 0) continue;
      const o = it.i * 7;
      const x = snap.p[o] / 100, y = snap.p[o + 1] / 100;
      this.shadow(x, y, 0.42, 0.26);
    }
    const bz = snap.b[2] / 100;
    this.shadow(snap.b[0] / 100, snap.b[1] / 100, Math.max(0.08, 0.16 - bz * 0.015), 0.1, Math.max(0.15, 0.45 - bz * 0.05));

    for (const it of items) {
      if (it.k === 0) this.drawPlayer(snap, info, it.i);
      else if (it.k === 1) this.drawBall(snap);
      else if (it.k === 2) { this.drawGoal(-1, true); this.drawGoal(1, true); }
      else { this.drawGoal(-1, false); this.drawGoal(1, false); }
    }
    this.drawBoards(1);
    this.drawMarkers(snap, info, opts);
    this.drawHUD(snap, info, opts);
  }

  drawPitch() {
    const ctx = this.ctx;
    const ppm = this.ppm;
    ctx.save();
    ctx.translate(this.W / 2 - this.camX * ppm, this.H / 2 - this.camY * ppm * TILT);
    ctx.scale(ppm, ppm * TILT);
    const L = CFG.HALF_L, W = CFG.HALF_W;
    // erba con strisce
    ctx.fillStyle = '#2f8a3a';
    ctx.fillRect(-L - 6, -W - 4, 2 * L + 12, 2 * W + 8);
    const stripe = 2 * L / 14;
    ctx.fillStyle = '#35963f';
    for (let i = 0; i < 14; i += 2) ctx.fillRect(-L + i * stripe, -W - 4, stripe, 2 * W + 8);
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = 0.14;
    ctx.strokeRect(-L, -W, 2 * L, 2 * W);
    ctx.beginPath(); ctx.moveTo(0, -W); ctx.lineTo(0, W); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, CFG.CIRCLE_R, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(0, 0, 0.25, 0, Math.PI * 2); ctx.fill();
    for (const s of [-1, 1]) {
      const gx = s * L;
      ctx.strokeRect(Math.min(gx, gx - s * CFG.BOX_DEPTH), -CFG.BOX_HALF_W, CFG.BOX_DEPTH, CFG.BOX_HALF_W * 2);
      ctx.strokeRect(Math.min(gx, gx - s * CFG.SIX_DEPTH), -CFG.SIX_HALF_W, CFG.SIX_DEPTH, CFG.SIX_HALF_W * 2);
      ctx.beginPath(); ctx.arc(gx - s * CFG.PEN_SPOT, 0, 0.22, 0, Math.PI * 2); ctx.fill();
      // lunetta
      ctx.beginPath();
      const a = Math.acos((CFG.BOX_DEPTH - CFG.PEN_SPOT) / CFG.CIRCLE_R);
      if (s > 0) ctx.arc(gx - CFG.PEN_SPOT, 0, CFG.CIRCLE_R, Math.PI - a, Math.PI + a);
      else ctx.arc(gx + CFG.PEN_SPOT, 0, CFG.CIRCLE_R, -a, a);
      ctx.stroke();
      // archi d'angolo
      for (const t of [-1, 1]) {
        ctx.beginPath();
        const st = s > 0 ? (t > 0 ? Math.PI : Math.PI / 2) : (t > 0 ? -Math.PI / 2 : 0);
        ctx.arc(gx, t * W, 1, st + (t > 0 ? 0 : 0), st + Math.PI / 2);
        ctx.stroke();
      }
    }
    ctx.restore();
    // bandierine
    for (const s of [-1, 1]) for (const t of [-1, 1]) this.flag(s * L, t * W);
  }

  flag(x, y) {
    const ctx = this.ctx;
    const X = this.sx(x), Y = this.sy(y), h = 1.5 * this.ppm;
    ctx.strokeStyle = '#ddd'; ctx.lineWidth = Math.max(1, this.ppm * 0.05);
    ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X, Y - h); ctx.stroke();
    ctx.fillStyle = '#ff3b3b';
    ctx.beginPath(); ctx.moveTo(X, Y - h); ctx.lineTo(X + h * 0.35, Y - h * 0.88); ctx.lineTo(X, Y - h * 0.76); ctx.fill();
  }

  drawBoards(side) {
    const ctx = this.ctx;
    const y = side * (CFG.HALF_W + 3.2);
    const Y = this.sy(y), h = 0.9 * this.ppm;
    const x0 = this.sx(-CFG.HALF_L - 6), x1 = this.sx(CFG.HALF_L + 6);
    if (Y + h < 0 || Y - h > this.H) return;
    ctx.fillStyle = side < 0 ? '#16324f' : '#14304b';
    ctx.fillRect(x0, Y - h, x1 - x0, h);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold ' + Math.round(h * 0.6) + 'px sans-serif';
    ctx.textBaseline = 'middle';
    const words = ['STICK CALCIO', 'GIOCA CON GLI AMICI', 'CODICE STANZA', 'STICK CALCIO', 'PARTITA ONLINE'];
    const step = 14 * this.ppm;
    let i = 0;
    for (let x = x0 + 10; x < x1; x += step, i++) {
      if (x < -step || x > this.W + step) continue;
      ctx.fillText(words[i % words.length], x, Y - h / 2);
    }
  }

  shadow(x, y, rx, ry, a) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,' + (a || 0.28) + ')';
    ctx.beginPath();
    ctx.ellipse(this.sx(x), this.sy(y), rx * this.ppm * STICK_SCALE, ry * this.ppm * STICK_SCALE, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  drawGoal(side, back) {
    const ctx = this.ctx;
    const L = CFG.HALF_L, G = CFG.GOAL_HALF_W, H = CFG.GOAL_H, D = CFG.GOAL_DEPTH;
    const gx = side * L, bx = side * (L + D);
    const X = (x) => this.sx(x);
    const Y = (y, z) => this.sy(y, z);
    if (X(gx) < -200 || X(gx) > this.W + 200) return;
    const lw = Math.max(2, this.ppm * 0.12);
    if (back) {
      // rete: fondo, tetto, fianco lontano
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.beginPath();
      ctx.moveTo(X(bx), Y(-G, 0)); ctx.lineTo(X(bx), Y(G, 0)); ctx.lineTo(X(bx), Y(G, H * 0.85));
      ctx.lineTo(X(bx), Y(-G, H * 0.85)); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = -G; y <= G + 0.01; y += 0.6) {
        ctx.moveTo(X(bx), Y(y, 0)); ctx.lineTo(X(bx), Y(y, H * 0.85));
        ctx.moveTo(X(bx), Y(y, H * 0.85)); ctx.lineTo(X(gx), Y(y, H));
      }
      for (let z = 0; z <= H * 0.85 + 0.01; z += 0.5) { ctx.moveTo(X(bx), Y(-G, z)); ctx.lineTo(X(bx), Y(G, z)); }
      for (let x = 0; x <= D + 0.01; x += 0.55) {
        const xx = gx + side * x, zz = H - (H * 0.15) * (x / D);
        ctx.moveTo(X(xx), Y(-G, 0)); ctx.lineTo(X(xx), Y(-G, zz));
      }
      ctx.stroke();
      // palo lontano e traversa
      ctx.strokeStyle = '#f4f4f4'; ctx.lineWidth = lw; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(X(gx), Y(-G, 0)); ctx.lineTo(X(gx), Y(-G, H)); ctx.lineTo(X(gx), Y(G, H));
      ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= D + 0.01; x += 0.55) {
        const xx = gx + side * x, zz = H - (H * 0.15) * (x / D);
        ctx.moveTo(X(xx), Y(G, 0)); ctx.lineTo(X(xx), Y(G, zz));
      }
      ctx.moveTo(X(gx), Y(G, H)); ctx.lineTo(X(bx), Y(G, H * 0.85)); ctx.lineTo(X(bx), Y(G, 0));
      ctx.stroke();
      ctx.strokeStyle = '#f4f4f4'; ctx.lineWidth = lw; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(X(gx), Y(G, 0)); ctx.lineTo(X(gx), Y(G, H)); ctx.stroke();
    }
  }

  drawBall(snap) {
    const ctx = this.ctx;
    const x = snap.b[0] / 100, y = snap.b[1] / 100, z = snap.b[2] / 100, rot = snap.b[3] / 100;
    const X = this.sx(x), Y = this.sy(y, z + CFG.BALL_R);
    const r = Math.max(4.5, CFG.BALL_R * this.ppm * 2.2);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#222'; ctx.lineWidth = Math.max(1, r * 0.18);
    ctx.beginPath(); ctx.arc(X, Y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#222';
    for (let i = 0; i < 3; i++) {
      const a = rot + i * 2.1;
      const ox = Math.cos(a) * r * 0.5;
      if (Math.sin(a) < -0.2) continue;
      ctx.beginPath(); ctx.arc(X + ox, Y + Math.sin(i * 1.7) * r * 0.35, r * 0.28, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ---------- Omino ----------
  drawPlayer(snap, info, i) {
    const o = i * 7, P = snap.p;
    const x = P[o] / 100, y = P[o + 1] / 100;
    const X = this.sx(x), Y = this.sy(y);
    if (X < -80 || X > this.W + 80 || Y < -120 || Y > this.H + 80) return;
    const st = P[o + 2];
    const team = i < 11 ? 0 : 1;
    const pi = info.teams[team].players[i % 11];
    const kit = KIT_COLORS[info.teams[team].kit];
    const shirt = pi.gk ? info.teams[team].keeperKit : kit.shirt;
    const shorts = pi.gk ? '#222' : kit.shorts;
    const socks = pi.gk ? info.teams[team].keeperKit : kit.socks;
    const facing = P[o + 4] / 57.2958;
    const speed = P[o + 5] / 10;
    const phase = st === PS.DIVE ? 0 : P[o + 3] / 10;
    const flags = P[o + 6];
    const hasBall = (flags & 8) !== 0;
    const face = Math.cos(facing) >= -0.05 ? 1 : -1;
    const h = 1.85 * this.ppm * STICK_SCALE;
    const t = snap.tm || 0;

    const ctx = this.ctx;
    ctx.save();
    ctx.translate(X, Y);
    let lean = 0, lift = 0, rot = 0;
    const amp = Math.min(1, speed / 7.5);
    let legA = [Math.sin(phase) * 0.75 * amp, Math.sin(phase + Math.PI) * 0.75 * amp];
    let kneeB = [Math.max(0, Math.sin(phase + 1.6)) * 1.2 * amp, Math.max(0, Math.sin(phase + Math.PI + 1.6)) * 1.2 * amp];
    let armA = [-legA[0] * 0.9, -legA[1] * 0.9];
    let elbow = [0.6 + amp * 0.5, 0.6 + amp * 0.5];
    let armsUp = false, armsFwd = false;
    lean = amp * 0.12;
    if (speed < 0.4) { legA = [0.08, -0.08]; kneeB = [0.05, 0.05]; armA = [0.12, -0.12]; elbow = [0.2, 0.2]; lean = 0; }

    switch (st) {
      case PS.SLIDE:
        rot = -1.15; lift = 0; legA = [1.2, 0.9]; kneeB = [0, 0.4]; armA = [-0.9, -1.4]; elbow = [0.2, 0.2]; lean = 0; break;
      case PS.DOWN:
        rot = -1.5; legA = [0.2, -0.1]; kneeB = [0.3, 0.1]; armA = [0.5, 1.6]; elbow = [0.3, 0.3]; lean = 0; break;
      case PS.DIVE: {
        const dz = P[o + 3] / 100;
        lift = Math.min(dz, 1.4) * this.ppm;
        rot = (Math.sin(facing) < 0 ? -1 : 1) * 1.3 * face;
        armsUp = true; legA = [0.25, -0.2]; kneeB = [0.2, 0.2]; lean = 0;
        break;
      }
      case PS.KICK:
        legA = [1.15, -0.35]; kneeB = [0.1, 0.5]; armA = [-0.9, 0.8]; elbow = [0.3, 0.3]; lean = -0.12; break;
      case PS.HEAD:
        lift = 0.35 * this.ppm; legA = [0.3, -0.3]; kneeB = [0.9, 0.9]; armA = [0.6, -0.6]; lean = 0.3; break;
      case PS.THROW:
        armsUp = true; legA = [0.15, -0.15]; kneeB = [0.1, 0.1]; lean = -0.1; break;
      case PS.CELEBRATE:
        lift = Math.abs(Math.sin(t * 9 + i)) * 0.35 * this.ppm; armsUp = true; break;
      case PS.SAD:
        lean = 0.35; armA = [0.1, -0.1]; elbow = [0.1, 0.1]; legA = [0.05, -0.05]; break;
      case PS.STAGGER:
        lean = -0.35; armA = [-1.8, 1.4]; elbow = [0.4, 0.4]; break;
    }
    if (pi.gk && hasBall && st === PS.RUN && (snap.b[2] / 100) > 0.6) armsFwd = true;
    if (st === PS.DOWN || st === PS.SLIDE) { ctx.translate(0, -0.12 * h); }
    ctx.translate(0, -lift);
    if (rot) ctx.rotate(rot * face);
    ctx.scale(face, 1);

    const hipY = -0.5 * h;
    const thigh = 0.25 * h, shin = 0.25 * h;
    const neck = { x: lean * h * 0.35, y: -0.83 * h };
    const shoulder = { x: neck.x * 0.95, y: neck.y + 0.04 * h };
    const head = { x: neck.x * 1.08, y: neck.y - 0.09 * h };
    const lw = Math.max(2, h * 0.075);
    const out = Math.max(1.2, h * 0.03);

    const legPts = [0, 1].map((k) => {
      const a = legA[k];
      const kx = Math.sin(a) * thigh, ky = hipY + Math.cos(a) * thigh;
      const sa = a - kneeB[k];
      return { kx, ky, fx: kx + Math.sin(sa) * shin, fy: ky + Math.cos(sa) * shin };
    });
    const armPts = [0, 1].map((k) => {
      let a = armA[k];
      let e = elbow[k];
      if (armsUp) { a = Math.PI - 0.35 + k * 0.7; e = 0.1; }
      if (armsFwd) { a = 1.4; e = 0.2; }
      const ua = 0.16 * h, fa = 0.15 * h;
      const ex = shoulder.x + Math.sin(a) * ua, ey = shoulder.y + Math.cos(a) * ua;
      const ha = a + e;
      return { ex, ey, hx: ex + Math.sin(ha) * fa, hy: ey + Math.cos(ha) * fa };
    });

    const seg = (x1, y1, x2, y2, col, w) => {
      ctx.strokeStyle = col; ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    };
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const dark = '#141414';
    // gamba e braccio dietro (piu' scuri)
    const back = 1, front = 0;
    const drawLeg = (k, dim) => {
      const L = legPts[k];
      seg(0, hipY, L.kx, L.ky, dark, lw + out * 2);
      seg(L.kx, L.ky, L.fx, L.fy, dark, lw + out * 2);
      seg(0, hipY, L.kx * 0.55, hipY + (L.ky - hipY) * 0.55, dim ? shade(shorts) : shorts, lw * 1.25);
      seg(L.kx * 0.55, hipY + (L.ky - hipY) * 0.55, L.kx, L.ky, dim ? shade(pi.sk) : pi.sk, lw);
      seg(L.kx, L.ky, L.fx, L.fy, dim ? shade(socks) : socks, lw);
      seg(L.fx, L.fy, L.fx + 0.06 * h, L.fy, dark, lw * 1.1);
    };
    const drawArm = (k, dim) => {
      const A = armPts[k];
      seg(shoulder.x, shoulder.y, A.ex, A.ey, dark, lw * 0.9 + out * 2);
      seg(A.ex, A.ey, A.hx, A.hy, dark, lw * 0.9 + out * 2);
      seg(shoulder.x, shoulder.y, A.ex, A.ey, dim ? shade(shirt) : shirt, lw * 0.95);
      seg(A.ex, A.ey, A.hx, A.hy, pi.gk ? '#f0f0f0' : (dim ? shade(pi.sk) : pi.sk), lw * 0.85);
    };
    drawArm(back, true);
    drawLeg(back, true);
    // busto con maglia
    seg(0, hipY, neck.x, neck.y, dark, lw * 2.3 + out * 2);
    seg(0, hipY, neck.x, neck.y, shirt, lw * 2.3);
    seg(0, hipY + 0.01 * h, neck.x * 0.25, hipY - 0.04 * h, shorts, lw * 2.3);
    drawLeg(front, false);
    drawArm(front, false);
    // testa
    ctx.fillStyle = pi.sk; ctx.strokeStyle = dark; ctx.lineWidth = out * 1.4;
    ctx.beginPath(); ctx.arc(head.x, head.y, 0.085 * h, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // numero sulla maglia (solo se grande abbastanza)
    if (h > 55) {
      ctx.scale(face, 1);
      ctx.fillStyle = contrast(shirt);
      ctx.font = 'bold ' + Math.round(h * 0.13) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(pi.no), neck.x * face * 0.5, (hipY + neck.y) / 2);
    }
    ctx.restore();
  }

  drawMarkers(snap, info, opts) {
    const ctx = this.ctx;
    const h = 1.85 * this.ppm * STICK_SCALE;
    // Compagno che ricevera' il passaggio: anello tratteggiato
    for (let s = 0; s < 2; s++) {
      const ti = snap.pt ? snap.pt[s] : -1;
      if (ti == null || ti < 0 || ti === snap.hp[s]) continue;
      const o = ti * 7;
      const X = this.sx(snap.p[o] / 100), Y = this.sy(snap.p[o + 1] / 100);
      const pulse = 0.85 + Math.sin((snap.tm || 0) * 10) * 0.12;
      ctx.save();
      ctx.strokeStyle = SIDE_COLORS[s]; ctx.lineWidth = Math.max(2, this.ppm * 0.07);
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.ellipse(X, Y, 0.75 * this.ppm * pulse, 0.75 * this.ppm * TILT * pulse, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = SIDE_COLORS[s];
      const top = Y - h - 6;
      ctx.beginPath(); ctx.arc(X, top, 4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    for (let s = 0; s < 2; s++) {
      const gi = snap.hp[s];
      if (gi == null || gi < 0) continue;
      const o = gi * 7;
      const x = snap.p[o] / 100, y = snap.p[o + 1] / 100;
      const X = this.sx(x), Y = this.sy(y);
      const col = SIDE_COLORS[s];
      // anello a terra
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, this.ppm * 0.08);
      ctx.beginPath(); ctx.ellipse(X, Y, 0.62 * this.ppm, 0.62 * this.ppm * TILT, 0, 0, Math.PI * 2); ctx.stroke();
      // freccia sopra la testa
      const top = Y - h - 10;
      ctx.fillStyle = col; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(X - 8, top - 10); ctx.lineTo(X + 8, top - 10); ctx.lineTo(X, top); ctx.closePath(); ctx.fill(); ctx.stroke();
      const team = Math.floor(gi / 11);
      const pi = info.teams[team].players[gi % 11];
      ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      const label = (opts.online ? SIDE_LABELS[s] + ' ' : '') + pi.n;
      outlineText(ctx, label, X, top - 12, col);
      // barra potenza e stamina
      const bw = Math.max(46, 1.6 * this.ppm);
      const ch = snap.ch[s] / 100;
      if (ch > 0) {
        const kindCol = ['#fff', '#7CFC00', '#ff4040', '#00e5ff', '#ffd000', '#ff8cff', '#ffa040'][snap.ck[s]] || '#fff';
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(X - bw / 2 - 2, Y + 8, bw + 4, 9);
        ctx.fillStyle = kindCol; ctx.fillRect(X - bw / 2, Y + 10, bw * ch, 5);
        const kindName = ['', 'PASSAGGIO', 'TIRO', 'FILTRANTE', 'LANCIO', 'A GIRO', 'PALLONETTO'][snap.ck[s]] || '';
        ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        outlineText(ctx, kindName, X, Y + 26, kindCol, 2.5);
      }
      const stam = snap.st[s] / 100;
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(X - bw / 2 - 1, Y + 19, bw + 2, 4);
      ctx.fillStyle = stam > 0.35 ? '#5fe36b' : '#ff9f1c'; ctx.fillRect(X - bw / 2, Y + 20, bw * stam, 2);
    }
  }

  // ---------- HUD ----------
  drawHUD(snap, info, opts) {
    const ctx = this.ctx;
    const W = this.W, H = this.H;
    const t0 = info.teams[0], t1 = info.teams[1];
    const k0 = KIT_COLORS[t0.kit], k1 = KIT_COLORS[t1.kit];
    // Tabellone
    const x = 14, y = 12;
    ctx.font = 'bold 16px sans-serif';
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const n0 = t0.name.toUpperCase().slice(0, 12), n1 = t1.name.toUpperCase().slice(0, 12);
    const w0 = ctx.measureText(n0).width, w1 = ctx.measureText(n1).width;
    const boxW = w0 + w1 + 150;
    ctx.fillStyle = 'rgba(8,14,24,0.85)';
    roundRect(ctx, x, y, boxW, 34, 6); ctx.fill();
    ctx.fillStyle = k0.shirt; ctx.fillRect(x + 8, y + 9, 8, 16);
    ctx.fillStyle = '#fff'; ctx.fillText(n0, x + 22, y + 17);
    const sx = x + 30 + w0;
    ctx.fillStyle = '#fff'; ctx.fillRect(sx, y + 4, 56, 26);
    ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.font = 'bold 18px sans-serif';
    ctx.fillText(snap.s[0] + ' - ' + snap.s[1], sx + 28, y + 17);
    ctx.textAlign = 'left'; ctx.font = 'bold 16px sans-serif'; ctx.fillStyle = '#fff';
    ctx.fillText(n1, sx + 66, y + 17);
    ctx.fillStyle = k1.shirt; ctx.fillRect(sx + 72 + w1, y + 9, 8, 16);
    // Orologio
    const c = snap.c;
    const limit = snap.h === 1 ? 2700 : 5400;
    let clock;
    if (c >= limit) clock = (limit / 60) + '+' + Math.floor((c - limit) / 60 + 1);
    else clock = String(Math.floor(c / 60)).padStart(2, '0') + ':' + String(c % 60).padStart(2, '0');
    ctx.fillStyle = 'rgba(8,14,24,0.85)';
    roundRect(ctx, x + boxW + 6, y, 74, 34, 6); ctx.fill();
    ctx.fillStyle = c >= limit ? '#ffd54a' : '#fff'; ctx.textAlign = 'center';
    ctx.fillText(clock, x + boxW + 43, y + 17);
    ctx.font = '11px sans-serif'; ctx.fillStyle = '#9fb3c8';
    ctx.fillText(snap.h === 1 ? '1° tempo' : '2° tempo', x + boxW + 43, y + 44);
    // Mentalita' del lato locale
    if (opts.localSide != null && snap.me) {
      const mt = snap.me[opts.localSide];
      ctx.textAlign = 'left'; ctx.font = '12px sans-serif'; ctx.fillStyle = '#cfe3ff';
      ctx.fillText('Mentalità (R): ' + ['Difensiva', 'Equilibrata', 'Offensiva'][mt + 1], x, y + 48);
    }

    if (snap.rp) {
      const blink = Math.floor((snap.tm || 0) * 2) % 2 === 0;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; roundRect(ctx, W - 150, 14, 136, 32, 6); ctx.fill();
      ctx.fillStyle = blink ? '#ff3030' : '#801010';
      ctx.beginPath(); ctx.arc(W - 132, 30, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText('REPLAY', W - 118, 31);
      ctx.font = '12px sans-serif'; ctx.fillStyle = '#ddd'; ctx.textAlign = 'right';
      ctx.fillText('Spazio / J / K per saltare', W - 14, 60);
    }

    if (this.showRadar) this.drawRadar(snap, info);

    if (snap.mt > 0 && snap.m) {
      ctx.globalAlpha = snap.mt / 100;
      ctx.font = 'bold ' + Math.round(Math.min(46, W / 22)) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      outlineText(ctx, snap.m, W / 2, H * 0.24, snap.m.startsWith('GOO') ? '#ffe14d' : '#ffffff', 5);
      ctx.globalAlpha = 1;
    }

    // Suggerimenti sui calci piazzati per il giocatore locale
    if (snap.ph === PH.RESTART && opts.localSide != null && snap.rtm === opts.localSide && snap.hp[opts.localSide] >= 0) {
      const hint = snap.rt === RT.PENALTY
        ? 'RIGORE: tieni K per la potenza, W/S per l\'angolo, O a giro, U cucchiaio'
        : snap.rt === RT.THROWIN
          ? 'RIMESSA: frecce per mirare, J corta, I lunga'
          : 'Frecce per mirare • J passaggio • L filtrante • I lancio/cross • K tiro • O a giro • U pallonetto';
      ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      const tw = ctx.measureText(hint).width + 24;
      roundRect(ctx, W / 2 - tw / 2, H - (this.showRadar ? 150 : 50), tw, 28, 6); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
      ctx.fillText(hint, W / 2, H - (this.showRadar ? 136 : 36));
    }

    if (opts.ping != null) {
      ctx.font = '11px sans-serif'; ctx.textAlign = 'right'; ctx.fillStyle = opts.ping < 120 ? '#8fe08f' : '#ffb347';
      ctx.fillText('ping ' + Math.round(opts.ping) + ' ms', W - 12, H - 10);
    }
    if (opts.fps) {
      ctx.font = '11px sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#9fb3c8';
      ctx.fillText(opts.fps + ' fps', 10, H - 10);
    }

    if (snap.fd > 0) {
      ctx.fillStyle = 'rgba(0,0,0,' + (snap.fd / 100) + ')';
      ctx.fillRect(0, 0, W, H);
    }
  }

  drawRadar(snap, info) {
    const ctx = this.ctx;
    const rw = Math.min(210, this.W * 0.22), rh = rw * (CFG.PITCH_W / CFG.PITCH_L);
    const x0 = this.W / 2 - rw / 2, y0 = this.H - rh - 12;
    ctx.fillStyle = 'rgba(20,70,30,0.75)'; ctx.fillRect(x0, y0, rw, rh);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1;
    ctx.strokeRect(x0, y0, rw, rh);
    ctx.beginPath(); ctx.moveTo(x0 + rw / 2, y0); ctx.lineTo(x0 + rw / 2, y0 + rh); ctx.stroke();
    const bw = rw * CFG.BOX_DEPTH / CFG.PITCH_L, bh = rh * CFG.BOX_HALF_W * 2 / CFG.PITCH_W;
    ctx.strokeRect(x0, y0 + rh / 2 - bh / 2, bw, bh);
    ctx.strokeRect(x0 + rw - bw, y0 + rh / 2 - bh / 2, bw, bh);
    const mx = (x) => x0 + (x + CFG.HALF_L) / CFG.PITCH_L * rw;
    const my = (y) => y0 + (y + CFG.HALF_W) / CFG.PITCH_W * rh;
    const n = snap.p.length / 7;
    for (let i = 0; i < n; i++) {
      const o = i * 7;
      if (!(snap.p[o + 6] & 1)) continue;
      const team = i < 11 ? 0 : 1;
      const human = (snap.p[o + 6] >> 1) & 3;
      ctx.fillStyle = KIT_COLORS[info.teams[team].kit].shirt;
      ctx.strokeStyle = human ? SIDE_COLORS[human - 1] : '#000';
      ctx.lineWidth = human ? 2 : 1;
      ctx.beginPath(); ctx.arc(mx(snap.p[o] / 100), my(snap.p[o + 1] / 100), human ? 4 : 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(mx(snap.b[0] / 100), my(snap.b[1] / 100), 2.5, 0, Math.PI * 2); ctx.fill();
  }
}

function shade(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) * 0.72, g = ((n >> 8) & 255) * 0.72, b = (n & 255) * 0.72;
  return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
}

function contrast(hex) {
  const n = parseInt(hex.slice(1), 16);
  const l = ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114;
  return l > 150 ? '#111' : '#fff';
}

function outlineText(ctx, text, x, y, col, w) {
  ctx.lineWidth = w || 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = col; ctx.fillText(text, x, y);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

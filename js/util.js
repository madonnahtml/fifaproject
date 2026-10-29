// Piccole funzioni matematiche condivise.
'use strict';

const U = {
  clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
  lerp: (a, b, t) => a + (b - a) * t,
  len: (x, y) => Math.sqrt(x * x + y * y),
  dist: (ax, ay, bx, by) => Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by)),
  rand: (a, b) => a + Math.random() * (b - a),
  randInt: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
  pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
  sign: (v) => (v < 0 ? -1 : 1),
  angleDiff(a, b) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  },
  // Distanza del punto P dal segmento AB e parametro t sul segmento.
  segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy || 1e-6;
    const t = U.clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
    const cx = ax + dx * t, cy = ay + dy * t;
    return { d: U.dist(px, py, cx, cy), t };
  },
  gauss() {
    return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  },
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  },
};

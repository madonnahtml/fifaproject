// Costanti di gioco, squadre e formazioni.
// Unita' di misura: metri e secondi. Asse x = lunghezza del campo, y = larghezza, z = altezza.
'use strict';

const CFG = {
  DT: 1 / 60,
  PITCH_L: 105,
  PITCH_W: 68,
  HALF_L: 52.5,
  HALF_W: 34,
  GOAL_HALF_W: 3.66,
  GOAL_H: 2.44,
  GOAL_DEPTH: 2.2,
  BOX_DEPTH: 16.5,
  BOX_HALF_W: 20.16,
  SIX_DEPTH: 5.5,
  SIX_HALF_W: 9.16,
  PEN_SPOT: 11,
  CIRCLE_R: 9.15,

  GRAVITY: 9.81,
  BALL_R: 0.11,
  ROLL_DECEL: 3.6,      // decelerazione costante palla a terra
  ROLL_DRAG: 0.18,      // attrito proporzionale alla velocita' a terra
  AIR_DRAG: 0.06,
  BOUNCE: 0.52,
  SPIN_FORCE: 1.0,

  JOG: 6.3,
  SPRINT: 8.6,
  ACCEL: 18,
  DRIBBLE_SLOW: 0.88,
  STAMINA_DRAIN: 0.085,
  STAMINA_REGEN: 0.05,

  SNAP_HZ: 30,
  INTERP_DELAY: 0.085,

  PEER_PREFIX: 'stickcalcio27-',
};

const DIFFICULTIES = [
  { name: 'Facile',    think: 0.42, react: 0.34, acc: 0.55, speed: 0.92, aggr: 0.35, keeper: 0.80 },
  { name: 'Normale',   think: 0.30, react: 0.24, acc: 0.75, speed: 0.97, aggr: 0.55, keeper: 0.90 },
  { name: 'Difficile', think: 0.20, react: 0.16, acc: 0.88, speed: 1.00, aggr: 0.75, keeper: 0.96 },
  { name: 'Leggenda',  think: 0.13, react: 0.10, acc: 0.95, speed: 1.03, aggr: 0.90, keeper: 1.00 },
];

const KIT_COLORS = [
  { name: 'Rosso',     shirt: '#d62828', shorts: '#ffffff', socks: '#d62828' },
  { name: 'Blu',       shirt: '#1f4fd1', shorts: '#ffffff', socks: '#1f4fd1' },
  { name: 'Bianco',    shirt: '#f4f4f4', shorts: '#1b1b1b', socks: '#f4f4f4' },
  { name: 'Nero',      shirt: '#1d1d1d', shorts: '#1d1d1d', socks: '#ffffff' },
  { name: 'Azzurro',   shirt: '#5ec8f2', shorts: '#0d2a5c', socks: '#5ec8f2' },
  { name: 'Verde',     shirt: '#1e9e4a', shorts: '#ffffff', socks: '#1e9e4a' },
  { name: 'Giallo',    shirt: '#ffd23f', shorts: '#0d2a5c', socks: '#ffd23f' },
  { name: 'Arancione', shirt: '#ff7b1c', shorts: '#1b1b1b', socks: '#ff7b1c' },
  { name: 'Viola',     shirt: '#7b2cbf', shorts: '#ffffff', socks: '#7b2cbf' },
  { name: 'Granata',   shirt: '#7a1f2b', shorts: '#ffffff', socks: '#7a1f2b' },
];

const KEEPER_KITS = ['#3ddc84', '#ff4fd8', '#ffe600', '#2b2b2b'];

// Posizioni base relative: rx = verso la porta avversaria (-52.5 = propria porta), ry = larghezza.
// Ogni voce: [rx, ry, ruolo]
const FORMATIONS = {
  '4-4-2': [
    [-50, 0, 'GK'],
    [-34, -23, 'DF'], [-38, -8, 'DF'], [-38, 8, 'DF'], [-34, 23, 'DF'],
    [-15, -24, 'MF'], [-19, -8, 'MF'], [-19, 8, 'MF'], [-15, 24, 'MF'],
    [-3, -7, 'FW'], [-3, 7, 'FW'],
  ],
  '4-3-3': [
    [-50, 0, 'GK'],
    [-34, -23, 'DF'], [-38, -8, 'DF'], [-38, 8, 'DF'], [-34, 23, 'DF'],
    [-22, 0, 'MF'], [-16, -13, 'MF'], [-16, 13, 'MF'],
    [-4, -22, 'FW'], [-1, 0, 'FW'], [-4, 22, 'FW'],
  ],
  '3-5-2': [
    [-50, 0, 'GK'],
    [-37, -13, 'DF'], [-39, 0, 'DF'], [-37, 13, 'DF'],
    [-17, -27, 'MF'], [-22, -9, 'MF'], [-24, 0, 'MF'], [-22, 9, 'MF'], [-17, 27, 'MF'],
    [-3, -7, 'FW'], [-3, 7, 'FW'],
  ],
};

const SURNAMES = [
  'Rossi', 'Bianchi', 'Ferri', 'Galli', 'Conti', 'Marini', 'Greco', 'Bruno', 'Colombo', 'Ricci',
  'Moretti', 'Barbieri', 'Fontana', 'Santoro', 'Mariani', 'Rinaldi', 'Caruso', 'Ferrara', 'Lombardi', 'Testa',
  'Gatti', 'Leone', 'Serra', 'Villa', 'Pellegrini', 'Palumbo', 'Sanna', 'Farina', 'Riva', 'Monti',
  'Grasso', 'Sala', 'Neri', 'Fabbri', 'Orlando', 'Vitale', 'Longo', 'Silvestri', 'Cattaneo', 'Martini',
];

const SKIN_TONES = ['#f2c9a0', '#e0ac7e', '#c68642', '#8d5524', '#f7d7b5', '#a86b3c'];

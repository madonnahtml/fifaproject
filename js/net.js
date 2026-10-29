// Online 1 contro 1 via WebRTC (PeerJS). Chi crea la stanza fa da host e simula la partita;
// l'altro manda solo i tasti premuti e riceve gli snapshot.
'use strict';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const Net = {
  peer: null,
  conn: null,
  role: null,
  code: null,
  onStatus: null,     // (testo)
  onConnected: null,  // ()
  onData: null,       // (msg)
  onClosed: null,     // (motivo)
  onError: null,      // (testo)
  ping: null,
  _pingTimer: null,
  _joinTimer: null,

  available() { return typeof Peer !== 'undefined'; },

  genCode() {
    let s = '';
    for (let i = 0; i < 5; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    return s;
  },

  // Permette di usare un server PeerJS proprio: ?peerhost=example.com&peerport=443&peerpath=/
  peerOptions() {
    const q = new URLSearchParams(location.search);
    const o = {
      debug: 0,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' },
        ],
      },
    };
    if (q.get('peerhost')) {
      o.host = q.get('peerhost');
      o.port = Number(q.get('peerport') || 443);
      o.path = q.get('peerpath') || '/';
      o.secure = q.get('peersecure') ? q.get('peersecure') === '1' : o.port === 443;
    }
    return o;
  },

  host(attempt) {
    this.close();
    this.role = 'host';
    this.code = this.genCode();
    this.status('Creo la stanza...');
    const peer = new Peer(CFG.PEER_PREFIX + this.code, this.peerOptions());
    this.peer = peer;
    peer.on('open', () => this.status('Stanza pronta'));
    peer.on('connection', (c) => {
      if (this.conn && this.conn.open) { c.on('open', () => { c.send({ t: 'full' }); setTimeout(() => c.close(), 300); }); return; }
      this.setup(c);
    });
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id' && (attempt || 0) < 3) { this.host((attempt || 0) + 1); return; }
      this.error(this.describe(e));
    });
    peer.on('disconnected', () => { if (!this.conn) peer.reconnect(); });
    return this.code;
  },

  join(code) {
    this.close();
    this.role = 'guest';
    this.code = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    this.status('Mi collego alla stanza ' + this.code + '...');
    const peer = new Peer(this.peerOptions());
    this.peer = peer;
    peer.on('open', () => {
      const c = peer.connect(CFG.PEER_PREFIX + this.code, { reliable: false, serialization: 'json' });
      this.setup(c);
      this._joinTimer = setTimeout(() => {
        if (!this.conn || !this.conn.open) this.error('Nessuna risposta dalla stanza ' + this.code + '. Controlla il codice o riprova.');
      }, 15000);
    });
    peer.on('error', (e) => this.error(this.describe(e)));
  },

  setup(c) {
    this.conn = c;
    c.on('open', () => {
      clearTimeout(this._joinTimer);
      this.status('Connesso!');
      if (this.role === 'guest') {
        this._pingTimer = setInterval(() => this.send({ t: 'ping', ts: performance.now() }), 1000);
      }
      if (this.onConnected) this.onConnected();
    });
    c.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'ping') { this.send({ t: 'pong', ts: msg.ts }); return; }
      if (msg.t === 'pong') {
        const rtt = performance.now() - msg.ts;
        this.ping = this.ping == null ? rtt : this.ping * 0.7 + rtt * 0.3;
        return;
      }
      if (msg.t === 'full') { this.error('La stanza e\' gia\' piena.'); return; }
      if (this.onData) this.onData(msg);
    });
    c.on('close', () => {
      const was = this.conn === c;
      if (was) { this.conn = null; clearInterval(this._pingTimer); }
      if (was && this.onClosed) this.onClosed('L\'altro giocatore si e\' disconnesso.');
    });
    c.on('error', (e) => this.error('Errore di connessione: ' + (e && e.message ? e.message : e)));
  },

  send(obj) {
    if (this.conn && this.conn.open) {
      try { this.conn.send(obj); } catch (e) { /* canale temporaneamente pieno */ }
    }
  },

  connected() { return !!(this.conn && this.conn.open); },

  close() {
    clearInterval(this._pingTimer);
    clearTimeout(this._joinTimer);
    if (this.conn) { try { this.conn.close(); } catch (e) { /* gia' chiusa */ } }
    if (this.peer) { try { this.peer.destroy(); } catch (e) { /* gia' distrutto */ } }
    this.conn = null; this.peer = null; this.role = null; this.ping = null;
  },

  describe(e) {
    switch (e && e.type) {
      case 'peer-unavailable': return 'Stanza non trovata: controlla il codice.';
      case 'network': case 'server-error': case 'socket-error': case 'socket-closed':
        return 'Impossibile raggiungere il server di collegamento. Controlla la connessione a internet.';
      case 'browser-incompatible': return 'Questo browser non supporta il gioco online (usa Chrome aggiornato).';
      case 'unavailable-id': return 'Codice stanza gia\' in uso, riprova.';
      default: return 'Errore online: ' + (e && (e.message || e.type) || e);
    }
  },

  status(t) { if (this.onStatus) this.onStatus(t); },
  error(t) { if (this.onError) this.onError(t); },
};

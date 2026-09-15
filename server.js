/* ============================================================================
 * ԲԱԶԱՌ-ԲԼՈՏ — Server
 * SANI GROUP
 * ============================================================================ */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import http from 'http';
import crypto from 'crypto';
import express from 'express';
import { WebSocketServer } from 'ws';

import { RulesEngine, Player, BotAI, PHASES, CONFIG, secureRandomInt } from './game-core.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ===== ROOM ===== */
class Room {
  constructor(code) {
    this.code = code;
    this.createdAt = Date.now();
    this.hostToken = null; this.guestToken = null;
    this.hostSocket = null; this.guestSocket = null;
    this.hostName = null; this.guestName = null;
    this.engine = null; this.bots = {};
    this.target = 151; this.started = false;
    this.lastActivity = Date.now();
    this.turnTimer = null; this.botTimer = null;
    this.hostDisconnectTimer = null; this.guestDisconnectTimer = null;
    this.disconnectedHost = false; this.disconnectedGuest = false;
    this.actionCounter = { host: 0, guest: 0 };
    this.actionWindowStart = { host: 0, guest: 0 };
    this.processedActions = new Set();
  }
  touch() { this.lastActivity = Date.now(); }
  isFull() { return this.hostToken !== null && this.guestToken !== null; }
  getSocket(role) { return role === 'host' ? this.hostSocket : this.guestSocket; }
  sendToRole(role, payload) {
    const s = this.getSocket(role);
    if (s && s.readyState === 1) {
      try { s.send(JSON.stringify(payload)); } catch (e) { logError('ROOM', 'send fail', e); }
    }
  }
  broadcast(payload) { this.sendToRole('host', payload); this.sendToRole('guest', payload); }

  buildClientState(role) {
    const e = this.engine;
    if (!e) return null;
    const myPlayerId = role === 'host' ? 'you' : 'opponent';
    const partnerPlayerId = role === 'host' ? 'partner' : 'guestPartner';
    const playersPublic = e.players.map(p => {
      const isMe = p.id === myPlayerId;
      const isPartner = p.id === partnerPlayerId;
      return {
        id: p.id, name: p.name, seat: p.seat, team: p.team, isBot: p.isBot,
        score: p.score, tricksWon: p.tricksWon, handCount: p.hand.length,
        hand: (isMe || isPartner) ? p.hand.map(c => c ? c.toJSON() : null).filter(Boolean) : null,
        combinations: []
      };
    });
    const trickPublic = e.trick.map(t => ({ playerId: t.playerId, card: t.card.toJSON() }));
    return {
      stateVersion: e.stateVersion, phase: e.phase, roundNumber: e.roundNumber,
      gameTarget: e.gameTarget, dealerIndex: e.dealerIndex, currentTurnIndex: e.currentTurnIndex,
      trumpSuit: e.trumpSuit, contract: e.contract, multiplier: e.multiplier,
      highestBid: e.highestBid, highestBidderId: e.highestBidderId, passCount: e.passCount,
      kontraByTeam: e.kontraByTeam, rekontraByTeam: e.rekontraByTeam,
      trick: trickPublic, tricksWon: { A: e.tricksWon.A, B: e.tricksWon.B },
      pointsWon: { A: e.pointsWon.A, B: e.pointsWon.B }, winner: e.winner,
      lastRoundResult: e.lastRoundResult, players: playersPublic,
      myPlayerId, myRole: role
    };
  }

  pushState() {
    if (!this.engine) return;
    if (this.hostSocket && this.hostSocket.readyState === 1) this.sendToRole('host', { type: 'STATE_UPDATE', state: this.buildClientState('host') });
    if (this.guestSocket && this.guestSocket.readyState === 1) this.sendToRole('guest', { type: 'STATE_UPDATE', state: this.buildClientState('guest') });
  }

  startGame(target) {
    this.target = target;
    this.engine = new RulesEngine();
    this.engine.gameTarget = target;
    this.engine.players = [
      new Player('you', this.hostName || 'Խաղացող 1', 0, 'A', false),
      new Player('partner', 'ԲՈՏ ՊԱՐՏՆԵՐ', 1, 'A', true),
      new Player('opponent', this.guestName || 'Խաղացող 2', 2, 'B', false),
      new Player('guestPartner', 'ԲՈՏ 2', 3, 'B', true)
    ];
    this.engine.dealerIndex = secureRandomInt(4);
    this.engine.deal();
    this.bots = {
      partner: new BotAI(this.engine, 'partner'),
      guestPartner: new BotAI(this.engine, 'guestPartner')
    };
    this.started = true;
    this.broadcast({ type: 'GAME_START' });
    this.pushState();
    this.scheduleNextTurn();
  }

  clearTimers() {
    if (this.turnTimer) { clearTimeout(this.turnTimer); this.turnTimer = null; }
    if (this.botTimer) { clearTimeout(this.botTimer); this.botTimer = null; }
  }

  scheduleNextTurn() {
    this.clearTimers();
    const e = this.engine; if (!e) return;
    if (e.phase === PHASES.GAME_END) { this.pushState(); return; }
    if (e.phase === PHASES.ROUND_SCORE || e.phase === PHASES.GAME_SCORE) { this.pushState(); return; }
    const cur = e.players[e.currentTurnIndex]; if (!cur) return;

    if (e.phase === PHASES.AUCTION) {
      if (cur.isBot) {
        const d = CONFIG.BOT_THINK_MIN_MS + secureRandomInt(CONFIG.BOT_THINK_MAX_MS - CONFIG.BOT_THINK_MIN_MS);
        this.botTimer = setTimeout(() => this.runBotBid(cur), d);
      } else this.startTurnTimer();
    } else if (e.phase === PHASES.BONUS_DECLARATION) {
      this.botTimer = setTimeout(() => {
        try {
          e.players.forEach(p => {
            if (p.combinations && p.combinations.length) {
              p.combinations.forEach((_, idx) => {
                try { e.declareCombination(p.id, idx); } catch (_) {}
              });
            }
          });
        } catch (err) { logError('COMBO', err); }
        e.phase = PHASES.TRICK_PLAY;
        this.pushState();
        this.scheduleNextTurn();
      }, 800);
    } else if (e.phase === PHASES.TRICK_PLAY) {
      if (cur.isBot) {
        const d = CONFIG.BOT_THINK_MIN_MS + secureRandomInt(CONFIG.BOT_THINK_MAX_MS - CONFIG.BOT_THINK_MIN_MS);
        this.botTimer = setTimeout(() => this.runBotPlay(cur), d);
      } else this.startTurnTimer();
    }
  }

  startTurnTimer() {
    this.clearTimers();
    this.turnTimer = setTimeout(() => this.handleTimeout(), CONFIG.TURN_TIME_MS);
  }

  handleTimeout() {
    const e = this.engine; if (!e) return;
    const cur = e.getCurrentPlayer(); if (!cur || cur.isBot) { this.scheduleNextTurn(); return; }
    try {
      if (e.phase === PHASES.AUCTION) e.passBid(cur.id);
      else if (e.phase === PHASES.TRICK_PLAY) {
        const legal = e.getLegalCards(cur.id);
        if (legal.length) e.playCard(cur.id, legal[0].id);
      }
    } catch (err) { logError('TIMEOUT', err); }
    this.pushState(); this.scheduleNextTurn();
  }

  runBotBid(bot) {
    const e = this.engine; const ai = this.bots[bot.id];
    if (!ai || e.phase !== PHASES.AUCTION) return;
    const bid = ai.decideBid();
    try {
      if (bid === null) e.passBid(bot.id);
      else e.makeBid(bot.id, bid.value, bid.suit);
    } catch (err) { try { e.passBid(bot.id); } catch (_) {} }
    this.pushState(); this.scheduleNextTurn();
  }

  runBotPlay(bot) {
    const e = this.engine; const ai = this.bots[bot.id];
    if (!ai || e.phase !== PHASES.TRICK_PLAY) return;
    const legal = e.getLegalCards(bot.id); if (!legal.length) return;
    let card = ai.decideCard();
    if (!card || !legal.some(c => c.id === card.id)) card = legal[0];
    try { e.playCard(bot.id, card.id); }
    catch (err) { try { e.playCard(bot.id, legal[0].id); } catch (_) {} }
    this.pushState(); this.scheduleNextTurn();
  }

  destroy() {
    this.clearTimers();
    if (this.hostDisconnectTimer) clearTimeout(this.hostDisconnectTimer);
    if (this.guestDisconnectTimer) clearTimeout(this.guestDisconnectTimer);
  }
}

/* ===== STORE ===== */
const rooms = new Map();
const tokenToRoom = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const buf = crypto.randomBytes(CONFIG.ROOM_CODE_LENGTH);
  for (let i = 0; i < CONFIG.ROOM_CODE_LENGTH; i++) code += chars[buf[i] % chars.length];
  return code;
}
function generateSessionToken() { return crypto.randomBytes(24).toString('hex'); }

function createRoom(socket, hostName) {
  let code, attempts = 0;
  do { code = generateRoomCode(); if (++attempts > 20) throw new Error('Code gen'); } while (rooms.has(code));
  const room = new Room(code);
  room.hostToken = generateSessionToken();
  room.hostSocket = socket;
  room.hostName = hostName;
  rooms.set(code, room);
  tokenToRoom.set(room.hostToken, { room, role: 'host' });
  return room;
}

function joinRoom(roomCode, socket, guestName) {
  const room = rooms.get(roomCode.toUpperCase());
  if (!room) throw new Error('Room not found');
  if (room.isFull()) throw new Error('Room full');
  room.guestToken = generateSessionToken();
  room.guestSocket = socket;
  room.guestName = guestName;
  tokenToRoom.set(room.guestToken, { room, role: 'guest' });
  room.touch();
  return room;
}

function removeRoom(code) {
  const room = rooms.get(code); if (!room) return;
  room.destroy();
  if (room.hostToken) tokenToRoom.delete(room.hostToken);
  if (room.guestToken) tokenToRoom.delete(room.guestToken);
  rooms.delete(code);
  logInfo('ROOM', 'cleaned ' + code);
}

setInterval(() => {
  const now = Date.now();
  const toRemove = [];
  rooms.forEach((room, code) => { if (now - room.lastActivity > CONFIG.ROOM_TIMEOUT_MS) toRemove.push(code); });
  toRemove.forEach(removeRoom);
}, 60000);

function checkRateLimit(room, role) {
  const now = Date.now();
  if (now - room.actionWindowStart[role] > CONFIG.RATE_LIMIT_WINDOW_MS) {
    room.actionWindowStart[role] = now;
    room.actionCounter[role] = 0;
  }
  room.actionCounter[role]++;
  return room.actionCounter[role] <= CONFIG.RATE_LIMIT_MAX_ACTIONS;
}

function logInfo(tag, msg) { console.log('[' + new Date().toISOString() + '] [' + tag + '] ' + msg); }
function logError(tag, msg, err) { console.error('[' + new Date().toISOString() + '] [' + tag + '] ' + msg, err || ''); }
function safeSend(socket, payload) {
  if (socket && socket.readyState === 1) {
    try { socket.send(JSON.stringify(payload)); } catch (_) {}
  }
}

/* ===== EXPRESS ===== */
const app = express();
const distPath = path.join(__dirname, 'dist');
const hasDist = fs.existsSync(path.join(distPath, 'index.html'));

if (hasDist) {
  app.use(express.static(distPath));
  console.log('[SERVER] Serving client from dist/');
} else {
  console.log('[SERVER] WARNING: dist/ missing');
}
app.use(express.static(__dirname));

app.get('/health', (req, res) => res.json({ ok: true, rooms: rooms.size }));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/ws')) return next();
  const indexPath = hasDist
    ? path.join(distPath, 'index.html')
    : path.join(__dirname, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) res.status(500).send('Build missing');
  });
});

/* ===== WS ===== */
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: CONFIG.MAX_PAYLOAD_SIZE });

wss.on('connection', socket => {
  socket.role = null; socket.roomCode = null; socket.token = null; socket.isAlive = true;
  logInfo('WS', 'new connection');
  socket.on('pong', () => { socket.isAlive = true; });
  socket.on('message', raw => {
    let payload;
    try { payload = JSON.parse(raw.toString()); }
    catch (_) { safeSend(socket, { type: 'ERROR', message: 'Invalid JSON' }); return; }
    if (!payload || typeof payload.type !== 'string') {
      safeSend(socket, { type: 'ERROR', message: 'Missing type' }); return;
    }
    try { handleMessage(socket, payload); }
    catch (err) {
      logError('MSG', err.message || 'error');
      safeSend(socket, { type: 'ERROR', message: err.message || 'Server error' });
    }
  });
  socket.on('close', () => handleDisconnect(socket));
  socket.on('error', err => logError('WS', err));
});

setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) { try { ws.terminate(); } catch (_) {} return; }
    ws.isAlive = false;
    try { ws.ping(); } catch (_) {}
  });
}, 30000);

function handleMessage(socket, payload) {
  const type = payload.type;

  if (type === 'CREATE_ROOM') {
    if (socket.roomCode) throw new Error('Already in room');
    const name = (typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim().slice(0, 24) : 'Խաղացող 1');
    const room = createRoom(socket, name);
    socket.role = 'host'; socket.roomCode = room.code; socket.token = room.hostToken;
    safeSend(socket, { type: 'ROOM_CREATED', roomId: room.code, playerId: 'you', token: room.hostToken });
    return;
  }

  if (type === 'JOIN_ROOM') {
    if (socket.roomCode) throw new Error('Already in room');
    if (typeof payload.roomId !== 'string') throw new Error('Missing roomId');
    const name = (typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim().slice(0, 24) : 'Խաղացող 2');
    const room = joinRoom(payload.roomId, socket, name);
    socket.role = 'guest'; socket.roomCode = room.code; socket.token = room.guestToken;
    safeSend(socket, { type: 'ROOM_JOINED', roomId: room.code, playerId: 'opponent', token: room.guestToken });
    room.sendToRole('host', { type: 'OPPONENT_JOINED', name });
    return;
  }

  if (type === 'RECONNECT') {
    if (typeof payload.token !== 'string') throw new Error('Missing token');
    const entry = tokenToRoom.get(payload.token);
    if (!entry) throw new Error('Invalid token');
    const room = entry.room; const role = entry.role;
    if (role === 'host') {
      room.hostSocket = socket;
      if (room.hostDisconnectTimer) { clearTimeout(room.hostDisconnectTimer); room.hostDisconnectTimer = null; }
      room.disconnectedHost = false;
    } else {
      room.guestSocket = socket;
      if (room.guestDisconnectTimer) { clearTimeout(room.guestDisconnectTimer); room.guestDisconnectTimer = null; }
      room.disconnectedGuest = false;
    }
    socket.role = role; socket.roomCode = room.code; socket.token = payload.token;
    safeSend(socket, { type: 'RECONNECT_OK', roomId: room.code, playerId: role === 'host' ? 'you' : 'opponent' });
    if (room.started && room.engine) safeSend(socket, { type: 'STATE_UPDATE', state: room.buildClientState(role) });
    room.touch();
    return;
  }

  if (type === 'START_GAME') {
    const entry = socket.token ? tokenToRoom.get(socket.token) : null;
    if (!entry) throw new Error('Not in room');
    const room = entry.room;
    if (!room.isFull()) throw new Error('Room not full');
    if (room.started) throw new Error('Game started');
    if (entry.role !== 'host') throw new Error('Only host');
    let target = 151;
    if ([101,151,201,301].includes(payload.target)) target = payload.target;
    room.startGame(target);
    return;
  }

  const entry = socket.token ? tokenToRoom.get(socket.token) : null;
  if (!entry) throw new Error('Not in room');
  const room = entry.room; const role = entry.role;
  if (!room.started || !room.engine) throw new Error('Game not started');
  if (!checkRateLimit(room, role)) { safeSend(socket, { type: 'ERROR', message: 'Rate limit' }); return; }

  const myPlayerId = role === 'host' ? 'you' : 'opponent';
  const e = room.engine;

  if (payload.actionId && room.processedActions.has(payload.actionId)) {
    safeSend(socket, { type: 'ERROR', message: 'Duplicate' }); return;
  }
  if (payload.actionId) {
    room.processedActions.add(payload.actionId);
    if (room.processedActions.size > 500) {
      room.processedActions.delete(room.processedActions.values().next().value);
    }
  }

  const cur = e.getCurrentPlayer();
  if (['BID','PASS','PLAY_CARD'].includes(type) && (e.phase === PHASES.AUCTION || e.phase === PHASES.TRICK_PLAY) && cur.id !== myPlayerId) {
    safeSend(socket, { type: 'ERROR', message: 'Not your turn' }); return;
  }

  try {
    if (type === 'BID') {
      if (e.phase !== PHASES.AUCTION) throw new Error('Auction ended');
      const suit = payload.suit === null || payload.suit === undefined ? null : payload.suit;
      e.makeBid(myPlayerId, parseInt(payload.value, 10), suit);
    } else if (type === 'PASS') {
      if (e.phase !== PHASES.AUCTION) throw new Error('Auction ended');
      e.passBid(myPlayerId);
    } else if (type === 'PLAY_CARD') {
      if (e.phase !== PHASES.TRICK_PLAY) throw new Error('Not trick phase');
      if (typeof payload.cardId !== 'string') throw new Error('Missing cardId');
      e.playCard(myPlayerId, payload.cardId);
    } else if (type === 'KONTRA') {
      if (e.multiplier !== 1) throw new Error('Kontra exists');
      const bidder = e.players.find(p => p.id === e.highestBidderId);
      if (!bidder) throw new Error('No bidder');
      const myTeam = e.players.find(p => p.id === myPlayerId).team;
      if (bidder.team === myTeam) throw new Error('Cannot');
      e.multiplier = 2; e.kontraByTeam = myTeam; e.stateVersion++;
    } else if (type === 'REKONTRA') {
      if (e.multiplier !== 2) throw new Error('Need kontra');
      const myTeam = e.players.find(p => p.id === myPlayerId).team;
      if (e.kontraByTeam === myTeam) throw new Error('Cannot');
      e.multiplier = 4; e.rekontraByTeam = myTeam; e.stateVersion++;
    } else if (type === 'NEXT_ROUND') {
      if (e.winner !== null) throw new Error('Game ended');
      e.startNextRound(true);
    } else if (type === 'PING') {
      safeSend(socket, { type: 'PONG', time: Date.now() }); return;
    } else if (type === 'LEAVE_ROOM') {
      handleDisconnect(socket); return;
    } else {
      throw new Error('Unknown: ' + type);
    }
  } catch (err) {
    safeSend(socket, { type: 'ERROR', message: err.message || 'Invalid action' });
    return;
  }

  room.touch();
  room.pushState();
  room.scheduleNextTurn();
}

function handleDisconnect(socket) {
  const token = socket.token;
  const roomCode = socket.roomCode;
  const role = socket.role;
  socket.token = null; socket.roomCode = null; socket.role = null;
  if (!token || !roomCode) return;
  const entry = tokenToRoom.get(token);
  if (!entry) return;
  const room = entry.room;
  logInfo('WS', 'disconnect: ' + role + ' · ' + room.code);
  if (role === 'host') {
    room.disconnectedHost = true; room.hostSocket = null;
    room.sendToRole('guest', { type: 'OPPONENT_LEFT' });
  } else {
    room.disconnectedGuest = true; room.guestSocket = null;
    room.sendToRole('host', { type: 'OPPONENT_LEFT' });
  }
  const timer = setTimeout(() => {
    if (role === 'host' && room.disconnectedHost) removeRoom(room.code);
    else if (role === 'guest' && room.disconnectedGuest) removeRoom(room.code);
  }, CONFIG.DISCONNECT_GRACE_MS);
  if (role === 'host') room.hostDisconnectTimer = timer;
  else room.guestDisconnectTimer = timer;
}

/* ===== START ===== */
const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  logInfo('SERVER', '═══════════════════════════════════════');
  logInfo('SERVER', '  ԲԱԶԱՌ-ԲԼՈՏ · SANI GROUP');
  logInfo('SERVER', '  Port ' + PORT);
  logInfo('SERVER', '═══════════════════════════════════════');
});

process.on('uncaughtException', err => logError('FATAL', err.message));
process.on('unhandledRejection', r => logError('FATAL', String(r)));

export { app, server, RulesEngine, Room };
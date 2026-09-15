/* BAZAR-BLOT - Online Module - SANI GROUP */

import { RulesEngine, Player, Card, PHASES } from './game-core.js';

let callbacks = {
  showToast: function() {},
  showScreen: function() {},
  getEngine: function() { return null; },
  setEngine: function() {},
  getGameMode: function() { return 'bot'; },
  setGameMode: function() {},
  setMyPlayerId: function() {},
  particles: { spawn: function() {} }
};

export function setCallbacks(cb) {
  callbacks = Object.assign({}, callbacks, cb);
}

export var Online = {
  socket: null,
  roomId: null,
  playerId: null,
  token: null,
  isHost: false,
  role: null,
  reconnectAttempts: 0,
  playerName: 'Player',
  pingTimer: null,

  init: function() {
    var self = this;
    var btnJoin = document.getElementById('btn-join-room');
    if (btnJoin) {
      btnJoin.addEventListener('click', function() {
        var input = document.getElementById('input-join-code');
        if (input) input.focus();
      });
    }
    var btnDoJoin = document.getElementById('btn-do-join');
    if (btnDoJoin) {
      btnDoJoin.addEventListener('click', function() {
        var input = document.getElementById('input-join-code');
        if (!input) return;
        var code = input.value.trim().toUpperCase();
        if (code.length !== 6) {
          callbacks.showToast('Enter 6-char code', 'error');
          return;
        }
        self.joinRoom(code);
      });
    }
    var inputCode = document.getElementById('input-join-code');
    if (inputCode) {
      inputCode.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          var code = inputCode.value.trim().toUpperCase();
          if (code.length === 6) self.joinRoom(code);
        }
      });
    }
    try {
      this.token = sessionStorage.getItem('bb_token') || null;
    } catch (e) {}
  },

  connect: function() {
    var self = this;
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    return new Promise(function(resolve, reject) {
      try {
        var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        var host = location.host || 'localhost:3000';
        self.socket = new WebSocket(proto + '//' + host + '/ws');
        self.socket.addEventListener('open', function() {
          self.reconnectAttempts = 0;
          if (self.token && self.roomId) {
            self.send({ type: 'RECONNECT', token: self.token });
          }
          self.startPing();
          resolve();
        });
        self.socket.addEventListener('message', function(e) { self.handleMessage(e); });
        self.socket.addEventListener('close', function() { self.handleClose(); });
        self.socket.addEventListener('error', function(err) { reject(err); });
      } catch (e) {
        reject(e);
      }
    });
  },

  startPing: function() {
    var self = this;
    this.stopPing();
    this.pingTimer = setInterval(function() { self.send({ type: 'PING' }); }, 20000);
  },

  stopPing: function() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  },

  handleMessage: function(evt) {
    var msg;
    try { msg = JSON.parse(evt.data); } catch (e) { return; }
    switch (msg.type) {
      case 'ROOM_CREATED':
        this.roomId = msg.roomId;
        this.playerId = msg.playerId;
        this.token = msg.token;
        this.role = 'host';
        this.isHost = true;
        try { sessionStorage.setItem('bb_token', msg.token); } catch (e) {}
        var el1 = document.getElementById('lobby-room-code');
        if (el1) el1.textContent = msg.roomId;
        this.updateLobbyStatus(1);
        break;
      case 'ROOM_JOINED':
        this.roomId = msg.roomId;
        this.playerId = msg.playerId;
        this.token = msg.token;
        this.role = 'guest';
        this.isHost = false;
        try { sessionStorage.setItem('bb_token', msg.token); } catch (e) {}
        var el2 = document.getElementById('lobby-room-code');
        if (el2) el2.textContent = msg.roomId;
        this.updateLobbyStatus(2);
        break;
      case 'RECONNECT_OK':
        this.roomId = msg.roomId;
        this.playerId = msg.playerId;
        callbacks.showToast('Reconnected', 'success');
        break;
      case 'OPPONENT_JOINED':
        this.updateLobbyStatus(2);
        callbacks.showToast('Opponent joined', 'success');
        break;
      case 'OPPONENT_LEFT':
        callbacks.showToast('Opponent left', 'error');
        var s = document.getElementById('lobby-opp-status');
        if (s) { s.textContent = 'LEFT'; s.className = 'text-red-400 text-xs font-bold'; }
        this.disableStart();
        break;
      case 'GAME_START':
        this.enterGame();
        break;
      case 'STATE_UPDATE':
        this.applyServerState(msg.state);
        break;
      case 'ERROR':
        callbacks.showToast(msg.message || 'Error', 'error');
        break;
    }
  },

  enterGame: function() {
    callbacks.setGameMode('online');
    callbacks.showScreen('game');
  },

  applyServerState: function(state) {
    if (!state) return;
    var e = callbacks.getEngine() || new RulesEngine();
    e.phase = state.phase;
    e.roundNumber = state.roundNumber;
    e.gameTarget = state.gameTarget;
    e.dealerIndex = state.dealerIndex;
    e.currentTurnIndex = state.currentTurnIndex;
    e.trumpSuit = state.trumpSuit;
    e.contract = state.contract;
    e.multiplier = state.multiplier;
    e.highestBid = state.highestBid;
    e.highestBidderId = state.highestBidderId;
    e.passCount = state.passCount;
    e.tricksWon = state.tricksWon || { A: 0, B: 0 };
    e.pointsWon = state.pointsWon || { A: 0, B: 0 };
    e.winner = state.winner;
    e.lastRoundResult = state.lastRoundResult;
    e.kontraByTeam = state.kontraByTeam;
    e.rekontraByTeam = state.rekontraByTeam;
    e.stateVersion = state.stateVersion;
    e.trick = (state.trick || []).map(function(t) {
      return { playerId: t.playerId, card: Card.fromJSON(t.card) };
    });
    e.players = (state.players || []).map(function(p) {
      var pl = new Player(p.id, p.name, p.seat, p.team, p.isBot);
      pl.score = p.score;
      pl.tricksWon = p.tricksWon;
      pl.combinations = [];
      if (p.hand) {
        pl.hand = p.hand.map(function(c) { return c ? Card.fromJSON(c) : null; }).filter(Boolean);
      } else {
        pl.hand = [];
        for (var i = 0; i < (p.handCount || 0); i++) pl.hand.push(null);
      }
      return pl;
    });
    if (state.myPlayerId) callbacks.setMyPlayerId(state.myPlayerId);
    callbacks.setEngine(e);
    if (window.BB && window.BB.UI) {
      window.BB.UI.renderAll();
      window.BB.UI.syncTurnTimer();
    }
    if (e.phase === PHASES.GAME_END) {
      setTimeout(function() {
        if (window.BB && window.BB.UI) window.BB.UI.showFinalResult();
      }, 700);
    } else if (e.phase === PHASES.ROUND_SCORE || e.phase === PHASES.GAME_SCORE) {
      setTimeout(function() {
        if (window.BB && window.BB.UI) {
          if (e.phase === PHASES.GAME_END) window.BB.UI.showFinalResult();
          else window.BB.UI.showRoundResult();
        }
      }, 700);
    }
  },

  handleClose: function() {
    var self = this;
    this.stopPing();
    if (callbacks.getGameMode() === 'online' && document.body.dataset.screen === 'game') {
      callbacks.showToast('Connection lost', 'error');
      if (this.roomId && this.token && this.reconnectAttempts < 3) {
        this.reconnectAttempts++;
        setTimeout(function() { self.connect().catch(function() {}); }, 2000 * self.reconnectAttempts);
        return;
      }
      callbacks.showScreen('menu');
    }
    this.socket = null;
  },

  send: function(payload) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      try { this.socket.send(JSON.stringify(payload)); } catch (e) {}
    }
  },

  enterLobby: function() {
    var self = this;
    callbacks.showScreen('lobby');
    this.connect().then(function() {
      self.send({ type: 'CREATE_ROOM', name: self.playerName });
    }).catch(function() {
      callbacks.showToast('Cannot connect to server', 'error');
      var code = Math.random().toString(36).slice(2, 8).toUpperCase();
      var el = document.getElementById('lobby-room-code');
      if (el) el.textContent = code;
    });
  },

  joinRoom: function(roomCode) {
    var self = this;
    callbacks.showScreen('lobby');
    this.connect().then(function() {
      self.send({ type: 'JOIN_ROOM', roomId: roomCode, name: self.playerName });
    }).catch(function() {
      callbacks.showToast('Cannot connect to server', 'error');
    });
  },

  leaveLobby: function() {
    if (this.socket) {
      this.send({ type: 'LEAVE_ROOM' });
      try { this.socket.close(); } catch (e) {}
    }
    this.socket = null;
    this.roomId = null;
    this.token = null;
    this.role = null;
    this.playerId = null;
    this.isHost = false;
    try { sessionStorage.removeItem('bb_token'); } catch (e) {}
    callbacks.showScreen('menu');
  },

  updateLobbyStatus: function(count) {
    var you = document.getElementById('lobby-you-status');
    var opp = document.getElementById('lobby-opp-status');
    if (you) {
      you.textContent = 'READY';
      you.className = 'text-neon-green text-xs font-black';
    }
    if (count >= 2) {
      if (opp) {
        opp.textContent = 'JOINED';
        opp.className = 'text-neon-green text-xs font-black';
      }
      this.enableStart();
    } else {
      if (opp) {
        opp.textContent = 'WAITING...';
        opp.className = 'text-neon-gold text-xs font-black animate-pulse';
      }
      this.disableStart();
    }
  },

  enableStart: function() {
    var self = this;
    var btn = document.getElementById('btn-lobby-start');
    if (!btn) return;
    btn.disabled = false;
    btn.onclick = function() {
      self.send({ type: 'START_GAME', target: 151 });
    };
  },

  disableStart: function() {
    var btn = document.getElementById('btn-lobby-start');
    if (!btn) return;
    btn.disabled = true;
    btn.onclick = null;
  },

  sendBid: function(value, suit) {
    this.send({ type: 'BID', value: value, suit: suit, actionId: this.genActionId() });
  },
  sendPass: function() {
    this.send({ type: 'PASS', actionId: this.genActionId() });
  },
  sendPlayCard: function(cardId) {
    this.send({ type: 'PLAY_CARD', cardId: cardId, actionId: this.genActionId() });
  },
  sendKontra: function() {
    this.send({ type: 'KONTRA', actionId: this.genActionId() });
  },
  sendRekontra: function() {
    this.send({ type: 'REKONTRA', actionId: this.genActionId() });
  },
  sendNextRound: function() {
    this.send({ type: 'NEXT_ROUND', actionId: this.genActionId() });
  },

  genActionId: function() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
};
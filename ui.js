/* ============================================================================
 * ԲԱԶԱՌ-ԲԼՈՏ — UI Controller
 * SANI GROUP
 * ============================================================================ */

import {
  RulesEngine, Player, BotAI, Card,
  SUITS, RANKS, RANK_ORDER, PHASES, CONFIG,
  TRUMP_VALUES, NON_TRUMP_VALUES, TRUMP_STRENGTH, NON_TRUMP_STRENGTH,
  SUIT_NAMES_HY
} from './game-core.js';
import { Online } from './online.js';

export {
  PHASES, CONFIG, SUITS, RANKS, RANK_ORDER, SUIT_NAMES_HY,
  TRUMP_VALUES, NON_TRUMP_VALUES, TRUMP_STRENGTH, NON_TRUMP_STRENGTH
};

/* ===== PARTICLES ===== */
const particles = {
  layer: null,
  init() { this.layer = document.getElementById('particle-layer'); },
  spawn(x, y, color, count) {
    count = count || 18;
    if (!this.layer) return;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'particle' + (Math.random() > 0.5 ? ' spark' : '');
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6;
      const dist = 60 + Math.random() * 140;
      p.style.left = x + 'px';
      p.style.top = y + 'px';
      p.style.background = color;
      p.style.boxShadow = '0 0 12px ' + color + ', 0 0 24px ' + color;
      p.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
      p.style.setProperty('--dy', Math.sin(angle) * dist + 'px');
      this.layer.appendChild(p);
      setTimeout(() => p.remove(), 950);
    }
  }
};

/* ===== UI ===== */
export const UI = {
  engine: null,
  bots: {},
  selectedCardId: null,
  gameMode: 'bot',
  myPlayerId: 'you',
  turnTimer: null,
  timerInterval: null,
  turnStartTime: 0,
  bubbleTimeouts: {},
  particles,

  /* ---- SCREEN ---- */
  showScreen(name) {
    const screens = ['menu', 'target', 'lobby', 'game'];
    screens.forEach(s => {
      const el = document.getElementById('screen-' + s);
      if (el) el.classList.toggle('active', s === name);
    });
    document.body.dataset.screen = name;
  },

  /* ---- INIT ---- */
  init() {
    particles.init();

    const btnBot = document.getElementById('btn-mode-bot');
    if (btnBot) btnBot.addEventListener('click', () => this.showScreen('target'));

    const btnOnline = document.getElementById('btn-mode-online');
    if (btnOnline) btnOnline.addEventListener('click', () => Online.enterLobby());

    const btnRules = document.getElementById('btn-show-rules');
    if (btnRules) btnRules.addEventListener('click', () => this.showRules());

    const btnLobbyBack = document.getElementById('btn-lobby-back');
    if (btnLobbyBack) btnLobbyBack.addEventListener('click', () => Online.leaveLobby());

    const btnExit = document.getElementById('btn-exit-game');
    if (btnExit) btnExit.addEventListener('click', () => this.confirmExit());

    document.querySelectorAll('.target-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = parseInt(btn.dataset.target, 10);
        if (this.particles.layer) {
          const rect = btn.getBoundingClientRect();
          this.particles.spawn(rect.left + rect.width / 2, rect.top + rect.height / 2, '#ffd166', 20);
        }
        btn.style.transform = 'scale(0.95)';
        setTimeout(() => { btn.style.transform = ''; this.selectTarget(t); }, 150);
      });
    });

    document.querySelectorAll('[data-back]').forEach(btn => {
      btn.addEventListener('click', () => this.showScreen(btn.dataset.back));
    });

    const btnCopy = document.getElementById('btn-copy-code');
    if (btnCopy) btnCopy.addEventListener('click', () => {
      const codeEl = document.getElementById('lobby-room-code');
      const code = codeEl && codeEl.textContent && codeEl.textContent.trim();
      if (code && code !== '------' && navigator.clipboard) {
        navigator.clipboard.writeText(code).then(() => {
          btnCopy.textContent = '✓ ՊԱՏՃԵՆՎԵՑ';
          setTimeout(() => btnCopy.textContent = '📋 ՊԱՏՃԵՆԵԼ', 1500);
        });
      }
    });

    this.showScreen('menu');
  },

  /* ---- GAME INIT ---- */
  selectTarget(target) {
    this.engine = new RulesEngine();
    this.engine.gameTarget = target;
    const hud = document.getElementById('hud-target');
    if (hud) hud.textContent = String(target);
    this.startBotGame();
  },

  startBotGame() {
    const e = this.engine;
    e.players = [
      new Player('you', 'Դուք', 0, 'A', false),
      new Player('partner', 'ԲՈՏ ՊԱՐՏՆԵՐ', 1, 'A', true),
      new Player('bot1', 'ԲՈՏ 1', 2, 'B', true),
      new Player('bot2', 'ԲՈՏ 2', 3, 'B', true)
    ];
    e.dealerIndex = Math.floor(Math.random() * 4);
    e.deal();

    this.bots = {
      partner: new BotAI(e, 'partner'),
      bot1: new BotAI(e, 'bot1'),
      bot2: new BotAI(e, 'bot2')
    };

    this.gameMode = 'bot';
    this.myPlayerId = 'you';
    this.selectedCardId = null;

    const ht = document.getElementById('hud-target');
    if (ht) ht.textContent = String(e.gameTarget);
    const hr = document.getElementById('hud-round');
    if (hr) hr.textContent = String(e.roundNumber);

    this.showScreen('game');
    this.renderAll();
    this.scheduleNextTurn();
  },

  /* ---- SCHEDULING ---- */
  scheduleNextTurn() {
    this.clearTimers();
    const e = this.engine;
    if (!e) return;
    if (this.gameMode === 'online') return;

    if (e.phase === PHASES.GAME_END) {
      setTimeout(() => this.showFinalResult(), 900);
      return;
    }
    if (e.phase === PHASES.ROUND_SCORE || e.phase === PHASES.GAME_SCORE) {
      setTimeout(() => {
        if (e.phase === PHASES.GAME_END) this.showFinalResult();
        else this.showRoundResult();
      }, 900);
      return;
    }

    const cur = e.players[e.currentTurnIndex];
    if (!cur) return;

    if (e.phase === PHASES.AUCTION) {
      if (cur.isBot) {
        const d = CONFIG.BOT_THINK_MIN_MS + Math.random() * (CONFIG.BOT_THINK_MAX_MS - CONFIG.BOT_THINK_MIN_MS);
        this.turnTimer = setTimeout(() => this.runBotBid(cur), d);
      } else { this.startTurnTimer(); this.renderActionPanel(); }
    } else if (e.phase === PHASES.BONUS_DECLARATION) {
      this.turnTimer = setTimeout(() => {
        this.processAllCombinations();
        e.phase = PHASES.TRICK_PLAY;
        this.renderAll();
        this.scheduleNextTurn();
      }, 800);
    } else if (e.phase === PHASES.TRICK_PLAY) {
      if (cur.isBot) {
        const d = CONFIG.BOT_THINK_MIN_MS + Math.random() * (CONFIG.BOT_THINK_MAX_MS - CONFIG.BOT_THINK_MIN_MS);
        this.turnTimer = setTimeout(() => this.runBotPlay(cur), d);
      } else { this.startTurnTimer(); this.renderActionPanel(); }
    }
  },

  processAllCombinations() {
    const e = this.engine;
    e.players.forEach(p => {
      if (p.combinations && p.combinations.length) {
        p.combinations.forEach((combo, idx) => {
          try { e.declareCombination(p.id, idx); } catch (_) {}
        });
      }
    });
  },

  /* ---- TIMERS ---- */
  startTurnTimer() {
    this.clearTimers();
    this.turnStartTime = Date.now();
    const bar = document.getElementById('turn-timer');
    if (bar) bar.style.width = '100%';
    this.timerInterval = setInterval(() => {
      const elapsed = Date.now() - this.turnStartTime;
      const remaining = Math.max(0, CONFIG.TURN_TIME_MS - elapsed);
      const pct = (remaining / CONFIG.TURN_TIME_MS) * 100;
      const barEl = document.getElementById('turn-timer');
      if (barEl) barEl.style.width = pct + '%';
      if (remaining <= 0) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
        this.handleTimeout();
      }
    }, 100);
  },

  handleTimeout() {
    const e = this.engine;
    if (!e) return;
    const cur = e.getCurrentPlayer();
    if (!cur || cur.id !== this.myPlayerId) return;

    if (this.gameMode === 'online') {
      if (e.phase === PHASES.AUCTION) Online.sendPass();
      else if (e.phase === PHASES.TRICK_PLAY) {
        const legal = e.getLegalCards(this.myPlayerId);
        if (legal.length > 0) Online.sendPlayCard(legal[0].id);
      }
      return;
    }

    if (e.phase === PHASES.AUCTION) this.playerPass();
    else if (e.phase === PHASES.TRICK_PLAY) {
      const legal = e.getLegalCards(this.myPlayerId);
      if (legal.length > 0) this.playCard(legal[0].id);
    }
  },

  clearTimers() {
    if (this.turnTimer) { clearTimeout(this.turnTimer); this.turnTimer = null; }
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
  },

  /* ---- BOT ACTIONS ---- */
  runBotBid(botPlayer) {
    const e = this.engine;
    const ai = this.bots[botPlayer.id];
    if (!ai || e.phase !== PHASES.AUCTION) return;
    const bid = ai.decideBid();
    try {
      if (bid === null) {
        this.showBubble(botPlayer.seat, 'Լավ եմ', 'pass');
        e.passBid(botPlayer.id);
      } else {
        e.makeBid(botPlayer.id, bid.value, bid.suit);
        const label = bid.suit === null ? 'ԲՈՅ' : bid.suit;
        this.showBubble(botPlayer.seat, bid.value + ' ' + label, 'bid');
      }
    } catch (err) {
      try { e.passBid(botPlayer.id); this.showBubble(botPlayer.seat, 'Լավ եմ', 'pass'); } catch (_) {}
    }
    this.renderAll();
    this.scheduleNextTurn();
  },

  runBotPlay(botPlayer) {
    const e = this.engine;
    const ai = this.bots[botPlayer.id];
    if (!ai || e.phase !== PHASES.TRICK_PLAY) return;
    const legal = e.getLegalCards(botPlayer.id);
    if (!legal.length) return;
    let card = ai.decideCard();
    if (!card || !legal.some(c => c.id === card.id)) card = legal[0];
    try {
      e.playCard(botPlayer.id, card.id);
      this.renderAll();
      this.scheduleNextTurn();
    } catch (err) {
      try { e.playCard(botPlayer.id, legal[0].id); this.renderAll(); this.scheduleNextTurn(); } catch (_) {}
    }
  },

  /* ---- PLAYER ACTIONS ---- */
  playCard(cardId) {
    if (this.gameMode === 'online') {
      Online.sendPlayCard(cardId);
      this.selectedCardId = null;
      this.renderHands();
      this.renderActionPanel();
      return;
    }
    const e = this.engine;
    if (!e || e.phase !== PHASES.TRICK_PLAY) return;
    if (e.getCurrentPlayer().id !== this.myPlayerId) return;
    try {
      e.playCard(this.myPlayerId, cardId);
      this.selectedCardId = null;
      this.clearTimers();
      const bar = document.getElementById('turn-timer');
      if (bar) bar.style.width = '0%';
      if (this.particles.layer) {
        const el = document.getElementById('table-cards');
        if (el) {
          const rect = el.getBoundingClientRect();
          this.particles.spawn(rect.left + rect.width / 2, rect.top + rect.height / 2, '#ffd166', 14);
        }
      }
      this.renderAll();
      this.scheduleNextTurn();
    } catch (err) {
      this.showToast(err.message || 'Սխալ', 'error');
    }
  },

  playerBid(value, suit) {
    if (this.gameMode === 'online') {
      Online.sendBid(value, suit);
      this.clearTimers();
      return;
    }
    const e = this.engine;
    if (!e || e.phase !== PHASES.AUCTION) return;
    if (e.getCurrentPlayer().id !== this.myPlayerId) return;
    try {
      e.makeBid(this.myPlayerId, value, suit);
      const label = suit === null ? 'ԲՈՅ' : suit;
      const me = e.players.find(p => p.id === this.myPlayerId);
      this.showBubble(me ? me.seat : 0, value + ' ' + label, 'bid');
      this.clearTimers();
      this.renderAll();
      this.scheduleNextTurn();
    } catch (err) {
      this.showToast(err.message || 'Սխալ', 'error');
    }
  },

  playerPass() {
    if (this.gameMode === 'online') {
      Online.sendPass();
      this.clearTimers();
      return;
    }
    const e = this.engine;
    if (!e || e.phase !== PHASES.AUCTION) return;
    if (e.getCurrentPlayer().id !== this.myPlayerId) return;
    try {
      e.passBid(this.myPlayerId);
      const me = e.players.find(p => p.id === this.myPlayerId);
      this.showBubble(me ? me.seat : 0, 'Լավ եմ', 'pass');
      this.clearTimers();
      this.renderAll();
      this.scheduleNextTurn();
    } catch (err) {
      this.showToast(err.message || 'Սխալ', 'error');
    }
  },

  playerKontra() {
    if (this.gameMode === 'online') { Online.sendKontra(); return; }
    const e = this.engine;
    if (!e) return;
    if (e.multiplier !== 1) { this.showToast('Քուանշն արդեն կա', 'error'); return; }
    const me = e.players.find(p => p.id === this.myPlayerId);
    const myTeam = me.team;
    const bidder = e.players.find(p => p.id === e.highestBidderId);
    if (!bidder) return;
    if (bidder.team === myTeam) { this.showToast('Չեք կարող Քուանշ հայտարարել սեփական հայտի դեմ', 'error'); return; }
    e.multiplier = 2;
    e.kontraByTeam = myTeam;
    this.showBubble(me.seat, 'ՔՈՒԱՆՇ ×2', 'kontra');
    this.renderAll();
  },

  playerRekontra() {
    if (this.gameMode === 'online') { Online.sendRekontra(); return; }
    const e = this.engine;
    if (!e) return;
    if (e.multiplier !== 2) { this.showToast('Սուրին նախ պետք է Քուանշ', 'error'); return; }
    const me = e.players.find(p => p.id === this.myPlayerId);
    const myTeam = me.team;
    if (e.kontraByTeam === myTeam) { this.showToast('Չեք կարող Սուր հայտարարել սեփական Քուանշի դեմ', 'error'); return; }
    e.multiplier = 4;
    e.rekontraByTeam = myTeam;
    this.showBubble(me.seat, 'ՍՈՒՐ ×4', 'kontra');
    this.renderAll();
  },

  /* ---- RENDER ---- */
  renderAll() {
    const e = this.engine;
    if (!e) return;
    const el = (id) => document.getElementById(id);
    if (el('hud-target')) el('hud-target').textContent = String(e.gameTarget);
    if (el('hud-round')) el('hud-round').textContent = String(e.roundNumber);
    if (el('hud-score-a')) el('hud-score-a').textContent = String(e.getTeamScore('A'));
    if (el('hud-score-b')) el('hud-score-b').textContent = String(e.getTeamScore('B'));
    if (el('hud-trump')) {
      if (e.trumpSuit) el('hud-trump').textContent = e.trumpSuit;
      else if (e.contract && e.contract.suit === null) el('hud-trump').textContent = 'ԲՈՅ';
      else el('hud-trump').textContent = '—';
    }
    if (el('hud-bid')) {
      if (e.highestBid > 0) el('hud-bid').textContent = e.highestBid + ' ×' + e.multiplier;
      else el('hud-bid').textContent = '—';
    }
    this.renderSeats();
    this.renderHands();
    this.renderTable();
    this.renderActionPanel();
  },

  getSeatPosition(player) {
    const me = this.engine && this.engine.players.find(p => p.id === this.myPlayerId);
    if (!me) return 'bottom';
    const rel = (player.seat - me.seat + 4) % 4;
    return ['bottom', 'left', 'top', 'right'][rel];
  },

  renderSeats() {
    const e = this.engine;
    e.players.forEach(p => {
      const pos = this.getSeatPosition(p);
      const nameEl = document.getElementById('seat-' + pos + '-name');
      const infoEl = document.getElementById('seat-' + pos + '-info');
      if (nameEl) nameEl.textContent = p.name;
      if (infoEl) {
        let text = p.hand.length + ' քարտ';
        if (p.id === this.myPlayerId) text += ' · ' + p.score;
        infoEl.textContent = text;
      }
      const seatEl = document.getElementById('seat-' + pos);
      if (seatEl) {
        seatEl.classList.remove('active');
        seatEl.classList.remove('glow-pulse');
      }
    });
    const cur = e.getCurrentPlayer();
    const activePhases = [PHASES.AUCTION, PHASES.BONUS_DECLARATION, PHASES.TRICK_PLAY];
    if (cur && activePhases.includes(e.phase)) {
      const pos = this.getSeatPosition(cur);
      const el = document.getElementById('seat-' + pos);
      if (el) {
        el.classList.add('active');
        if (cur.id === this.myPlayerId) el.classList.add('glow-pulse');
      }
    }
  },

  renderHands() {
    const e = this.engine;
    e.players.forEach(p => {
      const pos = this.getSeatPosition(p);
      const container = document.getElementById('hand-' + pos);
      if (!container) return;
      container.innerHTML = '';

      if (p.id === this.myPlayerId) {
        const isMyTurn = e.getCurrentPlayer().id === this.myPlayerId && e.phase === PHASES.TRICK_PLAY;
        const legalSet = isMyTurn ? this.buildSet(e.getLegalCards(this.myPlayerId)) : null;
        const sorted = p.hand.slice().sort((a, b) => {
          if (!a || !b) return 0;
          const sDiff = SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
          if (sDiff !== 0) return sDiff;
          return RANK_ORDER[b.rank] - RANK_ORDER[a.rank];
        });
        sorted.forEach((card, i) => {
          if (!card) return;
          const el = this.createCardElement(card, true, legalSet, isMyTurn);
          el.style.animationDelay = (i * 0.04) + 's';
          el.classList.add('animate-card-deal');
          container.appendChild(el);
        });
      } else {
        p.hand.forEach(() => {
          const el = document.createElement('div');
          el.className = 'card-back-premium';
          container.appendChild(el);
        });
      }
    });
  },

  buildSet(arr) { const s = {}; arr.forEach(c => s[c.id] = true); return s; },

  createCardElement(card, clickable, legalSet, isMyTurn) {
    const el = document.createElement('div');
    el.className = 'card-premium ' + (card.isRed() ? 'red' : 'black');
    el.dataset.cardId = card.id;
    const isIllegal = legalSet && !legalSet[card.id];
    if (isIllegal) el.classList.add('illegal');
    if (this.selectedCardId === card.id) el.classList.add('selected');
    el.innerHTML =
      '<div class="flex flex-col">' +
        '<span class="rank-top">' + card.rank + '</span>' +
        '<span class="suit-top">' + card.suit + '</span>' +
      '</div>' +
      '<span class="suit-center">' + card.suit + '</span>' +
      '<span class="rank-bottom">' + card.rank + '</span>';

    if (clickable && !isIllegal) {
      el.addEventListener('click', () => {
        if (this.selectedCardId === card.id) this.selectedCardId = null;
        else this.selectedCardId = card.id;
        this.renderHands();
        this.renderActionPanel();
      });
      el.addEventListener('dblclick', () => {
        if (this.engine.phase === PHASES.TRICK_PLAY && this.engine.getCurrentPlayer().id === this.myPlayerId) {
          this.playCard(card.id);
        }
      });
    } else if (clickable && isIllegal && isMyTurn) {
      el.addEventListener('click', () => this.showToast('Այս քարտը հիմա չի կարելի', 'error'));
    }
    return el;
  },

  renderTable() {
    const e = this.engine;
    const container = document.getElementById('table-cards');
    if (!container) return;
    container.innerHTML = '';
    const positionMap = {
      bottom: 'translate(0, 50px)', top: 'translate(0, -50px)',
      left: 'translate(-70px, 0)', right: 'translate(70px, 0)'
    };
    e.trick.forEach(item => {
      const p = e.players.find(pl => pl.id === item.playerId);
      if (!p) return;
      const el = this.createCardElement(item.card, false, null, false);
      el.classList.add('played');
      el.classList.add('animate-card-play');
      const pos = this.getSeatPosition(p);
      el.style.transform = positionMap[pos] || 'translate(0,0)';
      el.style.marginLeft = '-16px';
      container.appendChild(el);
    });
  },

  renderActionPanel() {
    const panel = document.getElementById('action-panel');
    if (!panel) return;
    panel.innerHTML = '';
    const e = this.engine;
    if (!e) return;

    if (e.phase === PHASES.AUCTION) {
      const cur = e.getCurrentPlayer();
      if (cur.id !== this.myPlayerId) {
        panel.innerHTML = '<div class="text-white/60 py-4 text-sm font-semibold">Սպասեք... ' + this.escapeHtml(cur.name) + '</div>';
        return;
      }
      this.renderBidPanel(panel);
      return;
    }
    if (e.phase === PHASES.BONUS_DECLARATION) {
      panel.innerHTML = '<div class="text-white/60 py-4 text-sm font-semibold">Հայտարարվում են կոմբինացիաները...</div>';
      return;
    }
    if (e.phase === PHASES.TRICK_PLAY) {
      const cur = e.getCurrentPlayer();
      if (cur.id !== this.myPlayerId) {
        panel.innerHTML = '<div class="text-white/60 py-4 text-sm font-semibold">Սպասեք... ' + this.escapeHtml(cur.name) + '</div>';
        return;
      }
      this.renderPlayPanel(panel);
      return;
    }
    panel.innerHTML = '<div class="text-white/60 py-4 text-sm font-semibold">Սպասեք...</div>';
  },

  renderBidPanel(panel) {
    const e = this.engine;
    const legal = e.getLegalBids();
    if (!legal.length) {
      panel.innerHTML = '<div class="text-white/60 py-4 text-sm font-semibold">Հայտերն ավարտված են</div>';
      return;
    }
    const minVal = legal[0].value;
    const maxVal = legal[legal.length - 1].value;

    let html = '<div class="flex flex-col items-center gap-3 w-full max-w-3xl">';
    html += '<div class="flex items-center gap-3">';
    html += '<button id="bid-minus" class="btn-premium btn-gold-premium w-12 h-12 text-2xl font-bold" style="padding:0;">−</button>';
    html += '<div id="bid-value" class="bid-display">' + minVal + '</div>';
    html += '<button id="bid-plus" class="btn-premium btn-gold-premium w-12 h-12 text-2xl font-bold" style="padding:0;">+</button>';
    html += '</div>';
    html += '<div class="flex flex-wrap gap-2 justify-center">';
    html += '<button data-suit="" class="bid-suit-btn btn-premium btn-sapphire-premium py-3 px-5 text-sm font-bold">ԲՈՅ</button>';
    html += '<button data-suit="♠" class="bid-suit-btn btn-premium py-3 px-5 text-sm font-bold" style="background:linear-gradient(135deg,#1a1a2e,#0f0f1a);color:#fff;">♠ ՊԻԿ</button>';
    html += '<button data-suit="♥" class="bid-suit-btn btn-premium btn-ruby-premium py-3 px-5 text-sm font-bold">♥ ՍԻՐՏ</button>';
    html += '<button data-suit="♦" class="bid-suit-btn btn-premium py-3 px-5 text-sm font-bold" style="background:linear-gradient(135deg,#c01038,#7a0a1f);color:#fff;">♦ ԱԳՈՒՌ</button>';
    html += '<button data-suit="♣" class="bid-suit-btn btn-premium py-3 px-5 text-sm font-bold" style="background:linear-gradient(135deg,#046b3e,#023d22);color:#fff;">♣ ԽԱՉ</button>';
    html += '</div>';
    html += '<div class="flex gap-2 flex-wrap justify-center">';
    html += '<button id="btn-pass" class="btn-ghost text-sm py-3 px-6">Լավ եմ</button>';
    const canKontra = e.multiplier === 1;
    const canRekontra = e.multiplier === 2;
    html += '<button id="btn-kontra" class="btn-premium btn-ruby-premium text-sm py-3 px-6"' + (!canKontra ? ' disabled' : '') + '>Քուանշ ×2</button>';
    html += '<button id="btn-rekontra" class="btn-premium btn-amethyst-premium text-sm py-3 px-6"' + (!canRekontra ? ' disabled' : '') + '>Սուր ×4</button>';
    html += '</div></div>';

    panel.innerHTML = html;
    const bidValueEl = panel.querySelector('#bid-value');

    panel.querySelector('#bid-minus').addEventListener('click', () => {
      let v = parseInt(bidValueEl.textContent, 10) - CONFIG.BID_INCREMENT;
      if (v < minVal) v = minVal;
      bidValueEl.textContent = String(v);
    });
    panel.querySelector('#bid-plus').addEventListener('click', () => {
      let v = parseInt(bidValueEl.textContent, 10) + CONFIG.BID_INCREMENT;
      if (v > maxVal) v = maxVal;
      bidValueEl.textContent = String(v);
    });
    panel.querySelectorAll('.bid-suit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.suit || '';
        const suit = key === '' ? null : key;
        const value = parseInt(bidValueEl.textContent, 10);
        this.playerBid(value, suit);
      });
    });
    panel.querySelector('#btn-pass').addEventListener('click', () => this.playerPass());
    panel.querySelector('#btn-kontra').addEventListener('click', () => this.playerKontra());
    panel.querySelector('#btn-rekontra').addEventListener('click', () => this.playerRekontra());
  },

  renderPlayPanel(panel) {
    const e = this.engine;
    const canPlay = this.selectedCardId !== null;
    const me = e.players.find(p => p.id === this.myPlayerId);
    const myTeam = me ? me.team : 'A';
    const bidder = e.players.find(p => p.id === e.highestBidderId);
    const canKontra = e.multiplier === 1 && bidder && bidder.team !== myTeam;
    const canRekontra = e.multiplier === 2 && e.kontraByTeam !== myTeam;

    let html = '<div class="flex items-center gap-2 sm:gap-3 flex-wrap justify-center">';
    html += '<button id="btn-play-card" class="btn-premium btn-emerald-premium" style="padding:16px 36px;font-size:17px;"' + (!canPlay ? ' disabled' : '') + '>ԽԱՂԱԼ ՔԱՐՏԸ</button>';
    html += '<button id="btn-hint" class="btn-ghost" style="padding:14px 24px;font-size:15px;">💡 ՀՈՒՇՈՒՄ</button>';
    if (canKontra) html += '<button id="btn-kontra2" class="btn-premium btn-ruby-premium text-sm py-3 px-5">ՔՈՒԱՆՇ ×2</button>';
    if (canRekontra) html += '<button id="btn-rekontra2" class="btn-premium btn-amethyst-premium text-sm py-3 px-5">ՍՈՒՐ ×4</button>';
    html += '</div>';

    panel.innerHTML = html;
    panel.querySelector('#btn-play-card').addEventListener('click', () => this.confirmPlay());
    panel.querySelector('#btn-hint').addEventListener('click', () => this.hint());
    const k2 = panel.querySelector('#btn-kontra2'); if (k2) k2.addEventListener('click', () => this.playerKontra());
    const r2 = panel.querySelector('#btn-rekontra2'); if (r2) r2.addEventListener('click', () => this.playerRekontra());
  },

  confirmPlay() { if (this.selectedCardId) this.playCard(this.selectedCardId); },

  hint() {
    const e = this.engine;
    if (e.phase !== PHASES.TRICK_PLAY) return;
    if (e.getCurrentPlayer().id !== this.myPlayerId) return;
    const legal = e.getLegalCards(this.myPlayerId);
    if (!legal.length) return;
    const me = e.players.find(p => p.id === this.myPlayerId);
    const myTeam = me ? me.team : 'A';
    const trump = e.trumpSuit;
    const trick = e.trick;
    let bestCard = legal[0], bestVal = -Infinity;
    for (const c of legal) {
      let val = c.value(trump) * 0.5 + c.strength(trump) * 2;
      if (trick.length > 0) {
        const testTrick = [...trick, { playerId: this.myPlayerId, card: c }];
        if (testTrick.length === 4) {
          const win = e.peekTrickWinner(testTrick);
          const wp = e.players.find(p => p.id === win.playerId);
          if (wp && wp.team === myTeam) {
            let pts = 0; testTrick.forEach(t => pts += t.card.value(trump));
            val += pts * 1.5;
          }
        }
      }
      if (val > bestVal) { bestVal = val; bestCard = c; }
    }
    this.selectedCardId = bestCard.id;
    this.renderHands();
    this.renderActionPanel();
    this.showToast('Խորհուրդ՝ ' + (SUIT_NAMES_HY[bestCard.suit] || bestCard.suit) + ' ' + bestCard.rank, 'info');
  },

  /* ---- BUBBLES & TOASTS ---- */
  showBubble(seat, text, type) {
    const positions = ['bottom', 'top', 'left', 'right'];
    const pos = positions[seat];
    const container = document.getElementById('bubble-' + pos);
    if (!container) return;
    const cls = 'bubble-premium' + (type === 'bid' ? ' bid' : type === 'pass' ? ' pass' : type === 'kontra' ? ' kontra' : '');
    container.innerHTML = '<div class="' + cls + '">' + this.escapeHtml(text) + '</div>';
    if (this.bubbleTimeouts[pos]) clearTimeout(this.bubbleTimeouts[pos]);
    this.bubbleTimeouts[pos] = setTimeout(() => {
      container.innerHTML = '';
      this.bubbleTimeouts[pos] = null;
    }, 1600);
  },

  showToast(msg, type) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const t = document.createElement('div');
    t.className = 'toast-item ' + (type === 'error' ? 'toast-error' : type === 'success' ? 'toast-success' : 'toast-info');
    t.textContent = msg;
    container.appendChild(t);
    setTimeout(() => {
      t.style.transition = 'opacity 0.4s, transform 0.4s';
      t.style.opacity = '0';
      t.style.transform = 'translateY(-10px)';
      setTimeout(() => t.remove(), 400);
    }, 2600);
  },

  /* ---- MODALS ---- */
  showModal(html) {
    const m = document.getElementById('modal-content');
    const o = document.getElementById('modal-container');
    if (!m || !o) return;
    m.innerHTML = html;
    o.classList.add('active');
  },

  closeModal() {
    const o = document.getElementById('modal-container');
    if (o) o.classList.remove('active');
  },

  showRoundResult() {
    const e = this.engine;
    if (!e || !e.lastRoundResult) return;
    const r = e.lastRoundResult;
    const scoreA = e.getTeamScore('A');
    const scoreB = e.getTeamScore('B');
    let title = '', color = 'text-neon-gold', sub = '';
    if (r.flag === 'KAPUT') { title = '🏆 ԿԱՊՈՒՏ'; sub = 'Հայտատու թիմը վերցրեց բոլոր 8 քաշերը'; }
    else if (r.flag === 'TARS_KAPUT') { title = '💀 ԹԱՐՍ ԿԱՊՈՒՏ'; color = 'text-neon-red'; sub = 'Հայտատու թիմը չվերցրեց ոչ մի քաշ'; }
    else if (r.flag === 'SUCCESS') { title = '✓ Պայմանագիրը կատարված է'; color = 'text-neon-green'; sub = 'Հայտատու թիմը կատարեց իր պարտավորությունը'; }
    else if (r.flag === 'FAILED') { title = '✗ Պայմանագիրը ձախողված է'; color = 'text-neon-red'; sub = 'Հայտատու թիմը չկարողացավ կատարել հայտը'; }
    const gameOver = e.winner !== null || scoreA >= e.gameTarget || scoreB >= e.gameTarget;

    const html =
      '<h3 class="text-2xl sm:text-3xl font-black ' + color + ' text-center mb-2">' + title + '</h3>' +
      '<p class="text-center text-white/60 text-sm mb-6">' + sub + '</p>' +
      '<div class="flex justify-around items-center mb-6">' +
        '<div class="text-center"><div class="text-xs text-white/50 mb-1">ԹԻՄ A</div><div class="text-4xl font-black" style="color:#22ff9c;">' + scoreA + '</div></div>' +
        '<div class="text-3xl text-white/20 font-black">:</div>' +
        '<div class="text-center"><div class="text-xs text-white/50 mb-1">ԹԻՄ B</div><div class="text-4xl font-black" style="color:#ff4d6d;">' + scoreB + '</div></div>' +
      '</div>' +
      '<div class="bg-black/40 rounded-xl p-3 mb-6 text-xs text-white/70 space-y-1">' +
        '<div class="flex justify-between"><span>Հայտ՝</span><span style="color:#ffd166;font-weight:bold;">' + r.contract + ' (' + r.bidPoints + ')' + (r.trump ? ' · ' + r.trump : ' · ԲՈՅ') + '</span></div>' +
        '<div class="flex justify-between"><span>Գործակից՝</span><span style="color:#ffd166;font-weight:bold;">×' + r.multiplier + '</span></div>' +
        '<div class="flex justify-between"><span>Հայտատու քաշեր՝</span><span class="text-white font-bold">' + r.bidderTricks + '/8</span></div>' +
      '</div>' +
      '<div class="flex gap-3 justify-center flex-wrap">' +
        (gameOver ? '<button id="m-final" class="btn-premium btn-gold">ԱՐԴՅՈՒՆՔԸ</button>' : '<button id="m-next" class="btn-premium btn-emerald">ՀԱՋՈՐԴ ՌԱՈՒՆԴ</button><button id="m-exit" class="btn-ghost">ԼՔԵԼ</button>') +
      '</div>';

    this.showModal(html);
    if (gameOver) {
      document.getElementById('m-final').addEventListener('click', () => { this.closeModal(); this.showFinalResult(); });
    } else {
      document.getElementById('m-next').addEventListener('click', () => this.nextRound());
      document.getElementById('m-exit').addEventListener('click', () => this.exitGame());
    }
  },

  nextRound() {
    this.closeModal();
    if (this.gameMode === 'online') { Online.sendNextRound(); return; }
    const e = this.engine;
    const savedA = e.getTeamScore('A'), savedB = e.getTeamScore('B');
    e.startNextRound(true);
    e.players.forEach(p => p.score = p.team === 'A' ? savedA : savedB);
    this.selectedCardId = null;
    this.renderAll();
    this.scheduleNextTurn();
  },

  showFinalResult() {
    const e = this.engine;
    const scoreA = e.getTeamScore('A'), scoreB = e.getTeamScore('B');
    let title, subtitle, titleColor, icon;
    if (e.winner === 'A') { title = 'ՀԱՂԹԵՑԻՐ'; subtitle = 'Դուք հաղթեցիք!'; titleColor = 'text-neon-gold'; icon = '🏆'; }
    else if (e.winner === 'B') { title = 'ՊԱՐՏՎԵՑԻՐ'; subtitle = 'Բոտը հաղթեց'; titleColor = 'text-neon-red'; icon = '💀'; }
    else { title = 'ՈՉ-ՈՔԻ'; subtitle = 'Հավասարություն'; titleColor = 'text-white/70'; icon = '🤝'; }

    const html =
      '<div class="text-center mb-4"><div class="text-6xl mb-2">' + icon + '</div><h3 class="text-3xl sm:text-4xl font-black ' + titleColor + ' tracking-wide">' + title + '</h3><p class="text-white/60 text-sm mt-2">' + subtitle + '</p></div>' +
      '<div class="flex justify-around items-center mb-8 mt-6">' +
        '<div class="text-center"><div class="text-xs text-white/50 mb-1">ԹԻՄ A</div><div class="text-5xl font-black" style="color:' + (e.winner === 'A' ? '#ffd166' : 'rgba(255,255,255,0.6)') + ';">' + scoreA + '</div></div>' +
        '<div class="text-3xl text-white/20 font-black">:</div>' +
        '<div class="text-center"><div class="text-xs text-white/50 mb-1">ԹԻՄ B</div><div class="text-5xl font-black" style="color:' + (e.winner === 'B' ? '#ffd166' : 'rgba(255,255,255,0.6)') + ';">' + scoreB + '</div></div>' +
      '</div>' +
      '<div class="text-center text-xs text-white/50 mb-6">Թիրախ՝ ' + e.gameTarget + '</div>' +
      '<div class="flex gap-3 justify-center flex-wrap"><button id="m-rematch" class="btn-premium btn-emerald">ԿՐԿԻՆ ԽԱՂԱԼ</button><button id="m-menu" class="btn-premium btn-gold">ԳԼԽԱՎՈՐ ՄԵՆՅՈՒ</button></div>';

    this.showModal(html);
    if (this.particles.layer && e.winner === 'A') {
      let i = 0;
      const interval = setInterval(() => {
        const x = Math.random() * window.innerWidth;
        const y = window.innerHeight * (0.2 + Math.random() * 0.5);
        this.particles.spawn(x, y, '#ffd166', 20);
        if (++i >= 5) clearInterval(interval);
      }, 250);
    }
    document.getElementById('m-rematch').addEventListener('click', () => { this.closeModal(); this.showScreen('target'); });
    document.getElementById('m-menu').addEventListener('click', () => this.exitGame());
  },

  confirmExit() {
    const html = '<h3 class="text-2xl font-black text-neon-gold text-center mb-3">ԼՔԵ՞Լ ԽԱՂԸ</h3><p class="text-center text-white/70 text-sm mb-6">Վերադառնա՞լ գլխավոր մենյու:</p><div class="flex gap-3 justify-center"><button id="m-stay" class="btn-ghost">ՈՉ</button><button id="m-leave" class="btn-premium" style="background:linear-gradient(135deg,#ef4444,#991b1b);color:#fff;">ԱՅՈ, ԼՔԵԼ</button></div>';
    this.showModal(html);
    document.getElementById('m-stay').addEventListener('click', () => this.closeModal());
    document.getElementById('m-leave').addEventListener('click', () => this.exitGame());
  },

  exitGame() {
    this.clearTimers();
    this.closeModal();
    if (this.gameMode === 'online') { Online.leaveLobby(); return; }
    this.engine = null;
    this.bots = {};
    this.selectedCardId = null;
    this.gameMode = 'bot';
    this.myPlayerId = 'you';
    this.showScreen('menu');
  },

  showRules() {
    const html = '<h3 class="text-2xl font-black text-gold-gradient text-center mb-4">📜 ԽԱՂԻ ԿԱՆՈՆՆԵՐ</h3><div class="text-sm text-white/80 space-y-3 max-h-[55vh] overflow-y-auto pr-2 leading-relaxed"><p><b style="color:#ffd166;">Նպատակ.</b> 4 խաղացող, 2 թիմ: Առաջինը, որը հասնում է նպատակին, հաղթում է:</p><p><b style="color:#ffd166;">Կապոց.</b> 32 քարտ, 4 մաստ × 8 արժեք (7-ից A): Յուրաքանչյուրին՝ 8 քարտ:</p><p><b style="color:#ffd166;">Բազառ.</b> Սկսվում է 8-ից, +1 ինկրեմենտով, առավելագույնը 16:</p><p><b style="color:#ffd166;">Կոզրի ուժը.</b> J > 9 > A > 10 > K > Q > 8 > 7:</p><p><b style="color:#ffd166;">Կոզրի միավորները.</b> J=20, 9=14, A=11, 10=10, K=4, Q=3, 8=0, 7=0:</p><p><b style="color:#ffd166;">ԲՈՅ-ի ուժը.</b> A > 10 > K > Q > J > 9 > 8 > 7:</p><p><b style="color:#ffd166;">Մաստ.</b> Պարտադիր է խաղալ առաջատար մաստից:</p><p><b style="color:#ffd166;">Վերջին քաշ.</b> +10 միավոր:</p><p><b style="color:#ffd166;">Քուանշ/Սուր.</b> Քուանշ ×2, Սուր ×4:</p><p><b style="color:#ffd166;">Կապուտ.</b> 8 քաշ → 50 միավոր:</p><p><b style="color:#ffd166;">Կլորացում.</b> 1-5 → ներքև, 6-9 → վերև:</p></div><div class="text-center mt-6"><button id="m-close-rules" class="btn-premium btn-gold">ՓԱԿԵԼ</button></div>';
    this.showModal(html);
    document.getElementById('m-close-rules').addEventListener('click', () => this.closeModal());
  },

  escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }
};
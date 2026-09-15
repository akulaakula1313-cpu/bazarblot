/* ============================================================================
 * ԲԱԶԱՌ-ԲԼՈՏ — Shared Game Core
 * SANI GROUP
 * ============================================================================ */

'use strict';

export const SUITS = ['♠', '♥', '♦', '♣'];
export const SUIT_NAMES_HY = { '♠': 'Պիկ', '♥': 'Սիրտ', '♦': 'Ագուռ', '♣': 'Խաչ' };
export const RANKS = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const RANK_ORDER = { '7': 0, '8': 1, '9': 2, '10': 3, 'J': 4, 'Q': 5, 'K': 6, 'A': 7 };

export const TRUMP_VALUES = { 'J': 20, '9': 14, 'A': 11, '10': 10, 'K': 4, 'Q': 3, '8': 0, '7': 0 };
export const NON_TRUMP_VALUES = { 'A': 11, '10': 10, 'K': 4, 'Q': 3, 'J': 2, '9': 0, '8': 0, '7': 0 };
export const TRUMP_STRENGTH = { 'J': 8, '9': 7, 'A': 6, '10': 5, 'K': 4, 'Q': 3, '8': 2, '7': 1 };
export const NON_TRUMP_STRENGTH = { 'A': 8, '10': 7, 'K': 6, 'Q': 5, 'J': 4, '9': 3, '8': 2, '7': 1 };

export const PHASES = Object.freeze({
  WAITING: 'WAITING',
  DEALING: 'DEALING',
  AUCTION: 'AUCTION',
  BONUS_DECLARATION: 'BONUS_DECLARATION',
  TRICK_PLAY: 'TRICK_PLAY',
  ROUND_SCORE: 'ROUND_SCORE',
  GAME_SCORE: 'GAME_SCORE',
  GAME_END: 'GAME_END'
});

export const CONFIG = Object.freeze({
  PORT: (typeof process !== 'undefined' && process.env && process.env.PORT) || 3001,
  MIN_BID: 8, MAX_BID: 16, BID_INCREMENT: 1, BID_SCORE_MULT: 10,
  TRICKS_PER_ROUND: 8, CARDS_PER_PLAYER: 8, DECK_SIZE: 32,
  LAST_TRICK_BONUS: 10, KAPUT_POINTS: 50, CONTRACT_BONUS: 16,
  TURN_TIME_MS: 20000,
  BOT_THINK_MIN_MS: 700, BOT_THINK_MAX_MS: 1400,
  MC_SIMULATIONS: 80, MC_SIMULATIONS_ENDGAME: 200,
  ROOM_CODE_LENGTH: 6,
  ROOM_TIMEOUT_MS: 5 * 60 * 1000,
  DISCONNECT_GRACE_MS: 60 * 1000,
  RATE_LIMIT_WINDOW_MS: 1000,
  RATE_LIMIT_MAX_ACTIONS: 20,
  MAX_PAYLOAD_SIZE: 16 * 1024
});

export function secureRandomInt(max) {
  if (max <= 0) return 0;
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] % max;
  }
  return Math.floor(Math.random() * max);
}

export function shuffleSecure(deck) {
  const arr = deck.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ===== CARD ===== */
export class Card {
  constructor(suit, rank) {
    this.suit = suit; this.rank = rank; this.id = suit + '-' + rank;
  }
  isRed() { return this.suit === '♥' || this.suit === '♦'; }
  isTrump(t) { return t !== null && this.suit === t; }
  value(t) { return this.isTrump(t) ? TRUMP_VALUES[this.rank] : NON_TRUMP_VALUES[this.rank]; }
  strength(t) { return this.isTrump(t) ? TRUMP_STRENGTH[this.rank] : NON_TRUMP_STRENGTH[this.rank]; }
  clone() { return new Card(this.suit, this.rank); }
  toJSON() { return { id: this.id, suit: this.suit, rank: this.rank }; }
  static fromJSON(o) { return new Card(o.suit, o.rank); }
}

/* ===== PLAYER ===== */
export class Player {
  constructor(id, name, seat, team, isBot) {
    this.id = id; this.name = name; this.seat = seat; this.team = team; this.isBot = !!isBot;
    this.hand = []; this.score = 0; this.tricksWon = 0; this.connected = true;
    this.combinations = []; this.declaredCombos = [];
    this.blotDeclared = false; this.reblotDeclared = false;
  }
  reset() {
    this.hand = []; this.tricksWon = 0;
    this.combinations = []; this.declaredCombos = [];
    this.blotDeclared = false; this.reblotDeclared = false;
  }
}

/* ===== RULES ENGINE ===== */
export class RulesEngine {
  constructor() {
    this.players = []; this.dealerIndex = 0; this.currentTurnIndex = 0;
    this.trumpSuit = null; this.contract = null; this.multiplier = 1;
    this.highestBid = 0; this.highestBidderId = null; this.passCount = 0;
    this.trick = []; this.tricksWon = { A: 0, B: 0 }; this.pointsWon = { A: 0, B: 0 };
    this.tricksHistory = []; this.roundNumber = 1; this.gameTarget = 151;
    this.phase = PHASES.WAITING; this.winner = null; this.lastRoundResult = null;
    this.stateVersion = 0; this.kontraByTeam = null; this.rekontraByTeam = null;
    this.bidsHistory = []; this.combinationWindowOpen = false;
  }

  createDeck() {
    const d = [];
    for (const s of SUITS) for (const r of RANKS) d.push(new Card(s, r));
    return d;
  }

  // deal: reset players first, then distribute cards
  deal(rng = shuffleSecure) {
    // 1. Сначала сбрасываем состояние игроков
    this.players.forEach(p => p.reset());

    // 2. Потом раздаём карты
    const deck = rng(this.createDeck());
    if (deck.length !== CONFIG.DECK_SIZE) throw new Error('Deck must be 32 cards');
    this.players.forEach((p, i) => {
      p.hand = deck.slice(i * CONFIG.CARDS_PER_PLAYER, (i + 1) * CONFIG.CARDS_PER_PLAYER);
    });

    // 3. Сбрасываем состояние раунда
    this.trumpSuit = null;
    this.contract = null;
    this.multiplier = 1;
    this.highestBid = 0;
    this.highestBidderId = null;
    this.passCount = 0;
    this.bidsHistory = [];
    this.trick = [];
    this.tricksWon = { A: 0, B: 0 };
    this.pointsWon = { A: 0, B: 0 };
    this.tricksHistory = [];
    this.kontraByTeam = null;
    this.rekontraByTeam = null;
    this.currentTurnIndex = (this.dealerIndex + 1) % 4;
    this.phase = PHASES.AUCTION;
    this.combinationWindowOpen = false;
    this.stateVersion++;
  }

  getLegalBids() {
    const legal = [];
    const start = this.highestBid === 0 ? CONFIG.MIN_BID : this.highestBid + CONFIG.BID_INCREMENT;
    if (start > CONFIG.MAX_BID) return legal;
    for (let v = start; v <= CONFIG.MAX_BID; v += CONFIG.BID_INCREMENT) {
      legal.push({ value: v, suit: null });
      for (const s of SUITS) legal.push({ value: v, suit: s });
    }
    return legal;
  }

  makeBid(playerId, value, suit) {
    if (this.phase !== PHASES.AUCTION) throw new Error('Auction ended');
    if (typeof value !== 'number' || value < CONFIG.MIN_BID || value > CONFIG.MAX_BID) throw new Error('Bid 8-16');
    if (suit !== null && !SUITS.includes(suit)) throw new Error('Invalid suit');
    if (this.highestBid > 0 && value <= this.highestBid) throw new Error('Bid must be higher');
    this.highestBid = value;
    this.highestBidderId = playerId;
    this.contract = { value, suit };
    this.passCount = 0;
    this.bidsHistory.push({ playerId, value, suit, pass: false });
    this.stateVersion++;
    this.currentTurnIndex = (this.currentTurnIndex + 1) % 4;
  }

  passBid(playerId) {
    if (this.phase !== PHASES.AUCTION) throw new Error('Auction ended');
    this.bidsHistory.push({ playerId, pass: true });
    this.passCount++;
    this.stateVersion++;
    if (this.highestBid === 0 && this.passCount >= 4) { this.startNextRound(true); return; }
    if (this.highestBid > 0 && this.passCount >= 3) {
      const bidder = this.players.find(p => p.id === this.highestBidderId);
      if (bidder) { this.finishAuction(); return; }
    }
    this.currentTurnIndex = (this.currentTurnIndex + 1) % 4;
  }

  finishAuction() {
    if (this.highestBid === 0) { this.startNextRound(true); return; }
    this.trumpSuit = this.contract.suit;
    this.phase = PHASES.BONUS_DECLARATION;
    const idx = this.players.findIndex(p => p.id === this.highestBidderId);
    this.currentTurnIndex = idx >= 0 ? idx : 0;
    this.detectAllCombinations();
    this.combinationWindowOpen = true;
  }

  detectAllCombinations() {
    this.players.forEach(p => {
      p.combinations = RulesEngine.detectCombinations(p.hand, this.trumpSuit);
    });
  }

  static detectCombinations(hand, trumpSuit) {
    const combos = [];
    const byRank = {};
    hand.forEach(c => {
      if (!byRank[c.rank]) byRank[c.rank] = [];
      byRank[c.rank].push(c);
    });
    for (const rank of Object.keys(byRank)) {
      if (byRank[rank].length === 4) {
        combos.push({
          type: 'FOUR', rank, cards: byRank[rank].slice(), points: 100,
          priority: RulesEngine.fourPriority(rank, trumpSuit)
        });
      }
    }
    for (const suit of SUITS) {
      const suited = hand.filter(c => c.suit === suit).sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank]);
      if (suited.length < 3) continue;
      const runs = []; let cur = [suited[0]];
      for (let i = 1; i < suited.length; i++) {
        if (RANK_ORDER[suited[i].rank] === RANK_ORDER[suited[i-1].rank] + 1) cur.push(suited[i]);
        else { if (cur.length >= 3) runs.push(cur.slice()); cur = [suited[i]]; }
      }
      if (cur.length >= 3) runs.push(cur.slice());
      for (const run of runs) {
        const points = run.length === 3 ? 20 : run.length === 4 ? 50 : 100;
        combos.push({
          type: run.length === 3 ? 'SEQ3' : run.length === 4 ? 'SEQ4' : 'SEQ5',
          suit, cards: run.slice(), points, priority: run.length
        });
      }
    }
    if (trumpSuit) {
      const k = hand.find(c => c.suit === trumpSuit && c.rank === 'K');
      const q = hand.find(c => c.suit === trumpSuit && c.rank === 'Q');
      if (k && q) combos.push({ type: 'BLOT', cards: [k, q], points: 0, priority: 100 });
    }
    return combos;
  }

  static fourPriority(rank, trumpSuit) {
    if (!trumpSuit) {
      const o = { 'A': 6, '10': 5, 'K': 4, 'Q': 3, 'J': 2, '9': 1, '8': 0, '7': 0 };
      return o[rank] || 0;
    }
    const o = { 'J': 8, '9': 7, 'A': 6, '10': 5, 'K': 4, 'Q': 3, '8': 0, '7': 0 };
    return o[rank] || 0;
  }

  declareCombination(playerId, comboIndex) {
    const p = this.players.find(pl => pl.id === playerId);
    if (!p || !p.combinations[comboIndex]) return false;
    const combo = p.combinations[comboIndex];
    if (p.declaredCombos.includes(combo)) return false;
    p.declaredCombos.push(combo);
    if (combo.type === 'BLOT') {
      if (!p.blotDeclared) p.blotDeclared = true;
      else p.reblotDeclared = true;
    }
    this.stateVersion++;
    return true;
  }

  getLegalCards(playerId) {
    if (this.phase !== PHASES.TRICK_PLAY) return [];
    const player = this.players.find(p => p.id === playerId);
    if (!player || player.hand.length === 0) return [];
    if (this.trick.length === 0) return player.hand.slice();

    const leadSuit = this.trick[0].card.suit;
    const leadCards = player.hand.filter(c => c.suit === leadSuit);
    if (leadCards.length > 0) return leadCards;

    if (this.trumpSuit === null) return player.hand.slice();
    const trumpsInHand = player.hand.filter(c => c.suit === this.trumpSuit);
    if (trumpsInHand.length === 0) return player.hand.slice();

    const trumpsOnTable = this.trick.filter(t => t.card.suit === this.trumpSuit);
    if (trumpsOnTable.length === 0) {
      const winner = this.peekTrickWinner();
      if (!winner) return player.hand.slice();
      const wp = this.players.find(p => p.id === winner.playerId);
      if (wp.team !== player.team) {
        const ws = winner.card.strength(this.trumpSuit);
        const higher = trumpsInHand.filter(c => c.strength(this.trumpSuit) > ws);
        if (higher.length > 0) {
          const ms = Math.max(...higher.map(c => c.strength(this.trumpSuit)));
          return higher.filter(c => c.strength(this.trumpSuit) === ms);
        }
      }
      return trumpsInHand;
    } else {
      let ht = trumpsOnTable[0];
      for (let i = 1; i < trumpsOnTable.length; i++) {
        if (trumpsOnTable[i].card.strength(this.trumpSuit) > ht.card.strength(this.trumpSuit)) ht = trumpsOnTable[i];
      }
      const wp = this.players.find(p => p.id === ht.playerId);
      if (wp.team !== player.team) {
        const ws = ht.card.strength(this.trumpSuit);
        const higher = trumpsInHand.filter(c => c.strength(this.trumpSuit) > ws);
        if (higher.length > 0) {
          const ms = Math.max(...higher.map(c => c.strength(this.trumpSuit)));
          return higher.filter(c => c.strength(this.trumpSuit) === ms);
        }
      }
      return trumpsInHand;
    }
  }

  playCard(playerId, cardId) {
    if (this.phase !== PHASES.TRICK_PLAY) throw new Error('Not trick phase');
    const player = this.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not found');
    if (player.id !== this.players[this.currentTurnIndex].id) throw new Error('Not your turn');
    const legal = this.getLegalCards(playerId);
    const idx = player.hand.findIndex(c => c.id === cardId);
    if (idx === -1) throw new Error('Card not in hand');
    const card = player.hand[idx];
    if (!legal.some(c => c.id === cardId)) throw new Error('Illegal card');
    player.hand.splice(idx, 1);
    this.trick.push({ playerId, card });
    this.stateVersion++;
    if (this.trick.length === 4) this.resolveTrick();
    else this.currentTurnIndex = (this.currentTurnIndex + 1) % 4;
  }

  peekTrickWinner(t) {
    t = t || this.trick;
    if (!t.length) return null;
    const lead = t[0].card.suit;
    let w = t[0];
    const tr = this.trumpSuit;
    for (let i = 1; i < t.length; i++) {
      const c = t[i];
      const cT = tr !== null && c.card.suit === tr;
      const wT = tr !== null && w.card.suit === tr;
      if (cT && !wT) w = c;
      else if (cT && wT) { if (c.card.strength(tr) > w.card.strength(tr)) w = c; }
      else if (!cT && !wT) {
        if (c.card.suit === lead && w.card.suit === lead && c.card.strength(tr) > w.card.strength(tr)) w = c;
      }
    }
    return w;
  }

  resolveTrick() {
    const w = this.peekTrickWinner();
    const wp = this.players.find(p => p.id === w.playerId);
    const tr = this.trumpSuit;
    let pts = 0;
    this.trick.forEach(t => pts += t.card.value(tr));
    const isLast = this.tricksWon.A + this.tricksWon.B + 1 === CONFIG.TRICKS_PER_ROUND;
    if (isLast) pts += CONFIG.LAST_TRICK_BONUS;
    this.pointsWon[wp.team] += pts;
    this.tricksWon[wp.team]++;
    wp.tricksWon++;
    this.tricksHistory.push({
      winnerId: wp.id, winnerTeam: wp.team, points: pts,
      cards: this.trick.slice(), isLastTrick: isLast
    });
    this.currentTurnIndex = this.players.findIndex(p => p.id === w.playerId);
    this.trick = [];
    if (this.tricksWon.A + this.tricksWon.B === CONFIG.TRICKS_PER_ROUND) {
      this.phase = PHASES.ROUND_SCORE;
      this.calculateRoundScore();
    }
  }

  static roundArmenian(s) {
    if (s <= 0) return 0;
    const r = s % 10;
    if (r >= 1 && r <= 5) return s - r;
    if (r >= 6 && r <= 9) return s + (10 - r);
    return s;
  }

  calculateRoundScore() {
    const bidder = this.players.find(p => p.id === this.highestBidderId);
    if (!bidder) throw new Error('No bidder');
    const bt = bidder.team;
    const ot = bt === 'A' ? 'B' : 'A';
    const bTricks = this.tricksWon[bt];
    const bPts = this.pointsWon[bt];
    const oPts = this.pointsWon[ot];
    const bidPoints = this.contract.value * CONFIG.BID_SCORE_MULT;
    const mult = this.multiplier;
    const bCombo = this.calculateComboPoints(bt);
    const oCombo = this.calculateComboPoints(ot);
    let bS = 0, oS = 0, flag = '';

    if (bTricks === 8) { bS = CONFIG.KAPUT_POINTS; oS = 0; flag = 'KAPUT'; }
    else if (bTricks === 0) { bS = 0; oS = bidPoints * mult + CONFIG.CONTRACT_BONUS; flag = 'TARS_KAPUT'; }
    else if (bPts >= bidPoints) {
      bS = bidPoints * mult + CONFIG.CONTRACT_BONUS - oPts + bCombo;
      oS = oPts + oCombo;
      flag = 'SUCCESS';
    } else {
      bS = 0;
      oS = bidPoints * mult + CONFIG.CONTRACT_BONUS + oCombo;
      flag = 'FAILED';
    }

    bS = RulesEngine.roundArmenian(Math.max(0, bS));
    oS = RulesEngine.roundArmenian(Math.max(0, oS));

    this.players.forEach(p => p.score += p.team === bt ? bS : oS);

    this.lastRoundResult = {
      bidderTeam: bt, oppTeam: ot, bScore: bS, oScore: oS,
      flag, bidderPts: bPts, oppPts: oPts,
      bidderTricks: bTricks, oppTricks: this.tricksWon[ot],
      contract: this.contract.value, bidPoints, multiplier: mult,
      trump: this.trumpSuit
    };

    this.phase = PHASES.GAME_SCORE;

    const sA = this.getTeamScore('A'), sB = this.getTeamScore('B');
    if (sA >= this.gameTarget || sB >= this.gameTarget) {
      this.winner = sA > sB ? 'A' : sB > sA ? 'B' : null;
      this.phase = PHASES.GAME_END;
    }
  }

  calculateComboPoints(team) {
    let t = 0;
    this.players.filter(p => p.team === team).forEach(p => {
      p.declaredCombos.forEach(c => t += c.points || 0);
    });
    return t;
  }

  getTeamScore(team) {
    const p = this.players.find(pl => pl.team === team);
    return p ? p.score : 0;
  }

  getCurrentPlayer() { return this.players[this.currentTurnIndex]; }

  startNextRound(inc) {
    const sv = { A: this.getTeamScore('A'), B: this.getTeamScore('B') };
    if (inc) this.dealerIndex = (this.dealerIndex + 1) % 4;
    this.roundNumber++;
    this.phase = PHASES.DEALING;
    this.deal();
    this.players.forEach(p => p.score = sv[p.team]);
    this.stateVersion++;
  }
}

/* ===== BOT AI ===== */
export class BotAI {
  constructor(engine, playerId) {
    this.engine = engine;
    this.playerId = playerId;
  }

  decideBid() {
    const me = this.engine.players.find(p => p.id === this.playerId);
    if (!me) return null;
    const ev = this.evaluateHandForBid(me.hand);
    if (ev.best.score < 25) return null;
    const nm = this.engine.highestBid === 0 ? CONFIG.MIN_BID : this.engine.highestBid + CONFIG.BID_INCREMENT;
    let tb = ev.best.score >= 90 ? 16
      : ev.best.score >= 78 ? 14
      : ev.best.score >= 65 ? 12
      : ev.best.score >= 52 ? 11
      : ev.best.score >= 40 ? 10
      : ev.best.score >= 30 ? 9
      : CONFIG.MIN_BID;
    if (tb < nm) {
      if (nm <= 11 && ev.best.score >= 45) tb = nm;
      else if (nm <= 9 && ev.best.score >= 32) tb = nm;
      else return null;
    }
    if (tb < CONFIG.MIN_BID) tb = CONFIG.MIN_BID;
    if (tb > CONFIG.MAX_BID) return null;
    return { value: tb, suit: ev.best.suit };
  }

  evaluateHandForBid(hand) {
    const suits = [null, ...SUITS];
    let best = { suit: null, score: 0 };
    for (const ts of suits) {
      let sc = 0;
      const byS = { '♠': [], '♥': [], '♦': [], '♣': [] };
      hand.forEach(c => byS[c.suit].push(c.rank));

      if (!ts) {
        const cnt = { A: 0, '10': 0, K: 0, Q: 0, J: 0 };
        hand.forEach(c => cnt[c.rank]++);
        sc = (cnt.A || 0) * 16 + (cnt['10'] || 0) * 13 + (cnt.K || 0) * 6 + (cnt.Q || 0) * 3 + (cnt.J || 0) * 1;
        for (const s of SUITS) {
          const l = byS[s].length;
          if (l === 0) sc += 7;
          else if (l === 1) sc += 3;
        }
      } else {
        const tr = byS[ts];
        const hJ = tr.includes('J'), h9 = tr.includes('9'), hA = tr.includes('A');
        const h10 = tr.includes('10'), hK = tr.includes('K'), hQ = tr.includes('Q');
        sc = tr.length * 6;
        if (hJ) sc += 26;
        if (h9) sc += 17;
        if (hA) sc += 12;
        if (h10) sc += 10;
        if (hK) sc += 5;
        if (hQ) sc += 3;
        if (hJ && h9) sc += 14;
        if (hA && h10) sc += 9;
        for (const s of SUITS) {
          if (s !== ts) for (const r of byS[s]) {
            if (r === 'A') sc += 10;
            else if (r === '10') sc += 6;
            else if (r === 'K') sc += 2;
          }
        }
      }
      if (sc > best.score) best = { suit: ts, score: Math.min(100, sc) };
    }
    return { best };
  }

  decideCard() {
    const legal = this.engine.getLegalCards(this.playerId);
    if (!legal.length) return null;
    if (legal.length === 1) return legal[0];

    const rt = CONFIG.TRICKS_PER_ROUND - (this.engine.tricksWon.A + this.engine.tricksWon.B);
    if (rt <= 2) return this.minimaxBestCard(legal);

    const sims = rt >= 5 ? CONFIG.MC_SIMULATIONS : CONFIG.MC_SIMULATIONS_ENDGAME;
    const scores = {};
    legal.forEach(c => scores[c.id] = 0);

    for (let i = 0; i < sims; i++) {
      const w = this.generateWorld();
      if (!w) continue;
      for (const c of legal) scores[c.id] += this.simulatePlayout(c, w);
    }

    let best = legal[0], bv = -Infinity;
    for (const c of legal) if (scores[c.id] > bv) { bv = scores[c.id]; best = c; }
    return best;
  }

  generateWorld() {
    const me = this.engine.players.find(p => p.id === this.playerId);
    if (!me) return null;
    const mine = {};
    me.hand.forEach(c => mine[c.id] = true);
    const played = {};
    this.engine.tricksHistory.forEach(t => t.cards.forEach(tc => played[tc.card.id] = true));
    this.engine.trick.forEach(tc => played[tc.card.id] = true);

    const pool = [];
    for (const s of SUITS) for (const r of RANKS) {
      const id = s + '-' + r;
      if (mine[id] || played[id]) continue;
      pool.push(new Card(s, r));
    }
    const sh = shuffleSecure(pool);
    const hands = {};
    const others = this.engine.players.filter(p => p.id !== this.playerId);
    let idx = 0;
    for (const p of others) {
      const pc = this.countPlayedByPlayer(p.id);
      const rem = CONFIG.CARDS_PER_PLAYER - pc;
      const nh = [];
      for (let k = 0; k < rem && idx < sh.length; k++) nh.push(sh[idx++]);
      hands[p.id] = nh;
    }
    return { hands };
  }

  countPlayedByPlayer(pid) {
    let n = 0;
    this.engine.tricksHistory.forEach(t => t.cards.forEach(tc => { if (tc.playerId === pid) n++; }));
    this.engine.trick.forEach(tc => { if (tc.playerId === pid) n++; });
    return n;
  }

  simulatePlayout(cand, world) {
    const tr = this.engine.trumpSuit;
    const me = this.engine.players.find(p => p.id === this.playerId);
    const mt = me.team;
    const pls = this.engine.players;
    const hands = {};
    hands[this.playerId] = me.hand.filter(c => c.id !== cand.id);
    Object.keys(world.hands).forEach(id => hands[id] = world.hands[id].slice());

    let trk = this.engine.trick.slice();
    trk.push({ playerId: this.playerId, card: cand });
    let ct = (this.engine.currentTurnIndex + 1) % 4;

    let tA = this.engine.tricksWon.A, tB = this.engine.tricksWon.B;
    let pA = this.engine.pointsWon.A, pB = this.engine.pointsWon.B;
    const rem = CONFIG.TRICKS_PER_ROUND - (tA + tB);
    let pl = 0;

    while (pl < rem) {
      while (trk.length < 4) {
        const pid = pls[ct].id;
        const h = hands[pid];
        if (!h || !h.length) { ct = (ct + 1) % 4; continue; }
        const lg = this.quickLegal(h, trk, tr);
        const ch = this.quickPolicy(pid, lg, trk, tr);
        const ci = h.findIndex(c => c.id === ch.id);
        if (ci === -1) {
          const fb = h[0];
          hands[pid].splice(0, 1);
          trk.push({ playerId: pid, card: fb });
        } else {
          const cd = h.splice(ci, 1)[0];
          trk.push({ playerId: pid, card: cd });
        }
        ct = (ct + 1) % 4;
      }
      const wn = this.quickWinner(trk, tr);
      const wp = pls.find(p => p.id === wn.playerId);
      const wt = wp.team;
      let pts = 0;
      trk.forEach(t => pts += t.card.value(tr));
      if (pl === rem - 1) pts += CONFIG.LAST_TRICK_BONUS;
      if (wt === 'A') { tA++; pA += pts; } else { tB++; pB += pts; }
      ct = pls.findIndex(p => p.id === wn.playerId);
      trk = []; pl++;
    }

    const mtPts = mt === 'A' ? pA : pB;
    const opPts = mt === 'A' ? pB : pA;
    return mtPts - opPts * 0.9;
  }

  quickLegal(h, tk, tr) {
    if (!tk.length) return h.slice();
    const ld = tk[0].card.suit;
    const lc = h.filter(c => c.suit === ld);
    if (lc.length) return lc;
    if (!tr) return h.slice();
    const ts = h.filter(c => c.suit === tr);
    return ts.length ? ts : h.slice();
  }

  quickPolicy(pid, lg, tk, tr) {
    if (!lg.length) return null;
    if (lg.length === 1) return lg[0];
    if (!tk.length) return lg.reduce((a, b) => b.value(tr) > a.value(tr) ? b : a);
    const wn = this.quickWinner(tk, tr);
    const mt = this.engine.players.find(p => p.id === pid).team;
    const wt = this.engine.players.find(p => p.id === wn.playerId).team;
    if (mt === wt) return lg.reduce((a, b) => b.value(tr) < a.value(tr) ? b : a);
    return lg.reduce((a, b) => b.strength(tr) > a.strength(tr) ? b : a);
  }

  quickWinner(tk, tr) {
    const ld = tk[0].card.suit;
    let w = tk[0];
    for (let i = 1; i < tk.length; i++) {
      const c = tk[i];
      const cT = tr !== null && c.card.suit === tr;
      const wT = tr !== null && w.card.suit === tr;
      if (cT && !wT) w = c;
      else if (cT && wT) { if (c.card.strength(tr) > w.card.strength(tr)) w = c; }
      else if (!cT && !wT) {
        if (c.card.suit === ld && w.card.suit === ld && c.card.strength(tr) > w.card.strength(tr)) w = c;
      }
    }
    return w;
  }

  minimaxBestCard(lg) {
    let best = lg[0], bv = -Infinity;
    for (const c of lg) {
      const v = this.evaluateEndgame(c);
      if (v > bv) { bv = v; best = c; }
    }
    return best;
  }

  evaluateEndgame(c) {
    const tr = this.engine.trumpSuit;
    const me = this.engine.players.find(p => p.id === this.playerId);
    const mt = me.team;
    let v = c.value(tr) * 1.6 + c.strength(tr) * 2.4;
    const tt = this.engine.trick.slice();
    tt.push({ playerId: this.playerId, card: c });
    if (tt.length === 4) {
      const wn = this.quickWinner(tt, tr);
      const wp = this.engine.players.find(p => p.id === wn.playerId);
      if (wp.team === mt) {
        let pts = 0;
        tt.forEach(t => pts += t.card.value(tr));
        if (this.engine.tricksWon.A + this.engine.tricksWon.B === CONFIG.TRICKS_PER_ROUND - 1) {
          pts += CONFIG.LAST_TRICK_BONUS;
        }
        v += pts * 1.5;
      }
    }
    return v;
  }
}

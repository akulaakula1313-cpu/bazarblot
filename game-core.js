/* BAZAR-BLOT - Shared Game Core - SANI GROUP */

'use strict';

export const SUIT_KEYS = ['S', 'H', 'D', 'C'];
export const SUIT_SYMBOLS = { S: '\u2660', H: '\u2665', D: '\u2666', C: '\u2663' };
export const SUIT_NAMES_HY = { S: '\u054a\u056b\u056f', H: '\u054d\u056b\u0580\u057f', D: '\u0531\u0563\u0578\u0582\u057c', C: '\u053d\u0561\u0579' };
export const SUITS = ['\u2660', '\u2665', '\u2666', '\u2663'];
export const RANKS = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const RANK_ORDER = { '7': 0, '8': 1, '9': 2, '10': 3, 'J': 4, 'Q': 5, 'K': 6, 'A': 7 };

export const TRUMP_VALUES = { J: 20, '9': 14, A: 11, '10': 10, K: 4, Q: 3, '8': 0, '7': 0 };
export const NON_TRUMP_VALUES = { A: 11, '10': 10, K: 4, Q: 3, J: 2, '9': 0, '8': 0, '7': 0 };
export const TRUMP_STRENGTH = { J: 8, '9': 7, A: 6, '10': 5, K: 4, Q: 3, '8': 2, '7': 1 };
export const NON_TRUMP_STRENGTH = { A: 8, '10': 7, K: 6, Q: 5, J: 4, '9': 3, '8': 2, '7': 1 };

export const PHASES = {
  WAITING: 'WAITING',
  DEALING: 'DEALING',
  AUCTION: 'AUCTION',
  BONUS_DECLARATION: 'BONUS_DECLARATION',
  TRICK_PLAY: 'TRICK_PLAY',
  ROUND_SCORE: 'ROUND_SCORE',
  GAME_SCORE: 'GAME_SCORE',
  GAME_END: 'GAME_END'
};

export const CONFIG = {
  PORT: 3001,
  MIN_BID: 8, MAX_BID: 16, BID_INCREMENT: 1, BID_SCORE_MULT: 10,
  TRICKS_PER_ROUND: 8, CARDS_PER_PLAYER: 8, DECK_SIZE: 32,
  LAST_TRICK_BONUS: 10, KAPUT_POINTS: 50, CONTRACT_BONUS: 16,
  TURN_TIME_MS: 20000,
  BOT_THINK_MIN_MS: 700, BOT_THINK_MAX_MS: 1400,
  MC_SIMULATIONS: 80, MC_SIMULATIONS_ENDGAME: 200,
  ROOM_CODE_LENGTH: 6,
  ROOM_TIMEOUT_MS: 300000,
  DISCONNECT_GRACE_MS: 60000,
  RATE_LIMIT_WINDOW_MS: 1000,
  RATE_LIMIT_MAX_ACTIONS: 20,
  MAX_PAYLOAD_SIZE: 16384
};

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
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

export class Card {
  constructor(suit, rank) {
    this.suit = suit;
    this.rank = rank;
    this.id = suit + '-' + rank;
  }
  isRed() {
    return this.suit === '\u2665' || this.suit === '\u2666';
  }
  isTrump(t) {
    return t !== null && this.suit === t;
  }
  value(t) {
    return this.isTrump(t) ? TRUMP_VALUES[this.rank] : NON_TRUMP_VALUES[this.rank];
  }
  strength(t) {
    return this.isTrump(t) ? TRUMP_STRENGTH[this.rank] : NON_TRUMP_STRENGTH[this.rank];
  }
  clone() {
    return new Card(this.suit, this.rank);
  }
  toJSON() {
    return { id: this.id, suit: this.suit, rank: this.rank };
  }
  static fromJSON(o) {
    return new Card(o.suit, o.rank);
  }
}

export class Player {
  constructor(id, name, seat, team, isBot) {
    this.id = id;
    this.name = name;
    this.seat = seat;
    this.team = team;
    this.isBot = !!isBot;
    this.hand = [];
    this.score = 0;
    this.tricksWon = 0;
    this.connected = true;
    this.combinations = [];
    this.declaredCombos = [];
    this.blotDeclared = false;
    this.reblotDeclared = false;
  }
  reset() {
    this.hand = [];
    this.tricksWon = 0;
    this.combinations = [];
    this.declaredCombos = [];
    this.blotDeclared = false;
    this.reblotDeclared = false;
  }
}

export class RulesEngine {
  constructor() {
    this.players = [];
    this.dealerIndex = 0;
    this.currentTurnIndex = 0;
    this.trumpSuit = null;
    this.contract = null;
    this.multiplier = 1;
    this.highestBid = 0;
    this.highestBidderId = null;
    this.passCount = 0;
    this.trick = [];
    this.tricksWon = { A: 0, B: 0 };
    this.pointsWon = { A: 0, B: 0 };
    this.tricksHistory = [];
    this.roundNumber = 1;
    this.gameTarget = 151;
    this.phase = PHASES.WAITING;
    this.winner = null;
    this.lastRoundResult = null;
    this.stateVersion = 0;
    this.kontraByTeam = null;
    this.rekontraByTeam = null;
    this.bidsHistory = [];
    this.combinationWindowOpen = false;
  }

  createDeck() {
    const d = [];
    for (let i = 0; i < SUITS.length; i++) {
      for (let j = 0; j < RANKS.length; j++) {
        d.push(new Card(SUITS[i], RANKS[j]));
      }
    }
    return d;
  }

  deal(rng) {
    if (!rng) rng = shuffleSecure;
    for (let i = 0; i < this.players.length; i++) {
      this.players[i].reset();
    }
    const deck = rng(this.createDeck());
    if (deck.length !== CONFIG.DECK_SIZE) throw new Error('Deck size');
    for (let i = 0; i < this.players.length; i++) {
      this.players[i].hand = deck.slice(i * CONFIG.CARDS_PER_PLAYER, (i + 1) * CONFIG.CARDS_PER_PLAYER);
    }
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
      for (let i = 0; i < SUITS.length; i++) {
        legal.push({ value: v, suit: SUITS[i] });
      }
    }
    return legal;
  }

  makeBid(playerId, value, suit) {
    if (this.phase !== PHASES.AUCTION) throw new Error('Auction ended');
    if (typeof value !== 'number' || value < CONFIG.MIN_BID || value > CONFIG.MAX_BID) throw new Error('Bid 8-16');
    if (suit !== null && SUITS.indexOf(suit) === -1) throw new Error('Bad suit');
    if (this.highestBid > 0 && value <= this.highestBid) throw new Error('Must be higher');
    this.highestBid = value;
    this.highestBidderId = playerId;
    this.contract = { value: value, suit: suit };
    this.passCount = 0;
    this.bidsHistory.push({ playerId: playerId, value: value, suit: suit, pass: false });
    this.stateVersion++;
    this.currentTurnIndex = (this.currentTurnIndex + 1) % 4;
  }

  passBid(playerId) {
    if (this.phase !== PHASES.AUCTION) throw new Error('Auction ended');
    this.bidsHistory.push({ playerId: playerId, pass: true });
    this.passCount++;
    this.stateVersion++;
    if (this.highestBid === 0 && this.passCount >= 4) {
      this.startNextRound(true);
      return;
    }
    if (this.highestBid > 0 && this.passCount >= 3) {
      let bidder = null;
      for (let i = 0; i < this.players.length; i++) {
        if (this.players[i].id === this.highestBidderId) bidder = this.players[i];
      }
      if (bidder) {
        this.finishAuction();
        return;
      }
    }
    this.currentTurnIndex = (this.currentTurnIndex + 1) % 4;
  }

  finishAuction() {
    if (this.highestBid === 0) {
      this.startNextRound(true);
      return;
    }
    this.trumpSuit = this.contract.suit;
    this.phase = PHASES.BONUS_DECLARATION;
    let idx = 0;
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].id === this.highestBidderId) idx = i;
    }
    this.currentTurnIndex = idx;
    this.detectAllCombinations();
    this.combinationWindowOpen = true;
  }

  detectAllCombinations() {
    for (let i = 0; i < this.players.length; i++) {
      this.players[i].combinations = RulesEngine.detectCombinations(this.players[i].hand, this.trumpSuit);
    }
  }

  static detectCombinations(hand, trumpSuit) {
    const combos = [];
    const byRank = {};
    for (let i = 0; i < hand.length; i++) {
      const c = hand[i];
      if (!byRank[c.rank]) byRank[c.rank] = [];
      byRank[c.rank].push(c);
    }
    const ranks = Object.keys(byRank);
    for (let ri = 0; ri < ranks.length; ri++) {
      const rank = ranks[ri];
      if (byRank[rank].length === 4) {
        combos.push({
          type: 'FOUR', rank: rank, cards: byRank[rank].slice(), points: 100,
          priority: RulesEngine.fourPriority(rank, trumpSuit)
        });
      }
    }
    for (let si = 0; si < SUITS.length; si++) {
      const suit = SUITS[si];
      const suited = hand.filter(function(c) { return c.suit === suit; }).sort(function(a, b) {
        return RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
      });
      if (suited.length < 3) continue;
      const runs = [];
      let cur = [suited[0]];
      for (let i = 1; i < suited.length; i++) {
        if (RANK_ORDER[suited[i].rank] === RANK_ORDER[suited[i-1].rank] + 1) {
          cur.push(suited[i]);
        } else {
          if (cur.length >= 3) runs.push(cur.slice());
          cur = [suited[i]];
        }
      }
      if (cur.length >= 3) runs.push(cur.slice());
      for (let ri = 0; ri < runs.length; ri++) {
        const run = runs[ri];
        const points = run.length === 3 ? 20 : run.length === 4 ? 50 : 100;
        combos.push({
          type: run.length === 3 ? 'SEQ3' : run.length === 4 ? 'SEQ4' : 'SEQ5',
          suit: suit, cards: run.slice(), points: points, priority: run.length
        });
      }
    }
    if (trumpSuit) {
      let k = null, q = null;
      for (let i = 0; i < hand.length; i++) {
        if (hand[i].suit === trumpSuit && hand[i].rank === 'K') k = hand[i];
        if (hand[i].suit === trumpSuit && hand[i].rank === 'Q') q = hand[i];
      }
      if (k && q) combos.push({ type: 'BLOT', cards: [k, q], points: 0, priority: 100 });
    }
    return combos;
  }

  static fourPriority(rank, trumpSuit) {
    if (!trumpSuit) {
      const o = { A: 6, '10': 5, K: 4, Q: 3, J: 2, '9': 1, '8': 0, '7': 0 };
      return o[rank] || 0;
    }
    const o = { J: 8, '9': 7, A: 6, '10': 5, K: 4, Q: 3, '8': 0, '7': 0 };
    return o[rank] || 0;
  }

  declareCombination(playerId, comboIndex) {
    let p = null;
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].id === playerId) p = this.players[i];
    }
    if (!p) return false;
    const combo = p.combinations[comboIndex];
    if (!combo) return false;
    if (p.declaredCombos.indexOf(combo) !== -1) return false;
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
    let player = null;
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].id === playerId) player = this.players[i];
    }
    if (!player || player.hand.length === 0) return [];
    if (this.trick.length === 0) return player.hand.slice();

    const leadSuit = this.trick[0].card.suit;
    const leadCards = [];
    for (let i = 0; i < player.hand.length; i++) {
      if (player.hand[i].suit === leadSuit) leadCards.push(player.hand[i]);
    }
    if (leadCards.length > 0) return leadCards;

    if (this.trumpSuit === null) return player.hand.slice();

    const trumpsInHand = [];
    for (let i = 0; i < player.hand.length; i++) {
      if (player.hand[i].suit === this.trumpSuit) trumpsInHand.push(player.hand[i]);
    }
    if (trumpsInHand.length === 0) return player.hand.slice();

    const trumpsOnTable = [];
    for (let i = 0; i < this.trick.length; i++) {
      if (this.trick[i].card.suit === this.trumpSuit) trumpsOnTable.push(this.trick[i]);
    }

    const tr = this.trumpSuit;

    if (trumpsOnTable.length === 0) {
      const winner = this.peekTrickWinner();
      if (!winner) return player.hand.slice();
      let wp = null;
      for (let i = 0; i < this.players.length; i++) {
        if (this.players[i].id === winner.playerId) wp = this.players[i];
      }
      if (wp && wp.team !== player.team) {
        const ws = winner.card.strength(tr);
        const higher = [];
        for (let i = 0; i < trumpsInHand.length; i++) {
          if (trumpsInHand[i].strength(tr) > ws) higher.push(trumpsInHand[i]);
        }
        if (higher.length > 0) {
          let ms = 0;
          for (let i = 0; i < higher.length; i++) {
            const s = higher[i].strength(tr);
            if (s > ms) ms = s;
          }
          const result = [];
          for (let i = 0; i < higher.length; i++) {
            if (higher[i].strength(tr) === ms) result.push(higher[i]);
          }
          return result;
        }
      }
      return trumpsInHand;
    }

    let ht = trumpsOnTable[0];
    for (let i = 1; i < trumpsOnTable.length; i++) {
      if (trumpsOnTable[i].card.strength(tr) > ht.card.strength(tr)) ht = trumpsOnTable[i];
    }
    let wp = null;
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].id === ht.playerId) wp = this.players[i];
    }
    if (wp && wp.team !== player.team) {
      const ws = ht.card.strength(tr);
      const higher = [];
      for (let i = 0; i < trumpsInHand.length; i++) {
        if (trumpsInHand[i].strength(tr) > ws) higher.push(trumpsInHand[i]);
      }
      if (higher.length > 0) {
        let ms = 0;
        for (let i = 0; i < higher.length; i++) {
          const s = higher[i].strength(tr);
          if (s > ms) ms = s;
        }
        const result = [];
        for (let i = 0; i < higher.length; i++) {
          if (higher[i].strength(tr) === ms) result.push(higher[i]);
        }
        return result;
      }
    }
    return trumpsInHand;
  }

  playCard(playerId, cardId) {
    if (this.phase !== PHASES.TRICK_PLAY) throw new Error('Not trick phase');
    let player = null;
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].id === playerId) player = this.players[i];
    }
    if (!player) throw new Error('No player');
    if (player.id !== this.players[this.currentTurnIndex].id) throw new Error('Not your turn');
    const legal = this.getLegalCards(playerId);
    let idx = -1;
    for (let i = 0; i < player.hand.length; i++) {
      if (player.hand[i].id === cardId) idx = i;
    }
    if (idx === -1) throw new Error('No card');
    let isLegal = false;
    for (let i = 0; i < legal.length; i++) {
      if (legal[i].id === cardId) isLegal = true;
    }
    if (!isLegal) throw new Error('Illegal');
    const card = player.hand.splice(idx, 1)[0];
    this.trick.push({ playerId: playerId, card: card });
    this.stateVersion++;
    if (this.trick.length === 4) this.resolveTrick();
    else this.currentTurnIndex = (this.currentTurnIndex + 1) % 4;
  }

  peekTrickWinner(t) {
    if (!t) t = this.trick;
    if (!t.length) return null;
    const lead = t[0].card.suit;
    let w = t[0];
    const tr = this.trumpSuit;
    for (let i = 1; i < t.length; i++) {
      const c = t[i];
      const cT = tr !== null && c.card.suit === tr;
      const wT = tr !== null && w.card.suit === tr;
      if (cT && !wT) w = c;
      else if (cT && wT) {
        if (c.card.strength(tr) > w.card.strength(tr)) w = c;
      } else if (!cT && !wT) {
        if (c.card.suit === lead && w.card.suit === lead && c.card.strength(tr) > w.card.strength(tr)) w = c;
      }
    }
    return w;
  }

  resolveTrick() {
    const w = this.peekTrickWinner();
    let wp = null;
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].id === w.playerId) wp = this.players[i];
    }
    const tr = this.trumpSuit;
    let pts = 0;
    for (let i = 0; i < this.trick.length; i++) {
      pts += this.trick[i].card.value(tr);
    }
    const isLast = this.tricksWon.A + this.tricksWon.B + 1 === CONFIG.TRICKS_PER_ROUND;
    if (isLast) pts += CONFIG.LAST_TRICK_BONUS;
    this.pointsWon[wp.team] += pts;
    this.tricksWon[wp.team]++;
    wp.tricksWon++;
    this.tricksHistory.push({
      winnerId: wp.id, winnerTeam: wp.team, points: pts,
      cards: this.trick.slice(), isLastTrick: isLast
    });
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].id === w.playerId) this.currentTurnIndex = i;
    }
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
    let bidder = null;
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].id === this.highestBidderId) bidder = this.players[i];
    }
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
    for (let i = 0; i < this.players.length; i++) {
      this.players[i].score += this.players[i].team === bt ? bS : oS;
    }
    this.lastRoundResult = {
      bidderTeam: bt, oppTeam: ot, bScore: bS, oScore: oS, flag: flag,
      bidderPts: bPts, oppPts: oPts, bidderTricks: bTricks, oppTricks: this.tricksWon[ot],
      contract: this.contract.value, bidPoints: bidPoints, multiplier: mult, trump: this.trumpSuit
    };
    this.phase = PHASES.GAME_SCORE;
    const sA = this.getTeamScore('A');
    const sB = this.getTeamScore('B');
    if (sA >= this.gameTarget || sB >= this.gameTarget) {
      this.winner = sA > sB ? 'A' : sB > sA ? 'B' : null;
      this.phase = PHASES.GAME_END;
    }
  }

  calculateComboPoints(team) {
    let t = 0;
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].team !== team) continue;
      const d = this.players[i].declaredCombos;
      for (let j = 0; j < d.length; j++) t += d[j].points || 0;
    }
    return t;
  }

  getTeamScore(team) {
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].team === team) return this.players[i].score;
    }
    return 0;
  }

  getCurrentPlayer() {
    return this.players[this.currentTurnIndex];
  }

  startNextRound(inc) {
    const sv = { A: this.getTeamScore('A'), B: this.getTeamScore('B') };
    if (inc) this.dealerIndex = (this.dealerIndex + 1) % 4;
    this.roundNumber++;
    this.phase = PHASES.DEALING;
    this.deal();
    for (let i = 0; i < this.players.length; i++) {
      this.players[i].score = sv[this.players[i].team];
    }
    this.stateVersion++;
  }
}

export class BotAI {
  constructor(engine, playerId) {
    this.engine = engine;
    this.playerId = playerId;
  }

  decideBid() {
    let me = null;
    for (let i = 0; i < this.engine.players.length; i++) {
      if (this.engine.players[i].id === this.playerId) me = this.engine.players[i];
    }
    if (!me) return null;
    const ev = this.evaluateHandForBid(me.hand);
    if (ev.best.score < 25) return null;
    const nm = this.engine.highestBid === 0 ? CONFIG.MIN_BID : this.engine.highestBid + CONFIG.BID_INCREMENT;

    let tb = CONFIG.MIN_BID;
    if (ev.best.score >= 90) tb = 16;
    else if (ev.best.score >= 78) tb = 14;
    else if (ev.best.score >= 65) tb = 12;
    else if (ev.best.score >= 52) tb = 11;
    else if (ev.best.score >= 40) tb = 10;
    else if (ev.best.score >= 30) tb = 9;

    // Bid only as high as the team can plausibly catch: own trick points
    // plus an estimated partner share of the remaining trick points.
    const reachCeil = Math.max(CONFIG.MIN_BID, Math.floor(BotAI.estimateTeamCatch(me.hand, ev.best.suit) / CONFIG.BID_SCORE_MULT));
    tb = Math.min(tb, reachCeil);
    if (tb > CONFIG.MAX_BID) tb = CONFIG.MAX_BID;

    // Never bid a value whose failure would hand the opponent the game.
    const oppTeam = me.team === 'A' ? 'B' : 'A';
    const oppScore = this.engine.getTeamScore(oppTeam);
    while (tb > CONFIG.MIN_BID) {
      const failPts = (tb * CONFIG.BID_SCORE_MULT + CONFIG.CONTRACT_BONUS) * Math.max(1, this.engine.multiplier);
      if (oppScore + failPts < this.engine.gameTarget) break;
      tb--;
    }

    if (tb < nm) {
      if (nm <= reachCeil && ((nm <= 11 && ev.best.score >= 45) || (nm <= 9 && ev.best.score >= 32))) tb = nm;
      else return null;
    }
    if (tb < CONFIG.MIN_BID) tb = CONFIG.MIN_BID;
    if (tb > CONFIG.MAX_BID) return null;
    return { value: tb, suit: ev.best.suit };
  }

  static estimateTeamCatch(hand, trump) {
    let total = CONFIG.LAST_TRICK_BONUS;
    for (let i = 0; i < SUITS.length; i++) {
      for (let j = 0; j < RANKS.length; j++) {
        const s = SUITS[i], r = RANKS[j];
        total += (trump && s === trump) ? TRUMP_VALUES[r] : NON_TRUMP_VALUES[r];
      }
    }
    let own = 0;
    for (let i = 0; i < hand.length; i++) own += hand[i].value(trump);
    const remaining = total - own;
    return own + remaining * 0.5;
  }

  evaluateHandForBid(hand) {
    const suitList = [null].concat(SUITS);
    let best = { suit: null, score: 0 };
    for (let si = 0; si < suitList.length; si++) {
      const ts = suitList[si];
      let sc = 0;
      const byS = { '\u2660': [], '\u2665': [], '\u2666': [], '\u2663': [] };
      for (let i = 0; i < hand.length; i++) {
        byS[hand[i].suit].push(hand[i].rank);
      }
      if (!ts) {
        const cnt = { A: 0, '10': 0, K: 0, Q: 0, J: 0 };
        for (let i = 0; i < hand.length; i++) {
          if (cnt[hand[i].rank] !== undefined) cnt[hand[i].rank]++;
        }
        sc = (cnt.A || 0) * 16 + (cnt['10'] || 0) * 13 + (cnt.K || 0) * 6 + (cnt.Q || 0) * 3 + (cnt.J || 0) * 1;
        for (let j = 0; j < SUITS.length; j++) {
          const l = byS[SUITS[j]].length;
          if (l === 0) sc += 7;
          else if (l === 1) sc += 3;
        }
      } else {
        const tr = byS[ts];
        const hJ = tr.indexOf('J') !== -1;
        const h9 = tr.indexOf('9') !== -1;
        const hA = tr.indexOf('A') !== -1;
        const h10 = tr.indexOf('10') !== -1;
        const hK = tr.indexOf('K') !== -1;
        const hQ = tr.indexOf('Q') !== -1;
        sc = tr.length * 6;
        if (hJ) sc += 26;
        if (h9) sc += 17;
        if (hA) sc += 12;
        if (h10) sc += 10;
        if (hK) sc += 5;
        if (hQ) sc += 3;
        if (hJ && h9) sc += 14;
        if (hA && h10) sc += 9;
        for (let j = 0; j < SUITS.length; j++) {
          if (SUITS[j] === ts) continue;
          const ranks = byS[SUITS[j]];
          for (let k = 0; k < ranks.length; k++) {
            if (ranks[k] === 'A') sc += 10;
            else if (ranks[k] === '10') sc += 6;
            else if (ranks[k] === 'K') sc += 2;
          }
        }
      }
      if (sc > best.score) best = { suit: ts, score: Math.min(100, sc) };
    }
    return { best: best };
  }

  decideCard() {
    const legal = this.engine.getLegalCards(this.playerId);
    if (!legal.length) return null;
    if (legal.length === 1) return legal[0];
    const rt = CONFIG.TRICKS_PER_ROUND - (this.engine.tricksWon.A + this.engine.tricksWon.B);
    if (rt <= 2) return this.minimaxBestCard(legal);
    const sims = rt >= 5 ? CONFIG.MC_SIMULATIONS : CONFIG.MC_SIMULATIONS_ENDGAME;
    const scores = {};
    for (let i = 0; i < legal.length; i++) scores[legal[i].id] = 0;
    for (let i = 0; i < sims; i++) {
      const w = this.generateWorld();
      if (!w) continue;
      for (let j = 0; j < legal.length; j++) {
        scores[legal[j].id] += this.simulatePlayout(legal[j], w);
      }
    }
    let best = legal[0], bv = -Infinity;
    for (let i = 0; i < legal.length; i++) {
      if (scores[legal[i].id] > bv) {
        bv = scores[legal[i].id];
        best = legal[i];
      }
    }
    return best;
  }

  generateWorld() {
    let me = null;
    for (let i = 0; i < this.engine.players.length; i++) {
      if (this.engine.players[i].id === this.playerId) me = this.engine.players[i];
    }
    if (!me) return null;
    const mine = {};
    for (let i = 0; i < me.hand.length; i++) mine[me.hand[i].id] = true;
    const played = {};
    for (let i = 0; i < this.engine.tricksHistory.length; i++) {
      const cards = this.engine.tricksHistory[i].cards;
      for (let j = 0; j < cards.length; j++) played[cards[j].card.id] = true;
    }
    for (let i = 0; i < this.engine.trick.length; i++) played[this.engine.trick[i].card.id] = true;
    const pool = [];
    for (let si = 0; si < SUITS.length; si++) {
      for (let ri = 0; ri < RANKS.length; ri++) {
        const id = SUITS[si] + '-' + RANKS[ri];
        if (mine[id] || played[id]) continue;
        pool.push(new Card(SUITS[si], RANKS[ri]));
      }
    }
    const sh = shuffleSecure(pool);
    const hands = {};
    let idx = 0;
    for (let i = 0; i < this.engine.players.length; i++) {
      const p = this.engine.players[i];
      if (p.id === this.playerId) continue;
      const pc = this.countPlayedByPlayer(p.id);
      const rem = CONFIG.CARDS_PER_PLAYER - pc;
      const nh = [];
      for (let k = 0; k < rem && idx < sh.length; k++) nh.push(sh[idx++]);
      hands[p.id] = nh;
    }
    return { hands: hands };
  }

  countPlayedByPlayer(pid) {
    let n = 0;
    for (let i = 0; i < this.engine.tricksHistory.length; i++) {
      const cards = this.engine.tricksHistory[i].cards;
      for (let j = 0; j < cards.length; j++) {
        if (cards[j].playerId === pid) n++;
      }
    }
    for (let i = 0; i < this.engine.trick.length; i++) {
      if (this.engine.trick[i].playerId === pid) n++;
    }
    return n;
  }

  simulatePlayout(cand, world) {
    const tr = this.engine.trumpSuit;
    let me = null;
    for (let i = 0; i < this.engine.players.length; i++) {
      if (this.engine.players[i].id === this.playerId) me = this.engine.players[i];
    }
    const mt = me.team;
    const pls = this.engine.players;
    const hands = {};
    const myHand = [];
    for (let i = 0; i < me.hand.length; i++) {
      if (me.hand[i].id !== cand.id) myHand.push(me.hand[i]);
    }
    hands[this.playerId] = myHand;
    const keys = Object.keys(world.hands);
    for (let i = 0; i < keys.length; i++) hands[keys[i]] = world.hands[keys[i]].slice();
    let trk = this.engine.trick.slice();
    trk.push({ playerId: this.playerId, card: cand });
    let ct = (this.engine.currentTurnIndex + 1) % 4;
    let tA = this.engine.tricksWon.A;
    let tB = this.engine.tricksWon.B;
    let pA = this.engine.pointsWon.A;
    let pB = this.engine.pointsWon.B;
    const rem = CONFIG.TRICKS_PER_ROUND - (tA + tB);
    let pl = 0;
    while (pl < rem) {
      while (trk.length < 4) {
        const pid = pls[ct].id;
        const h = hands[pid];
        if (!h || !h.length) { ct = (ct + 1) % 4; continue; }
        const lg = this.quickLegal(h, trk, tr);
        const ch = this.quickPolicy(pid, lg, trk, tr);
        let ci = -1;
        for (let i = 0; i < h.length; i++) if (h[i].id === ch.id) ci = i;
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
      let wp = null;
      for (let i = 0; i < pls.length; i++) {
        if (pls[i].id === wn.playerId) wp = pls[i];
      }
      const wt = wp.team;
      let pts = 0;
      for (let i = 0; i < trk.length; i++) pts += trk[i].card.value(tr);
      if (pl === rem - 1) pts += CONFIG.LAST_TRICK_BONUS;
      if (wt === 'A') { tA++; pA += pts; } else { tB++; pB += pts; }
      for (let i = 0; i < pls.length; i++) {
        if (pls[i].id === wn.playerId) ct = i;
      }
      trk = [];
      pl++;
    }
    const mtPts = mt === 'A' ? pA : pB;
    const opPts = mt === 'A' ? pB : pA;
    return mtPts - opPts * 0.9;
  }

  quickLegal(h, tk, tr) {
    if (!tk.length) return h.slice();
    const ld = tk[0].card.suit;
    const lc = [];
    for (let i = 0; i < h.length; i++) if (h[i].suit === ld) lc.push(h[i]);
    if (lc.length) return lc;
    if (!tr) return h.slice();
    const ts = [];
    for (let i = 0; i < h.length; i++) if (h[i].suit === tr) ts.push(h[i]);
    return ts.length ? ts : h.slice();
  }

  quickPolicy(pid, lg, tk, tr) {
    if (!lg.length) return null;
    if (lg.length === 1) return lg[0];
    if (!tk.length) {
      let best = lg[0];
      for (let i = 1; i < lg.length; i++) if (lg[i].value(tr) > best.value(tr)) best = lg[i];
      return best;
    }
    const wn = this.quickWinner(tk, tr);
    let mt = null, wt = null;
    for (let i = 0; i < this.engine.players.length; i++) {
      if (this.engine.players[i].id === pid) mt = this.engine.players[i].team;
      if (this.engine.players[i].id === wn.playerId) wt = this.engine.players[i].team;
    }
    if (mt === wt) {
      let best = lg[0];
      for (let i = 1; i < lg.length; i++) if (lg[i].value(tr) < best.value(tr)) best = lg[i];
      return best;
    }
    let best = lg[0];
    for (let i = 1; i < lg.length; i++) if (lg[i].strength(tr) > best.strength(tr)) best = lg[i];
    return best;
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
    for (let i = 0; i < lg.length; i++) {
      const v = this.evaluateEndgame(lg[i]);
      if (v > bv) { bv = v; best = lg[i]; }
    }
    return best;
  }

  evaluateEndgame(c) {
    const tr = this.engine.trumpSuit;
    let me = null;
    for (let i = 0; i < this.engine.players.length; i++) {
      if (this.engine.players[i].id === this.playerId) me = this.engine.players[i];
    }
    const mt = me.team;
    let v = c.value(tr) * 1.6 + c.strength(tr) * 2.4;
    const tt = this.engine.trick.slice();
    tt.push({ playerId: this.playerId, card: c });
    if (tt.length === 4) {
      const wn = this.quickWinner(tt, tr);
      let wp = null;
      for (let i = 0; i < this.engine.players.length; i++) {
        if (this.engine.players[i].id === wn.playerId) wp = this.engine.players[i];
      }
      if (wp.team === mt) {
        let pts = 0;
        for (let i = 0; i < tt.length; i++) pts += tt[i].card.value(tr);
        if (this.engine.tricksWon.A + this.engine.tricksWon.B === CONFIG.TRICKS_PER_ROUND - 1) {
          pts += CONFIG.LAST_TRICK_BONUS;
        }
        v += pts * 1.5;
      }
    }
    return v;
  }
}
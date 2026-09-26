// RIICHI BOARD の点数の決まりごと（DOM に触らない）。main.js（ブラウザ）と tools/test.js（node）から読む。
//
// 役の判定はしない。翻と符は人が数える。「符＼翻」の表と例は
// docs/private/specs/riichi-board.md の「3. ルール・遊び方」に出典がある。

// 基本点 b。1〜4 翻は符から、5 翻以上は名前で決まる（満貫〜役満）。
// kiriage（切り上げ満貫）がオンなら 30符4翻・60符3翻（どちらも b=1920）を満貫（2000）にする。
export function baseValue(han, fu, kiriage) {
  if (han >= 13) return 8000; // 数え役満
  if (han >= 11) return 6000; // 三倍満
  if (han >= 8) return 4000; // 倍満
  if (han >= 6) return 3000; // 跳満
  if (han === 5) return 2000; // 満貫
  if (kiriage && ((fu === 30 && han === 4) || (fu === 60 && han === 3))) return 2000;
  return Math.min(fu * Math.pow(2, han + 2), 2000);
}

export function ceil100(n) {
  return Math.ceil(n / 100) * 100;
}

// ロンで放銃した人が払う点（本場を含まない）
export function ronPayment(han, fu, dealer, kiriage) {
  const b = baseValue(han, fu, kiriage);
  return ceil100(dealer ? 6 * b : 4 * b);
}

// ツモで各自が払う点（本場を含まない）。dealer: 親が上がったか
// 戻り値: { dealerPay: 親が払う額, kidPay: 子 1 人が払う額 }（親のツモなら dealerPay は使わない）
export function tsumoPayment(han, fu, dealer, kiriage) {
  const b = baseValue(han, fu, kiriage);
  if (dealer) return { dealerPay: 0, kidPay: ceil100(2 * b) };
  return { dealerPay: ceil100(2 * b), kidPay: ceil100(b) };
}

// あがりの結果をまとめて出す（あがりの入力の画面に出す用）
// { han, fu, dealer, tsumo, kiriage, loser (ロンのときの席), winner, honba, kyotaku }
export function scoreWin({ han, fu, dealer, tsumo, kiriage, honba }) {
  const b = baseValue(han, fu, kiriage);
  if (tsumo) {
    const { dealerPay, kidPay } = tsumoPayment(han, fu, dealer, kiriage);
    const honbaEach = honba * 100;
    return { b, tsumo: true, dealerPay: dealerPay ? dealerPay + honbaEach : 0, kidPay: kidPay + honbaEach };
  }
  const pay = ronPayment(han, fu, dealer, kiriage) + honba * 300;
  return { b, tsumo: false, pay };
}

// 流局の聴牌料。tenpai: 4 人の真偽。戻り値は 4 人分の点の増減（動かないときは全部 0）
export function ryuukyokuPayments(tenpai) {
  const count = tenpai.filter(Boolean).length;
  const table = { 1: [3000, 1000], 2: [1500, 1500], 3: [1000, 3000] };
  const rule = table[count];
  if (!rule) return [0, 0, 0, 0];
  const [win, lose] = rule;
  return tenpai.map((t) => (t ? win : -lose));
}

// この組み合わせはふつう出ない（点数表・入力の確認に「この組み合わせは普通は出ません」と出す用）
export function isUnusualFuHan(fu, han, tsumo) {
  if (fu === 20 && !tsumo) return true; // 20符のロン
  if (fu === 20 && han === 1) return true; // 20符1翻
  if (fu === 25 && han === 1) return true; // 25符1翻
  if (fu === 25 && han === 2 && tsumo) return true; // 25符2翻のツモ
  return false;
}

const SEATS = 4;
const HANDS_PER_ROUND_SET = 4; // 東 4 局、南 4 局、…
export const ROUND_NAMES = ['東', '南', '西', '北'];

export function roundLabel(round) {
  const set = Math.floor(round / HANDS_PER_ROUND_SET);
  const num = (round % HANDS_PER_ROUND_SET) + 1;
  return `${ROUND_NAMES[Math.min(set, ROUND_NAMES.length - 1)]}${num}局`;
}

function lastRound(length) {
  return length === 'tonpu' ? 3 : 7; // 東風戦 = 東4局(3)まで、半荘 = 南4局(7)まで
}

function cloneState(state) {
  return {
    scores: [...state.scores],
    startDealer: state.startDealer,
    dealer: state.dealer,
    round: state.round,
    honba: state.honba,
    kyotaku: state.kyotaku,
    riichi: [...state.riichi],
    hands: state.hands,
    ended: state.ended,
  };
}

export function newGame({ start = 25000, startDealer = 0 } = {}) {
  return {
    scores: [start, start, start, start],
    startDealer,
    dealer: startDealer,
    round: 0,
    honba: 0,
    kyotaku: 0,
    riichi: [false, false, false, false],
    hands: 0,
    ended: false,
    undo: [],
  };
}

function pushUndo(state) {
  state.undo.push(cloneState(state));
  if (state.undo.length > 50) state.undo.shift();
}

export function undo(state) {
  const prev = state.undo.pop();
  if (!prev) return state;
  return { ...prev, undo: state.undo };
}

// リーチ（1000 点払って供託 +1）
export function doRiichi(state, seat) {
  pushUndo(state);
  state.scores[seat] -= 1000;
  state.kyotaku += 1;
  state.riichi[seat] = true;
  return state;
}

function advanceAfterHand(state, dealerWon, length) {
  const wasLastRound = state.round === lastRound(length);
  if (dealerWon) {
    state.honba += 1;
  } else {
    state.round += 1;
    state.dealer = (state.dealer + 1) % SEATS;
    state.honba = 0;
  }
  state.riichi = [false, false, false, false];
  state.hands += 1;
  if (state.scores.some((s) => s < 0)) state.ended = true;
  else if (wasLastRound && !dealerWon) state.ended = true;
}

// あがり（ロン・ツモ）を状態に当てる。win: 席番号、loser: ロンで放銃した席（ツモなら不要）
// length: 'hanchan' | 'tonpu'（対局の終わりの判定に使う。設定に持つので state には含めない）
export function applyWin(state, { winner, tsumo, loser, han, fu, kiriage, length }) {
  pushUndo(state);
  const dealerWon = winner === state.dealer;
  const result = scoreWin({ han, fu, dealer: dealerWon, tsumo, kiriage, honba: state.honba });
  if (tsumo) {
    for (let i = 0; i < SEATS; i++) {
      if (i === winner) continue;
      const pay = i === state.dealer ? result.dealerPay : result.kidPay;
      state.scores[i] -= pay;
      state.scores[winner] += pay;
    }
  } else {
    state.scores[loser] -= result.pay;
    state.scores[winner] += result.pay;
  }
  state.scores[winner] += state.kyotaku * 1000;
  state.kyotaku = 0;
  advanceAfterHand(state, dealerWon, length);
  return state;
}

// 流局。tenpai: 4 人の聴牌の真偽
export function applyRyuukyoku(state, tenpai, length) {
  pushUndo(state);
  const payments = ryuukyokuPayments(tenpai);
  for (let i = 0; i < SEATS; i++) state.scores[i] += payments[i];
  const dealerTenpai = tenpai[state.dealer];
  const wasLastRound = state.round === lastRound(length);
  state.honba += 1;
  if (!dealerTenpai) {
    state.round += 1;
    state.dealer = (state.dealer + 1) % SEATS;
  }
  state.riichi = [false, false, false, false];
  state.hands += 1;
  if (state.scores.some((s) => s < 0)) state.ended = true;
  else if (wasLastRound && !dealerTenpai) state.ended = true;
  return state;
}

// 途中流局（九種九牌など）。点は動かず、親は続ける、本場 +1
export function applyChuutoRyuukyoku(state) {
  pushUndo(state);
  state.honba += 1;
  state.riichi = [false, false, false, false];
  state.hands += 1;
  return state;
}

// メニューの「点を直す」。持ち点・本場・供託・親を手で書き換える
export function applyCorrect(state, patch) {
  pushUndo(state);
  if (patch.scores) state.scores = [...patch.scores];
  if (patch.honba != null) state.honba = patch.honba;
  if (patch.kyotaku != null) state.kyotaku = patch.kyotaku;
  if (patch.dealer != null) state.dealer = patch.dealer;
  return state;
}

// 続ける（結果の画面から）。西入などのため ended を戻すだけ
export function continueGame(state) {
  pushUndo(state);
  state.ended = false;
  return state;
}

// 結果の順位。持ち点の多い順、同点は起家（dealer=0 が最初の親）に近い順。最後の供託は 1 位に足す
export function ranking(state) {
  const order = [0, 1, 2, 3].map((seat) => {
    // 起家からの近さ = 起家から見た席順（0 が起家、以下 1,2,3）
    const distFromStart = (seat - state.startDealer + SEATS) % SEATS;
    return { seat, score: state.scores[seat], distFromStart };
  });
  order.sort((a, b) => b.score - a.score || a.distFromStart - b.distFromStart);
  if (order.length) order[0].score += state.kyotaku * 1000;
  return order;
}

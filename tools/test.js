// node tools/test.js — 点数計算と持ち点の動きの自己チェック
// docs/private/specs/riichi-board.md の「3. ルール・遊び方」の表と例 A〜H を全部照らす。
import assert from 'node:assert/strict';
import {
  baseValue, ronPayment, tsumoPayment, ceil100, isUnusualFuHan,
  newGame, doRiichi, applyWin, applyRyuukyoku, applyChuutoRyuukyoku, applyCorrect, undo, continueGame, ranking, roundLabel,
} from '../js/score.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`ok ${name}`); };

// ---- 子のロン ----
test('子のロン', () => {
  const cases = [
    [25, 2, 1600], [25, 3, 3200], [25, 4, 6400],
    [30, 1, 1000], [30, 2, 2000], [30, 3, 3900], [30, 4, 7700],
    [40, 1, 1300], [40, 2, 2600], [40, 3, 5200], [40, 4, 8000],
    [50, 1, 1600], [50, 2, 3200], [50, 3, 6400], [50, 4, 8000],
    [60, 1, 2000], [60, 2, 3900], [60, 3, 7700], [60, 4, 8000],
    [70, 1, 2300], [70, 2, 4500], [70, 3, 8000], [70, 4, 8000],
    [110, 1, 3600], [110, 2, 7100], [110, 3, 8000], [110, 4, 8000],
  ];
  for (const [fu, han, want] of cases) assert.equal(ronPayment(han, fu, false, false), want, `${fu}符${han}翻`);
  // 切り上げ満貫: 30符4翻・60符3翻が満貫(8000)になる
  assert.equal(ronPayment(4, 30, false, true), 8000);
  assert.equal(ronPayment(3, 60, false, true), 8000);
});

test('親のロン', () => {
  const cases = [
    [25, 2, 2400], [25, 3, 4800], [25, 4, 9600],
    [30, 1, 1500], [30, 2, 2900], [30, 3, 5800], [30, 4, 11600],
    [40, 1, 2000], [40, 2, 3900], [40, 3, 7700], [40, 4, 12000],
    [110, 1, 5300], [110, 2, 10600], [110, 3, 12000], [110, 4, 12000],
  ];
  for (const [fu, han, want] of cases) assert.equal(ronPayment(han, fu, true, false), want, `${fu}符${han}翻`);
  assert.equal(ronPayment(4, 30, true, true), 12000);
});

test('子のツモ（子払い-親払い）', () => {
  const cases = [
    [20, 2, 400, 700], [20, 3, 700, 1300], [20, 4, 1300, 2600],
    [25, 3, 800, 1600], [25, 4, 1600, 3200],
    [30, 1, 300, 500], [30, 2, 500, 1000], [30, 3, 1000, 2000], [30, 4, 2000, 3900],
    [40, 1, 400, 700], [40, 2, 700, 1300], [40, 3, 1300, 2600], [40, 4, 2000, 4000], // 40符4翻は満貫キャップ
  ];
  for (const [fu, han, kid, dealer] of cases) {
    const { kidPay, dealerPay } = tsumoPayment(han, fu, false, false);
    assert.equal(kidPay, kid, `${fu}符${han}翻 子`);
    assert.equal(dealerPay, dealer, `${fu}符${han}翻 親`);
  }
});

test('親のツモ（オール）', () => {
  const cases = [
    [20, 2, 700], [20, 3, 1300], [20, 4, 2600],
    [30, 1, 500], [30, 2, 1000], [30, 3, 2000], [30, 4, 3900],
    [40, 1, 700], [40, 2, 1300], [40, 3, 2600], [40, 4, 4000], // 40符4翻は満貫キャップ
  ];
  for (const [fu, han, all] of cases) {
    const { kidPay } = tsumoPayment(han, fu, true, false);
    assert.equal(kidPay, all, `${fu}符${han}翻`);
  }
});

test('満貫以上', () => {
  // [han, 子ロン, 子ツモ(子,親), 親ロン, 親ツモ(オール)]
  const cases = [
    [5, 8000, [2000, 4000], 12000, 4000],
    [6, 12000, [3000, 6000], 18000, 6000],
    [8, 16000, [4000, 8000], 24000, 8000],
    [11, 24000, [6000, 12000], 36000, 12000],
    [13, 32000, [8000, 16000], 48000, 16000],
  ];
  for (const [han, ronKid, [tsumoKid, tsumoDealer], ronDealer, tsumoAll] of cases) {
    assert.equal(ronPayment(han, 30, false, false), ronKid, `han${han} 子ロン`);
    const kidTsumo = tsumoPayment(han, 30, false, false);
    assert.equal(kidTsumo.kidPay, tsumoKid, `han${han} 子ツモ 子`);
    assert.equal(kidTsumo.dealerPay, tsumoDealer, `han${han} 子ツモ 親`);
    assert.equal(ronPayment(han, 30, true, false), ronDealer, `han${han} 親ロン`);
    assert.equal(tsumoPayment(han, 30, true, false).kidPay, tsumoAll, `han${han} 親ツモ`);
  }
});

test('ふつう出ない組み合わせの印', () => {
  assert.equal(isUnusualFuHan(20, 1, true), true);
  assert.equal(isUnusualFuHan(20, 3, false), true); // 20符のロン
  assert.equal(isUnusualFuHan(25, 1, false), true);
  assert.equal(isUnusualFuHan(25, 2, true), true);
  assert.equal(isUnusualFuHan(25, 2, false), false); // 25符2翻のロンはふつうに出る
  assert.equal(isUnusualFuHan(30, 3, false), false);
});

test('ceil100', () => {
  assert.equal(ceil100(3900), 3900);
  assert.equal(ceil100(3801), 3900);
  assert.equal(ceil100(1), 100);
  assert.equal(ceil100(0), 0);
});

// ---- 持ち点の動き（例 A〜H） ----

test('例 A: 席1（子）が席2からロン、30符3翻', () => {
  const g = newGame({ start: 25000, startDealer: 0 });
  applyWin(g, { winner: 1, tsumo: false, loser: 2, han: 3, fu: 30, kiriage: false, length: 'hanchan' });
  assert.deepEqual(g.scores, [25000, 28900, 21100, 25000]);
  assert.equal(roundLabel(g.round), '東2局');
  assert.equal(g.dealer, 1);
  assert.equal(g.honba, 0);
});

test('例 B: 席0がリーチ → 席0（親）がツモ、40符2翻', () => {
  const g = newGame({ start: 25000, startDealer: 0 });
  doRiichi(g, 0);
  applyWin(g, { winner: 0, tsumo: true, han: 2, fu: 40, kiriage: false, length: 'hanchan' });
  assert.deepEqual(g.scores, [28900, 23700, 23700, 23700]);
  assert.equal(roundLabel(g.round), '東1局');
  assert.equal(g.honba, 1);
  assert.equal(g.kyotaku, 0);
});

test('例 C: B のあと（1本場）、席2（子）がツモ、30符1翻', () => {
  const g = newGame({ start: 25000, startDealer: 0 });
  doRiichi(g, 0);
  applyWin(g, { winner: 0, tsumo: true, han: 2, fu: 40, kiriage: false, length: 'hanchan' });
  applyWin(g, { winner: 2, tsumo: true, han: 1, fu: 30, kiriage: false, length: 'hanchan' });
  assert.deepEqual(g.scores, [28300, 23300, 25100, 23300]);
  assert.equal(roundLabel(g.round), '東2局');
  assert.equal(g.dealer, 1);
  assert.equal(g.honba, 0);
});

test('例 D: はじめから1本場、流局、聴牌は席0と席2', () => {
  const g = newGame({ start: 25000, startDealer: 0 });
  applyCorrect(g, { honba: 1 });
  applyRyuukyoku(g, [true, false, true, false], 'hanchan');
  assert.deepEqual(g.scores, [26500, 23500, 26500, 23500]);
  assert.equal(g.dealer, 0);
  assert.equal(roundLabel(g.round), '東1局');
  assert.equal(g.honba, 2);
});

test('例 E: はじめから、流局、聴牌は席3だけ', () => {
  const g = newGame({ start: 25000, startDealer: 0 });
  applyRyuukyoku(g, [false, false, false, true], 'hanchan');
  assert.deepEqual(g.scores, [24000, 24000, 24000, 28000]);
  assert.equal(g.dealer, 1);
  assert.equal(roundLabel(g.round), '東2局');
  assert.equal(g.honba, 1);
});

test('例 F: 2本場・供託1本、席3（子）が席0からロン、満貫', () => {
  const g = newGame({ start: 25000, startDealer: 0 });
  applyCorrect(g, { honba: 2, kyotaku: 1 });
  applyWin(g, { winner: 3, tsumo: false, loser: 0, han: 5, fu: 30, kiriage: false, length: 'hanchan' });
  assert.deepEqual(g.scores, [16400, 25000, 25000, 34600]);
  assert.equal(roundLabel(g.round), '東2局');
  assert.equal(g.honba, 0);
  assert.equal(g.kyotaku, 0);
});

test('例 G: 半荘の南4局（親は席3）で、席0が席1からロン → 対局の終わり', () => {
  const g = newGame({ start: 25000, startDealer: 0 });
  applyCorrect(g, { dealer: 3 });
  g.round = 7; // 南4局
  applyWin(g, { winner: 0, tsumo: false, loser: 1, han: 2, fu: 30, kiriage: false, length: 'hanchan' });
  assert.equal(g.ended, true);
  assert.equal(roundLabel(g.round), '西1局');
  continueGame(g);
  assert.equal(g.ended, false);
});

test('例 H: 誰かが0未満になった → 結果を出す（続けるで続けられる）', () => {
  const g = newGame({ start: 1000, startDealer: 0 });
  applyWin(g, { winner: 1, tsumo: false, loser: 0, han: 5, fu: 30, kiriage: false, length: 'hanchan' });
  assert.ok(g.scores[0] < 0);
  assert.equal(g.ended, true);
  continueGame(g);
  assert.equal(g.ended, false);
});

test('戻す: 1回押すと直前の状態に完全に戻る', () => {
  const g = newGame({ start: 25000, startDealer: 0 });
  const before = JSON.stringify({ scores: g.scores, dealer: g.dealer, round: g.round, honba: g.honba, kyotaku: g.kyotaku, riichi: g.riichi });
  applyWin(g, { winner: 1, tsumo: false, loser: 2, han: 3, fu: 30, kiriage: false, length: 'hanchan' });
  const after = undo(g);
  assert.equal(JSON.stringify({ scores: after.scores, dealer: after.dealer, round: after.round, honba: after.honba, kyotaku: after.kyotaku, riichi: after.riichi }), before);
});

test('途中流局: 点は動かず親は続ける、本場+1', () => {
  const g = newGame({ start: 25000, startDealer: 0 });
  applyChuutoRyuukyoku(g);
  assert.deepEqual(g.scores, [25000, 25000, 25000, 25000]);
  assert.equal(g.dealer, 0);
  assert.equal(g.honba, 1);
});

test('順位: 持ち点の多い順、同点は起家に近い順、最後の供託は1位に足す', () => {
  const g = newGame({ start: 25000, startDealer: 2 });
  g.scores = [25000, 30000, 25000, 20000];
  g.kyotaku = 1;
  const order = ranking(g);
  assert.deepEqual(order.map((o) => o.seat), [1, 2, 0, 3]); // 30000 > 同点25000(起家2が先) > 20000
  assert.equal(order[0].score, 31000); // 供託1000が1位に足される
});

console.log(`\n${n} 件すべて通った`);

'use strict';

import {
  ROUND_NAMES, roundLabel, scoreWin, ryuukyokuPayments, isUnusualFuHan,
  newGame, doRiichi, applyWin, applyRyuukyoku, applyChuutoRyuukyoku, applyCorrect, undo, continueGame, ranking,
} from './js/score.js';

// localStorage はほかのアプリと共有される（同じ t-of.github.io のため）。
// キーは必ず 'riichi-board.' で始める。
const STORE = 'riichi-board.';

function load(key, fallback) {
  try {
    const v = localStorage.getItem(STORE + key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch { /* 保存できなくても遊べる */ }
}

WebAppKit.init({ title: 'RIICHI BOARD', text: '麻雀の卓の真ん中に置く、点数計算と持ち点の表示盤。翻と符を押すと点数と「誰が誰にいくら払うか」が出て、確定すると 4 人の持ち点・本場・供託が自動で動く。' });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

// 音を使うときは、鳴らす前と音の設定を切り替えたときにこれを呼ぶ（RULES.md §5「音」）。
function setAudioSession(soundOn) {
  try { if (navigator.audioSession) navigator.audioSession.type = soundOn ? 'playback' : 'auto'; } catch { /* 対応していない */ }
}

// ---- ここからアプリ本体 ----

const SEATS = 4;
const DEFAULT_SETTINGS = { v: 1, sound: true, length: 'hanchan', start: 25000, kiriage: false, names: ['', '', '', ''] };

function loadSettings() {
  const s = load('settings', DEFAULT_SETTINGS);
  if (!s || s.v !== 1 || !Array.isArray(s.names) || s.names.length !== 4) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...s };
}
function saveSettings() { save('settings', settings); }

function loadGame() {
  const g = load('game', null);
  if (!g || g.v !== 1 || !Array.isArray(g.scores) || g.scores.length !== 4) return null;
  return g;
}
function saveGame() { if (game) save('game', { ...game, v: 1 }); }
function clearGame() { game = null; try { localStorage.removeItem(STORE + 'game'); } catch { /* noop */ } }

let settings = loadSettings();
let game = loadGame();

// ---- 音（Web Audio。マナーモードでも鳴る） ----
let actx = null;
function ensureAudio() {
  if (!settings.sound) return null;
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
  setAudioSession(true);
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function tone(ctx, t0, freq, dur, gain = 0.16) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}
function playSeq(freqs, step, dur) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const now = ctx.currentTime;
  freqs.forEach((f, i) => tone(ctx, now + i * step, f, dur));
}
const playClick = () => playSeq([880], 0, 0.03);
const playRiichi = () => playSeq([1046, 1568], 0.06, 0.09);
const playWinSound = (han) => (han >= 13 ? playSeq([784, 988, 1174, 1396, 1568], 0.1, 0.14) : playSeq([659, 880, 1046], 0.09, 0.15));
const playRyuukyokuSound = () => playSeq([440, 440], 0.1, 0.18);
const playUndoSound = () => playSeq([700, 440], 0.05, 0.1);
const playResultSound = () => playSeq([659, 784, 988, 1318], 0.1, 0.18);

// ---- 画面の切り替え ----
const screens = Array.from(document.querySelectorAll('.screen'));
function showScreen(id) {
  screens.forEach((el) => { el.hidden = el.id !== id; });
}
function showSheet(id) { document.getElementById(id).hidden = false; }
function hideSheet(id) { document.getElementById(id).hidden = true; }

let howtoReturn = 'screen-title';

// ---- タイトル ----
const soundToggle = document.getElementById('sound-toggle');
soundToggle.checked = settings.sound;
soundToggle.addEventListener('change', () => {
  settings.sound = soundToggle.checked;
  setAudioSession(settings.sound);
  saveSettings();
});

document.getElementById('btn-continue-game').hidden = !(game && !game.ended);
document.getElementById('btn-new-game').addEventListener('click', () => { playClick(); openSetup(); });
document.getElementById('btn-continue-game').addEventListener('click', () => { playClick(); enterTable(); });
document.getElementById('btn-score-table').addEventListener('click', () => { playClick(); howtoReturn = 'screen-title'; openScoreTable(); });
document.getElementById('btn-howto').addEventListener('click', () => { playClick(); howtoReturn = 'screen-title'; showScreen('screen-howto'); });
document.getElementById('btn-howto-back').addEventListener('click', () => { playClick(); showScreen(howtoReturn); });

// ---- はじめの設定 ----
let setupSeat = 0;
function openSetup() {
  document.querySelector(`input[name="length"][value="${settings.length}"]`).checked = true;
  const startRadio = document.querySelector(`input[name="start"][value="${settings.start}"]`);
  if (startRadio) { startRadio.checked = true; document.getElementById('start-other').value = ''; }
  else { document.querySelector('input[name="start"][value="other"]').checked = true; document.getElementById('start-other').value = settings.start; }
  document.querySelector(`input[name="kiriage"][value="${settings.kiriage ? 'on' : 'off'}"]`).checked = true;
  document.querySelectorAll('.name-input').forEach((inp) => { inp.value = settings.names[Number(inp.dataset.seat)] || ''; });
  setupSeat = 0;
  updateSeatPicker();
  showScreen('screen-setup');
}
function updateSeatPicker() {
  document.querySelectorAll('.seat-picker__btn').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.seat) === setupSeat));
}
document.getElementById('seat-picker').addEventListener('click', (e) => {
  const btn = e.target.closest('.seat-picker__btn');
  if (!btn) return;
  playClick();
  setupSeat = Number(btn.dataset.seat);
  updateSeatPicker();
});
document.getElementById('btn-setup-back').addEventListener('click', () => { playClick(); showScreen('screen-title'); });
document.getElementById('btn-setup-go').addEventListener('click', () => {
  playClick();
  settings.length = document.querySelector('input[name="length"]:checked').value;
  const startValue = document.querySelector('input[name="start"]:checked').value;
  settings.start = startValue === 'other' ? (parseInt(document.getElementById('start-other').value, 10) || 25000) : Number(startValue);
  settings.kiriage = document.querySelector('input[name="kiriage"]:checked').value === 'on';
  settings.names = Array.from(document.querySelectorAll('.name-input')).map((inp) => inp.value.trim().slice(0, 8));
  saveSettings();
  game = newGame({ start: settings.start, startDealer: setupSeat });
  saveGame();
  enterTable();
});

// ---- 卓 ----
const panelEls = {};
document.querySelectorAll('.panel').forEach((el) => { panelEls[Number(el.dataset.seat)] = el; });
let wakeLock = null;
async function requestWakeLock() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch { /* 使えない端末では何もしない */ }
}
function releaseWakeLock() { try { wakeLock?.release(); } catch { /* noop */ } wakeLock = null; }

function seatName(seat) { return settings.names[seat] || ROUND_NAMES[(seat - game.dealer + SEATS) % SEATS]; }

function enterTable() {
  if (!game) return;
  showScreen('screen-table');
  layoutTable();
  requestWakeLock();
}

// 上・左・右のパネルは正方形でない箱を rotate すると見た目の幅と高さが入れ替わり、
// 隣のパネルとぶつかる。実測サイズから、回したあとにちょうど収まる寸法を計算して置く。
const tableWrap = document.getElementById('table-wrap');
let panelSide = 100;
function layoutTable() {
  const W = tableWrap.clientWidth;
  const H = tableWrap.clientHeight;
  if (!W || !H) return;
  const side = Math.max(84, Math.min(W, H) * 0.26);
  panelSide = side;
  const gap = 6;

  // 上・下（180度回転は幅と高さが入れ替わらないので、そのまま置ける）
  set(panelEls[2], { left: gap, top: gap, width: W - gap * 2, height: side, rotate: 180 });
  set(panelEls[0], { left: gap, top: H - side - gap, width: W - gap * 2, height: side, rotate: 0 });

  // 左・右（90度回転で幅と高さが入れ替わる分だけ、回す前の箱を縦横逆に作って中心をそろえる）
  const midW = W - side * 2 - gap * 2;
  const midH = H - side * 2 - gap * 2;
  const leftCx = side / 2 + gap, cy = H / 2;
  const rightCx = W - side / 2 - gap;
  set(panelEls[3], { left: leftCx - midH / 2, top: cy - side / 2, width: midH, height: side, rotate: 90 });
  set(panelEls[1], { left: rightCx - midH / 2, top: cy - side / 2, width: midH, height: side, rotate: -90 });

  const mid = document.querySelector('.mid');
  mid.style.left = `${side + gap}px`;
  mid.style.top = `${side + gap}px`;
  mid.style.width = `${Math.max(midW, 0)}px`;
  mid.style.height = `${Math.max(midH, 0)}px`;
  renderTable();
}
function set(el, { left, top, width, height, rotate }) {
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  el.style.transform = `rotate(${rotate}deg)`;
}
window.addEventListener('resize', () => { if (!document.getElementById('screen-table').hidden) layoutTable(); });

function renderTable() {
  if (!game) return;
  for (let seat = 0; seat < SEATS; seat++) {
    const el = panelEls[seat];
    const isDealer = seat === game.dealer;
    const wind = ROUND_NAMES[(seat - game.dealer + SEATS) % SEATS];
    const name = settings.names[seat];
    el.classList.toggle('is-dealer', isDealer);
    el.innerHTML = '';
    const windEl = document.createElement('div');
    windEl.className = 'panel__wind' + (isDealer ? ' is-dealer-label' : '');
    windEl.textContent = isDealer ? `${wind}（親）` : wind;
    el.appendChild(windEl);
    if (name) {
      const nameEl = document.createElement('div');
      nameEl.className = 'panel__name';
      nameEl.textContent = name;
      el.appendChild(nameEl);
    }
    const scoreEl = document.createElement('div');
    scoreEl.className = 'panel__score';
    scoreEl.style.fontSize = `${Math.round(Math.max(20, Math.min(38, panelSide * 0.4)))}px`;
    scoreEl.textContent = String(game.scores[seat]);
    el.appendChild(scoreEl);
    const riichiBtn = document.createElement('button');
    riichiBtn.className = 'panel__riichi' + (game.riichi[seat] ? ' is-active' : '');
    riichiBtn.textContent = 'リーチ';
    riichiBtn.disabled = game.riichi[seat];
    riichiBtn.addEventListener('click', (e) => { e.stopPropagation(); onRiichi(seat); });
    el.appendChild(riichiBtn);
  }
  document.getElementById('round-info').textContent = `${roundLabel(game.round)} ${game.honba}本場`;
  document.getElementById('kyotaku-info').textContent = `供託 ${game.kyotaku}`;
}

function onRiichi(seat) {
  if (!game || game.riichi[seat]) return;
  doRiichi(game, seat);
  saveGame();
  playRiichi();
  renderTable();
}

document.querySelectorAll('.panel').forEach((el) => {
  el.addEventListener('click', () => showDiff(Number(el.dataset.seat)));
});
function showDiff(seat) {
  if (!game) return;
  const el = panelEls[seat];
  if (el.querySelector('.panel__diff')) return;
  const overlay = document.createElement('div');
  overlay.className = 'panel__diff';
  overlay.textContent = [0, 1, 2, 3].filter((s) => s !== seat)
    .map((s) => { const d = game.scores[seat] - game.scores[s]; return (d >= 0 ? '+' : '') + d; })
    .join(' / ');
  el.appendChild(overlay);
  setTimeout(() => overlay.remove(), 3000);
}
function showDelta(seat, delta) {
  const el = panelEls[seat];
  const d = document.createElement('div');
  d.className = 'panel__delta';
  d.textContent = (delta >= 0 ? '+' : '') + delta;
  el.appendChild(d);
  setTimeout(() => d.remove(), 2000);
}

document.getElementById('btn-undo').addEventListener('click', () => {
  if (!game || !game.undo.length) return;
  playUndoSound();
  game = undo(game);
  saveGame();
  renderTable();
});
document.getElementById('btn-menu').addEventListener('click', () => { playClick(); showSheet('sheet-menu'); });
document.getElementById('btn-menu-close').addEventListener('click', () => { playClick(); hideSheet('sheet-menu'); });

// ---- あがりの入力 ----
let win = { winner: null, tsumo: null, loser: null, han: null, fu: null };
const HAN_BUTTONS = [
  { label: '1', han: 1 }, { label: '2', han: 2 }, { label: '3', han: 3 }, { label: '4', han: 4 },
  { label: '満貫', han: 5 }, { label: '跳満', han: 6 }, { label: '倍満', han: 8 }, { label: '三倍満', han: 11 }, { label: '役満', han: 13 },
];
const FU_LIST = [20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110];

function openWinSheet() {
  win = { winner: null, tsumo: null, loser: null, han: null, fu: 30 };
  document.getElementById('win-who-grid').innerHTML = '';
  for (let seat = 0; seat < SEATS; seat++) {
    const b = document.createElement('button');
    b.className = 'who-btn';
    b.textContent = seatName(seat);
    b.addEventListener('click', () => { playClick(); win.winner = seat; win.loser = null; renderWinSteps(); });
    document.getElementById('win-who-grid').appendChild(b);
  }
  document.getElementById('win-step-type').hidden = true;
  document.getElementById('win-step-han').hidden = true;
  document.getElementById('win-step-fu').hidden = true;
  document.getElementById('win-result').hidden = true;
  document.getElementById('btn-win-confirm').disabled = true;
  showSheet('sheet-win');
}
function renderWinSteps() {
  Array.from(document.getElementById('win-who-grid').children).forEach((b, i) => b.classList.toggle('is-active', i === win.winner));
  document.getElementById('win-step-type').hidden = win.winner == null;
  if (win.winner == null) return;
  const typeStep = document.getElementById('win-step-type');
  Array.from(typeStep.querySelectorAll('.choice')).forEach((b) => {
    b.classList.toggle('is-active', (b.dataset.type === 'tsumo' && win.tsumo === true) || (b.dataset.type === 'ron' && win.tsumo === false));
  });
  const loserGrid = document.getElementById('win-loser-grid');
  if (win.tsumo === false) {
    loserGrid.hidden = false;
    loserGrid.innerHTML = '';
    for (let seat = 0; seat < SEATS; seat++) {
      if (seat === win.winner) continue;
      const b = document.createElement('button');
      b.className = 'who-btn' + (win.loser === seat ? ' is-active' : '');
      b.textContent = seatName(seat);
      b.addEventListener('click', () => { playClick(); win.loser = seat; renderWinSteps(); });
      loserGrid.appendChild(b);
    }
  } else {
    loserGrid.hidden = true;
  }
  const readyForHan = win.tsumo != null && (win.tsumo === true || win.loser != null);
  document.getElementById('win-step-han').hidden = !readyForHan;
  if (readyForHan && !document.getElementById('win-han-row').children.length) {
    const row = document.getElementById('win-han-row');
    HAN_BUTTONS.forEach(({ label, han }) => {
      const b = document.createElement('button');
      b.className = 'choice';
      b.textContent = label;
      b.addEventListener('click', () => { playClick(); win.han = han; renderWinSteps(); });
      row.appendChild(b);
    });
  }
  if (readyForHan) Array.from(document.getElementById('win-han-row').children).forEach((b, i) => b.classList.toggle('is-active', HAN_BUTTONS[i].han === win.han));

  const showFu = readyForHan && win.han != null && win.han <= 4;
  document.getElementById('win-step-fu').hidden = !showFu;
  if (showFu && !document.getElementById('win-fu-row').children.length) {
    const row = document.getElementById('win-fu-row');
    FU_LIST.forEach((fu) => {
      const b = document.createElement('button');
      b.className = 'choice';
      b.textContent = String(fu);
      b.addEventListener('click', () => { playClick(); win.fu = fu; renderWinSteps(); });
      row.appendChild(b);
    });
  }
  if (showFu) Array.from(document.getElementById('win-fu-row').children).forEach((b, i) => b.classList.toggle('is-active', FU_LIST[i] === win.fu));

  renderWinResult();
}
function renderWinResult() {
  const box = document.getElementById('win-result');
  const ready = win.winner != null && win.tsumo != null && (win.tsumo || win.loser != null) && win.han != null && (win.han > 4 || win.fu != null);
  document.getElementById('btn-win-confirm').disabled = !ready;
  if (!ready) { box.hidden = true; return; }
  const dealer = win.winner === game.dealer;
  const fu = win.han <= 4 ? win.fu : 30; // 満貫以上は符を使わない
  const r = scoreWin({ han: win.han, fu, dealer, tsumo: win.tsumo, kiriage: settings.kiriage, honba: game.honba });
  const hanFuText = win.han <= 4 ? `${fu}符${win.han}翻` : HAN_BUTTONS.find((h) => h.han === win.han).label;
  const dealerText = dealer ? '親' : '子';
  let main, sub;
  if (win.tsumo) {
    main = `${dealerText} ${hanFuText} ツモ ${dealer ? `${r.kidPay}オール` : `${r.kidPay}-${r.dealerPay}`}`;
    sub = `${seatName(win.winner)} が ${dealer ? `${r.kidPay}×3` : `${r.kidPay}×2 + ${r.dealerPay}`} 受け取り`;
  } else {
    main = `${dealerText} ${hanFuText} ロン ${r.pay}`;
    sub = `${seatName(win.loser)} → ${seatName(win.winner)} ${r.pay}（本場 ${game.honba * 300} 込み）`;
  }
  box.innerHTML = '';
  const mainEl = document.createElement('div'); mainEl.className = 'win-result__main'; mainEl.textContent = main; box.appendChild(mainEl);
  const subEl = document.createElement('div'); subEl.className = 'win-result__sub'; subEl.textContent = sub; box.appendChild(subEl);
  if (game.kyotaku > 0) {
    const kEl = document.createElement('div'); kEl.className = 'win-result__sub'; kEl.textContent = `供託 ${game.kyotaku * 1000} → ${seatName(win.winner)}`; box.appendChild(kEl);
  }
  if (win.han <= 4 && isUnusualFuHan(win.fu, win.han, win.tsumo)) {
    const note = document.createElement('div'); note.className = 'win-result__note'; note.textContent = 'この組み合わせは普通は出ません'; box.appendChild(note);
  }
  box.hidden = false;
}
document.getElementById('btn-win').addEventListener('click', () => { playClick(); openWinSheet(); });
document.getElementById('btn-win-cancel').addEventListener('click', () => { playClick(); hideSheet('sheet-win'); });
document.getElementById('win-step-type').querySelectorAll('.choice').forEach((b) => {
  b.addEventListener('click', () => { playClick(); win.tsumo = b.dataset.type === 'tsumo'; win.loser = null; renderWinSteps(); });
});
document.getElementById('btn-win-confirm').addEventListener('click', () => {
  const fu = win.han <= 4 ? win.fu : 30;
  const before = { scores: [...game.scores] };
  applyWin(game, { winner: win.winner, tsumo: win.tsumo, loser: win.loser, han: win.han, fu, kiriage: settings.kiriage, length: settings.length });
  saveGame();
  playWinSound(win.han);
  hideSheet('sheet-win');
  renderTable();
  for (let seat = 0; seat < SEATS; seat++) {
    const delta = game.scores[seat] - before.scores[seat];
    if (delta !== 0) showDelta(seat, delta);
  }
  if (game.ended) showResult();
});

// ---- 流局の入力 ----
let tenpai = [false, false, false, false];
function openRyuukyokuSheet() {
  tenpai = game.riichi.slice();
  renderRyuukyokuSheet();
  showSheet('sheet-ryuukyoku');
}
function renderRyuukyokuSheet() {
  const grid = document.getElementById('ryuukyoku-grid');
  grid.innerHTML = '';
  for (let seat = 0; seat < SEATS; seat++) {
    const b = document.createElement('button');
    b.className = 'tenpai-btn' + (tenpai[seat] ? ' is-tenpai' : '');
    b.textContent = `${seatName(seat)} ${tenpai[seat] ? '聴牌' : 'ノーテン'}`;
    b.addEventListener('click', () => { playClick(); tenpai[seat] = !tenpai[seat]; renderRyuukyokuSheet(); });
    grid.appendChild(b);
  }
  const payments = ryuukyokuPayments(tenpai);
  const box = document.getElementById('ryuukyoku-result');
  box.innerHTML = '';
  payments.forEach((p, seat) => {
    if (p === 0) return;
    const row = document.createElement('div');
    row.className = 'win-result__sub';
    row.textContent = `${seatName(seat)} ${p >= 0 ? '+' : ''}${p}`;
    box.appendChild(row);
  });
}
document.getElementById('btn-ryuukyoku').addEventListener('click', () => { playClick(); openRyuukyokuSheet(); });
document.getElementById('btn-ryuukyoku-cancel').addEventListener('click', () => { playClick(); hideSheet('sheet-ryuukyoku'); });
document.getElementById('btn-ryuukyoku-confirm').addEventListener('click', () => {
  const before = { scores: [...game.scores] };
  applyRyuukyoku(game, tenpai, settings.length);
  saveGame();
  playRyuukyokuSound();
  hideSheet('sheet-ryuukyoku');
  renderTable();
  for (let seat = 0; seat < SEATS; seat++) {
    const delta = game.scores[seat] - before.scores[seat];
    if (delta !== 0) showDelta(seat, delta);
  }
  if (game.ended) showResult();
});
document.getElementById('btn-chuuto').addEventListener('click', () => {
  applyChuutoRyuukyoku(game);
  saveGame();
  playRyuukyokuSound();
  hideSheet('sheet-ryuukyoku');
  renderTable();
});

// ---- メニュー ----
document.getElementById('btn-menu-howto').addEventListener('click', () => { playClick(); hideSheet('sheet-menu'); howtoReturn = 'screen-table'; showScreen('screen-howto'); });
document.getElementById('btn-menu-title').addEventListener('click', () => { playClick(); hideSheet('sheet-menu'); releaseWakeLock(); showScreen('screen-title'); document.getElementById('btn-continue-game').hidden = !(game && !game.ended); });
document.getElementById('btn-menu-end').addEventListener('click', () => {
  playClick();
  hideSheet('sheet-menu');
  game.ended = true;
  saveGame();
  showResult();
});

// ---- 点を直す ----
document.getElementById('btn-menu-correct').addEventListener('click', () => { playClick(); hideSheet('sheet-menu'); openCorrectSheet(); });
function openCorrectSheet() {
  const grid = document.getElementById('correct-grid');
  grid.innerHTML = '';
  for (let seat = 0; seat < SEATS; seat++) {
    const label = document.createElement('label');
    const span = document.createElement('span'); span.textContent = seatName(seat);
    const input = document.createElement('input');
    input.type = 'number'; input.inputMode = 'numeric'; input.dataset.seat = String(seat); input.value = String(game.scores[seat]);
    label.appendChild(span); label.appendChild(input);
    grid.appendChild(label);
  }
  document.getElementById('correct-honba').value = String(game.honba);
  document.getElementById('correct-kyotaku').value = String(game.kyotaku);
  document.getElementById('correct-dealer').value = String(game.dealer);
  showSheet('sheet-correct');
}
document.getElementById('btn-correct-cancel').addEventListener('click', () => { playClick(); hideSheet('sheet-correct'); });
document.getElementById('btn-correct-apply').addEventListener('click', () => {
  playClick();
  const scores = Array.from(document.querySelectorAll('#correct-grid input')).map((i) => parseInt(i.value, 10) || 0);
  applyCorrect(game, {
    scores,
    honba: parseInt(document.getElementById('correct-honba').value, 10) || 0,
    kyotaku: parseInt(document.getElementById('correct-kyotaku').value, 10) || 0,
    dealer: parseInt(document.getElementById('correct-dealer').value, 10) || 0,
  });
  saveGame();
  hideSheet('sheet-correct');
  renderTable();
});

// ---- 設定 ----
document.getElementById('btn-menu-settings').addEventListener('click', () => {
  playClick();
  hideSheet('sheet-menu');
  document.getElementById('settings-sound').checked = settings.sound;
  document.querySelector(`input[name="settings-kiriage"][value="${settings.kiriage ? 'on' : 'off'}"]`).checked = true;
  showSheet('sheet-settings');
});
document.getElementById('settings-sound').addEventListener('change', (e) => {
  settings.sound = e.target.checked;
  setAudioSession(settings.sound);
  soundToggle.checked = settings.sound;
  saveSettings();
});
document.querySelectorAll('input[name="settings-kiriage"]').forEach((r) => r.addEventListener('change', () => {
  settings.kiriage = document.querySelector('input[name="settings-kiriage"]:checked').value === 'on';
  saveSettings();
}));
document.getElementById('btn-settings-close').addEventListener('click', () => { playClick(); hideSheet('sheet-settings'); });

// ---- 結果 ----
function showResult() {
  releaseWakeLock();
  const order = ranking(game);
  document.getElementById('result-hands').textContent = `${game.hands}局`;
  const list = document.getElementById('result-list');
  list.innerHTML = '';
  order.forEach((o, i) => {
    const row = document.createElement('div');
    row.className = 'result-row';
    const rank = document.createElement('div'); rank.className = 'result-row__rank'; rank.textContent = String(i + 1);
    const name = document.createElement('div'); name.className = 'result-row__name'; name.textContent = settings.names[o.seat] || ROUND_NAMES[o.distFromStart];
    const score = document.createElement('div'); score.className = 'result-row__score'; score.textContent = String(o.score);
    row.appendChild(rank); row.appendChild(name); row.appendChild(score);
    list.appendChild(row);
  });
  playResultSound();
  showScreen('screen-result');
}
document.getElementById('btn-result-continue').addEventListener('click', () => {
  playClick();
  game = continueGame(game);
  saveGame();
  enterTable();
});
document.getElementById('btn-result-new').addEventListener('click', () => {
  playClick();
  clearGame();
  showScreen('screen-title');
  document.getElementById('btn-continue-game').hidden = true;
});
document.getElementById('btn-result-share').addEventListener('click', () => {
  const order = ranking(game);
  const lines = order.map((o, i) => `${i + 1}位 ${settings.names[o.seat] || ROUND_NAMES[o.distFromStart]} ${o.score}`);
  WebAppKit.share({ text: `麻雀の結果（${settings.length === 'hanchan' ? '半荘' : '東風戦'}）\n${lines.join('\n')}`, url: 'https://t-of.github.io/riichi-board/' });
});

// ---- 点数表 ----
let tableKiriage = false;
function openScoreTable() {
  document.getElementById('table-kiriage').checked = tableKiriage;
  renderScoreTable(false);
  showScreen('screen-score-table');
}
function renderScoreTable(dealer) {
  const table = document.getElementById('score-table');
  let html = '<tr><th>符＼翻</th><th>1</th><th>2</th><th>3</th><th>4</th></tr>';
  FU_LIST.forEach((fu) => {
    html += `<tr><th>${fu}</th>`;
    for (let han = 1; han <= 4; han++) {
      const unusualRon = isUnusualFuHan(fu, han, false);
      const unusualTsumo = isUnusualFuHan(fu, han, true);
      const r = scoreWin({ han, fu, dealer, tsumo: false, kiriage: tableKiriage, honba: 0 });
      const t = scoreWin({ han, fu, dealer, tsumo: true, kiriage: tableKiriage, honba: 0 });
      const ronText = unusualRon ? '—' : String(r.pay);
      const tsumoText = unusualTsumo ? '—' : (dealer ? `${t.kidPay}オール` : `${t.kidPay}-${t.dealerPay}`);
      html += `<td><div class="cell-ron">${ronText}</div><div class="cell-tsumo">${tsumoText}</div></td>`;
    }
    html += '</tr>';
  });
  table.innerHTML = html;

  const names = ['満貫', '跳満', '倍満', '三倍満', '役満'];
  const hans = [5, 6, 8, 11, 13];
  let big = '<tr><th></th><th>子ロン</th><th>子ツモ</th><th>親ロン</th><th>親ツモ</th></tr>';
  hans.forEach((han, i) => {
    const ronKid = scoreWin({ han, fu: 30, dealer: false, tsumo: false, kiriage: tableKiriage, honba: 0 }).pay;
    const tsumoKid = scoreWin({ han, fu: 30, dealer: false, tsumo: true, kiriage: tableKiriage, honba: 0 });
    const ronDealer = scoreWin({ han, fu: 30, dealer: true, tsumo: false, kiriage: tableKiriage, honba: 0 }).pay;
    const tsumoDealer = scoreWin({ han, fu: 30, dealer: true, tsumo: true, kiriage: tableKiriage, honba: 0 });
    big += `<tr><th>${names[i]}</th><td>${ronKid}</td><td>${tsumoKid.kidPay}-${tsumoKid.dealerPay}</td><td>${ronDealer}</td><td>${tsumoDealer.kidPay}オール</td></tr>`;
  });
  document.getElementById('score-table-big').innerHTML = big;
}
document.getElementById('btn-table-dealer-off').addEventListener('click', () => {
  playClick();
  document.getElementById('btn-table-dealer-off').classList.add('is-active');
  document.getElementById('btn-table-dealer-on').classList.remove('is-active');
  renderScoreTable(false);
});
document.getElementById('btn-table-dealer-on').addEventListener('click', () => {
  playClick();
  document.getElementById('btn-table-dealer-on').classList.add('is-active');
  document.getElementById('btn-table-dealer-off').classList.remove('is-active');
  renderScoreTable(true);
});
document.getElementById('table-kiriage').addEventListener('change', (e) => {
  tableKiriage = e.target.checked;
  const dealer = document.getElementById('btn-table-dealer-on').classList.contains('is-active');
  renderScoreTable(dealer);
});
document.getElementById('btn-score-table-back').addEventListener('click', () => { playClick(); showScreen(howtoReturn); });

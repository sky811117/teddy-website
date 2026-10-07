// 介面層煙霧測試：用假 DOM 跑 mountWaitGame（掛載、開始、放下、完美、結束、重玩、暫停、跳過、主題、縮放、銷毀）
// 這不能取代「用真瀏覽器看畫面」，但能抓到執行期錯誤、事件流程、狀態機、洩漏（監聽器／rAF）等問題。
import test from 'node:test';
import assert from 'node:assert/strict';
import { requireClassic, loadClassic } from '../_helpers.mjs';
import { installFakeDom, mountParts } from './fake_dom.mjs';

const { mountWaitGame, core } = requireClassic('public/js/wait-game.js');
const FRAME = 1000 / 60;

function setup(opts = {}, gameOpts = {}) {
  const { env, uninstall } = installFakeDom(opts);
  const container = env.doc.createElement('div');
  env.doc.body.appendChild(container);
  const events = [];
  let skipped = 0;
  const game = mountWaitGame(container, Object.assign({ seed: 5, onEvent: (e) => events.push(e), onSkip: () => { skipped++; } }, gameOpts));
  const p = mountParts(env, container);
  return { env, uninstall, container, game, events, p, skips: () => skipped };
}
const ptr = (p, type, extra = {}) => p.field.dispatch(type, Object.assign({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 }, extra));
const tap = (p, extra = {}) => { ptr(p, 'pointerdown', extra); ptr(p, 'pointerup', extra); };
const down = (p, extra = {}) => ptr(p, 'pointerdown', extra);
const key = (cv, k, extra = {}) => cv.dispatch('keydown', Object.assign({ key: k, code: k === ' ' ? 'Space' : (k.length === 1 ? 'Key' + k.toUpperCase() : k) }, extra));
const types = (ev) => ev.map((e) => e.type);
const visible = (e) => !!e && !e.hidden;
// 機器人：每一幀看吊鉤位置，符合條件就按下去（只送 pointerdown，跟真手指一樣）
function bot(env, p, game, shouldDrop, maxFrames = 60 * 300, until = () => false) {
  let n = 0;
  while (game.getState().status === 'playing' && n++ < maxFrames && !until(game.getState())) {
    const g = game.getState();
    if (!g.paused && g.phase === 'swing' && shouldDrop(g)) down(p);
    env.pump(FRAME);
  }
  return n;
}
const aimed = (g) => Math.abs(g.hookX - g.targetX) < 2.5;     // 對準
const sloppy = (g) => Math.abs(g.hookX - g.targetX) > 70;     // 故意放偏
function playToOver(env, p, game) {
  bot(env, p, game, sloppy, 60 * 120);
  assert.equal(game.getState().status, 'over');
}

/* ---------- 掛載與開始畫面 ---------- */
test('掛載：結構、aria、固定高度、樣式只注入一次、開始畫面是真按鈕＋一句說明', () => {
  const { env, uninstall, p, game, container } = setup();
  try {
    assert.ok(p.root && p.canvas && p.field && p.skip && p.title && p.panel && p.btn && p.live);
    assert.equal(p.root.style.height, '280px');
    assert.equal(p.canvas.tabIndex, 0);
    assert.equal(p.canvas.getAttribute('role'), 'img');
    assert.match(p.canvas.getAttribute('aria-label'), /蓋大樓小遊戲.*點一下畫面或按空白鍵放下.*疊得越準蓋得越高/);
    assert.equal(p.title.textContent, '蓋大樓');
    assert.equal(p.skip.textContent, '跳過遊戲');
    assert.equal(p.skip.type, 'button');
    // 開始畫面
    assert.ok(visible(p.panel));
    assert.equal(p.ph.textContent, '蓋大樓');
    assert.equal(p.pb.textContent, '點一下放下樓層，疊得越準蓋得越高');
    assert.equal(p.btn.tagName, 'BUTTON');
    assert.equal(p.btn.type, 'button');
    assert.equal(p.btn.textContent, '開始蓋');
    assert.equal(p.btn.getAttribute('aria-label'), '開始蓋大樓', '讀屏名稱包含按鈕上的字「開始蓋」');
    assert.equal(p.pk.textContent, '也可以按空白鍵或 Enter');
    assert.equal(p.pm.hidden, true, '還沒有紀錄就不顯示最高紀錄');
    assert.equal(p.live.getAttribute('aria-live'), 'polite');
    assert.equal(p.live.textContent, '', '開始前不朗讀');
    // 樣式
    assert.equal(env.doc.documentElement.find((e) => e.id === 'wg-style').length, 1);
    const g2 = mountWaitGame(container, {});
    assert.equal(env.doc.documentElement.find((e) => e.id === 'wg-style').length, 1, '樣式只注入一次');
    g2.destroy();
    assert.equal(env.doc.documentElement.find((e) => e.id === 'wg-style').length, 1, '還有一個實例在，樣式不能被移掉');
    // 畫面：有畫天空漸層、有畫地基與吊著的那層，開始前不跑 rAF（省電）、不擋捲動
    assert.ok(p.ctx.gradients >= 1);
    assert.ok(p.ctx.calls.filter((c) => c[0] === 'fillRect').length > 20);
    assert.equal(env.pending(), 0);
    assert.equal(p.canvas.style.touchAction, 'manipulation', '開始前可以捲動頁面，但不會雙擊縮放');
    assert.equal(game.getState().status, 'ready');
    assert.equal(p.canvas.width, 340 * 2);
    assert.equal(p.canvas.height, 236 * 2);
  } finally { uninstall(); }
  const t = setup({ media: { '(pointer: coarse)': true } });
  try { assert.equal(t.p.pk.hidden, true, '觸控裝置不顯示鍵盤提示'); } finally { t.uninstall(); }
  const sm = setup({ fieldH: 160 });
  try { assert.equal(sm.p.pk.hidden, true, '很矮的時候先拿掉鍵盤提示'); assert.equal(sm.p.pb.hidden, true, '再矮就只留標題與按鈕'); assert.ok(visible(sm.p.btn)); } finally { sm.uninstall(); }
});

test('高度夾限 200～360、預設 280；skipButton:false 不出現上方列；labels 覆寫', () => {
  for (const [h, want] of [[undefined, '280px'], [50, '200px'], [999, '360px'], [300.4, '300px'], ['abc', '280px']]) {
    const { uninstall, p } = setup({}, { height: h });
    try { assert.equal(p.root.style.height, want, `height=${h}`); } finally { uninstall(); }
  }
  const a = setup({}, { skipButton: false });
  try { assert.ok(!a.p.skip); assert.ok(!a.p.title); } finally { a.uninstall(); }
  const b = setup({}, { labels: { start: '開始玩', skip: '先不玩', title: 5, bogus: 'x' } });
  try {
    assert.equal(b.p.skip.textContent, '先不玩');
    assert.equal(b.p.btn.textContent, '開始玩');
    assert.equal(b.p.ph.textContent, '蓋大樓', '非字串的 label 被忽略');
  } finally { b.uninstall(); }
});

/* ---------- 開始 ---------- */
test('按「開始蓋」→ 遊戲中：事件、面板收起、鎖定觸控、焦點到畫布、rAF 開跑、角落顯示「第 1 層」', () => {
  const { env, uninstall, p, events, game } = setup();
  try {
    p.btn.dispatch('click');
    assert.deepEqual(types(events), ['start']);
    assert.deepEqual(Object.keys(events[0]).sort(), ['durationMs', 'plays', 'points', 'score', 'type']);
    assert.equal(events[0].plays, 1);
    assert.equal(events[0].score, 0);
    assert.equal(events[0].durationMs, 0);
    assert.equal(p.panel.hidden, true);
    assert.equal(p.canvas.style.touchAction, 'none', '遊戲中才擋捲動與雙擊縮放');
    assert.equal(env.doc.activeElement, p.canvas, '按鈕消失後焦點留在畫布，鍵盤可以直接玩');
    assert.equal(env.pending(), 1);
    p.ctx.texts.length = 0;
    env.pump(100);
    assert.ok(p.ctx.texts.includes('第 1 層'));
    assert.ok(p.ctx.texts.includes('分數 0'));
    assert.equal(game.getState().status, 'playing');
    assert.equal(p.live.textContent, '第 1 層');
  } finally { uninstall(); }
});

test('點一下畫面也能開始：要放開才算；拖動超過 14px、pointercancel、按在按鈕上（交給 click）都不算', () => {
  const { uninstall, p, game, events } = setup();
  try {
    down(p, { pointerId: 3, pointerType: 'touch' });
    assert.equal(game.getState().status, 'ready', '按下去還不算');
    ptr(p, 'pointerup', { pointerId: 3, pointerType: 'touch', clientY: 160 });
    assert.equal(game.getState().status, 'ready', '往下滑 60px 是捲動，不是點擊');
    down(p, { pointerId: 4, pointerType: 'touch' });
    ptr(p, 'pointercancel', { pointerId: 4, pointerType: 'touch' });
    ptr(p, 'pointerup', { pointerId: 4, pointerType: 'touch' });
    assert.equal(game.getState().status, 'ready', 'cancel 後的 up 不算');
    tap(p, { pointerId: 5, target: p.btn });
    assert.equal(game.getState().status, 'ready', '按在按鈕上的 pointerup 不算，免得跟 click 重複');
    p.btn.dispatch('click');
    assert.equal(game.getState().status, 'playing');
    assert.equal(events.filter((e) => e.type === 'start').length, 1, '只開始一次');
  } finally { uninstall(); }
  const t = setup();
  try {
    down(t.p, { pointerId: 6 }); ptr(t.p, 'pointerup', { pointerId: 6, clientX: 103, clientY: 102 });
    assert.equal(t.game.getState().status, 'playing', '輕微抖動的點擊算數');
    assert.equal(t.game.getState().floors, 0, '開始的那一下不會順便放下樓層');
    t.env.pump(200);
    assert.equal(t.game.getState().phase, 'swing');
  } finally { t.uninstall(); }
});

test('鍵盤：Enter／空白鍵開始並攔下預設捲動；其他鍵不理', () => {
  for (const k of ['Enter', ' ']) {
    const { uninstall, p, game } = setup();
    try {
      const x = key(p.canvas, 'x');
      assert.equal(game.getState().status, 'ready');
      assert.equal(x.defaultPrevented, false);
      const e = key(p.canvas, k);
      assert.equal(game.getState().status, 'playing', `${JSON.stringify(k)} 開始`);
      assert.equal(e.defaultPrevented, true);
    } finally { uninstall(); }
  }
});

/* ---------- 放下 ---------- */
test('放下：按下去（pointerdown）就放、右鍵不算；掉落中再點不排隊；落地後朗讀「蓋好第 1 層」、角落變「第 2 層」', () => {
  const { env, uninstall, p, game } = setup();
  try {
    p.btn.dispatch('click');
    env.pump(300);
    down(p, { button: 2 });
    env.pump(FRAME);
    assert.equal(game.getState().phase, 'swing', '右鍵不放');
    down(p);
    env.pump(FRAME);
    assert.equal(game.getState().phase, 'fall', '按下去就放，不用等放開');
    down(p); down(p);
    let guard = 0;
    while (game.getState().phase === 'fall' && guard++ < 120) env.pump(FRAME);
    assert.equal(game.getState().floors, 1);
    env.pump(1000);
    assert.equal(game.getState().floors, 1, '掉落中按的不會排隊自動放');
    assert.equal(game.getState().phase, 'swing');
    assert.match(p.live.textContent, /^(蓋好第 1 層|完美.*蓋好第 1 層)$/);
    p.ctx.texts.length = 0;
    env.pump(50);
    assert.ok(p.ctx.texts.includes('第 2 層'));
  } finally { uninstall(); }
});

test('鍵盤放下：空白鍵／Enter 放下並攔預設；長按（repeat）不連放；Tab 不攔、可以離開', () => {
  const { env, uninstall, p, game } = setup();
  try {
    key(p.canvas, 'Enter');
    env.pump(300);
    const sp = key(p.canvas, ' ');
    assert.equal(sp.defaultPrevented, true);
    env.pump(FRAME);
    assert.equal(game.getState().phase, 'fall');
    env.pump(1200);
    assert.equal(game.getState().floors, 1);
    key(p.canvas, ' ', { repeat: true }); key(p.canvas, 'Enter', { repeat: true });
    env.pump(FRAME);
    assert.equal(game.getState().phase, 'swing', '長按產生的重複按鍵不算');
    key(p.canvas, 'Enter');
    env.pump(FRAME);
    assert.equal(game.getState().phase, 'fall', 'Enter 也能放');
    const tab = key(p.canvas, 'Tab');
    assert.equal(tab.defaultPrevented, false);
    const other = key(p.canvas, 'ArrowLeft');
    assert.equal(other.defaultPrevented, false, '用不到的鍵不攔');
  } finally { uninstall(); }
});

test('完美回饋：對準就出現「完美！」，連續就「完美！×2」，也會朗讀；分數加得比較多', () => {
  const { env, uninstall, p, game } = setup();
  try {
    p.btn.dispatch('click');
    p.ctx.texts.length = 0;
    bot(env, p, game, aimed, 60 * 60, (g) => g.floors >= 3 && g.phase === 'swing');
    const g = game.getState();
    assert.equal(g.floors, 3);
    assert.ok(g.perfects >= 2, `完美 ${g.perfects} 次`);
    assert.ok(p.ctx.texts.includes('完美！'));
    assert.ok(p.ctx.texts.some((t) => /^完美！×[23]$/.test(t)), p.ctx.texts.filter((t) => t.startsWith('完美')).join('|'));
    assert.ok(g.points > 30, `分數 ${g.points}`);
    assert.match(p.live.textContent, /^完美，連續 [23] 次，蓋好第 3 層$/);
  } finally { uninstall(); }
});

test('朗讀（aria-live）只在層數變動時更新，不會每一幀都改', () => {
  const { env, uninstall, p, game } = setup();
  try {
    p.btn.dispatch('click');
    let prev = p.live.textContent, changes = 0, frames = 0;
    while (game.getState().floors < 5 && frames++ < 60 * 60) {
      const g = game.getState();
      if (g.phase === 'swing' && aimed(g)) down(p);
      env.pump(FRAME);
      if (p.live.textContent !== prev) { changes++; prev = p.live.textContent; }
    }
    assert.equal(game.getState().floors, 5);
    assert.ok(frames > 100, `跑了 ${frames} 幀`);
    assert.ok(changes <= 5, `5 層只該更新 5 次左右，實際 ${changes} 次`);
    assert.ok(changes >= 4, '每蓋好一層都有朗讀（連續完美時文字會不同）');
  } finally { uninstall(); }
});

test('觸控：手指按下就放（pointerType touch）、遊戲中 touch-action:none 不捲動不縮放、快速連點兩下只放一層', () => {
  const { env, uninstall, p, game } = setup({ media: { '(pointer: coarse)': true } });
  try {
    tap(p, { pointerType: 'touch', pointerId: 11 });
    assert.equal(game.getState().status, 'playing');
    assert.equal(p.canvas.style.touchAction, 'none');
    env.pump(300);
    down(p, { pointerType: 'touch', pointerId: 12 });
    down(p, { pointerType: 'touch', pointerId: 13 });     // 雙擊的第二下
    env.pump(FRAME);
    assert.equal(game.getState().phase, 'fall');
    env.pump(1500);
    assert.equal(game.getState().floors, 1, '第二下落在掉落中，不會變成第二層');
    assert.equal(p.field.dispatch('contextmenu').defaultPrevented, true, '長按不跳選單');
  } finally { uninstall(); }
});

/* ---------- 結束與重玩 ---------- */
test('結束：疊不上去就結束；over 事件一次；先演掉落、約 0.8 秒後才出結果面板；「再蓋一棟」是真按鈕；迴圈會停', () => {
  const { env, uninstall, p, events, game } = setup();
  try {
    p.btn.dispatch('click');
    bot(env, p, game, sloppy, 60 * 120);
    const st = game.getState();
    assert.equal(st.status, 'over', '結束狀態立刻生效（頁面要切結果時看得到）');
    const over = events.filter((e) => e.type === 'over');
    assert.equal(over.length, 1);
    assert.equal(over[0].score, st.floors);
    assert.ok(Number.isInteger(over[0].durationMs) && over[0].durationMs > 0);
    assert.equal(p.panel.hidden, true, '結果面板還沒出來，先讓掉下去的那層演完');
    assert.equal(p.canvas.style.touchAction, 'manipulation');
    assert.match(p.live.textContent, /^這局結束，你蓋了 \d+ 層樓。/);
    env.pump(900);
    assert.ok(visible(p.panel));
    assert.ok(p.panel.className.split(' ').includes('wg-card'), '結束面板是靠左的小卡片（整棟樓露在右邊）');
    assert.equal(p.ph.textContent, st.floors > 0 ? `你蓋了 ${st.floors} 層樓！` : '這次沒疊上去');
    if (st.floors > 0) assert.equal(p.pb.textContent, `第 ${st.floors + 1} 層沒疊上，分數 ${st.points}`, '跟角落的「第 N 層」口徑一致');
    assert.ok(!/完美 0 次/.test(p.pb.textContent));
    assert.equal(p.pk.hidden, true, '結束卡片不放鍵盤提示，保持小');
    assert.equal(p.btn.textContent, '再蓋一棟');
    assert.equal(p.btn.getAttribute('aria-label'), '再蓋一棟，重新開始');
    env.pump(2000);
    assert.equal(env.pending(), 0, '結束後迴圈會停');
  } finally { uninstall(); }
});

test('重玩：結果面板出現 0.35 秒內點擊／按鍵不會重玩（避免連點吃掉結果）；之後點畫面、按鈕、Enter 都可以', () => {
  for (const how of ['tap', 'button', 'enter']) {
    const { env, uninstall, p, events, game } = setup();
    try {
      p.btn.dispatch('click');
      playToOver(env, p, game);
      tap(p); key(p.canvas, 'Enter'); p.btn.dispatch('click');
      assert.equal(game.getState().status, 'over', '面板還沒出來時不重玩');
      let guard = 0;
      while (p.panel.hidden && guard++ < 200) env.pump(FRAME);
      tap(p); key(p.canvas, 'Enter'); p.btn.dispatch('click');
      assert.equal(game.getState().status, 'over', '面板剛出來時不重玩');
      env.tick(400);
      key(p.canvas, 'Enter', { repeat: true });
      assert.equal(game.getState().status, 'over', '長按不算');
      if (how === 'tap') tap(p); else if (how === 'button') p.btn.dispatch('click'); else key(p.canvas, 'Enter');
      const g = game.getState();
      assert.equal(g.status, 'playing', how);
      assert.equal(g.plays, 2);
      assert.equal(g.floors, 0, '新局從頭蓋');
      assert.equal(g.points, 0);
      assert.equal(events.filter((e) => e.type === 'start').length, 2);
      assert.equal(p.panel.hidden, true);
    } finally { uninstall(); }
  }
});

test('最高紀錄：存層數到 localStorage（鍵可設）、新紀錄顯示「新紀錄！」、下次開始畫面顯示「最高紀錄 N 層」', () => {
  const { env, uninstall, p, game } = setup({}, { storageKey: 'my.tower' });
  try {
    p.btn.dispatch('click');
    bot(env, p, game, aimed, 60 * 60, (g) => g.floors >= 4 && g.phase === 'swing');
    bot(env, p, game, sloppy, 60 * 120);
    const st = game.getState();
    assert.equal(st.status, 'over');
    assert.ok(st.floors >= 4);
    assert.equal(st.best, st.floors);
    assert.deepEqual(env.storageLog.at(-1), ['my.tower', String(st.floors)]);
    env.pump(1000);
    assert.equal(p.pm.textContent, `最高紀錄 ${st.floors} 層`, '第一局（原本沒紀錄）不說「新紀錄！」');
    assert.doesNotMatch(p.live.textContent, /新紀錄/);
    // 第二局超過才是「新紀錄！」
    env.tick(400); p.btn.dispatch('click');
    bot(env, p, game, aimed, 60 * 90, (g) => g.floors >= st.floors + 2 && g.phase === 'swing');
    bot(env, p, game, sloppy, 60 * 120);
    const st2 = game.getState();
    assert.ok(st2.floors > st.floors, `第二局 ${st2.floors} 層`);
    env.pump(1000);
    assert.equal(p.pm.textContent, '新紀錄！');
    assert.match(p.live.textContent, /新紀錄！$/);
    assert.deepEqual(env.storageLog.at(-1), ['my.tower', String(st2.floors)]);
    const c2 = env.doc.createElement('div'); env.doc.body.appendChild(c2);
    const g2 = mountWaitGame(c2, { storageKey: 'my.tower' });
    assert.equal(g2.getState().best, st2.floors);
    assert.equal(mountParts(env, c2).pm.textContent, `最高紀錄 ${st2.floors} 層`);
    g2.destroy();
  } finally { uninstall(); }
  // 存的值壞掉（不是數字、負數、大得離譜）就當沒有
  for (const bad of ['abc', '-5', '99999999', '']) {
    const { env, uninstall } = installFakeDom();
    try {
      env.storageData.set('wg.tower.best', bad);
      const c = env.doc.createElement('div'); env.doc.body.appendChild(c);
      const g = mountWaitGame(c, {});
      assert.equal(g.getState().best, 0, `壞值 ${JSON.stringify(bad)}`);
      g.destroy();
    } finally { uninstall(); }
  }
});

test('localStorage 拋例外／不存在時，遊戲照常運作（記憶體內仍會更新最高紀錄）', () => {
  for (const storage of ['throw', 'none']) {
    const { env, uninstall, p, game } = setup({ storage });
    try {
      assert.equal(game.getState().best, 0);
      p.btn.dispatch('click');
      bot(env, p, game, aimed, 60 * 60, (g) => g.floors >= 2 && g.phase === 'swing');
      bot(env, p, game, sloppy, 60 * 120);
      assert.equal(game.getState().status, 'over', storage);
      assert.ok(game.getState().best >= 2);
    } finally { uninstall(); }
  }
});

/* ---------- 暫停 ---------- */
test('分頁切到背景 → 自動暫停（停 rAF、面板「先停一下」＋「繼續蓋」）；回來不自動繼續；點一下或按鈕才繼續', () => {
  const { env, uninstall, p, events, game } = setup();
  try {
    p.btn.dispatch('click'); env.pump(500);
    env.doc.hidden = true;
    env.doc.dispatch('visibilitychange');
    assert.equal(game.getState().paused, true);
    assert.equal(game.getState().status, 'playing', '暫停中仍算遊戲中（頁面據此決定結果好了要不要先跳橫幅）');
    assert.equal(env.pending(), 0, '暫停時沒有排程中的 rAF');
    assert.ok(visible(p.panel));
    assert.equal(p.ph.textContent, '先停一下');
    assert.equal(p.btn.textContent, '繼續蓋');
    assert.equal(p.btn.getAttribute('aria-label'), '繼續蓋大樓', '讀屏名稱包含按鈕上的字「繼續蓋」');
    assert.equal(p.canvas.style.touchAction, 'manipulation');
    assert.ok(types(events).includes('pause'));
    const frozen = JSON.stringify(game.getState());
    env.pump(2000);
    assert.equal(JSON.stringify(game.getState()), frozen, '暫停期間遊戲不動');
    env.doc.hidden = false;
    env.doc.dispatch('visibilitychange');
    assert.equal(game.getState().paused, true, '回到分頁不會自動繼續');
    down(p); env.pump(FRAME);
    assert.equal(game.getState().phase, 'swing', '暫停中按下去不會放下樓層');
    ptr(p, 'pointerup');
    assert.equal(game.getState().paused, false, '點一下繼續');
    assert.deepEqual(types(events).slice(-1), ['resume']);
    assert.equal(env.pending(), 1);
    assert.equal(p.panel.hidden, true);
    game.pause();
    p.btn.dispatch('click');
    assert.equal(game.getState().paused, false, '按鈕也能繼續');
    assert.equal(env.doc.activeElement, p.canvas);
  } finally { uninstall(); }
});

test('容器離開視窗（IntersectionObserver）→ 暫停；P／Esc 鍵暫停與繼續、長按不來回切換', () => {
  const { env, uninstall, p, game } = setup();
  try {
    p.btn.dispatch('click'); env.pump(300);
    env.ios[0].cb([{ isIntersecting: true }]);
    assert.equal(game.getState().paused, false);
    env.ios[0].cb([{ isIntersecting: false }]);
    assert.equal(game.getState().paused, true);
    key(p.canvas, 'Enter');
    assert.equal(game.getState().paused, false, 'Enter 可繼續');
    env.pump(FRAME);
    assert.equal(game.getState().phase, 'swing', '繼續用的 Enter 不會順便放下');
    key(p.canvas, 'p');
    assert.equal(game.getState().paused, true);
    key(p.canvas, 'p', { repeat: true });
    assert.equal(game.getState().paused, true, '長按不會來回切換');
    key(p.canvas, 'Escape');
    assert.equal(game.getState().paused, false);
    key(p.canvas, 'Escape');
    assert.equal(game.getState().paused, true);
    key(p.canvas, ' ');
    assert.equal(game.getState().paused, false, '空白鍵也能繼續');
  } finally { uninstall(); }
});

test('公開 pause()／resume()：只在遊戲中有效；重複呼叫不重複發事件；結束後無效', () => {
  const { env, uninstall, p, events, game } = setup();
  try {
    game.pause(); game.resume();
    assert.equal(events.length, 0, '還沒開始：不發事件');
    p.btn.dispatch('click'); env.pump(200);
    game.pause(); game.pause();
    assert.equal(types(events).filter((t) => t === 'pause').length, 1);
    game.resume(); game.resume();
    assert.equal(types(events).filter((t) => t === 'resume').length, 1);
    assert.equal(env.pending(), 1);
    playToOver(env, p, game);
    const n = events.length;
    game.pause(); game.resume();
    assert.equal(events.length, n, '結束後 pause／resume 無效');
  } finally { uninstall(); }
});

test('開始後放著不玩 30 秒：這局直接結束（status over、over 只發一次、出結束卡片、rAF 停），頁面結果好了就能直接切頁', () => {
  const { env, uninstall, p, game, events } = setup();
  try {
    p.btn.dispatch('click');
    bot(env, p, game, aimed, 60 * 30, (g) => g.floors >= 2 && g.phase === 'swing');
    env.pump(29000);
    assert.equal(game.getState().status, 'playing', '29 秒還在玩');
    env.pump(2000);
    const st = game.getState();
    assert.equal(st.status, 'over', '30 秒沒放就結束這局（不是暫停）');
    assert.equal(st.paused, false);
    assert.equal(events.filter((e) => e.type === 'over').length, 1);
    assert.equal(events.filter((e) => e.type === 'pause').length, 0, '不是走暫停');
    assert.equal(events.at(-1).score, st.floors);
    assert.match(p.live.textContent, /^這局結束，你蓋了 2 層樓。/);
    env.pump(2000);
    assert.ok(visible(p.panel));
    assert.equal(p.ph.textContent, '你蓋了 2 層樓！');
    assert.equal(p.pb.textContent, '一陣子沒動，這局先到這裡', '不是說「沒疊上」');
    assert.equal(env.pending(), 0, '結束後迴圈會停（省電）');
    assert.equal(p.canvas.style.touchAction, 'manipulation');
    // 找房頁 onDone 的判斷：getState().status === 'playing' 才先出橫幅；這時是 over，會直接切到結果
    assert.notEqual(game.getState().status, 'playing');
    env.tick(400); tap(p);
    assert.equal(game.getState().status, 'playing', '想玩再點一下就重來');
    assert.equal(game.getState().floors, 0);
    env.pump(20000);
    assert.equal(game.getState().status, 'playing', '新的一局重新計時');
  } finally { uninstall(); }
  // 暫停中（分頁切走、捲出畫面）不算閒置：回來還是同一局
  const t = setup();
  try {
    t.p.btn.dispatch('click'); t.env.pump(1000);
    t.game.pause(); t.env.pump(60000);
    assert.equal(t.game.getState().status, 'playing');
    assert.equal(t.game.getState().paused, true);
  } finally { t.uninstall(); }
});

/* ---------- 跳過與銷毀 ---------- */
test('跳過：隱藏遊戲、顯示一行說明、跳過鈕消失、事件與 onSkip、之後所有輸入無效', () => {
  const { env, uninstall, p, events, game, skips } = setup();
  try {
    p.btn.dispatch('click'); env.pump(500);
    p.skip.dispatch('click');
    assert.equal(p.field.hidden, true);
    assert.equal(p.note.hidden, false);
    assert.equal(p.note.textContent, '好，不玩了。結果好了會在這裡出現。');
    assert.equal(p.skip.hidden, true);
    assert.equal(skips(), 1);
    const sk = events.find((e) => e.type === 'skip');
    assert.ok(sk && sk.plays === 1 && sk.durationMs >= 500, JSON.stringify(sk));
    assert.equal(env.pending(), 0);
    assert.equal(game.getState().status, 'skipped');
    const n = events.length;
    tap(p); key(p.canvas, 'Enter'); p.btn.dispatch('click'); game.pause(); game.resume(); p.skip.dispatch('click'); game.skip();
    assert.equal(events.length, n, '跳過後不再發事件');
    assert.equal(skips(), 1, 'onSkip 只呼叫一次');
    game.destroy();
  } finally { uninstall(); }
  const s2 = setup();
  try {
    s2.game.skip();
    assert.deepEqual(types(s2.events), ['skip']);
    assert.equal(s2.events[0].plays, 0);
  } finally { s2.uninstall(); }
});

test('銷毀：移除 DOM、所有監聽、rAF、observer、matchMedia；可重複呼叫；之後沒有任何事件', () => {
  const { env, uninstall, p, container, events, game } = setup();
  try {
    p.btn.dispatch('click'); env.pump(300);
    assert.ok(env.doc.listenerCount() >= 1);
    game.destroy();
    assert.equal(container.children.length, 0, 'DOM 已移除');
    for (const el of [p.canvas, p.field, p.btn, p.skip, p.panel]) assert.equal(el.listenerCount(), 0, `${el.className} 監聽全拆`);
    assert.equal(env.doc.listenerCount(), 0, 'document 監聽全拆');
    assert.equal(env.pending(), 0, 'rAF 已取消');
    assert.ok(env.mos.every((m) => m.disconnected !== undefined) && env.ros.every((r) => r.disconnected) && env.ios.every((i) => i.disconnected));
    assert.ok(env.mqs.every((m) => m._l.length === 0), 'matchMedia 監聽全拆');
    assert.equal(env.doc.documentElement.find((e) => e.id === 'wg-style').length, 0, '最後一個實例離開時移除樣式');
    const n = events.length;
    env.doc.hidden = true; env.doc.dispatch('visibilitychange'); key(p.canvas, 'Enter'); tap(p); p.btn.dispatch('click');
    env.pump(1000);
    game.pause(); game.resume(); game.skip(); game.destroy(); game.destroy();
    assert.equal(events.length, n);
    assert.equal(game.getState().status, 'destroyed');
  } finally { uninstall(); }
});

test('結果出來時頁面直接銷毀：樓層掉到一半、結果面板等著出來、暫停中，都收得乾淨', () => {
  for (const when of ['falling', 'over-pending', 'paused', 'ready']) {
    const { env, uninstall, p, game, container } = setup();
    try {
      if (when !== 'ready') { p.btn.dispatch('click'); env.pump(300); }
      if (when === 'falling') { down(p); env.pump(FRAME * 2); assert.equal(game.getState().phase, 'fall'); }
      if (when === 'over-pending') { bot(env, p, game, sloppy, 60 * 120); assert.ok(p.panel.hidden); assert.ok(env.pending() > 0); }
      if (when === 'paused') game.pause();
      game.destroy();
      assert.equal(env.pending(), 0, when);
      assert.equal(container.children.length, 0, when);
      assert.equal(p.field.listenerCount() + p.canvas.listenerCount() + p.btn.listenerCount() + env.doc.listenerCount(), 0, when);
      env.pump(3000);
      assert.equal(env.pending(), 0, `${when}：銷毀後不會再排 rAF`);
    } finally { uninstall(); }
  }
});

/* ---------- 主題、縮放、高 DPI ---------- */
test('主題：auto 跟 html[data-theme]、用 CSS 變數、明確 theme 不理 CSS 變數、palette 覆寫、無效色被忽略；深色場景換成暖色傍晚', () => {
  const light = '#2c2522', dark = '#f5f1eb';
  const a = setup({ trace: true });
  try {
    assert.equal(a.p.root.style.getPropertyValue('--wg-ink'), light, '預設淺色');
    assert.equal(a.p.root.style.getPropertyValue('--wg-vellum'), '#fffdf8');
    assert.equal(a.p.root.style.getPropertyValue('--wg-onwood'), '#fffdf8');
    const lightFills = new Set(a.p.ctx.states.map((x) => x.fill));
    a.env.doc.documentElement.setAttribute('data-theme', 'dark');
    assert.equal(a.p.root.style.getPropertyValue('--wg-ink'), dark, 'MutationObserver 即時跟隨');
    assert.equal(a.p.root.style.getPropertyValue('--wg-bg'), '#171310');
    assert.equal(a.p.root.style.getPropertyValue('--wg-onwood'), '#1f1b17');
    const darkFills = new Set(a.p.ctx.states.map((x) => x.fill));
    assert.ok(['#5a4e44', '#54493f', '#4b534d', '#5c4c46'].some((c) => darkFills.has(c)), '深色牆面');
    assert.ok(['#f3e7d3', '#e9d6bd', '#dfe3d5', '#f0dccd'].some((c) => lightFills.has(c)), '淺色牆面');
    a.env.doc.documentElement.setAttribute('data-theme', 'light');
    assert.equal(a.p.root.style.getPropertyValue('--wg-bg'), '#ece5d9');
  } finally { a.uninstall(); }
  const b = setup({ media: { '(prefers-color-scheme: dark)': true } });
  try {
    assert.equal(b.p.root.style.getPropertyValue('--wg-ink'), dark, '沒有 data-theme 時看系統');
    b.env.mqs.find((m) => m.media === '(prefers-color-scheme: dark)').fire(false);
    assert.equal(b.p.root.style.getPropertyValue('--wg-ink'), light, '系統主題改變也會跟');
  } finally { b.uninstall(); }
  const c = setup({ cssVars: { '--u2-ink': '#112233', '--u2-sunken': 'banana', '--u2-wood-600': '#445566' } });
  try {
    assert.equal(c.p.root.style.getPropertyValue('--wg-ink'), '#112233', '用頁面的 --u2-ink');
    assert.equal(c.p.root.style.getPropertyValue('--wg-bg'), '#ece5d9', '無效色（banana）退回內建');
    assert.equal(c.p.root.style.getPropertyValue('--wg-wood'), '#445566');
  } finally { c.uninstall(); }
  const d = setup({ cssVars: { '--u2-ink': '#112233', '--foreground': '#abcdef' } }, { theme: 'dark' });
  try { assert.equal(d.p.root.style.getPropertyValue('--wg-ink'), dark, '明確 theme 不被頁面變數蓋掉'); } finally { d.uninstall(); }
  const e = setup({ cssVars: { '--foreground': '#abcdef' } });
  try { assert.equal(e.p.root.style.getPropertyValue('--wg-ink'), '#abcdef', '沒有 --u2-* 時退到 --foreground'); } finally { e.uninstall(); }
  const f = setup({}, { palette: { fg: '#010101', accent: '#020202', bg: 'nope', muted: '#030303' } });
  try {
    assert.equal(f.p.root.style.getPropertyValue('--wg-ink'), '#010101');
    assert.equal(f.p.root.style.getPropertyValue('--wg-wood'), '#020202');
    assert.equal(f.p.root.style.getPropertyValue('--wg-ink2'), '#030303');
    assert.equal(f.p.root.style.getPropertyValue('--wg-bg'), '#ece5d9', '無效的 palette 值被忽略');
  } finally { f.uninstall(); }
});

test('縮放（手機轉向）：畫布跟著、遊戲不重來、已蓋的樓層還在；沒尺寸時（display:none）不爆，有尺寸才畫', () => {
  const { env, uninstall, p, game } = setup();
  try {
    p.btn.dispatch('click');
    bot(env, p, game, aimed, 60 * 30, (g) => g.floors >= 2 && g.phase === 'swing');
    const before = game.getState();
    env.fieldW = 220;
    env.ros[0].cb([{ target: p.field }]);
    assert.equal(p.canvas.width, 220 * 2);
    const after = game.getState();
    assert.equal(after.plays, before.plays);
    assert.equal(after.floors, before.floors);
    assert.equal(after.status, 'playing');
    assert.ok(Math.abs(after.width - before.width * core.metrics(220, 236).baseW / core.metrics(340, 236).baseW) < 1e-6, '樓層寬按起始寬的比例');
    env.fieldW = 700; env.fieldH = 296;
    env.ros[0].cb([{ target: p.field }]);
    assert.equal(p.canvas.width, 1400);
    assert.equal(p.canvas.height, 296 * 2);
    env.pump(500);
  } finally { uninstall(); }
  // 還沒開始就換尺寸：直接照新尺寸重建（不會被放大縮小走樣）
  const pre = setup({ fieldW: 30, fieldH: 236 });
  try {
    pre.env.fieldW = 286;
    pre.env.ros[0].cb([{ target: pre.p.field }]);
    assert.equal(pre.game.getState().width, core.metrics(286, 236).baseW);
    pre.p.btn.dispatch('click');
    assert.equal(pre.game.getState().width, core.metrics(286, 236).baseW);
  } finally { pre.uninstall(); }
  const hidden = setup({ fieldW: 0, fieldH: 0 });
  try {
    assert.equal(hidden.game.getState().status, 'ready');
    assert.equal(hidden.p.ctx.calls.length, 0, '沒尺寸時不畫');
    hidden.env.fieldW = 300; hidden.env.fieldH = 236;
    hidden.env.ros[0].cb([{ target: hidden.p.field }]);
    assert.ok(hidden.p.ctx.calls.length > 0, '有尺寸後才畫出來');
    assert.ok(visible(hidden.p.btn));
  } finally { hidden.uninstall(); }
});

test('高 DPI：畫布像素 = CSS 尺寸 × devicePixelRatio（最多 3 倍），繪圖用同一個縮放', () => {
  for (const [dpr, want] of [[1, 1], [2, 2], [2.625, 2.625], [3, 3], [4, 3]]) {
    const { uninstall, p } = setup({ dpr });
    try {
      assert.equal(p.canvas.width, Math.round(340 * want), `dpr ${dpr}`);
      assert.equal(p.canvas.height, Math.round(236 * want));
      const tf = p.ctx.calls.find((c) => c[0] === 'setTransform');
      assert.deepEqual(tf.slice(1), [want, 0, 0, want, 0, 0]);
    } finally { uninstall(); }
  }
});

/* ---------- 減少動態 ---------- */
test('prefers-reduced-motion：擺盪變慢、切下的碎塊不旋轉（淡出就好）、畫面捲動直接到位；一般模式有旋轉', () => {
  const play = (reduceOn) => {
    const { env, uninstall, p, game } = setup({ media: { '(prefers-reduced-motion: reduce)': reduceOn } }, { seed: 11 });
    try {
      p.btn.dispatch('click');
      env.pump(200);
      // 擺盪速度：量 1 秒內吊鉤走的距離
      let dist = 0, prev = game.getState().hookX;
      for (let i = 0; i < 60; i++) { env.pump(FRAME); const x = game.getState().hookX; dist += Math.abs(x - prev); prev = x; }
      bot(env, p, game, sloppy, 60 * 120);
      env.pump(1500);
      return { dist, rotates: p.ctx.calls.filter((c) => c[0] === 'rotate').length, floors: game.getState().floors };
    } finally { uninstall(); }
  };
  const normal = play(false), reduced = play(true);
  assert.ok(reduced.dist < normal.dist * 0.85, `擺盪距離 ${reduced.dist.toFixed(0)} < ${normal.dist.toFixed(0)}`);
  assert.ok(normal.rotates > 0, '一般模式：碎塊會轉著掉');
  assert.equal(reduced.rotates, 0, '減少動態：沒有旋轉');
  // 中途切換也跟著
  const { env, uninstall, p, game } = setup();
  try {
    p.btn.dispatch('click'); env.pump(100);
    env.mqs.find((m) => m.media === '(prefers-reduced-motion: reduce)').fire(true);
    let dist = 0, prev = game.getState().hookX;
    for (let i = 0; i < 60; i++) { env.pump(FRAME); const x = game.getState().hookX; dist += Math.abs(x - prev); prev = x; }
    assert.ok(dist < normal.dist * 0.85, '切到減少動態後，擺盪馬上變慢');
  } finally { uninstall(); }
});

/* ---------- 容錯 ---------- */
test('onEvent 拋例外不會弄壞遊戲；onSkip 拋例外也不會', () => {
  const { env, uninstall, p, game } = setup({}, { onEvent: () => { throw new Error('boom'); }, onSkip: () => { throw new Error('boom2'); } });
  try {
    p.btn.dispatch('click'); env.pump(1000);
    game.pause(); game.resume();
    playToOver(env, p, game);
    game.skip();
    assert.equal(game.getState().status, 'skipped');
  } finally { uninstall(); }
});

test('contextmenu：遊戲中被攔（避免長按跳選單），其他時候不攔', () => {
  const { uninstall, p } = setup();
  try {
    assert.equal(p.field.dispatch('contextmenu').defaultPrevented, false);
    p.btn.dispatch('click');
    assert.equal(p.field.dispatch('contextmenu').defaultPrevented, true);
  } finally { uninstall(); }
});

test('容錯：沒有容器、沒有 canvas 2D、沒有 observer／matchMedia 時不爆', () => {
  const a = installFakeDom();
  try {
    for (const bad of [null, undefined, {}, 5]) {
      const g = mountWaitGame(bad, {});
      g.pause(); g.resume(); g.skip(); g.destroy();
      assert.equal(g.getState().status, 'destroyed');
    }
  } finally { a.uninstall(); }
  const b = installFakeDom({ noCanvas: true });
  try {
    const c = b.env.doc.createElement('div');
    const g = mountWaitGame(c, {}); g.destroy();
    assert.equal(c.children.length, 0, '沒有 canvas 就不掛任何東西');
  } finally { b.uninstall(); }
  const d = installFakeDom({ noObservers: true });
  try {
    const c = d.env.doc.createElement('div'); d.env.doc.body.appendChild(c);
    const g = mountWaitGame(c, { seed: 3 });
    const parts = mountParts(d.env, c);
    assert.equal(g.getState().status, 'ready');
    parts.btn.dispatch('click');
    d.env.pump(500);
    g.destroy();
    assert.equal(parts.root.parentNode, null);
    assert.equal(d.env.pending(), 0);
  } finally { d.uninstall(); }
});

test('整局煙霧：亂點、亂按鍵玩完幾局，不拋例外、ctx 沒收到 NaN、事件順序與內容合理', () => {
  const { env, uninstall, p, events, game } = setup({}, { seed: 99 });
  try {
    key(p.canvas, 'Enter');
    let t = 0, round = 0;
    const rng = core.createGame({ seed: 4 });
    while (round < 3 && t < 900000) {
      const r = core.rand(rng);
      if (r < 0.04) down(p); else if (r < 0.06) key(p.canvas, ' '); else if (r < 0.065) key(p.canvas, 'p'); else if (r < 0.07) tap(p);
      env.pump(FRAME); t += FRAME;
      if (game.getState().status === 'over') { env.pump(1200); env.tick(400); tap(p); round++; }
    }
    assert.ok(round >= 3, `玩完 ${round} 局`);
    const seq = types(events);
    assert.equal(seq[0], 'start');
    seq.filter((x) => x === 'start' || x === 'over').forEach((x, i) => assert.equal(x, i % 2 === 0 ? 'start' : 'over'));
    for (const e of events) {
      assert.ok(Number.isInteger(e.score) && Number.isInteger(e.points) && Number.isInteger(e.plays) && Number.isInteger(e.durationMs), JSON.stringify(e));
      assert.ok(e.score >= 0 && e.points >= e.score * 10 && e.durationMs >= 0);
    }
    events.reduce((a, e) => { assert.ok(e.plays >= a); return e.plays; }, 0);
  } finally { uninstall(); }
});

test('鍵盤：瀏覽器沒給 e.code 時，仍可用 e.key 的空白鍵／Enter／P', () => {
  const { env, uninstall, p, game } = setup();
  try {
    p.canvas.dispatch('keydown', { key: 'Enter' });
    assert.equal(game.getState().status, 'playing');
    env.pump(300);
    p.canvas.dispatch('keydown', { key: ' ' }); env.pump(FRAME);
    assert.equal(game.getState().phase, 'fall');
    p.canvas.dispatch('keydown', { key: 'P' });
    assert.equal(game.getState().paused, true);
    p.canvas.dispatch('keydown', { key: undefined });     // 怪事件（例如瀏覽器自動填入）不能丟例外
    p.canvas.dispatch('keyup', {});
  } finally { uninstall(); }
});

test('frame:false：不畫外框、高度 100% 跟容器（頁面自己有外框時用）；可搭配 skipButton:false', () => {
  const { uninstall, p, game } = setup({}, { frame: false, skipButton: false });
  try {
    assert.ok(p.root.className.split(' ').includes('wg-bare'));
    assert.equal(p.root.style.height, '100%');
    assert.ok(!p.skip && !p.title);
    assert.equal(game.getState().status, 'ready');
  } finally { uninstall(); }
  const b = setup({}, {});
  try { assert.ok(!b.p.root.className.includes('wg-bare')); } finally { b.uninstall(); }
});

/* ---------- 審查後補強（2026-10-07） ---------- */
// 一幀畫完後，找出「樓」用的那個變換（中間那次 setTransform）
const worldTf = (ctx) => { const t = ctx.calls.filter((c) => c[0] === 'setTransform'); return t.length >= 3 ? t[t.length - 2].slice(1) : null; };

test('結束畫面看得到整棟樓：結果卡片出來後 0.6 秒內鏡頭拉遠、整棟塞進卡片右邊；減少動態直接到位；拉完迴圈停', () => {
  const { env, uninstall, p, game } = setup();
  try {
    p.btn.dispatch('click');
    bot(env, p, game, aimed, 60 * 120, (g) => g.floors >= 12 && g.phase === 'swing');
    bot(env, p, game, sloppy, 60 * 120);
    const st = game.getState();
    assert.equal(st.status, 'over');
    const m = core.metrics(340, 236), towerTop = core.CFG.FOUND_H + st.floors * m.fh;
    assert.ok(towerTop > m.gy, `塔高 ${towerTop} 超過畫面（${m.gy}），不拉遠就看不到全部`);
    env.pump(FRAME * 3);
    assert.deepEqual(worldTf(p.ctx), [2, 0, 0, 2, 0, 0], '掉落還在演：鏡頭不動');
    let guard = 0;
    while (p.panel.hidden && guard++ < 200) env.pump(FRAME);
    env.pump(300);
    const mid = worldTf(p.ctx);
    env.pump(400);
    const fin = worldTf(p.ctx);
    assert.ok(mid[0] < 2 && mid[0] > fin[0], `拉遠中 ${mid[0]} → ${fin[0]}`);
    const k = fin[0] / 2;
    assert.ok(k < 1 && k > 0.05, `縮放 ${k}`);
    assert.ok(k * (towerTop + 4) <= m.gy - 16 + 1e-6, '整棟樓（含女兒牆）都在畫面裡');
    assert.ok(fin[4] > 0, '樓往右移，讓出左邊給結果卡片');
    assert.equal(env.pending(), 0, '拉完就停');
    p.ctx.texts.length = 0;
    env.pump(500);
    assert.ok(!p.ctx.texts.some((t) => /^第 \d+ 層$/.test(t)), '結束後不畫角落膠囊');
  } finally { uninstall(); }
  const r = setup({ media: { '(prefers-reduced-motion: reduce)': true } });
  try {
    r.p.btn.dispatch('click');
    bot(r.env, r.p, r.game, aimed, 60 * 200, (g) => g.floors >= 12 && g.phase === 'swing');
    bot(r.env, r.p, r.game, sloppy, 60 * 200);
    let guard = 0;
    while (r.p.panel.hidden && guard++ < 200) r.env.pump(FRAME);
    r.env.pump(FRAME);
    const a = worldTf(r.p.ctx);
    r.env.pump(1000);
    assert.deepEqual(worldTf(r.p.ctx) || a, a, '減少動態：結果一出來就直接是拉遠後的畫面');
    assert.ok(a[0] < 2);
  } finally { r.uninstall(); }
});

test('焦點框只在用鍵盤時出現：手指／滑鼠點畫面開始或繼續不會整局掛著木色框', () => {
  const { env, uninstall, p, game } = setup();
  try {
    const css = env.doc.documentElement.find((e) => e.id === 'wg-style')[0].textContent;
    assert.ok(css.includes('[data-kbd="1"] .wg-canvas:focus-visible'), '畫布焦點框要有 data-kbd="1"');
    assert.ok(!/(^|[},])\.wg-canvas:focus-visible/.test(css), '沒有無條件的畫布焦點框');
    tap(p, { pointerType: 'touch', pointerId: 2 });
    assert.equal(game.getState().status, 'playing');
    assert.equal(env.doc.activeElement, p.canvas, '焦點照樣在畫布（鍵盤接手時可以直接玩）');
    assert.equal(p.root.getAttribute('data-kbd'), '0', '手指開始：不畫框');
    env.doc.dispatch('keydown', { key: 'Tab' });
    assert.equal(p.root.getAttribute('data-kbd'), '1', '一按鍵盤就畫框');
    down(p);
    assert.equal(p.root.getAttribute('data-kbd'), '0');
    game.destroy();
    assert.equal(env.doc.listenerCount(), 0, 'document 上的 keydown 監聽也拆掉');
  } finally { uninstall(); }
});

test('開局（或繼續）0.25 秒內的點擊不算放下：連點兩下開始，不會把第一層丟在最旁邊', () => {
  const { env, uninstall, p, game } = setup({ media: { '(pointer: coarse)': true } });
  try {
    tap(p, { pointerType: 'touch', pointerId: 21 });
    env.pump(120);
    down(p, { pointerType: 'touch', pointerId: 22 });   // 雙擊的第二下
    env.pump(FRAME * 3);
    assert.equal(game.getState().phase, 'swing', '開局 0.12 秒的第二下不放');
    assert.equal(game.getState().floors, 0);
    env.pump(200);
    down(p, { pointerType: 'touch', pointerId: 23 });
    env.pump(FRAME);
    assert.equal(game.getState().phase, 'fall', '過了 0.25 秒就正常放');
    env.pump(1500);
    game.pause();
    tap(p, { pointerType: 'touch', pointerId: 24 });
    assert.equal(game.getState().paused, false);
    down(p, { pointerType: 'touch', pointerId: 25 });
    env.pump(FRAME * 2);
    assert.equal(game.getState().phase, 'swing', '繼續後馬上的那一下也不算');
  } finally { uninstall(); }
});

test('螢幕倍率變了但大小沒變（換螢幕、改縮放）：畫布重算到新倍率，監聽換成新倍率的、舊的拆掉', () => {
  const { env, uninstall, p, game } = setup({ dpr: 2 });
  try {
    assert.equal(p.canvas.width, 680);
    const q2 = env.mqs.find((m) => m.media === '(resolution: 2dppx)');
    assert.ok(q2 && q2._l.length === 1, '有監聽目前倍率');
    globalThis.devicePixelRatio = 3;
    q2.fire(false);
    assert.equal(p.canvas.width, 340 * 3);
    assert.equal(p.canvas.height, 236 * 3);
    assert.equal(q2._l.length, 0, '舊倍率的監聽拆掉（不會越掛越多）');
    const q3 = env.mqs.find((m) => m.media === '(resolution: 3dppx)');
    assert.ok(q3 && q3._l.length === 1);
    const tf = p.ctx.calls.filter((c) => c[0] === 'setTransform').at(-1);
    assert.equal(tf[1], 3, '重畫用新倍率');
    globalThis.devicePixelRatio = 1.5;
    q3.fire(false);
    assert.equal(p.canvas.width, 510);
    game.destroy();
    assert.ok(env.mqs.every((m) => m._l.length === 0), '銷毀後倍率監聽也拆掉');
  } finally { uninstall(); }
});

test('高更新率螢幕（144Hz）：吊鉤每一幀都有往前走（插補，不會一幀動一幀停）', () => {
  const { env, uninstall, p, game } = setup();
  try {
    p.btn.dispatch('click');
    env.pump(400);
    const xs = [];
    for (let i = 0; i < 60; i++) { env.pump(1000 / 144, 1000 / 144); xs.push(game.getState().hookX); }
    let still = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - xs[i - 1]) < 1e-9) still++;
    assert.equal(still, 0, `有 ${still} 幀吊鉤沒動`);
  } finally { uninstall(); }
});

test('深色模式：要對準的那塊（吊著的）有木色外框和亮窗；已蓋好的樓外框是淺暖色，跟夜空分得開', () => {
  let lit = 0, hi = 0, line = 0;
  for (const seed of [5, 6, 7, 8]) {
    const { env, uninstall, p, game } = setup({ trace: true }, { theme: 'dark', seed });
    try {
      p.btn.dispatch('click');
      bot(env, p, game, aimed, 60 * 30, (g) => g.floors >= 1 && g.phase === 'swing');
      env.pump(300);
      p.ctx.states.length = 0;
      env.pump(FRAME);
      // 這時只蓋了一樓店面（櫥窗是半透明、不算），不透明的亮窗只可能來自吊著的那塊
      const sts = p.ctx.states;
      hi += sts.filter((x) => x.stroke === '#c9a87c' && x.lw === 1.5).length;
      lit += sts.filter((x) => x.fill === '#e9c46a' && x.ga === 1).length;
      line += sts.filter((x) => x.stroke === '#9a8878' && x.lw === 1).length;
    } finally { uninstall(); }
  }
  assert.ok(hi >= 4, '吊著的那塊有木色外框');
  assert.ok(lit > 0, '吊著的那塊有亮窗');
  assert.ok(line > 0, '蓋好的樓用淺暖色外框');
});

/* ---------- 跟找房頁的接法 ---------- */
test('找房頁的接法：window.mountWaitGame／WaitGameCore.scoreBucket；用頁面的選項掛載；status 的變化與事件內容跟頁面期待的一樣', () => {
  const g = loadClassic('public/js/wait-game.js');
  assert.equal(typeof g.mountWaitGame, 'function');
  assert.equal(typeof g.WaitGameCore.scoreBucket, 'function');
  for (const v of [0, 1, 5, 20, 1e9]) { const b = g.WaitGameCore.scoreBucket(v); assert.ok(Number.isInteger(b) && b >= 0 && b <= 9); }
  const tracked = [];
  const { env, uninstall, p, game } = setup({ fieldW: 300, fieldH: 276 }, {
    height: 280, frame: false, skipButton: false,
    onEvent: (e) => { if (e.type === 'start' || e.type === 'over' || e.type === 'skip') tracked.push({ a: e.type, sc: core.scoreBucket(e.score), pl: e.plays }); },
  });
  try {
    const api = game;
    for (const k of ['pause', 'resume', 'skip', 'getState', 'destroy']) assert.equal(typeof api[k], 'function', k);
    assert.equal(game.getState().status, 'ready');
    tap(p);
    assert.equal(game.getState().status, 'playing');
    game.pause();
    assert.equal(game.getState().status, 'playing', '暫停也算 playing：結果好了先出橫幅，不硬切頁');
    game.resume();
    bot(env, p, game, aimed, 60 * 60, (s) => s.floors >= 3 && s.phase === 'swing');
    bot(env, p, game, sloppy, 60 * 120);
    assert.equal(game.getState().status, 'over');
    assert.deepEqual(tracked.map((x) => x.a), ['start', 'over']);
    assert.equal(tracked[1].sc, core.scoreBucket(game.getState().floors));
    game.skip();
    assert.deepEqual(tracked.map((x) => x.a), ['start', 'over', 'skip']);
    game.destroy();
    assert.equal(env.pending(), 0);
  } finally { uninstall(); }
});

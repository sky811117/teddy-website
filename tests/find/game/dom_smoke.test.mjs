// 介面層煙霧測試：用假 DOM 跑 mountWaitGame（掛載、開始、鍵盤／滑鼠／觸控、暫停、跳過、主題、縮放、銷毀）
// 這不能取代「用真瀏覽器看畫面」，但能抓到執行期錯誤、事件流程、狀態機、洩漏（監聽器／rAF）等問題。
import test from 'node:test';
import assert from 'node:assert/strict';
import { requireClassic } from '../_helpers.mjs';
import { installFakeDom, mountParts } from './fake_dom.mjs';

const { mountWaitGame, core } = requireClassic('public/js/wait-game.js');

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
const tap = (cv, x = 100, y = 100, type = 'mouse', id = 1) => {
  cv.dispatch('pointerdown', { pointerId: id, pointerType: type, button: 0, clientX: x, clientY: y });
  cv.dispatch('pointerup', { pointerId: id, pointerType: type, button: 0, clientX: x, clientY: y });
};
const key = (cv, k, extra = {}) => cv.dispatch('keydown', Object.assign({ key: k, code: k.length === 1 ? 'Key' + k.toUpperCase() : (k === ' ' ? 'Space' : k) }, extra));
const keyUp = (cv, k) => cv.dispatch('keyup', { key: k, code: k.length === 1 ? (k === ' ' ? 'Space' : 'Key' + k.toUpperCase()) : k });
const types = (ev) => ev.map((e) => e.type);

test('掛載：結構、aria、固定高度、樣式只注入一次、開始畫面文字', () => {
  const { env, uninstall, p, game, container } = setup();
  try {
    assert.ok(p.root && p.canvas && p.field && p.skip && p.title);
    assert.equal(p.root.style.height, '280px');
    assert.equal(p.canvas.tabIndex, 0);
    assert.equal(p.canvas.getAttribute('role'), 'img');
    assert.match(p.canvas.getAttribute('aria-label'), /守護小屋小遊戲.*壁癌.*漏水.*白蟻.*蟑螂.*噪音/);
    assert.equal(p.title.textContent, '守護小屋');
    assert.equal(p.skip.textContent, '跳過遊戲');
    assert.equal(p.skip.type, 'button');
    assert.equal(env.doc.documentElement.find((e) => e.id === 'wg-style').length, 1);
    const g2 = mountWaitGame(container, {});
    assert.equal(env.doc.documentElement.find((e) => e.id === 'wg-style').length, 1, '樣式只注入一次');
    g2.destroy();
    assert.equal(env.doc.documentElement.find((e) => e.id === 'wg-style').length, 1, '還有一個實例在，樣式不能被移掉');
    // 開始畫面
    assert.ok(p.ctx.texts.includes('守護小屋'), '標題');
    assert.ok(p.ctx.texts.includes('點一下開始'), '開始鈕');
    assert.ok(p.ctx.texts.some((t) => t.includes('左右移動，點一下射擊')), '說明');
    assert.ok(p.ctx.texts.some((t) => t.startsWith('分數 0')), 'HUD 分數');
    assert.ok(p.ctx.texts.some((t) => t.startsWith('屋況 5/5')), 'HUD 屋況');
    assert.equal(env.pending(), 0, '開始前不跑 rAF（省電）');
    assert.equal(p.canvas.style.touchAction, 'pan-y', '開始前不擋捲動');
    assert.equal(game.getState().status, 'ready');
    // 畫布尺寸 = 場地 × DPR（2）
    assert.equal(p.canvas.width, 340 * 2);
    assert.equal(p.canvas.height, 236 * 2);
  } finally { uninstall(); }
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
    assert.ok(b.p.ctx.texts.includes('開始玩'));
    assert.ok(b.p.ctx.texts.includes('守護小屋'), '非字串的 label 被忽略');
  } finally { b.uninstall(); }
});

test('點一下開始 → 遊戲中：事件、touch-action、rAF 開跑、HUD', () => {
  const { env, uninstall, p, events, game } = setup();
  try {
    tap(p.canvas);
    assert.deepEqual(types(events), ['start']);
    assert.equal(events[0].plays, 1);
    assert.equal(events[0].score, 0);
    assert.equal(events[0].durationMs, 0);
    assert.equal(p.canvas.style.touchAction, 'none', '開始後才鎖定拖曳');
    assert.equal(env.doc.activeElement, p.canvas, '開始後焦點在 canvas');
    assert.equal(env.pending(), 1);
    env.pump(2000);
    assert.equal(game.getState().status, 'playing');
    assert.ok(p.ctx.calls.length > 500);
    p.ctx.texts.length = 0;
    env.pump(100);
    assert.ok(p.ctx.texts.some((t) => t.startsWith('分數')));
    assert.ok(!p.ctx.texts.includes('點一下開始'), '開始畫面已消失');
  } finally { uninstall(); }
});

test('結束：不玩的人約 8～22 秒結束；over 事件、結束畫面、不能立刻重玩、之後可重玩', () => {
  const { env, uninstall, p, events, game } = setup();
  try {
    tap(p.canvas);
    env.pump(30000);
    const st = game.getState();
    assert.equal(st.status, 'over');
    assert.equal(st.hp, 0);
    const over = events.find((e) => e.type === 'over');
    assert.ok(over, 'over 事件');
    assert.equal(over.plays, 1);
    assert.equal(over.score, 0);
    assert.ok(over.durationMs >= 5000 && over.durationMs <= 22000, `durationMs ${over.durationMs}`);
    assert.equal(events.filter((e) => e.type === 'over').length, 1, 'over 只發一次');
    env.pump(1500);                                     // 讓爆破跑完、迴圈停止
    assert.equal(env.pending(), 0, '結束後迴圈會停');
    assert.ok(p.ctx.texts.includes('這局結束了'));
    assert.ok(p.ctx.texts.includes('點一下，或按任意鍵，再玩一次'));
    assert.ok(p.ctx.texts.some((t) => /^分數 0，最高 0$/.test(t)));
    assert.equal(p.canvas.style.touchAction, 'pan-y');
    // 重玩：先過 400ms 鎖定
  } finally { uninstall(); }
  const t2 = setup();
  try {
    tap(t2.p.canvas); t2.env.pump(30000);
    assert.equal(t2.game.getState().status, 'over');
    // 剛結束的瞬間：點擊與按鍵都被擋（避免連點把結果畫面吃掉）
    const justNow = setup();
    justNow.uninstall();   // 只為確保互不干擾
  } finally { t2.uninstall(); }
});

test('結束後 400ms 內點擊／按鍵不會立刻重玩；之後點一下、按任意鍵（Tab 除外、長按不算）才重玩', () => {
  const { env, uninstall, p, events, game } = setup();
  try {
    tap(p.canvas);
    // 逐格推進到剛好結束
    let guard = 0;
    while (game.getState().status === 'playing' && guard++ < 3000) env.pump(1000 / 60);
    assert.equal(game.getState().status, 'over');
    tap(p.canvas);
    key(p.canvas, 'x');
    assert.equal(game.getState().status, 'over', '400ms 內不重玩');
    env.tick(450);
    key(p.canvas, 'Tab');
    key(p.canvas, 'Shift');
    key(p.canvas, 'x', { repeat: true });
    key(p.canvas, 'F5'); key(p.canvas, 'Escape'); key(p.canvas, 'F12');
    assert.equal(game.getState().status, 'over', 'Tab／Shift／Esc／F 鍵／長按不算重玩');
    const ev = key(p.canvas, 'x');
    assert.equal(game.getState().status, 'playing');
    assert.equal(game.getState().plays, 2);
    assert.equal(events.filter((e) => e.type === 'start').length, 2);
    assert.equal(ev.defaultPrevented, false, '一般鍵不吃掉預設行為');
    assert.equal(game.getState().score, 0, '新局分數歸零');
    assert.equal(game.getState().hp, 5);
  } finally { uninstall(); }
  // 點擊重玩
  const t = setup();
  try {
    tap(t.p.canvas);
    let guard = 0;
    while (t.game.getState().status === 'playing' && guard++ < 3000) t.env.pump(1000 / 60);
    t.env.tick(450);
    tap(t.p.canvas);
    assert.equal(t.game.getState().status, 'playing');
  } finally { t.uninstall(); }
});

test('鍵盤：Enter／空白鍵開始；方向鍵與 A D 移動並攔下預設捲動；放開即停；Tab 不被攔', () => {
  const { env, uninstall, p, game } = setup({}, { autoFire: false });
  try {
    const e1 = key(p.canvas, 'Enter');
    assert.equal(game.getState().status, 'playing');
    assert.equal(e1.defaultPrevented, true);
    const x0 = game.getState().houseX;
    key(p.canvas, 'ArrowRight');
    env.pump(300);
    const x1 = game.getState().houseX;
    assert.ok(x1 > x0 + 60, `右移 ${x0} → ${x1}`);
    keyUp(p.canvas, 'ArrowRight');
    env.pump(300);
    assert.equal(game.getState().houseX, x1, '放開就停');
    const l = key(p.canvas, 'ArrowLeft');
    assert.equal(l.defaultPrevented, true);
    env.pump(200);
    assert.ok(game.getState().houseX < x1 - 40);
    keyUp(p.canvas, 'ArrowLeft');
    key(p.canvas, 'a'); env.pump(100); const xa = game.getState().houseX; keyUp(p.canvas, 'a');
    key(p.canvas, 'd'); env.pump(200); assert.ok(game.getState().houseX > xa); keyUp(p.canvas, 'd');
    const tab = key(p.canvas, 'Tab');
    assert.equal(tab.defaultPrevented, false, 'Tab 要能離開遊戲');
    // 空白鍵：autoFire 關閉時，沒按不射、按住才射
    assert.equal(game.getState().shots, 0);
    const sp = key(p.canvas, ' ');
    assert.equal(sp.defaultPrevented, true);
    env.pump(1000);
    const shots = game.getState().shots;
    assert.ok(shots >= 4 && shots <= 7, `按住空白鍵一秒射了 ${shots} 發`);
    keyUp(p.canvas, ' ');
    env.pump(500);
    assert.equal(game.getState().shots, shots, '放開空白鍵就停火');
  } finally { uninstall(); }
  const s2 = setup({}, { autoFire: false });
  try { key(s2.p.canvas, ' '); assert.equal(s2.game.getState().status, 'playing', '空白鍵也能開始'); } finally { s2.uninstall(); }
});

test('失焦（blur）會清掉按住的鍵，小屋不會一直滑', () => {
  const { env, uninstall, p, game } = setup({}, { autoFire: false });
  try {
    key(p.canvas, 'Enter'); key(p.canvas, 'ArrowRight'); env.pump(100);
    p.canvas.dispatch('blur');
    const x = game.getState().houseX;
    env.pump(500);
    assert.equal(game.getState().houseX, x);
  } finally { uninstall(); }
});

test('滑鼠：移動即控制小屋位置、按住連射、單擊補一發；右鍵無效', () => {
  const { env, uninstall, p, game } = setup({}, { autoFire: false });
  try {
    tap(p.canvas);
    const m = (x) => p.canvas.dispatch('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: x, clientY: 100, buttons: 0 });
    m(50); env.pump(600);
    assert.ok(Math.abs(game.getState().houseX - 50) < 3 || game.getState().houseX === 35, `x=${game.getState().houseX}`);
    m(300); env.pump(600);
    assert.ok(Math.abs(game.getState().houseX - 300) < 3);
    assert.equal(game.getState().shots, 0, '只移動不射');
    p.canvas.dispatch('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 2, clientX: 300, clientY: 100 });
    env.pump(300);
    assert.equal(game.getState().shots, 0, '右鍵不射');
    p.canvas.dispatch('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 300, clientY: 100 });
    env.pump(1000);
    const held = game.getState().shots;
    assert.ok(held >= 4, `按住 1 秒射 ${held}`);
    p.canvas.dispatch('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 300, clientY: 100 });
    env.pump(500);
    assert.equal(game.getState().shots, held, '放開停火');
    tap(p.canvas, 300, 100);
    env.pump(100);
    assert.ok(game.getState().shots > held, '單擊至少補一發');
    assert.equal(p.canvas.captured, false);
  } finally { uninstall(); }
});

test('觸控：相對拖曳（手指落下不跳）、自動連射、第二根手指不亂控制', () => {
  const { env, uninstall, p, game } = setup({ media: { '(pointer: coarse)': true } });
  try {
    tap(p.canvas, 100, 100, 'touch', 7);
    assert.equal(game.getState().status, 'playing');
    const x0 = game.getState().houseX;                              // 170
    p.canvas.dispatch('pointerdown', { pointerId: 8, pointerType: 'touch', button: 0, clientX: 40, clientY: 100 });
    env.pump(100);
    assert.ok(Math.abs(game.getState().houseX - x0) < 1, '手指落在別處，小屋不跳');
    assert.equal(p.canvas.captured, true);
    p.canvas.dispatch('pointermove', { pointerId: 8, pointerType: 'touch', clientX: 90, clientY: 100 });
    env.pump(300);
    assert.ok(Math.abs(game.getState().houseX - (x0 + 50)) < 2, `拖 50px → 小屋 ${game.getState().houseX}`);
    p.canvas.dispatch('pointerdown', { pointerId: 9, pointerType: 'touch', button: 0, clientX: 300, clientY: 100 });
    p.canvas.dispatch('pointermove', { pointerId: 9, pointerType: 'touch', clientX: 10, clientY: 100 });
    env.pump(200);
    assert.ok(Math.abs(game.getState().houseX - (x0 + 50)) < 2, '第二根手指的移動不影響小屋');
    p.canvas.dispatch('pointerup', { pointerId: 9, pointerType: 'touch', clientX: 10, clientY: 100 });
    p.canvas.dispatch('pointerup', { pointerId: 8, pointerType: 'touch', clientX: 90, clientY: 100 });
    assert.equal(p.canvas.captured, false);
    const shots = game.getState().shots;
    assert.ok(shots >= 2, `觸控裝置預設自動連射，已射 ${shots}`);
    env.pump(1000);
    assert.ok(game.getState().shots > shots + 3, '放開手指仍持續自動連射');
  } finally { uninstall(); }
});

test('非遊戲中的「點一下」要放開才算；拖動超過 14px、pointercancel 都不會啟動（避免捲動頁面時誤觸）', () => {
  const { uninstall, p, game } = setup({}, {});
  try {
    p.canvas.dispatch('pointerdown', { pointerId: 3, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
    assert.equal(game.getState().status, 'ready', '按下去還不算');
    p.canvas.dispatch('pointerup', { pointerId: 3, pointerType: 'touch', button: 0, clientX: 100, clientY: 160 });
    assert.equal(game.getState().status, 'ready', '往下滑 60px 是捲動，不是點擊');
    p.canvas.dispatch('pointerdown', { pointerId: 4, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
    p.canvas.dispatch('pointercancel', { pointerId: 4, pointerType: 'touch' });
    p.canvas.dispatch('pointerup', { pointerId: 4, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
    assert.equal(game.getState().status, 'ready', 'cancel 後的 up 不算');
    p.canvas.dispatch('pointerdown', { pointerId: 5, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
    p.canvas.dispatch('pointerup', { pointerId: 5, pointerType: 'mouse', button: 0, clientX: 103, clientY: 102 });
    assert.equal(game.getState().status, 'playing', '輕微抖動的點擊算數');
  } finally { uninstall(); }
});

test('分頁隱藏 → 自動暫停（停 rAF、顯示「已暫停」）；點一下才繼續', () => {
  const { env, uninstall, p, events, game } = setup();
  try {
    tap(p.canvas); env.pump(500);
    env.doc.hidden = true;
    env.doc.dispatch('visibilitychange');
    assert.equal(game.getState().paused, true);
    assert.equal(env.pending(), 0, '暫停時沒有排程中的 rAF');
    assert.ok(p.ctx.texts.includes('已暫停，點一下繼續'));
    assert.equal(p.canvas.style.touchAction, 'pan-y');
    assert.ok(types(events).includes('pause'));
    const frozen = JSON.stringify(game.getState());
    env.pump(2000);
    assert.equal(JSON.stringify(game.getState()), frozen, '暫停期間遊戲不動');
    env.doc.hidden = false;
    env.doc.dispatch('visibilitychange');
    assert.equal(game.getState().paused, true, '回到分頁不會自動繼續（玩家還沒準備好）');
    tap(p.canvas);
    assert.equal(game.getState().paused, false);
    assert.deepEqual(types(events).slice(-1), ['resume']);
    assert.equal(env.pending(), 1);
    p.ctx.texts.length = 0;
    env.pump(200);
    assert.ok(!p.ctx.texts.includes('已暫停，點一下繼續'));
  } finally { uninstall(); }
});

test('容器離開視窗（IntersectionObserver）→ 暫停；P／Esc 鍵暫停與繼續', () => {
  const { env, uninstall, p, game } = setup({}, { autoFire: false });
  try {
    tap(p.canvas); env.pump(300);
    env.ios[0].cb([{ isIntersecting: true }]);
    assert.equal(game.getState().paused, false);
    env.ios[0].cb([{ isIntersecting: false }]);
    assert.equal(game.getState().paused, true);
    key(p.canvas, 'Enter');
    assert.equal(game.getState().paused, false, 'Enter 可繼續');
    key(p.canvas, 'p');
    assert.equal(game.getState().paused, true);
    key(p.canvas, 'p', { repeat: true });
    assert.equal(game.getState().paused, true, '長按不會來回切換');
    key(p.canvas, 'Escape');
    assert.equal(game.getState().paused, false);
    key(p.canvas, 'Escape');
    assert.equal(game.getState().paused, true);
  } finally { uninstall(); }
});

test('公開 pause()／resume()：只在遊戲中有效；重複呼叫不重複發事件', () => {
  const { env, uninstall, p, events, game } = setup();
  try {
    game.pause(); game.resume();
    assert.equal(events.length, 0, '還沒開始：不發事件');
    tap(p.canvas); env.pump(200);
    game.pause(); game.pause();
    assert.equal(types(events).filter((t) => t === 'pause').length, 1);
    game.resume(); game.resume();
    assert.equal(types(events).filter((t) => t === 'resume').length, 1);
    assert.equal(env.pending(), 1);
    env.pump(30000);
    assert.equal(game.getState().status, 'over');
    const n = events.length;
    game.pause(); game.resume();
    assert.equal(events.length, n, '結束後 pause／resume 無效');
  } finally { uninstall(); }
});

test('跳過：隱藏遊戲、顯示一行說明、跳過鈕消失、事件與 onSkip、之後所有輸入無效', () => {
  const { env, uninstall, p, events, game, skips } = setup();
  try {
    tap(p.canvas); env.pump(500);
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
    tap(p.canvas); key(p.canvas, 'Enter'); game.pause(); game.resume(); p.skip.dispatch('click'); game.skip();
    assert.equal(events.length, n, '跳過後不再發事件');
    assert.equal(skips(), 1, 'onSkip 只呼叫一次');
    game.destroy();
  } finally { uninstall(); }
  const s2 = setup();      // 還沒開始就跳過
  try {
    s2.game.skip();
    assert.deepEqual(types(s2.events), ['skip']);
    assert.equal(s2.events[0].plays, 0);
  } finally { s2.uninstall(); }
});

test('銷毀：移除 DOM、所有監聽、rAF、observer；可重複呼叫；之後沒有任何事件', () => {
  const { env, uninstall, p, container, events, game } = setup();
  try {
    tap(p.canvas); env.pump(300);
    const docBefore = env.doc.listenerCount();
    assert.ok(docBefore >= 1);
    game.destroy();
    assert.equal(container.children.length, 0, 'DOM 已移除');
    assert.equal(p.canvas.listenerCount(), 0, 'canvas 監聽全拆');
    assert.equal(p.skip.listenerCount(), 0);
    assert.equal(env.doc.listenerCount(), 0, 'document 監聽全拆');
    assert.equal(env.pending(), 0, 'rAF 已取消');
    assert.ok(env.mos.every((m) => m.disconnected !== undefined) && env.ros.every((r) => r.disconnected) && env.ios.every((i) => i.disconnected));
    assert.equal(env.mqs.every((m) => m._l.length === 0), true, 'matchMedia 監聽全拆');
    assert.equal(env.doc.documentElement.find((e) => e.id === 'wg-style').length, 0, '最後一個實例離開時移除樣式');
    const n = events.length;
    env.doc.hidden = true; env.doc.dispatch('visibilitychange'); key(p.canvas, 'Enter');
    env.pump(1000);
    game.pause(); game.resume(); game.skip(); game.destroy(); game.destroy();
    assert.equal(events.length, n);
    assert.equal(game.getState().status, 'destroyed');
  } finally { uninstall(); }
});

test('主題：auto 跟 html[data-theme]、用 CSS 變數、明確 theme 不理 CSS 變數、palette 覆寫、無效色被忽略', () => {
  const light = '#2c2522', dark = '#f5f1eb';
  const a = setup();
  try {
    assert.equal(a.p.root.style.getPropertyValue('--wg-ink'), light, '預設淺色');
    a.env.doc.documentElement.setAttribute('data-theme', 'dark');       // 網站日夜鈕
    assert.equal(a.p.root.style.getPropertyValue('--wg-ink'), dark, 'MutationObserver 即時跟隨');
    assert.equal(a.p.root.style.getPropertyValue('--wg-bg'), '#171310');
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

test('縮放：場地變窄／變寬後畫布跟著、小屋不出界、遊戲不重來', () => {
  const { env, uninstall, p, game } = setup({}, { autoFire: false });
  try {
    tap(p.canvas); key(p.canvas, 'ArrowRight'); env.pump(2000); keyUp(p.canvas, 'ArrowRight');
    const sc = game.getState().plays;
    env.fieldW = 220;
    env.ros[0].cb([{ target: p.field }]);
    assert.equal(p.canvas.width, 220 * 2);
    assert.ok(game.getState().houseX <= 220 - 32 - 3 + 1e-6, `houseX ${game.getState().houseX}`);
    assert.equal(game.getState().plays, sc);
    assert.equal(game.getState().status, 'playing');
    env.fieldW = 700; env.fieldH = 296;
    env.ros[0].cb([{ target: p.field }]);
    assert.equal(p.canvas.width, 1400);
    assert.equal(p.canvas.height, 296 * 2);
    env.pump(500);
  } finally { uninstall(); }
  const hidden = setup({ fieldW: 0, fieldH: 0 });          // 掛在 display:none 的區塊：沒尺寸時不爆
  try {
    assert.equal(hidden.game.getState().status, 'ready');
    hidden.env.fieldW = 300; hidden.env.fieldH = 236;
    hidden.env.ros[0].cb([{ target: hidden.p.field }]);
    assert.ok(hidden.p.ctx.texts.includes('點一下開始'), '有尺寸後才畫出來');
  } finally { hidden.uninstall(); }
});

test('prefers-reduced-motion：不出現分數飄字／粒子／震動；一般模式有', () => {
  const play = (reduceOn) => {
    const { env, uninstall, p, game } = setup({ media: { '(prefers-reduced-motion: reduce)': reduceOn } }, { autoFire: true, seed: 11 });
    try {
      tap(p.canvas);
      let t = 0;
      while (game.getState().status === 'playing' && t < 60000) {
        // 掃來掃去亂射
        p.canvas.dispatch('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 40 + ((t / 8) % 260), clientY: 100 });
        env.pump(50); t += 50;
      }
      const gotPlus = p.ctx.texts.some((x) => /^\+\d+$/.test(x));
      const arcs = p.ctx.calls.filter((c) => c[0] === 'arc' && c[3] === 2.6).length;   // 擊破碎屑（半徑 2.6）
      return { gotPlus, arcs, kills: game.getState().kills };
    } finally { uninstall(); }
  };
  const normal = play(false), reduced = play(true);
  assert.ok(normal.kills > 0 && reduced.kills > 0, `兩邊都要有擊殺：${normal.kills}/${reduced.kills}`);
  assert.equal(normal.gotPlus, true, '一般模式有 +分數');
  assert.ok(normal.arcs > 0, '一般模式有碎屑');
  assert.equal(reduced.gotPlus, false, '減少動態：沒有飄字');
  assert.equal(reduced.arcs, 0, '減少動態：沒有碎屑');
});

test('最高分：寫入 localStorage（鍵可設）、下次載入讀回；新紀錄顯示「新紀錄」', () => {
  const { env, uninstall, p, game } = setup({}, { autoFire: true, seed: 11, storageKey: 'my.best' });
  try {
    tap(p.canvas);
    let t = 0;
    while (game.getState().status === 'playing' && t < 80000) {
      p.canvas.dispatch('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 40 + ((t / 8) % 260), clientY: 100 });
      env.pump(50); t += 50;
    }
    const st = game.getState();
    assert.equal(st.status, 'over');
    assert.ok(st.score > 0, `分數 ${st.score}`);
    assert.equal(st.best, st.score);
    assert.deepEqual(env.storageLog.at(-1), ['my.best', String(st.score)]);
    env.pump(1500);
    assert.ok(p.ctx.texts.some((x) => x === `分數 ${st.score}，新紀錄`), p.ctx.texts.slice(-8).join('|'));
    // 下一次掛載讀回最高分並顯示在開始畫面
    const g2 = mountWaitGame(env.doc.createElement('div'), {});
    g2.destroy();
    const c2 = env.doc.createElement('div'); env.doc.body.appendChild(c2);
    const g3 = mountWaitGame(c2, { storageKey: 'my.best' });
    assert.equal(g3.getState().best, st.score);
    const ctx3 = mountParts(env, c2).ctx;
    assert.ok(ctx3.texts.includes(`最高 ${st.score}`), ctx3.texts.join('|'));
    g3.destroy();
  } finally { uninstall(); }
});

test('localStorage 拋例外／不存在時，遊戲照常運作', () => {
  for (const storage of ['throw', 'none']) {
    const { env, uninstall, p, game } = setup({ storage }, { autoFire: true, seed: 11 });
    try {
      assert.equal(game.getState().best, 0);
      tap(p.canvas);
      let t = 0;
      while (game.getState().status === 'playing' && t < 80000) {
        p.canvas.dispatch('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 40 + ((t / 8) % 260), clientY: 100 });
        env.pump(50); t += 50;
      }
      assert.equal(game.getState().status, 'over', storage);
      assert.ok(game.getState().best > 0, '記憶體內仍會更新最高分');
    } finally { uninstall(); }
  }
});

test('onEvent 拋例外不會弄壞遊戲；onSkip 拋例外也不會', () => {
  const { env, uninstall, p, game } = setup({}, { onEvent: () => { throw new Error('boom'); }, onSkip: () => { throw new Error('boom2'); } });
  try {
    tap(p.canvas); env.pump(1000);
    game.pause(); game.resume();
    game.skip();
    assert.equal(game.getState().status, 'skipped');
  } finally { uninstall(); }
});

test('contextmenu：遊戲中被攔（避免長按跳選單），其他時候不攔', () => {
  const { uninstall, p } = setup();
  try {
    assert.equal(p.canvas.dispatch('contextmenu').defaultPrevented, false);
    tap(p.canvas);
    assert.equal(p.canvas.dispatch('contextmenu').defaultPrevented, true);
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
    // 沒有 ResizeObserver：用 window resize（這裡 window 是 globalThis，不會自動觸發；至少不能拋例外）
    assert.equal(g.getState().status, 'ready');
    g.destroy();
    assert.equal(parts.root.parentNode, null);
  } finally { d.uninstall(); }
});

test('整局煙霧：用假鍵盤＋亂數輸入玩完幾局，不拋例外、ctx 沒收到 NaN、事件順序合理', () => {
  const { env, uninstall, p, events, game } = setup({}, { autoFire: false, seed: 99 });
  try {
    key(p.canvas, 'Enter');
    let t = 0, round = 0;
    const rng = core.createGame({ seed: 4 });
    while (round < 3 && t < 600000) {
      const r = core.rand(rng);
      if (r < 0.1) key(p.canvas, 'ArrowLeft'); else if (r < 0.2) keyUp(p.canvas, 'ArrowLeft');
      else if (r < 0.3) key(p.canvas, 'ArrowRight'); else if (r < 0.4) keyUp(p.canvas, 'ArrowRight');
      else if (r < 0.7) key(p.canvas, ' '); else if (r < 0.8) keyUp(p.canvas, ' ');
      else if (r < 0.83) { p.canvas.dispatch('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: core.rand(rng) * 340 }); }
      env.pump(33); t += 33;
      if (game.getState().status === 'over') { env.tick(500); key(p.canvas, 'x'); round++; }
    }
    assert.ok(round >= 3, `玩完 ${round} 局`);
    const seq = types(events);
    assert.equal(seq[0], 'start');
    // start 與 over 必須成對交替
    const so = seq.filter((x) => x === 'start' || x === 'over');
    so.forEach((x, i) => assert.equal(x, i % 2 === 0 ? 'start' : 'over'));
    assert.ok(events.every((e) => Number.isInteger(e.score) && Number.isInteger(e.plays) && Number.isInteger(e.durationMs) && e.score >= 0 && e.durationMs >= 0));
    assert.ok(events.filter((e) => e.type === 'over').every((e) => core.scoreBucket(e.score) >= 0));
    // plays 單調
    events.reduce((a, e) => { assert.ok(e.plays >= a); return e.plays; }, 0);
  } finally { uninstall(); }
});

test('鍵盤：瀏覽器沒給 e.code 時，仍可用 e.key 的 a／d／p／空白鍵', () => {
  const { env, uninstall, p, game } = setup({}, { autoFire: false });
  try {
    p.canvas.dispatch('keydown', { key: 'Enter' });
    const x0 = game.getState().houseX;
    p.canvas.dispatch('keydown', { key: 'D' }); env.pump(200); p.canvas.dispatch('keyup', { key: 'D' });
    const x1 = game.getState().houseX;
    assert.ok(x1 > x0 + 30);
    p.canvas.dispatch('keydown', { key: 'a' }); env.pump(200); p.canvas.dispatch('keyup', { key: 'a' });
    assert.ok(game.getState().houseX < x1 - 30);
    p.canvas.dispatch('keydown', { key: ' ' }); env.pump(500); p.canvas.dispatch('keyup', { key: ' ' });
    assert.ok(game.getState().shots >= 2);
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

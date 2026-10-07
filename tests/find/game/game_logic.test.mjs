// 蓋大樓：純邏輯測試（node 內建 test runner，不連網、不用瀏覽器）
// 執行：node --test tests/find/
import test from 'node:test';
import assert from 'node:assert/strict';
import { requireClassic } from '../_helpers.mjs';

const { core } = requireClassic('public/js/wait-game.js');
const { CFG } = core;
const DT = CFG.STEP;
const TAU = Math.PI * 2;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/* ---------- 小工具 ---------- */
const fresh = (seed = 1, W = 340, H = 276, extra = {}) => core.createGame(Object.assign({ W, H, seed }, extra));
const ref = (s) => (s.floors.length ? s.floors[s.floors.length - 1] : s.found);
const center = (r) => r.x + r.w / 2;
// 讓放下位置剛好是 x（step 先用目前吊鉤位置放下，再往前擺）
function dropAt(s, x) {
  const u = Math.max(-1, Math.min(1, (x - s.W / 2) / s.m.amp));
  s.phi = Math.asin(u); core.hook(s);
  core.step(s, DT, { drop: true });
  assert.equal(s.ph === 'fall' || s.over || s.ph === 'wait', true, `沒有放下：${s.ph}`);
  const rel = s.cur ? s.cur.x : null;
  let n = 0;
  while (s.ph === 'fall' && n++ < 600) core.step(s, DT, {});
  return rel;
}
function waitSwing(s) { let n = 0; while (s.ph === 'wait' && n++ < 600) core.step(s, DT, {}); }
function gauss(r) { let u = 0; while (u === 0) u = core.rand(r); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * core.rand(r)); }
// 模擬真人：挑 react 秒之後的第一個「吊鉤經過塔頂中心」的時機，再加上 sigma 秒的手感誤差
function bot(seed, sigma, { W = 340, H = 276, react = 0.35, maxT = 400 } = {}) {
  const s = core.createGame({ W, H, seed }), r = core.createGame({ seed: seed * 31 + 7 });
  while (!s.over && s.t < maxT) {
    if (s.ph !== 'swing') { core.step(s, DT, {}); continue; }
    const m = s.m, a = Math.asin(Math.max(-1, Math.min(1, (center(ref(s)) - W / 2) / m.amp))), om = core.speed(s) / m.amp;
    let best = Infinity;
    for (const c of [a, Math.PI - a]) for (let k = 0; k < 3; k++) {
      const t = ((((c - s.phi) % TAU) + TAU) % TAU + k * TAU) / om;
      if (t >= react && t < best) best = t;
    }
    const n = Math.max(0, Math.round((best + sigma * gauss(r)) / DT));
    for (let i = 0; i < n && !s.over; i++) core.step(s, DT, {});
    core.step(s, DT, { drop: true });
  }
  return s;
}

/* ---------- 亂數 ---------- */
test('rand：同種子同序列、不同種子不同、值域 [0,1)', () => {
  const a = core.createGame({ seed: 42 }), b = core.createGame({ seed: 42 }), c = core.createGame({ seed: 43 });
  const sa = [], sb = [], sc = [];
  for (let i = 0; i < 200; i++) { sa.push(core.rand(a)); sb.push(core.rand(b)); sc.push(core.rand(c)); }
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  assert.ok(sa.every((v) => v >= 0 && v < 1));
  const mean = sa.reduce((x, y) => x + y, 0) / sa.length;
  assert.ok(mean > 0.4 && mean < 0.6, `平均 ${mean}`);
});

/* ---------- 版面 ---------- */
test('metrics：各種寬高下，樓高、擺幅、吊點與塔頂位置都合理（掛著的樓層不會撞到塔頂）', () => {
  for (const W of [140, 240, 282, 320, 340, 400, 520, 680, 1000, 1600]) {
    for (const H of [120, 150, 200, 236, 276, 300, 360, 420]) {
      const m = core.metrics(W, H);
      assert.ok(m.fh >= 16 && m.fh <= 28, `fh ${m.fh}`);
      assert.ok(m.baseW >= 110 && m.baseW <= 200 && m.baseW <= W, `baseW ${m.baseW} W ${W}`);
      assert.ok(m.amp >= 30 && m.amp <= Math.max(30, W / 2 - 8), `amp ${m.amp} W ${W}`);
      assert.ok(m.rope > m.amp * 2, '繩長要比擺幅長（鐘擺）');
      assert.ok(m.tol > 0 && m.tol < 10);
      assert.equal(m.gy, H - CFG.GROUND_H);
      if (W >= 200) assert.ok(W / 2 + m.amp + m.baseW / 2 <= W - 4 + 1e-9, `W${W}：擺到最旁邊時樓層還在畫面內`);
      if (H >= 196) {
        assert.ok(m.hangY + m.fh + m.fh <= m.topY, `W${W} H${H}：掛著的樓層與塔頂之間至少隔一層樓高`);
        assert.ok(m.topY < m.gy - m.fh * 2, `W${W} H${H}：塔頂下方至少看得到兩層`);
      }
      // 擺到最旁邊會抬高 rope - √(rope² - amp²)；樓層上緣仍在角落膠囊（底約 33px）下面
      if (H >= 236) assert.ok(m.hangY - (m.rope - Math.sqrt(m.rope ** 2 - m.amp ** 2)) >= 34, `W${W} H${H}：擺到最旁邊不會鑽到角落膠囊底下`);
    }
  }
  // 手機（320～430px 寬、頁面高 276）：起始寬約 4 成，擺幅比起始寬小，第一層不會一放就整塊落空
  for (const W of [282, 320, 375, 430]) {
    const m = core.metrics(W, 276);
    assert.ok(m.amp < m.baseW, `W${W} amp ${m.amp} < baseW ${m.baseW}`);
  }
});

test('createGame：初始狀態、最小尺寸夾限、地基置中、一開始就有一層吊在一側', () => {
  const s = core.createGame({ W: 10, H: 10, seed: 1 });
  assert.equal(s.W, CFG.MIN_W);
  assert.equal(s.H, CFG.MIN_H);
  const t = fresh(3);
  assert.equal(t.floors.length, 0);
  assert.equal(t.points, 0);
  assert.equal(t.over, false);
  assert.equal(t.ph, 'swing');
  assert.equal(t.cam, 0);
  assert.ok(Math.abs(center(t.found) - t.W / 2) < 1e-9, '地基置中');
  assert.equal(t.found.w, t.m.baseW);
  assert.equal(t.cur.w, t.found.w, '第一層跟地基一樣寬');
  assert.ok(Math.abs(Math.abs(t.hx - t.W / 2) - t.m.amp) < 1e-6, '從擺幅的一端開始');
  assert.ok(finite(t.hy) && t.hy < t.m.hangY, '擺到一端時會微微抬高');
  const sides = new Set();
  for (let seed = 1; seed <= 20; seed++) sides.add(Math.sign(fresh(seed).hx - 170));
  assert.equal(sides.size, 2, '左右兩側都會出現');
});

/* ---------- 擺盪 ---------- */
test('擺盪：左右都在擺幅內、正中間最低、會來回、速度隨層數變快且有上限、減少動態時較慢', () => {
  const s = fresh(5);
  let minX = Infinity, maxX = -Infinity, lowY = -Infinity, flips = 0, prev = s.hx, dir = 0;
  for (let i = 0; i < 60 * 12; i++) {
    core.step(s, DT, {});
    minX = Math.min(minX, s.hx); maxX = Math.max(maxX, s.hx); lowY = Math.max(lowY, s.hy);
    const d = Math.sign(s.hx - prev); if (d && dir && d !== dir) flips++; if (d) dir = d; prev = s.hx;
  }
  assert.ok(minX >= s.W / 2 - s.m.amp - 1e-6 && maxX <= s.W / 2 + s.m.amp + 1e-6);
  assert.ok(maxX - minX > s.m.amp * 1.9, '真的有擺到兩邊');
  assert.ok(Math.abs(lowY - s.m.hangY) < 0.5, `正中間在 hangY：${lowY}`);
  assert.ok(flips >= 3, `12 秒內至少來回幾次：${flips}`);
  // 速度：單調、有上限
  let pv = 0;
  for (let n = 0; n <= 200; n++) {
    const t = fresh(1); t.floors = Array.from({ length: n }, () => ({ x: 0, w: 10, lit: 0, b: false }));
    const v = core.speed(t);
    assert.ok(v >= pv - 1e-12, `n=${n}`); pv = v;
    assert.ok(v <= CFG.VMAX * t.m.scale + 1e-9);
  }
  const a = fresh(1), b = fresh(1, 340, 276, { calm: true });
  assert.ok(Math.abs(core.speed(b) / core.speed(a) - CFG.CALM) < 1e-12, '減少動態：擺盪變慢');
  // 起點夠慢、上限玩得了：最快時，一來一回仍要 2 秒以上（擺幅不變）
  const top = fresh(1); top.floors = Array.from({ length: 999 }, () => ({ x: 0, w: 10 }));
  assert.ok(TAU * top.m.amp / core.speed(top) >= 2, `最快週期 ${(TAU * top.m.amp / core.speed(top)).toFixed(2)}s`);
  assert.ok(TAU * a.m.amp / core.speed(a) >= 4, '一開始很慢');
});

/* ---------- 判定 ---------- */
test('judge：完美（誤差 ≤ tol 不切、對齊）、切掉超出（左右兩邊）、完全沒疊到', () => {
  const tol = 5;
  let j = core.judge(100, 120, 103, 120, tol);
  assert.deepEqual([j.kind, j.x, j.w, j.cw], ['perfect', 100, 120, 0]);
  j = core.judge(100, 120, 95, 120, tol);
  assert.equal(j.kind, 'perfect', '剛好 5px 也算');
  j = core.judge(100, 120, 94.9, 120, tol);
  assert.equal(j.kind, 'cut');
  j = core.judge(100, 120, 130, 120, tol);       // 偏右 30
  assert.deepEqual([j.kind, j.x, j.w, j.cx, j.cw], ['cut', 130, 90, 220, 30]);
  j = core.judge(100, 120, 60, 120, tol);        // 偏左 40
  assert.deepEqual([j.kind, j.x, j.w, j.cx, j.cw], ['cut', 100, 80, 60, 40]);
  assert.equal(core.judge(100, 120, 220, 120, tol).kind, 'miss', '剛好碰到邊不算疊到');
  assert.equal(core.judge(100, 120, -40, 120, tol).kind, 'miss');
  assert.equal(core.judge(100, 120, 219.7, 120, tol).kind, 'miss', '重疊不到 0.5px 算沒疊到');
  assert.equal(core.judge(100, 120, 216, 120, tol).kind, 'miss', '只剩 4px（比完美容許誤差還窄的一根針）也算沒疊到');
  assert.equal(core.judge(100, 120, 214, 120, tol).kind, 'cut', '剩 6px 還算疊到');
  for (let d = -130; d <= 130; d += 0.7) {
    const q = core.judge(50, 100, 50 + d, 100, 4);
    if (q.kind === 'cut') { assert.ok(Math.abs(q.w + q.cw - 100) < 1e-9); assert.ok(q.x >= 50 - 1e-9 && q.x + q.w <= 150 + 1e-9); }
  }
});

test('計分與級距：一般 10 分；完美 +5×連擊（最多 +30）；scoreBucket 單調 0～9', () => {
  assert.equal(core.scoreFor(false, 0), 10);
  assert.equal(core.scoreFor(false, 5), 10);
  assert.equal(core.scoreFor(true, 1), 15);
  assert.equal(core.scoreFor(true, 3), 25);
  assert.equal(core.scoreFor(true, 999), 40);
  let prev = 0;
  for (let n = -5; n <= 300; n++) {
    const b = core.scoreBucket(n);
    assert.ok(Number.isInteger(b) && b >= 0 && b <= 9);
    if (n >= 0) { assert.ok(b >= prev); prev = b; }
  }
  assert.equal(core.scoreBucket(0), 0);
  assert.equal(core.scoreBucket(1e9), 9);
  assert.equal(core.scoreBucket(NaN), 0);
  assert.equal(core.SCORE_BUCKETS.length, 10);
});

/* ---------- 固定時間步長 ---------- */
test('fixedSteps：累積、單格上限 5 步、丟棄積欠、壞值安全', () => {
  assert.deepEqual(core.fixedSteps(0, 0), { n: 0, acc: 0 });
  assert.equal(core.fixedSteps(0, 1 / 60).n, 1);
  assert.equal(core.fixedSteps(0, 1 / 30).n, 2);
  let r = core.fixedSteps(0, 0.01); assert.equal(r.n, 0);
  r = core.fixedSteps(r.acc, 0.01); assert.equal(r.n, 1);
  assert.ok(r.acc >= 0 && r.acc < DT);
  r = core.fixedSteps(0, 1);
  assert.equal(r.n, CFG.MAX_STEPS);
  assert.equal(r.acc, 0);
  for (const bad of [NaN, -1, undefined, Infinity]) {
    const x = core.fixedSteps(0, bad);
    assert.ok(Number.isInteger(x.n) && x.n >= 0 && x.n <= CFG.MAX_STEPS && x.acc >= 0, String(bad));
  }
  let acc = 0, total = 0;
  for (let i = 0; i < 600; i++) { const q = core.fixedSteps(acc, 1 / 144 * (i % 2 ? 1.1 : 0.9)); acc = q.acc; total += q.n; }
  assert.ok(Math.abs(total - 600 * (1 / 144) * 60) <= 2, `步數 ${total}`);
});

/* ---------- 放下、掉落、疊上 ---------- */
test('放下：只在擺盪中有效；掉落中、等下一層時按了不算，也不會排隊', () => {
  const s = fresh(7);
  core.step(s, DT, { drop: true });
  assert.equal(s.ph, 'fall');
  assert.equal(s.drops, 1);
  assert.equal(s.events.filter((e) => e.t === 'drop').length, 1);
  for (let i = 0; i < 5; i++) core.step(s, DT, { drop: true });
  assert.equal(s.drops, 1, '掉落中再按不算');
  let n = 0;
  while (s.ph === 'fall' && n++ < 600) core.step(s, DT, { drop: true });
  assert.equal(s.ph, 'wait');
  core.step(s, DT, { drop: true });
  assert.equal(s.drops, 1, '等下一層時按了不算');
  waitSwing(s);
  assert.equal(s.ph, 'swing');
  assert.equal(s.drops, 1, '沒有排隊自動放下');
  assert.ok(s.t - s.spawnT < DT * 2, '下一層剛掛上');
});

test('放下用「目前畫面上的吊鉤位置」（先放再擺，不會晚一步）；hook(s, a) 可以超前畫（插補用）', () => {
  const s = fresh(31);
  for (let i = 0; i < 30; i++) core.step(s, DT, {});
  const hx = s.hx, hy = s.hy, phi = s.phi;
  core.step(s, DT, { drop: true });
  assert.equal(s.ph, 'fall');
  assert.equal(s.cur.x, hx, '放下的 x 就是按下時吊鉤的 x');
  assert.ok(s.phi !== phi, '吊鉤照樣往前擺');
  assert.ok(s.cur.top <= s.m.gy - hy && s.cur.top > s.m.gy - hy - 2, '從按下時吊著的高度開始掉');
  const t = fresh(32), om = core.speed(t) / t.m.amp;
  core.hook(t, om * DT);
  const ahead = t.hx;
  core.hook(t);
  core.step(t, DT, {});
  assert.ok(Math.abs(t.hx - ahead) < 1e-9, '超前 a 弧度畫出來的位置＝下一步的位置');
  // 畫面把吊鉤畫在插補位置時（s.hx 被改成超前的位置），放下就用那個位置
  const v = fresh(33);
  core.hook(v, om * DT * 0.5);
  const shown = v.hx;
  core.step(v, DT, { drop: true });
  assert.equal(v.cur.x, shown);
});

test('亮燈與陽台在掛上時就抽好：吊著的那層有亮燈資料，落地後同一組（不換燈）', () => {
  const s = fresh(34);
  let lit = 0;
  for (let i = 0; i < 8; i++) {
    const c = s.cur;
    assert.ok(Number.isInteger(c.lit) && c.lit >= 0 && c.lit < 65536 && typeof c.b === 'boolean');
    lit |= c.lit;
    const want = [c.lit, c.b];
    dropAt(s, center(ref(s)));
    assert.deepEqual([ref(s).lit, ref(s).b], want, `第 ${i + 1} 層落地沿用同一組`);
    waitSwing(s);
  }
  assert.ok(lit > 0, '總有幾扇窗是亮的');
});

test('掉落：垂直掉、不左右飄、越掉越快；放下後約 0.2～0.6 秒落地', () => {
  const s = fresh(8);
  const rel = (s.phi = 0, core.step(s, DT, { drop: true }), s.cur.x);
  let n = 0, lastVy = 0;
  while (s.ph === 'fall') {
    assert.equal(s.cur.x, rel);
    assert.ok(s.cur.vy >= lastVy); lastVy = s.cur.vy;
    core.step(s, DT, {}); n++;
  }
  const t = n * DT;
  assert.ok(t > 0.2 && t < 0.6, `落地 ${t.toFixed(2)}s`);
});

test('對準（正中間）＝完美：不切、對齊、連擊 +1、完美分數；第一層是地基上的店面', () => {
  const s = fresh(9);
  dropAt(s, center(s.found));
  assert.equal(s.floors.length, 1);
  const f = s.floors[0];
  assert.equal(f.x, s.found.x, '對齊下面那層');
  assert.equal(f.w, s.found.w, '不切');
  assert.equal(s.combo, 1);
  assert.equal(s.perfects, 1);
  assert.equal(s.points, 15);
  const land = s.events.find((e) => e.t === 'land');
  assert.ok(land && land.perfect && land.n === 1 && land.combo === 1);
  assert.equal(s.events.filter((e) => e.t === 'cut').length, 0);
});

test('偏一點：留下重疊、切掉超出（事件帶切下的那塊）、連擊歸零、樓層變窄', () => {
  const s = fresh(10);
  const c0 = center(s.found), w0 = s.found.w;
  dropAt(s, c0 + 20);
  const f = s.floors[0];
  assert.ok(Math.abs(f.w - (w0 - 20)) < 1e-6, `寬 ${f.w}`);
  assert.ok(Math.abs(f.x - (s.found.x + 20)) < 1e-6);
  const cut = s.events.find((e) => e.t === 'cut');
  assert.ok(cut, 'cut 事件');
  assert.ok(Math.abs(cut.w - 20) < 1e-6 && Math.abs(cut.x - (s.found.x + w0)) < 1e-6 && cut.left === false);
  assert.equal(cut.y, CFG.FOUND_H, '切下的那塊從這層的高度開始掉');
  assert.equal(s.combo, 0);
  assert.equal(s.points, 10);
  waitSwing(s);
  assert.ok(Math.abs(s.cur.w - f.w) < 1e-9, '下一層跟著變窄');
  s.events.length = 0;
  dropAt(s, center(f) - 15);
  const c2 = s.events.find((e) => e.t === 'cut');
  assert.equal(c2.left, true, '偏左就切左邊');
  assert.ok(Math.abs(s.floors[1].x - f.x) < 1e-6);
});

test('完全沒疊到：遊戲結束（miss 與 over 各發一次）、結束後狀態凍結', () => {
  const s = fresh(11);
  dropAt(s, center(s.found) + 60);               // 先切掉一大塊（塔頂往右偏）
  waitSwing(s);
  const r = s.floors[0];
  assert.ok(Math.abs(center(r) - r.w - 2 - s.W / 2) < s.m.amp, '這個位置擺得到');
  dropAt(s, center(r) - r.w - 2);                // 整塊落在左邊旁邊
  assert.equal(s.over, true);
  assert.equal(s.ph, 'over');
  assert.equal(s.floors.length, 1);
  assert.equal(s.events.filter((e) => e.t === 'miss').length, 1);
  assert.equal(s.events.filter((e) => e.t === 'over').length, 1);
  const miss = s.events.find((e) => e.t === 'miss');
  assert.ok(miss.w > 0 && finite(miss.x) && finite(miss.y) && miss.vy > 0);
  const snap = JSON.stringify(s);
  core.step(s, DT, { drop: true }); core.step(s, DT, {});
  assert.equal(JSON.stringify(s), snap, '結束後不再動');
});

test('連續完美：連擊累加、分數越來越多；連 3 次起樓層加寬一點（不超過起始寬）', () => {
  const s = fresh(12);
  dropAt(s, center(s.found) + 30);               // 先切窄 30
  waitSwing(s);
  const w1 = s.floors[0].w, p0 = s.points;
  for (let i = 0; i < 3; i++) { dropAt(s, center(ref(s))); waitSwing(s); }
  assert.equal(s.combo, 3);
  assert.equal(s.maxCombo, 3);
  assert.equal(s.points - p0, 15 + 20 + 25);
  assert.equal(s.floors[1].w, w1, '第 1、2 次完美不加寬');
  assert.equal(s.floors[2].w, w1);
  assert.ok(Math.abs(s.floors[3].w - (w1 + CFG.GROW * s.m.scale)) < 1e-9, '第 3 次加寬');
  assert.ok(Math.abs(center(s.floors[3]) - center(s.floors[2])) < 1e-9, '往兩邊各加一半');
  for (let i = 0; i < 40; i++) { dropAt(s, center(ref(s))); waitSwing(s); }
  assert.ok(Math.abs(ref(s).w - s.found.w) < 1e-9, '最多回到起始寬');
  assert.ok(s.floors.every((f) => f.w <= s.found.w + 1e-9));
  dropAt(s, center(ref(s)) + 25);
  assert.equal(s.combo, 0, '沒對準就歸零');
  // 第 20 層以後連續完美不再加寬（不然手準的人永遠不會窄下來）
  assert.ok(s.floors.length >= CFG.GROW_MAX);
  waitSwing(s);
  const w2 = ref(s).w;
  for (let i = 0; i < 6; i++) { dropAt(s, center(ref(s))); waitSwing(s); }
  assert.equal(s.combo, 6);
  assert.equal(ref(s).w, w2, '超過 20 層：完美不加寬');
});

test('完美容許誤差：前 25 層固定；之後每層慢慢縮小，最少剩 4 成；落地判定用的是縮小後的值', () => {
  const s = fresh(21);
  const at = (n) => { s.floors = Array.from({ length: n }, () => ({ x: s.found.x, w: s.found.w, lit: 0, b: false })); return core.tolAt(s); };
  assert.equal(at(0), s.m.tol);
  assert.equal(at(25), s.m.tol);
  assert.ok(Math.abs(at(35) - s.m.tol * 0.75) < 1e-9);
  assert.ok(Math.abs(at(45) - s.m.tol * 0.5) < 1e-9);
  assert.ok(Math.abs(at(200) - s.m.tol * CFG.TOL_MIN) < 1e-9);
  let prev = Infinity;
  for (let n = 0; n < 120; n++) { const t = at(n); assert.ok(t <= prev + 1e-12 && t > 0); prev = t; }
  // 第 45 層：偏 3px（大於 0.5×tol=2.55px）就要切
  const g = fresh(22);
  g.floors = Array.from({ length: 45 }, () => ({ x: g.found.x, w: g.found.w, lit: 0, b: false }));
  g.cur.w = g.found.w;
  dropAt(g, center(g.found) + 3);
  assert.equal(g.combo, 0, '高樓層偏 3px 不再算完美');
  assert.ok(Math.abs(ref(g).w - (g.found.w - 3)) < 1e-6);
});

/* ---------- 畫面捲動 ---------- */
test('蓋高後畫面往上捲：塔頂停在 topY 附近；cam 不會變負數；減少動態時直接到位', () => {
  const s = fresh(13);
  for (let i = 0; i < 12; i++) { dropAt(s, center(ref(s))); waitSwing(s); }
  for (let i = 0; i < 120; i++) core.step(s, DT, {});
  const topScreen = s.m.gy - (core.towerTop(s) - s.cam);
  assert.ok(s.cam > 0);
  assert.ok(Math.abs(topScreen - s.m.topY) < 1, `塔頂在螢幕 ${topScreen}，目標 ${s.m.topY}`);
  const c = fresh(13, 340, 276, { calm: true });
  for (let i = 0; i < 12; i++) {
    dropAt(c, center(ref(c)));
    const target = Math.max(0, core.towerTop(c) - (c.m.gy - c.m.topY));
    assert.equal(c.cam, target, '減少動態：落地那一步就到位');
    waitSwing(c);
  }
  const f = fresh(14);
  for (let i = 0; i < 300; i++) { core.step(f, DT, {}); assert.ok(f.cam >= 0); }
  assert.equal(f.cam, 0, '還矮的時候不捲');
});

test('掛著的樓層永遠在塔頂上方（不會一掛上就卡進樓裡）', () => {
  for (const H of [200, 236, 276, 360]) {
    const s = fresh(15, 340, H);
    for (let i = 0; i < 25; i++) {
      waitSwing(s);
      const bottomWorld = s.cam + s.m.gy - s.hy - s.m.fh;
      assert.ok(bottomWorld > core.towerTop(s) + 4, `H${H} 第 ${i} 層：吊著的底 ${bottomWorld.toFixed(1)} > 塔頂 ${core.towerTop(s)}`);
      dropAt(s, center(ref(s)));
    }
  }
});

/* ---------- 難度與時間 ---------- */
test('一般玩家（手感誤差 50ms）：大約 30～90 秒、十幾到三十幾層自然結束', () => {
  const ts = [];
  for (let seed = 1; seed <= 10; seed++) {
    const s = bot(seed, 0.05);
    assert.ok(s.over, `seed ${seed} 沒結束`);
    assert.ok(s.floors.length >= 10 && s.floors.length <= 60, `seed ${seed} 蓋了 ${s.floors.length} 層`);
    ts.push(s.t);
  }
  ts.sort((a, b) => a - b);
  assert.ok(ts[0] >= 25 && ts[9] <= 95, `時間 ${ts.map((t) => t.toFixed(0)).join(',')}`);
  const med = ts[5];
  assert.ok(med >= 30 && med <= 75, `中位數 ${med.toFixed(0)}s`);
});

test('手很準的人（誤差 15ms）也會自然結束：一局中位數 < 150 秒，沒有拖到 5 分鐘以上的', () => {
  const ts = [];
  for (let seed = 1; seed <= 12; seed++) {
    const s = bot(seed, 0.015, { maxT: 600 });
    assert.ok(s.over, `seed ${seed} 玩了 ${s.t.toFixed(0)} 秒還沒結束（${s.floors.length} 層）`);
    ts.push(s.t);
  }
  ts.sort((a, b) => a - b);
  assert.ok(ts[6] < 150, `中位數 ${ts[6].toFixed(0)}s（${ts.map((t) => t.toFixed(0)).join(',')}）`);
  assert.ok(ts[11] < 300, `最長 ${ts[11].toFixed(0)}s`);
});

test('手越穩蓋越高（難度是公平的）；亂按的人很快結束；手機寬與桌機寬的難度差不多', () => {
  const avg = (sigma, opt) => { let n = 0; for (let seed = 1; seed <= 8; seed++) n += bot(seed, sigma, opt).floors.length; return n / 8; };
  const steady = avg(0.03), normal = avg(0.05), shaky = avg(0.1);
  assert.ok(steady > normal && normal > shaky, `${steady} > ${normal} > ${shaky}`);
  assert.ok(shaky >= 5, `手很不穩也能蓋幾層：${shaky}`);
  const phone = avg(0.05, { W: 282 }), desk = avg(0.05, { W: 680 });
  assert.ok(Math.abs(phone - desk) / normal < 0.25, `手機 ${phone}、桌機 ${desk}`);
  // 一掛上就放（完全不瞄）
  for (let seed = 1; seed <= 6; seed++) {
    const s = fresh(seed);
    while (!s.over && s.t < 120) core.step(s, DT, { drop: true });
    assert.ok(s.over && s.t < 60, `seed ${seed}：亂按 ${s.t.toFixed(0)}s、${s.floors.length} 層`);
  }
});

test('不放的人：邏輯層不會自己結束，就一直擺（30 秒沒放由畫面層結束這局）', () => {
  const s = fresh(16);
  for (let i = 0; i < 60 * 120; i++) core.step(s, DT, {});
  assert.equal(s.over, false);
  assert.equal(s.ph, 'swing');
  assert.ok(finite(s.phi) && Math.abs(s.phi) <= TAU, 'phi 不會無限累加');
});

/* ---------- 不變量、決定性、壞值 ---------- */
test('不變量：亂灌輸入 40 組種子與尺寸，狀態永遠合法', () => {
  for (let seed = 100; seed < 140; seed++) {
    const W = 200 + (seed % 5) * 120, H = 200 + (seed % 3) * 70;
    const s = core.createGame({ W, H, seed }), rng = core.createGame({ seed: seed * 7 + 1 });
    let lastPts = 0, lastN = 0;
    for (let i = 0; i < 60 * 200 && !s.over; i++) {
      core.step(s, DT * (0.5 + core.rand(rng) * 1.5), { drop: core.rand(rng) < 0.03 });
      s.events.length = 0;
      assert.ok(s.points >= lastPts); lastPts = s.points;
      assert.ok(s.floors.length >= lastN); lastN = s.floors.length;
      assert.ok(finite(s.cam) && s.cam >= 0);
      assert.ok(finite(s.hx) && s.hx >= W / 2 - s.m.amp - 1e-6 && s.hx <= W / 2 + s.m.amp + 1e-6);
      assert.ok(finite(s.hy));
      for (const f of s.floors) assert.ok(finite(f.x) && f.w > 0 && f.w <= s.found.w + 1e-9);
      if (s.cur) assert.ok(finite(s.cur.x) && finite(s.cur.top) && s.cur.w > 0);
      assert.ok(s.perfects <= s.floors.length && s.combo <= s.perfects);
    }
  }
});

test('決定性：同種子＋同輸入 → 完全相同的狀態', () => {
  const play = () => {
    const s = core.createGame({ W: 360, H: 276, seed: 777 });
    for (let i = 0; i < 60 * 60 && !s.over; i++) { core.step(s, DT, { drop: i % 97 === 0 }); s.events.length = 0; }
    return JSON.stringify(s);
  };
  assert.equal(play(), play());
});

test('step 對壞的 dt 安全：NaN／負數／0 不動；巨大 dt 被夾在 0.1 秒', () => {
  const s = fresh(50);
  const snap = JSON.stringify(s);
  for (const bad of [NaN, -1, 0, undefined, null, 'x']) core.step(s, bad, { drop: true });
  assert.equal(JSON.stringify(s), snap);
  core.step(s, 100, {});
  assert.ok(s.t <= 0.1 + 1e-12);
});

test('resize：寬度按起始寬的比例縮放並置中、樓高跟著新版面、遊戲不重來；尺寸沒變就不動；最小尺寸夾限', () => {
  const s = fresh(60, 400, 276);
  for (let i = 0; i < 4; i++) { dropAt(s, center(ref(s)) + (i % 2 ? 6 : -6)); waitSwing(s); }
  const n = s.floors.length, x0 = s.floors[1].x, w0 = s.floors[1].w, pts = s.points;
  const k = core.metrics(200, 236).baseW / core.metrics(400, 276).baseW;
  core.resize(s, 200, 236);
  assert.equal(s.W, 200);
  assert.equal(s.m.gy, 236 - CFG.GROUND_H);
  assert.equal(s.floors.length, n);
  assert.equal(s.points, pts);
  assert.ok(Math.abs(s.floors[1].x - (100 + (x0 - 200) * k)) < 1e-9 && Math.abs(s.floors[1].w - w0 * k) < 1e-9);
  assert.ok(Math.abs(s.found.w - s.m.baseW) < 1e-9, '地基寬跟新版面一致（比例不走樣）');
  assert.ok(Math.abs(center(s.found) - 100) < 1e-9, '重新置中');
  assert.ok(Math.abs(s.hx - s.W / 2) <= s.m.amp + 1e-9);
  const same = JSON.stringify(s);
  core.resize(s, 200, 236);
  assert.equal(JSON.stringify(s), same);
  core.resize(s, 20, 20);
  assert.equal(s.W, CFG.MIN_W);
  assert.equal(s.H, CFG.MIN_H);
  for (let i = 0; i < 600 && !s.over; i++) { core.step(s, DT, { drop: i % 50 === 0 }); s.events.length = 0; }
  assert.ok(finite(s.cam) && finite(s.hx));
});

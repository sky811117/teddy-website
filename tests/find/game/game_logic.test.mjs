// 守護小屋：純邏輯測試（node 內建 test runner，不連網、不用瀏覽器）
// 執行：node --test tests/find/
import test from 'node:test';
import assert from 'node:assert/strict';
import { requireClassic } from '../_helpers.mjs';

const { core } = requireClassic('public/js/wait-game.js');
const { CFG, FOES, FOE_KEYS } = core;
const DT = CFG.STEP;

/* ---------- 小工具 ---------- */
function fresh(seed = 1, W = 360, H = 236) {
  const s = core.createGame({ W, H, seed });
  s.spawnT = 1e9;                 // 預設不自動生成，讓每個測試自己擺怪
  return s;
}
function foe(type, x, y, extra = {}) {
  const sp = FOES[type];
  return Object.assign({ id: 0, type, bx: x, x, y, r: sp.r, age: 0, ph: 0, vy: 0, amp: 0, freq: 0, acc: 0, dead: false }, extra);
}
function run(s, seconds, inp) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n && !s.over; i++) core.step(s, DT, typeof inp === 'function' ? inp(s) : inp);
  return s;
}
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

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

test('createGame：初始值與最小尺寸夾限', () => {
  const s = core.createGame({ W: 10, H: 10, seed: 1 });
  assert.equal(s.W, 140);
  assert.equal(s.H, 120);
  assert.equal(s.gy, 120 - CFG.GROUND_H);
  assert.equal(s.hp, CFG.MAX_HP);
  assert.equal(s.score, 0);
  assert.equal(s.over, false);
  assert.equal(s.hx, 70);
});

/* ---------- 難度曲線 ---------- */
test('difficulty：只隨擊殺數緩升、有上下限、單調', () => {
  let prev = core.difficulty(0, 360, 236);
  for (let k = 1; k <= 400; k++) {
    const d = core.difficulty(k, 360, 236);
    assert.ok(d.interval <= prev.interval + 1e-12, `間隔不得變長 k=${k}`);
    assert.ok(d.speed >= prev.speed - 1e-12, `速度不得變慢 k=${k}`);
    assert.ok(d.maxAlive >= prev.maxAlive, `上限不得變少 k=${k}`);
    assert.ok(d.level >= prev.level);
    prev = d;
  }
  const end = core.difficulty(100000, 360, 236);
  assert.ok(end.interval >= 0.42 / 1.35 - 1e-9 && end.interval <= 1.25 / 0.8, '間隔下限');
  assert.ok(end.speed <= 132 * 1.3 + 1e-9, '速度上限');
  assert.ok(end.maxAlive <= 11, '同時上限');
  assert.ok(end.weights.roach <= 3);
  // 起點要夠緩：第一隻怪從掉落到地面至少 3 秒
  const d0 = core.difficulty(0, 360, 236);
  assert.ok((236 - CFG.GROUND_H) / (d0.speed * 1.15 * 1.1) >= 3, '起點太快');
  // 負數、NaN 不爆
  for (const bad of [-5, NaN, undefined, null]) {
    const d = core.difficulty(bad, 360, 236);
    assert.ok(finite(d.interval) && finite(d.speed) && finite(d.maxAlive));
  }
});

test('difficulty：越寬的場地，生成越密、同時越多（但有上限）', () => {
  const narrow = core.difficulty(0, 320, 236), wide = core.difficulty(0, 640, 236), huge = core.difficulty(0, 4000, 236);
  assert.ok(wide.interval < narrow.interval);
  assert.ok(wide.maxAlive >= narrow.maxAlive);
  assert.ok(huge.interval >= 0.42 / 1.35 - 1e-9 || core.difficulty(0, 4000, 236).interval > 0);
  assert.equal(huge.interval, core.difficulty(0, 9000, 236).interval, '寬度加成有上限');
});

test('pickType：邊界與權重 0 的種類不會被抽到', () => {
  const w = { mold: 3, leak: 3, termite: 2.5, roach: 1, noise: 1.5 };
  assert.equal(core.pickType(w, 0), 'mold');
  assert.equal(core.pickType(w, 0.9999999), 'noise');
  const only = { mold: 0, leak: 0, termite: 1, roach: 0, noise: 0 };
  for (let i = 0; i < 50; i++) assert.equal(core.pickType(only, i / 50), 'termite');
  const s = fresh(7);
  const seen = new Set();
  for (let i = 0; i < 400; i++) seen.add(core.pickType(core.difficulty(0, 360, 236).weights, core.rand(s)));
  assert.equal(seen.size, FOE_KEYS.length, '五種怪一開始就都會出現');
});

/* ---------- 計分 ---------- */
test('comboMult / scoreFor / scoreBucket', () => {
  assert.equal(core.comboMult(0), 1);
  assert.equal(core.comboMult(5), 1);
  assert.equal(core.comboMult(6), 1.5);
  assert.equal(core.comboMult(12), 2);
  assert.equal(core.comboMult(18), 2.5);
  assert.equal(core.comboMult(9999), 2.5, '倍率有上限');
  assert.equal(core.comboMult(-3), 1);
  assert.equal(core.scoreFor('mold', 0), 10);
  assert.equal(core.scoreFor('roach', 0), 20);
  assert.equal(core.scoreFor('termite', 6), 23);   // 15 × 1.5 四捨五入
  assert.equal(core.scoreFor('noise', 18), 63);    // 25 × 2.5
  let prev = 0;
  for (let sc = -10; sc <= 5000; sc++) {
    const b = core.scoreBucket(sc);
    assert.ok(Number.isInteger(b) && b >= 0 && b <= 9);
    assert.ok(b >= prev || sc < 0);
    if (sc >= 0) prev = b;
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
  // 兩個 10ms 湊成 1 步
  let r = core.fixedSteps(0, 0.01); assert.equal(r.n, 0);
  r = core.fixedSteps(r.acc, 0.01); assert.equal(r.n, 1);
  assert.ok(r.acc >= 0 && r.acc < DT);
  // 卡 1 秒：最多補 5 步，其餘丟掉
  r = core.fixedSteps(0, 1);
  assert.equal(r.n, CFG.MAX_STEPS);
  assert.equal(r.acc, 0);
  // 壞值
  for (const bad of [NaN, -1, undefined, Infinity]) {
    const x = core.fixedSteps(0, bad);
    assert.ok(Number.isInteger(x.n) && x.n >= 0 && x.n <= CFG.MAX_STEPS && x.acc >= 0, String(bad));
  }
  // 長時間平均：60fps 一秒 60 步
  let acc = 0, total = 0;
  for (let i = 0; i < 600; i++) { const q = core.fixedSteps(acc, 1 / 144 * (i % 2 ? 1.1 : 0.9)); acc = q.acc; total += q.n; }
  assert.ok(Math.abs(total - 600 * (1 / 144) * 60) <= 2, `步數 ${total}`);
});

/* ---------- 碰撞 ---------- */
test('hitBulletFoe：命中、擦邊、錯過、線段上緣下緣', () => {
  const f = foe('leak', 100, 100);                 // r=14 → 有效半徑約 14.4
  assert.ok(core.hitBulletFoe({ x: 100, y: 100 }, f));
  assert.ok(core.hitBulletFoe({ x: 100 + 13, y: 100 }, f));
  assert.ok(!core.hitBulletFoe({ x: 100 + 16, y: 100 }, f));
  assert.ok(core.hitBulletFoe({ x: 100, y: 100 + 12 }, f), '子彈尖端在怪下緣內側（線段 112..122）');
  assert.ok(!core.hitBulletFoe({ x: 100, y: 100 + 16 }, f), '尖端在怪下緣外側');
  assert.ok(core.hitBulletFoe({ x: 100, y: 100 - 20 }, f), '線段尾端（y+10）碰到怪的上緣（80..90）');
  assert.ok(!core.hitBulletFoe({ x: 100, y: 100 - 26 }, f), '線段 74..84 差一點');
  assert.ok(!core.hitBulletFoe({ x: 100, y: 300 }, f));
});

test('子彈不會穿過怪（最快一步位移 < 怪直徑）', () => {
  const step = CFG.BULLET_SPEED * DT * CFG.MAX_STEPS;      // 單幀最壞也只有 5 步
  assert.ok(CFG.BULLET_SPEED * DT + CFG.BULLET_LEN > 2 * 13 * 0.92 - 12, '一步不跨過整隻怪');
  const s = fresh(2);
  s.foes.push(foe('roach', s.hx, 80, { r: 13 }));
  s.bullets.push({ x: s.hx, y: 80 + CFG.BULLET_SPEED * DT + 5, dead: false });
  core.step(s, DT, {});
  assert.equal(s.kills, 1);
  assert.ok(step > 0);
});

/* ---------- 小屋移動與射擊 ---------- */
test('鍵盤移動：速度、左右夾限', () => {
  const s = fresh(3, 360);
  const x0 = s.hx;
  run(s, 0.25, { dir: 1 });
  assert.ok(s.hx > x0 + 50, '往右移動');
  run(s, 5, { dir: 1 });
  assert.equal(s.hx, 360 - (CFG.HOUSE_W / 2 + 3), '右牆停住');
  run(s, 5, { dir: -1 });
  assert.equal(s.hx, CFG.HOUSE_W / 2 + 3, '左牆停住');
});

test('指標移動：有最高速度、目標超出邊界會被夾住、不跳格', () => {
  const s = fresh(4, 360);
  s.hx = 100;
  core.step(s, DT, { targetX: 300 });
  const moved = s.hx - 100;
  assert.ok(moved > 0 && moved <= 360 * 2.2 * DT + 1e-9, `一步最多 ${360 * 2.2 * DT}`);
  run(s, 2, { targetX: 99999 });
  assert.equal(s.hx, 360 - (CFG.HOUSE_W / 2 + 3));
  run(s, 2, { targetX: -99999 });
  assert.equal(s.hx, CFG.HOUSE_W / 2 + 3);
  const before = s.hx;
  core.step(s, DT, { targetX: NaN, dir: 0 });
  assert.equal(s.hx, before, 'NaN 目標視為沒有目標');
});

test('射擊：冷卻、連發數、子彈上限、子彈出膛位置', () => {
  const s = fresh(5);
  core.step(s, DT, { fire: true });
  assert.equal(s.shots, 1);
  assert.equal(s.bullets[0].x, s.hx);
  assert.ok(Math.abs(s.bullets[0].y - (s.gy - CFG.HOUSE_H - CFG.BARREL_H - CFG.BULLET_SPEED * DT)) < 1e-9, '從炮管頂端出膛，同一步已飛一格');
  run(s, 1, { fire: true });
  const expected = Math.floor(1 / CFG.FIRE_CD) + 1;      // 約每 0.2 秒一發
  assert.ok(s.shots >= expected - 1 && s.shots <= expected + 2, `一秒發數 ${s.shots}`);
  const t = fresh(6);
  const big = Math.round(CFG.MAX_BULLETS * 3);
  for (let i = 0; i < big; i++) t.bullets.push({ x: 10, y: 10, dead: false });
  core.step(t, DT, { fire: true });
  assert.equal(t.shots, 0, '子彈滿了就不再發');
  const u = fresh(6);
  run(u, 1, { fire: false });
  assert.equal(u.shots, 0, '沒按就不發');
});

/* ---------- 擊殺、計分、連擊 ---------- */
test('擊殺：加分、連擊 +1、怪與子彈一起消失、發出 kill 事件', () => {
  const s = fresh(8);
  s.foes.push(foe('termite', s.hx, 60));
  s.bullets.push({ x: s.hx, y: 68, dead: false });
  core.step(s, DT, {});
  assert.equal(s.kills, 1);
  assert.equal(s.score, 15);
  assert.equal(s.combo, 1);
  assert.equal(s.foes.length, 0);
  assert.equal(s.bullets.length, 0);
  const ev = s.events.filter((e) => e.t === 'kill');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].pts, 15);
  assert.equal(ev[0].type, 'termite');
});

test('一顆子彈只打一隻（打最低的那隻）', () => {
  const s = fresh(9);
  const hi = foe('mold', s.hx, 60), lo = foe('mold', s.hx, 75);
  s.foes.push(hi, lo);
  s.bullets.push({ x: s.hx, y: 75, dead: false });
  core.step(s, DT, {});
  assert.equal(s.kills, 1);
  assert.equal(s.foes.length, 1);
  assert.ok(s.foes[0].y < 70, '留下的是上面那隻');
});

test('連擊倍率：第 7 隻起 ×1.5；漏掉一隻就歸零', () => {
  const s = fresh(10);
  for (let i = 0; i < 6; i++) {
    s.foes.push(foe('leak', s.hx, 60));
    s.bullets.push({ x: s.hx, y: 68, dead: false });
    core.step(s, DT, {});
  }
  assert.equal(s.score, 60);
  s.foes.push(foe('leak', s.hx, 60));
  s.bullets.push({ x: s.hx, y: 68, dead: false });
  core.step(s, DT, {});
  assert.equal(s.score, 60 + 15, '第 7 隻 10×1.5');
  // 漏一隻
  s.foes.push(foe('mold', 20, s.gy));
  core.step(s, DT, {});
  assert.equal(s.combo, 0);
  assert.equal(s.hp, CFG.MAX_HP - 1);
  s.foes.push(foe('leak', s.hx, 60));
  s.bullets.push({ x: s.hx, y: 68, dead: false });
  const before = s.score;
  core.step(s, DT, {});
  assert.equal(s.score - before, 10, '歸零後回到 ×1');
});

test('補強：每擊殺 25 隻 +1 屋況，最多回到滿', () => {
  const s = fresh(11);
  s.hp = 3;
  for (let i = 0; i < CFG.HEAL_EVERY; i++) {
    s.foes.push(foe('leak', s.hx, 60));
    s.bullets.push({ x: s.hx, y: 68, dead: false });
    core.step(s, DT, {});
  }
  assert.equal(s.kills, CFG.HEAL_EVERY);
  assert.equal(s.hp, 4);
  assert.ok(s.events.some((e) => e.t === 'heal'));
  const t = fresh(12);
  t.kills = CFG.HEAL_EVERY - 1;
  t.foes.push(foe('leak', t.hx, 60));
  t.bullets.push({ x: t.hx, y: 68, dead: false });
  core.step(t, DT, {});
  assert.equal(t.hp, CFG.MAX_HP, '已滿不超過上限');
});

/* ---------- 屋況與結束 ---------- */
test('掉到地面：屋況 -1、連擊歸零、怪移除', () => {
  const s = fresh(13);
  s.combo = 5;
  s.foes.push(foe('leak', 30, s.gy - 5));
  core.step(s, DT, {});
  assert.equal(s.hp, CFG.MAX_HP - 1);
  assert.equal(s.combo, 0);
  assert.equal(s.foes.length, 0);
  assert.equal(s.leaks, 1);
  assert.ok(s.events.some((e) => e.t === 'leak'));
});

test('撞到屋頂也算（屋頂是斜的：屋脊比屋簷高）', () => {
  const s = fresh(14);
  const top = s.gy - CFG.HOUSE_H;
  assert.equal(core.roofY(s, 0), top);
  assert.equal(core.roofY(s, CFG.HOUSE_W / 2), top + CFG.ROOF_DROP);
  assert.equal(core.roofY(s, 999), top + CFG.ROOF_DROP, '屋簷之外不再下降');
  s.foes.push(foe('mold', s.hx, top - 40));
  core.step(s, DT, {});
  assert.equal(s.hp, CFG.MAX_HP, '還在天上');
  s.foes.push(foe('mold', s.hx, top - 4));
  core.step(s, DT, {});
  assert.equal(s.hp, CFG.MAX_HP - 1, '碰到屋脊');
  const t = fresh(15);
  t.hx = 200;
  t.foes.push(foe('mold', 60, t.gy - 100));
  core.step(t, DT, {});
  assert.equal(t.hp, CFG.MAX_HP, '離小屋很遠的怪在空中不算');
});

test('屋況歸零：結束一次、事件只發一次、之後 step 不動', () => {
  const s = fresh(16);
  for (let i = 0; i < CFG.MAX_HP; i++) { s.foes.push(foe('mold', 20, s.gy)); core.step(s, DT, {}); }
  assert.equal(s.hp, 0);
  assert.equal(s.over, true);
  assert.equal(s.events.filter((e) => e.t === 'over').length, 1);
  const snap = JSON.stringify(s);
  core.step(s, DT, { fire: true, dir: 1 });
  core.step(s, DT, {});
  assert.equal(JSON.stringify(s), snap, '結束後狀態凍結');
});

test('同一步內多隻同時漏掉：屋況不會變負數，over 只發一次', () => {
  const s = fresh(17);
  s.hp = 1;
  for (let i = 0; i < 6; i++) s.foes.push(foe('mold', 20 + i * 40, s.gy));
  core.step(s, DT, {});
  assert.equal(s.hp, 0);
  assert.equal(s.events.filter((e) => e.t === 'over').length, 1);
});

/* ---------- 怪物行為 ---------- */
test('怪物不會超出左右邊界（含擺動的蟑螂與白蟻）', () => {
  for (const W of [200, 360, 640]) {
    const s = core.createGame({ W, H: 236, seed: 21 });
    s.spawnT = 0;
    for (let i = 0; i < 4000 && !s.over; i++) {
      core.step(s, DT, { targetX: s.foes.length ? s.foes[0].x : null, fire: true });
      for (const f of s.foes) assert.ok(f.x >= f.r + 2 - 1e-9 && f.x <= W - f.r - 2 + 1e-9, `W=${W} x=${f.x}`);
      s.events.length = 0;
    }
  }
});

test('噪音越掉越快；其他怪等速', () => {
  const a = fresh(22), b = fresh(22);
  a.foes.push(foe('noise', 100, 0, { vy: 40, acc: FOES.noise.acc }));
  b.foes.push(foe('leak', 100, 0, { vy: 40, acc: 0 }));
  run(a, 1.0, {}); run(b, 1.0, {});
  assert.ok(Math.abs(b.foes[0].y - 40) < 1.2, `等速 ${b.foes[0].y}`);
  assert.ok(a.foes[0].y > b.foes[0].y + 3, `噪音較快 ${a.foes[0].y}`);
  const t = fresh(23);
  t.foes.push(foe('noise', 100, -1e6, { vy: 40, acc: 0.3, age: 1e6 }));
  const y0 = t.foes[0].y;
  core.step(t, DT, {});
  assert.ok(t.foes[0].y - y0 <= 40 * 2.2 * DT + 1e-9, '加速倍率有上限 2.2');
});

test('生成：不超過同時上限、x 在場內、剛生成的怪彼此不重疊', () => {
  const s = core.createGame({ W: 360, H: 236, seed: 31 });
  let maxSeen = 0;
  for (let i = 0; i < 60 * 40 && !s.over; i++) {
    core.step(s, DT, { fire: false });
    s.hp = CFG.MAX_HP;               // 不讓它結束，專測生成
    s.over = false;
    maxSeen = Math.max(maxSeen, s.foes.length);
    for (const f of s.foes) { assert.ok(f.x > 0 && f.x < 360); assert.ok(finite(f.y)); }
    s.events.length = 0;
  }
  assert.ok(maxSeen <= core.difficulty(0, 360, 236).maxAlive, `同時 ${maxSeen}`);
  assert.ok(maxSeen >= 2, '有在生成');
});

test('不開火的人，約 8～20 秒內結束；開場至少有 5 秒緩衝', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const s = core.createGame({ W: 360, H: 236, seed });
    let t = 0;
    while (!s.over && t < 60) { core.step(s, DT, {}); s.events.length = 0; t += DT; }
    assert.ok(s.over, `seed ${seed} 沒結束`);
    assert.ok(t >= 5 && t <= 22, `seed ${seed} 結束於 ${t.toFixed(1)}s`);
  }
});

function bot(seed, W, mode, react, maxT) {
  const s = core.createGame({ W, H: 236, seed });
  let t = 0, tgt = null, nl = 0;
  while (!s.over && t < maxT) {
    if (t >= nl) {
      nl = t + react;
      let low = null;
      for (const f of s.foes) { if (f.y < 24) continue; if (!low || f.y > low.y) low = f; }
      tgt = low ? low.x : null;
    }
    const inp = { dir: 0, targetX: null, fire: false };
    if (mode === 'key' && tgt != null) { const d = tgt - s.hx; inp.dir = Math.abs(d) < 6 ? 0 : (d > 0 ? 1 : -1); inp.fire = Math.abs(d) < 14; }
    if (mode === 'touch') { inp.fire = true; if (tgt != null) inp.targetX = s.hx + Math.max(-10, Math.min(10, tgt - s.hx)); }
    core.step(s, DT, inp); s.events.length = 0; t += DT;
  }
  return { s, t };
}

test('有在瞄準的人明顯比不動的人活得久，分數也更高（難度合理）', () => {
  let better = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const { s, t } = bot(seed, 360, 'key', 0.25, 400);
    assert.ok(s.score > 300, `seed ${seed} 分數 ${s.score}`);
    if (t > 40) better++;
  }
  assert.equal(better, 6, '鍵盤玩家（反應 0.25 秒）都該撐過 40 秒');
});

test('難度確實會把鍵盤玩家逼到結束（不是無限過關）', () => {
  let ended = 0;
  for (let seed = 1; seed <= 6; seed++) if (bot(seed, 360, 'key', 0.25, 400).s.over) ended++;
  assert.ok(ended >= 5, `結束 ${ended}/6`);
});

/* ---------- 不變量（亂灌輸入）---------- */
test('不變量：亂灌輸入 40 組種子，狀態永遠合法', () => {
  for (let seed = 100; seed < 140; seed++) {
    const W = 200 + (seed % 5) * 120, H = 200 + (seed % 3) * 60;
    const s = core.createGame({ W, H, seed });
    const rng = core.createGame({ seed: seed * 7 + 1 });
    let lastScore = 0;
    for (let i = 0; i < 60 * 90 && !s.over; i++) {
      const r = core.rand(rng);
      const inp = { dir: r < 0.3 ? -1 : r < 0.6 ? 1 : 0, targetX: r > 0.9 ? core.rand(rng) * W * 1.4 - W * 0.2 : null, fire: core.rand(rng) < 0.5 };
      core.step(s, DT * (0.5 + core.rand(rng) * 1.5), inp);
      s.events.length = 0;
      assert.ok(s.hp >= 0 && s.hp <= CFG.MAX_HP);
      assert.ok(s.score >= lastScore); lastScore = s.score;
      assert.ok(finite(s.hx) && s.hx >= CFG.HOUSE_W / 2 + 3 - 1e-9 && s.hx <= W - CFG.HOUSE_W / 2 - 3 + 1e-9);
      assert.ok(s.bullets.length <= CFG.MAX_BULLETS);
      assert.ok(s.foes.every((f) => finite(f.x) && finite(f.y) && !f.dead));
      assert.ok(s.kills <= s.shots, '擊殺數不可能多於發射數');
    }
  }
});

test('決定性：同種子＋同輸入 → 完全相同的狀態', () => {
  const play = () => {
    const s = core.createGame({ W: 360, H: 236, seed: 777 });
    for (let i = 0; i < 60 * 30 && !s.over; i++) {
      core.step(s, DT, { dir: (Math.floor(i / 40) % 3) - 1, fire: i % 7 < 4 });
      s.events.length = 0;
    }
    return JSON.stringify(s);
  };
  assert.equal(play(), play());
});

test('step 對壞的 dt 安全：NaN／負數／0 不動；巨大 dt 被夾在 0.1 秒', () => {
  const s = fresh(50);
  const snap = JSON.stringify(s);
  for (const bad of [NaN, -1, 0, undefined, null, 'x']) core.step(s, bad, { fire: true });
  assert.equal(JSON.stringify(s), snap);
  core.step(s, 100, {});
  assert.ok(s.t <= 0.1 + 1e-12);
});

test('resize：位置按比例縮放、小屋不出界、不重來', () => {
  const s = fresh(60, 400, 240);
  s.foes.push(foe('leak', 200, 90), foe('roach', 380, 30, { r: 13 }));
  s.bullets.push({ x: 300, y: 100, dead: false });
  s.hx = 380;
  core.resize(s, 200, 180);
  assert.equal(s.W, 200);
  assert.equal(s.gy, 180 - CFG.GROUND_H);
  assert.equal(s.foes[0].x, 100);
  assert.ok(s.hx <= 200 - CFG.HOUSE_W / 2 - 3 + 1e-9);
  assert.ok(Math.abs(s.foes[0].y - 90 * (150 / 210)) < 1e-9);
  assert.equal(s.bullets[0].x, 150);
  const same = JSON.stringify(s);
  core.resize(s, 200, 180);
  assert.equal(JSON.stringify(s), same, '尺寸沒變就不動');
  core.resize(s, 20, 20);
  assert.equal(s.W, 140, '最小寬度夾限');
});

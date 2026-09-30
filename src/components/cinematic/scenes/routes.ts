/**
 * 場景 routes（垃圾車頁）：傍晚光軌。
 * 斜斜往遠方延伸的街道網格（透視），車燈像長時間曝光一樣拉成光軌在街上流動（暖橙、琥珀、奶油白）；
 * 一條清運路線上的站牌隨著一顆琥珀色的車燈一站一站依序亮起，
 * 下一站的地面上有一圈倒數圓環（刻度＋進度弧），車到站時圓環走滿、站牌亮起，再移到下一站。
 * 街道、路燈先畫進一張快取圖（尺寸或深淺色變了才重畫），每格只畫光軌、路線、站牌、圓環。
 */
import type { Scene, Stage } from "../cine-stage";

type Trail = { f: number; c: number; dir: number; lo: number; hi: number; v: number; len: number; ph: number; col: number };
type Pt = [number, number];

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (t: number, a: number, b: number) => {
  const x = clamp((t - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};

export default function routes(s: Stage): Scene {
  let hy = 0; // 地平線（在主視覺上緣之外）
  let FH = 1;
  let kz = 0.001;
  let D = 1000; // 地面往遠方延伸的深度
  let cx = 0;
  let B = 100; // 一個街廓
  let ca = 1;
  let sa = 0;
  let trails: Trail[] = [];
  let path: Pt[] = [];
  let cum: number[] = [];
  let stops: { d: number; arr: number; dep: number; ring: boolean }[] = [];
  let C = 20; // 一輪的秒數
  let endT = 0;
  let vt = 60; // 車速
  let cache: HTMLCanvasElement | null = null;
  const PAD = 18;
  // 顏色
  let halo: string[] = [];
  let core = "";
  let tip = ""; // 光軌車頭的顏色（淺色不能用白：米色底上看不到）
  let routeCol = "";
  let lit = "";

  /** 地面 (gx, gy) → 螢幕 [x, y, 比例] */
  const P = (gx: number, gy: number): [number, number, number] => {
    const z = 1 + gy * kz;
    return [cx + gx / z, hy + FH / z, 1 / z];
  };
  /** 旋轉後的街道座標 (a, b) → 地面 (gx, gy) */
  const G = (a: number, b: number): Pt => [a * ca - b * sa, a * sa + b * ca];
  /** 路線上距離 d 的地面位置 */
  const along = (d: number): Pt => {
    let k = 1;
    while (k < cum.length - 1 && cum[k] < d) k++;
    const d0 = cum[k - 1];
    const seg = cum[k] - d0 || 1;
    const q = clamp((d - d0) / seg, 0, 1);
    const a = path[k - 1];
    const b = path[k];
    return [a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q];
  };
  /** 一條街（直線 a 或 b 固定）在畫面裡看得到的那一段（Cyrus–Beck 裁切到梯形地面） */
  const clip = (f: number, c: number, poly: Pt[]): [number, number] | null => {
    // 線：f=0 → a=c、沿 b 走；f=1 → b=c、沿 a 走。參數＝另一個座標
    const p0 = f ? G(0, c) : G(c, 0);
    const d = f ? G(1, 0) : G(0, 1);
    let lo = -1e6;
    let hi = 1e6;
    for (let i = 0; i < poly.length; i++) {
      const e0 = poly[i];
      const e1 = poly[(i + 1) % poly.length];
      // 梯形頂點逆時針 → 內法線
      const nx = -(e1[1] - e0[1]);
      const ny = e1[0] - e0[0];
      const num = nx * (p0[0] - e0[0]) + ny * (p0[1] - e0[1]);
      const den = nx * d[0] + ny * d[1];
      if (Math.abs(den) < 1e-9) {
        if (num < 0) return null;
        continue;
      }
      const tt = -num / den;
      if (den > 0) lo = Math.max(lo, tt);
      else hi = Math.min(hi, tt);
    }
    return hi > lo ? [lo, hi] : null;
  };
  const onLine = (f: number, c: number, u: number, off: number): Pt => {
    const p = f ? G(u, c + off) : G(c + off, u);
    return p;
  };

  const sc: Scene = {
    still: 0,
    guard: 0.66,
    layout() {
      const w = s.w;
      const h = s.h;
      const rnd = s.rng(7713);
      // 從高處斜看下去：地平線在畫面上方很遠（遠處只縮到約 0.7 倍，街廓、圓環不會被壓得太扁）
      hy = -2.2 * h;
      FH = h * 1.02 - hy;
      kz = 0.72 / FH;
      D = (FH / (-0.1 * h - hy) - 1) / kz;
      cx = w / 2;
      const al = 0.42;
      ca = Math.cos(al);
      sa = Math.sin(al);
      B = s.split ? clamp(h * 0.3, 90, 140) : clamp(w * 0.26, 80, 130);
      // 看得到的地面（梯形，逆時針）
      const m = 40;
      const zn = 1 + -0.06 * h * kz;
      const zf = 1 + D * kz;
      const poly: Pt[] = [
        [-(w / 2 + m) * zn, -0.06 * h],
        [(w / 2 + m) * zn, -0.06 * h],
        [(w / 2 + m) * zf, D],
        [-(w / 2 + m) * zf, D],
      ];
      // 街道範圍（旋轉後座標）
      let amin = 1e9;
      let amax = -1e9;
      let bmin = 1e9;
      let bmax = -1e9;
      for (const [gx, gy] of poly) {
        const a = gx * ca + gy * sa;
        const b = -gx * sa + gy * ca;
        amin = Math.min(amin, a);
        amax = Math.max(amax, a);
        bmin = Math.min(bmin, b);
        bmax = Math.max(bmax, b);
      }
      const lines: { f: number; c: number; r: [number, number] }[] = [];
      for (let i = Math.ceil(amin / B); i <= Math.floor(amax / B); i++) {
        const r = clip(0, i * B, poly);
        if (r) lines.push({ f: 0, c: i * B, r });
      }
      for (let j = Math.ceil(bmin / B); j <= Math.floor(bmax / B); j++) {
        const r = clip(1, j * B, poly);
        if (r) lines.push({ f: 1, c: j * B, r });
      }

      // 光軌：隨機挑街道、方向、車道、速度、長度（長時間曝光＝拉很長）
      const n = w < 640 ? 18 : w < 1024 ? 26 : 36;
      trails = [];
      for (let k = 0; k < n && lines.length; k++) {
        const L = lines[Math.floor(rnd() * lines.length)];
        const dir = rnd() < 0.5 ? 1 : -1;
        trails.push({
          f: L.f,
          c: L.c,
          dir,
          lo: L.r[0],
          hi: L.r[1],
          v: B * (0.9 + rnd() * 1.4),
          len: B * (1.3 + rnd() * 2.2),
          ph: rnd() * 5000,
          col: dir > 0 ? (rnd() < 0.7 ? 0 : 1) : rnd() < 0.5 ? 2 : 1,
        });
      }

      // 清運路線：以焦點附近的路口為中心，走 5 個街廓、轉 3 個彎
      const z = FH / Math.max(1, s.fy - hy);
      const gy = (z - 1) / kz;
      const gx = (s.fx - cx) * z;
      const af = Math.round((gx * ca + gy * sa) / B);
      const bf = Math.round((-gx * sa + gy * ca) / B);
      const way: Pt[] = s.split
        ? [[-2, 1], [-2, 0], [0, 0], [0, -1], [2, -1]]
        : [[-1, 1], [-1, 0], [1, 0], [1, -1]];
      path = way.map(([i, j]) => G((af + i) * B, (bf + j) * B));
      cum = [0];
      for (let k = 1; k < path.length; k++)
        cum.push(cum[k - 1] + Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]));
      const total = cum[cum.length - 1];
      const fr = s.split ? [0.1, 0.3, 0.5, 0.7, 0.9] : [0.12, 0.4, 0.65, 0.9];
      // 時刻表：車速固定、每站停一下
      vt = B / 1.35;
      let time = 0.9;
      let d = 0;
      stops = fr.map(q => {
        const sd = total * q;
        const arr = time + (sd - d) / vt;
        time = arr + 1.1;
        d = sd;
        return { d: sd, arr, dep: time, ring: true };
      });
      // 倒數圓環會壓到字的那幾站不畫圓環（1440 淺色實測圓環弧線壓在副標「收。」上）：
      // 圓環外緣（含刻度）離字、搜尋卡要 ≥ 24px；全部都會壓到就只留離字最遠的那一站
      const room = stops.map(st => {
        const c = along(st.d);
        const [x, y, k] = P(c[0], c[1]);
        const rr = B * 0.58 * 1.3 * k;
        let d = 1e9;
        for (let i = 0; i < 12; i++) {
          const th = (i / 12) * 6.2832;
          d = Math.min(d, s.gap(x + Math.cos(th) * rr, y + Math.sin(th) * rr * 0.62));
        }
        return d;
      });
      stops.forEach((st, k) => (st.ring = room[k] >= 24));
      if (!stops.some(st => st.ring)) stops[room.indexOf(Math.max(...room))].ring = true;
      endT = time + (total - d) / vt;
      C = endT + 3.2;
      // 靜態畫面：開往最後一站的路上（前面幾站已亮、倒數圓環走到六成）
      const sa2 = stops[stops.length - 2].dep;
      sc.still = sa2 + (stops[stops.length - 1].arr - sa2) * 0.62;
      cache = null;
      buildCache(lines);
    },
    paint() {
      const L = s.light;
      halo = L ? ["226,146,58", "208,122,40", "232,160,80"] : ["255,214,150", "255,176,84", "255,140,60"];
      core = L ? "255,250,238" : "255,246,226";
      tip = L ? "200,102,30" : core;
      routeCol = L ? "150,92,36" : "255,214,160";
      lit = L ? "214,130,40" : "255,196,112";
      cache = null;
      buildCache();
    },
    frame(t) {
      const g = s.g;
      const L = s.light;
      const ox = -s.px * 12;
      const oy = -s.py * 6;
      g.save();
      g.translate(ox, oy);
      if (cache) g.drawImage(cache, -PAD, -PAD, s.w + PAD * 2, s.h + PAD * 2);

      // 車燈光軌
      g.globalCompositeOperation = L ? "source-over" : "lighter";
      g.lineCap = "round";
      const fade = smooth(t, 0, 1.2);
      for (const tr of trails) {
        const span = tr.hi - tr.lo + tr.len;
        const head = (tr.ph + t * tr.v) % span;
        const sh = tr.dir > 0 ? tr.lo + head : tr.hi - head;
        const st = sh - tr.dir * tr.len;
        const a = clamp(sh, tr.lo, tr.hi);
        const b = clamp(st, tr.lo, tr.hi);
        if (Math.abs(a - b) < 1) continue;
        const off = tr.dir * B * 0.06;
        const ph = onLine(tr.f, tr.c, a, off);
        const pt = onLine(tr.f, tr.c, b, off);
        const [x1, y1, k1] = P(ph[0], ph[1]);
        const [x0, y0] = P(pt[0], pt[1]);
        const hc = halo[tr.col];
        const gr = g.createLinearGradient(x0, y0, x1, y1);
        gr.addColorStop(0, `rgba(${hc},0)`);
        gr.addColorStop(0.6, `rgba(${hc},0.45)`);
        gr.addColorStop(1, `rgba(${hc},1)`);
        g.strokeStyle = gr;
        // 淺色：外層光暈 8px、0.35；光芯深橙 #c8661e 2px（原本白色光芯在米色底上看不出來，像刮痕）
        g.globalAlpha = fade * (L ? 0.35 : 0.32);
        g.lineWidth = (L ? 8 : 7) * k1;
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke();
        const cg = g.createLinearGradient(x0, y0, x1, y1);
        cg.addColorStop(0, `rgba(${L ? tip : hc},0)`);
        cg.addColorStop(0.75, `rgba(${L ? tip : hc},0.9)`);
        cg.addColorStop(1, `rgba(${tip},1)`);
        g.strokeStyle = cg;
        g.globalAlpha = fade * (L ? 1 : 0.9);
        g.lineWidth = (L ? 2 : 1.8) * k1;
        g.stroke();
      }
      g.globalCompositeOperation = "source-over";

      // 清運路線：整條淡淡的虛線，車走過的那段亮起來
      const tau = t % C;
      const out = smooth(tau, endT + 1.6, endT + 2.8);
      const inn = smooth(tau, 0, 0.8);
      const vis = inn * (1 - out);
      let dNow = 0;
      for (let k = 0; k < stops.length; k++) {
        const st = stops[k];
        const prevDep = k ? stops[k - 1].dep : 0.9;
        const prevD = k ? stops[k - 1].d : 0;
        if (tau < prevDep) break;
        dNow = tau < st.arr ? prevD + (tau - prevDep) * vt : st.d;
      }
      if (tau > stops[stops.length - 1].dep) dNow = Math.min(cum[cum.length - 1], stops[stops.length - 1].d + (tau - stops[stops.length - 1].dep) * vt);
      const pts = path.map(p => P(p[0], p[1]));
      g.lineJoin = "round";
      g.setLineDash([5, 7]);
      g.strokeStyle = `rgba(${routeCol},${L ? 0.55 : 0.4})`;
      g.globalAlpha = vis;
      g.lineWidth = 1.5;
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
      g.setLineDash([]);
      // 走過的那段
      if (dNow > 0) {
        g.beginPath();
        let k = 0;
        g.moveTo(pts[0][0], pts[0][1]);
        while (k + 1 < cum.length && cum[k + 1] <= dNow) {
          k++;
          g.lineTo(pts[k][0], pts[k][1]);
        }
        const e = along(dNow);
        const pe = P(e[0], e[1]);
        g.lineTo(pe[0], pe[1]);
        g.strokeStyle = `rgba(${lit},${L ? 0.35 : 0.3})`;
        g.lineWidth = 6;
        g.stroke();
        g.strokeStyle = `rgba(${lit},0.95)`;
        g.lineWidth = 2;
        g.stroke();
      }

      // 倒數圓環：繞著下一站，車從上一站出發到抵達走滿一圈
      const nx = stops.findIndex(st => st.arr > tau);
      if (nx >= 0 && tau > 0.3 && stops[nx].ring) {
        const st = stops[nx];
        const from = nx ? stops[nx - 1].dep : 0.9;
        const p = clamp((tau - from) / (st.arr - from), 0, 1);
        const ra = smooth(tau, from - 0.2, from + 0.4) * vis;
        const c = along(st.d);
        ring(g, c, B * 0.58, p, ra, L);
      }

      // 站牌
      for (let k = 0; k < stops.length; k++) {
        const st = stops[k];
        const c = along(st.d);
        const [x, y, kk] = P(c[0], c[1]);
        const on = tau >= st.arr ? 1 : 0;
        const pop = on ? clamp((tau - st.arr) / 1.1, 0, 1) : 0;
        const hgt = 24 * kk + 7;
        g.globalAlpha = vis;
        if (on) {
          // 亮起：地面擴散一圈＋站牌頂端發光
          if (pop < 1) {
            g.strokeStyle = `rgba(${lit},${(1 - pop) * 0.9})`;
            g.lineWidth = 2;
            g.beginPath();
            g.ellipse(x, y, (6 + 30 * pop) * kk, (6 + 30 * pop) * kk * 0.55, 0, 0, 6.2832);
            g.stroke();
          }
          g.globalCompositeOperation = L ? "source-over" : "lighter";
          const gl = g.createRadialGradient(x, y - hgt, 0, x, y - hgt, 22 * kk + 6);
          gl.addColorStop(0, `rgba(${lit},${L ? 0.55 : 0.75})`);
          gl.addColorStop(1, `rgba(${lit},0)`);
          g.fillStyle = gl;
          g.beginPath();
          g.arc(x, y - hgt, 22 * kk + 6, 0, 6.2832);
          g.fill();
          g.globalCompositeOperation = "source-over";
        }
        g.strokeStyle = on ? `rgba(${lit},0.95)` : `rgba(${routeCol},${L ? 0.6 : 0.5})`;
        g.lineWidth = 1.4;
        g.beginPath();
        g.ellipse(x, y, 5 * kk + 1, (5 * kk + 1) * 0.55, 0, 0, 6.2832);
        g.moveTo(x, y);
        g.lineTo(x, y - hgt);
        g.stroke();
        g.fillStyle = on ? (L ? "#fff4dc" : "#fff1d6") : L ? "rgba(255,250,240,0.85)" : "rgba(60,46,34,0.9)";
        g.beginPath();
        g.arc(x, y - hgt, (L ? 5 : 4.2) * kk + 2, 0, 6.2832); // 站牌頭約 14px（原本 10px 太小）
        g.fill();
        g.stroke();
      }

      // 垃圾車：一顆比較大的琥珀色車燈（在站牌之間移動、到站停一下）
      if (tau > 0.9 && tau < endT + 1.6) {
        const e = along(dNow);
        const [x, y, kk] = P(e[0], e[1]);
        g.globalAlpha = vis;
        g.globalCompositeOperation = L ? "source-over" : "lighter";
        const r = 26 * kk + 8;
        const gl = g.createRadialGradient(x, y - 2, 0, x, y - 2, r);
        gl.addColorStop(0, `rgba(${core},1)`);
        gl.addColorStop(0.18, `rgba(${lit},0.85)`);
        gl.addColorStop(1, `rgba(${lit},0)`);
        g.fillStyle = gl;
        g.beginPath();
        g.arc(x, y - 2, r, 0, 6.2832);
        g.fill();
        g.globalCompositeOperation = "source-over";
      }
      g.restore();
      g.globalAlpha = 1;
    },
  };

  /** 地面上的倒數圓環（跟著透視）：底圈＋12 格刻度＋進度弧 */
  function ring(g: CanvasRenderingContext2D, c: Pt, r: number, p: number, a: number, L: boolean) {
    if (a <= 0.01) return;
    const pt = (th: number, rr: number) => P(c[0] + Math.cos(th) * rr, c[1] + Math.sin(th) * rr);
    g.globalAlpha = a;
    g.lineWidth = 1;
    g.strokeStyle = `rgba(${routeCol},${L ? 0.45 : 0.35})`;
    g.beginPath();
    for (let i = 0; i <= 48; i++) {
      const [x, y] = pt((i / 48) * 6.2832, r);
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.stroke();
    g.beginPath();
    for (let i = 0; i < 12; i++) {
      const th = (i / 12) * 6.2832;
      const [x0, y0] = pt(th, r * 1.1);
      const [x1, y1] = pt(th, r * (i % 3 ? 1.2 : 1.3));
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
    }
    g.stroke();
    // 進度弧：從最遠那一點（12 點鐘）順時針走
    if (p > 0.002) {
      const n = Math.max(2, Math.ceil(p * 48));
      g.beginPath();
      let hx = 0;
      let hy2 = 0;
      for (let i = 0; i <= n; i++) {
        const [x, y] = pt(Math.PI / 2 - (i / n) * p * 6.2832, r);
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
        hx = x;
        hy2 = y;
      }
      g.strokeStyle = `rgba(${lit},${L ? 0.3 : 0.28})`;
      g.lineWidth = 6;
      g.stroke();
      g.strokeStyle = `rgba(${lit},1)`;
      g.lineWidth = 2.2;
      g.stroke();
      g.fillStyle = `rgba(${core},1)`;
      g.beginPath();
      g.arc(hx, hy2, 2.6, 0, 6.2832);
      g.fill();
    }
  }

  /** 街道＋路燈 → 快取圖 */
  let lastLines: { f: number; c: number; r: [number, number] }[] = [];
  function buildCache(lines?: { f: number; c: number; r: [number, number] }[]) {
    if (lines) lastLines = lines;
    if (!halo.length || !lastLines.length) return;
    const L = s.light;
    const dpr = s.dpr;
    const c = document.createElement("canvas");
    c.width = Math.round((s.w + PAD * 2) * dpr);
    c.height = Math.round((s.h + PAD * 2) * dpr);
    const g = c.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, PAD * dpr, PAD * dpr);
    g.lineCap = "round";
    for (const ln of lastLines) {
      const p0 = onLine(ln.f, ln.c, ln.r[0], 0);
      const p1 = onLine(ln.f, ln.c, ln.r[1], 0);
      const a = P(p0[0], p0[1]);
      const b = P(p1[0], p1[1]);
      // 近粗遠細：分段畫（街道寬度跟著透視）
      for (let i = 0; i < 6; i++) {
        const q0 = i / 6;
        const q1 = (i + 1) / 6;
        const u0 = ln.r[0] + (ln.r[1] - ln.r[0]) * q0;
        const u1 = ln.r[0] + (ln.r[1] - ln.r[0]) * q1;
        const s0 = onLine(ln.f, ln.c, u0, 0);
        const s1 = onLine(ln.f, ln.c, u1, 0);
        const A = P(s0[0], s0[1]);
        const Bp = P(s1[0], s1[1]);
        g.strokeStyle = L ? "rgba(120,78,36,0.05)" : "rgba(255,214,160,0.05)";
        g.lineWidth = B * 0.16 * (A[2] + Bp[2]) * 0.5;
        g.beginPath();
        g.moveTo(A[0], A[1]);
        g.lineTo(Bp[0], Bp[1]);
        g.stroke();
      }
      g.strokeStyle = L ? "rgba(120,78,36,0.09)" : "rgba(255,214,160,0.09)";
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
      g.stroke();
    }
    // 路燈：每個路口一盞
    const rnd = s.rng(31);
    for (const l1 of lastLines) {
      if (l1.f) continue;
      for (const l2 of lastLines) {
        if (!l2.f) continue;
        const [gx, gy] = G(l1.c, l2.c);
        const [x, y, k] = P(gx, gy);
        const on = rnd();
        if (x < -PAD || x > s.w + PAD || y < -PAD || y > s.h + PAD || on < 0.35) continue;
        const r = (1.2 + on * 1.4) * k + 0.4;
        const gl = g.createRadialGradient(x, y, 0, x, y, r * 4);
        gl.addColorStop(0, L ? "rgba(196,120,44,0.4)" : "rgba(255,206,140,0.5)");
        gl.addColorStop(0.3, L ? "rgba(196,120,44,0.14)" : "rgba(255,206,140,0.16)");
        gl.addColorStop(1, L ? "rgba(196,120,44,0)" : "rgba(255,206,140,0)");
        g.fillStyle = gl;
        g.beginPath();
        g.arc(x, y, r * 4, 0, 6.2832);
        g.fill();
      }
    }
    cache = c;
  }

  return sc;
}

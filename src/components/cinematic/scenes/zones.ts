/**
 * 場景 zones（學區頁）：學區拼圖。
 * 一塊塊學區色塊以斜視角由下往上浮起、拼成一片地圖 → 一顆地址圖釘落下，它所在的那一塊亮起並升高、
 * 其他塊淡一點（跟下面地圖「查到的學區升起」同一個語言）→ 換下一塊，慢慢循環。
 * 顏色沿用學區頁地圖的 5 色（陶土、鼠尾草綠、赭黃、灰玫瑰、灰青），相鄰色塊不同色。
 * 幾何在 layout() 算好（固定種子，縮放／切深淺色構圖不變），每格只畫多邊形。
 */
import type { Scene, Stage } from "../cine-stage";

// [平面色塊, 命中升起的色塊]（跟 school-district.astro 的 PAL 同一組）
const PAL = {
  light: [["#d8a37c", "#c8773f"], ["#a2ba8a", "#6f9c56"], ["#dfbd79", "#d4a23a"], ["#d19ba4", "#bd6981"], ["#8fb1aa", "#4f8d8b"]],
  dark: [["#c58a5f", "#ffc493"], ["#90a771", "#c6eeae"], ["#c9a45e", "#ffe19a"], ["#c1868c", "#ffc4d4"], ["#7b9e94", "#abe6e1"]],
};

type Tile = {
  x: number[];
  y: number[];
  front: boolean[];
  cx: number;
  cy: number;
  ci: number;
  tone: number;
  delay: number;
  ph: number;
  rise: number;
  sweep: number;
  top: string;
  side: string;
  hitTop: string;
  hitSide: string;
};

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (t: number, a: number, b: number) => {
  const x = clamp((t - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};
const hex = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgb = (c: number[], k: number) => `rgb(${c.map(v => Math.round(clamp(v * k, 0, 255))).join(",")})`;

/** 落下後的回彈（0→1） */
function bounce(p: number) {
  if (p < 0.55) return (p / 0.55) ** 2;
  if (p < 0.8) {
    const q = (p - 0.675) / 0.125;
    return 1 - 0.09 * (1 - q * q);
  }
  const q = (p - 0.9) / 0.1;
  return 1 - 0.02 * (1 - q * q);
}

export default function zones(s: Stage): Scene {
  let tiles: Tile[] = [];
  let targets: number[] = [];
  let S = 50; // 一格的邊長（px）
  let T = 8; // 色塊厚度
  let K = 0.54; // 斜視壓扁比例
  let A = 3; // 拼好的時間
  let ix = 0; // 島的中心
  let iy = 0;
  let iw = 0; // 島的寬高（陰影用）
  let ih = 0;
  let edge = "";
  let rim = "";
  let glow = "";

  const sc: Scene = {
    still: 5,
    guard: 0.72,
    layout() {
      const rnd = s.rng(9301);
      const split = s.split;
      S = split ? clamp(s.h * 0.15, 40, 66) : clamp(s.w * 0.13, 36, 60);
      T = S * 0.17;
      K = 0.54;
      const cols = split ? 9 : 7;
      const rows = split ? 6 : 8;
      const th = 0.5;
      const cs = Math.cos(th);
      const sn = Math.sin(th);
      iw = (cols * cs + rows * sn) * S;
      ih = (cols * sn + rows * cs) * S * K;
      ix = s.fx;
      // 電腦版：整座島盡量留在主視覺裡（手機版的島從上方舞台往下延伸到字後面，不用夾）
      iy = split ? Math.max(s.fy + S * 0.35, ih / 2 - S * 0.3) : s.fy + S * 0.35;
      // 頂點：格點＋抖動（相鄰色塊共用同一個頂點，拼起來沒有縫）
      const J = 0.22;
      const vu: number[] = [];
      const vv: number[] = [];
      for (let j = 0; j <= rows; j++)
        for (let i = 0; i <= cols; i++) {
          vu.push(i + (rnd() - 0.5) * 2 * J);
          vv.push(j + (rnd() - 0.5) * 2 * J);
        }
      const V = (i: number, j: number) => j * (cols + 1) + i;
      // 邊的中點往垂直方向推一點（同一條邊兩邊的色塊算出同一個點）→ 邊界像地圖上的區界，不是直線
      const mid = new Map<string, [number, number]>();
      const edgeMid = (a: number, b: number): [number, number] => {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const key = lo + "_" + hi;
        let m = mid.get(key);
        if (!m) {
          const du = vu[hi] - vu[lo];
          const dv = vv[hi] - vv[lo];
          const o = (rnd() - 0.5) * 0.2;
          m = [(vu[lo] + vu[hi]) / 2 - dv * o, (vv[lo] + vv[hi]) / 2 + du * o];
          mid.set(key, m);
        }
        return m;
      };
      const proj = (u: number, v: number): [number, number] => {
        const a = u - cols / 2;
        const b = v - rows / 2;
        return [ix + (a * cs - b * sn) * S, iy + (a * sn + b * cs) * S * K];
      };
      // 上色：相鄰（含斜角）不同色
      const col: number[][] = [];
      const keep: boolean[][] = [];
      tiles = [];
      const cu0 = cols / 2;
      const cv0 = rows / 2;
      for (let j = 0; j < rows; j++) {
        col[j] = [];
        keep[j] = [];
        for (let i = 0; i < cols; i++) {
          const corner = (i === 0 || i === cols - 1) && (j === 0 || j === rows - 1);
          const border = i === 0 || j === 0 || i === cols - 1 || j === rows - 1;
          keep[j][i] = !(corner ? rnd() < 0.75 : border && rnd() < 0.2);
          const ban = new Set<number>();
          if (i > 0) ban.add(col[j][i - 1]);
          if (j > 0) {
            ban.add(col[j - 1][i]);
            if (i > 0) ban.add(col[j - 1][i - 1]);
            if (i < cols - 1) ban.add(col[j - 1][i + 1]);
          }
          const ok = [0, 1, 2, 3, 4].filter(c => !ban.has(c));
          col[j][i] = ok[Math.floor(rnd() * ok.length)] ?? 0;
          if (!keep[j][i]) continue;
          const ring = [V(i, j), V(i + 1, j), V(i + 1, j + 1), V(i, j + 1)];
          const x: number[] = [];
          const y: number[] = [];
          for (let k = 0; k < 4; k++) {
            const a = ring[k];
            const b = ring[(k + 1) % 4];
            let p = proj(vu[a], vv[a]);
            x.push(p[0]);
            y.push(p[1]);
            const m = edgeMid(a, b);
            p = proj(m[0], m[1]);
            x.push(p[0]);
            y.push(p[1]);
          }
          let cx = 0;
          let cy = 0;
          for (let k = 0; k < x.length; k++) {
            cx += x[k] / x.length;
            cy += y[k] / y.length;
          }
          // 側面：法線朝下（朝鏡頭）的邊才畫
          const front = x.map((x0, k) => {
            const k1 = (k + 1) % x.length;
            const ex = x[k1] - x0;
            const ey = y[k1] - y[k];
            let ny = -ex;
            const nx = ey;
            if (nx * ((x0 + x[k1]) / 2 - cx) + ny * ((y[k] + y[k1]) / 2 - cy) < 0) ny = -ny;
            return ny > 0.05;
          });
          const dist = Math.hypot(i + 0.5 - cu0, j + 0.5 - cv0);
          tiles.push({
            x,
            y,
            front,
            cx,
            cy,
            ci: col[j][i],
            tone: 0.95 + rnd() * 0.1,
            delay: 0.35 + dist * 0.2 + rnd() * 0.3,
            ph: rnd() * 6.28,
            rise: rnd(),
            sweep: i + j,
            top: "",
            side: "",
            hitTop: "",
            hitSide: "",
          });
        }
      }
      tiles.sort((a, b) => a.cy - b.cy);
      A = 0;
      for (const t of tiles) A = Math.max(A, t.delay + 1.1);
      // 圖釘會去的色塊：離焦點最近、又不在字底下的幾塊（輪流）
      const order = tiles
        .map((t, i) => ({ i, d: Math.hypot(t.cx - s.fx, t.cy - s.fy) - Math.min(s.gap(t.cx, t.cy - S * 0.4), S) * 0.8 }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 4)
        .map(o => o.i);
      // 第一塊（也是減少動態時的靜態畫面）挑暖色（陶土、赭黃）
      const w0 = order.findIndex(i => tiles[i].ci === 0 || tiles[i].ci === 2);
      if (w0 > 0) order.unshift(order.splice(w0, 1)[0]);
      targets = [order[0], order[2] ?? order[0], order[1] ?? order[0], order[3] ?? order[0]];
      sc.still = A + 2.4;
      if (tiles.length) sc.paint();
    },
    paint() {
      const L = s.light;
      const pal = L ? PAL.light : PAL.dark;
      for (const t of tiles) {
        const base = hex(pal[t.ci][0]);
        const hit = hex(pal[t.ci][1]);
        t.top = rgb(base, (L ? 1 : 0.5) * t.tone);
        t.side = rgb(base, (L ? 0.74 : 0.3) * t.tone);
        t.hitTop = rgb(hit, L ? 1 : 0.95);
        t.hitSide = rgb(hit, L ? 0.72 : 0.45);
      }
      edge = L ? "rgba(255,250,240,0.95)" : "rgba(255,226,180,0.34)";
      rim = L ? "#8a6539" : "#fff1d6";
      glow = L ? "208,138,46" : "255,201,120";
    },
    frame(t) {
      const g = s.g;
      const L = s.light;
      const ox = -s.px * 12;
      const oy = -s.py * 7;
      const asm = smooth(t, 0.3, A);
      // 拼好之後：每 6 秒換一塊（圖釘落下 → 色塊亮起升高 → 收回）
      const P = 6;
      const k = t > A ? Math.floor((t - A) / P) : -1;
      const tau = k >= 0 ? t - A - k * P : -1;
      const target = k >= 0 && targets.length ? targets[k % targets.length] : -1;
      const hi = tau < 0 ? 0 : smooth(tau, 0.55, 1.25) * (1 - smooth(tau, 4.6, 5.6));
      const sweepAt = ((t * 0.9) % 26) - 6; // 一道光斜斜掃過整片拼圖

      g.save();
      g.translate(ox, oy);
      // 島下面：淺色是柔和的落地陰影，深色是暖色光暈
      g.globalAlpha = asm;
      g.save();
      g.translate(ix, iy + S * 0.9);
      g.scale(1, ih / iw || 0.5);
      const sh = g.createRadialGradient(0, 0, 0, 0, 0, iw * 0.62);
      sh.addColorStop(0, L ? "rgba(92,62,28,0.2)" : "rgba(226,160,90,0.16)");
      sh.addColorStop(1, L ? "rgba(92,62,28,0)" : "rgba(226,160,90,0)");
      g.fillStyle = sh;
      g.beginPath();
      g.arc(0, 0, iw * 0.62, 0, 6.2832);
      g.fill();
      g.restore();

      let px = 0;
      let py = 0;
      let pz = 0;
      for (let n = 0; n < tiles.length; n++) {
        const tl = tiles[n];
        const p = clamp((t - tl.delay) / 1.1, 0, 1);
        if (p <= 0) continue;
        // 由下往上浮起、到位時微微過頭再回來
        const q = p - 1;
        const e = 1 + 2.2 * q * q * q + 1.2 * q * q;
        const isHit = n === target;
        const lift = isHit ? hi * S * 0.34 : 0;
        const z = Math.sin(t * 0.8 + tl.ph) * S * 0.025 * asm + lift;
        const dy = (1 - e) * S * (1.6 + tl.rise) - z;
        const a = Math.min(1, p * 1.8) * (isHit ? 1 : 1 - hi * (L ? 0.3 : 0.42));
        const X = tl.x;
        const Y = tl.y;
        const m = X.length;
        if (isHit && hi > 0.01) {
          // 命中：底下一圈暖光
          g.save();
          g.globalCompositeOperation = L ? "source-over" : "lighter";
          g.translate(tl.cx, tl.cy + dy);
          g.scale(1, K);
          const r = S * 1.9;
          const gl = g.createRadialGradient(0, 0, 0, 0, 0, r);
          gl.addColorStop(0, `rgba(${glow},${(L ? 0.42 : 0.5) * hi})`);
          gl.addColorStop(1, `rgba(${glow},0)`);
          g.fillStyle = gl;
          g.globalAlpha = 1;
          g.beginPath();
          g.arc(0, 0, r, 0, 6.2832);
          g.fill();
          g.restore();
        }
        g.globalAlpha = a;
        // 側面
        g.beginPath();
        for (let i = 0; i < m; i++) {
          if (!tl.front[i]) continue;
          const j = (i + 1) % m;
          g.moveTo(X[i], Y[i] + dy);
          g.lineTo(X[j], Y[j] + dy);
          g.lineTo(X[j], Y[j] + dy + T + lift);
          g.lineTo(X[i], Y[i] + dy + T + lift);
          g.closePath();
        }
        g.fillStyle = tl.side;
        g.fill();
        if (isHit && hi > 0) {
          g.globalAlpha = a * hi;
          g.fillStyle = tl.hitSide;
          g.fill();
          g.globalAlpha = a;
        }
        // 頂面
        g.beginPath();
        g.moveTo(X[0], Y[0] + dy);
        for (let i = 1; i < m; i++) g.lineTo(X[i], Y[i] + dy);
        g.closePath();
        g.fillStyle = tl.top;
        g.fill();
        if (isHit && hi > 0) {
          g.globalAlpha = a * hi;
          g.fillStyle = tl.hitTop;
          g.fill();
          g.globalAlpha = a;
        }
        // 掃光
        const sw = Math.exp(-((tl.sweep - sweepAt) ** 2) / 3);
        if (sw > 0.03) {
          g.globalAlpha = a * sw * (L ? 0.22 : 0.16);
          g.fillStyle = L ? "#fffaf0" : "#ffdca8";
          g.fill();
          g.globalAlpha = a;
        }
        // 色塊邊緣的柔光
        g.strokeStyle = edge;
        g.lineWidth = 1;
        g.stroke();
        if (isHit && hi > 0) {
          g.globalAlpha = a * hi * 0.35;
          g.strokeStyle = `rgb(${glow})`;
          g.lineWidth = 7;
          g.stroke();
          g.globalAlpha = a * hi;
          g.strokeStyle = rim;
          g.lineWidth = 1.8;
          g.stroke();
          px = tl.cx;
          py = tl.cy + dy;
          pz = 1;
        }
      }

      // 圖釘：落下、回彈、在色塊上泛起漣漪；要換下一塊前往上收走
      if (target >= 0 && tau >= 0) {
        const tl = tiles[target];
        if (!pz) {
          px = tl.cx;
          py = tl.cy;
        }
        const out = smooth(tau, 4.7, 5.5);
        const drop = tau < 0.9 ? bounce(tau / 0.9) : 1;
        const pa = Math.min(1, tau / 0.15) * (1 - out);
        // 漣漪（貼在色塊頂面，跟著斜視壓扁）
        for (const st of [0.85, 1.75]) {
          const rp = (tau - st) / 1.7;
          if (rp <= 0 || rp >= 1) continue;
          g.globalAlpha = (1 - rp) * 0.85 * (1 - out);
          g.strokeStyle = `rgb(${glow})`;
          g.lineWidth = 2;
          g.beginPath();
          g.ellipse(px, py, S * (0.2 + 1.1 * rp), S * (0.2 + 1.1 * rp) * K, 0, 0, 6.2832);
          g.stroke();
        }
        const sc2 = clamp(S / 56, 0.7, 1.15);
        const lift = (1 - drop) * 150 + out * 36;
        // 影子（圖釘越高越淡越小）
        g.globalAlpha = pa * (1 - lift / 190) * 0.5;
        g.fillStyle = L ? "rgba(70,44,18,0.6)" : "rgba(0,0,0,0.6)";
        g.beginPath();
        g.ellipse(px, py, 7 * sc2, 3 * sc2, 0, 0, 6.2832);
        g.fill();
        g.globalAlpha = pa;
        pin(g, px - s.px * 4, py - lift, sc2, L);
      }
      g.restore();
    },
  };
  return sc;
}

/** 直立的地址圖釘（尖端在 x, y） */
function pin(g: CanvasRenderingContext2D, x: number, y: number, k: number, light: boolean) {
  const r = 9 * k;
  const cy = y - 22 * k;
  const b = Math.acos(r / (22 * k));
  if (!light) {
    const gl = g.createRadialGradient(x, cy, 0, x, cy, r * 3.2);
    gl.addColorStop(0, "rgba(255,201,120,0.55)");
    gl.addColorStop(1, "rgba(255,201,120,0)");
    g.fillStyle = gl;
    g.beginPath();
    g.arc(x, cy, r * 3.2, 0, 6.2832);
    g.fill();
  }
  const gr = g.createRadialGradient(x - r * 0.3, cy - r * 0.35, 0, x, cy, r * 1.3);
  gr.addColorStop(0, light ? "#f6d9a4" : "#ffe3b0");
  gr.addColorStop(0.55, light ? "#c98f45" : "#d9a45b");
  gr.addColorStop(1, light ? "#7c5429" : "#8a6539");
  g.beginPath();
  g.moveTo(x, y);
  g.arc(x, cy, r, Math.PI / 2 + b, Math.PI / 2 - b);
  g.closePath();
  g.fillStyle = gr;
  g.fill();
  g.lineWidth = 2 * k;
  g.strokeStyle = light ? "#fff" : "#fff4df";
  g.stroke();
  g.fillStyle = "#fffaf0";
  g.beginPath();
  g.arc(x, cy, 3.2 * k, 0, 6.2832);
  g.fill();
}

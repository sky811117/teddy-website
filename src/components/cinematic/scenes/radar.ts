/**
 * 場景 radar（嫌惡設施頁）：琥珀／赤陶色的地面雷達。
 * 300／500／1000 公尺三圈同心圓（斜放在地面上）、一道旋轉的掃描光束（conic 漸層），
 * 光束掃過的點位像「叮」一聲亮起、再慢慢淡掉；中心一顆脈動的地址圖釘。
 *
 * 鎖定一次（頁面查詢完呼叫；只動畫面，不帶任何地址）：
 *   document.dispatchEvent(new CustomEvent("cine:radar-ping", { detail: { radius: 500 } }))
 *   → 中心打出一圈震波到那個範圍、那一圈亮起並停留幾秒、範圍內的點位依距離依序亮、準星收緊到圖釘。
 *   detail 也可以直接給數字（公尺）；沒給就當 500。
 */
import type { Scene, Stage } from "../cine-stage";

type Blip = { r: number; a: number; k: number };

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (t: number, a: number, b: number) => {
  const x = clamp((t - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};
const RINGS: [number, string][] = [
  [300, "300 公尺"],
  [500, "500 公尺"],
  [1000, "1 公里"],
];

export default function radar(s: Stage): Scene {
  let cx = 0;
  let cy = 0;
  let R = 300; // 1000 公尺那一圈的半徑（px）
  const K = 0.56; // 斜放在地面：垂直壓扁
  const W = TAU / 6.2; // 掃描一圈 6.2 秒
  const A0 = -Math.PI / 2;
  let blips: Blip[] = [];
  let labelAt = -0.5;
  let labOn = [true, true, true]; // 刻度文字：離字、搜尋卡不到 24px 的那幾個不畫（不會跟眉標讀成同一句）
  let lock: { t0: number; m: number } | null = null;
  let sprites: HTMLCanvasElement[] = [];
  // 顏色
  let line = "";
  let beam = "";
  let label = "";
  let halo = "";
  let hot = "";
  const conic = typeof CanvasRenderingContext2D !== "undefined" && "createConicGradient" in CanvasRenderingContext2D.prototype;

  const sc: Scene = {
    still: 4.1,
    guard: 0.7,
    layout() {
      const rnd = s.rng(5150);
      // 手機／平板直排：標題上方有一條專門留給場景的空地（cinematic.css 在 .cine-hero__inner 上方多留 5.25／7.5rem）
      // → 雷達中心（圖釘）放在那條空地裡、偏右，標題只被外圈弧線掠過（原本中心落在標題那一行右端）
      let top = s.h;
      for (const b of s.boxes) top = Math.min(top, b.y);
      const band = !s.split && top > 64 && top < s.h * 0.5;
      if (band) {
        cx = s.w * 0.72;
        cy = Math.round(top * 0.5 + 14); // 圖釘頭朝上約 30px：尖端放在空地中線下面一點，整顆在空地裡
        R = clamp(s.w * 0.7, 210, 380);
      } else {
        cx = s.fx;
        // 中心往下挪到主視覺中段（只要還在空地裡），三圈才看得完整
        cy = s.fy;
        for (let y = s.h * 0.48; y > s.fy; y -= 8)
          if (s.gap(cx, y) >= Math.min(40, s.fr)) {
            cy = y;
            break;
          }
        R = s.split ? clamp(s.h * 0.95, 240, 460) : clamp(s.w * 0.78, 220, 420);
      }
      const n = s.w < 640 ? 16 : 24;
      blips = [];
      for (let i = 0; i < n; i++)
        blips.push({ r: R * (0.14 + 0.96 * Math.sqrt(rnd())), a: rnd() * TAU, k: (rnd() * 3) | 0 });
      // 刻度文字放在看得到的那一側：挑「畫得出來的標籤最多、離字最遠」的角度；
      // 離字、搜尋卡不到 24px（或出畫面）的那個標籤就不畫
      s.g.font = `600 ${s.w < 640 ? 11 : 12}px ${s.font}`;
      const tw = RINGS.map(([, txt]) => s.g.measureText(txt).width || 58);
      const fits = (a: number) =>
        RINGS.map(([m], i) => {
          const r = (R * m) / 1000;
          const x = cx + Math.cos(a) * r + 6;
          const y = cy + Math.sin(a) * r * K - 8;
          if (!(x > 8 && x + tw[i] < s.w - 8 && y > 10 && y < s.h * 0.72)) return -1;
          let d = 1e9;
          for (const dx of [0, tw[i] / 2, tw[i]]) for (const dy of [-8, 0, 8]) d = Math.min(d, s.gap(x + dx, y + dy));
          return d;
        });
      let best = -1e9;
      for (let a = -0.2; a > -6.4; a -= 0.15) {
        const f = fits(a);
        const ok = f.filter(d => d >= 24);
        const score = ok.length * 1000 + (ok.length ? Math.min(...ok) : 0);
        if (score > best + 2) {
          best = score;
          labelAt = a;
          labOn = f.map(d => d >= 24);
        }
      }
    },
    paint() {
      const L = s.light;
      line = L ? "140,70,34" : "236,170,112";
      beam = L ? "196,98,44" : "246,158,86";
      label = L ? "#7a3f1f" : "#f0c9a0";
      halo = L ? "rgba(236,220,195,0.9)" : "rgba(29,24,19,0.85)";
      hot = L ? "184,86,38" : "255,196,130";
      // 點位光暈 sprite：赤陶、琥珀、奶油
      const cols = L ? ["172,74,32", "190,112,34", "150,90,52"] : ["255,150,90", "255,196,120", "255,232,200"];
      sprites = cols.map(c => {
        const cv = document.createElement("canvas");
        cv.width = cv.height = 64;
        const g = cv.getContext("2d");
        if (g) {
          const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
          // 淺色：米色底上亮點看不到 → 深赤陶實心點＋柔光暈；深色：奶油亮芯＋琥珀光暈
          gr.addColorStop(0, L ? `rgba(${c},1)` : "rgba(255,250,240,1)");
          gr.addColorStop(L ? 0.13 : 0.16, `rgba(${c},${L ? 1 : 0.95})`);
          gr.addColorStop(L ? 0.2 : 0.42, `rgba(${c},${L ? 0.42 : 0.3})`);
          gr.addColorStop(1, `rgba(${c},0)`);
          g.fillStyle = gr;
          g.fillRect(0, 0, 64, 64);
        }
        return cv;
      });
    },
    frame(t) {
      const g = s.g;
      const L = s.light;
      const ox = cx - s.px * 10;
      const oy = cy - s.py * 6;
      const intro = smooth(t, 0, 1.4);
      const th = A0 + W * t;
      const add = L ? "source-over" : "lighter";
      // 鎖定
      const lt = lock ? t - lock.t0 : -1;
      const lk = lock && lt >= 0 && lt < 9 ? lock : null;
      const rr = lk ? R * clamp(lk.m / 1000, 0.05, 1.25) : 0;
      const hold = lk ? smooth(lt, 0.5, 0.9) * (1 - smooth(lt, 6.5, 8.5)) : 0;

      // 地面的淡光盤
      g.save();
      g.translate(ox, oy);
      g.scale(1, K);
      const disc = g.createRadialGradient(0, 0, 0, 0, 0, R * 1.08);
      disc.addColorStop(0, `rgba(${beam},${L ? 0.2 : 0.1})`);
      disc.addColorStop(1, `rgba(${beam},0)`);
      g.fillStyle = disc;
      g.globalAlpha = intro;
      g.beginPath();
      g.arc(0, 0, R * 1.08, 0, TAU);
      g.fill();

      // 掃描光束（在地面座標裡畫，跟著一起斜）
      g.globalCompositeOperation = add;
      const wedge = 1.25;
      if (conic) {
        const cg = g.createConicGradient(th - wedge, 0, 0);
        const e = wedge / TAU;
        cg.addColorStop(0, `rgba(${beam},0)`);
        // 淺色：米色底上拖尾太淡、看不出在掃 → 拖尾加深
        cg.addColorStop(e * 0.55, `rgba(${beam},${L ? 0.18 : 0.06})`);
        cg.addColorStop(e * 0.8, `rgba(${beam},${L ? 0.3 : 0.16})`);
        cg.addColorStop(e * 0.97, `rgba(${beam},${L ? 0.45 : 0.32})`);
        cg.addColorStop(e, `rgba(${beam},${L ? 0.55 : 0.45})`);
        cg.addColorStop(e + 0.002, `rgba(${beam},0)`);
        cg.addColorStop(1, `rgba(${beam},0)`);
        g.fillStyle = cg;
        g.beginPath();
        g.arc(0, 0, R, 0, TAU);
        g.fill();
      } else {
        for (let i = 0; i < 16; i++) {
          const a0 = th - wedge + (wedge * i) / 16;
          g.fillStyle = `rgba(${beam},${((i + 1) / 16) ** 2 * 0.35})`;
          g.beginPath();
          g.moveTo(0, 0);
          g.arc(0, 0, R, a0, a0 + wedge / 16 + 0.01);
          g.closePath();
          g.fill();
        }
      }
      g.restore();
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = intro;

      // 同心圓、十字線、外圈刻度
      g.lineWidth = 1;
      g.strokeStyle = `rgba(${line},${L ? 0.18 : 0.14})`;
      g.setLineDash([2, 5]);
      g.beginPath();
      g.moveTo(ox - R * 1.1, oy);
      g.lineTo(ox + R * 1.1, oy);
      g.moveTo(ox, oy - R * 1.1 * K);
      g.lineTo(ox, oy + R * 1.1 * K);
      g.ellipse(ox, oy, R * 0.75, R * 0.75 * K, 0, 0, TAU);
      g.stroke();
      g.setLineDash([]);
      for (const [m] of RINGS) {
        const r = (R * m) / 1000;
        const on = lk && Math.abs(r - rr) < 1 ? hold : 0;
        g.strokeStyle = `rgba(${line},${(L ? 0.5 : 0.34) + on * 0.5})`;
        g.lineWidth = 1.2 + on * 1.3;
        g.beginPath();
        g.ellipse(ox, oy, r, r * K, 0, 0, TAU);
        g.stroke();
      }
      g.strokeStyle = `rgba(${line},${L ? 0.3 : 0.24})`;
      g.beginPath();
      for (let i = 0; i < 72; i++) {
        const a = (i / 72) * TAU;
        const r1 = R * (i % 6 ? 1.02 : 1.045);
        g.moveTo(ox + Math.cos(a) * R, oy + Math.sin(a) * R * K);
        g.lineTo(ox + Math.cos(a) * r1, oy + Math.sin(a) * r1 * K);
      }
      g.stroke();

      // 光束前緣（一條亮線）
      const ex = ox + Math.cos(th) * R;
      const ey = oy + Math.sin(th) * R * K;
      const lg = g.createLinearGradient(ox, oy, ex, ey);
      lg.addColorStop(0, `rgba(${hot},0.95)`);
      lg.addColorStop(1, `rgba(${hot},0.1)`);
      g.strokeStyle = lg;
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(ox, oy);
      g.lineTo(ex, ey);
      g.stroke();

      // 刻度文字
      g.font = `600 ${s.w < 640 ? 11 : 12}px ${s.font}`;
      g.textBaseline = "middle";
      g.lineJoin = "round";
      RINGS.forEach(([m, txt], i) => {
        if (!labOn[i]) return;
        const r = (R * m) / 1000;
        const x = ox + Math.cos(labelAt) * r + 6;
        const y = oy + Math.sin(labelAt) * r * K - 8;
        const on = lk && Math.abs(r - rr) < 1 ? hold : 0;
        g.globalAlpha = intro * (0.75 + on * 0.25);
        g.strokeStyle = halo;
        g.lineWidth = 3;
        g.strokeText(txt, x, y);
        g.fillStyle = on > 0.5 ? `rgb(${hot})` : label;
        g.fillText(txt, x, y);
      });

      // 點位：光束掃過時「叮」一下亮起，再慢慢淡掉
      g.globalCompositeOperation = add;
      for (const b of blips) {
        let since = ((((th - b.a) % TAU) + TAU) % TAU) / W;
        if (t < since) since = 99; // 開場第一圈還沒掃到的，先不亮
        let I = Math.exp(-since / 1.9);
        let dim = 1;
        if (lk) {
          if (b.r <= rr) {
            const at = lt - 0.9 * (b.r / Math.max(rr, 1));
            if (at >= 0) {
              I = Math.max(I, Math.exp(-at / 2.4));
              since = Math.min(since, at);
            }
          } else dim = 1 - 0.55 * hold;
        }
        const x = ox + Math.cos(b.a) * b.r;
        const y = oy + Math.sin(b.a) * b.r * K;
        const sz = 7 + 22 * I;
        g.globalAlpha = intro * dim * (0.28 + 0.72 * I);
        g.drawImage(sprites[b.k], x - sz / 2, y - sz / 2, sz, sz);
        if (L) {
          // 淺色：桃色底上細圈看不到 → 實心赤陶核心點（掃到時 4.5px、平常 2px）
          g.globalAlpha = intro * dim * (0.35 + 0.55 * I);
          g.fillStyle = "#b4572e";
          g.beginPath();
          g.arc(x, y, 2 + 2.5 * I, 0, TAU);
          g.fill();
        }
        if (since < 1) {
          // 「叮」：從點位往外擴散一圈（0 → 14px）
          g.globalAlpha = intro * dim * (1 - since) * (L ? 0.9 : 0.8);
          g.strokeStyle = `rgb(${hot})`;
          g.lineWidth = L ? 1.8 : 1.2;
          g.beginPath();
          g.ellipse(x, y, 3 + 14 * since, (3 + 14 * since) * 0.7, 0, 0, TAU);
          g.stroke();
        }
      }
      g.globalCompositeOperation = "source-over";

      // 鎖定：震波到範圍、準星收緊
      if (lk) {
        const p = clamp(lt / 0.9, 0, 1);
        if (p < 1) {
          const r = rr * (1 - (1 - p) ** 3);
          g.globalAlpha = 1 - p * 0.6;
          g.strokeStyle = `rgb(${hot})`;
          g.lineWidth = 2.5;
          g.beginPath();
          g.ellipse(ox, oy, r, r * K, 0, 0, TAU);
          g.stroke();
        }
        if (Math.abs(rr - R * 0.3) > 1 && Math.abs(rr - R * 0.5) > 1 && Math.abs(rr - R) > 1 && hold > 0) {
          g.globalAlpha = hold * 0.9;
          g.lineWidth = 2;
          g.beginPath();
          g.ellipse(ox, oy, rr, rr * K, 0, 0, TAU);
          g.stroke();
        }
        const rq = 1 - smooth(lt, 0, 0.55);
        const fade = 1 - smooth(lt, 2.2, 3);
        if (fade > 0) {
          const d = 16 + 40 * rq;
          const e = 8;
          g.globalAlpha = fade;
          g.strokeStyle = `rgb(${hot})`;
          g.lineWidth = 2;
          g.beginPath();
          for (const [sx, sy] of [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ]) {
            const x = ox + sx * d;
            const y = oy - 16 + sy * d * 0.8;
            g.moveTo(x, y - sy * e);
            g.lineTo(x, y);
            g.lineTo(x - sx * e, y);
          }
          g.stroke();
        }
      }

      // 中心：一圈圈往外擴散的脈動＋直立圖釘
      g.globalAlpha = intro;
      for (let i = 0; i < 2; i++) {
        const q = ((t + i * 1.2) % 2.4) / 2.4;
        const r = 8 + R * 0.2 * q;
        g.globalAlpha = intro * (1 - q) * 0.7;
        g.strokeStyle = `rgb(${hot})`;
        g.lineWidth = 1.6;
        g.beginPath();
        g.ellipse(ox, oy, r, r * K, 0, 0, TAU);
        g.stroke();
      }
      g.globalAlpha = intro * 0.45;
      g.fillStyle = L ? "rgba(70,40,18,0.7)" : "rgba(0,0,0,0.7)";
      g.beginPath();
      g.ellipse(ox, oy, 7, 3, 0, 0, TAU);
      g.fill();
      g.globalAlpha = intro;
      const k = s.w < 640 ? 0.9 : 1.05;
      pin(g, ox - s.px * 3, oy - 1.5 - Math.sin(t * 2.6) * 1.5, k, L);
      g.globalAlpha = 1;
    },
  };

  document.addEventListener("cine:radar-ping", e => {
    const d = (e as CustomEvent).detail;
    const m = Number(typeof d === "object" && d ? (d.radius ?? d.r ?? d.m) : d);
    lock = { t0: s.reduced ? sc.still - 1.6 : s.t, m: m > 0 ? clamp(m, 50, 3000) : 500 };
    s.redraw();
  });

  return sc;
}

/** 直立的地址圖釘（尖端在 x, y） */
function pin(g: CanvasRenderingContext2D, x: number, y: number, k: number, light: boolean) {
  const r = 9 * k;
  const cy = y - 22 * k;
  const b = Math.acos(r / (22 * k));
  if (!light) {
    const gl = g.createRadialGradient(x, cy, 0, x, cy, r * 3.2);
    gl.addColorStop(0, "rgba(255,190,120,0.5)");
    gl.addColorStop(1, "rgba(255,190,120,0)");
    g.fillStyle = gl;
    g.beginPath();
    g.arc(x, cy, r * 3.2, 0, TAU);
    g.fill();
  }
  const gr = g.createRadialGradient(x - r * 0.3, cy - r * 0.35, 0, x, cy, r * 1.3);
  gr.addColorStop(0, light ? "#f6d0a4" : "#ffe0b4");
  gr.addColorStop(0.55, light ? "#c47a3e" : "#d99a5b");
  gr.addColorStop(1, light ? "#7a4424" : "#8a5a36");
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
  g.arc(x, cy, 3.2 * k, 0, TAU);
  g.fill();
}

/**
 * 場景 dust（總覽頁，基本款）：金色光塵在斜陽裡慢慢往上飄。
 * 粒子先畫成小 sprite，每格只做 drawImage（手機約 50 顆、桌機約 120 顆）。
 * 深色：疊加發光（lighter）；淺色：米白底上亮點加不上去 → 深金色光塵、帶暖金邊的散景。
 */
import type { Scene, Stage } from "../cine-stage";

type Mote = {
  x: number;
  y: number;
  z: number;
  d: number;
  vx: number;
  vy: number;
  a: number;
  ph: number;
  wf: number;
  wa: number;
  tw: number;
  k: number; // sprite 種類 0 清楚 / 1 遠景柔焦 / 2 前景散景
  c: number; // 顏色 index
};

const PALETTE = {
  light: ["176,120,52", "160,104,40", "190,134,66", "150,98,44"],
  dark: ["255,224,170", "242,190,118", "255,240,212", "224,164,96"],
};
// 淺色各種粒子的透明度倍率（散景盤在亮底上要更實一點才看得到邊）
const LIGHT_MUL = [1, 0.9, 2.6];
const LIGHT_BOKEH = ["255,244,222", "255,236,204", "252,240,220", "255,248,232"];

function sprite(rgb: string, kind: number, light: boolean, idx: number): HTMLCanvasElement {
  const size = kind === 2 ? 96 : 48;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  if (!g) return c;
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  const s = (a: number) => `rgba(${rgb},${a})`;
  const stops: [number, string][] = light
    ? kind === 0
      ? // 對焦的光塵：奶油亮芯＋琥珀光暈（比底色深，米色上看得到）
        [[0, "rgba(255,250,236,1)"], [0.14, "rgba(255,238,200,0.95)"], [0.24, s(0.8)], [0.42, s(0.3)], [0.72, s(0.07)], [1, s(0)]]
      : kind === 1
        ? [[0, s(0.9)], [0.45, s(0.5)], [1, s(0)]]
        : // 前景散景：奶油色平盤＋1px 暖金邊
          [[0, `rgba(${LIGHT_BOKEH[idx % 4]},0.5)`], [0.78, "rgba(255,244,222,0.62)"], [0.86, "rgba(201,143,69,0.5)"], [0.92, "rgba(201,143,69,0.22)"], [1, "rgba(201,143,69,0)"]]
    : kind === 0
      ? [[0, "rgba(255,255,250,1)"], [0.12, s(0.95)], [0.3, s(0.32)], [0.62, s(0.08)], [1, s(0)]]
      : kind === 1
        ? [[0, s(0.9)], [0.35, s(0.45)], [1, s(0)]]
        : [[0, s(0.42)], [0.7, s(0.5)], [0.84, s(0.62)], [0.93, s(0.22)], [1, s(0)]];
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

export default function dust(s: Stage): Scene {
  let motes: Mote[] = [];
  let sprites: HTMLCanvasElement[][] = [];
  let W = 0;
  let H = 0;

  const count = () => {
    const base = s.w < 640 ? 50 : s.w < 1024 ? 84 : 120;
    return s.tool ? Math.round(base * 0.85) : base;
  };

  const seed = () => {
    const n = count();
    const small = s.w < 640 ? 0.8 : 1;
    motes = [];
    for (let i = 0; i < n; i++) {
      const z = Math.random();
      const k = z > 0.84 ? 2 : z > 0.46 ? 0 : 1;
      const d = (k === 2 ? 20 + Math.random() * 30 : k === 0 ? 7 + Math.random() * 9 : 4 + Math.random() * 6) * small;
      motes.push({
        x: Math.random() * s.w,
        y: Math.random() * s.h,
        z,
        d,
        a: k === 2 ? 0.08 + Math.random() * 0.12 : k === 0 ? 0.55 + Math.random() * 0.45 : 0.3 + Math.random() * 0.35,
        k,
        c: (Math.random() * 4) | 0,
        vx: (Math.random() - 0.35) * 6 * (0.4 + z),
        vy: -(3 + 9 * z) * (0.55 + Math.random() * 0.8),
        ph: Math.random() * Math.PI * 2,
        wf: 0.18 + Math.random() * 0.45,
        wa: 3 + Math.random() * 9,
        tw: 0.35 + Math.random() * 0.8,
      });
    }
  };

  return {
    still: 0,
    guard: 0,
    layout() {
      if (!motes.length || motes.length !== count()) seed();
      else if (W && H)
        for (const m of motes) {
          m.x *= s.w / W;
          m.y *= s.h / H;
        }
      W = s.w;
      H = s.h;
    },
    paint() {
      const pal = s.light ? PALETTE.light : PALETTE.dark;
      sprites = [0, 1, 2].map(k => pal.map((rgb, i) => sprite(rgb, k, s.light, i)));
    },
    frame(t, dt) {
      const g = s.g;
      const w = s.w;
      const h = s.h;
      for (const m of motes) {
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        const pad = m.d;
        if (m.y < -pad) {
          m.y = h + pad;
          m.x = Math.random() * w;
        } else if (m.y > h + pad) m.y = -pad;
        if (m.x < -pad) m.x = w + pad;
        else if (m.x > w + pad) m.x = -pad;
      }
      g.globalCompositeOperation = s.light ? "source-over" : "lighter";
      const par = s.pointer ? 34 : 0;
      for (const m of motes) {
        const depth = m.z - 0.45;
        const x = m.x + Math.sin(t * m.wf + m.ph) * m.wa + s.px * par * depth;
        const y = m.y + s.py * par * 0.6 * depth;
        const a = m.a * (s.light ? LIGHT_MUL[m.k] : 1) * (0.7 + 0.3 * Math.sin(t * m.tw + m.ph * 2));
        g.globalAlpha = a > 1 ? 1 : a;
        g.drawImage(sprites[m.k][m.c], x - m.d / 2, y - m.d / 2, m.d, m.d);
      }
    },
  };
}

/**
 * CinematicHero 的腳本：光塵粒子（canvas）、滑鼠景深視差、關鍵數字 count-up。
 *
 * 效能規則：
 *  - 粒子先畫成小 sprite，每格只做 drawImage（手機約 50 顆、桌機約 120 顆），疊加混色 lighter
 *  - 主視覺離開畫面、分頁切到背景 → 停掉 requestAnimationFrame，體積光／太陽的 CSS 動畫也暫停（.is-paused）
 *  - 地圖在動（cine-map.js 發 "cine:map-move"）→ 同樣暫停，把 GPU 讓給地圖（開場飛行、查詢轉場才不掉格）
 *  - 觸控裝置 30fps；DPR 上限 2
 *  - prefers-reduced-motion → 只畫一張靜止畫面、數字直接顯示最終值、沒有視差
 *  - 驗收用：canvas.__cine = { frames, running }（不寫 DOM）
 */

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

const mq = (q: string) => {
  try {
    return window.matchMedia(q).matches;
  } catch {
    return false;
  }
};

const PALETTE: Record<"light" | "dark", string[]> = {
  // 淺色：米白底上亮點加不上去 → 改用深金色的光塵、帶暖金邊的散景，靠顏色和邊緣被看見
  light: ["176,120,52", "160,104,40", "190,134,66", "150,98,44"],
  dark: ["255,224,170", "242,190,118", "255,240,212", "224,164,96"],
};
// 淺色各種粒子的透明度倍率（散景盤在亮底上要更實一點才看得到邊）
const LIGHT_MUL = [1, 0.9, 2.6];
const LIGHT_BOKEH = ["255,244,222", "255,236,204", "252,240,220", "255,248,232"];

function makeSprite(rgb: string, kind: number, light = false, idx = 0): HTMLCanvasElement {
  const size = kind === 2 ? 96 : 48;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  if (!g) return c;
  const r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  const s = (a: number) => `rgba(${rgb},${a})`;
  if (light) {
    if (kind === 0) {
      // 對焦的光塵：奶油亮芯＋琥珀光暈（比底色深，米色上看得到）
      grad.addColorStop(0, "rgba(255,250,236,1)");
      grad.addColorStop(0.14, "rgba(255,238,200,0.95)");
      grad.addColorStop(0.24, s(0.8));
      grad.addColorStop(0.42, s(0.3));
      grad.addColorStop(0.72, s(0.07));
      grad.addColorStop(1, s(0));
    } else if (kind === 1) {
      // 遠景：深金小點、柔焦
      grad.addColorStop(0, s(0.9));
      grad.addColorStop(0.45, s(0.5));
      grad.addColorStop(1, s(0));
    } else {
      // 前景散景：奶油色平盤＋1px 暖金邊
      grad.addColorStop(0, `rgba(${LIGHT_BOKEH[idx % 4]},0.5)`);
      grad.addColorStop(0.78, "rgba(255,244,222,0.62)");
      grad.addColorStop(0.86, "rgba(201,143,69,0.5)");
      grad.addColorStop(0.92, "rgba(201,143,69,0.22)");
      grad.addColorStop(1, "rgba(201,143,69,0)");
    }
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return c;
  }
  if (kind === 0) {
    // 對焦的光塵：亮芯＋柔光暈（bloom）
    grad.addColorStop(0, "rgba(255,255,250,1)");
    grad.addColorStop(0.12, s(0.95));
    grad.addColorStop(0.3, s(0.32));
    grad.addColorStop(0.62, s(0.08));
    grad.addColorStop(1, s(0));
  } else if (kind === 1) {
    // 遠景：小、柔焦
    grad.addColorStop(0, s(0.9));
    grad.addColorStop(0.35, s(0.45));
    grad.addColorStop(1, s(0));
  } else {
    // 前景散景：平盤＋微亮邊，邊緣柔焦
    grad.addColorStop(0, s(0.42));
    grad.addColorStop(0.7, s(0.5));
    grad.addColorStop(0.84, s(0.62));
    grad.addColorStop(0.93, s(0.22));
    grad.addColorStop(1, s(0));
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

class Dust {
  // 欄位只宣告型別、在 constructor 裡給值（輸出比 class field 語法精簡）
  declare hero: HTMLElement;
  declare canvas: HTMLCanvasElement;
  declare ctx: CanvasRenderingContext2D;
  declare layers: { el: HTMLElement; k: number }[];
  declare motes: Mote[];
  declare sprites: HTMLCanvasElement[][];
  declare w: number;
  declare h: number;
  declare dpr: number;
  declare raf: number;
  declare last: number;
  declare t: number;
  declare frames: number;
  declare running: boolean;
  declare inView: boolean;
  declare reduced: boolean;
  declare lowFps: boolean;
  declare pointer: boolean;
  declare light: boolean;
  declare px: number;
  declare py: number;
  declare tx: number;
  declare ty: number;
  declare lpx: number;
  declare lpy: number;
  declare isTool: boolean;
  declare mapMoving: Set<number>;
  declare mapSafety: number;
  declare tick: (now: number) => void;

  constructor(hero: HTMLElement, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    this.hero = hero;
    this.canvas = canvas;
    this.ctx = ctx;
    this.motes = [];
    this.sprites = [];
    this.w = this.h = this.raf = this.last = this.t = this.frames = 0;
    this.px = this.py = this.tx = this.ty = this.mapSafety = 0;
    this.lpx = this.lpy = 99;
    this.dpr = 1;
    this.running = this.light = false;
    this.inView = true;
    this.mapMoving = new Set<number>();
    this.tick = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(this.tick);
      const el = now - this.last;
      if (this.lowFps && el < 31) return;
      const dt = Math.min(0.05, el / 1000);
      this.last = now;
      this.t += dt;
      this.step(dt);
      this.draw(this.t);
      this.frames++;
    };
    this.isTool = hero.dataset.variant === "tool";
    this.layers = Array.from(hero.querySelectorAll<HTMLElement>("[data-depth]")).map(el => ({
      el,
      k: parseFloat(el.dataset.depth || "0") || 0,
    }));
    this.reduced = mq("(prefers-reduced-motion: reduce)");
    this.lowFps = mq("(pointer: coarse)");
    this.pointer = mq("(hover: hover) and (pointer: fine)");
    (canvas as HTMLCanvasElement & { __cine?: Dust }).__cine = this;
    this.paint();
    this.resize();
    this.bind();
    this.sync();
  }

  theme(): "light" | "dark" {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  paint() {
    const t = this.theme();
    this.light = t === "light";
    this.sprites = [0, 1, 2].map(k => PALETTE[t].map((rgb, i) => makeSprite(rgb, k, this.light, i)));
  }

  count(): number {
    const w = this.w;
    const base = w < 640 ? 50 : w < 1024 ? 84 : 120;
    return this.isTool ? Math.round(base * 0.85) : base;
  }

  seed() {
    const n = this.count();
    const small = this.w < 640 ? 0.8 : 1;
    const ms: Mote[] = [];
    for (let i = 0; i < n; i++) {
      const z = Math.random();
      const k = z > 0.84 ? 2 : z > 0.46 ? 0 : 1;
      const d =
        k === 2
          ? (20 + Math.random() * 30) * small
          : k === 0
            ? (7 + Math.random() * 9) * small
            : (4 + Math.random() * 6) * small;
      const a = k === 2 ? 0.08 + Math.random() * 0.12 : k === 0 ? 0.55 + Math.random() * 0.45 : 0.3 + Math.random() * 0.35;
      ms.push({
        x: Math.random() * this.w,
        y: Math.random() * this.h,
        z,
        d,
        a,
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
    this.motes = ms;
  }

  resize() {
    const r = this.hero.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    const had = this.motes.length > 0;
    const sx = had ? w / this.w : 1;
    const sy = had ? h / this.h : 1;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!had || this.motes.length !== this.count()) this.seed();
    else
      for (const m of this.motes) {
        m.x *= sx;
        m.y *= sy;
      }
    if (!this.running) this.draw(0);
  }

  bind() {
    if ("ResizeObserver" in window) {
      let pending = 0;
      new ResizeObserver(() => {
        cancelAnimationFrame(pending);
        pending = requestAnimationFrame(() => this.resize());
      }).observe(this.hero);
    }
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(
        es => {
          this.inView = es[es.length - 1].isIntersecting;
          this.sync();
        },
        { rootMargin: "32px" }
      ).observe(this.hero);
    }
    document.addEventListener("visibilitychange", () => this.sync());
    // 地圖在動：暫停（每張地圖各自回報；保險：8 秒沒收到停下就自己恢復）
    document.addEventListener("cine:map-move", e => {
      const det = (e as CustomEvent<{ id: number; moving: boolean }>).detail;
      if (!det) return;
      if (det.moving) this.mapMoving.add(det.id);
      else this.mapMoving.delete(det.id);
      clearTimeout(this.mapSafety);
      if (this.mapMoving.size)
        this.mapSafety = window.setTimeout(() => {
          this.mapMoving.clear();
          this.sync();
        }, 8000);
      this.sync();
    });
    try {
      window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", e => {
        this.reduced = e.matches;
        this.sync();
        if (this.reduced) this.draw(0);
      });
    } catch {
      /* 舊 Safari 沒有 addEventListener */
    }
    new MutationObserver(() => {
      this.paint();
      if (!this.running) this.draw(0);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    if (this.pointer) {
      window.addEventListener(
        "pointermove",
        e => {
          if (e.pointerType !== "mouse" || !this.running) return;
          const r = this.hero.getBoundingClientRect();
          if (e.clientY > r.bottom + 80) return;
          this.tx = Math.max(-1, Math.min(1, (e.clientX - r.left - r.width / 2) / (r.width / 2)));
          this.ty = Math.max(-1, Math.min(1, (e.clientY - r.top - r.height / 2) / (r.height / 2)));
        },
        { passive: true }
      );
      document.documentElement.addEventListener("pointerleave", () => {
        this.tx = 0;
        this.ty = 0;
      });
    }
  }

  sync() {
    const visible = this.inView && !document.hidden;
    const should = visible && !this.reduced && this.mapMoving.size === 0;
    // CSS 動畫（體積光擺動、太陽呼吸）：看不到或地圖在動時暫停（只切 animation-play-state，不重排）
    this.hero.classList.toggle("is-paused", !visible || this.mapMoving.size > 0);
    if (should && !this.running) {
      this.running = true;
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    } else if (!should && this.running) {
      this.running = false;
      cancelAnimationFrame(this.raf);
    }
  }

  step(dt: number) {
    const w = this.w;
    const h = this.h;
    for (const m of this.motes) {
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
    // 滑鼠視差（平滑跟隨）
    this.px += (this.tx - this.px) * 0.05;
    this.py += (this.ty - this.py) * 0.05;
    if (Math.abs(this.px - this.lpx) > 0.002 || Math.abs(this.py - this.lpy) > 0.002) {
      this.lpx = this.px;
      this.lpy = this.py;
      for (const L of this.layers) {
        L.el.style.transform = `translate3d(${(-this.px * 16 * L.k).toFixed(2)}px,${(-this.py * 10 * L.k).toFixed(2)}px,0)`;
      }
    }
  }

  draw(t: number) {
    const g = this.ctx;
    g.clearRect(0, 0, this.w, this.h);
    // 深色：疊加發光（lighter）；淺色：一般疊放（亮底上 lighter 會加到全白、看不見）
    g.globalCompositeOperation = this.light ? "source-over" : "lighter";
    const par = this.pointer ? 34 : 0;
    for (const m of this.motes) {
      const depth = m.z - 0.45;
      const x = m.x + Math.sin(t * m.wf + m.ph) * m.wa + this.px * par * depth;
      const y = m.y + this.py * par * 0.6 * depth;
      const a = m.a * (this.light ? LIGHT_MUL[m.k] : 1) * (0.7 + 0.3 * Math.sin(t * m.tw + m.ph * 2));
      g.globalAlpha = a > 1 ? 1 : a;
      g.drawImage(this.sprites[m.k][m.c], x - m.d / 2, y - m.d / 2, m.d, m.d);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
}

function countUp(hero: HTMLElement, reduced: boolean, delay = 600, dur = 1700) {
  const els = Array.from(hero.querySelectorAll<HTMLElement>("[data-cine-count]"));
  hero.classList.add("cine-counted");
  if (!els.length) return;
  const fmts = new Map<number, Intl.NumberFormat>();
  const fmt = (v: number, dec: number) => {
    let f = fmts.get(dec);
    if (!f) {
      f = new Intl.NumberFormat("zh-TW", { minimumFractionDigits: dec, maximumFractionDigits: dec });
      fmts.set(dec, f);
    }
    return f.format(v);
  };
  const items = els.map(el => ({
    el,
    v: parseFloat(el.dataset.value || "0") || 0,
    dec: parseInt(el.dataset.decimals || "0", 10) || 0,
  }));
  if (reduced) {
    items.forEach(i => (i.el.textContent = fmt(i.v, i.dec)));
    return;
  }
  let t0 = 0;
  const step = (now: number) => {
    if (!t0) t0 = now + delay;
    const p = Math.max(0, Math.min(1, (now - t0) / dur));
    const e = 1 - Math.pow(1 - p, 4);
    for (const i of items) {
      const v = i.v * e;
      i.el.textContent = fmt(i.dec ? v : Math.round(v), i.dec);
    }
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * 主視覺進場（標題光掃浮現）結束 → <html data-cine-hero-done> ＋ document 事件 "cine:hero-done"。
 * cine-map.js 的開場飛行會等這個，節奏變成「標題 → 搜尋卡 → 鏡頭飛入」，不會全部擠在同一秒。
 */
function heroDone(hero: HTMLElement, reduced: boolean) {
  const root = document.documentElement;
  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    root.setAttribute("data-cine-hero-done", "");
    document.dispatchEvent(new CustomEvent("cine:hero-done"));
  };
  const wipe = hero.querySelector<HTMLElement>(".cine-wipe__in");
  const anims = !reduced && wipe && wipe.getAnimations ? wipe.getAnimations() : [];
  const running = anims.filter(a => a.playState !== "finished");
  if (!running.length) return fire();
  Promise.all(running.map(a => a.finished)).then(fire, fire);
  window.setTimeout(fire, 3000);
}

function initHero(hero: HTMLElement) {
  if (hero.dataset.cineInit) return;
  hero.dataset.cineInit = "1";
  const reduced = mq("(prefers-reduced-motion: reduce)");
  // 工具頁：數字膠囊小，count-up 收短，搶在鏡頭飛入前數完
  if (hero.dataset.variant === "tool") countUp(hero, reduced, 450, 1150);
  else countUp(hero, reduced);
  heroDone(hero, reduced);
  const canvas = hero.querySelector<HTMLCanvasElement>("canvas.cine-hero__dust");
  if (!canvas) return;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    ctx = null;
  }
  if (!ctx) return;
  new Dust(hero, canvas, ctx);
}

document.querySelectorAll<HTMLElement>("[data-cine-hero]").forEach(initHero);

export {};

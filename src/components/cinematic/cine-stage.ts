/**
 * 主視覺場景的共用舞台（生命週期），每個場景（scenes/*.ts）只負責「畫」。
 *
 *  - canvas 尺寸跟著主視覺（ResizeObserver），DPR 上限 2
 *  - 主視覺離開畫面、分頁切到背景、地圖在動（cine-map.js 發 "cine:map-move"）→ 停掉 requestAnimationFrame，
 *    體積光／太陽的 CSS 動畫也暫停（.is-paused）
 *  - 觸控裝置 30fps
 *  - prefers-reduced-motion → 只畫一張靜態畫面（場景的 still 那一刻），沒有視差
 *  - 深淺色切換（<html data-theme>）→ 場景 paint() 換色、重畫
 *  - 滑鼠視差：[data-depth] 圖層（太陽、體積光）用 transform 平移；場景拿 px / py（-1～1，已平滑）自己決定怎麼動
 *  - 文字保護：量出眉標、標題、副標每一行的位置，做一張柔邊遮罩；場景畫完後在字底下淡掉（guard＝強度），字不被搶
 *  - 焦點：在「沒有字、沒有搜尋卡」的空地裡找最寬的一塊（fx, fy, fr），場景的主角（圖釘、雷達中心、路線）放這裡
 *  - 驗收用：canvas.__cine = 這個物件（frames、running、scene），不寫 DOM
 */

export type Scene = {
  /** 尺寸或版面變了：重算幾何（s.w、s.h、s.fx…已更新） */
  layout(): void;
  /** 深淺色變了（s.light 已更新） */
  paint(): void;
  /** 畫一格：t＝場景時間（秒，只在播放時前進），dt＝這格經過的秒數（靜態重畫時是 0） */
  frame(t: number, dt: number): void;
  /** 減少動態時停在這一刻（要挑一張好看的） */
  still: number;
  /** 文字保護強度 0～1（0＝不遮） */
  guard: number;
};
export type SceneFactory = (s: Stage) => Scene;
export type Box = { x: number; y: number; w: number; h: number };

const mq = (q: string) => {
  try {
    return window.matchMedia(q).matches;
  } catch {
    return false;
  }
};

export class Stage {
  declare hero: HTMLElement;
  declare canvas: HTMLCanvasElement;
  declare g: CanvasRenderingContext2D;
  declare scene: Scene | null;
  declare w: number;
  declare h: number;
  declare dpr: number;
  declare light: boolean;
  declare reduced: boolean;
  declare lowFps: boolean;
  declare pointer: boolean;
  declare tool: boolean;
  declare running: boolean;
  declare inView: boolean;
  declare frames: number;
  declare t: number;
  declare last: number;
  declare raf: number;
  declare px: number;
  declare py: number;
  declare tx: number;
  declare ty: number;
  declare lpx: number;
  declare lpy: number;
  declare layers: { el: HTMLElement; k: number }[];
  declare mapMoving: Set<number>;
  declare mapSafety: number;
  /** 字的位置（相對主視覺）、搜尋卡位置、是否左文右卡 */
  declare boxes: Box[];
  declare slot: Box | null;
  declare split: boolean;
  /** 焦點（空地中心）與它離字／卡片的距離 */
  declare fx: number;
  declare fy: number;
  declare fr: number;
  declare mask: HTMLCanvasElement | null;
  declare font: string;
  declare tick: (now: number) => void;

  constructor(hero: HTMLElement, canvas: HTMLCanvasElement, g: CanvasRenderingContext2D) {
    this.hero = hero;
    this.canvas = canvas;
    this.g = g;
    this.scene = this.mask = this.slot = null;
    this.w = this.h = this.raf = this.last = this.t = this.frames = 0;
    this.px = this.py = this.tx = this.ty = this.mapSafety = this.fr = 0;
    this.fx = this.fy = -1e4;
    this.lpx = this.lpy = 99;
    this.dpr = 1;
    this.running = this.split = false;
    this.inView = true;
    this.boxes = [];
    this.mapMoving = new Set<number>();
    this.tool = hero.dataset.variant === "tool";
    this.font = getComputedStyle(hero).fontFamily || "sans-serif";
    this.reduced = mq("(prefers-reduced-motion: reduce)");
    this.lowFps = mq("(pointer: coarse)");
    this.pointer = mq("(hover: hover) and (pointer: fine)");
    this.light = this.theme();
    this.layers = Array.from(hero.querySelectorAll<HTMLElement>("[data-depth]")).map(el => ({
      el,
      k: parseFloat(el.dataset.depth || "0") || 0,
    }));
    this.tick = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(this.tick);
      const el = now - this.last;
      if (this.lowFps && el < 31) return;
      const dt = Math.min(0.05, el / 1000);
      this.last = now;
      this.t += dt;
      this.parallax();
      this.render(this.t, dt);
      this.frames++;
    };
    (canvas as HTMLCanvasElement & { __cine?: Stage }).__cine = this;
    this.resize();
    this.bind();
  }

  theme(): boolean {
    return document.documentElement.getAttribute("data-theme") !== "dark";
  }

  /** 場景載入好了：量版面、配色、開始播（或畫靜態那一張） */
  mount(scene: Scene) {
    this.scene = scene;
    scene.layout();
    scene.paint();
    this.redraw();
    this.sync();
  }

  /** 可重現的亂數（同一個種子→同一個畫面：縮放視窗、切深淺色構圖不會變） */
  rng(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** (x, y) 離字、搜尋卡有多遠（在裡面＝0） */
  gap(x: number, y: number) {
    let d = 1e9;
    const all = this.slot ? this.boxes.concat(this.slot) : this.boxes;
    for (const b of all) {
      const dx = Math.max(b.x - x, 0, x - b.x - b.w);
      const dy = Math.max(b.y - y, 0, y - b.y - b.h);
      d = Math.min(d, Math.hypot(dx, dy));
    }
    return d;
  }

  measure(): boolean {
    const hr = this.hero.getBoundingClientRect();
    const rel = (r: DOMRect | { left: number; top: number; width: number; height: number }): Box => ({
      x: r.left - hr.left,
      y: r.top - hr.top,
      w: r.width,
      h: r.height,
    });
    const q = (sel: string) => this.hero.querySelector<HTMLElement>(sel);
    const boxes: Box[] = [];
    // 眉標、副標：用 Range 量每一行實際的字寬（副標是整塊 block，最後一行常常很短）
    for (const sel of [".cine-hero__eyebrow", ".cine-hero__sub"]) {
      const el = q(sel);
      if (!el) continue;
      const rg = document.createRange();
      rg.selectNodeContents(el);
      for (const r of Array.from(rg.getClientRects())) if (r.width > 2) boxes.push(rel(r));
    }
    const title = q(".cine-title-box");
    if (title) boxes.push(rel(title.getBoundingClientRect()));
    this.hero.querySelectorAll(".cine-stat").forEach(el => boxes.push(rel(el.getBoundingClientRect())));
    this.boxes = boxes;
    const card = q(".cine-hero__slot > *");
    this.slot = card ? rel(card.getBoundingClientRect()) : null;
    let right = 0;
    for (const b of boxes) right = Math.max(right, b.x + b.w);
    this.split = !!this.slot && this.slot.x > right - 8;

    // 找空地：每 12px 取樣，離字／卡片（以及畫面邊緣）最遠的點；下緣 35% 會融回底色，不算
    const w = this.w;
    const h = this.h;
    let best = -1;
    let bx = w * 0.8;
    let by = h * 0.25;
    const top = this.split ? 0.1 : 0.04;
    // 左文右卡：只在「字的左緣～搜尋卡」之間找（寬螢幕兩側的留白太靠邊，主角會被切掉）
    let left = w;
    for (const b of boxes) left = Math.min(left, b.x);
    const xmin = this.split ? Math.max(w * 0.06, left - 40) : w * 0.06;
    const xmax = this.split && this.slot ? this.slot.x : w * 0.97;
    for (let y = h * top; y < h * 0.65; y += 12)
      for (let x = xmin; x < xmax; x += 12) {
        const edge = Math.min(x, w - x, y - h * 0.02) * 1.4;
        const d = Math.min(this.gap(x, y), edge);
        // 稍微偏好右上（光源那一側）
        const score = d * (1 + 0.12 * (x / w) - 0.1 * (y / h));
        if (score > best) {
          best = score;
          bx = x;
          by = y;
        }
      }
    // 焦點只在明顯變了才換（標題、副標進場的位移、數字淡入只差十幾 px，不要讓場景跳一下）
    const moved = Math.hypot(bx - this.fx, by - this.fy) > 30;
    if (moved) {
      this.fx = bx;
      this.fy = by;
    }
    this.fr = Math.max(0, this.gap(this.fx, this.fy));
    this.buildMask();
    return moved;
  }

  /** 文字保護遮罩：半解析度、柔邊（用陰影模糊畫一次，之後每格只 drawImage） */
  buildMask() {
    const sc = 0.5;
    const c = this.mask || document.createElement("canvas");
    c.width = Math.max(1, Math.round(this.w * sc));
    c.height = Math.max(1, Math.round(this.h * sc));
    const m = c.getContext("2d");
    if (!m) return;
    m.clearRect(0, 0, c.width, c.height);
    const off = c.width + 200;
    m.shadowColor = "#000";
    m.shadowBlur = 14;
    m.shadowOffsetX = off;
    m.fillStyle = "#000";
    for (const b of this.boxes) {
      const p = 6;
      m.fillRect((b.x - p) * sc - off, (b.y - p) * sc, (b.w + p * 2) * sc, (b.h + p * 2) * sc);
    }
    this.mask = c;
  }

  resize() {
    const r = this.hero.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const sized = w !== this.w || h !== this.h || dpr !== this.dpr;
    if (sized) {
      this.w = w;
      this.h = h;
      this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    // 字的位置可能因為換行、字型載入而變，就算尺寸一樣也重量（遮罩一定更新；構圖只在尺寸或焦點變了才重算）
    const moved = this.measure();
    if (this.scene && (sized || moved)) this.scene.layout();
    this.redraw();
  }

  /** 沒在播的時候（減少動態、畫面外）重畫一張 */
  redraw() {
    if (!this.running && this.scene) this.render(this.reduced ? this.scene.still : this.t, 0);
  }

  render(t: number, dt: number) {
    const g = this.g;
    const sc = this.scene;
    if (!sc) return;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    sc.frame(t, dt);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.shadowBlur = 0;
    g.globalAlpha = 1;
    if (sc.guard > 0 && this.mask) {
      g.globalCompositeOperation = "destination-out";
      g.globalAlpha = sc.guard;
      g.drawImage(this.mask, 0, 0, this.w, this.h);
      g.globalAlpha = 1;
    }
    g.globalCompositeOperation = "source-over";
  }

  parallax() {
    this.px += (this.tx - this.px) * 0.05;
    this.py += (this.ty - this.py) * 0.05;
    if (Math.abs(this.px - this.lpx) > 0.002 || Math.abs(this.py - this.lpy) > 0.002) {
      this.lpx = this.px;
      this.lpy = this.py;
      for (const L of this.layers)
        L.el.style.transform = `translate3d(${(-this.px * 16 * L.k).toFixed(2)}px,${(-this.py * 10 * L.k).toFixed(2)}px,0)`;
    }
  }

  bind() {
    if ("ResizeObserver" in window) {
      let pending = 0;
      new ResizeObserver(() => {
        cancelAnimationFrame(pending);
        pending = requestAnimationFrame(() => this.resize());
      }).observe(this.hero);
    }
    // 標題／副標的進場動畫（位移）跑完、網路字型換上之後再量一次字的位置
    window.setTimeout(() => this.resize(), 1500);
    document.fonts?.ready.then(() => this.resize()).catch(() => {});
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
        this.redraw();
      });
    } catch {
      /* 舊 Safari 沒有 addEventListener */
    }
    new MutationObserver(() => {
      this.light = this.theme();
      this.scene?.paint();
      this.redraw();
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
    const should = visible && !this.reduced && this.mapMoving.size === 0 && !!this.scene;
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
}

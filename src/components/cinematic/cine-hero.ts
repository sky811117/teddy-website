/**
 * CinematicHero 的腳本：場景（canvas）、滑鼠景深視差、關鍵數字 count-up、標題進場完成事件。
 *
 * 場景＝<section data-scene>："dust"（預設，金色光塵）｜"zones"（學區拼圖）｜"routes"（傍晚光軌）｜"radar"（雷達掃描）。
 * 每個場景是 scenes/ 底下一支獨立的檔案，這裡用動態 import 只下載這一頁用到的那一支；
 * 生命週期（畫面外／背景分頁／地圖在動 → 暫停、減少動態 → 靜態畫面、DPR 上限 2、深淺色、視差）在 cine-stage.ts。
 * 驗收用：canvas.__cine = { frames, running, scene … }（不寫 DOM）
 */
import { Stage, type SceneFactory } from "./cine-stage";

const mq = (q: string) => {
  try {
    return window.matchMedia(q).matches;
  } catch {
    return false;
  }
};

const SCENES: Record<string, () => Promise<{ default: SceneFactory }>> = {
  dust: () => import("./scenes/dust"),
  zones: () => import("./scenes/zones"),
  routes: () => import("./scenes/routes"),
  radar: () => import("./scenes/radar"),
};

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
  const stage = new Stage(hero, canvas, ctx);
  const load = SCENES[hero.dataset.scene || "dust"] || SCENES.dust;
  load()
    .then(m => stage.mount(m.default(stage)))
    .catch(() => {
      /* 場景檔下載失敗：保留 CSS 的天空與體積光就好 */
    });
}

document.querySelectorAll<HTMLElement>("[data-cine-hero]").forEach(initHero);

export {};

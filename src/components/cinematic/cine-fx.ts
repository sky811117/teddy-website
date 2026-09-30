/**
 * 電影感共用小腳本（CineFx.astro 會載入；CinematicHero 已內含）
 *
 *  1. 捲動淡入：.cine-reveal 進到畫面才加 .is-in（首屏內的元素一開始就直接可見，不閃）
 *  2. 卡片 3D 傾斜：[data-cine-tilt]（可給角度，例 data-cine-tilt="5"），只在滑鼠裝置、非減少動態
 *     卡片內若有 .cine-card__glow，光暈會跟著滑鼠走（程式在 cine-tilt.ts，頁面上有這種卡片才動態載入）
 *  3. .cine-card 捲進畫面時邊框光掃一次（觸控裝置沒有 hover，至少看得到一次）
 *
 *  動態插入的元素：window.CineFx.reveal(容器或元素)、window.CineFx.tilt(元素)
 */

const mq = (q: string) => {
  try {
    return window.matchMedia(q).matches;
  } catch {
    return false;
  }
};
const reduced = mq("(prefers-reduced-motion: reduce)");
const finePointer = mq("(hover: hover) and (pointer: fine)");

let io: IntersectionObserver | null = null;

function sweepOnce(el: Element) {
  if (reduced || !el.classList.contains("cine-card")) return;
  el.classList.add("is-sweeping");
  window.setTimeout(() => el.classList.remove("is-sweeping"), 1900);
}

function collect(root: ParentNode | Element): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (root instanceof HTMLElement && root.classList.contains("cine-reveal")) out.push(root);
  root.querySelectorAll?.<HTMLElement>(".cine-reveal").forEach(el => out.push(el));
  return out;
}

function reveal(root: ParentNode | Element = document) {
  const els = collect(root).filter(el => !el.classList.contains("is-in"));
  if (!els.length) return;
  if (reduced || !("IntersectionObserver" in window)) {
    els.forEach(el => el.classList.add("is-in"));
    return;
  }
  const vh = window.innerHeight || 800;
  const later: HTMLElement[] = [];
  for (const el of els) {
    const r = el.getBoundingClientRect();
    // 已經在畫面裡（或被隱藏量不到）→ 直接可見，避免加上 class 那一瞬間閃掉
    if ((r.top < vh * 0.94 && r.bottom > 0) || (r.width === 0 && r.height === 0)) el.classList.add("is-in");
    else later.push(el);
  }
  document.documentElement.classList.add("cine-reveal-on");
  if (!later.length) return;
  io ||= new IntersectionObserver(
    entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const t = e.target as HTMLElement;
        t.classList.add("is-in");
        io?.unobserve(t);
        sweepOnce(t);
        // 淡入完就把延遲拿掉，之後 hover 傾斜回正不會卡一下
        if (t.style.getPropertyValue("--cine-d")) window.setTimeout(() => t.style.setProperty("--cine-d", "0ms"), 1400);
      }
    },
    { rootMargin: "0px 0px -6% 0px", threshold: 0.06 }
  );
  later.forEach(el => io!.observe(el));
}

// 卡片 3D 傾斜：只有頁面上有 [data-cine-tilt]（總覽頁的工具卡）才動態載入，工具頁不下載這段
type TiltFn = (el: HTMLElement) => void;
let tiltP: Promise<TiltFn> | null = null;
function tilt(el: HTMLElement) {
  if (!finePointer || reduced) return;
  tiltP ||= import("./cine-tilt").then(m => m.tilt);
  tiltP.then(fn => fn(el)).catch(() => {});
}

function init() {
  reveal(document);
  document.querySelectorAll<HTMLElement>("[data-cine-tilt]").forEach(tilt);
}

declare global {
  interface Window {
    CineFx?: { reveal: typeof reveal; tilt: typeof tilt };
  }
}
window.CineFx = { reveal, tilt };

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
else init();

export {};

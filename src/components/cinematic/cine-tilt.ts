/**
 * 卡片 3D 傾斜（[data-cine-tilt]，可給角度，例 data-cine-tilt="5"）：只在滑鼠裝置、非減少動態。
 * 卡片內若有 .cine-card__glow，光暈會跟著滑鼠走。
 * 只有總覽頁的工具卡用得到：cine-fx.ts 看到頁面上有 [data-cine-tilt] 才動態載入這支（學區、垃圾車頁不下載）。
 */
const mq = (q: string) => {
  try {
    return window.matchMedia(q).matches;
  } catch {
    return false;
  }
};
const finePointer = mq("(hover: hover) and (pointer: fine)");
const reduced = mq("(prefers-reduced-motion: reduce)");

export function tilt(el: HTMLElement) {
  if (!finePointer || reduced || el.dataset.cineTiltBound) return;
  el.dataset.cineTiltBound = "1";
  const max = parseFloat(el.dataset.cineTilt || "") || 6;
  const glow = el.querySelector<HTMLElement>(".cine-card__glow");
  let raf = 0;
  let rect: DOMRect | null = null;
  let sy0 = 0;
  let rx = 0;
  let ry = 0;
  let gx = 0;
  let gy = 0;

  const apply = () => {
    raf = 0;
    el.style.transform = `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translate3d(0,-3px,0)`;
    if (glow) glow.style.transform = `translate3d(${gx.toFixed(1)}px,${gy.toFixed(1)}px,0)`;
  };
  el.addEventListener("pointerenter", e => {
    if (e.pointerType !== "mouse") return;
    el.style.transition = "transform .2s ease-out";
    rect = el.getBoundingClientRect();
    sy0 = window.scrollY;
  });
  el.addEventListener("pointermove", e => {
    if (e.pointerType !== "mouse") return;
    if (!rect) {
      rect = el.getBoundingClientRect();
      sy0 = window.scrollY;
    }
    const top = rect.top - (window.scrollY - sy0);
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - top) / rect.height));
    ry = (x - 0.5) * 2 * max;
    rx = -(y - 0.5) * 2 * max * 0.8;
    gx = x * rect.width;
    gy = y * rect.height;
    if (!raf) raf = requestAnimationFrame(apply);
  });
  el.addEventListener("pointerleave", () => {
    cancelAnimationFrame(raf);
    raf = 0;
    rect = null;
    el.style.transition = "";
    el.style.transform = "";
  });
}

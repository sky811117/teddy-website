/**
 * 2026-11 極簡改版：物件頁專用的小互動（共用的在 ax.ts）。
 * 照片的「上一張／下一張」圓鈕：電腦用滑鼠滑不動橫向的照片（滾輪只會上下捲），所以在照片兩側補兩顆圓鈕。
 *   - 手機用手指滑，圓鈕不顯示（flora-property.css 只在 735 以上、而且是滑鼠裝置才畫出來）。
 *   - 這支有跑起來才把圓鈕打開（.pads.on）；沒有 JavaScript 時圓鈕不出現，照片照樣能點開燈箱。
 *   - 到第一張、最後一張時把對應的圓鈕關掉：用瀏覽器的觀察器判斷，捲動時不跑程式（跟 ax.ts 同一個原則）。
 */
const car = document.querySelector<HTMLElement>(".ax .gal [data-car]");
const pads = document.querySelector<HTMLElement>(".ax .gal .pads");
const prev = pads?.querySelector<HTMLButtonElement>("[data-gal-prev]") ?? null;
const next = pads?.querySelector<HTMLButtonElement>("[data-gal-next]") ?? null;

if (car && pads && prev && next && car.children.length > 1) {
  const calm =
    matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.classList.contains("lite");
  // 一次捲一張的寬度，scroll-snap 會把它對齊到下一張
  const go = (dir: number) =>
    car.scrollBy({
      left: dir * car.clientWidth,
      behavior: calm ? "auto" : "smooth",
    });
  prev.addEventListener("click", () => go(-1));
  next.addEventListener("click", () => go(1));
  pads.classList.add("on");

  if ("IntersectionObserver" in window) {
    const first = car.firstElementChild;
    const last = car.lastElementChild;
    const io = new IntersectionObserver(
      entries =>
        entries.forEach(e => {
          if (e.target === first) prev.disabled = e.isIntersecting;
          if (e.target === last) next.disabled = e.isIntersecting;
        }),
      { root: car, threshold: 0.6 }
    );
    if (first) io.observe(first);
    if (last) io.observe(last);
  } else {
    prev.disabled = false;
  }
}

/**
 * 2026-11 極簡改版：首頁、物件頁（<main class="ax">）共用的互動。
 * 原則：只動位移、縮放、透明度；捲動時不跑程式（交給瀏覽器的觀察器）。沒有 JavaScript 時每一樣都還能用（<details> 原生開合、連結照走）。
 * 1 收起來的字（<details> 裡包一層 .in）：按了才順順地展開；減少動態、.lite 時用瀏覽器原生的開合
 * 2 站內錨點指到收合區塊裡面：先把它打開再捲過去（例：底部詢問列的「詢問」→ 聯絡表單）
 * 3 橫向卡片（[data-car]）：下面的小圓點（[data-dots]）、第幾張（[data-count]）
 * 4 物件頁：捲過 [data-ln-after] 後，上方小列（.ln）滑出來
 * 5 分段切換（.seg）＋月付試算（[data-pay]，公式跟站上試算工具同一條：本息平均攤還）
 * 6 電腦版：四步的說明直接打開（手機收在卡片角落的 ＋ 裡）
 */
const d = document;
const html = d.documentElement;
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches || html.classList.contains("lite");
const hasIO = "IntersectionObserver" in window;

/* 1 */
d.querySelectorAll<HTMLDetailsElement>(".ax details").forEach(det => {
  const sum = det.querySelector<HTMLElement>(":scope > summary");
  const box = det.querySelector<HTMLElement>(":scope > .in");
  if (!sum || !box || calm || !box.animate) return;
  let anim: Animation | null = null;
  sum.addEventListener("click", e => {
    e.preventDefault();
    anim?.cancel();
    const opening = !det.open || det.classList.contains("closing");
    det.classList.toggle("closing", !opening);
    if (opening) det.open = true;
    const h = box.scrollHeight;
    anim = box.animate(
      [
        { height: `${opening ? 0 : h}px`, opacity: opening ? 0 : 1 },
        { height: `${opening ? h : 0}px`, opacity: opening ? 1 : 0 },
      ],
      { duration: Math.max(280, Math.min(560, 240 + h * 0.6)), easing: "cubic-bezier(.2,.8,.2,1)" }
    );
    anim.onfinish = () => {
      if (!opening) {
        det.open = false;
        det.classList.remove("closing");
      }
      anim = null;
    };
  });
});

/* 2 */
const openAround = (id: string) => {
  const t = id ? d.getElementById(id) : null;
  if (!t) return null;
  for (let p = t.closest("details"); p; p = p.parentElement ? p.parentElement.closest("details") : null) p.open = true;
  return t;
};
const hashId = () => {
  try {
    return decodeURIComponent(location.hash.slice(1));
  } catch {
    return "";
  }
};
if (location.hash) openAround(hashId());
addEventListener("hashchange", () => openAround(hashId())?.scrollIntoView());
d.addEventListener(
  "click",
  e => {
    const a = (e.target as Element | null)?.closest?.('a[href^="#"]');
    const href = a?.getAttribute("href");
    if (href && href.length > 1) {
      try {
        openAround(decodeURIComponent(href.slice(1)));
      } catch {
        /* 網址片段解不開就照原本的走 */
      }
    }
  },
  true
);

/* 3 */
d.querySelectorAll<HTMLElement>("[data-car]").forEach(car => {
  const id = car.dataset.car;
  const dots = d.querySelector<HTMLElement>(`[data-dots="${id}"]`);
  const cnt = d.querySelector<HTMLElement>(`[data-count="${id}"]`);
  const items = Array.from(car.children) as HTMLElement[];
  if (dots) dots.innerHTML = items.map(() => "<i></i>").join("");
  const ds = dots ? Array.from(dots.children) : [];
  const set = (i: number) => {
    ds.forEach((x, k) => x.classList.toggle("on", k === i));
    // 預設「2 / 6」；元素上有 data-fmt 就照它（例：物件頁用「第 {i} 張」，總數在旁邊那句話裡，不重複講）
    if (cnt) cnt.textContent = (cnt.dataset.fmt || "{i} / {n}").replace("{i}", String(i + 1)).replace("{n}", String(items.length));
  };
  set(0);
  if (!hasIO) return;
  const io = new IntersectionObserver(
    es => es.forEach(x => x.isIntersecting && set(items.indexOf(x.target as HTMLElement))),
    { root: car, threshold: 0.6 }
  );
  items.forEach(it => io.observe(it));
});

/* 4 */
const ln = d.querySelector<HTMLElement>(".ax-ln, .ax .ln");
const mark = d.querySelector<HTMLElement>("[data-ln-after]");
if (ln && mark && hasIO) {
  new IntersectionObserver(es => {
    const x = es[0];
    const on = !x.isIntersecting && x.boundingClientRect.top < 0;
    ln.classList.toggle("on", on);
    ln.toggleAttribute("inert", !on);
  }).observe(mark);
}

/* 5 */
d.querySelectorAll<HTMLElement>(".ax .seg").forEach(seg => {
  const bs = Array.from(seg.querySelectorAll<HTMLButtonElement>("button"));
  seg.style.setProperty("--n", String(bs.length));
  bs.forEach((b, i) => {
    if (b.getAttribute("aria-pressed") === "true") seg.style.setProperty("--i", String(i));
    b.addEventListener("click", () => {
      seg.style.setProperty("--i", String(i));
      bs.forEach(x => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
      seg.dispatchEvent(new CustomEvent("pick", { detail: b.dataset.v }));
    });
  });
});
const pay = d.querySelector<HTMLElement>("[data-pay]");
if (pay) {
  const price = Number(pay.dataset.price);
  const rate = Number(pay.dataset.rate) / 100 / 12;
  const st: Record<string, number> = { ratio: Number(pay.dataset.ratio) || 0.8, years: Number(pay.dataset.years) || 30 };
  const outs = d.querySelectorAll<HTMLElement>("[data-pay-out]");
  const calc = () => {
    const P = price * st.ratio;
    const n = st.years * 12;
    const m = (P * rate) / (1 - Math.pow(1 + rate, -n));
    outs.forEach(o => (o.textContent = m.toFixed(1)));
  };
  pay.querySelectorAll<HTMLElement>(".seg").forEach(seg => {
    seg.addEventListener("pick", e => {
      const k = seg.dataset.k;
      if (!k) return;
      st[k] = Number((e as CustomEvent).detail);
      calc();
    });
  });
}

/* 6 */
if (matchMedia("(min-width: 735px)").matches) {
  d.querySelectorAll<HTMLDetailsElement>(".ax .step details").forEach(x => (x.open = true));
}

// 讓 TypeScript 把這支當成模組（不然頂層的 const 會跟 flora.ts 的同名變數撞在一起）
export {};

/**
 * 2026-11 花店風改版：全站共用互動（每頁全新載入，不用 ClientRouter）。
 * 1 頁首：手機往下捲收起、往上回來；「目錄」開 <dialog>
 * 2 詢問列：跟著看的那一間換字（中線帶裡最後一個 [data-ask-main] 決定）；頁面上看得到別的實心按鈕時讓位
 * 3 點詢問列的 LINE：先把寫好的話複製起來（個人 LINE 不能預填），再照原連結走 /go/line（不攔截導覽）
 * 4 進場：只有這裡會加隱藏狀態（data-rs=wait）；第一屏與已捲過的不藏；只跑一次
 * 5 按下：放開立刻亮、按住 180ms 才亮（iPhone 的 :active 不可靠），滑動不閃
 * 6 頁尾：放得下才黏在最底被白紙蓋住（.stick）
 * 7 掉幀煞車：第一次捲動量 48 幀，超過 40ms 的多於 12 幀 → .lite（這個分頁之後都輕量）
 */
const html = document.documentElement;
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const mq = (q: string) => matchMedia(q).matches;

/* 1 頁首與目錄 */
const hdr = document.querySelector<HTMLElement>("[data-hdr]");
const menu = document.getElementById("site-menu") as HTMLDialogElement | null;
const menuBtn = document.getElementById("menu-btn");
let lastY = scrollY;
addEventListener(
  "scroll",
  () => {
    // 2026-11 極簡改版：頁首一直在，離開最上面才出現一條細線（不再往下捲就收起來）
    const y = scrollY;
    if (hdr && y > 4 !== lastY > 4) hdr.classList.toggle("sc", y > 4);
    lastY = y;
  },
  { passive: true }
);
if (menu && menuBtn) {
  const setOpen = (open: boolean) => menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
  menuBtn.addEventListener("click", () => {
    if (menu.open) menu.close();
    else {
      menu.showModal();
      setOpen(true);
    }
  });
  menu.addEventListener("close", () => setOpen(false));
  menu.addEventListener("click", e => {
    if (e.target === menu) menu.close(); // 點暗層
  });
  menu.querySelector("[data-menu-close]")?.addEventListener("click", () => menu.close());
}

/* 2 詢問列 */
const bar = document.querySelector<HTMLElement>("[data-askbar]");
const link = bar?.querySelector<HTMLAnchorElement>("[data-ask-link]") ?? null;
const mainEl = link?.querySelector<HTMLElement>("[data-ask-main]") ?? null;
const subEl = link?.querySelector<HTMLElement>("[data-ask-sub]") ?? null;
const toast = document.querySelector<HTMLElement>("[data-toast]");
const pageTitle = (document.querySelector("main h1")?.textContent || document.title.split("|")[0] || "")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, 60);

type Ask = { main: string; sub: string; href: string; msg: string };
const defAsk = (): Ask => ({
  main: link?.dataset.defMain ?? "",
  sub: link?.dataset.defSub ?? "",
  href: link?.dataset.defHref ?? link?.getAttribute("href") ?? "",
  msg:
    link?.dataset.msg ||
    (location.pathname === "/"
      ? "你好，我從官網首頁來，想問一下"
      : `你好，我在官網看到「${pageTitle}」，想問一下`),
});
let current = defAsk();
const apply = (a: Ask) => {
  if (!link || !mainEl || !subEl) return;
  if (mainEl.textContent === a.main && subEl.textContent === a.sub && link.getAttribute("href") === a.href) {
    current = a;
    return;
  }
  current = a;
  link.classList.add("swap");
  window.setTimeout(
    () => {
      mainEl.textContent = a.main;
      subEl.textContent = a.sub;
      link.setAttribute("href", a.href);
      link.classList.remove("swap");
    },
    reduce ? 0 : 180
  );
};
if (link) {
  const live = new Set<Element>();
  const followers = Array.from(document.querySelectorAll<HTMLElement>("[data-ask-main]")).filter(
    el => !bar?.contains(el)
  );
  // 只在手機跟：桌機一排好幾間，沒有「現在這一間」，硬跟一定會錯（花店規格同理）
  if (followers.length && mq("(max-width: 899px)")) {
    const io = new IntersectionObserver(
      entries => {
        entries.forEach(e => (e.isIntersecting ? live.add(e.target) : live.delete(e.target)));
        let last: HTMLElement | null = null;
        followers.forEach(el => {
          if (live.has(el)) last = el;
        });
        const el = last as HTMLElement | null;
        apply(
          el
            ? {
                main: el.dataset.askMain || defAsk().main,
                sub: el.dataset.askSub || defAsk().sub,
                href: el.dataset.askHref || defAsk().href,
                msg: el.dataset.askMsg || defAsk().msg,
              }
            : defAsk()
        );
      },
      { rootMargin: "-30% 0px -60% 0px" }
    );
    followers.forEach(el => io.observe(el));
  }

  /* 3 先複製再開 LINE（不 preventDefault：連結照常走 /go/line → LINE，複製失敗也照開） */
  link.addEventListener("click", () => {
    const msg = current.msg;
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(msg).catch(() => {});
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (toast) {
      toast.textContent = ok ? "已複製訊息，到 LINE 貼上就好" : "沒複製成功，到 LINE 直接打字問就好";
      toast.hidden = false;
      requestAnimationFrame(() => toast.classList.add("on"));
      window.setTimeout(() => {
        toast.classList.remove("on");
        window.setTimeout(() => (toast.hidden = true), 320);
      }, 4200);
    }
  });

  /* 看得到頁面上的實心按鈕時讓位（同一畫面只有一顆實心按鈕） */
  const solids = Array.from(
    document.querySelectorAll<HTMLElement>("main .btn-line, main .btn-primary, main [data-hide-ask]")
  );
  if (bar && solids.length) {
    const vis = new Set<Element>();
    const ho = new IntersectionObserver(
      entries => {
        entries.forEach(e => (e.isIntersecting ? vis.add(e.target) : vis.delete(e.target)));
        bar.classList.toggle("hide", vis.size > 0);
      },
      { rootMargin: "0px 0px -80px 0px" }
    );
    solids.forEach(el => ho.observe(el));
  }
}

/* 4 進場 */
if (html.classList.contains("motion") && !html.classList.contains("lite")) {
  const ro = new IntersectionObserver(
    entries =>
      entries.forEach(e => {
        if (e.isIntersecting) {
          (e.target as HTMLElement).dataset.rs = "in";
          ro.unobserve(e.target);
        }
      }),
    { rootMargin: "0px 0px -12% 0px" }
  );
  const waiting = Array.from(document.querySelectorAll<HTMLElement>("[data-r]")).filter(
    el => el.getBoundingClientRect().top > innerHeight * 0.92
  );
  waiting.forEach(el => {
    el.dataset.rs = "wait";
    ro.observe(el);
  });
  // 保底：IO 沒觸發（極快捲動、背景分頁）也要放出來
  const sweep = () => {
    waiting.forEach(el => {
      if (el.dataset.rs === "wait" && el.getBoundingClientRect().top < innerHeight) el.dataset.rs = "in";
    });
  };
  addEventListener("scroll", sweep, { passive: true });
}

/* 5 按下 */
addEventListener(
  "pointerdown",
  e => {
    const el = (e.target as Element)?.closest?.("a,button,summary") as HTMLElement | null;
    if (!el) return;
    const timer = window.setTimeout(() => el.setAttribute("data-press", ""), 180);
    const off = () => {
      clearTimeout(timer);
      const internal = el instanceof HTMLAnchorElement && el.origin === location.origin && !el.hash;
      window.setTimeout(() => el.removeAttribute("data-press"), internal ? 1200 : 160);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", cancel);
      removeEventListener("scroll", cancel);
    };
    const up = () => {
      el.setAttribute("data-press", "");
      off();
    };
    const cancel = () => {
      clearTimeout(timer);
      el.removeAttribute("data-press");
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", cancel);
      removeEventListener("scroll", cancel);
    };
    addEventListener("pointerup", up, { once: true });
    addEventListener("pointercancel", cancel, { once: true });
    addEventListener("scroll", cancel, { once: true, passive: true });
  },
  { passive: true }
);

/* 6 （花店版的「頁尾黏底」拿掉了：極簡版的頁尾就是一般頁尾） */
if (hdr && scrollY > 4) hdr.classList.add("sc");

/* 7 掉幀煞車 */
if (html.classList.contains("motion") && !html.classList.contains("lite") && "requestAnimationFrame" in window) {
  let frames = 0,
    slow = 0,
    prev = 0,
    armed = false;
  const tick = (t: number) => {
    if (prev && t - prev > 40) slow++;
    prev = t;
    if (++frames < 48) requestAnimationFrame(tick);
    else if (slow > 12) {
      html.classList.add("lite");
      try {
        sessionStorage.setItem("fl-lite", "1");
      } catch {
        /* 私密模式 */
      }
      document.querySelectorAll<HTMLElement>('[data-rs="wait"]').forEach(el => (el.dataset.rs = "in"));
    }
  };
  addEventListener(
    "scroll",
    () => {
      if (armed) return;
      armed = true;
      requestAnimationFrame(tick);
    },
    { passive: true, once: true }
  );
}

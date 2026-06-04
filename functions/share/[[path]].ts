/**
 * Cloudflare Pages Function — /share/*
 *
 * Reverse-proxy 客戶分享頁（猜你喜歡 + 客戶推薦）。
 * 內容實際存在 sky811117.github.io/teddy-shares/{id}/index.html，
 * 但客戶看到的網址掛在個人網站 /share/{id}/ 下：
 *   - 流量算進個人網站（Cloudflare Analytics + 注入 GA4）
 *   - 客戶有機會點 footer CTA 逛進在售物件頁
 *   - 網址漂亮、藏掉 sky811117.github.io
 *
 * 路由：functions/share/[[path]].ts → 接 /share/、/share/{id}、/share/{id}/xxx
 * 兩種頁面都落在 teddy-shares/{share_id}/index.html，一條規則全 cover。
 */

const UPSTREAM = "https://sky811117.github.io/teddy-shares/";
const GA4_ID = "G-WMQCYK4L88";
const SITE = "https://teddy-website-blog.pages.dev";

// 「回官網」區塊 — proxy 層注入，讓每個分享頁（新舊全部）底部都能逛回官網。
// 自帶 inline style，不依賴頁面既有 CSS；guard 認標題字串避免重複注入。
const BACK_TO_SITE = `
<div style="max-width:1100px;margin:32px auto 48px;padding:0 16px;font-family:-apple-system,'PingFang TC','Microsoft JhengHei',sans-serif;">
  <div style="background:#fff;border:1px solid rgba(212,185,150,.5);border-radius:16px;padding:26px 20px;text-align:center;box-shadow:0 2px 12px rgba(60,45,20,.08);">
    <div style="font-size:18px;font-weight:700;color:#6b5b3a;margin-bottom:16px;line-height:1.6;">🏡 想看更多好屋？歡迎逛逛我的房仲官網</div>
    <div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center;">
      <a href="${SITE}/properties" target="_blank" rel="noopener" style="display:inline-block;padding:13px 26px;border-radius:24px;font-size:16px;font-weight:700;background:#6B8E23;color:#fff;text-decoration:none;">在售物件</a>
      <a href="${SITE}/about" target="_blank" rel="noopener" style="display:inline-block;padding:13px 26px;border-radius:24px;font-size:16px;font-weight:700;background:#fff;color:#6B8E23;border:1.5px solid #6B8E23;text-decoration:none;">認識景泰</a>
      <a href="${SITE}/" target="_blank" rel="noopener" style="display:inline-block;padding:13px 26px;border-radius:24px;font-size:16px;font-weight:700;background:#fff;color:#6B8E23;border:1.5px solid #6B8E23;text-decoration:none;">房仲官網</a>
    </div>
  </div>
</div>`;

type EventContext = {
  params: { path?: string | string[] };
  request: Request;
};

export const onRequest = async ({
  params,
  request,
}: EventContext): Promise<Response> => {
  // [[path]] catch-all → params.path 是 segment 陣列
  let parts: string[] = [];
  const raw = params.path;
  if (Array.isArray(raw)) parts = raw;
  else if (typeof raw === "string" && raw) parts = [raw];
  parts = parts.filter(p => p !== "");

  // 沒帶 id → 導去在售物件頁（自然引流，不留死頁）
  if (parts.length === 0) {
    const origin = new URL(request.url).origin;
    return Response.redirect(`${origin}/properties`, 302);
  }

  let path = parts.join("/");
  const last = parts[parts.length - 1] || "";
  // 無副檔名 = 目錄 → 補尾斜線讓 GitHub Pages 回 index.html
  if (!last.includes(".")) path += "/";

  let upstream: Response;
  try {
    upstream = await fetch(UPSTREAM + path, {
      headers: { "User-Agent": "teddy-website-share-proxy" },
      // 邊快取 30s：加速客戶載入、減 GitHub Pages 壓力；regen 同 id 最多延遲 30s
      cf: { cacheTtl: 30, cacheEverything: true },
    });
  } catch {
    return new Response("分享頁暫時無法載入，請稍後再試。", {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const ct = upstream.headers.get("content-type") || "";

  // 非 HTML（圖片 / 其他資源）原樣回傳
  if (!ct.includes("text/html")) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "content-type": ct || "application/octet-stream" },
    });
  }

  let html = await upstream.text();

  // 注入 GA4 — 讓個人網站 GA 也算到這次造訪（頁面本身原本沒有 gtag）
  if (!html.includes(GA4_ID) && html.includes("</head>")) {
    const ga =
      `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA4_ID}"></script>` +
      `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}` +
      `gtag('js',new Date());gtag('config','${GA4_ID}');</script>`;
    html = html.replace("</head>", ga + "</head>");
  }

  // 注入「回官網」區塊 — 新舊頁面只要走 proxy 都會有底部引流區塊。
  // guard：頁面已含此區塊（後端新版也會 bake）就不重複注入。
  if (!html.includes("想看更多好屋") && html.includes("</body>")) {
    html = html.replace("</body>", BACK_TO_SITE + "</body>");
  }

  return new Response(html, {
    status: upstream.status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // 雙保險：客戶頁不進搜尋引擎（頁面 meta 也有 noindex）
      "x-robots-tag": "noindex, nofollow",
      "cache-control": "public, max-age=30",
    },
  });
};

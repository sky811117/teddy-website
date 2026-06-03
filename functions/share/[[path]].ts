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

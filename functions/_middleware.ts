/**
 * 舊網址 teddy-website-blog.pages.dev → 新網域 teddy-house.tw 的 301 轉址（2026-10-03 搬家）
 *
 * 只在「主機名剛好是舊的 pages.dev」時轉；預覽部署（<hash>.teddy-website-blog.pages.dev）
 * 和新網域本身都直接放行（ctx.next()），所以新網域上這支只是多一次放行，不改任何內容。
 *
 * ⛔ 這些路徑在舊網址上「不轉」，因為站外有東西寫死舊網址在用：
 *   /cards/*      → 房仲工作站\420_IG_API 發文腳本的 BASE_URL，IG API 從這裡抓圖（IG 不一定跟轉址）
 *   /share/*      → 已經用 LINE 傳給客戶的推薦頁（teddy-share-app 的 PAGES_BASE_URL）
 *   /ig_callback、/th_auth/* → Meta App 登記的 OAuth 回呼網址
 *   /api/*、/go/* → 表單後端與 LINE 轉址，兩個網域都要能用
 * 圖片、/_astro/* 等靜態檔在 public/_routes.json 的 exclude 裡，根本不會進到這支（省免費額度）。
 *
 * 只轉 GET/HEAD：POST（表單）轉成 301 會被瀏覽器改成 GET、資料會掉。
 */
const OLD_HOST = "teddy-website-blog.pages.dev";
const NEW_ORIGIN = "https://teddy-house.tw";
const KEEP_ON_OLD_HOST = [
  /^\/cards\//,
  /^\/share(?:\/|$)/,
  /^\/ig_callback(?:\/|$)/,
  /^\/th_auth(?:\/|$)/,
  /^\/api\//,
  /^\/go\//,
];

// 跟其他 functions 一樣自己宣告最小型別（astro check 會檢查 functions/，沒有 @cloudflare/workers-types）
type EventContext = {
  request: Request;
  next: () => Promise<Response>;
};

export const onRequest = async (ctx: EventContext): Promise<Response> => {
  try {
    const url = new URL(ctx.request.url);
    const method = ctx.request.method;
    if (
      url.hostname === OLD_HOST &&
      (method === "GET" || method === "HEAD") &&
      !KEEP_ON_OLD_HOST.some(re => re.test(url.pathname))
    ) {
      return new Response(null, {
        status: 301,
        headers: {
          Location: NEW_ORIGIN + url.pathname + url.search,
          "Cache-Control": "public, max-age=86400",
        },
      });
    }
  } catch {
    // 轉址判斷出錯就照常回原頁，絕不能讓整站掛掉
  }
  return ctx.next();
};

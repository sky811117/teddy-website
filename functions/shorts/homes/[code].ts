/**
 * 物件下架後單支影片頁不再產出：舊網址帶回物件短影音列表，不佔 _redirects 名額（上限 2,000 條）。
 * 頁面還在就原樣放行。
 */
type EventContext = { request: Request; next: () => Promise<Response> };

export const onRequest = async ({ request, next }: EventContext): Promise<Response> => {
  const res = await next();
  if (res.status !== 404 || (request.method !== "GET" && request.method !== "HEAD")) return res;
  return Response.redirect(new URL("/shorts/homes/", request.url).href, 302);
};

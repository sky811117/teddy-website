/** 新聞片被撤下後單支頁不再產出：舊網址帶回房市新聞短影音列表。頁面還在就原樣放行。 */
type EventContext = { request: Request; next: () => Promise<Response> };

export const onRequest = async ({ request, next }: EventContext): Promise<Response> => {
  const res = await next();
  if (res.status !== 404 || (request.method !== "GET" && request.method !== "HEAD")) return res;
  return Response.redirect(new URL("/shorts/news/", request.url).href, 302);
};

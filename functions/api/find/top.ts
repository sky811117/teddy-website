/**
 * Cloudflare Pages Function — /api/find/top（等待小遊戲「蓋大樓」排行榜：本週與總榜，帶 ?id= 時附自己的名次）
 * 薄包裝：所有邏輯在 src/lib/find/handlers.ts 的 handleTop（可離線測試）。
 * 所需環境變數見 handlers.ts 的 Env；位址與密鑰只放 Cloudflare 後台環境變數，不進 repo。
 */
import { handleTop } from "../../../src/lib/find/handlers";
import type { FindCtx } from "../../../src/lib/find/handlers";

export const onRequest = (ctx: FindCtx): Promise<Response> => handleTop(ctx);

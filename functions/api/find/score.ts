/**
 * Cloudflare Pages Function — /api/find/score（等待小遊戲「蓋大樓」送成績）
 * 薄包裝：所有邏輯在 src/lib/find/handlers.ts 的 handleScore（可離線測試）。
 * 所需環境變數見 handlers.ts 的 Env；位址與密鑰只放 Cloudflare 後台環境變數，不進 repo。
 */
import { handleScore } from "../../../src/lib/find/handlers";
import type { FindCtx } from "../../../src/lib/find/handlers";

export const onRequest = (ctx: FindCtx): Promise<Response> => handleScore(ctx);

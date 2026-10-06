/**
 * Cloudflare Pages Function — /api/find/contact
 * 薄包裝：所有邏輯在 src/lib/find/handlers.ts（可離線測試）。
 * 所需環境變數見 handlers.ts 的 Env；位址與密鑰只放 Cloudflare 後台環境變數，不進 repo。
 */
import { handleContact } from "../../../src/lib/find/handlers";
import type { FindCtx } from "../../../src/lib/find/handlers";

export const onRequest = (ctx: FindCtx): Promise<Response> => handleContact(ctx);

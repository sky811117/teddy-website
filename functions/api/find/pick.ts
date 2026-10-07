/**
 * Cloudflare Pages Function — /api/find/pick（推薦頁「傳給景泰」：客人選的物件＋聯絡方式 → 景泰的 Telegram）
 * 薄包裝：所有邏輯在 src/lib/find/pick.ts 的 handlePick（可離線測試）。
 * 所需環境變數：FIND_TG_TOKEN／FIND_TG_CHAT（沒有就用 CONTACT_TG_TOKEN／CONTACT_TG_CHAT），只放 Cloudflare 後台，不進 repo。
 */
import { handlePick } from "../../../src/lib/find/pick";
import type { FindCtx } from "../../../src/lib/find/handlers";

export const onRequest = (ctx: FindCtx): Promise<Response> => handlePick(ctx);

/**
 * 找房小幫手：給客人看的固定訊息表。瀏覽器端只會看到這裡的字，不含任何上游文字、錯誤堆疊或內部代碼。
 * 降級（家用機忙、離線、深夜…）一律走 200＋status:"degraded"，不用錯誤碼；訊息絕不出現「次數」「用完」「超過上限」。
 */
export type ErrCode =
  | "E_BAD_REQUEST"
  | "E_CONSENT"
  | "E_ORIGIN"
  | "E_HUMAN"
  | "E_TOO_LARGE"
  | "E_RATE"
  | "E_NOT_FOUND"
  | "E_METHOD"
  | "E_FORWARD";

export const ERR: Record<ErrCode, { http: number; msg: string; retry: boolean }> = {
  E_BAD_REQUEST: { http: 400, msg: "資料格式不正確，請重新整理頁面後再試一次。", retry: false },
  E_CONSENT: { http: 400, msg: "留聯絡方式需要先勾選同意。", retry: false },
  E_ORIGIN: { http: 403, msg: "請從網站頁面使用。", retry: false },
  E_HUMAN: { http: 403, msg: "沒能完成人機驗證，請按下面的「再試一次」。", retry: true },
  E_TOO_LARGE: { http: 413, msg: "內容太長了，請縮短一點再送出。", retry: false },
  E_RATE: { http: 429, msg: "操作太頻繁，請稍等一下再試。", retry: true },
  E_NOT_FOUND: { http: 404, msg: "找不到這筆需求，可能已經過期了。", retry: false },
  E_METHOD: { http: 405, msg: "", retry: false },
  // 上游暫時送不出去時，submit 走降級收件（200），不會用到這個；留給 contact／feedback 之類不能降級的端點
  E_FORWARD: { http: 200, msg: "暫時送不出去，請稍後再試一次。", retry: true },
};

export type DegradeKind = "general" | "busy" | "night";
/** 匿名（沒留聯絡方式）：景泰沒辦法主動回覆，所以不能說「景泰會回覆你」，而是請客人留聯絡方式或晚點回來看 */
export const DEGRADE_MSG: Record<DegradeKind, string> = {
  general: "需求記下來了。想收到回覆，請留 LINE 或電話；不留的話，晚點回來這頁看看。",
  busy: "現在比較多人，需求先記下來了。想收到回覆，請留 LINE 或電話；不留的話，晚點回來看看。",
  night: "現在是深夜，需求先記下來了。想明天收到回覆，請留 LINE 或電話。",
};
/** 有留聯絡方式：景泰用客人留的方式回覆 */
export const DEGRADE_MSG_CONTACT: Record<DegradeKind, string> = {
  general: "收到了，景泰會用你留的方式回覆你。",
  busy: "現在比較多人，景泰會用你留的方式回覆你。",
  night: "現在是深夜，景泰明天一早會用你留的方式回覆你。",
};
export const DEGRADE_LOST_MSG = "目前沒能把你的需求送出去，你可以複製下面的內容，直接傳給景泰。";

export const STATUS_MSG = {
  queued: "收到了，正在排隊…",
  searching: "為你整理中…",
  building: "快好了，正在做成一頁方便看的…",
  done: "整理好了。",
  empty: "這次沒有找到完全符合的。",
  expired: ERR.E_NOT_FOUND.msg,
} as const;

export const STAGE_OF: Record<string, "q" | "s" | "b" | "d"> = {
  queued: "q",
  searching: "s",
  building: "b",
  done: "d",
  empty: "d",
  degraded: "d",
  expired: "d",
};
// 紅隊 RT-05：輪詢間隔拉長（每一次輪詢都吃一次 Function 額度）；前端另有下限 6 秒、背景分頁 30 秒
export const POLL_MS: Record<string, number> = { queued: 6000, searching: 6000, building: 6000 };

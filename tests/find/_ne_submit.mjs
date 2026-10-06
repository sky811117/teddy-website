// 測試用：提交本文驗證（validateSubmit）的瀏覽器端版本。
// 2026-10-06 R4：need-extract.js 的位元組預算只剩約 130 位元組，而 validateSubmit 只有測試在呼叫（find-app.js 只用 validateContact；
// 伺服器端用 src/lib/find/schema.ts 的同名函式，同一份共用夾具 need_fixtures.json 的 validate 案例也在 functions.test.mjs 逐案跑過），
// 所以從正式出貨的檔案搬到這裡。這裡只用 NeedExtract 對外的小零件（normalizeFields／normalizeContext／validateContact／normText／CONSENT_V）
// 組起來，行為與搬走前的 validateSubmit 一字不差；extract.test.mjs 與 extract_rt11.test.mjs 繼續用它驗瀏覽器端的零件對共用夾具。
export function validateSubmit(NE, body) {
  const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
  const nul = v => v === null || v === undefined;
  const cpLen = s => Array.from(s).length;
  const bad = { out: null, err: "E_BAD_REQUEST" };
  if (!isObj(body) || body.v !== 1) return bad;
  if (typeof body.idem !== "string" || !/^[A-Za-z0-9_\-]{22}$/.test(body.idem)) return bad;
  if (!nul(body.fields) && !isObj(body.fields)) return bad;
  if (!nul(body.context) && !isObj(body.context)) return bad;
  let ft = nul(body.free_text) ? "" : body.free_text;
  if (typeof ft !== "string") return bad;
  ft = NE.normText(ft).trim();
  if (cpLen(ft) > 300) return { out: null, err: "E_TOO_LARGE" };
  const rc = body.contact, rcs = body.consent;
  let contact = null, consent = null;
  if (!nul(rc) && !isObj(rc)) return bad;
  if (!nul(rc) && ["name", "line", "phone", "email", "note"].some(k => typeof rc[k] === "string" && rc[k].trim())) {
    if (!(isObj(rcs) && rcs.contact === true && rcs.v === NE.CONSENT_V)) return { out: null, err: "E_CONSENT" };
    const vc = NE.validateContact(rc);
    if (vc.err) return { out: null, err: vc.err };
    if (vc.contact) { contact = vc.contact; consent = { contact: true, v: NE.CONSENT_V }; }
  }
  let refine = body.refine_of;
  if (!nul(refine) && !(typeof refine === "string" && /^a[A-Za-z0-9_\-]{22}$/.test(refine))) refine = null;
  return {
    err: null,
    out: {
      v: 1, idem: body.idem, fields: NE.normalizeFields(body.fields || {}).fields, context: NE.normalizeContext(body.context || {}).context,
      free_text: ft, skip: body.skip === true, contact, consent, refine_of: nul(refine) ? null : refine,
    },
  };
}

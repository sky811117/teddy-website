// 2026-10-07 景泰實測：家用機做好推薦頁（qs＋8 碼代號），官網卻因為只認 qa＋30 碼而改顯示「需求記下來了」。
import test from "node:test";
import assert from "node:assert/strict";
import { bundleTs } from "./_helpers.mjs";

const S = (await bundleTs("src/lib/find/schema.ts")).mod;

test("推薦頁網址：qa＋30 碼（S-1）與 qs＋8 碼（產生器代號）都收；其他一律不收", () => {
  for (const ok of [
    "https://teddy-house.tw/share/qsLIm0noE4/",
    "https://teddy-house.tw/share/qsN12dW0DS/",
    "https://teddy-house.tw/share/qa" + "abcd" + "abcdefghijklmnopqrstuvwxyz".slice(0, 26) + "/",
  ]) assert.ok(S.SHARE_URL_RE.test(ok), ok);
  for (const bad of [
    "https://teddy-house.tw/share/qsLIm0noE4",          // 少結尾斜線
    "https://teddy-house.tw/share/qsLIm0noE/",          // 7 碼
    "https://teddy-house.tw/share/qsLIm0noE45/",        // 9 碼
    "https://teddy-house.tw/share/qs-Im0noE4/",          // 怪字元
    "https://evil.example/share/qsLIm0noE4/",
    "http://teddy-house.tw/share/qsLIm0noE4/",
    "https://teddy-house.tw/share/xxLIm0noE4/",
    "https://teddy-house.tw/share/qsLIm0noE4/?x=1",
  ]) assert.ok(!S.SHARE_URL_RE.test(bad), bad);
});

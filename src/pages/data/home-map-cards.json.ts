/**
 * /data/home-map-cards.json — 首頁在售地圖點開小卡要用的資料
 * （每間一列：物件代號、權狀坪數、社區名或路段、封面縮圖；列順序跟 /data/home-map.json 一樣）
 *
 * 內容由 getHomeMapData() 算，跟首頁、/data/home-map.json 共用同一份（一次 build 只算一次）。
 * /data/* 快取一天，引用這個網址時要帶 ?v=（getHomeMapData() 回傳的 ver）。
 */
import type { APIRoute } from "astro";
import { getHomeMapData } from "@/utils/homeMapData";

export const GET: APIRoute = async () => {
  const { cards } = await getHomeMapData();
  return new Response(cards, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
};

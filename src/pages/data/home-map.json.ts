/**
 * /data/home-map.json — 首頁在售地圖的點資料
 * （每間一列：行政區、總價、房數、類型、新上架、位置；欄位說明見 src/utils/homeMapData.ts）
 *
 * 內容由 getHomeMapData() 算，跟首頁、/data/home-map-cards.json 共用同一份（一次 build 只算一次）。
 * /data/* 快取一天，引用這個網址時要帶 ?v=（getHomeMapData() 回傳的 ver）。
 */
import type { APIRoute } from "astro";
import { getHomeMapData } from "@/utils/homeMapData";

export const GET: APIRoute = async () => {
  const { points } = await getHomeMapData();
  return new Response(points, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
};

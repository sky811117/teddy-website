/**
 * 「權狀坪數／單價含不含車位」的口徑判斷（2026-10-03，稽核 X002）
 *
 * properties-sync 寫進 frontmatter 的 area 是權狀坪數（pin_regArea），
 * pricePerPing ＝ 總價 ÷ 權狀坪數，跟公司前台的算法一致、不拆車位。
 * 大樓／華廈有產權的固定車位（坡道平面、坡道機械、昇降機械…）車位坪數
 * 登記在權狀裡、車位價格也含在總價裡，所以頁面上的「單價」其實是含車位口徑，
 * 跟社區文、實價登錄那種「扣車位」單價不能直接比。
 *
 * 判斷只認「大樓／華廈類 + 產權固定車位」：
 *   - 透天、別墅、土地、農舍、廠房的車位多半是自有地／庭院／車庫，不在權狀裡另計
 *   - 「停自有地」「庭院」「獨立車庫」「排隊」「塔式」不是產權車位
 * ⚠️ 排除條件不准放寬：誤標「含車位」等於製造新的不實揭露。
 *
 * 物件詳情頁（src/pages/properties/[...slug].astro）與列表卡
 * （src/pages/properties/_components/PropertyCard.astro）共用這一份。
 */

/** 物件 markdown body 裡「**類型**：XXX」那一行（properties-sync 產的，最準） */
export function bodyPropertyType(body?: string): string | undefined {
  const m = body?.match(/\*\*類型\*\*：\s*([^\n\r]+)/);
  return m?.[1]?.trim() || undefined;
}

export function areaIncludesParking(parking?: string, propertyType?: string): boolean {
  const p = parking ?? "";
  return (
    /坡道|機械|固定車位/.test(p) &&
    !/自有地|庭院|獨立車庫|排隊|塔式/.test(p) &&
    !/透天|別墅|土地|農|廠房/.test(propertyType ?? "")
  );
}

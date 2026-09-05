import type { CollectionEntry } from "astro:content";
import { postFilter } from "./postFilter";
import { slugifyStr } from "./slugify";

export type Tag = {
  /** slug used in URLs (/tags/<tag>/) */
  tag: string;
  /** original label for display（同一個 slug 取第一次出現的寫法） */
  tagName: string;
  /** 掛了幾篇已發布文章 */
  count: number;
};

/**
 * 跟 scripts/sitemap-lastmod.mjs THIN_TAG_MIN_POSTS 同值：
 * 掛不到 3 篇文章的 tag 視為薄內容 — /tags/ 索引收進「更多」摺疊、
 * tag 頁輸出 noindex,follow、sitemap 不收。兩邊要一起改。
 */
export const THIN_TAG_MIN_POSTS = 3;

/**
 * Builds a de-duplicated tag list from posts, with post counts.
 *
 * - Drafts and scheduled posts are excluded via `postFilter()`
 * - `tag` is the slug used in URLs; `tagName` is the original label for display
 * - Uniqueness is based on the slug (so differently-cased labels collapse)
 * - Sorted by count desc, then slug asc（之前依 slug 排，/tags/ 前排全是 2026 / 5168 / 591）
 */
export function getUniqueTags(posts: CollectionEntry<"posts">[]): Tag[] {
  const bySlug = new Map<string, Tag>();

  for (const post of posts.filter(postFilter)) {
    // 同一篇文章重複掛同一個 tag 只算一次
    const seen = new Set<string>();
    for (const tagName of post.data.tags) {
      const tag = slugifyStr(tagName);
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      const existing = bySlug.get(tag);
      if (existing) existing.count++;
      else bySlug.set(tag, { tag, tagName, count: 1 });
    }
  }

  return [...bySlug.values()].sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag)
  );
}

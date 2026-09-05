import type { CollectionEntry } from "astro:content";
import { postFilter } from "./postFilter";

/**
 * Returns posts that are eligible to be shown to users, sorted by `pubDatetime`
 * descending. `modDatetime` 只餵 schema / sitemap，不拿來重排列表——
 * 否則每次批次更新舊文（例如青安條件變動）都會把舊文推到列表最上面。
 *
 * Note: filtering respects drafts and scheduled posts via `postFilter()`.
 */
export function getSortedPosts(posts: CollectionEntry<"posts">[]) {
  return posts
    .filter(postFilter)
    .sort(
      (a, b) =>
        Math.floor(
          new Date(b.data.pubDatetime).getTime() / 1000
        ) -
        Math.floor(
          new Date(a.data.pubDatetime).getTime() / 1000
        )
    );
}

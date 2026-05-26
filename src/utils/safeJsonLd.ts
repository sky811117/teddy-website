/**
 * Safely serialize an object for embedding as JSON-LD via `set:html` in an
 * inline <script type="application/ld+json"> tag.
 *
 * JSON.stringify by itself does NOT escape `</script>` or `<!--` — any
 * user-controlled string containing those sequences would break out of the
 * script tag and could inject HTML / introduce XSS.
 *
 * This helper escapes:
 *   - `</script` → `<\/script` (script tag close)
 *   - `</style`  → `<\/style`  (style tag close, defense-in-depth)
 *   - `<!--`     → `<\!--`     (HTML comment start, edge case)
 *
 * See WHATWG HTML spec — restrictions for contents of script elements.
 */
export function safeJsonLd(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/<\/(script|style)/gi, "<\\/$1")
    .replace(/<!--/g, "<\\!--");
}

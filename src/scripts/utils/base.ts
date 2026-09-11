/**
 * Folder-independent URLs.
 *
 * The site may be uploaded to any folder (kristalkule.com/360/, /360-test/, the
 * root...). Nothing is baked in at build time:
 *   - at build time (Astro frontmatter, no `document`) `withBase()` returns a
 *     *relative* path such as `fonts/x.woff2`, resolved by the browser against index.html;
 *   - at runtime it returns an absolute path derived from the page's own folder,
 *     e.g. `/360-test/fonts/x.woff2`, so workers and fetches resolve correctly too.
 */
function runtimeBase(): string {
  if (typeof document === 'undefined') return '';
  try { return new URL('.', document.baseURI).pathname.replace(/\/+$/, ''); } catch { return ''; }
}

export const BASE = runtimeBase();

export const withBase = (path: string): string => {
  const p = path.replace(/^\/+/, '');
  return BASE ? `${BASE}/${p}` : p;
};

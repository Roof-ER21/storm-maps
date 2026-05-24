/**
 * URL query-param helpers for deep-linking into entity views.
 *
 * The app routes via `?view=<hub>&tab=<tab>&name=<entity>` (and `&carrier=`
 * for adjusters, which key on name + carrier). Entity views read these on
 * mount to pre-select an entity; producers build them to deep-link across views.
 */

/** Read a query param from the current URL, or null. SSR-safe. */
export function getUrlParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(key);
}

/** Case-insensitive match of a `?name=` param against a list of named items. */
export function matchByName<T extends { name: string }>(
  items: T[],
  wanted: string | null,
): T | undefined {
  if (!wanted) return undefined;
  const w = wanted.trim().toLowerCase();
  return items.find((it) => it.name.toLowerCase() === w);
}

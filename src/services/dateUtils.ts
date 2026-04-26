/**
 * Eastern-time date helpers.
 *
 * The app operates on Mid-Atlantic storms (VA / MD / PA), so every storm-date
 * label, bucketing key, and "today" reference must use America/New_York to
 * avoid two real bugs we hit before:
 *
 *   1. Cross-midnight UTC duplicates — a 9 PM EDT storm has its UTC ISO
 *      timestamp roll over to the next calendar day, getting bucketed with
 *      the next afternoon's storm. Reps saw "the same storm" appear twice
 *      in the sidebar (once on the right Eastern day, once on the next).
 *   2. Calendar drift — UTC dates display as one day off in the sidebar
 *      between roughly 8 PM and midnight Eastern.
 *
 * All grouping/keying through the app should use `toEasternDateKey`. UI date
 * labels should use `formatEasternDateLabel`.
 */

const EASTERN_TZ = 'America/New_York';

/**
 * Convert any ISO 8601 (or YYYY-MM-DD) string to a YYYY-MM-DD key in
 * America/New_York. Returns null when the input can't be parsed.
 *
 * Notes:
 *   - A bare YYYY-MM-DD string (no time component) is treated as already
 *     Eastern-local and returned verbatim. This matches how the backend
 *     date params (storm date pickers, MRMS query strings) flow through
 *     the app — they never carry timezone info, and we treat them as the
 *     rep's local day.
 *   - All conversions go through Intl.DateTimeFormat for DST correctness.
 */
export function toEasternDateKey(input: string | null | undefined): string | null {
  if (!input) return null;

  // Bare YYYY-MM-DD (no T) — assume already-Eastern, return as-is.
  const bare = input.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (bare) return bare[1];

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return null;

  return formatYmd(parsed, EASTERN_TZ);
}

/** Get today's date as a YYYY-MM-DD key in Eastern time. */
export function getTodayEasternKey(): string {
  return formatYmd(new Date(), EASTERN_TZ);
}

/** Render a YYYY-MM-DD or ISO timestamp as a friendly Eastern label. */
export function formatEasternDateLabel(
  input: string | null | undefined,
  options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  },
): string {
  const key = toEasternDateKey(input);
  if (!key) return input ?? '';

  // Anchor at noon Eastern so the date doesn't get shifted by DST jumps
  // when we round-trip through Date.
  const noon = new Date(`${key}T12:00:00-05:00`);
  if (Number.isNaN(noon.getTime())) return key;

  return noon.toLocaleDateString('en-US', { ...options, timeZone: EASTERN_TZ });
}

/** Render a full timestamp in Eastern time (e.g., "Apr 25, 2026, 9:14 PM"). */
export function formatEasternTimestamp(
  input: string | null | undefined,
  options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  },
): string {
  if (!input) return '';
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return input;
  return parsed.toLocaleString('en-US', { ...options, timeZone: EASTERN_TZ });
}

/**
 * Same-Eastern-day comparison: returns true iff `iso` (a UTC timestamp or
 * Eastern-local YYYY-MM-DD) falls on the given `easternDateKey`.
 *
 * Use this anywhere the old code did `event.beginDate.slice(0, 10) === date`.
 */
export function isOnEasternDate(
  iso: string | null | undefined,
  easternDateKey: string,
): boolean {
  return toEasternDateKey(iso) === easternDateKey;
}

function formatYmd(date: Date, timeZone: string): string {
  // en-CA renders YYYY-MM-DD which is exactly the key shape we want.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  if (!year || !month || !day) return date.toISOString().slice(0, 10);
  return `${year}-${month}-${day}`;
}

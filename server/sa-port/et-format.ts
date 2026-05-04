/**
 * Eastern Time formatters. Project-wide rule: every user-facing date or
 * time string is rendered in America/New_York with the correct EDT / EST
 * suffix. Database stays in UTC (TIMESTAMP WITH TIME ZONE); display is
 * the only place TZ conversion happens.
 *
 * DST handling — `Intl.DateTimeFormat` with timeZoneName: "short" returns
 * "EDT" or "EST" automatically based on whether the date falls inside the
 * US DST window. Never hard-code "EDT" anywhere.
 */

const TZ = "America/New_York";

/** YYYY-MM-DD → "MM/DD/YYYY" (US date only — no time, no zone). */
export function formatEtDate(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  if (typeof iso === "string") {
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[2]}/${m[3]}/${m[1]}`;
    return iso;
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, month: "2-digit", day: "2-digit", year: "numeric",
  }).format(iso);
}

/** ISO timestamp → "h:mm AM/PM EDT|EST". DST-aware. */
export function formatEtTime(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true,
    timeZoneName: "short",
  }).format(d);
}

/** ISO timestamp → "h:mm AM/PM" (time of day, ET, no zone suffix). */
export function formatEtTimeNoZone(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true,
  }).format(d);
}

/** ISO timestamp → "MM/DD/YYYY, h:mm AM/PM EDT|EST". DST-aware. */
export function formatEtDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, month: "2-digit", day: "2-digit", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short",
  }).format(d);
}

/**
 * Returns the current ET zone abbreviation: "EDT" inside DST window,
 * "EST" outside. Useful when you've already formatted the time but want
 * to append the live zone suffix yourself.
 */
export function currentEtAbbrev(at: Date = new Date()): "EDT" | "EST" {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, timeZoneName: "short",
  }).formatToParts(at);
  const part = formatted.find((p) => p.type === "timeZoneName")?.value;
  return part === "EDT" ? "EDT" : "EST";
}

/** YYYY-MM-DD interpreted as that date in ET. Used for storm event_date. */
export function todayEtDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(at);
}

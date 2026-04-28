/**
 * Storm metrics helpers for the adjuster-facing PDF (Hail Impact Details +
 * Historical Storm Activity sections). Pure functions — no IO, no DB.
 *
 * - computeStormPeakTime: earliest hail event begin_time on the date of loss
 * - computeHailDuration: span between first and last hail event (minutes, 1dp)
 * - computeStormDirectionAndSpeed: dominant heading + mean translation speed
 */

import type { StormEventDto } from './eventService.js';
import { bearingDegrees, bearingToCardinalWord, haversineMiles } from './geometry.js';

const ET_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function eventEtDateIso(begin: string): string | null {
  const t = new Date(begin);
  if (Number.isNaN(t.getTime())) return null;
  return ET_FORMATTER.format(t);
}

/**
 * Filter an event list to those whose begin time, expressed in America/
 * New_York, falls on `dateOfLossIso` (YYYY-MM-DD).
 */
export function filterEventsByEtDate(
  events: StormEventDto[],
  dateOfLossIso: string,
): StormEventDto[] {
  return events.filter((e) => eventEtDateIso(e.beginDate) === dateOfLossIso);
}

/**
 * Earliest `eventType==='Hail'` event on the date of loss, formatted in ET.
 * Returns null when the day produced no hail events at all (rare — the PDF
 * still renders, just with "—").
 */
export function computeStormPeakTime(
  events: StormEventDto[],
  dateOfLossIso: string,
): string | null {
  const dated = filterEventsByEtDate(events, dateOfLossIso).filter(
    (e) => e.eventType === 'Hail',
  );
  if (dated.length === 0) return null;
  const sorted = [...dated].sort(
    (a, b) =>
      new Date(a.beginDate).getTime() - new Date(b.beginDate).getTime(),
  );
  const first = sorted[0];
  const t = new Date(first.beginDate);
  if (Number.isNaN(t.getTime())) return null;
  return t.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
}

/**
 * Span (minutes, one decimal) between the earliest and latest hail event
 * on the date of loss. Single-event days return null (we won't claim a
 * "duration" with one report). Same for empty days.
 */
export function computeHailDuration(
  events: StormEventDto[],
  dateOfLossIso: string,
): number | null {
  const hail = filterEventsByEtDate(events, dateOfLossIso).filter(
    (e) => e.eventType === 'Hail',
  );
  if (hail.length < 2) return null;
  let minMs = Infinity;
  let maxMs = -Infinity;
  for (const e of hail) {
    const t = new Date(e.beginDate).getTime();
    if (Number.isNaN(t)) continue;
    if (t < minMs) minMs = t;
    if (t > maxMs) maxMs = t;
  }
  if (!Number.isFinite(minMs) || !Number.isFinite(maxMs)) return null;
  const minutes = (maxMs - minMs) / 60_000;
  if (minutes <= 0) return null;
  return Math.round(minutes * 10) / 10;
}

/**
 * Dominant track direction + mean speed across the date-of-loss hail events.
 *
 * Algorithm: chronologically sort hail events on the date. If 1 event,
 * return null/null. Otherwise compute the displacement from the first
 * event's lat/lng to the last event's lat/lng — that's the dominant
 * heading (bearing) and the speed (haversine miles ÷ elapsed hours).
 *
 * Cardinal output is the 8-point spelled-out word ("East") to match the
 * reference PDF.
 */
export function computeStormDirectionAndSpeed(
  events: StormEventDto[],
  dateOfLossIso: string,
): { heading: string; bearingDeg: number | null; speedMph: number | null } {
  const hail = filterEventsByEtDate(events, dateOfLossIso).filter(
    (e) => e.eventType === 'Hail',
  );
  if (hail.length < 2) {
    return { heading: '—', bearingDeg: null, speedMph: null };
  }
  const sorted = [...hail].sort(
    (a, b) =>
      new Date(a.beginDate).getTime() - new Date(b.beginDate).getTime(),
  );
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (
    !Number.isFinite(first.beginLat) ||
    !Number.isFinite(first.beginLon) ||
    !Number.isFinite(last.beginLat) ||
    !Number.isFinite(last.beginLon)
  ) {
    return { heading: '—', bearingDeg: null, speedMph: null };
  }
  // No movement (stationary cluster) — heading meaningless.
  const distMi = haversineMiles(
    first.beginLat,
    first.beginLon,
    last.beginLat,
    last.beginLon,
  );
  if (distMi < 0.05) {
    return { heading: '—', bearingDeg: null, speedMph: null };
  }
  const elapsedMs =
    new Date(last.beginDate).getTime() - new Date(first.beginDate).getTime();
  if (elapsedMs <= 0) {
    return { heading: '—', bearingDeg: null, speedMph: null };
  }
  const bearing = bearingDegrees(
    first.beginLat,
    first.beginLon,
    last.beginLat,
    last.beginLon,
  );
  const hours = elapsedMs / 3_600_000;
  const speedMph = distMi / hours;
  return {
    heading: bearingToCardinalWord(bearing),
    bearingDeg: bearing,
    speedMph,
  };
}

/**
 * Earliest time across a list of `{timeIso}` points, formatted as ET.
 * Used by Hail Impact Details when the event-cache window doesn't cover the
 * date of loss (e.g., adjuster pulling a 2-year-old date) but we still have
 * primary-source ground rows from `verified_hail_events`.
 */
export function computePeakTimeFromPoints(
  points: Array<{ timeIso: string }>,
): string | null {
  if (points.length === 0) return null;
  let minMs = Infinity;
  for (const p of points) {
    const t = new Date(p.timeIso).getTime();
    if (Number.isFinite(t) && t < minMs) minMs = t;
  }
  if (!Number.isFinite(minMs)) return null;
  const t = new Date(minMs);
  return t.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
}

/**
 * Span (minutes, 1dp) between earliest and latest points. Single-point
 * lists return null — same rule as the StormEventDto variant.
 */
export function computeDurationFromPoints(
  points: Array<{ timeIso: string }>,
): number | null {
  if (points.length < 2) return null;
  let minMs = Infinity;
  let maxMs = -Infinity;
  for (const p of points) {
    const t = new Date(p.timeIso).getTime();
    if (!Number.isFinite(t)) continue;
    if (t < minMs) minMs = t;
    if (t > maxMs) maxMs = t;
  }
  if (!Number.isFinite(minMs) || !Number.isFinite(maxMs)) return null;
  const minutes = (maxMs - minMs) / 60_000;
  if (minutes <= 0) return null;
  return Math.round(minutes * 10) / 10;
}

/**
 * Same algorithm but for an arbitrary list of `{lat,lng,timeIso}` points.
 * Used by Section 7 (Historical Storm Activity) where hist rows aren't
 * StormEventDto but row-shaped from `verified_hail_events`.
 */
export function computeDirectionAndSpeedFromPoints(
  points: Array<{ lat: number; lng: number; timeIso: string }>,
): { heading: string; bearingDeg: number | null; speedMph: number | null } {
  if (points.length < 2) {
    return { heading: '—', bearingDeg: null, speedMph: null };
  }
  const sorted = [...points].sort(
    (a, b) =>
      new Date(a.timeIso).getTime() - new Date(b.timeIso).getTime(),
  );
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (
    !Number.isFinite(first.lat) ||
    !Number.isFinite(first.lng) ||
    !Number.isFinite(last.lat) ||
    !Number.isFinite(last.lng)
  ) {
    return { heading: '—', bearingDeg: null, speedMph: null };
  }
  const distMi = haversineMiles(first.lat, first.lng, last.lat, last.lng);
  if (distMi < 0.05) {
    return { heading: '—', bearingDeg: null, speedMph: null };
  }
  const elapsedMs =
    new Date(last.timeIso).getTime() - new Date(first.timeIso).getTime();
  if (elapsedMs <= 0) {
    return { heading: '—', bearingDeg: null, speedMph: null };
  }
  const bearing = bearingDegrees(first.lat, first.lng, last.lat, last.lng);
  const hours = elapsedMs / 3_600_000;
  return {
    heading: bearingToCardinalWord(bearing),
    bearingDeg: bearing,
    speedMph: distMi / hours,
  };
}

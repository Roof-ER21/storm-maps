/**
 * Eastern-time helpers — used across the storm pipeline so date windows
 * and MRMS anchor times line up with what reps and adjusters see.
 *
 * Every consumer-visible date in Hail Yes is an Eastern calendar day.
 * Every upstream feed (MRMS, SPC, IEM, NWS, Synoptic, mPING, HailTrace,
 * NCEI, IEM VTEC) publishes in UTC. These helpers handle the conversion
 * and DST switch (EDT vs EST) automatically.
 */

const ET_TZ = 'America/New_York';
const ET_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: ET_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Get the Eastern calendar date (YYYY-MM-DD) for a UTC instant. */
export function toEasternDateKey(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '';
  return ET_DATE_FMT.format(date);
}

/**
 * Return the UTC instant corresponding to midnight Eastern Time on the
 * given Eastern date. Handles EDT (UTC-4) vs EST (UTC-5) automatically by
 * trying both offsets and picking the one that lands on the requested day
 * when re-formatted in ET.
 */
export function etMidnightUtc(etDateYmd: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(etDateYmd)) {
    throw new Error(`etMidnightUtc: invalid date "${etDateYmd}"`);
  }
  const edt = new Date(`${etDateYmd}T00:00:00-04:00`);
  if (ET_DATE_FMT.format(edt) === etDateYmd) return edt;
  return new Date(`${etDateYmd}T00:00:00-05:00`);
}

/**
 * UTC start + end instants for an Eastern calendar day. The window is
 * exclusive on the end (next-ET-midnight) so two consecutive dates don't
 * overlap.
 */
export function etDayUtcWindow(etDateYmd: string): { startUtc: Date; endUtc: Date } {
  const startUtc = etMidnightUtc(etDateYmd);
  const next = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  // The +24h might land in the wrong DST zone (e.g. spring-forward), but
  // for our 24h windows DST shifts are negligible (1 hour at the boundary).
  // Re-anchor by computing midnight of the next ET date string for cleanness.
  const nextEtDate = ET_DATE_FMT.format(next);
  const endUtc = etMidnightUtc(nextEtDate);
  return { startUtc, endUtc };
}

/**
 * Default MRMS anchor for fetching the 1440-min product covering an
 * Eastern calendar day. Returns the UTC moment of midnight ET on the day
 * AFTER the requested date — that's the moment when the 1440-min file
 * covers the full preceding 24 hours of ET-day storms.
 */
export function etDayMrmsAnchorIso(etDateYmd: string): string {
  const { endUtc } = etDayUtcWindow(etDateYmd);
  return endUtc.toISOString();
}

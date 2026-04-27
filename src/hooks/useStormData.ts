/**
 * useStormData — Central hook for fetching storm intelligence.
 *
 * Fetches both NOAA/SWDI hail reports and NHP MESH swaths for the
 * given coordinates, returning a unified dataset for the map and sidebar.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { StormEvent, MeshSwath, StormDate, StormImpactTier } from '../types/storm';
import { searchByCoordinates, fetchLocalStormReports, fetchSpcStormReports } from '../services/stormApi';
import { fetchMeshSwathsByLocation } from '../services/nhpApi';
import { getHailSizeClass } from '../types/storm';
import { toEasternDateKey, formatEasternDateLabel } from '../services/dateUtils';

function appendStormEvents(target: StormEvent[], next: StormEvent[]): void {
  for (const event of next) {
    target.push(event);
  }
}

interface UseStormDataParams {
  lat: number | null;
  lng: number | null;
  months?: number;
  radiusMiles?: number;
  sinceDate?: string | null;
}

interface UseStormDataReturn {
  events: StormEvent[];
  swaths: MeshSwath[];
  stormDates: StormDate[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Distance-only fallback used while the server-side polygon-truth tier
 * (from /api/hail/per-date-impact) is loading. Generous-by-design: a hail
 * report ≤1 mi from the property is treated as a direct hit because hail
 * cores are typically 1-3 mi wide. Once the per-date-impact response
 * arrives the tier is replaced with the polygon-truth value.
 */
function classifyTierByDistance(closestMiles: number | null): StormImpactTier {
  if (closestMiles === null) return 'no_impact';
  if (closestMiles <= 1.0) return 'direct_hit';
  if (closestMiles <= 3.0) return 'near_miss';
  if (closestMiles <= 10.0) return 'area_impact';
  return 'no_impact';
}

/**
 * True point-in-polygon containment test against the date's swath
 * geometry. Promotes tier to 'direct_hit' when the property falls inside
 * an MRMS swath polygon — the polygon-truth signal that
 * AddressImpactBadge already uses for its Direct Hit / Near Miss card.
 *
 * Resolves the user-visible inconsistency where the address badge said
 * DIRECT HIT (polygon contains property) while the storm-dates row said
 * NEAR MISS (closest point report 1.9 mi away). The two now agree
 * because both consult polygon containment when geometry is available.
 */
function ringContainsPoint(ring: number[][], lat: number, lng: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function swathContainsPoint(swath: MeshSwath, lat: number, lng: number): boolean {
  const g = swath.geometry;
  if (!g) return false;
  if (g.type === 'Polygon') {
    const rings = g.coordinates as number[][][];
    return rings.length > 0 && ringContainsPoint(rings[0], lat, lng);
  }
  if (g.type === 'MultiPolygon') {
    const polys = g.coordinates as number[][][][];
    return polys.some((rings) => rings.length > 0 && ringContainsPoint(rings[0], lat, lng));
  }
  return false;
}

/**
 * Group storm events by date and compute summary stats for the sidebar.
 *
 * `propertyLat`/`propertyLng` are the search center — events' distance
 * from that point determines the per-date tier badge ("DIRECT HIT" /
 * "NEAR MISS" / "AREA"). When unset (null), tier defaults to 'area' so
 * the row still renders without claiming a hit.
 */
function groupEventsByDate(
  events: StormEvent[],
  propertyLat: number | null,
  propertyLng: number | null,
  swaths: MeshSwath[] = [],
): StormDate[] {
  const swathsByDate = new Map<string, MeshSwath[]>();
  for (const s of swaths) {
    const arr = swathsByDate.get(s.date) ?? [];
    arr.push(s);
    swathsByDate.set(s.date, arr);
  }
  const dateMap = new Map<string, { events: StormEvent[]; states: Set<string> }>();

  for (const event of events) {
    const dateKey = getStormDateKey(event.beginDate);
    if (!dateKey) continue;

    if (!dateMap.has(dateKey)) {
      dateMap.set(dateKey, { events: [], states: new Set() });
    }

    const group = dateMap.get(dateKey)!;
    group.events.push(event);
    if (event.state) group.states.add(event.state);
  }

  return Array.from(dateMap.entries())
    .map(([date, { events: evts, states }]) => {
      const maxHail = Math.max(
        0,
        ...evts
          .filter((event) => event.eventType === 'Hail')
          .map((event) => event.magnitude),
      );
      const maxWind = Math.max(
        0,
        ...evts
          .filter((event) => event.eventType === 'Thunderstorm Wind')
          .map((event) => event.magnitude),
      );
      let closest: number | null = null;
      if (propertyLat !== null && propertyLng !== null) {
        for (const ev of evts) {
          const d = haversineDistanceMiles(propertyLat, propertyLng, ev.beginLat, ev.beginLon);
          if (closest === null || d < closest) closest = d;
        }
      }
      // Polygon-truth check: if any swath polygon for this date contains
      // the property, that's a direct hit regardless of how far the
      // nearest report point happens to be (point reports are sparse;
      // polygons are the algorithmically-derived hail field).
      let tier = classifyTierByDistance(closest);
      if (
        propertyLat !== null &&
        propertyLng !== null &&
        tier !== 'direct_hit'
      ) {
        const dateSwaths = swathsByDate.get(date) ?? [];
        if (dateSwaths.some((s) => swathContainsPoint(s, propertyLat, propertyLng))) {
          tier = 'direct_hit';
        }
      }
      return {
        date,
        label: formatDateLabel(date),
        eventCount: evts.length,
        maxHailInches: maxHail,
        maxWindMph: maxWind,
        statesAffected: [...states],
        closestMiles: closest,
        tier,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

function formatDateLabel(dateStr: string): string {
  return formatEasternDateLabel(dateStr);
}

export function useStormData({
  lat,
  lng,
  months = 6,
  radiusMiles = 50,
  sinceDate = null,
}: UseStormDataParams): UseStormDataReturn {
  const [events, setEvents] = useState<StormEvent[]>([]);
  const [swaths, setSwaths] = useState<MeshSwath[]>([]);
  const [stormDates, setStormDates] = useState<StormDate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    if (lat === null || lng === null) return;

    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const effectiveMonths = getEffectiveMonths(months, sinceDate);

      // Fetch SWDI hail reports, IEM LSR, SPC same-day reports, and NHP swaths in parallel
      const [swdiEvents, lsrEvents, spcEvents, nhpSwaths] = await Promise.allSettled([
        searchByCoordinates(
          lat,
          lng,
          effectiveMonths,
          radiusMiles,
          controller.signal,
        ),
        fetchLocalStormReports(controller.signal),
        fetchSpcStormReports(controller.signal),
        fetchMeshSwathsByLocation(
          lat,
          lng,
          effectiveMonths,
          radiusMiles,
          sinceDate,
          controller.signal,
        ),
      ]);

      if (controller.signal.aborted) return;

      // Merge events from all sources
      const allEvents: StormEvent[] = [];
      if (swdiEvents.status === 'fulfilled') {
        appendStormEvents(allEvents, swdiEvents.value);
      }
      if (lsrEvents.status === 'fulfilled') {
        appendStormEvents(
          allEvents,
          filterEventsByRadius(lsrEvents.value, lat, lng, radiusMiles),
        );
      }
      if (spcEvents.status === 'fulfilled') {
        appendStormEvents(
          allEvents,
          filterEventsByRadius(spcEvents.value, lat, lng, radiusMiles),
        );
      }

      // Deduplicate by proximity: if two events are within 0.01 deg and same date, keep the one with more detail
      const sanitizedEvents = sanitizeEvents(allEvents, sinceDate);
      const dedupedEvents = deduplicateEvents(sanitizedEvents);

      const resolvedSwaths =
        nhpSwaths.status === 'fulfilled'
          ? nhpSwaths.value.filter((swath) => isDateInRange(swath.date, sinceDate))
          : [];

      // Also generate StormDate entries from swaths that may not have matching events.
      // Swath-only dates do polygon containment for tier — when the property
      // is inside the swath we still emit DIRECT HIT even without point reports.
      const swathDates: StormDate[] = resolvedSwaths.map((s) => ({
        date: s.date,
        label: formatDateLabel(s.date),
        eventCount: 0,
        maxHailInches: s.maxMeshInches,
        maxWindMph: 0,
        statesAffected: s.statesAffected,
        closestMiles: null,
        tier:
          lat !== null && lng !== null && swathContainsPoint(s, lat, lng)
            ? 'direct_hit'
            : 'area_impact',
      }));

      // Merge event dates and swath dates
      const eventDates = groupEventsByDate(dedupedEvents, lat, lng, resolvedSwaths);
      const mergedDates = mergeDateLists(eventDates, swathDates);

      setEvents(dedupedEvents);
      setSwaths(resolvedSwaths);
      setStormDates(mergedDates);

      // Polygon-truth tier upgrade — fire-and-forget so the storm-dates
      // list paints immediately with the distance-fallback tier. The
      // server endpoint can take 30-60s on cold MRMS GRIB fetches across
      // many dates; awaiting it here would freeze the page on a loading
      // skeleton. Instead, kick it off and patch tiers in when it lands.
      if (mergedDates.length > 0 && lat !== null && lng !== null) {
        const dateList = mergedDates.slice(0, 60).map((d) => d.date);
        const fetchSignal = controller.signal;
        void fetch('/api/hail/per-date-impact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat, lng, dates: dateList, radiusMiles }),
          signal: fetchSignal,
        })
          .then(async (impactRes) => {
            if (!impactRes.ok || fetchSignal.aborted) return;
            const json = (await impactRes.json()) as {
              results: Array<{
                date: string;
                tier: StormImpactTier | 'unknown';
                directHit: boolean;
                closestMiles: number | null;
                atPropertyInches?: number | null;
              }>;
            };
            if (fetchSignal.aborted) return;
            const tierByDate = new Map<
              string,
              { tier: StormImpactTier; closestMiles: number | null }
            >();
            for (const r of json.results) {
              if (r.tier === 'unknown') continue;
              tierByDate.set(r.date, {
                tier: r.tier,
                closestMiles:
                  r.closestMiles !== null && Number.isFinite(r.closestMiles)
                    ? r.closestMiles
                    : null,
              });
            }
            setStormDates((prev) =>
              prev.map((sd) => {
                const upgrade = tierByDate.get(sd.date);
                if (!upgrade) return sd;
                return {
                  ...sd,
                  tier: upgrade.tier,
                  closestMiles: upgrade.closestMiles ?? sd.closestMiles,
                };
              }),
            );
          })
          .catch((e) => {
            if (!fetchSignal.aborted) {
              console.warn('[useStormData] per-date impact upgrade failed:', e);
            }
          });
      }

      // Report partial failures as warnings
      const failures: string[] = [];
      if (swdiEvents.status === 'rejected') failures.push('NOAA SWDI');
      if (lsrEvents.status === 'rejected') failures.push('IEM LSR');
      if (spcEvents.status === 'rejected') failures.push('SPC Reports');
      if (nhpSwaths.status === 'rejected') failures.push('NHP Swaths');

      const totalSources = 4;
      if (failures.length > 0 && failures.length < totalSources) {
        console.warn(`[useStormData] Partial failure: ${failures.join(', ')}`);
      } else if (failures.length === totalSources) {
        setError('All storm data sources are unavailable. Check your connection.');
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : 'Failed to fetch storm data');
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [lat, lng, months, radiusMiles, sinceDate]);

  useEffect(() => {
    fetchData();
    return () => {
      abortRef.current?.abort();
    };
  }, [fetchData]);

  // Expose the hail size class utility via re-export for sidebar usage
  void getHailSizeClass;

  return { events, swaths, stormDates, loading, error, refetch: fetchData };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Collapse near-duplicate reports that came from different upstream sources
 * (NOAA SWDI / IEM LSR / SPC) of the same physical storm cell. Two reports
 * are treated as duplicates if they're within ~0.7 mi of each other AND
 * within ~90 minutes of each other, regardless of which Eastern calendar
 * day they fall on. The 90-minute window is the key fix: an SPC report
 * stamped 23:55 Eastern and an LSR stamped 00:10 the next morning UTC for
 * the same hail core used to produce two separate map markers.
 */
function deduplicateEvents(events: StormEvent[]): StormEvent[] {
  // Sort newest-first so the more-detailed narrative tends to win when a
  // tie occurs between equally-good candidates.
  const sorted = [...events].sort(
    (a, b) => Date.parse(b.beginDate) - Date.parse(a.beginDate),
  );

  const kept: StormEvent[] = [];
  for (const event of sorted) {
    const dateKey = getStormDateKey(event.beginDate);
    if (!dateKey) continue;
    const eventTime = Date.parse(event.beginDate);
    if (Number.isNaN(eventTime)) continue;

    const dupIndex = kept.findIndex((existing) => {
      if (existing.eventType !== event.eventType) return false;
      // Sub-mile proximity: 0.01° latitude ≈ 0.69 mi.
      if (Math.abs(existing.beginLat - event.beginLat) > 0.01) return false;
      if (Math.abs(existing.beginLon - event.beginLon) > 0.01) return false;

      const existingTime = Date.parse(existing.beginDate);
      if (Number.isNaN(existingTime)) return false;
      const dtMin = Math.abs(existingTime - eventTime) / 60_000;
      return dtMin <= 90;
    });

    if (dupIndex === -1) {
      kept.push(event);
      continue;
    }

    // Prefer the event with the longer narrative (typically the NOAA Storm
    // Events archived record over the SPC same-day stub) but always keep
    // the higher magnitude when sources disagree.
    const existing = kept[dupIndex];
    const merged: StormEvent = {
      ...existing,
      magnitude: Math.max(existing.magnitude, event.magnitude),
      narrative:
        event.narrative.length > existing.narrative.length
          ? event.narrative
          : existing.narrative,
      damageProperty: Math.max(existing.damageProperty, event.damageProperty),
    };
    kept[dupIndex] = merged;
  }

  return kept;
}

function getEffectiveMonths(months: number, sinceDate: string | null): number {
  if (!sinceDate) {
    return months;
  }

  const startMs = Date.parse(`${sinceDate}T00:00:00Z`);
  if (Number.isNaN(startMs)) {
    return months;
  }

  const nowMs = Date.now();
  const diffMonths = Math.ceil(
    (nowMs - startMs) / (30 * 24 * 60 * 60 * 1000),
  );

  return Math.max(months, diffMonths, 1);
}

function isDateInRange(dateStr: string, sinceDate: string | null): boolean {
  const dateKey = getStormDateKey(dateStr);
  if (!dateKey) {
    return false;
  }

  if (!sinceDate) {
    return true;
  }

  return dateKey >= sinceDate;
}

function haversineDistanceMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const earthRadiusMiles = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;

  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function filterEventsByRadius(
  events: StormEvent[],
  centerLat: number,
  centerLng: number,
  radiusMiles: number,
): StormEvent[] {
  return events.filter((event) => {
    const distance = haversineDistanceMiles(
      centerLat,
      centerLng,
      event.beginLat,
      event.beginLon,
    );

    return distance <= radiusMiles;
  });
}

function sanitizeEvents(
  events: StormEvent[],
  sinceDate: string | null,
): StormEvent[] {
  return events.filter((event) => isDateInRange(event.beginDate, sinceDate));
}

function mergeDateLists(
  eventDates: StormDate[],
  swathDates: StormDate[],
): StormDate[] {
  const map = new Map<string, StormDate>();

  for (const sd of eventDates) {
    map.set(sd.date, sd);
  }

  for (const sd of swathDates) {
    const dateKey = getStormDateKey(sd.date);
    if (!dateKey) continue;

    const normalizedSwathDate = { ...sd, date: dateKey, label: formatDateLabel(dateKey) };
    const existing = map.get(dateKey);
    if (existing) {
      // Merge: take the higher hail size and combine states. Keep the
      // event-derived `closestMiles` + tier — it's stricter than the
      // swath-only fallback.
      existing.maxHailInches = Math.max(
        existing.maxHailInches,
        normalizedSwathDate.maxHailInches,
      );
      existing.maxWindMph = Math.max(
        existing.maxWindMph,
        normalizedSwathDate.maxWindMph,
      );
      const allStates = new Set([
        ...existing.statesAffected,
        ...normalizedSwathDate.statesAffected,
      ]);
      existing.statesAffected = [...allStates];
    } else {
      map.set(dateKey, normalizedSwathDate);
    }
  }

  return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
}

function getStormDateKey(dateStr: string): string | null {
  return toEasternDateKey(dateStr);
}

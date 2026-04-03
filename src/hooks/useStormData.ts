/**
 * useStormData — Central hook for fetching storm intelligence.
 *
 * Fetches both NOAA/SWDI hail reports and NHP MESH swaths for the
 * given coordinates, returning a unified dataset for the map and sidebar.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { StormEvent, MeshSwath, StormDate } from '../types/storm';
import { searchByCoordinates, fetchLocalStormReports, fetchSpcStormReports } from '../services/stormApi';
import { fetchMeshSwathsByLocation } from '../services/nhpApi';
import { getHailSizeClass } from '../types/storm';

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
 * Group storm events by date and compute summary stats for the sidebar.
 */
function groupEventsByDate(events: StormEvent[]): StormDate[] {
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
      return {
        date,
        label: formatDateLabel(date),
        eventCount: evts.length,
        maxHailInches: maxHail,
        maxWindMph: maxWind,
        statesAffected: [...states],
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

function formatDateLabel(dateStr: string): string {
  const dateKey = getStormDateKey(dateStr);
  if (!dateKey) {
    return dateStr;
  }

  const d = new Date(`${dateKey}T12:00:00Z`);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
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

      // Also generate StormDate entries from swaths that may not have matching events
      const swathDates = resolvedSwaths.map((s) => ({
        date: s.date,
        label: formatDateLabel(s.date),
        eventCount: 0,
        maxHailInches: s.maxMeshInches,
        maxWindMph: 0,
        statesAffected: s.statesAffected,
      }));

      // Merge event dates and swath dates
      const eventDates = groupEventsByDate(dedupedEvents);
      const mergedDates = mergeDateLists(eventDates, swathDates);

      setEvents(dedupedEvents);
      setSwaths(resolvedSwaths);
      setStormDates(mergedDates);

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

function deduplicateEvents(events: StormEvent[]): StormEvent[] {
  const seen = new Map<string, StormEvent>();

  for (const event of events) {
    const dateKey = getStormDateKey(event.beginDate);
    if (!dateKey) continue;

    const latKey = Math.round(event.beginLat * 100);
    const lonKey = Math.round(event.beginLon * 100);
    const key = `${dateKey}-${latKey}-${lonKey}`;

    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, event);
    } else {
      // Keep the one with more information
      if (event.narrative.length > existing.narrative.length) {
        seen.set(key, event);
      }
    }
  }

  return Array.from(seen.values());
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
      // Merge: take the higher hail size and combine states
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
  if (!dateStr) return null;

  const match = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return null;

  const parsed = new Date(`${match[1]}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return match[1];
}

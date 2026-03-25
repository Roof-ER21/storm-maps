/**
 * useStormData — Central hook for fetching storm intelligence.
 *
 * Fetches both NOAA/SWDI hail reports and NHP MESH swaths for the
 * given coordinates, returning a unified dataset for the map and sidebar.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { StormEvent, MeshSwath, StormDate } from '../types/storm';
import { searchByCoordinates, fetchLocalStormReports } from '../services/stormApi';
import { fetchMeshSwathsByLocation } from '../services/nhpApi';
import { getHailSizeClass } from '../types/storm';

interface UseStormDataParams {
  lat: number | null;
  lng: number | null;
  months?: number;
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
    // Extract YYYY-MM-DD from the date string
    const dateKey = event.beginDate.slice(0, 10);
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
      const maxHail = Math.max(0, ...evts.map((e) => e.magnitude));
      return {
        date,
        label: formatDateLabel(date),
        eventCount: evts.length,
        maxHailInches: maxHail,
        statesAffected: [...states],
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

function formatDateLabel(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T12:00:00Z');
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return dateStr;
  }
}

export function useStormData({
  lat,
  lng,
  months = 6,
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
      // Fetch SWDI hail reports, IEM LSR, and NHP swaths in parallel
      const [swdiEvents, lsrEvents, nhpSwaths] = await Promise.allSettled([
        searchByCoordinates(lat, lng, months, 75),
        fetchLocalStormReports(),
        fetchMeshSwathsByLocation(lat, lng, months, 75),
      ]);

      if (controller.signal.aborted) return;

      // Merge events from both sources
      const allEvents: StormEvent[] = [];
      if (swdiEvents.status === 'fulfilled') {
        allEvents.push(...swdiEvents.value);
      }
      if (lsrEvents.status === 'fulfilled') {
        allEvents.push(...lsrEvents.value);
      }

      // Deduplicate by proximity: if two events are within 0.01 deg and same date, keep the one with more detail
      const dedupedEvents = deduplicateEvents(allEvents);

      const resolvedSwaths =
        nhpSwaths.status === 'fulfilled' ? nhpSwaths.value : [];

      // Also generate StormDate entries from swaths that may not have matching events
      const swathDates = resolvedSwaths.map((s) => ({
        date: s.date,
        label: formatDateLabel(s.date),
        eventCount: 0,
        maxHailInches: s.maxMeshInches,
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
      if (nhpSwaths.status === 'rejected') failures.push('NHP Swaths');

      if (failures.length > 0 && failures.length < 3) {
        console.warn(`[useStormData] Partial failure: ${failures.join(', ')}`);
      } else if (failures.length === 3) {
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
  }, [lat, lng, months]);

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
    const dateKey = event.beginDate.slice(0, 10);
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

function mergeDateLists(
  eventDates: StormDate[],
  swathDates: StormDate[],
): StormDate[] {
  const map = new Map<string, StormDate>();

  for (const sd of eventDates) {
    map.set(sd.date, sd);
  }

  for (const sd of swathDates) {
    if (!sd.date) continue;
    const existing = map.get(sd.date);
    if (existing) {
      // Merge: take the higher hail size and combine states
      existing.maxHailInches = Math.max(existing.maxHailInches, sd.maxHailInches);
      const allStates = new Set([...existing.statesAffected, ...sd.statesAffected]);
      existing.statesAffected = [...allStates];
    } else {
      map.set(sd.date, { ...sd });
    }
  }

  return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
}

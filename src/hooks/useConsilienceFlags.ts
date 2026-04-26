/**
 * Bulk-fetches consilience flags for a list of storm dates against a
 * property location. Used by the Dashboard's "Latest Hits" list to render
 * a yellow flag next to low-confidence dates (<2 independent sources).
 */

import { useEffect, useState } from 'react';
import type { LatLng, StormDate } from '../types/storm';
import { fetchConsilienceFlag, type ConsilienceFlag } from '../services/consilienceApi';

export function useConsilienceFlags(
  stormDates: StormDate[],
  location: LatLng | null,
): Map<string, ConsilienceFlag> {
  const [flags, setFlags] = useState<Map<string, ConsilienceFlag>>(
    () => new Map(),
  );

  useEffect(() => {
    if (!location || stormDates.length === 0) {
      // Defer setState off the render path to avoid cascading-render warnings.
      const t = setTimeout(() => setFlags(new Map()), 0);
      return () => clearTimeout(t);
    }
    let cancelled = false;
    const dates = stormDates.slice(0, 4).map((s) => s.date);
    const lat = location.lat;
    const lng = location.lng;
    Promise.all(
      dates.map((date) => fetchConsilienceFlag(lat, lng, date)),
    ).then((results) => {
      if (cancelled) return;
      const next = new Map<string, ConsilienceFlag>();
      for (let i = 0; i < dates.length; i += 1) {
        const flag = results[i];
        if (flag) next.set(dates[i], flag);
      }
      setFlags(next);
    });
    return () => {
      cancelled = true;
    };
  }, [stormDates, location]);

  return flags;
}

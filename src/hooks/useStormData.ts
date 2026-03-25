// TODO: Storm data fetching hook
// - Fetches storm events for selected date and map bounds
// - Manages loading/error state
// - Caches results to avoid redundant API calls
// - Refetches when date or bounds change

import { useState, useEffect } from 'react';
import type { StormEvent, BoundingBox } from '../types/storm';
import { fetchStormEvents } from '../services/stormApi';

interface UseStormDataReturn {
  events: StormEvent[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useStormData(
  date: string | null,
  bounds: BoundingBox | null,
): UseStormDataReturn {
  const [events, setEvents] = useState<StormEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    if (!date || !bounds) return;

    setIsLoading(true);
    setError(null);

    try {
      const data = await fetchStormEvents(date, date, bounds);
      setEvents(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch storm data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, bounds?.north, bounds?.south, bounds?.east, bounds?.west]);

  return { events, isLoading, error, refetch: fetchData };
}

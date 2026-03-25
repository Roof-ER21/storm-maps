// TODO: NOAA Storm Events API service
// - Fetch storm events by date range and bounding box
// - Filter by event type (Hail, Tornado, Thunderstorm Wind)
// - Parse CSV/JSON responses from NOAA Storm Events Database
// - API: https://www.ncdc.noaa.gov/stormevents/
// - Rate limiting and caching

import type { StormEvent, BoundingBox } from '../types/storm';

/**
 * Fetch storm events from NOAA Storm Events API.
 * Filters for hail events within the given date range and bounding box.
 */
export async function fetchStormEvents(
  _startDate: string,
  _endDate: string,
  _bounds: BoundingBox,
): Promise<StormEvent[]> {
  // TODO: Implement NOAA Storm Events API integration
  console.warn('stormApi.fetchStormEvents not yet implemented');
  return [];
}

/**
 * Fetch storm events for a specific state and date.
 */
export async function fetchStateStormEvents(
  _state: string,
  _date: string,
): Promise<StormEvent[]> {
  // TODO: Implement state-level storm event query
  console.warn('stormApi.fetchStateStormEvents not yet implemented');
  return [];
}

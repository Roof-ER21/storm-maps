/**
 * Live cells API client — pulls the current MRMS now-cast hail polygons
 * + active NWS SVR warnings from /api/storm/live-cells. Driven by a
 * 90-second polling interval matching the server's pushFanout cadence.
 */

import type { BoundingBox } from '../types/storm';

export interface LiveSvrWarning {
  id: string;
  headline: string;
  areaDesc: string;
  maxWindGustMph: number;
  onset: string;
  expires: string;
  geometry: { type: string; coordinates: unknown };
}

export interface LiveMrmsFeature {
  type: 'Feature';
  properties: {
    level: number;
    sizeInches: number;
    color: string;
    label: string;
    severity: string;
  };
  geometry: { type: 'MultiPolygon'; coordinates: number[][][][] };
}

export interface LiveCellsResponse {
  ok: true;
  active: boolean;
  mrms: {
    refTime: string | null;
    maxHailInches: number;
    cellCount: number;
    features: LiveMrmsFeature[];
  };
  nws: {
    warnings: LiveSvrWarning[];
    count: number;
  };
  worker: {
    active: boolean;
    firedTodayByState: Record<string, number>;
    lastFiredAt: string | null;
  };
}

export async function fetchLiveCells(
  bounds?: BoundingBox | null,
): Promise<LiveCellsResponse | null> {
  const params = new URLSearchParams();
  if (bounds) {
    params.set('north', String(bounds.north));
    params.set('south', String(bounds.south));
    params.set('east', String(bounds.east));
    params.set('west', String(bounds.west));
  }
  const url = `/api/storm/live-cells${params.toString() ? `?${params.toString()}` : ''}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as LiveCellsResponse;
  } catch {
    return null;
  }
}

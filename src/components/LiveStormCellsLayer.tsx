/**
 * LiveStormCellsLayer — renders active MRMS now-cast hail polygons
 * (~last 60 min radar) + NWS Severe Thunderstorm Warning polygons on
 * the map. Auto-refreshes every 90s so a rep watching the map during
 * a live event sees cells move.
 *
 * Uses the same /api/storm/live-cells endpoint as ActiveStormsPanel —
 * shared cache, no duplicate work server-side.
 */

import { useEffect, useRef, useState } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import {
  fetchLiveCells,
  type LiveCellsResponse,
  type LiveSvrWarning,
} from '../services/liveCellsApi';
import type { BoundingBox } from '../types/storm';

const POLL_MS = 90_000;

interface LiveStormCellsLayerProps {
  enabled: boolean;
  bounds?: BoundingBox | null;
}

function nwsWarningRings(w: LiveSvrWarning): number[][][] {
  const g = w.geometry as {
    type?: string;
    coordinates?: number[][][] | number[][][][];
  };
  if (!g.coordinates) return [];
  if (g.type === 'Polygon') {
    return g.coordinates as number[][][];
  }
  if (g.type === 'MultiPolygon') {
    // Flatten to list of outer rings (no holes for warnings).
    return (g.coordinates as number[][][][]).flatMap((p) => p);
  }
  return [];
}

export default function LiveStormCellsLayer({
  enabled,
  bounds,
}: LiveStormCellsLayerProps): null {
  const map = useMap();
  const [data, setData] = useState<LiveCellsResponse | null>(null);
  const polysRef = useRef<google.maps.Polygon[]>([]);

  useEffect(() => {
    if (!enabled) {
      setData((prev) => (prev === null ? prev : null));
      return;
    }
    let cancelled = false;
    const tick = async () => {
      const res = await fetchLiveCells(bounds ?? null);
      if (cancelled) return;
      setData(res);
    };
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, bounds?.north, bounds?.south, bounds?.east, bounds?.west]);

  useEffect(() => {
    if (!map) return;
    for (const p of polysRef.current) p.setMap(null);
    polysRef.current = [];
    if (!enabled || !data) return;

    // MRMS hail polygons — refined IHM palette (same colors HailSwathLayer
    // uses for historical), but with stronger stroke so reps see the
    // active cell pop against the basemap.
    for (const feat of data.mrms.features) {
      const coords = feat.geometry.coordinates;
      for (const polygon of coords) {
        for (const ring of polygon) {
          const path = ring
            .filter((v) => Number.isFinite(v[0]) && Number.isFinite(v[1]))
            .map(([lng, lat]) => ({ lat, lng }));
          if (path.length < 3) continue;
          const p = new google.maps.Polygon({
            map,
            paths: path,
            strokeColor: feat.properties.color,
            strokeOpacity: 0.95,
            strokeWeight: 2.5,
            fillColor: feat.properties.color,
            fillOpacity: 0.55,
            clickable: false,
            zIndex: 3000 + feat.properties.level,
          });
          polysRef.current.push(p);
        }
      }
    }

    // NWS warning polygons — bold red outline with light fill.
    for (const w of data.nws.warnings) {
      const rings = nwsWarningRings(w);
      for (const ring of rings) {
        const path = ring
          .filter((v) => Number.isFinite(v[0]) && Number.isFinite(v[1]))
          .map(([lng, lat]) => ({ lat, lng }));
        if (path.length < 3) continue;
        const p = new google.maps.Polygon({
          map,
          paths: path,
          strokeColor: '#dc2626',
          strokeOpacity: 0.95,
          strokeWeight: 2.5,
          fillColor: '#dc2626',
          fillOpacity: 0.06,
          clickable: false,
          zIndex: 2900,
        });
        polysRef.current.push(p);
      }
    }

    return () => {
      for (const p of polysRef.current) p.setMap(null);
      polysRef.current = [];
    };
  }, [map, enabled, data]);

  return null;
}

/**
 * SynopticLayer — MADIS-fed surface station observations.
 *
 * Catches sub-½" hail signatures that MRMS misses (small hail, gusty
 * convection without large stones). Stations color-coded by signal:
 *   green-blue — station observed, no hail/severe-wind signal
 *   amber      — severe wind signal (gust ≥40 mph + heavy precip)
 *   red        — explicit hail signal in observation text
 */

import { useEffect, useRef, useState } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import type { BoundingBox } from '../types/storm';

interface CorroboratedStation {
  stid: string;
  name?: string;
  lat: number;
  lng: number;
  signal?: {
    hailReported?: boolean;
    severeWindReported?: boolean;
    peakGustMph?: number | null;
    weatherText?: string | null;
  };
}

interface SynopticLayerProps {
  enabled: boolean;
  selectedDate: string | null;
  bounds?: BoundingBox | null;
}

function stationColor(s: CorroboratedStation): string {
  if (s.signal?.hailReported) return '#dc2626';
  if (s.signal?.severeWindReported) return '#f59e0b';
  return '#0ea5e9';
}

export default function SynopticLayer({
  enabled,
  selectedDate,
  bounds,
}: SynopticLayerProps): null {
  const map = useMap();
  const [stations, setStations] = useState<CorroboratedStation[]>([]);
  const markersRef = useRef<google.maps.Marker[]>([]);

  useEffect(() => {
    if (!enabled || !selectedDate || !bounds) {
      setStations((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({
      date: selectedDate,
      north: String(bounds.north),
      south: String(bounds.south),
      east: String(bounds.east),
      west: String(bounds.west),
    });
    fetch(`/api/storm/synoptic-stations?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { stations?: CorroboratedStation[] }) => {
        if (cancelled) return;
        setStations(data.stations ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.warn('[SynopticLayer] fetch failed:', (err as Error).message);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, selectedDate, bounds?.north, bounds?.south, bounds?.east, bounds?.west]);

  useEffect(() => {
    if (!map) return;
    for (const m of markersRef.current) m.setMap(null);
    markersRef.current = [];
    if (!enabled) return;
    for (const s of stations) {
      const hasSignal = Boolean(s.signal?.hailReported || s.signal?.severeWindReported);
      const marker = new google.maps.Marker({
        map,
        position: { lat: s.lat, lng: s.lng },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: hasSignal ? 5 : 3,
          fillColor: stationColor(s),
          fillOpacity: hasSignal ? 0.92 : 0.5,
          strokeColor: '#ffffff',
          strokeWeight: 1,
        },
        title: `${s.name ?? s.stid}${
          s.signal?.hailReported ? ' · HAIL signal' : ''
        }${
          s.signal?.severeWindReported && s.signal?.peakGustMph
            ? ` · ${s.signal.peakGustMph.toFixed(0)} mph gust`
            : ''
        }`,
        zIndex: 1300,
      });
      markersRef.current.push(marker);
    }
    return () => {
      for (const m of markersRef.current) m.setMap(null);
      markersRef.current = [];
    };
  }, [map, enabled, stations]);

  return null;
}

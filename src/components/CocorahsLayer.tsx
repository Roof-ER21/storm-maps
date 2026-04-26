/**
 * CocorahsLayer — citizen-observer hail-pad measurements as map dots.
 *
 * Different from mPING (real-time crowd via app): CoCoRaHS is structured
 * daily reports from registered observers with standardized hail-pad
 * measurements. Sized by reported hail diameter, color graded similar
 * to MRMS bands.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import type { BoundingBox } from '../types/storm';

interface CocorahsReport {
  time: string;
  lat: number;
  lng: number;
  hailSizeInches: number;
  durationMinutes: number | null;
  observerStation: string | null;
  state: string | null;
  county: string | null;
}

interface CocorahsLayerProps {
  enabled: boolean;
  selectedDate: string | null;
  bounds?: BoundingBox | null;
}

function colorForSize(inches: number): string {
  if (inches >= 2.0) return '#9d174d';
  if (inches >= 1.5) return '#dc2626';
  if (inches >= 1.0) return '#ea580c';
  if (inches >= 0.75) return '#f59e0b';
  if (inches >= 0.5) return '#fbbf24';
  return '#fde68a';
}

export default function CocorahsLayer({
  enabled,
  selectedDate,
  bounds,
}: CocorahsLayerProps): null {
  const map = useMap();
  const [reports, setReports] = useState<CocorahsReport[]>([]);
  const markersRef = useRef<google.maps.Marker[]>([]);

  useEffect(() => {
    if (!enabled || !selectedDate) {
      setReports((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ date: selectedDate });
    if (bounds) {
      params.set('north', String(bounds.north));
      params.set('south', String(bounds.south));
      params.set('east', String(bounds.east));
      params.set('west', String(bounds.west));
    }
    fetch(`/api/storm/cocorahs?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { reports?: CocorahsReport[] }) => {
        if (cancelled) return;
        setReports(data.reports ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.warn('[CocorahsLayer] fetch failed:', (err as Error).message);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, selectedDate, bounds?.north, bounds?.south, bounds?.east, bounds?.west]);

  const filtered = useMemo(() => {
    if (!bounds) return reports;
    return reports.filter(
      (r) =>
        r.lat <= bounds.north &&
        r.lat >= bounds.south &&
        r.lng <= bounds.east &&
        r.lng >= bounds.west,
    );
  }, [reports, bounds]);

  useEffect(() => {
    if (!map) return;
    for (const m of markersRef.current) m.setMap(null);
    markersRef.current = [];
    if (!enabled) return;
    for (const r of filtered) {
      const radius = Math.max(7, Math.min(18, r.hailSizeInches * 9 + 5));
      const marker = new google.maps.Marker({
        map,
        position: { lat: r.lat, lng: r.lng },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: radius / 2,
          fillColor: colorForSize(r.hailSizeInches),
          fillOpacity: 0.85,
          strokeColor: '#ffffff',
          strokeWeight: 1.5,
        },
        title: `CoCoRaHS · ${r.hailSizeInches.toFixed(2)}" hail · ${r.observerStation ?? 'observer'}${r.county ? ` · ${r.county}` : ''}`,
        zIndex: 1500,
      });
      markersRef.current.push(marker);
    }
    return () => {
      for (const m of markersRef.current) m.setMap(null);
      markersRef.current = [];
    };
  }, [map, enabled, filtered]);

  return null;
}

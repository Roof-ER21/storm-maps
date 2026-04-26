/**
 * MesocycloneLayer — NEXRAD Level-3 nx3mda rotating-updraft detections.
 *
 * Marks supercells / tornado-precursor rotation. Strength rating:
 *   1-5  weak (filtered out by default)
 *   6-10 moderate (supercell signature) — orange
 *   11+  strong (high tornado potential) — red, larger glyph
 *
 * Adjusters get an extra forensic indicator: even if MRMS hail size was
 * borderline, "WSR-88D detected supercell rotation at 0.4 mi" is strong
 * evidence of severe-weather impact.
 */

import { useEffect, useRef, useState } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import type { BoundingBox } from '../types/storm';

interface MesocycloneDetection {
  time: string;
  lat: number;
  lng: number;
  wsrId: string;
  strength: number;
  rotVel: number | null;
  baseKm: number | null;
  motionDir: number | null;
}

interface MesocycloneLayerProps {
  enabled: boolean;
  selectedDate: string | null;
  bounds?: BoundingBox | null;
}

function strengthStyle(strength: number): { color: string; scale: number } {
  if (strength >= 11) return { color: '#7c2d92', scale: 9 };
  if (strength >= 8) return { color: '#dc2626', scale: 7 };
  if (strength >= 6) return { color: '#ea580c', scale: 6 };
  return { color: '#f59e0b', scale: 4.5 };
}

export default function MesocycloneLayer({
  enabled,
  selectedDate,
  bounds,
}: MesocycloneLayerProps): null {
  const map = useMap();
  const [detections, setDetections] = useState<MesocycloneDetection[]>([]);
  const markersRef = useRef<google.maps.Marker[]>([]);

  useEffect(() => {
    if (!enabled || !selectedDate || !bounds) {
      setDetections((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({
      date: selectedDate,
      north: String(bounds.north),
      south: String(bounds.south),
      east: String(bounds.east),
      west: String(bounds.west),
      minStrength: '5',
    });
    fetch(`/api/storm/mesocyclones?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { detections?: MesocycloneDetection[] }) => {
        if (cancelled) return;
        setDetections(data.detections ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.warn('[MesocycloneLayer] fetch failed:', (err as Error).message);
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
    for (const d of detections) {
      if (!Number.isFinite(d.lat) || !Number.isFinite(d.lng)) continue;
      const style = strengthStyle(d.strength);
      const marker = new google.maps.Marker({
        map,
        position: { lat: d.lat, lng: d.lng },
        icon: {
          // 8-pointed star approximation via SVG path — distinguishes from
          // CoCoRaHS dots and mPING markers at a glance.
          path: 'M 0 -10 L 2.5 -2.5 L 10 0 L 2.5 2.5 L 0 10 L -2.5 2.5 L -10 0 L -2.5 -2.5 Z',
          scale: style.scale / 7,
          fillColor: style.color,
          fillOpacity: 0.92,
          strokeColor: '#ffffff',
          strokeWeight: 1.5,
          rotation: d.motionDir ?? 0,
        },
        title: `Mesocyclone · ${d.wsrId} · strength ${d.strength}${d.rotVel !== null ? ` · ${d.rotVel.toFixed(0)} m/s rotation` : ''}`,
        zIndex: 1700,
      });
      markersRef.current.push(marker);
    }
    return () => {
      for (const m of markersRef.current) m.setMap(null);
      markersRef.current = [];
    };
  }, [map, enabled, detections]);

  return null;
}

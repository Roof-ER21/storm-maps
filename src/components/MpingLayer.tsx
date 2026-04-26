/**
 * MpingLayer — renders mPING crowd-sourced storm reports as colored dots.
 *
 * mPING is NSSL's ground-truth feed (citizen scientists tap a button on
 * their phone the moment they see hail/wind/tornado). For consilience we
 * already use the same data behind /api/storm/mping; this layer surfaces
 * each individual report on the map so reps can see exactly where the
 * crowd is reporting impacts vs where MRMS shows the swath.
 *
 * Two modes:
 *   - selectedDate set → historical (fetch reports for that ET date)
 *   - selectedDate null → live (last `liveWindowMinutes`, default 120 min)
 *
 * Color: hail=red, wind=blue, tornado=purple.
 */

import { useEffect, useState } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import type { BoundingBox } from '../types/storm';

interface MpingReport {
  id: string;
  time: string;
  category: 'Hail' | 'Wind' | 'Tornado' | 'Rain' | 'Other';
  description: string;
  hailSizeInches: number;
  lat: number;
  lng: number;
}

interface MpingLayerProps {
  enabled: boolean;
  selectedDate: string | null;
  bounds: BoundingBox | null;
  liveWindowMinutes?: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  Hail: '#dc2626', // red
  Wind: '#2563eb', // blue
  Tornado: '#7c3aed', // purple
  Rain: '#0891b2', // cyan (rare, but pretty)
  Other: '#6b7280', // gray
};

export default function MpingLayer({
  enabled,
  selectedDate,
  bounds,
  liveWindowMinutes = 120,
}: MpingLayerProps): null {
  const map = useMap();
  const [reports, setReports] = useState<MpingReport[]>([]);

  // Fetch reports.
  useEffect(() => {
    if (!enabled) {
      setReports([]);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams();
    if (selectedDate) {
      params.set('date', selectedDate);
    } else {
      params.set('windowMinutes', String(liveWindowMinutes));
    }
    if (bounds) {
      params.set('north', String(bounds.north));
      params.set('south', String(bounds.south));
      params.set('east', String(bounds.east));
      params.set('west', String(bounds.west));
    }
    const url = `/api/storm/mping?${params.toString()}`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { reports?: MpingReport[]; configured?: boolean }) => {
        if (cancelled) return;
        setReports(data.reports ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.warn('[MpingLayer] fetch failed:', (err as Error).message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    selectedDate,
    bounds?.north,
    bounds?.south,
    bounds?.east,
    bounds?.west,
    liveWindowMinutes,
  ]);

  // Render dots on the Data layer.
  useEffect(() => {
    if (!map || !enabled) return;
    const data = new google.maps.Data({ map });
    for (const r of reports) {
      const feature = new google.maps.Data.Feature({
        geometry: new google.maps.Data.Point(
          new google.maps.LatLng(r.lat, r.lng),
        ),
        properties: {
          id: r.id,
          category: r.category,
          time: r.time,
          description: r.description,
          hailSizeInches: r.hailSizeInches,
        },
      });
      data.add(feature);
    }
    data.setStyle((feature) => ({
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 6,
        fillColor:
          CATEGORY_COLORS[feature.getProperty('category') as string] ??
          CATEGORY_COLORS.Other,
        fillOpacity: 0.85,
        strokeColor: '#1f2937',
        strokeWeight: 1,
        strokeOpacity: 0.9,
      },
      zIndex: 1000,
    }));

    const infoWindow = new google.maps.InfoWindow();
    const clickListener = data.addListener('click', (event: google.maps.Data.MouseEvent) => {
      const f = event.feature;
      const category = f.getProperty('category') as string;
      const time = f.getProperty('time') as string;
      const description = (f.getProperty('description') as string) || '';
      const hailIn = f.getProperty('hailSizeInches') as number;
      const tLocal = new Date(time).toLocaleString('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: '2-digit',
        month: 'short',
        day: 'numeric',
      });
      const hailLine =
        category === 'Hail' && hailIn > 0
          ? `<div style="margin-top:4px;color:#dc2626;font-weight:600">${hailIn.toFixed(2)}" hail</div>`
          : '';
      infoWindow.setContent(`
        <div style="font-family: system-ui; font-size: 12px; max-width: 240px">
          <div style="font-weight:700;color:${CATEGORY_COLORS[category] ?? '#374151'}">mPING ${category}</div>
          <div style="color:#6b7280;font-size:11px">${tLocal} ET</div>
          ${hailLine}
          ${description ? `<div style="margin-top:4px;color:#374151">${description.slice(0, 200)}</div>` : ''}
        </div>
      `);
      infoWindow.setPosition(event.latLng);
      infoWindow.open(map);
    });

    return () => {
      google.maps.event.removeListener(clickListener);
      data.setMap(null);
      infoWindow.close();
    };
  }, [map, enabled, reports]);

  return null;
}

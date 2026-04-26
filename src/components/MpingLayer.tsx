/**
 * MpingLayer — renders mPING crowd-sourced storm reports as colored dots
 * with smart clustering.
 *
 * Uses @googlemaps/markerclusterer (Google's official lib) for grouping at
 * low zoom: animated transitions, click-to-expand, automatic threshold
 * adjustment by viewport density. Replaces the earlier grid-bucket
 * approach with much smoother UX.
 *
 * Two modes:
 *   - selectedDate set → historical (fetch reports for that ET date)
 *   - selectedDate null → live (last `liveWindowMinutes`, default 120 min)
 *
 * Color: hail=red, wind=blue, tornado=purple, other=gray.
 */

import { useEffect, useState } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import { MarkerClusterer, type Marker } from '@googlemaps/markerclusterer';
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
  Hail: '#dc2626',
  Wind: '#2563eb',
  Tornado: '#7c3aed',
  Rain: '#0891b2',
  Other: '#6b7280',
};

function dotIcon(color: string): google.maps.Symbol {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: 6,
    fillColor: color,
    fillOpacity: 0.85,
    strokeColor: '#1f2937',
    strokeWeight: 1,
    strokeOpacity: 0.9,
  };
}

function clusterIcon(count: number): google.maps.Icon {
  // Inline SVG so we don't need a hosted asset. Color shifts toward red as
  // the cluster grows — matches the hail-priority eye-grab.
  const scale = Math.min(28, 12 + Math.sqrt(count) * 2);
  const fill =
    count >= 100 ? '#b91c1c' : count >= 25 ? '#dc2626' : count >= 5 ? '#f59e0b' : '#3b82f6';
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${scale * 2}" height="${scale * 2}" viewBox="0 0 ${scale * 2} ${scale * 2}">
      <circle cx="${scale}" cy="${scale}" r="${scale - 1}" fill="${fill}" fill-opacity="0.7" stroke="#1f2937" stroke-width="1.5"/>
      <text x="${scale}" y="${scale + 4}" font-family="system-ui, sans-serif" font-size="${Math.max(11, scale * 0.55)}" font-weight="700" fill="#fff" text-anchor="middle">${count}</text>
    </svg>
  `;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(scale * 2, scale * 2),
    anchor: new google.maps.Point(scale, scale),
  };
}

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
    fetch(`/api/storm/mping?${params.toString()}`)
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

  // Render markers + cluster them.
  useEffect(() => {
    if (!map || !enabled) return;
    const markers: Marker[] = reports.map((r) => {
      const fill = CATEGORY_COLORS[r.category] ?? CATEGORY_COLORS.Other;
      const m = new google.maps.Marker({
        position: { lat: r.lat, lng: r.lng },
        icon: dotIcon(fill),
        title: `${r.category}${r.category === 'Hail' && r.hailSizeInches > 0 ? ` ${r.hailSizeInches.toFixed(2)}"` : ''}`,
      });
      m.addListener('click', () => {
        const tLocal = new Date(r.time).toLocaleString('en-US', {
          timeZone: 'America/New_York',
          hour: 'numeric',
          minute: '2-digit',
          month: 'short',
          day: 'numeric',
        });
        const hailLine =
          r.category === 'Hail' && r.hailSizeInches > 0
            ? `<div style="margin-top:4px;color:#dc2626;font-weight:600">${r.hailSizeInches.toFixed(2)}" hail</div>`
            : '';
        const iw = new google.maps.InfoWindow({
          content: `
            <div style="font-family: system-ui; font-size: 12px; max-width: 240px">
              <div style="font-weight:700;color:${fill}">mPING ${r.category}</div>
              <div style="color:#6b7280;font-size:11px">${tLocal} ET</div>
              ${hailLine}
              ${r.description ? `<div style="margin-top:4px;color:#374151">${r.description.slice(0, 200)}</div>` : ''}
            </div>
          `,
        });
        iw.setPosition({ lat: r.lat, lng: r.lng });
        iw.open(map);
      });
      return m as unknown as Marker;
    });

    const clusterer = new MarkerClusterer({
      map,
      markers,
      renderer: {
        render: ({ count, position }) => {
          return new google.maps.Marker({
            position,
            icon: clusterIcon(count),
            // Above individual markers so clusters take priority on click.
            zIndex: 2000 + count,
          });
        },
      },
    });

    return () => {
      clusterer.clearMarkers();
      for (const m of markers) (m as google.maps.Marker).setMap(null);
    };
  }, [map, enabled, reports]);

  return null;
}

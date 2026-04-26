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

import { useEffect, useRef, useState } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import type { BoundingBox } from '../types/storm';

const CLUSTER_ZOOM_THRESHOLD = 8;
const CLUSTER_BUCKET_DEG = 0.5;

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

interface ClusterBucket {
  lat: number;
  lng: number;
  count: number;
  hailCount: number;
  windCount: number;
  tornadoCount: number;
  maxHailInches: number;
}

function bucketKey(lat: number, lng: number): string {
  const bLat = Math.floor(lat / CLUSTER_BUCKET_DEG) * CLUSTER_BUCKET_DEG;
  const bLng = Math.floor(lng / CLUSTER_BUCKET_DEG) * CLUSTER_BUCKET_DEG;
  return `${bLat.toFixed(2)},${bLng.toFixed(2)}`;
}

function clusterReports(reports: MpingReport[]): ClusterBucket[] {
  const buckets = new Map<string, ClusterBucket>();
  for (const r of reports) {
    const key = bucketKey(r.lat, r.lng);
    let b = buckets.get(key);
    if (!b) {
      const bLat = Math.floor(r.lat / CLUSTER_BUCKET_DEG) * CLUSTER_BUCKET_DEG;
      const bLng = Math.floor(r.lng / CLUSTER_BUCKET_DEG) * CLUSTER_BUCKET_DEG;
      b = {
        lat: bLat + CLUSTER_BUCKET_DEG / 2,
        lng: bLng + CLUSTER_BUCKET_DEG / 2,
        count: 0,
        hailCount: 0,
        windCount: 0,
        tornadoCount: 0,
        maxHailInches: 0,
      };
      buckets.set(key, b);
    }
    b.count += 1;
    if (r.category === 'Hail') {
      b.hailCount += 1;
      if (r.hailSizeInches > b.maxHailInches) b.maxHailInches = r.hailSizeInches;
    } else if (r.category === 'Wind') b.windCount += 1;
    else if (r.category === 'Tornado') b.tornadoCount += 1;
  }
  return [...buckets.values()];
}

export default function MpingLayer({
  enabled,
  selectedDate,
  bounds,
  liveWindowMinutes = 120,
}: MpingLayerProps): null {
  const map = useMap();
  const [reports, setReports] = useState<MpingReport[]>([]);
  const zoomRef = useRef<number>(map?.getZoom() ?? 8);
  const [zoom, setZoom] = useState<number>(zoomRef.current);

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

  // Track map zoom for clustering decision.
  useEffect(() => {
    if (!map) return;
    const update = () => {
      const z = map.getZoom() ?? 8;
      zoomRef.current = z;
      setZoom(z);
    };
    update();
    const listener = map.addListener('zoom_changed', update);
    return () => google.maps.event.removeListener(listener);
  }, [map]);

  // Render dots on the Data layer. At low zoom (< 8), cluster into buckets
  // and show a count badge per bucket. At higher zoom, show every report.
  useEffect(() => {
    if (!map || !enabled) return;
    const data = new google.maps.Data({ map });
    const useClusters = zoom < CLUSTER_ZOOM_THRESHOLD && reports.length > 25;

    if (useClusters) {
      const buckets = clusterReports(reports);
      for (const b of buckets) {
        const dominantCategory =
          b.hailCount >= b.windCount && b.hailCount >= b.tornadoCount
            ? 'Hail'
            : b.tornadoCount > b.windCount
              ? 'Tornado'
              : b.windCount > 0
                ? 'Wind'
                : 'Other';
        const feature = new google.maps.Data.Feature({
          geometry: new google.maps.Data.Point(
            new google.maps.LatLng(b.lat, b.lng),
          ),
          properties: {
            isCluster: true,
            count: b.count,
            hailCount: b.hailCount,
            windCount: b.windCount,
            tornadoCount: b.tornadoCount,
            maxHailInches: b.maxHailInches,
            category: dominantCategory,
          },
        });
        data.add(feature);
      }
    } else {
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
    }

    data.setStyle((feature) => {
      const isCluster = Boolean(feature.getProperty('isCluster'));
      const category = feature.getProperty('category') as string;
      const fill = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.Other;
      if (isCluster) {
        const count = feature.getProperty('count') as number;
        const scale = Math.min(28, 10 + Math.sqrt(count) * 2);
        return {
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale,
            fillColor: fill,
            fillOpacity: 0.7,
            strokeColor: '#1f2937',
            strokeWeight: 1.5,
            strokeOpacity: 0.95,
          },
          label: {
            text: String(count),
            color: '#fff',
            fontSize: '11px',
            fontWeight: '700',
          },
          zIndex: 1000,
        };
      }
      return {
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 6,
          fillColor: fill,
          fillOpacity: 0.85,
          strokeColor: '#1f2937',
          strokeWeight: 1,
          strokeOpacity: 0.9,
        },
        zIndex: 1000,
      };
    });

    const infoWindow = new google.maps.InfoWindow();
    const clickListener = data.addListener('click', (event: google.maps.Data.MouseEvent) => {
      const f = event.feature;
      const isCluster = Boolean(f.getProperty('isCluster'));
      if (isCluster) {
        const count = f.getProperty('count') as number;
        const hail = f.getProperty('hailCount') as number;
        const wind = f.getProperty('windCount') as number;
        const tornado = f.getProperty('tornadoCount') as number;
        const maxHail = f.getProperty('maxHailInches') as number;
        infoWindow.setContent(`
          <div style="font-family: system-ui; font-size: 12px; max-width: 240px">
            <div style="font-weight:700">mPING cluster · ${count} report${count === 1 ? '' : 's'}</div>
            <div style="margin-top:4px;font-size:11px;color:#374151">
              ${hail > 0 ? `<div><span style="color:${CATEGORY_COLORS.Hail}">●</span> ${hail} hail${maxHail > 0 ? ` (peak ${maxHail.toFixed(2)}″)` : ''}</div>` : ''}
              ${wind > 0 ? `<div><span style="color:${CATEGORY_COLORS.Wind}">●</span> ${wind} wind</div>` : ''}
              ${tornado > 0 ? `<div><span style="color:${CATEGORY_COLORS.Tornado}">●</span> ${tornado} tornado</div>` : ''}
            </div>
            <div style="margin-top:6px;font-size:10px;color:#9ca3af">Zoom in to see individual reports.</div>
          </div>
        `);
        infoWindow.setPosition(event.latLng);
        infoWindow.open(map);
        return;
      }
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
  }, [map, enabled, reports, zoom]);

  return null;
}

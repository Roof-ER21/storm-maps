/**
 * WindSwathLayer — renders gust-band MultiPolygons on Google Maps.
 *
 * Visual design:
 *   - Higher bands sit on top (z-index keyed off `level`).
 *   - Hover changes opacity for legibility without flashing the page.
 *   - Click opens an InfoWindow with the band, source mix, and field-grade
 *     guidance for canvassing reps.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import type { WindSwathCollection, WindSwathFeature } from '../services/windApi';
import { WIND_BAND_LEVELS } from '../types/windLevels';

interface WindSwathLayerProps {
  collection: WindSwathCollection | null;
  visible: boolean;
  highlightSelected?: boolean;
  onPointClick?: (event: {
    lat: number;
    lng: number;
    band: WindSwathFeature['properties'] | null;
  }) => void;
}

function buildInfoContent(
  feature: WindSwathFeature,
  metadata: WindSwathCollection['metadata'],
): string {
  const fieldNote =
    WIND_BAND_LEVELS.find(
      (b) => b.minMph === feature.properties.minMph,
    )?.fieldNotes ?? '';
  const sources =
    metadata.sources.length > 0 ? metadata.sources.join(' · ') : 'No archived sources';
  const peak = metadata.maxGustMph
    ? `${Math.round(metadata.maxGustMph)} mph`
    : '—';
  return `
    <div style="font-family: system-ui, sans-serif; padding: 4px; max-width: 280px;">
      <div style="font-weight: 700; font-size: 14px; margin-bottom: 6px; color: ${feature.properties.color};">
        Wind Swath · ≥ ${feature.properties.label}
      </div>
      <div style="font-size: 12px; color: #374151; line-height: 1.5;">
        <div><strong>Date:</strong> ${metadata.date}</div>
        <div><strong>Storm peak:</strong> ${peak}</div>
        <div><strong>Reports in band:</strong> ${feature.properties.reportCount}</div>
        <div><strong>Sources:</strong> ${sources}</div>
      </div>
      ${
        fieldNote
          ? `<div style="margin-top: 8px; padding: 6px 8px; background: #fef3c7; border-left: 3px solid #f59e0b; font-size: 11px; color: #92400e; line-height: 1.4;">
              ${fieldNote}
            </div>`
          : ''
      }
    </div>
  `;
}

function getStyle(level: number, total: number, highlight: boolean) {
  // Lower bands (≥50 mph) cover the most area but should fade so the higher
  // bands stay visible on top. Top band gets a strong outline so 90+ mph cells
  // pop on satellite views.
  const isTop = level === total - 1;
  const baseFill = highlight ? 0.42 : 0.3;
  const baseStroke = highlight ? 0.95 : 0.78;
  return {
    fillOpacity: Math.max(0.12, baseFill - (total - 1 - level) * 0.04),
    strokeOpacity: isTop ? 1.0 : baseStroke,
    strokeWeight: isTop ? 4 : 3,
  };
}

export default function WindSwathLayer({
  collection,
  visible,
  highlightSelected = false,
  onPointClick,
}: WindSwathLayerProps) {
  const map = useMap();
  const polygonsRef = useRef<google.maps.Polygon[]>([]);
  const infoRef = useRef<google.maps.InfoWindow | null>(null);

  const clear = useCallback(() => {
    for (const p of polygonsRef.current) {
      p.setMap(null);
    }
    polygonsRef.current = [];
    infoRef.current?.close();
  }, []);

  useEffect(() => {
    if (!map) return;

    clear();
    if (!visible || !collection || collection.features.length === 0) return;

    if (!infoRef.current) {
      infoRef.current = new google.maps.InfoWindow();
    }

    const total = collection.features.length;
    for (const feature of collection.features) {
      const style = getStyle(feature.properties.level, total, highlightSelected);
      const content = buildInfoContent(feature, collection.metadata);
      const baseZ = 100 + feature.properties.level * 10;

      for (const polygon of feature.geometry.coordinates) {
        if (polygon.length === 0) continue;
        const paths = polygon.map((ring) =>
          ring.map(([lng, lat]) => ({ lat, lng })),
        );
        const shape = new google.maps.Polygon({
          paths,
          strokeColor: feature.properties.color,
          strokeOpacity: style.strokeOpacity,
          strokeWeight: style.strokeWeight,
          fillColor: feature.properties.color,
          fillOpacity: style.fillOpacity,
          map,
          zIndex: baseZ,
          clickable: true,
        });

        shape.addListener('mouseover', () => {
          shape.setOptions({
            fillOpacity: Math.min(0.55, style.fillOpacity + 0.18),
          });
        });
        shape.addListener('mouseout', () => {
          shape.setOptions({ fillOpacity: style.fillOpacity });
        });
        shape.addListener('click', (e: google.maps.MapMouseEvent) => {
          infoRef.current!.setContent(content);
          if (e.latLng) {
            infoRef.current!.setPosition(e.latLng);
          }
          infoRef.current!.open(map);
          onPointClick?.({
            lat: e.latLng?.lat() ?? 0,
            lng: e.latLng?.lng() ?? 0,
            band: feature.properties,
          });
        });

        polygonsRef.current.push(shape);
      }
    }

    return () => {
      clear();
    };
  }, [map, collection, visible, highlightSelected, clear, onPointClick]);

  return null;
}

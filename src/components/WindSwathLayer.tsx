/**
 * WindSwathLayer — gust-band MultiPolygon renderer via google.maps.Data.
 *
 * Same architectural shape as HailSwathLayer:
 *   - one Data layer holds every band feature
 *   - feature-level styling via setStyle((feature) => StyleOptions)
 *   - hover via overrideStyle / revertStyle
 *   - one click listener on the layer (not per polygon)
 *
 * Wind bands are rendered cumulatively (the ≥50 mph swath visually contains
 * the ≥75 mph swath) so the higher bands stay on top — z-index keys off the
 * `level` property in the same way.
 */

import { useEffect, useRef } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import type {
  WindSwathCollection,
  WindSwathFeature,
} from '../services/windApi';
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

interface FeatureProps {
  level: number;
  color: string;
  isTop: boolean;
  isEmphasized: boolean;
  baseFillOpacity: number;
  baseStrokeOpacity: number;
  baseStrokeWeight: number;
  infoContent: string;
  bandJson: string;
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
    metadata.sources.length > 0
      ? metadata.sources.join(' · ')
      : 'No archived sources';
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

function bandStyle(level: number, total: number, highlight: boolean) {
  const isTop = level === total - 1;
  const baseFill = highlight ? 0.42 : 0.3;
  return {
    fillOpacity: Math.max(0.12, baseFill - (total - 1 - level) * 0.04),
    strokeOpacity: isTop ? 1.0 : highlight ? 0.95 : 0.78,
    strokeWeight: isTop ? 4 : 3,
    isTop,
  };
}

function styleFeature(
  feature: google.maps.Data.Feature,
): google.maps.Data.StyleOptions {
  const color = (feature.getProperty('color') as string) ?? '#FF8800';
  const level = (feature.getProperty('level') as number) ?? 0;
  const fillOpacity = (feature.getProperty('baseFillOpacity') as number) ?? 0.3;
  const strokeOpacity = (feature.getProperty('baseStrokeOpacity') as number) ?? 0.78;
  const strokeWeight = (feature.getProperty('baseStrokeWeight') as number) ?? 3;
  return {
    fillColor: color,
    fillOpacity,
    strokeColor: color,
    strokeOpacity,
    strokeWeight,
    zIndex: 100 + level * 10,
    clickable: true,
  };
}

export default function WindSwathLayer({
  collection,
  visible,
  highlightSelected = false,
  onPointClick,
}: WindSwathLayerProps) {
  const map = useMap();
  const dataLayerRef = useRef<google.maps.Data | null>(null);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const listenersRef = useRef<google.maps.MapsEventListener[]>([]);
  const hoveredIdRef = useRef<string | null>(null);
  // Hold the latest onPointClick in a ref so the long-lived click listener
  // always calls the current callback without needing to re-bind.
  const onPointClickRef = useRef(onPointClick);
  useEffect(() => {
    onPointClickRef.current = onPointClick;
  }, [onPointClick]);

  // One Data layer + listeners per map. Feature collection swaps via
  // addGeoJson; the layer is reused.
  useEffect(() => {
    if (!map) return;

    const data = new google.maps.Data({ map });
    data.setStyle(styleFeature);
    dataLayerRef.current = data;
    infoWindowRef.current = new google.maps.InfoWindow();

    const clickListener = data.addListener(
      'click',
      (event: google.maps.Data.MouseEvent) => {
        const content = event.feature.getProperty('infoContent') as
          | string
          | undefined;
        if (content) {
          infoWindowRef.current!.setContent(content);
          if (event.latLng) infoWindowRef.current!.setPosition(event.latLng);
          infoWindowRef.current!.open(map);
        }
        if (onPointClickRef.current && event.latLng) {
          let band: WindSwathFeature['properties'] | null = null;
          const json = event.feature.getProperty('bandJson') as string | undefined;
          if (json) {
            try {
              band = JSON.parse(json) as WindSwathFeature['properties'];
            } catch {
              band = null;
            }
          }
          onPointClickRef.current({
            lat: event.latLng.lat(),
            lng: event.latLng.lng(),
            band,
          });
        }
      },
    );

    const overListener = data.addListener(
      'mouseover',
      (event: google.maps.Data.MouseEvent) => {
        const id = event.feature.getId();
        const idStr =
          typeof id === 'string' || typeof id === 'number' ? String(id) : null;
        if (!idStr) return;
        if (hoveredIdRef.current === idStr) return;

        if (hoveredIdRef.current !== null) {
          const prev = data.getFeatureById(hoveredIdRef.current);
          if (prev) data.revertStyle(prev);
        }
        hoveredIdRef.current = idStr;

        const baseFill =
          (event.feature.getProperty('baseFillOpacity') as number) ?? 0.3;
        const color =
          (event.feature.getProperty('color') as string) ?? '#FF8800';
        data.overrideStyle(event.feature, {
          fillColor: color,
          fillOpacity: Math.min(0.55, baseFill + 0.18),
          strokeOpacity: 1,
        });
      },
    );

    const outListener = data.addListener(
      'mouseout',
      (event: google.maps.Data.MouseEvent) => {
        const id = event.feature.getId();
        const idStr =
          typeof id === 'string' || typeof id === 'number' ? String(id) : null;
        if (idStr && hoveredIdRef.current === idStr) {
          hoveredIdRef.current = null;
        }
        data.revertStyle(event.feature);
      },
    );

    listenersRef.current = [clickListener, overListener, outListener];

    return () => {
      for (const listener of listenersRef.current) listener.remove();
      listenersRef.current = [];
      infoWindowRef.current?.close();
      infoWindowRef.current = null;
      data.forEach((feature) => data.remove(feature));
      data.setMap(null);
      dataLayerRef.current = null;
    };
  }, [map]);

  // Swap features on every input change. Cheaper than re-creating the layer.
  useEffect(() => {
    const data = dataLayerRef.current;
    if (!data) return;
    data.forEach((feature) => data.remove(feature));

    if (!visible || !collection || collection.features.length === 0) return;

    const total = collection.features.length;
    const featureCollection = {
      type: 'FeatureCollection' as const,
      features: collection.features.map((feature) => {
        const style = bandStyle(
          feature.properties.level,
          total,
          highlightSelected,
        );
        const props: FeatureProps = {
          level: feature.properties.level,
          color: feature.properties.color,
          isTop: style.isTop,
          isEmphasized: highlightSelected,
          baseFillOpacity: style.fillOpacity,
          baseStrokeOpacity: style.strokeOpacity,
          baseStrokeWeight: style.strokeWeight,
          infoContent: buildInfoContent(feature, collection.metadata),
          bandJson: JSON.stringify(feature.properties),
        };
        return {
          type: 'Feature' as const,
          id: `wind-band-${feature.properties.level}`,
          properties: props,
          geometry: feature.geometry,
        };
      }),
    };

    data.addGeoJson(featureCollection);
    data.setStyle(styleFeature);
  }, [collection, visible, highlightSelected]);

  return null;
}

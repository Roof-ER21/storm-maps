/**
 * NexradOverlay -- Time-aware NEXRAD radar tiles on Google Maps.
 *
 * Uses the IEM WMS-T endpoint so the radar layer can follow a selected storm
 * date instead of always showing "right now". Historical mode also uses map
 * tiles instead of stretching a single image across the storm bounds.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import type { BoundingBox } from '../types/storm';

interface NexradOverlayProps {
  visible: boolean;
  timestamp: string;
  opacity?: number;
  focusBounds?: BoundingBox | null;
  historicalTimestamps?: string[];
}

function roundToFiveMinuteIso(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  parsed.setMinutes(Math.round(parsed.getMinutes() / 5) * 5, 0, 0);
  return parsed.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function intersectsBounds(a: BoundingBox, b: BoundingBox): boolean {
  return !(
    a.east < b.west ||
    a.west > b.east ||
    a.north < b.south ||
    a.south > b.north
  );
}

export default function NexradOverlay({
  visible,
  timestamp,
  opacity = 0.72,
  focusBounds,
  historicalTimestamps = [],
}: NexradOverlayProps) {
  const map = useMap();
  const overlayRefs = useRef<google.maps.ImageMapType[]>([]);

  const clearOverlays = useCallback((): void => {
    if (!map) return;

    const overlays = map.overlayMapTypes;
    for (const overlay of overlayRefs.current) {
      for (let i = overlays.getLength() - 1; i >= 0; i -= 1) {
        if (overlays.getAt(i) === overlay) {
          overlays.removeAt(i);
        }
      }
    }
    overlayRefs.current = [];
  }, [map]);

  useEffect(() => {
    if (!map) return;
    if (!visible) {
      clearOverlays();
      return;
    }

    const rawTimes =
      historicalTimestamps.length > 0
        ? historicalTimestamps
        : [timestamp];
    const effectiveTimes = rawTimes.map(roundToFiveMinuteIso);
    const perFrameOpacity =
      effectiveTimes.length === 1
        ? opacity
        : Math.max(0.18, Math.min(0.32, opacity / Math.min(effectiveTimes.length, 3)));

    clearOverlays();

    for (const effectiveTime of effectiveTimes) {
      const overlay = new google.maps.ImageMapType({
        getTileUrl: (coord, zoom) => {
          const projection = map.getProjection();
          if (!projection) return '';

          const tileSize = 256;
          const scale = 2 ** zoom;

          const southWest = projection.fromPointToLatLng(
            new google.maps.Point(
              (coord.x * tileSize) / scale,
              ((coord.y + 1) * tileSize) / scale,
            ),
          );
          const northEast = projection.fromPointToLatLng(
            new google.maps.Point(
              ((coord.x + 1) * tileSize) / scale,
              (coord.y * tileSize) / scale,
            ),
          );

          if (!southWest || !northEast) return '';

          const tileBounds = {
            north: northEast.lat(),
            south: southWest.lat(),
            east: northEast.lng(),
            west: southWest.lng(),
          };

          if (focusBounds && !intersectsBounds(tileBounds, focusBounds)) {
            return '';
          }

          const bbox = `${tileBounds.west},${tileBounds.south},${tileBounds.east},${tileBounds.north}`;

          return (
            'https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0r-t.cgi?' +
            'SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&' +
            'FORMAT=image/png&TRANSPARENT=true&' +
            'LAYERS=nexrad-n0r-wmst&' +
            'SRS=EPSG:4326&' +
            `TIME=${encodeURIComponent(effectiveTime)}&` +
            `WIDTH=${tileSize}&HEIGHT=${tileSize}&` +
            `BBOX=${bbox}`
          );
        },
        tileSize: new google.maps.Size(256, 256),
        opacity: perFrameOpacity,
        name: 'NEXRAD',
        maxZoom: 19,
        minZoom: 3,
      });

      overlayRefs.current.push(overlay);
    }

    if (visible) {
      for (const overlay of overlayRefs.current) {
        map.overlayMapTypes.push(overlay);
      }
    }

    return () => {
      clearOverlays();
    };
  }, [
    clearOverlays,
    focusBounds,
    historicalTimestamps,
    map,
    opacity,
    timestamp,
    visible,
  ]);

  return null;
}

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
  /**
   * When set, render only the single frame at this index inside
   * `historicalTimestamps`. Used by the storm timeline scrubber.
   */
  frameIndex?: number | null;
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
  frameIndex = null,
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

    // Scrubber mode: pin to a single frame inside historicalTimestamps and
    // render at full opacity. Falls back to the merged-multi-frame view when
    // the index is out of range.
    let rawTimes: string[];
    if (
      typeof frameIndex === 'number' &&
      historicalTimestamps.length > 0 &&
      frameIndex >= 0 &&
      frameIndex < historicalTimestamps.length
    ) {
      rawTimes = [historicalTimestamps[frameIndex]];
    } else {
      rawTimes =
        historicalTimestamps.length > 0
          ? historicalTimestamps
          : [timestamp];
    }
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

          // Convert lat/lng tile bounds to Web Mercator (EPSG:3857) meters.
          // Google Maps tiles are Web Mercator; asking the WMS for EPSG:4326
          // returned a Plate Carrée image that got stretched onto a Mercator
          // tile, which is what made the radar look "boxy and out of sync"
          // vs SA21. Re-project the bbox so the WMS returns a Mercator image
          // that lines up exactly with the underlying tile pixels.
          const lng2m = (lng: number): number => (lng * 20037508.34) / 180;
          const lat2m = (lat: number): number => {
            const sin = Math.sin((lat * Math.PI) / 180);
            return (Math.log((1 + sin) / (1 - sin)) / 2) * 6378137;
          };
          const xMin = lng2m(tileBounds.west);
          const xMax = lng2m(tileBounds.east);
          const yMin = lat2m(tileBounds.south);
          const yMax = lat2m(tileBounds.north);
          const bbox = `${xMin},${yMin},${xMax},${yMax}`;

          // n0q-t: high-res (256-level, 0.25° dBZ) NEXRAD reflectivity.
          // n0r-t was the legacy 16-level product that looked coarse on
          // modern displays. Same WMS-T time interface, drop-in replacement.
          return (
            'https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q-t.cgi?' +
            'SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&' +
            'FORMAT=image/png&TRANSPARENT=true&' +
            'LAYERS=nexrad-n0q-wmst&' +
            'SRS=EPSG:3857&' +
            `TIME=${encodeURIComponent(effectiveTime)}&` +
            `WIDTH=${tileSize}&HEIGHT=${tileSize}&` +
            `BBOX=${bbox}`
          );
        },
        tileSize: new google.maps.Size(256, 256),
        opacity: perFrameOpacity,
        name: 'NEXRAD',
        // Cap at zoom 13 — NEXRAD native resolution is ~0.25° (n0q),
        // pushing further yields visible pixel "boxes" that read as
        // jank rather than data. Google Maps continues to upscale below
        // that, but we stop fetching new tiles.
        maxZoom: 13,
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
    frameIndex,
  ]);

  return null;
}

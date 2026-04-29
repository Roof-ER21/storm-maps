/**
 * MRMSOverlay -- MRMS MESH hail ground overlay on Google Maps.
 *
 * Renders the 24-hour MESH composite from the Oracle tile server
 * as a GroundOverlay covering CONUS. Auto-refreshes every 5 minutes.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import {
  getMrmsOverlayUrl,
  CONUS_BOUNDS,
  type MrmsOverlayProduct,
} from '../services/mrmsApi';
import type { BoundingBox } from '../types/storm';

interface MRMSOverlayProps {
  visible: boolean;
  product: MrmsOverlayProduct;
  opacity?: number;
  bounds?: BoundingBox | null;
  url?: string | null;
  refreshMs?: number | null;
}

export default function MRMSOverlay({
  visible,
  product,
  opacity = 0.72,
  bounds,
  url,
  refreshMs = 5 * 60 * 1000,
}: MRMSOverlayProps) {
  const map = useMap();
  const overlayRef = useRef<google.maps.GroundOverlay | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const createOverlay = useCallback(() => {
    if (!map) return;

    // Remove existing overlay
    if (overlayRef.current) {
      overlayRef.current.setMap(null);
      overlayRef.current = null;
    }

    if (!visible) return;

    // Only cache-bust refreshing/live overlays. Historical MRMS URLs are
    // date+bbox deterministic and should reuse browser/CDN/server cache.
    const baseOverlayUrl = url ?? getMrmsOverlayUrl(product);
    const shouldCacheBust = Boolean(refreshMs && refreshMs > 0);
    const overlayUrl = shouldCacheBust
      ? `${baseOverlayUrl}${baseOverlayUrl.includes('?') ? '&' : '?'}t=${Date.now()}`
      : baseOverlayUrl;
    const overlayBounds = bounds || CONUS_BOUNDS;

    const groundBounds = new google.maps.LatLngBounds(
      { lat: overlayBounds.south, lng: overlayBounds.west },
      { lat: overlayBounds.north, lng: overlayBounds.east },
    );

    overlayRef.current = new google.maps.GroundOverlay(overlayUrl, groundBounds, {
      opacity,
      clickable: false,
    });

    overlayRef.current.setMap(map);
  }, [map, opacity, product, visible, bounds, url, refreshMs]);

  useEffect(() => {
    createOverlay();

    // Auto-refresh every 5 minutes when visible
    if (visible && refreshMs && refreshMs > 0) {
      intervalRef.current = setInterval(createOverlay, refreshMs);
    }

    return () => {
      if (overlayRef.current) {
        overlayRef.current.setMap(null);
        overlayRef.current = null;
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [createOverlay, product, refreshMs, visible]);

  return null;
}

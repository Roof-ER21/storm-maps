/**
 * MRMSOverlay -- MRMS MESH hail ground overlay on Google Maps.
 *
 * Renders the 24-hour MESH composite from the Oracle tile server
 * as a GroundOverlay covering CONUS. Auto-refreshes every 5 minutes.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useMap } from '@vis.gl/react-google-maps';
import { getMrmsOverlayUrl, CONUS_BOUNDS } from '../services/mrmsApi';

interface MRMSOverlayProps {
  visible: boolean;
}

export default function MRMSOverlay({ visible }: MRMSOverlayProps) {
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

    // Cache-bust with timestamp to get fresh data
    const url = `${getMrmsOverlayUrl()}?t=${Date.now()}`;

    const bounds = new google.maps.LatLngBounds(
      { lat: CONUS_BOUNDS.south, lng: CONUS_BOUNDS.west },
      { lat: CONUS_BOUNDS.north, lng: CONUS_BOUNDS.east },
    );

    overlayRef.current = new google.maps.GroundOverlay(url, bounds, {
      opacity: 0.5,
      clickable: false,
    });

    overlayRef.current.setMap(map);
  }, [map, visible]);

  useEffect(() => {
    createOverlay();

    // Auto-refresh every 5 minutes when visible
    if (visible) {
      intervalRef.current = setInterval(createOverlay, 5 * 60 * 1000);
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
  }, [createOverlay, visible]);

  return null;
}

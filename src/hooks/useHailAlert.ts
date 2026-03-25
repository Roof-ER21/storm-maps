// TODO: Canvassing zone alert hook
// - Monitors user GPS position against loaded hail swaths
// - Triggers alerts when entering/exiting a hail zone
// - Calculates estimated hail size at current location
// - Generates door-knocking talking points
// - Uses point-in-polygon testing against swath geometry

import { useState, useEffect } from 'react';
import type { GpsPosition, MeshSwath, CanvassingAlert } from '../types/storm';

export function useHailAlert(
  position: GpsPosition | null,
  _swaths: MeshSwath[],
): CanvassingAlert | null {
  const [alert, setAlert] = useState<CanvassingAlert | null>(null);

  useEffect(() => {
    if (!position) {
      setAlert(null);
      return;
    }

    // TODO: Implement point-in-polygon check against loaded swaths
    // For now, return a default no-alert state
    setAlert({
      inHailZone: false,
      estimatedHailSize: null,
      stormDate: null,
      distanceToSwathMiles: null,
      talkingPoints: [],
    });
  }, [position]);

  return alert;
}

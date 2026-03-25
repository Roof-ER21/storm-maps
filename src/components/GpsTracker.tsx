/**
 * GpsTracker -- Blue dot GPS marker on Google Maps.
 *
 * Renders the user's current position as a pulsing blue dot with an
 * accuracy circle. Uses AdvancedMarker from @vis.gl/react-google-maps.
 */

import { AdvancedMarker } from '@vis.gl/react-google-maps';
import type { GpsPosition } from '../types/storm';

interface GpsTrackerProps {
  position: GpsPosition | null;
}

export default function GpsTracker({ position }: GpsTrackerProps) {
  if (!position) return null;

  return (
    <AdvancedMarker
      position={{ lat: position.lat, lng: position.lng }}
      title="Your location"
      zIndex={1000}
    >
      {/* Blue dot with pulsing ring */}
      <div className="relative flex items-center justify-center">
        {/* Accuracy pulse ring */}
        <span
          className="absolute rounded-full bg-blue-400/30 animate-ping"
          style={{ width: 28, height: 28 }}
        />
        {/* Outer ring */}
        <span
          className="absolute rounded-full bg-blue-400/20 border border-blue-400/40"
          style={{ width: 24, height: 24 }}
        />
        {/* Blue dot */}
        <span
          className="relative rounded-full bg-blue-500 border-2 border-white shadow-lg"
          style={{ width: 14, height: 14 }}
        />
      </div>
    </AdvancedMarker>
  );
}

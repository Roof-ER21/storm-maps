/**
 * StormMap — Main map component.
 *
 * Currently renders a placeholder map div styled to fill the available space.
 * When a Google Maps API key is configured via VITE_GOOGLE_MAPS_API_KEY,
 * this will integrate @vis.gl/react-google-maps.
 *
 * Integration plan (uncomment when API key is available):
 *
 *   import { APIProvider, Map, Marker } from '@vis.gl/react-google-maps';
 *
 *   <APIProvider apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}>
 *     <Map
 *       defaultCenter={{ lat: center.lat, lng: center.lng }}
 *       defaultZoom={zoom}
 *       mapId="storm-maps-main"
 *       gestureHandling="greedy"
 *       mapTypeId="roadmap"
 *       mapTypeControl={true}
 *       streetViewControl={false}
 *     >
 *       {events.map((e) => (
 *         <Marker
 *           key={e.id}
 *           position={{ lat: e.beginLat, lng: e.beginLon }}
 *           title={`${e.magnitude}" hail - ${e.beginDate}`}
 *         />
 *       ))}
 *       <HailSwathLayer swaths={swaths} />
 *       <MRMSOverlay />
 *       <NexradOverlay />
 *       <GpsTracker position={gpsPosition} />
 *     </Map>
 *   </APIProvider>
 */

import type { StormEvent, MeshSwath, GpsPosition, LatLng } from '../types/storm';
import { getHailSizeClass } from '../types/storm';

interface StormMapProps {
  center: LatLng;
  zoom: number;
  events: StormEvent[];
  swaths: MeshSwath[];
  gpsPosition: GpsPosition | null;
  selectedDate: string | null;
}

export default function StormMap({
  center,
  zoom,
  events,
  swaths,
  gpsPosition,
  selectedDate,
}: StormMapProps) {
  const hasApiKey =
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY &&
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY !== 'your_google_maps_api_key_here';

  // Filter events for the selected date
  const visibleEvents = selectedDate
    ? events.filter((e) => e.beginDate.slice(0, 10) === selectedDate)
    : events;

  // Filter swaths for the selected date
  const visibleSwaths = selectedDate
    ? swaths.filter((s) => s.date === selectedDate)
    : swaths;

  if (hasApiKey) {
    // When API key is available, @vis.gl/react-google-maps will render here.
    // For now, show a "loading" state indicating the key is detected.
    return (
      <div
        id="map"
        className="flex-1 bg-gray-800 flex items-center justify-center"
      >
        <p className="text-gray-400 text-sm">
          Google Maps API key detected. Full map integration coming soon.
        </p>
      </div>
    );
  }

  // Placeholder map — shows event data visually without Google Maps
  return (
    <div
      id="map"
      className="flex-1 bg-gray-900 relative overflow-hidden"
      role="region"
      aria-label="Storm map"
    >
      {/* Grid background to simulate a map */}
      <div
        className="absolute inset-0 opacity-5"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* Center crosshair */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="relative">
          <div className="w-8 h-px bg-gray-600" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-px h-8 bg-gray-600" />
        </div>
      </div>

      {/* Event markers (simplified scatter plot) */}
      {visibleEvents.length > 0 && (
        <div className="absolute inset-0">
          {visibleEvents.slice(0, 100).map((event) => {
            const sizeClass = getHailSizeClass(event.magnitude);
            // Simple projection: distribute events around the center
            const offsetLat = event.beginLat - center.lat;
            const offsetLng = event.beginLon - center.lng;
            const scale = Math.pow(2, zoom - 4) * 8;
            const x = 50 + offsetLng * scale;
            const y = 50 - offsetLat * scale;

            // Only show if within viewport
            if (x < -10 || x > 110 || y < -10 || y > 110) return null;

            return (
              <div
                key={event.id}
                className="absolute w-3 h-3 rounded-full border border-white/30 transform -translate-x-1/2 -translate-y-1/2 cursor-pointer hover:scale-150 transition-transform"
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  backgroundColor: sizeClass?.color || '#888',
                  opacity: 0.8,
                }}
                title={`${event.magnitude}" hail - ${event.beginDate.slice(0, 10)}\n${event.narrative}`}
              />
            );
          })}
        </div>
      )}

      {/* GPS position indicator */}
      {gpsPosition && (
        <div
          className="absolute w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow-lg transform -translate-x-1/2 -translate-y-1/2 z-10"
          style={{
            left: `${50 + (gpsPosition.lng - center.lng) * Math.pow(2, zoom - 4) * 8}%`,
            top: `${50 - (gpsPosition.lat - center.lat) * Math.pow(2, zoom - 4) * 8}%`,
          }}
          title="Your location"
        >
          <span className="absolute inset-0 rounded-full bg-blue-400 animate-ping opacity-30" />
        </div>
      )}

      {/* Info overlay */}
      <div className="absolute top-4 left-4 z-10 bg-gray-950/80 backdrop-blur-sm rounded-lg p-3 border border-gray-700 max-w-xs">
        <p className="text-xs text-gray-400 mb-2">
          Map preview mode — add a Google Maps API key for the full interactive map
        </p>
        <div className="space-y-1 text-xs text-gray-300">
          <div className="flex justify-between">
            <span className="text-gray-500">Center</span>
            <span className="font-mono">
              {center.lat.toFixed(2)}, {center.lng.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Zoom</span>
            <span className="font-mono">{zoom}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Events</span>
            <span className="font-mono">{visibleEvents.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Swaths</span>
            <span className="font-mono">{visibleSwaths.length}</span>
          </div>
          {gpsPosition && (
            <div className="flex justify-between">
              <span className="text-gray-500">GPS</span>
              <span className="font-mono text-blue-400">
                {gpsPosition.lat.toFixed(4)}, {gpsPosition.lng.toFixed(4)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* "Configure API key" callout */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 bg-gray-800/90 backdrop-blur-sm rounded-lg px-4 py-2 border border-gray-600">
        <p className="text-xs text-gray-300 text-center">
          Set <code className="text-red-400 font-mono">VITE_GOOGLE_MAPS_API_KEY</code>{' '}
          in <code className="text-gray-400 font-mono">.env</code> for the full map
        </p>
      </div>
    </div>
  );
}

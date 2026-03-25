/**
 * StormMap -- Full Google Maps implementation with storm overlays.
 *
 * Renders a Google Map via @vis.gl/react-google-maps with:
 * - Hail event markers (color-coded by severity)
 * - NHP MESH swath polygons
 * - NEXRAD radar tile overlay
 * - MRMS MESH ground overlay
 * - GPS blue dot
 * - Map type toggle (roadmap/satellite)
 * - Overlay toggle controls
 *
 * IMPORTANT: This component expects to be rendered inside an <APIProvider>
 * from App.tsx. It does NOT create its own provider.
 */

import { useState, useCallback, useMemo } from 'react';
import {
  Map,
  AdvancedMarker,
  InfoWindow,
  MapControl,
  ControlPosition,
  useMap,
} from '@vis.gl/react-google-maps';
import type {
  StormEvent,
  MeshSwath,
  GpsPosition,
  LatLng,
} from '../types/storm';
import { getHailSizeClass } from '../types/storm';
import HailSwathLayer from './HailSwathLayer';
import NexradOverlay from './NexradOverlay';
import MRMSOverlay from './MRMSOverlay';
import GpsTracker from './GpsTracker';

interface StormMapProps {
  center: LatLng;
  zoom: number;
  events: StormEvent[];
  swaths: MeshSwath[];
  gpsPosition: GpsPosition | null;
  selectedDate: string | null;
  onMapClick?: (event: StormEvent | null) => void;
}

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;
const HAS_API_KEY = API_KEY && API_KEY !== 'your_google_maps_api_key_here';

// -----------------------------------------------------------------------
// Map inner content (rendered inside <Map> so useMap() works)
// -----------------------------------------------------------------------

function MapContent({
  events,
  swaths,
  gpsPosition,
  selectedDate,
  onMapClick,
}: Omit<StormMapProps, 'center' | 'zoom'>) {
  const map = useMap();
  const [selectedEvent, setSelectedEvent] = useState<StormEvent | null>(null);
  const [showNexrad, setShowNexrad] = useState(false);
  const [showMrms, setShowMrms] = useState(false);
  const [mapTypeId, setMapTypeId] = useState<'roadmap' | 'satellite'>('roadmap');

  // Filter events by date
  const visibleEvents = useMemo(() => {
    if (!selectedDate) return events;
    return events.filter((e) => e.beginDate.slice(0, 10) === selectedDate);
  }, [events, selectedDate]);

  // Handle marker click
  const handleMarkerClick = useCallback(
    (event: StormEvent) => {
      setSelectedEvent(event);
      onMapClick?.(event);
    },
    [onMapClick],
  );

  // Toggle map type
  const toggleMapType = useCallback(() => {
    const next = mapTypeId === 'roadmap' ? 'satellite' : 'roadmap';
    setMapTypeId(next);
    if (map) {
      map.setMapTypeId(next);
    }
  }, [map, mapTypeId]);

  return (
    <>
      {/* Hail event markers */}
      {visibleEvents.slice(0, 500).map((event) => {
        const sizeClass = getHailSizeClass(event.magnitude);
        const color = sizeClass?.color || '#888888';
        const size = Math.max(10, Math.min(24, event.magnitude * 10));

        return (
          <AdvancedMarker
            key={event.id}
            position={{ lat: event.beginLat, lng: event.beginLon }}
            title={`${event.magnitude}" hail - ${event.beginDate.slice(0, 10)}`}
            onClick={() => handleMarkerClick(event)}
            zIndex={Math.round(event.magnitude * 100)}
          >
            <div
              style={{
                width: size,
                height: size,
                backgroundColor: color,
                border: '2px solid rgba(255,255,255,0.7)',
                borderRadius: '50%',
                opacity: 0.85,
                cursor: 'pointer',
                boxShadow: `0 0 6px ${color}80`,
              }}
            />
          </AdvancedMarker>
        );
      })}

      {/* Selected event info window */}
      {selectedEvent && (
        <InfoWindow
          position={{
            lat: selectedEvent.beginLat,
            lng: selectedEvent.beginLon,
          }}
          onCloseClick={() => setSelectedEvent(null)}
        >
          <div style={{ maxWidth: 280, fontFamily: 'system-ui, sans-serif' }}>
            <div
              style={{
                fontWeight: 700,
                fontSize: 14,
                marginBottom: 6,
                color:
                  getHailSizeClass(selectedEvent.magnitude)?.color || '#333',
              }}
            >
              {selectedEvent.magnitude}" Hail
            </div>
            <div
              style={{ fontSize: 12, color: '#374151', lineHeight: 1.6 }}
            >
              <div>
                <strong>Date:</strong>{' '}
                {selectedEvent.beginDate.slice(0, 10)}
              </div>
              {selectedEvent.county && (
                <div>
                  <strong>Location:</strong> {selectedEvent.county}
                  {selectedEvent.state ? `, ${selectedEvent.state}` : ''}
                </div>
              )}
              <div>
                <strong>Size:</strong>{' '}
                {getHailSizeClass(selectedEvent.magnitude)?.label ||
                  'Unknown'}
              </div>
              <div>
                <strong>Severity:</strong>{' '}
                {getHailSizeClass(selectedEvent.magnitude)
                  ?.damageSeverity ?? 0}
                /5
              </div>
              <div>
                <strong>Source:</strong> {selectedEvent.source}
              </div>
              {selectedEvent.narrative && (
                <div
                  style={{
                    marginTop: 4,
                    color: '#6B7280',
                    fontStyle: 'italic',
                  }}
                >
                  {selectedEvent.narrative}
                </div>
              )}
            </div>
          </div>
        </InfoWindow>
      )}

      {/* MESH swath polygons */}
      <HailSwathLayer swaths={swaths} selectedDate={selectedDate} />

      {/* NEXRAD radar overlay */}
      <NexradOverlay visible={showNexrad} />

      {/* MRMS hail overlay */}
      <MRMSOverlay visible={showMrms} />

      {/* GPS blue dot */}
      <GpsTracker position={gpsPosition} />

      {/* Overlay toggle controls -- top-right */}
      <MapControl position={ControlPosition.RIGHT_TOP}>
        <div className="flex flex-col gap-1.5 mr-2.5 mt-2.5">
          {/* Map type toggle */}
          <button
            onClick={toggleMapType}
            className={`px-3 py-2 rounded-md shadow-md text-xs font-semibold transition-colors ${
              mapTypeId === 'satellite'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
            title={
              mapTypeId === 'satellite'
                ? 'Switch to road map'
                : 'Switch to satellite'
            }
            aria-label="Toggle map type"
          >
            <div className="flex items-center gap-1.5">
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
                />
              </svg>
              {mapTypeId === 'satellite' ? 'Map' : 'Satellite'}
            </div>
          </button>

          {/* NEXRAD toggle */}
          <button
            onClick={() => setShowNexrad((v) => !v)}
            className={`px-3 py-2 rounded-md shadow-md text-xs font-semibold transition-colors ${
              showNexrad
                ? 'bg-green-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
            title="Toggle NEXRAD radar overlay"
            aria-label="Toggle NEXRAD radar"
          >
            <div className="flex items-center gap-1.5">
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9.348 14.651a3.75 3.75 0 010-5.303m5.304 0a3.75 3.75 0 010 5.303m-7.425 2.122a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.808-3.808-9.98 0-13.789m13.788 0c3.808 3.808 3.808 9.981 0 13.789M12 12h.008v.008H12V12z"
                />
              </svg>
              Radar
            </div>
          </button>

          {/* MRMS toggle */}
          <button
            onClick={() => setShowMrms((v) => !v)}
            className={`px-3 py-2 rounded-md shadow-md text-xs font-semibold transition-colors ${
              showMrms
                ? 'bg-orange-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
            title="Toggle MRMS MESH hail overlay"
            aria-label="Toggle MRMS hail overlay"
          >
            <div className="flex items-center gap-1.5">
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"
                />
              </svg>
              MRMS
            </div>
          </button>
        </div>
      </MapControl>
    </>
  );
}

// -----------------------------------------------------------------------
// Main StormMap component
// -----------------------------------------------------------------------

export default function StormMap({
  center,
  zoom,
  events,
  swaths,
  gpsPosition,
  selectedDate,
  onMapClick,
}: StormMapProps) {
  if (!HAS_API_KEY) {
    return (
      <StormMapPlaceholder
        center={center}
        zoom={zoom}
        events={events}
        swaths={swaths}
        gpsPosition={gpsPosition}
        selectedDate={selectedDate}
      />
    );
  }

  return (
    <Map
      defaultCenter={{ lat: center.lat, lng: center.lng }}
      defaultZoom={zoom}
      mapId="storm-maps-main"
      gestureHandling="greedy"
      mapTypeId="roadmap"
      mapTypeControl={false}
      streetViewControl={false}
      fullscreenControl={false}
      zoomControl={true}
      style={{ width: '100%', height: '100%', flex: 1 }}
      reuseMaps
    >
      <MapContent
        events={events}
        swaths={swaths}
        gpsPosition={gpsPosition}
        selectedDate={selectedDate}
        onMapClick={onMapClick}
      />
    </Map>
  );
}

// -----------------------------------------------------------------------
// Placeholder when no API key is set
// -----------------------------------------------------------------------

function StormMapPlaceholder({
  center,
  zoom,
  events,
  swaths,
  gpsPosition,
  selectedDate,
}: Omit<StormMapProps, 'onMapClick'>) {
  const visibleEvents = selectedDate
    ? events.filter((e) => e.beginDate.slice(0, 10) === selectedDate)
    : events;

  const visibleSwaths = selectedDate
    ? swaths.filter((s) => s.date === selectedDate)
    : swaths;

  return (
    <div
      id="map"
      className="flex-1 bg-gray-900 relative overflow-hidden"
      role="region"
      aria-label="Storm map"
    >
      {/* Grid background */}
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

      {/* Event markers */}
      {visibleEvents.length > 0 && (
        <div className="absolute inset-0">
          {visibleEvents.slice(0, 100).map((event) => {
            const sizeClass = getHailSizeClass(event.magnitude);
            const offsetLat = event.beginLat - center.lat;
            const offsetLng = event.beginLon - center.lng;
            const scale = Math.pow(2, zoom - 4) * 8;
            const x = 50 + offsetLng * scale;
            const y = 50 - offsetLat * scale;

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

      {/* GPS indicator */}
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
          Map preview mode -- add a Google Maps API key for the full
          interactive map
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
                {gpsPosition.lat.toFixed(4)},{' '}
                {gpsPosition.lng.toFixed(4)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Configure API key callout */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 bg-gray-800/90 backdrop-blur-sm rounded-lg px-4 py-2 border border-gray-600">
        <p className="text-xs text-gray-300 text-center">
          Set{' '}
          <code className="text-red-400 font-mono">
            VITE_GOOGLE_MAPS_API_KEY
          </code>{' '}
          in <code className="text-gray-400 font-mono">.env</code> for
          the full map
        </p>
      </div>
    </div>
  );
}

/**
 * Storm Maps -- Main Application
 *
 * Wires together GPS, storm data, hail alerts, sidebar, map,
 * and search into a single cohesive application.
 *
 * The APIProvider wraps the entire map area so that both the
 * SearchBar (Places Autocomplete) and StormMap (Map + overlays)
 * share the same Google Maps context.
 */

import { useState, useCallback } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import type { StormDate, LatLng, SearchResult, StormEvent } from './types/storm';
import { useGeolocation } from './hooks/useGeolocation';
import { useStormData } from './hooks/useStormData';
import { useHailAlert } from './hooks/useHailAlert';
import { geocodeAddress } from './services/geocodeApi';
import Sidebar from './components/Sidebar';
import StormMap from './components/StormMap';
import SearchBar from './components/SearchBar';
import Legend from './components/Legend';

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;
const HAS_API_KEY = API_KEY && API_KEY !== 'your_google_maps_api_key_here';

/** Default center: DMV area */
const DEFAULT_CENTER: LatLng = { lat: 39.0, lng: -77.0 };
const DEFAULT_ZOOM = 8;

function App() {
  // ---- Location state ----
  const [mapCenter, setMapCenter] = useState<LatLng>(DEFAULT_CENTER);
  const [mapZoom, setMapZoom] = useState(DEFAULT_ZOOM);
  const [selectedDate, setSelectedDate] = useState<StormDate | null>(null);

  // ---- GPS ----
  const {
    position: gpsPosition,
    isTracking,
    startTracking,
    stopTracking,
  } = useGeolocation();

  // Use mapCenter for data queries (updates on search)
  const activeLat = mapCenter.lat;
  const activeLng = mapCenter.lng;

  // ---- Storm data ----
  const { events, swaths, stormDates, loading, error } = useStormData({
    lat: activeLat,
    lng: activeLng,
    months: 12,
  });

  // ---- Hail alert ----
  const { alert: canvassingAlert } = useHailAlert({
    position: gpsPosition,
    events,
  });

  // ---- Search handler (Places Autocomplete) ----
  const handleSearchResult = useCallback((result: SearchResult) => {
    setMapCenter({ lat: result.lat, lng: result.lng });
    setMapZoom(11);
  }, []);

  // ---- Sidebar search (manual geocoding) ----
  const handleSidebarSearch = useCallback((query: string) => {
    geocodeAddress(query).then((result) => {
      if (result) {
        setMapCenter({ lat: result.lat, lng: result.lng });
        setMapZoom(11);
      }
    });
  }, []);

  // ---- Map click handler ----
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleMapClick = useCallback((_event: StormEvent | null) => {
    // Could expand to highlight the event in the sidebar
  }, []);

  const mapArea = (
    <main className="flex-1 relative flex flex-col min-w-0">
      {/* Search bar (uses Places Autocomplete when inside APIProvider) */}
      <SearchBar onResult={handleSearchResult} />

      {/* Map */}
      <StormMap
        center={mapCenter}
        zoom={mapZoom}
        events={events}
        swaths={swaths}
        gpsPosition={gpsPosition}
        selectedDate={selectedDate?.date ?? null}
        onMapClick={handleMapClick}
      />

      {/* Legend overlay */}
      <Legend />

      {/* GPS tracking toggle */}
      <div className="absolute bottom-6 left-4 z-10">
        <button
          onClick={isTracking ? stopTracking : startTracking}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg shadow-lg text-xs font-semibold transition-colors ${
            isTracking
              ? 'bg-blue-600 text-white'
              : 'bg-white text-gray-700 hover:bg-gray-50'
          }`}
          title={isTracking ? 'Stop GPS tracking' : 'Start GPS tracking'}
          aria-label={isTracking ? 'Stop GPS tracking' : 'Start GPS tracking'}
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          {isTracking ? 'GPS On' : 'GPS'}
          {isTracking && gpsPosition && (
            <span className="w-2 h-2 rounded-full bg-blue-300 animate-pulse" />
          )}
        </button>
      </div>

      {/* Canvassing alert toast */}
      {canvassingAlert?.inHailZone && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-30 max-w-sm w-full mx-4 animate-slide-up">
          <div className="bg-red-600 text-white rounded-xl shadow-2xl p-4 border border-red-500">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg
                  className="w-5 h-5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="flex-1">
                <p className="font-semibold text-sm">
                  You're in a hail zone!
                </p>
                <p className="text-red-100 text-xs mt-0.5">
                  {canvassingAlert.estimatedHailSize}" hail detected
                  {canvassingAlert.stormDate
                    ? ` on ${canvassingAlert.stormDate}`
                    : ''}
                </p>
                {canvassingAlert.talkingPoints.length > 1 && (
                  <p className="text-red-200 text-xs mt-1 italic">
                    {canvassingAlert.talkingPoints[1]}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );

  return (
    <div className="h-full flex">
      {/* Left sidebar */}
      <Sidebar
        stormDates={stormDates}
        events={events}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        loading={loading}
        error={error}
        canvassingAlert={canvassingAlert}
        onSearch={handleSidebarSearch}
      />

      {/* Wrap map area with APIProvider so SearchBar + StormMap share context */}
      {HAS_API_KEY ? (
        <APIProvider apiKey={API_KEY}>{mapArea}</APIProvider>
      ) : (
        mapArea
      )}
    </div>
  );
}

export default App;

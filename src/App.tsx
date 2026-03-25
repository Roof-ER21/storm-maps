/**
 * Storm Maps — Main Application
 *
 * Wires together GPS, storm data, hail alerts, sidebar, map,
 * and search into a single cohesive application.
 */

import { useState, useCallback } from 'react';
import type { StormDate, LatLng, SearchResult } from './types/storm';
import { useGeolocation } from './hooks/useGeolocation';
import { useStormData } from './hooks/useStormData';
import { useHailAlert } from './hooks/useHailAlert';
import { geocodeAddress } from './services/geocodeApi';
import Sidebar from './components/Sidebar';
import StormMap from './components/StormMap';
import SearchBar from './components/SearchBar';
import Legend from './components/Legend';

/** Default center: central US (Kansas City area) */
const DEFAULT_CENTER: LatLng = { lat: 39.0, lng: -98.0 };
const DEFAULT_ZOOM = 5;

function App() {
  // ---- Location state ----
  const [mapCenter, setMapCenter] = useState<LatLng>(DEFAULT_CENTER);
  const [mapZoom, setMapZoom] = useState(DEFAULT_ZOOM);
  const [selectedDate, setSelectedDate] = useState<StormDate | null>(null);

  // ---- GPS ----
  const { position: gpsPosition } = useGeolocation();

  // Determine the active location for data fetching:
  // Use GPS if available, otherwise use mapCenter (which updates on search)
  const activeLat = gpsPosition?.lat ?? mapCenter.lat;
  const activeLng = gpsPosition?.lng ?? mapCenter.lng;

  // ---- Storm data ----
  const {
    events,
    swaths,
    stormDates,
    loading,
    error,
  } = useStormData({ lat: activeLat, lng: activeLng, months: 6 });

  // ---- Hail alert ----
  const { alert: canvassingAlert } = useHailAlert({
    position: gpsPosition,
    events,
  });

  // ---- Search handler ----
  const handleSearchResult = useCallback((result: SearchResult) => {
    setMapCenter({ lat: result.lat, lng: result.lng });
    setMapZoom(11);
  }, []);

  // ---- Sidebar search (delegates to geocoding via the search bar) ----
  const handleSidebarSearch = useCallback((query: string) => {
    // The sidebar search is a convenience shortcut.
    // Trigger geocoding and navigate the map to the result.
    geocodeAddress(query).then((result) => {
      if (result) {
        setMapCenter({ lat: result.lat, lng: result.lng });
        setMapZoom(11);
      }
    });
  }, []);

  return (
    <div className="h-full flex">
      {/* Left sidebar: storm dates, search, alerts */}
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

      {/* Main map area */}
      <main className="flex-1 relative flex flex-col min-w-0">
        {/* Search bar overlay */}
        <SearchBar onResult={handleSearchResult} />

        {/* Map */}
        <StormMap
          center={mapCenter}
          zoom={mapZoom}
          events={events}
          swaths={swaths}
          gpsPosition={gpsPosition}
          selectedDate={selectedDate?.date ?? null}
        />

        {/* Legend overlay */}
        <Legend />

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
    </div>
  );
}

export default App;

/**
 * StormMap -- Full Google Maps implementation with storm overlays.
 *
 * Key improvements:
 * - controlled camera sync with onCameraChanged
 * - fitBounds support for geocoder results
 * - historical radar driven by selected storm date
 * - live MRMS status + product controls
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  Map,
  AdvancedMarker,
  InfoWindow,
  MapControl,
  ControlPosition,
  useMap,
  type MapCameraChangedEvent,
} from '@vis.gl/react-google-maps';
import type {
  StormEvent,
  MeshSwath,
  GpsPosition,
  LatLng,
  BoundingBox,
  CanvassRouteStop,
  LeadStage,
} from '../types/storm';
import { getHailSizeClass } from '../types/storm';
import HailSwathLayer from './HailSwathLayer';
import MpingLayer from './MpingLayer';
import CocorahsLayer from './CocorahsLayer';
import MesocycloneLayer from './MesocycloneLayer';
import SynopticLayer from './SynopticLayer';
import ParcelLayer from './ParcelLayer';
import SketchLayer from './SketchLayer';
import LiveStormCellsLayer from './LiveStormCellsLayer';
import HeatmapLayer from './HeatmapLayer';
import NexradOverlay from './NexradOverlay';
import MRMSOverlay from './MRMSOverlay';
import GpsTracker from './GpsTracker';
import WindSwathLayer from './WindSwathLayer';
import WindLegend from './WindLegend';
import {
  fetchMrmsMetadata,
  fetchHistoricalMrmsMetadata,
  fetchSwathPolygons,
  fetchLiveSwathPolygons,
  getHistoricalMrmsOverlayUrl,
  fetchStormImpact,
  type MrmsOverlayProduct,
} from '../services/mrmsApi';
import {
  fetchWindSwathPolygons,
  fetchLiveWindSwathPolygons,
  type WindSwathCollection,
} from '../services/windApi';
import { geometryAreaSqMiles } from '../services/geoUtils';
import {
  toEasternDateKey,
  getTodayEasternKey,
  formatEasternDateLabel,
  formatEasternTimestamp,
} from '../services/dateUtils';

interface FitBoundsRequest {
  id: number;
  bounds: BoundingBox;
  padding: number;
  maxZoom: number;
}

interface StormMapProps {
  center: LatLng;
  zoom: number;
  bounds: BoundingBox | null;
  events: StormEvent[];
  swaths: MeshSwath[];
  gpsPosition: GpsPosition | null;
  selectedDate: string | null;
  fitBoundsRequest: FitBoundsRequest | null;
  onCameraChanged: (camera: {
    center: LatLng;
    zoom: number;
    bounds: BoundingBox | null;
  }) => void;
  onMapClick?: (event: StormEvent | null) => void;
  leadPins?: CanvassRouteStop[];
  onLeadPinClick?: (stop: CanvassRouteStop) => void;
  evidencePins?: Array<{ id: string; lat: number; lng: number; title: string; status: string }>;
  onEvidencePinClick?: (id: string) => void;
  heatmapPoints?: Array<{ lat: number; lng: number; weight: number }>;
  showHeatmap?: boolean;
  onToggleHeatmap?: () => void;
  /** When true, fetch & render the wind swath polygon layer. */
  windEnabled?: boolean;
  /** State filter for wind queries — defaults to VA/MD/PA focus territory. */
  windStates?: string[];
  /** Searched property — drops a pin so the rep sees exactly which house. */
  propertyMarker?: { lat: number; lng: number; label?: string; pinned?: boolean } | null;
  /** Search radius in miles — when set, renders a faint perimeter circle around the property pin. */
  searchRadiusMiles?: number | null;
}

interface StormContext {
  eventBounds: BoundingBox | null;
  radarBounds: BoundingBox | null;
  radarTimestamp: string;
}

interface MrmsStatus {
  product: string;
  ref_time?: string;
  generated_at?: string;
  has_hail?: boolean;
  max_mesh_inches?: number;
  hail_pixels?: number;
  bounds?: BoundingBox;
}

type MapContentProps = Omit<
  StormMapProps,
  'center' | 'zoom' | 'onCameraChanged' | 'bounds'
> & {
  mapBounds: BoundingBox | null;
};

const DEFAULT_WIND_FOCUS_STATES = ['VA', 'MD', 'PA', 'WV', 'DC', 'DE'];

const LEAD_STAGE_COLORS: Record<LeadStage, string> = {
  new: '#38bdf8',
  contacted: '#fbbf24',
  inspection_set: '#a78bfa',
  won: '#34d399',
  lost: '#94a3b8',
};

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;
const HAS_API_KEY = API_KEY && API_KEY !== 'your_google_maps_api_key_here';

function createBoundsFromPoint(point: LatLng): BoundingBox {
  return {
    north: point.lat,
    south: point.lat,
    east: point.lng,
    west: point.lng,
  };
}

function extendBounds(
  bounds: BoundingBox | null,
  point: LatLng,
): BoundingBox {
  if (!bounds) {
    return createBoundsFromPoint(point);
  }

  return {
    north: Math.max(bounds.north, point.lat),
    south: Math.min(bounds.south, point.lat),
    east: Math.max(bounds.east, point.lng),
    west: Math.min(bounds.west, point.lng),
  };
}

function mergeBounds(
  first: BoundingBox | null,
  second: BoundingBox | null,
): BoundingBox | null {
  if (!first) return second;
  if (!second) return first;

  return {
    north: Math.max(first.north, second.north),
    south: Math.min(first.south, second.south),
    east: Math.max(first.east, second.east),
    west: Math.min(first.west, second.west),
  };
}

function padBounds(bounds: BoundingBox, factor = 0.15): BoundingBox {
  const latSpan = Math.max(0.03, bounds.north - bounds.south);
  const lngSpan = Math.max(0.03, bounds.east - bounds.west);
  const latPad = latSpan * factor;
  const lngPad = lngSpan * factor;

  return {
    north: bounds.north + latPad,
    south: bounds.south - latPad,
    east: bounds.east + lngPad,
    west: bounds.west - lngPad,
  };
}

function getGeometryBounds(swath: MeshSwath): BoundingBox | null {
  const accumulate = (
    current: BoundingBox | null,
    coordinates: number[][],
  ): BoundingBox | null => {
    let next = current;
    for (const [lng, lat] of coordinates) {
      next = extendBounds(next, { lat, lng });
    }
    return next;
  };

  const geometry = swath.geometry;
  let bounds: BoundingBox | null = null;

  if (geometry.type === 'Polygon') {
    for (const ring of geometry.coordinates) {
      bounds = accumulate(bounds, ring);
    }
  } else if (geometry.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) {
        bounds = accumulate(bounds, ring);
      }
    }
  } else if (geometry.type === 'LineString') {
    bounds = accumulate(bounds, geometry.coordinates);
  } else if (geometry.type === 'MultiLineString') {
    for (const line of geometry.coordinates) {
      bounds = accumulate(bounds, line);
    }
  }

  return bounds;
}

function getStormContext(
  selectedDate: string | null,
  events: StormEvent[],
  swaths: MeshSwath[],
): StormContext {
  if (!selectedDate) {
    return {
      eventBounds: null,
      radarBounds: null,
      radarTimestamp: new Date().toISOString(),
    };
  }

  const selectedEvents = events.filter(
    (event) => toEasternDateKey(event.beginDate) === selectedDate,
  );
  const selectedSwaths = swaths.filter((swath) => swath.date === selectedDate);

  let eventBounds: BoundingBox | null = null;
  for (const event of selectedEvents) {
    eventBounds = extendBounds(eventBounds, {
      lat: event.beginLat,
      lng: event.beginLon,
    });
  }

  let swathBounds: BoundingBox | null = null;
  for (const swath of selectedSwaths) {
    swathBounds = mergeBounds(swathBounds, getGeometryBounds(swath));
  }

  const combinedBounds = mergeBounds(eventBounds, swathBounds);

  return {
    eventBounds: combinedBounds ? padBounds(combinedBounds) : null,
    radarBounds: combinedBounds ? padBounds(combinedBounds, 0.22) : null,
    radarTimestamp: getSelectedStormRadarTimestamp(selectedDate, selectedEvents),
  };
}

function hasUsableStormTime(timestamp: string): boolean {
  if (!timestamp) {
    return false;
  }

  const match = timestamp.match(/T(\d{2}):(\d{2})/);
  if (!match) {
    return false;
  }

  return !(match[1] === '00' && match[2] === '00');
}

function getSelectedStormRadarTimestamp(
  selectedDate: string,
  events: StormEvent[],
): string {
  const strongestTimedEvent = [...events]
    .filter((event) => hasUsableStormTime(event.beginDate))
    .sort(
      (a, b) =>
        b.magnitude - a.magnitude ||
        new Date(b.beginDate).getTime() - new Date(a.beginDate).getTime(),
    )[0];

  if (strongestTimedEvent) {
    return strongestTimedEvent.beginDate;
  }

  const localNoon = new Date(`${selectedDate}T12:00:00`);
  if (!Number.isNaN(localNoon.getTime())) {
    return localNoon.toISOString();
  }

  return `${selectedDate}T16:00:00Z`;
}

function formatDateBadge(dateStr: string): string {
  return formatEasternDateLabel(dateStr, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function buildFallbackStormDayRadarTimestamps(selectedDate: string): string[] {
  const localHours = [14, 16, 18, 20, 22];
  const timestamps: string[] = [];

  for (const hour of localHours) {
    const localFrame = new Date(`${selectedDate}T${String(hour).padStart(2, '0')}:00:00`);
    if (!Number.isNaN(localFrame.getTime())) {
      timestamps.push(localFrame.toISOString());
    }
  }

  return timestamps;
}

function getHistoricalRadarTimestamps(
  events: StormEvent[],
  selectedDate: string | null,
): string[] {
  const rankedTimestamps = new globalThis.Map<string, number>();

  for (const event of events) {
    if (event.eventType !== 'Hail' || !hasUsableStormTime(event.beginDate)) {
      continue;
    }

    const parsed = new Date(event.beginDate);
    if (Number.isNaN(parsed.getTime())) {
      continue;
    }

    parsed.setUTCMinutes(Math.round(parsed.getUTCMinutes() / 15) * 15, 0, 0);
    const roundedIso = parsed.toISOString();
    const existingMagnitude = rankedTimestamps.get(roundedIso) ?? 0;
    rankedTimestamps.set(roundedIso, Math.max(existingMagnitude, event.magnitude));
  }

  if (rankedTimestamps.size === 0) {
    return selectedDate ? buildFallbackStormDayRadarTimestamps(selectedDate) : [];
  }

  return Array.from(rankedTimestamps.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([timestamp]) => timestamp)
    .sort((a, b) => a.localeCompare(b));
}

function haversineDistanceMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const earthRadiusMiles = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;

  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fitMapToBounds(
  map: google.maps.Map,
  bounds: BoundingBox,
  padding = 48,
): void {
  map.fitBounds(
    new google.maps.LatLngBounds(
      { lat: bounds.south, lng: bounds.west },
      { lat: bounds.north, lng: bounds.east },
    ),
    padding,
  );
}

function MapViewportController({
  fitBoundsRequest,
}: {
  fitBoundsRequest: FitBoundsRequest | null;
}) {
  const map = useMap();
  const lastRequestRef = useRef<number | null>(null);

  useEffect(() => {
    if (!map || !fitBoundsRequest) return;
    if (lastRequestRef.current === fitBoundsRequest.id) return;

    lastRequestRef.current = fitBoundsRequest.id;

    const bounds = new google.maps.LatLngBounds(
      {
        lat: fitBoundsRequest.bounds.south,
        lng: fitBoundsRequest.bounds.west,
      },
      {
        lat: fitBoundsRequest.bounds.north,
        lng: fitBoundsRequest.bounds.east,
      },
    );

    map.fitBounds(bounds, fitBoundsRequest.padding);

    google.maps.event.addListenerOnce(map, 'idle', () => {
      const currentZoom = map.getZoom();
      if (currentZoom && currentZoom > fitBoundsRequest.maxZoom) {
        map.setZoom(fitBoundsRequest.maxZoom);
      }
    });
  }, [fitBoundsRequest, map]);

  return null;
}

/**
 * Storm timeline scrubber — sits at the bottom-center of the map when NEXRAD
 * is on for a selected storm with multiple ranked frames. Default state is
 * "All frames merged" (the existing multi-frame composite); dragging the
 * slider pins to a single frame so the rep can watch the storm cell move.
 */
function StormTimelineScrubber({
  visible,
  frameCount,
  frameIndex,
  timestamps,
  onChange,
}: {
  visible: boolean;
  frameCount: number;
  frameIndex: number | null;
  timestamps: string[];
  onChange: (next: number | null) => void;
}) {
  // Auto-play loop: 1.2s per frame; loops back to 0 after the last frame.
  // Pauses automatically if the rep clicks Merged or drags the slider away
  // from the current frame.
  const [playing, setPlaying] = useState(false);
  const sliderValue = frameIndex ?? 0;
  const isMerged = frameIndex === null;

  useEffect(() => {
    if (!playing) return;
    // If the scrubber became invisible, the storm has too few frames, or the
    // rep clicked Merged, just bail out — we don't tick. Don't flip
    // `playing` here (no setState-in-effect); the next user action that
    // makes scrubbing meaningful again will resume.
    if (!visible || frameCount <= 1 || isMerged) return;
    const id = setInterval(() => {
      onChange((sliderValue + 1) % frameCount);
    }, 1200);
    return () => clearInterval(id);
  }, [playing, sliderValue, frameCount, visible, isMerged, onChange]);

  if (!visible || frameCount <= 1) return null;
  const activeTimestamp = timestamps[sliderValue] ?? timestamps[0];

  return (
    <div className="pointer-events-none absolute bottom-24 left-1/2 z-20 w-[min(480px,80vw)] -translate-x-1/2">
      <div className="pointer-events-auto rounded-2xl border border-stone-200 bg-white/95 p-3 shadow-lg backdrop-blur">
        <div className="flex items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
          <span>Storm Timeline</span>
          <span className="font-mono normal-case tracking-normal text-stone-700">
            {isMerged
              ? `All ${frameCount} frames`
              : `Frame ${sliderValue + 1} / ${frameCount}`}
          </span>
        </div>
        <div className="mt-1 text-xs font-semibold text-stone-800">
          {isMerged
            ? 'Composite of every ranked frame'
            : formatEasternTimestamp(activeTimestamp)}
        </div>
        <input
          type="range"
          min={0}
          max={frameCount - 1}
          step={1}
          value={sliderValue}
          onChange={(e) => {
            setPlaying(false);
            onChange(parseInt(e.target.value, 10));
          }}
          aria-label="Storm timeline frame"
          className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-stone-200 accent-orange-500"
        />
        <div className="mt-2 flex items-center justify-between text-[10px] text-stone-500">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setPlaying(false);
                onChange(null);
              }}
              className={`rounded-full px-2 py-1 font-semibold uppercase tracking-wide transition-colors ${
                isMerged
                  ? 'bg-orange-500 text-white'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              Merged
            </button>
            <button
              type="button"
              onClick={() => {
                if (isMerged) onChange(0);
                setPlaying((p) => !p);
              }}
              aria-label={playing ? 'Pause' : 'Play'}
              className={`rounded-full px-2 py-1 font-semibold uppercase tracking-wide transition-colors ${
                playing
                  ? 'bg-orange-500 text-white'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              {playing ? '❚❚ Pause' : '▶ Play'}
            </button>
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => {
                setPlaying(false);
                onChange(Math.max(0, sliderValue - 1));
              }}
              disabled={!isMerged && sliderValue === 0}
              className="rounded border border-stone-200 px-2 py-1 font-mono text-stone-700 hover:bg-stone-100 disabled:opacity-40"
              aria-label="Previous frame"
            >
              ◀
            </button>
            <button
              type="button"
              onClick={() => {
                setPlaying(false);
                onChange(Math.min(frameCount - 1, sliderValue + 1));
              }}
              disabled={!isMerged && sliderValue === frameCount - 1}
              className="rounded border border-stone-200 px-2 py-1 font-mono text-stone-700 hover:bg-stone-100 disabled:opacity-40"
              aria-label="Next frame"
            >
              ▶
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LayerStatusPanel({
  showNexrad,
  showMrms,
  selectedDate,
  radarTimestamp,
  mrmsLoading,
  mrmsError,
  mrmsMeta,
  mrmsProduct,
  onSelectMrmsProduct,
  mrmsHistoricalMode,
}: {
  showNexrad: boolean;
  showMrms: boolean;
  selectedDate: string | null;
  radarTimestamp: string;
  mrmsLoading: boolean;
  mrmsError: string | null;
  mrmsMeta: MrmsStatus | null;
  mrmsProduct: MrmsOverlayProduct;
  onSelectMrmsProduct: (product: MrmsOverlayProduct) => void;
  mrmsHistoricalMode: boolean;
}) {
  const [mrmsInfoCollapsed, setMrmsInfoCollapsed] = useState(false);

  if (!showNexrad && !showMrms) {
    return null;
  }

  return (
    <div className="absolute bottom-20 left-4 z-20 flex flex-col gap-3 max-w-sm">
      {showNexrad && (
        <div className="rounded-xl border border-stone-200 bg-white/95 p-3 text-stone-900 shadow-lg backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-green-300">
                Radar
              </p>
              <p className="mt-1 text-sm font-medium">
                {selectedDate ? 'Historical NEXRAD' : 'Live NEXRAD'}
              </p>
            </div>
            <span className="rounded-full bg-green-600/20 px-2 py-1 text-[11px] text-green-700">
              {selectedDate
                ? formatDateBadge(selectedDate)
                : `${formatEasternTimestamp(radarTimestamp)} ET`}
            </span>
          </div>
          <p className="mt-2 text-xs text-stone-600">
            {selectedDate
              ? `Bounded to the selected storm on ${selectedDate}.`
              : 'Following the current map extent.'}
          </p>
          {selectedDate && (
            <p className="mt-2 text-[11px] text-green-700">
              Historical mode composites the strongest hail-report radar scans for this date.
            </p>
          )}
        </div>
      )}

      {showMrms && mrmsInfoCollapsed && (
        <button
          onClick={() => setMrmsInfoCollapsed(false)}
          className="rounded-lg bg-white/95 backdrop-blur border border-stone-200 px-3 py-1.5 text-xs font-semibold text-orange-300 backdrop-blur"
        >
          MRMS Info
        </button>
      )}

      {showMrms && !mrmsInfoCollapsed && (
        <div className="relative rounded-xl border border-stone-200 bg-white/95 p-3 text-stone-900 shadow-lg backdrop-blur">
          <button
            onClick={() => setMrmsInfoCollapsed(true)}
            className="absolute top-2 right-2 text-stone-400 hover:text-stone-900"
            aria-label="Collapse MRMS info"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <div className="flex items-center justify-between gap-3 pr-5">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-300">
                MRMS
              </p>
              <p className="mt-1 text-sm font-medium">
                {mrmsHistoricalMode ? 'Historical hail footprint' : 'Live hail overlay'}
              </p>
            </div>
            {mrmsHistoricalMode ? (
              <span className="rounded-full bg-orange-500/20 px-2 py-1 text-[11px] text-orange-700">
                {selectedDate || 'Historical'}
              </span>
            ) : (
              <div className="flex gap-1 rounded-lg bg-stone-100 p-1">
                <button
                  onClick={() => onSelectMrmsProduct('mesh60')}
                  className={`rounded px-2 py-1 text-[11px] font-semibold ${
                    mrmsProduct === 'mesh60'
                      ? 'bg-orange-500 text-stone-900'
                      : 'text-stone-600'
                  }`}
                >
                  60m
                </button>
                <button
                  onClick={() => onSelectMrmsProduct('mesh1440')}
                  className={`rounded px-2 py-1 text-[11px] font-semibold ${
                    mrmsProduct === 'mesh1440'
                      ? 'bg-orange-500 text-stone-900'
                      : 'text-stone-600'
                  }`}
                >
                  24h
                </button>
              </div>
            )}
          </div>

          {mrmsHistoricalMode && (
            <>
              <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-orange-600">
                Selected storm mode
              </p>
              {mrmsLoading && (
                <p className="mt-2 text-xs text-stone-600">
                  Loading archived MRMS hail raster for {selectedDate}...
                </p>
              )}
              {mrmsError && (
                <p className="mt-2 text-xs text-orange-300">{mrmsError}</p>
              )}
              {mrmsMeta && !mrmsLoading && !mrmsError && (
                <>
                  <p className="mt-2 text-xs text-stone-600">
                    Archived MRMS MESH for {selectedDate} · source time{' '}
                    {formatEasternTimestamp(
                      mrmsMeta.ref_time || mrmsMeta.generated_at || new Date().toISOString(),
                    )}{' '}
                    ET
                    {mrmsMeta.max_mesh_inches
                      ? ` · max ${mrmsMeta.max_mesh_inches.toFixed(2)}" hail`
                      : ''}
                  </p>
                  <p className="mt-1 text-xs text-orange-700">
                    {mrmsMeta.has_hail
                      ? 'Showing archived MRMS hail pixels only. Transparent areas were not hit by hail in this raster.'
                      : 'Archived MRMS did not report hail pixels inside the selected storm bounds.'}
                  </p>
                </>
              )}
            </>
          )}

          {!mrmsHistoricalMode && mrmsLoading && (
            <p className="mt-2 text-xs text-stone-600">
              Loading live MRMS metadata...
            </p>
          )}

          {!mrmsHistoricalMode && mrmsError && (
            <p className="mt-2 text-xs text-orange-300">{mrmsError}</p>
          )}

          {!mrmsHistoricalMode && mrmsMeta && !mrmsLoading && !mrmsError && (
            <>
              <p className="mt-2 text-xs text-stone-600">
                Updated {formatEasternTimestamp(mrmsMeta.ref_time || mrmsMeta.generated_at || new Date().toISOString())} ET
                {mrmsMeta.max_mesh_inches
                  ? ` · max ${mrmsMeta.max_mesh_inches.toFixed(2)}" hail`
                  : ''}
              </p>
              <p className="mt-1 text-xs text-stone-500">
                {mrmsMeta.has_hail
                  ? 'Live-only layer. If you do not see hail here, there is probably no current hail near this view.'
                  : 'No live hail pixels reported in the current MRMS product.'}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MapContent({
  events,
  swaths,
  gpsPosition,
  selectedDate,
  fitBoundsRequest,
  mapBounds,
  onMapClick,
  leadPins,
  onLeadPinClick,
  evidencePins,
  onEvidencePinClick,
  heatmapPoints,
  showHeatmap,
  onToggleHeatmap,
  windEnabled,
  windStates,
  propertyMarker,
  searchRadiusMiles,
}: MapContentProps) {
  const map = useMap();
  const [selectedEvent, setSelectedEvent] = useState<StormEvent | null>(null);

  // Search radius circle around the property pin. Faint dashed perimeter
  // so reps see exactly where their search includes vs excludes events.
  // Implemented as imperative google.maps.Circle since @vis.gl doesn't
  // export a React Circle component.
  useEffect(() => {
    if (!map || !propertyMarker || !searchRadiusMiles || searchRadiusMiles <= 0) {
      return;
    }
    const radiusMeters = searchRadiusMiles * 1609.344;
    const circle = new google.maps.Circle({
      map,
      center: { lat: propertyMarker.lat, lng: propertyMarker.lng },
      radius: radiusMeters,
      strokeColor: '#f97316',
      strokeOpacity: 0.5,
      strokeWeight: 1.5,
      fillColor: '#f97316',
      fillOpacity: 0.04,
      clickable: false,
      zIndex: 1,
    });
    return () => {
      circle.setMap(null);
    };
  }, [
    map,
    propertyMarker?.lat,
    propertyMarker?.lng,
    searchRadiusMiles,
  ]);

  // NEXRAD is a secondary/fallback layer — MRMS MESH is the primary hail
  // signal, but MESH under-detects small hail (<½") that reps routinely feel
  // in the field. When MRMS is empty and reps report hail in GroupMe, they
  // toggle NEXRAD reflectivity on to see the actual storm cells.
  const [showNexrad, setShowNexrad] = useState(false);
  const [showMping, setShowMping] = useState(false);
  // Three latent map layers — collapsed by default to keep the map clean.
  // Power-rep toggles for forensic-grade verification.
  const [showCocorahs, setShowCocorahs] = useState(false);
  const [showMeso, setShowMeso] = useState(false);
  const [showSynoptic, setShowSynoptic] = useState(false);
  // Field Inspection mode — opens DrawingManager so reps can mark damage
  // spots / hail streaks during a roof walk. Sketches persist in
  // localStorage by property+date.
  const [showSketch, setShowSketch] = useState(false);
  // Live Storm Cells — auto-refreshing MRMS now-cast + NWS active warnings.
  // Default ON in LIVE mode (no selectedDate) so reps watching the map
  // during an active event see cells immediately. Default OFF when
  // browsing historical dates so they don't conflict with the daily
  // composite.
  const [showLiveCells, setShowLiveCells] = useState(false);
  // Forces NexradOverlay to refresh its tile URLs on an interval while in
  // LIVE mode (no selected date). Each tick is a monotonic counter that gets
  // folded into the effective timestamp so tiles re-request every 2 min.
  const [liveNexradTick, setLiveNexradTick] = useState(0);
  const [showMrms, setShowMrms] = useState(false);
  const [mapTypeId, setMapTypeId] = useState<'roadmap' | 'satellite'>('roadmap');
  const [mrmsProduct, setMrmsProduct] =
    useState<MrmsOverlayProduct>('mesh1440');
  const [mrmsMeta, setMrmsMeta] = useState<MrmsStatus | null>(null);
  const [mrmsLoading, setMrmsLoading] = useState(false);
  const [mrmsError, setMrmsError] = useState<string | null>(null);
  const [vectorSwaths, setVectorSwaths] = useState<MeshSwath[]>([]);
  const [liveNowCast, setLiveNowCast] = useState(false);
  const [liveSwaths, setLiveSwaths] = useState<MeshSwath[]>([]);
  const [liveSwathMeta, setLiveSwathMeta] = useState<{ maxInches: number; refTime: string } | null>(null);
  const [windCollection, setWindCollection] = useState<WindSwathCollection | null>(null);
  // Storm timeline scrubber: null = "all frames merged" (default), otherwise
  // the index inside `historicalRadarTimestamps` for the single frame to show.
  // Reset whenever the selected storm changes so an old index from a previous
  // storm doesn't leak into the new frame array.
  const [scrubFrameIndex, setScrubFrameIndex] = useState<number | null>(null);
  useEffect(() => {
    setScrubFrameIndex(null);
  }, [selectedDate]);
  const [pointImpact, setPointImpact] = useState<{
    lat: number;
    lng: number;
    label: string | null;
    color: string | null;
    severity: string | null;
    sizeInches: number | null;
    directHit: boolean;
    loading: boolean;
  } | null>(null);
  const [selectedDistanceMiles, setSelectedDistanceMiles] = useState<number | null>(null);
  const radarAutoFitKeyRef = useRef<string | null>(null);
  const mrmsAutoFitKeyRef = useRef<string | null>(null);
  const previousSelectedDateRef = useRef<string | null>(null);

  const visibleEvents = useMemo(() => {
    if (!selectedDate) return events;
    return events.filter((event) => toEasternDateKey(event.beginDate) === selectedDate);
  }, [events, selectedDate]);

  const visibleHailEvents = useMemo(
    () => visibleEvents.filter((event) => event.eventType === 'Hail'),
    [visibleEvents],
  );

  const stormContext = useMemo(
    () => getStormContext(selectedDate, events, swaths),
    [events, selectedDate, swaths],
  );
  // In LIVE mode (NEXRAD on, no storm date selected), use the latest wall-clock
  // time and re-derive it every time liveNexradTick bumps, so the WMS-T tile
  // URLs pick up the freshest 5-min NEXRAD scan instead of staying frozen.
  const radarTimestamp = useMemo(() => {
    if (showNexrad && !selectedDate) {
      return new Date().toISOString();
    }
    return stormContext.radarTimestamp;
  }, [showNexrad, selectedDate, stormContext.radarTimestamp, liveNexradTick]);

  // Pulse the live tick every 2 min while NEXRAD is on and no date is picked.
  // 2 min matches NEXRAD's native scan cadence; more frequent polling wastes
  // bandwidth and tile requests.
  useEffect(() => {
    if (!showNexrad || selectedDate) return;
    const id = setInterval(() => setLiveNexradTick((n) => n + 1), 120_000);
    return () => clearInterval(id);
  }, [showNexrad, selectedDate]);
  const historicalRadarTimestamps = useMemo(() => {
    const timestamps = getHistoricalRadarTimestamps(visibleHailEvents, selectedDate);
    if (timestamps.length > 0) {
      return timestamps;
    }
    return selectedDate ? [stormContext.radarTimestamp] : [];
  }, [selectedDate, stormContext.radarTimestamp, visibleHailEvents]);
  const mrmsHistoricalMode = showMrms && Boolean(selectedDate);
  const historicalMrmsParams = useMemo(() => {
    if (!selectedDate || !stormContext.eventBounds) {
      return null;
    }

    return {
      date: selectedDate,
      bounds: stormContext.eventBounds,
      anchorTimestamp: stormContext.radarTimestamp,
    };
  }, [selectedDate, stormContext.eventBounds, stormContext.radarTimestamp]);
  const historicalMrmsUrl = useMemo(
    () =>
      historicalMrmsParams ? getHistoricalMrmsOverlayUrl(historicalMrmsParams) : null,
    [historicalMrmsParams],
  );
  const effectiveMrmsLoading =
    mrmsHistoricalMode && !historicalMrmsParams ? false : mrmsLoading;
  const effectiveMrmsError =
    mrmsHistoricalMode && !historicalMrmsParams
      ? 'Historical MRMS requires selected storm bounds.'
      : mrmsError;
  const historicalMrmsBounds = mrmsMeta?.bounds || historicalMrmsParams?.bounds || null;
  const canRenderHistoricalMrms =
    showMrms &&
    mrmsHistoricalMode &&
    Boolean(historicalMrmsUrl && historicalMrmsBounds) &&
    !effectiveMrmsLoading;

  useEffect(() => {
    if (!selectedDate) {
      previousSelectedDateRef.current = null;
      return;
    }

    if (previousSelectedDateRef.current === selectedDate) {
      return;
    }

    previousSelectedDateRef.current = selectedDate;
    queueMicrotask(() => {
      setMrmsProduct('mesh1440');
      setShowMrms(true);
      setMrmsLoading(true);
      setMrmsError(null);
    });
  }, [selectedDate]);
  const polygonSwathsForSelectedDate = useMemo(
    () =>
      selectedDate
        ? swaths.filter(
            (swath) =>
              swath.date === selectedDate &&
              (swath.geometry.type === 'Polygon' ||
                swath.geometry.type === 'MultiPolygon'),
          )
        : [],
    [selectedDate, swaths],
  );
  const swathsToRender = useMemo(() => {
    // Live now-cast takes priority when the toggle is on.
    if (liveNowCast && liveSwaths.length > 0) {
      return liveSwaths;
    }

    // When we have vector polygons from MRMS, use those — they're the highest quality
    if (vectorSwaths.length > 0) {
      return vectorSwaths;
    }

    if (mrmsHistoricalMode && mrmsMeta?.has_hail) {
      // MRMS raster is showing — hide NHP swaths to avoid visual clutter
      return [];
    }

    if (!mrmsHistoricalMode) {
      return swaths;
    }

    if (polygonSwathsForSelectedDate.length > 0) {
      return polygonSwathsForSelectedDate;
    }

    return [];
  }, [
    liveNowCast,
    liveSwaths,
    mrmsHistoricalMode,
    mrmsMeta?.has_hail,
    polygonSwathsForSelectedDate,
    swaths,
    vectorSwaths,
  ]);

  const handleMrmsToggle = useCallback(() => {
    setShowMrms((current) => {
      const next = !current;
      if (next) {
        setMrmsLoading(true);
        setMrmsError(null);
        setMrmsMeta(null);
      } else {
        setMrmsLoading(false);
      }
      return next;
    });
  }, []);

  const handleSelectMrmsProduct = useCallback(
    (product: MrmsOverlayProduct) => {
      setMrmsProduct(product);
      if (showMrms) {
        setMrmsLoading(true);
        setMrmsError(null);
      }
    },
    [showMrms],
  );

  useEffect(() => {
    if (!showMrms || mrmsHistoricalMode) {
      return;
    }

    let cancelled = false;

    fetchMrmsMetadata(mrmsProduct)
      .then((metadata) => {
        if (cancelled) return;
        if (!metadata) {
          setMrmsMeta(null);
          setMrmsError('MRMS metadata is unavailable right now.');
          return;
        }

        setMrmsMeta({
          product: metadata.product || mrmsProduct,
          ref_time: metadata.ref_time || metadata.timestamp,
          generated_at: metadata.generated_at || metadata.generated,
          has_hail: metadata.has_hail,
          max_mesh_inches: metadata.max_mesh_inches,
          hail_pixels: metadata.hail_pixels,
          bounds: metadata.bounds,
        });
      })
      .catch((error) => {
        if (!cancelled) {
          setMrmsMeta(null);
          setMrmsError(
            error instanceof Error ? error.message : 'Failed to load MRMS metadata.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setMrmsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [mrmsHistoricalMode, mrmsProduct, showMrms]);

  useEffect(() => {
    if (!showMrms || !mrmsHistoricalMode) {
      return;
    }

    if (!historicalMrmsParams) {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setMrmsLoading(true);
        setMrmsError(null);
      }
    });

    fetchHistoricalMrmsMetadata(historicalMrmsParams)
      .then((metadata) => {
        if (cancelled) return;
        if (!metadata) {
          setMrmsMeta({
            product: 'mesh1440',
            ref_time: historicalMrmsParams.anchorTimestamp || historicalMrmsParams.date,
            generated_at: undefined,
            has_hail: true,
            max_mesh_inches: undefined,
            hail_pixels: undefined,
            bounds: historicalMrmsParams.bounds,
          });
          setMrmsError(null);
          return;
        }

        setMrmsMeta({
          product: metadata.product || 'mesh1440',
          ref_time: metadata.ref_time || metadata.timestamp,
          generated_at: metadata.generated_at || metadata.generated,
          has_hail: metadata.has_hail,
          max_mesh_inches: metadata.max_mesh_inches,
          hail_pixels: metadata.hail_pixels,
          bounds: metadata.bounds,
        });
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn('[StormMap] Historical MRMS metadata unavailable, using direct overlay fallback.', error);
          setMrmsMeta({
            product: 'mesh1440',
            ref_time: historicalMrmsParams.anchorTimestamp || historicalMrmsParams.date,
            generated_at: undefined,
            has_hail: true,
            max_mesh_inches: undefined,
            hail_pixels: undefined,
            bounds: historicalMrmsParams.bounds,
          });
          setMrmsError(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setMrmsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [historicalMrmsParams, mrmsHistoricalMode, showMrms]);

  // Fetch vector swath polygons when a storm date is selected
  useEffect(() => {
    if (!mrmsHistoricalMode || !historicalMrmsParams || !selectedDate) {
      setVectorSwaths([]);
      return;
    }

    let cancelled = false;

    fetchSwathPolygons(historicalMrmsParams).then((result) => {
      if (cancelled || !result) return;

      // Convert SwathPolygonCollection features to MeshSwath format.
      // Preserve the IHM-matched color and label from the backend so the 10-band
      // palette renders instead of the legacy 7-band damage palette.
      const converted: MeshSwath[] = result.features.map((feature, i) => ({
        id: `mrms-vector-${selectedDate}-${feature.properties.level}-${i}`,
        date: selectedDate,
        geometry: feature.geometry,
        sourceGeometryType: 'polygon' as const,
        maxMeshInches: feature.properties.sizeInches,
        avgMeshInches: feature.properties.sizeInches,
        areaSqMiles: geometryAreaSqMiles(feature.geometry),
        statesAffected: [],
        displayColor: feature.properties.color,
        displayLabel: feature.properties.label,
      }));

      setVectorSwaths(converted);
    });

    return () => { cancelled = true; };
  }, [mrmsHistoricalMode, historicalMrmsParams, selectedDate]);

  // Live now-cast polygons — fetches whenever `liveNowCast` is on, refreshing
  // every 2 minutes so the radar display tracks with upstream IEM updates.
  useEffect(() => {
    if (!liveNowCast || !mapBounds) {
      setLiveSwaths([]);
      setLiveSwathMeta(null);
      return;
    }

    let cancelled = false;
    let lastFetched = 0;

    const pull = async () => {
      if (cancelled) return;
      const now = Date.now();
      if (now - lastFetched < 60 * 1000) return; // throttle to 1/min
      lastFetched = now;

      const result = await fetchLiveSwathPolygons(mapBounds);
      if (cancelled || !result) return;
      const today = getTodayEasternKey();
      const converted: MeshSwath[] = result.features.map((feature, i) => ({
        id: `live-mrms-${feature.properties.level}-${i}`,
        date: today,
        geometry: feature.geometry,
        sourceGeometryType: 'polygon' as const,
        maxMeshInches: feature.properties.sizeInches,
        avgMeshInches: feature.properties.sizeInches,
        areaSqMiles: geometryAreaSqMiles(feature.geometry),
        statesAffected: [],
        displayColor: feature.properties.color,
        displayLabel: feature.properties.label,
      }));
      setLiveSwaths(converted);
      setLiveSwathMeta({
        maxInches: result.metadata.maxMeshInches,
        refTime: result.refTime,
      });
    };

    pull();
    const id = setInterval(pull, 120 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [liveNowCast, mapBounds]);

  // ── Wind swath layer fetch ───────────────────────────────────────────────
  // Pulls per-band wind polygons whenever the wind filter is on. In live mode
  // (no selectedDate) this also folds in active SVR centroids. When the
  // storm timeline scrubber is on a single frame, we narrow the wind query
  // to ±15 min of that frame so the dots line up with the radar cell.
  const windStatesKey = (windStates ?? DEFAULT_WIND_FOCUS_STATES).join(',');
  const scrubFrameTimestamp =
    scrubFrameIndex !== null &&
    historicalRadarTimestamps.length > 0 &&
    scrubFrameIndex >= 0 &&
    scrubFrameIndex < historicalRadarTimestamps.length
      ? historicalRadarTimestamps[scrubFrameIndex]
      : null;
  useEffect(() => {
    if (!windEnabled) {
      setWindCollection(null);
      return;
    }
    const bounds =
      stormContext.eventBounds ?? mapBounds ?? null;
    if (!bounds) {
      setWindCollection(null);
      return;
    }
    let cancelled = false;
    const states = windStates ?? DEFAULT_WIND_FOCUS_STATES;

    let windowStartIso: string | undefined;
    let windowEndIso: string | undefined;
    if (scrubFrameTimestamp) {
      const t = new Date(scrubFrameTimestamp).getTime();
      if (Number.isFinite(t)) {
        windowStartIso = new Date(t - 15 * 60 * 1000).toISOString();
        windowEndIso = new Date(t + 15 * 60 * 1000).toISOString();
      }
    }

    const promise = selectedDate
      ? fetchWindSwathPolygons({
          date: selectedDate,
          bounds,
          states,
          live: false,
          windowStartIso,
          windowEndIso,
        })
      : fetchLiveWindSwathPolygons(bounds, states);

    promise.then((result) => {
      if (!cancelled) setWindCollection(result);
    });

    return () => {
      cancelled = true;
    };
    // windStatesKey covers windStates without a referential check
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    windEnabled,
    selectedDate,
    stormContext.eventBounds,
    mapBounds,
    windStatesKey,
    scrubFrameTimestamp,
  ]);

  // ── Click-anywhere impact lookup ─────────────────────────────────────────
  // Already-existing storm-impact endpoint is wired only for the searched
  // address; here we expose it on any map click so reps can probe a
  // neighborhood without re-searching.
  useEffect(() => {
    if (!map) return;
    const listener = map.addListener('click', async (e: google.maps.MapMouseEvent) => {
      if (!selectedDate) return;
      const lat = e.latLng?.lat();
      const lng = e.latLng?.lng();
      if (lat === undefined || lng === undefined) return;
      // Only run when MRMS historical mode is on; otherwise the marker click
      // logic owns the click event and we skip the API call.
      if (!mrmsHistoricalMode || !historicalMrmsParams) return;

      setPointImpact({
        lat,
        lng,
        label: null,
        color: null,
        severity: null,
        sizeInches: null,
        directHit: false,
        loading: true,
      });

      const result = await fetchStormImpact({
        date: selectedDate,
        anchorTimestamp: historicalMrmsParams.anchorTimestamp,
        bounds: historicalMrmsParams.bounds,
        points: [{ id: 'click', lat, lng }],
      });

      const impact = result?.results[0];
      setPointImpact({
        lat,
        lng,
        label: impact?.label ?? null,
        color: impact?.color ?? null,
        severity: impact?.severity ?? null,
        sizeInches: impact?.maxHailInches ?? null,
        directHit: Boolean(impact?.directHit),
        loading: false,
      });
    });
    return () => listener.remove();
  }, [map, selectedDate, mrmsHistoricalMode, historicalMrmsParams]);

  const handleMarkerClick = useCallback(
    (event: StormEvent) => {
      setSelectedEvent(event);
      setSelectedDistanceMiles(null);
      onMapClick?.(event);
    },
    [onMapClick],
  );

  const toggleMapType = useCallback(() => {
    const next = mapTypeId === 'roadmap' ? 'satellite' : 'roadmap';
    setMapTypeId(next);
    map?.setMapTypeId(next);
  }, [map, mapTypeId]);

  useEffect(() => {
    if (!selectedDate) {
      radarAutoFitKeyRef.current = null;
      return;
    }
    if (!map || !showNexrad || !stormContext.eventBounds) {
      return;
    }

    const fitKey = `${selectedDate}-${showNexrad}`;
    if (radarAutoFitKeyRef.current === fitKey) {
      return;
    }
    radarAutoFitKeyRef.current = fitKey;
    fitMapToBounds(map, stormContext.eventBounds, 56);
  }, [map, selectedDate, showNexrad, stormContext.eventBounds]);

  useEffect(() => {
    if (!selectedDate) {
      mrmsAutoFitKeyRef.current = null;
      return;
    }
    if (!map || !mrmsHistoricalMode || !stormContext.eventBounds) {
      return;
    }

    const fitKey = `${selectedDate}-${mrmsHistoricalMode}`;
    if (mrmsAutoFitKeyRef.current === fitKey) {
      return;
    }
    mrmsAutoFitKeyRef.current = fitKey;
    fitMapToBounds(map, stormContext.eventBounds, 56);
  }, [map, mrmsHistoricalMode, selectedDate, stormContext.eventBounds]);

  useEffect(() => {
    if (!map) {
      return;
    }

    const listener = map.addListener('click', (event: google.maps.MapMouseEvent) => {
      const clickedLat = event.latLng?.lat();
      const clickedLng = event.latLng?.lng();

      if (
        clickedLat === undefined ||
        clickedLng === undefined ||
        visibleHailEvents.length === 0
      ) {
        return;
      }

      const nearest = [...visibleHailEvents]
        .map((candidate) => ({
          event: candidate,
          distance: haversineDistanceMiles(
            clickedLat,
            clickedLng,
            candidate.beginLat,
            candidate.beginLon,
          ),
        }))
        .sort((a, b) => {
          if (Math.abs(a.distance - b.distance) > 0.001) {
            return a.distance - b.distance;
          }
          return (
            new Date(b.event.beginDate).getTime() -
            new Date(a.event.beginDate).getTime()
          );
        })[0];

      if (!nearest) {
        return;
      }

      setSelectedEvent(nearest.event);
      setSelectedDistanceMiles(Math.round(nearest.distance * 10) / 10);
      onMapClick?.(nearest.event);
    });

    return () => {
      listener.remove();
    };
  }, [map, onMapClick, visibleHailEvents]);

  return (
    <>
      <MapViewportController fitBoundsRequest={fitBoundsRequest} />

      {visibleEvents.slice(0, 500).map((event) => {
        const isWind = event.eventType === 'Thunderstorm Wind';
        const sizeClass = getHailSizeClass(event.magnitude);
        const color = isWind ? '#38bdf8' : sizeClass?.color || '#888888';
        const size = isWind
          ? Math.max(12, Math.min(24, event.magnitude / 4))
          : Math.max(10, Math.min(24, event.magnitude * 10));

        return (
          <AdvancedMarker
            key={event.id}
            position={{ lat: event.beginLat, lng: event.beginLon }}
            title={
              event.eventType === 'Thunderstorm Wind'
                ? `${event.magnitude} mph wind - ${formatEasternDateLabel(event.beginDate)}`
                : `${event.magnitude}" hail - ${formatEasternDateLabel(event.beginDate)}`
            }
            onClick={() => handleMarkerClick(event)}
            zIndex={Math.round(event.magnitude * 100)}
          >
            <div
              style={{
                width: size,
                height: size,
                backgroundColor: color,
                border: '2px solid rgba(255,255,255,0.7)',
                borderRadius: isWind ? '4px' : '50%',
                opacity: 0.85,
                cursor: 'pointer',
                boxShadow: `0 0 6px ${color}80`,
                transform: isWind ? 'rotate(45deg)' : undefined,
              }}
            />
          </AdvancedMarker>
        );
      })}

      {/* Lead pins */}
      {leadPins && leadPins.map((lead) => {
        const stageColor = LEAD_STAGE_COLORS[lead.leadStage] || '#94a3b8';
        return (
          <AdvancedMarker
            key={`lead-${lead.id}`}
            position={{ lat: lead.lat, lng: lead.lng }}
            title={`${lead.homeownerName || lead.locationLabel} — ${lead.leadStage}`}
            onClick={() => onLeadPinClick?.(lead)}
            zIndex={2000}
          >
            <div
              style={{
                width: 28,
                height: 28,
                backgroundColor: stageColor,
                border: '3px solid rgba(255,255,255,0.9)',
                borderRadius: '50% 50% 50% 0',
                transform: 'rotate(-45deg)',
                cursor: 'pointer',
                boxShadow: `0 0 10px ${stageColor}90, 0 2px 8px rgba(0,0,0,0.4)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span style={{ transform: 'rotate(45deg)', fontSize: 11, fontWeight: 700, color: '#fff' }}>
                {lead.leadStage === 'won' ? 'W' : lead.leadStage === 'lost' ? 'L' : lead.leadStage[0].toUpperCase()}
              </span>
            </div>
          </AdvancedMarker>
        );
      })}

      {/* Heatmap overlay — real Google Maps visualization layer */}
      <HeatmapLayer
        points={heatmapPoints || []}
        visible={Boolean(showHeatmap && heatmapPoints && heatmapPoints.length > 0)}
      />

      {/* Searched-property pin — always rendered above storm/lead/evidence
          markers so the rep can see exactly which house was searched. */}
      {propertyMarker && (
        <AdvancedMarker
          key="property-marker"
          position={{ lat: propertyMarker.lat, lng: propertyMarker.lng }}
          title={propertyMarker.label ?? 'Searched property'}
          zIndex={5000}
        >
          <div
            style={{
              position: 'relative',
              transform: 'translateY(-12px)',
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '50% 50% 50% 0',
                transform: 'rotate(-45deg)',
                background: propertyMarker.pinned
                  ? 'linear-gradient(135deg, #f59e0b, #f97316)'
                  : 'linear-gradient(135deg, #f97316, #ea580c)',
                border: '3px solid #ffffff',
                boxShadow: '0 4px 12px rgba(249,115,22,0.5), 0 2px 4px rgba(0,0,0,0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span
                style={{
                  transform: 'rotate(45deg)',
                  fontSize: 14,
                  color: '#fff',
                  fontWeight: 700,
                  lineHeight: 1,
                }}
              >
                {propertyMarker.pinned ? '★' : '•'}
              </span>
            </div>
          </div>
        </AdvancedMarker>
      )}

      {/* Evidence pins */}
      {evidencePins && evidencePins.map((pin) => (
        <AdvancedMarker
          key={`ev-${pin.id}`}
          position={{ lat: pin.lat, lng: pin.lng }}
          title={pin.title}
          onClick={() => onEvidencePinClick?.(pin.id)}
          zIndex={1800}
        >
          <div
            style={{
              width: 22,
              height: 22,
              backgroundColor: pin.status === 'approved' ? '#a78bfa' : '#fbbf24',
              border: '2px solid rgba(255,255,255,0.9)',
              borderRadius: '4px',
              cursor: 'pointer',
              boxShadow: '0 0 8px rgba(0,0,0,0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
            }}
          >
            📷
          </div>
        </AdvancedMarker>
      ))}

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
                  selectedEvent.eventType === 'Thunderstorm Wind'
                    ? '#0f766e'
                    : getHailSizeClass(selectedEvent.magnitude)?.color || '#333',
              }}
            >
              {selectedEvent.eventType === 'Thunderstorm Wind'
                ? `${selectedEvent.magnitude} mph Wind`
                : `${selectedEvent.magnitude}" Hail`}
            </div>
            <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.6 }}>
              <div>
                <strong>Date:</strong> {formatEasternDateLabel(selectedEvent.beginDate)}
              </div>
              <div>
                <strong>Type:</strong> {selectedEvent.eventType}
              </div>
              <div>
                <strong>Magnitude:</strong>{' '}
                {selectedEvent.eventType === 'Thunderstorm Wind'
                  ? `${selectedEvent.magnitude} mph`
                  : `${selectedEvent.magnitude}"`}
              </div>
              {selectedEvent.county && (
                <div>
                  <strong>Location:</strong> {selectedEvent.county}
                  {selectedEvent.state ? `, ${selectedEvent.state}` : ''}
                </div>
              )}
              {selectedDistanceMiles !== null && (
                <div>
                  <strong>Distance:</strong> {selectedDistanceMiles.toFixed(1)} mi
                </div>
              )}
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

      <HailSwathLayer
        swaths={swathsToRender}
        selectedDate={selectedDate}
        highlightSelected={mrmsHistoricalMode}
      />

      <WindSwathLayer
        collection={windCollection}
        visible={Boolean(windEnabled)}
        highlightSelected={Boolean(selectedDate)}
      />

      <MpingLayer
        enabled={showMping}
        selectedDate={selectedDate}
        bounds={null}
        liveWindowMinutes={120}
      />

      <CocorahsLayer
        enabled={showCocorahs}
        selectedDate={selectedDate}
        bounds={mapBounds}
      />

      <MesocycloneLayer
        enabled={showMeso}
        selectedDate={selectedDate}
        bounds={mapBounds}
      />

      <SynopticLayer
        enabled={showSynoptic}
        selectedDate={selectedDate}
        bounds={mapBounds}
      />

      <ParcelLayer
        lat={propertyMarker?.lat ?? null}
        lng={propertyMarker?.lng ?? null}
      />

      <SketchLayer
        enabled={showSketch}
        propertyLat={propertyMarker?.lat ?? null}
        propertyLng={propertyMarker?.lng ?? null}
        dateOfLoss={selectedDate}
      />

      {/* Live storm cells — auto-on in LIVE mode (no historical date). */}
      <LiveStormCellsLayer
        enabled={showLiveCells || (!selectedDate && !showCocorahs && !showMping)}
        bounds={mapBounds}
      />

      <WindLegend
        visible={Boolean(windEnabled) && (windCollection?.features.length ?? 0) > 0}
        reportCount={windCollection?.metadata.reportCount}
        maxGustMph={windCollection?.metadata.maxGustMph}
      />

      {pointImpact && !pointImpact.loading && (
        <InfoWindow
          position={{ lat: pointImpact.lat, lng: pointImpact.lng }}
          onCloseClick={() => setPointImpact(null)}
        >
          <div style={{ maxWidth: 240, fontFamily: 'system-ui, sans-serif' }}>
            <div
              style={{
                fontWeight: 700,
                fontSize: 13,
                marginBottom: 4,
                color: pointImpact.color ?? '#374151',
              }}
            >
              {pointImpact.directHit
                ? `Direct hit · ${pointImpact.label ?? 'hail'}`
                : 'No direct hit at this point'}
            </div>
            <div style={{ fontSize: 11, color: '#6B7280', lineHeight: 1.5 }}>
              {pointImpact.directHit
                ? `Radar-estimated max hail at this exact coordinate during ${selectedDate}.`
                : `Radar shows no hail-sized echoes at this exact coordinate for ${selectedDate}.`}
            </div>
          </div>
        </InfoWindow>
      )}

      <NexradOverlay
        visible={showNexrad}
        timestamp={radarTimestamp}
        focusBounds={selectedDate ? stormContext.radarBounds : mapBounds}
        historicalTimestamps={selectedDate ? historicalRadarTimestamps : []}
        frameIndex={
          showNexrad &&
          selectedDate &&
          scrubFrameIndex !== null &&
          historicalRadarTimestamps.length > 1
            ? scrubFrameIndex
            : null
        }
      />

      <StormTimelineScrubber
        visible={
          Boolean(showNexrad && selectedDate) &&
          historicalRadarTimestamps.length > 1
        }
        frameCount={historicalRadarTimestamps.length}
        frameIndex={scrubFrameIndex}
        timestamps={historicalRadarTimestamps}
        onChange={setScrubFrameIndex}
      />

      <MRMSOverlay
        visible={canRenderHistoricalMrms && vectorSwaths.length === 0}
        product="mesh1440"
        opacity={0.72}
        bounds={historicalMrmsBounds}
        url={historicalMrmsUrl}
        refreshMs={null}
      />

      <MRMSOverlay
        visible={showMrms && !mrmsHistoricalMode}
        product={mrmsProduct}
        opacity={0.72}
        bounds={mrmsMeta?.bounds || null}
      />

      <GpsTracker position={gpsPosition} />

      <LayerStatusPanel
        showNexrad={showNexrad}
        showMrms={showMrms}
        selectedDate={selectedDate}
        radarTimestamp={radarTimestamp}
        mrmsLoading={effectiveMrmsLoading}
        mrmsError={effectiveMrmsError}
        mrmsMeta={mrmsMeta}
        mrmsProduct={mrmsProduct}
        onSelectMrmsProduct={handleSelectMrmsProduct}
        mrmsHistoricalMode={mrmsHistoricalMode}
      />

      <MapControl position={ControlPosition.RIGHT_TOP}>
        <div className="flex flex-col gap-1.5 mr-2.5 mt-2.5">
          <button
            onClick={toggleMapType}
            className={`px-3 py-2 rounded-md shadow-md text-xs font-semibold transition-colors ${
              mapTypeId === 'satellite'
                ? 'bg-[linear-gradient(135deg,#f97316,#7c3aed)] text-white'
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

          <button
            onClick={handleMrmsToggle}
            className={`px-3 py-2 rounded-md shadow-md text-xs font-semibold transition-colors ${
              showMrms
                ? 'bg-orange-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
            title="Toggle MRMS hail overlay"
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
          {/*
            LIVE Radar toggle — NEXRAD base reflectivity direct from IEM.
            Shows rain + storm cells in real-time even when MRMS MESH is
            empty (which happens for small hail < ½" that reps routinely
            feel in the field). Auto-refreshes every 2 min in LIVE mode.
          */}
          <button
            onClick={() => setShowNexrad((v) => !v)}
            className={`px-3 py-2 rounded-md shadow-md text-xs font-semibold transition-colors ${
              showNexrad
                ? (!selectedDate ? 'bg-red-600 text-white animate-pulse' : 'bg-blue-600 text-white')
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
            title={
              showNexrad
                ? (!selectedDate
                  ? 'LIVE NEXRAD radar (refreshes every 2 min) — click to hide'
                  : 'NEXRAD radar (historical, locked to selected storm date)')
                : 'Show NEXRAD radar reflectivity (captures storms even when MRMS misses small hail)'
            }
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
                  d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z"
                />
              </svg>
              {showNexrad && !selectedDate ? 'LIVE' : 'Radar'}
            </div>
          </button>
          {/*
            mPING toggle — crowd-sourced hail/wind/tornado reports from
            NSSL's mPING phone app. Hail=red, wind=blue, tornado=purple.
            In LIVE mode (no selected date) shows last 2 hours; in
            historical mode shows reports for the selected ET date.
          */}
          <button
            onClick={() => setShowMping((v) => !v)}
            className={`px-3 py-2 rounded-md shadow-md text-xs font-semibold transition-colors ${
              showMping
                ? 'bg-rose-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
            title={
              showMping
                ? 'mPING crowd reports — click to hide'
                : 'Show mPING crowd reports (citizen-scientist hail/wind/tornado pings from NSSL)'
            }
            aria-label="Toggle mPING reports"
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
                  d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              mPING
            </div>
          </button>
          {/* CoCoRaHS — citizen-observer daily hail-pad measurements. */}
          <button
            onClick={() => setShowCocorahs((v) => !v)}
            className={`px-3 py-2 rounded-md shadow-md text-xs font-semibold transition-colors ${
              showCocorahs
                ? 'bg-amber-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
            title={
              showCocorahs
                ? 'CoCoRaHS observers — click to hide'
                : 'Show CoCoRaHS citizen-observer hail-pad measurements (daily structured reports)'
            }
            aria-label="Toggle CoCoRaHS observer reports"
          >
            CoCoRaHS
          </button>
          {/* NEXRAD Mesocyclone — Level-3 nx3mda rotating-updraft detections. */}
          <button
            onClick={() => setShowMeso((v) => !v)}
            className={`px-3 py-2 rounded-md shadow-md text-xs font-semibold transition-colors ${
              showMeso
                ? 'bg-purple-700 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
            title={
              showMeso
                ? 'Mesocyclone detections — click to hide'
                : 'Show NEXRAD mesocyclone (rotating-updraft) detections — supercell signatures and tornado precursors'
            }
            aria-label="Toggle NEXRAD mesocyclone detections"
          >
            Meso
          </button>
          {/* Synoptic — MADIS-fed surface stations with hail/wind signal flags. */}
          <button
            onClick={() => setShowSynoptic((v) => !v)}
            className={`px-3 py-2 rounded-md shadow-md text-xs font-semibold transition-colors ${
              showSynoptic
                ? 'bg-sky-700 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
            title={
              showSynoptic
                ? 'Synoptic stations — click to hide'
                : 'Show MADIS surface-station observations (gust + precip + hail keyword detection)'
            }
            aria-label="Toggle Synoptic surface stations"
          >
            Stations
          </button>
          {/* Live Cells — current MRMS now-cast hail polygons + NWS
              active warnings. Auto-on in LIVE mode; this toggle forces
              it on/off explicitly. */}
          <button
            onClick={() => setShowLiveCells((v) => !v)}
            className={`px-3 py-2 rounded-md shadow-md text-xs font-semibold transition-colors ${
              showLiveCells || (!selectedDate && !showCocorahs && !showMping)
                ? 'bg-red-600 text-white animate-pulse'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
            title={
              showLiveCells
                ? 'Live storm cells visible — click to hide'
                : 'Show current MRMS now-cast hail polygons + active NWS warnings (auto-on in LIVE mode)'
            }
            aria-label="Toggle live storm cells"
          >
            🔴 Live Cells
          </button>
          {/* Field Inspection — drawing tools for marking damage spots
              during a roof walk. Sketches persist by property+date. */}
          <button
            onClick={() => setShowSketch((v) => !v)}
            className={`px-3 py-2 rounded-md shadow-md text-xs font-semibold transition-colors ${
              showSketch
                ? 'bg-rose-700 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
            title={
              showSketch
                ? 'Field Inspection mode active — click to exit'
                : 'Enter Field Inspection mode (draw damage paths, mark dings, outline impact zones)'
            }
            aria-label="Toggle Field Inspection drawing tools"
          >
            ✍ Sketch
          </button>
          <button
            onClick={() => setLiveNowCast((v) => !v)}
            className={`px-3 py-2 rounded-md shadow-md text-xs font-semibold transition-colors ${
              liveNowCast
                ? (liveSwaths.length > 0 ? 'bg-red-600 text-white' : 'bg-slate-500 text-white')
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
            title={
              liveNowCast
                ? liveSwathMeta
                  ? `Live MRMS · 24-h MESH max · peak ${liveSwathMeta.maxInches.toFixed(2)}″ at ${formatEasternTimestamp(liveSwathMeta.refTime)} ET`
                  : 'Live MRMS · 24-h rolling max · no hail in current radar window'
                : 'Show live MRMS hail · most recent ~30-min snapshot of the rolling 24-hour MESH max (lags real-time by ~2 h)'
            }
            aria-label="Toggle live MRMS hail"
          >
            <div className="flex items-center gap-1.5">
              {liveNowCast && liveSwaths.length > 0 && (
                <span className="h-2 w-2 rounded-full bg-white animate-pulse" aria-hidden="true" />
              )}
              LIVE
            </div>
          </button>
          {onToggleHeatmap && (
            <button
              onClick={onToggleHeatmap}
              className={`px-3 py-2 rounded-md shadow-md text-xs font-semibold transition-colors ${
                showHeatmap
                  ? 'bg-[linear-gradient(135deg,#f97316,#7c3aed)] text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
              title={showHeatmap ? 'Hide heat map' : 'Show heat map'}
              aria-label="Toggle heat map"
            >
              Heat Map
            </button>
          )}
        </div>
      </MapControl>
    </>
  );
}

export default function StormMap({
  center,
  zoom,
  bounds,
  events,
  swaths,
  gpsPosition,
  selectedDate,
  fitBoundsRequest,
  onCameraChanged,
  onMapClick,
  leadPins,
  onLeadPinClick,
  evidencePins,
  onEvidencePinClick,
  heatmapPoints,
  showHeatmap,
  onToggleHeatmap,
  windEnabled,
  windStates,
  propertyMarker,
  searchRadiusMiles,
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
      id="storm-maps-main"
      center={{ lat: center.lat, lng: center.lng }}
      zoom={zoom}
      mapId="storm-maps-main"
      gestureHandling="greedy"
      mapTypeId="roadmap"
      mapTypeControl={false}
      streetViewControl={false}
      fullscreenControl={false}
      zoomControl
      style={{ width: '100%', height: '100%', flex: 1 }}
      onCameraChanged={(event: MapCameraChangedEvent) => {
        onCameraChanged({
          center: event.detail.center,
          zoom: event.detail.zoom,
          bounds: event.detail.bounds,
        });
      }}
    >
      <MapContent
        events={events}
        swaths={swaths}
        gpsPosition={gpsPosition}
        selectedDate={selectedDate}
        fitBoundsRequest={fitBoundsRequest}
        mapBounds={bounds}
        onMapClick={onMapClick}
        leadPins={leadPins}
        onLeadPinClick={onLeadPinClick}
        evidencePins={evidencePins}
        onEvidencePinClick={onEvidencePinClick}
        heatmapPoints={heatmapPoints}
        showHeatmap={showHeatmap}
        onToggleHeatmap={onToggleHeatmap}
        windEnabled={windEnabled}
        windStates={windStates}
        propertyMarker={propertyMarker}
        searchRadiusMiles={searchRadiusMiles}
      />
    </Map>
  );
}

function StormMapPlaceholder({
  center,
  zoom,
  events,
  gpsPosition,
  selectedDate,
}: Omit<StormMapProps, 'onMapClick' | 'onCameraChanged' | 'fitBoundsRequest' | 'bounds'>) {
  const visibleEvents = selectedDate
    ? events.filter((event) => toEasternDateKey(event.beginDate) === selectedDate)
    : events;

  return (
    <div
      id="map"
      className="flex-1 bg-stone-100 relative overflow-hidden"
      role="region"
      aria-label="Storm map"
    >
      <div
        className="absolute inset-0 opacity-5"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="relative">
          <div className="w-8 h-px bg-gray-600" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-px h-8 bg-gray-600" />
        </div>
      </div>

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
                className="absolute w-3 h-3 rounded-full border border-white/30 transform -translate-x-1/2 -translate-y-1/2"
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  backgroundColor: sizeClass?.color || '#888',
                  opacity: 0.8,
                }}
              />
            );
          })}
        </div>
      )}

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
    </div>
  );
}

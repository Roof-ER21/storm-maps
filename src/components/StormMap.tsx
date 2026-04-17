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
import HeatmapLayer from './HeatmapLayer';
import NexradOverlay from './NexradOverlay';
import MRMSOverlay from './MRMSOverlay';
import GpsTracker from './GpsTracker';
import {
  fetchMrmsMetadata,
  fetchHistoricalMrmsMetadata,
  fetchSwathPolygons,
  getHistoricalMrmsOverlayUrl,
  type MrmsOverlayProduct,
} from '../services/mrmsApi';

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
    (event) => event.beginDate.slice(0, 10) === selectedDate,
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

function formatEasternTimestamp(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return timestamp;
  }
}

function formatDateBadge(dateStr: string): string {
  const parsed = new Date(`${dateStr}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return dateStr;
  }

  return parsed.toLocaleDateString('en-US', {
    timeZone: 'UTC',
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
}: MapContentProps) {
  const map = useMap();
  const [selectedEvent, setSelectedEvent] = useState<StormEvent | null>(null);
  // NEXRAD hidden from UI — reps use MRMS instead
  const [showNexrad] = useState(false);
  const [showMrms, setShowMrms] = useState(false);
  const [mapTypeId, setMapTypeId] = useState<'roadmap' | 'satellite'>('roadmap');
  const [mrmsProduct, setMrmsProduct] =
    useState<MrmsOverlayProduct>('mesh1440');
  const [mrmsMeta, setMrmsMeta] = useState<MrmsStatus | null>(null);
  const [mrmsLoading, setMrmsLoading] = useState(false);
  const [mrmsError, setMrmsError] = useState<string | null>(null);
  const [vectorSwaths, setVectorSwaths] = useState<MeshSwath[]>([]);
  const [selectedDistanceMiles, setSelectedDistanceMiles] = useState<number | null>(null);
  const radarAutoFitKeyRef = useRef<string | null>(null);
  const mrmsAutoFitKeyRef = useRef<string | null>(null);
  const previousSelectedDateRef = useRef<string | null>(null);

  const visibleEvents = useMemo(() => {
    if (!selectedDate) return events;
    return events.filter((event) => event.beginDate.slice(0, 10) === selectedDate);
  }, [events, selectedDate]);

  const visibleHailEvents = useMemo(
    () => visibleEvents.filter((event) => event.eventType === 'Hail'),
    [visibleEvents],
  );

  const stormContext = useMemo(
    () => getStormContext(selectedDate, events, swaths),
    [events, selectedDate, swaths],
  );
  const radarTimestamp = stormContext.radarTimestamp;
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
        areaSqMiles: 0,
        statesAffected: [],
        displayColor: feature.properties.color,
        displayLabel: feature.properties.label,
      }));

      setVectorSwaths(converted);
    });

    return () => { cancelled = true; };
  }, [mrmsHistoricalMode, historicalMrmsParams, selectedDate]);

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
                ? `${event.magnitude} mph wind - ${event.beginDate.slice(0, 10)}`
                : `${event.magnitude}" hail - ${event.beginDate.slice(0, 10)}`
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
                <strong>Date:</strong> {selectedEvent.beginDate.slice(0, 10)}
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

      <NexradOverlay
        visible={showNexrad}
        timestamp={radarTimestamp}
        focusBounds={selectedDate ? stormContext.radarBounds : mapBounds}
        historicalTimestamps={selectedDate ? historicalRadarTimestamps : []}
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
    ? events.filter((event) => event.beginDate.slice(0, 10) === selectedDate)
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

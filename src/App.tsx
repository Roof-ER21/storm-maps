/**
 * Hail Yes! -- Main Application
 *
 * Wires together GPS, storm data, hail alerts, sidebar, map,
 * and search into a single cohesive application.
 *
 * The APIProvider wraps the entire map area so that both the
 * SearchBar (Places Autocomplete) and StormMap (Map + overlays)
 * share the same Google Maps context.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import type {
  AppView,
  CanvassOutcome,
  CanvassRouteStop,
  CanvassStopStatus,
  StormDate,
  LatLng,
  SearchResult,
  StormEvent,
  BoundingBox,
  SearchResultType,
  HistoryRangePreset,
  PropertySearchSummary,
  EventFilterState,
  PinnedProperty,
  EvidenceItem,
} from './types/storm';
import { getStormCanvassPriority } from './types/storm';
import { useGeolocation } from './hooks/useGeolocation';
import { useStormData } from './hooks/useStormData';
import { useHailAlert } from './hooks/useHailAlert';
import { geocodeAddress } from './services/geocodeApi';
import {
  getNotificationPermission,
  isNotificationSupported,
  requestNotificationPermission,
  showHailZoneNotification,
} from './services/notificationService';
import { generateStormReport } from './services/reportService';
import { generateEvidencePack } from './services/evidencePackService';
import Sidebar from './components/Sidebar';
import StormMap from './components/StormMap';
import SearchBar from './components/SearchBar';
import Legend from './components/Legend';
import AppHeader from './components/AppHeader';
import DashboardPage from './components/DashboardPage';
import CanvassPage from './components/CanvassPage';
import PinnedPropertiesPage from './components/PinnedPropertiesPage';
import ReportsPage from './components/ReportsPage';
import EvidencePage from './components/EvidencePage';
import {
  listEvidenceItems,
  removeEvidenceItem,
  saveEvidenceItem,
} from './services/evidenceStorage';
import { fetchEvidenceCandidates } from './services/evidenceApi';
import { buildEvidenceQuerySeeds } from './services/evidenceProviders';
import { buildDemoEvidencePack } from './services/demoEvidence';
import { buildRegionalEvidenceSeeds } from './services/regionalEvidenceSeeds';

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string;
const HAS_API_KEY = API_KEY && API_KEY !== 'your_google_maps_api_key_here';
const ALERT_NOTIFICATION_COOLDOWN_MS = 30 * 60 * 1000;

/** Default center: DMV area */
const DEFAULT_CENTER: LatLng = { lat: 39.4196, lng: -76.7803 };
const DEFAULT_ZOOM = 10;
const DEFAULT_HISTORY_RANGE: HistoryRangePreset = '1y';
const PINNED_PROPERTIES_STORAGE_KEY = 'storm-maps:pinned-properties';
const CANVASS_ROUTE_STORAGE_KEY = 'hail-yes:canvass-route';
const MAX_ROUTE_STOPS = 8;
const DEFAULT_SEARCH_SUMMARY: PropertySearchSummary = {
  locationLabel: 'Owings Mills, MD',
  resultType: 'locality',
  radiusMiles: 20,
  historyPreset: DEFAULT_HISTORY_RANGE,
  sinceDate: null,
};

interface MapCameraState {
  center: LatLng;
  zoom: number;
  bounds: BoundingBox | null;
}

interface FitBoundsRequest {
  id: number;
  bounds: BoundingBox;
  padding: number;
  maxZoom: number;
}

function normalizeEvidenceItem(item: EvidenceItem): EvidenceItem {
  return {
    ...item,
    includeInReport:
      typeof item.includeInReport === 'boolean'
        ? item.includeInReport
        : item.status === 'approved',
  };
}

function haversineDistanceMiles(
  left: LatLng,
  right: LatLng,
): number {
  const earthRadiusMiles = 3958.8;
  const dLat = ((right.lat - left.lat) * Math.PI) / 180;
  const dLng = ((right.lng - left.lng) * Math.PI) / 180;
  const lat1 = (left.lat * Math.PI) / 180;
  const lat2 = (right.lat * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatRouteLocationLabel(event: StormEvent | null, fallbackLabel: string): string {
  if (!event) {
    return fallbackLabel;
  }

  if (event.county && event.state) {
    return `${event.county}, ${event.state}`;
  }

  return event.county || event.state || fallbackLabel;
}

function buildCanvassRouteStop(params: {
  id: string;
  propertyLabel: string;
  stormDate: StormDate;
  event: StormEvent | null;
  evidenceCount: number;
  fallbackLabel: string;
  fallbackCenter: LatLng;
  existingStop?: CanvassRouteStop | null;
}): CanvassRouteStop {
  const priority = getStormCanvassPriority(params.stormDate, params.evidenceCount);
  const now = new Date().toISOString();
  const representativeEvent = params.event;

  return {
    id: params.id,
    propertyLabel: params.propertyLabel,
    stormDate: params.stormDate.date,
    stormLabel: params.stormDate.label,
    lat: representativeEvent?.beginLat ?? params.fallbackCenter.lat,
    lng: representativeEvent?.beginLon ?? params.fallbackCenter.lng,
    locationLabel: formatRouteLocationLabel(representativeEvent, params.fallbackLabel),
    sourceEventId: representativeEvent?.id ?? null,
    sourceLabel: representativeEvent?.source ?? 'Storm date centroid',
    topHailInches: params.stormDate.maxHailInches,
    reportCount: params.stormDate.eventCount,
    evidenceCount: params.evidenceCount,
    priority,
    status: params.existingStop?.status ?? 'queued',
    outcome: params.existingStop?.outcome ?? 'none',
    notes: params.existingStop?.notes ?? '',
    createdAt: params.existingStop?.createdAt ?? now,
    updatedAt: now,
    visitedAt: params.existingStop?.visitedAt ?? null,
    completedAt: params.existingStop?.completedAt ?? null,
  };
}

function dedupeCandidateEvents(events: StormEvent[]): StormEvent[] {
  const deduped: StormEvent[] = [];

  for (const event of events) {
    const isDuplicate = deduped.some((candidate) => {
      return (
        haversineDistanceMiles(
          { lat: candidate.beginLat, lng: candidate.beginLon },
          { lat: event.beginLat, lng: event.beginLon },
        ) < 0.5
      );
    });

    if (!isDuplicate) {
      deduped.push(event);
    }
  }

  return deduped;
}

function buildStormRouteCandidates(params: {
  propertyLabel: string;
  stormDate: StormDate;
  events: StormEvent[];
  evidenceCount: number;
  fallbackLabel: string;
  fallbackCenter: LatLng;
  existingStops: CanvassRouteStop[];
  maxStops?: number;
}): CanvassRouteStop[] {
  const hailEvents = params.events
    .filter((event) => event.eventType === 'Hail')
    .slice()
    .sort(
      (left, right) =>
        right.magnitude - left.magnitude ||
        new Date(right.beginDate).getTime() - new Date(left.beginDate).getTime(),
    );
  const dedupedCandidates = dedupeCandidateEvents(hailEvents).slice(0, params.maxStops ?? 3);

  if (dedupedCandidates.length === 0) {
    return [
      buildCanvassRouteStop({
        id: `${params.stormDate.date}-centroid`,
        propertyLabel: params.propertyLabel,
        stormDate: params.stormDate,
        event: null,
        evidenceCount: params.evidenceCount,
        fallbackLabel: params.fallbackLabel,
        fallbackCenter: params.fallbackCenter,
        existingStop:
          params.existingStops.find((stop) => stop.id === `${params.stormDate.date}-centroid`) ??
          null,
      }),
    ];
  }

  return dedupedCandidates.map((event, index) =>
    buildCanvassRouteStop({
      id: `${params.stormDate.date}-${event.id || index}`,
      propertyLabel: params.propertyLabel,
      stormDate: params.stormDate,
      event,
      evidenceCount: params.evidenceCount,
      fallbackLabel: params.fallbackLabel,
      fallbackCenter: params.fallbackCenter,
      existingStop:
        params.existingStops.find((stop) => stop.sourceEventId === event.id) ??
        params.existingStops.find((stop) => stop.id === `${params.stormDate.date}-${event.id || index}`) ??
        null,
    }),
  );
}

function orderStopsByNearest(
  stops: CanvassRouteStop[],
  origin: LatLng,
): CanvassRouteStop[] {
  const remaining = [...stops];
  const ordered: CanvassRouteStop[] = [];
  let current = origin;

  while (remaining.length > 0) {
    remaining.sort((left, right) => {
      const leftDistance = haversineDistanceMiles(current, { lat: left.lat, lng: left.lng });
      const rightDistance = haversineDistanceMiles(current, { lat: right.lat, lng: right.lng });
      if (Math.abs(leftDistance - rightDistance) > 0.05) {
        return leftDistance - rightDistance;
      }
      return right.topHailInches - left.topHailInches;
    });

    const next = remaining.shift();
    if (!next) {
      break;
    }

    ordered.push(next);
    current = { lat: next.lat, lng: next.lng };
  }

  return ordered;
}

function buildDirectionsUrl(
  stops: CanvassRouteStop[],
  origin: LatLng | null,
): string | null {
  if (stops.length === 0) {
    return null;
  }

  const baseUrl = new URL('https://www.google.com/maps/dir/');
  baseUrl.searchParams.set('api', '1');

  if (origin) {
    baseUrl.searchParams.set('origin', `${origin.lat},${origin.lng}`);
  }

  const orderedStops = stops.slice(0, MAX_ROUTE_STOPS);
  const destination = orderedStops[orderedStops.length - 1];
  baseUrl.searchParams.set('destination', `${destination.lat},${destination.lng}`);

  if (orderedStops.length > 1) {
    const waypoints = orderedStops
      .slice(0, -1)
      .map((stop) => `${stop.lat},${stop.lng}`)
      .join('|');
    if (waypoints) {
      baseUrl.searchParams.set('waypoints', waypoints);
    }
  }

  baseUrl.searchParams.set('travelmode', 'driving');
  return baseUrl.toString();
}

function buildBoundsFromRoute(
  stops: CanvassRouteStop[],
  origin: LatLng | null,
): BoundingBox | null {
  const points = [
    ...stops.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
    ...(origin ? [origin] : []),
  ];

  if (points.length === 0) {
    return null;
  }

  let north = points[0].lat;
  let south = points[0].lat;
  let east = points[0].lng;
  let west = points[0].lng;

  for (const point of points) {
    north = Math.max(north, point.lat);
    south = Math.min(south, point.lat);
    east = Math.max(east, point.lng);
    west = Math.min(west, point.lng);
  }

  return { north, south, east, west };
}

function formatOutcomeLabel(outcome: CanvassOutcome): string {
  switch (outcome) {
    case 'no_answer':
      return 'No Answer';
    case 'interested':
      return 'Interested';
    case 'follow_up':
      return 'Follow Up';
    case 'inspection_booked':
      return 'Inspection Booked';
    default:
      return 'Not Set';
  }
}

function downloadRouteSummary(params: {
  propertyLabel: string | null;
  stops: CanvassRouteStop[];
  generatedAt: string;
}): void {
  const completed = params.stops.filter((stop) => stop.status === 'completed').length;
  const booked = params.stops.filter((stop) => stop.outcome === 'inspection_booked').length;
  const interested = params.stops.filter((stop) => stop.outcome === 'interested').length;
  const followUps = params.stops.filter((stop) => stop.outcome === 'follow_up').length;
  const lines = [
    'Hail Yes! Route Summary',
    `Property: ${params.propertyLabel || 'Current search area'}`,
    `Generated: ${new Date(params.generatedAt).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })} ET`,
    `Stops: ${params.stops.length}`,
    `Completed: ${completed}`,
    `Inspections Booked: ${booked}`,
    `Interested: ${interested}`,
    `Follow Ups: ${followUps}`,
    '',
    ...params.stops.map((stop, index) =>
      [
        `${index + 1}. ${stop.stormLabel} - ${stop.locationLabel}`,
        `   Hail: ${stop.topHailInches > 0 ? `${stop.topHailInches}"` : 'swath only'} | Reports: ${stop.reportCount} | Proof: ${stop.evidenceCount}`,
        `   Status: ${stop.status} | Outcome: ${formatOutcomeLabel(stop.outcome)} | Source: ${stop.sourceLabel}`,
        `   Notes: ${stop.notes || 'None'}`,
      ].join('\n'),
    ),
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const safeProperty = (params.propertyLabel || 'route')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  anchor.href = url;
  anchor.download = `hail-yes-route-summary-${safeProperty || 'route'}-${Date.now()}.txt`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadRouteCsv(params: {
  propertyLabel: string | null;
  stops: CanvassRouteStop[];
}): void {
  const rows = [
    [
      'property',
      'storm_date',
      'storm_label',
      'location',
      'source',
      'hail_inches',
      'report_count',
      'evidence_count',
      'priority',
      'status',
      'outcome',
      'notes',
      'visited_at',
      'completed_at',
      'lat',
      'lng',
    ],
    ...params.stops.map((stop) => [
      params.propertyLabel || '',
      stop.stormDate,
      stop.stormLabel,
      stop.locationLabel,
      stop.sourceLabel,
      String(stop.topHailInches),
      String(stop.reportCount),
      String(stop.evidenceCount),
      stop.priority,
      stop.status,
      stop.outcome,
      stop.notes.replaceAll('"', '""'),
      stop.visitedAt || '',
      stop.completedAt || '',
      String(stop.lat),
      String(stop.lng),
    ]),
  ];

  const csv = rows
    .map((row) => row.map((value) => `"${value}"`).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const safeProperty = (params.propertyLabel || 'route')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  anchor.href = url;
  anchor.download = `hail-yes-route-summary-${safeProperty || 'route'}-${Date.now()}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function App() {
  const notificationsSupported = isNotificationSupported();
  const [activeView, setActiveView] = useState<AppView>('dashboard');
  const [mapLoadError, setMapLoadError] = useState<string | null>(null);

  // ---- Location state ----
  const [camera, setCamera] = useState<MapCameraState>({
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    bounds: null,
  });
  const [queryLocation, setQueryLocation] = useState<LatLng>(DEFAULT_CENTER);
  const [selectedDate, setSelectedDate] = useState<StormDate | null>(null);
  const [fitBoundsRequest, setFitBoundsRequest] =
    useState<FitBoundsRequest | null>(null);
  const [historyRange, setHistoryRange] =
    useState<HistoryRangePreset>(DEFAULT_HISTORY_RANGE);
  const [sinceDate, setSinceDate] = useState<string>('');
  const [searchSummary, setSearchSummary] =
    useState<PropertySearchSummary | null>(DEFAULT_SEARCH_SUMMARY);
  const [eventFilters, setEventFilters] = useState<EventFilterState>({
    hail: true,
    wind: false,
  });
  const [generatingReport, setGeneratingReport] = useState(false);
  const [downloadingEvidencePack, setDownloadingEvidencePack] = useState(false);
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermission>(getNotificationPermission);
  const [pinnedProperties, setPinnedProperties] = useState<PinnedProperty[]>([]);
  const [evidenceItems, setEvidenceItems] = useState<EvidenceItem[]>([]);
  const [routeStopsState, setRouteStopsState] = useState<CanvassRouteStop[]>([]);
  const [activeRouteStopId, setActiveRouteStopId] = useState<string | null>(null);
  const [showRoutePanel, setShowRoutePanel] = useState(false);
  const [evidenceProviderStatus, setEvidenceProviderStatus] = useState<{
    youtube: 'live' | 'fallback';
    flickr: 'live' | 'fallback';
  }>({
    youtube: 'fallback',
    flickr: 'fallback',
  });
  const notifiedAlertsRef = useRef<Map<string, number>>(new Map());

  // ---- GPS ----
  const {
    position: gpsPosition,
    isTracking,
    startTracking,
    stopTracking,
  } = useGeolocation();

  const activeLat = queryLocation.lat;
  const activeLng = queryLocation.lng;
  const effectiveSinceDate = historyRange === 'since' && sinceDate ? sinceDate : null;
  const historyMonths =
    historyRange === '10y'
      ? 120
      : historyRange === '2y'
        ? 24
      : historyRange === '5y'
        ? 60
        : 12;
  const activeRadiusMiles = searchSummary?.radiusMiles ?? 35;

  // ---- Storm data ----
  const { events, swaths, stormDates, loading, error } = useStormData({
    lat: activeLat,
    lng: activeLng,
    months: historyMonths,
    radiusMiles: activeRadiusMiles,
    sinceDate: effectiveSinceDate,
  });

  // ---- Hail alert ----
  const { alert: canvassingAlert } = useHailAlert({
    position: gpsPosition,
    events,
  });

  const filteredEvents = useMemo(
    () =>
      events.filter((event) => {
        if (event.eventType === 'Hail') {
          return eventFilters.hail;
        }
        if (event.eventType === 'Thunderstorm Wind') {
          return eventFilters.wind;
        }
        return false;
      }),
    [eventFilters, events],
  );

  const filteredSwaths = useMemo(
    () => (eventFilters.hail ? swaths : []),
    [eventFilters.hail, swaths],
  );

  const filteredStormDates = useMemo(() => {
    const sourceDates = new Map(stormDates.map((stormDate) => [stormDate.date, stormDate]));
    const visibleDateKeys = new Set<string>();

    for (const event of filteredEvents) {
      visibleDateKeys.add(event.beginDate.slice(0, 10));
    }

    if (eventFilters.hail) {
      for (const swath of swaths) {
        visibleDateKeys.add(swath.date);
      }
    }

    return Array.from(visibleDateKeys)
      .map((date) => sourceDates.get(date))
      .filter((stormDate): stormDate is StormDate => Boolean(stormDate))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [eventFilters.hail, filteredEvents, stormDates, swaths]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(PINNED_PROPERTIES_STORAGE_KEY);
      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored) as PinnedProperty[];
      if (Array.isArray(parsed)) {
        setPinnedProperties(parsed);
      }
    } catch (error) {
      console.error('[App] Failed to load pinned properties:', error);
    }
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(CANVASS_ROUTE_STORAGE_KEY);
      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored) as CanvassRouteStop[];
      if (Array.isArray(parsed)) {
        setRouteStopsState(parsed);
      }
    } catch (error) {
      console.error('[App] Failed to load canvass route:', error);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        PINNED_PROPERTIES_STORAGE_KEY,
        JSON.stringify(pinnedProperties),
      );
    } catch (error) {
      console.error('[App] Failed to save pinned properties:', error);
    }
  }, [pinnedProperties]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        CANVASS_ROUTE_STORAGE_KEY,
        JSON.stringify(routeStopsState),
      );
    } catch (error) {
      console.error('[App] Failed to save canvass route:', error);
    }
  }, [routeStopsState]);

  useEffect(() => {
    void listEvidenceItems()
      .then((items) => {
        setEvidenceItems(items.map(normalizeEvidenceItem));
      })
      .catch((error) => {
        console.error('[App] Failed to load evidence items:', error);
      });
  }, []);

  useEffect(() => {
    if (!canvassingAlert?.inHailZone || notificationPermission !== 'granted') {
      return;
    }

    const stormDate = canvassingAlert.stormDate ?? 'hail-zone';
    const hailSize = canvassingAlert.estimatedHailSize ?? 0;
    const notificationTag = `hail-zone-${stormDate}-${hailSize}`;
    const lastNotifiedAt = notifiedAlertsRef.current.get(notificationTag) ?? 0;

    if (Date.now() - lastNotifiedAt < ALERT_NOTIFICATION_COOLDOWN_MS) {
      return;
    }

    notifiedAlertsRef.current.set(notificationTag, Date.now());

    const body = `${
      hailSize > 0 ? `${hailSize}" hail detected` : 'Hail activity detected'
    }${stormDate ? ` from ${stormDate}` : ''}. Open Hail Yes! for nearby reports.`;

    void showHailZoneNotification({
      title: 'Hail Zone Alert',
      body,
      tag: notificationTag,
    });
  }, [canvassingAlert, notificationPermission]);

  // ---- Search handler (Places Autocomplete) ----
  const getSearchMaxZoom = useCallback((resultType: SearchResultType) => {
    switch (resultType) {
      case 'address':
        return 17;
      case 'postal_code':
        return 13;
      case 'locality':
        return 11;
      case 'administrative_area':
        return 9;
      default:
        return 15;
    }
  }, []);

  const getFallbackZoom = useCallback((resultType: SearchResultType) => {
    switch (resultType) {
      case 'address':
        return 16;
      case 'postal_code':
        return 12;
      case 'locality':
        return 10;
      case 'administrative_area':
        return 8;
      default:
        return 14;
    }
  }, []);

  const getSearchRadiusMiles = useCallback((resultType: SearchResultType) => {
    switch (resultType) {
      case 'address':
        return 15;
      case 'postal_code':
        return 20;
      case 'locality':
        return 30;
      case 'administrative_area':
        return 60;
      default:
        return 25;
    }
  }, []);

  const applySearchResult = useCallback(
    (result: SearchResult) => {
      const radiusMiles = getSearchRadiusMiles(result.resultType);

      setSelectedDate(null);
      setQueryLocation({ lat: result.lat, lng: result.lng });
      setCamera((prev) => ({
        ...prev,
        center: { lat: result.lat, lng: result.lng },
        zoom: getFallbackZoom(result.resultType),
      }));
      setSearchSummary({
        locationLabel: result.address,
        resultType: result.resultType,
        radiusMiles,
        historyPreset: historyRange,
        sinceDate: historyRange === 'since' && sinceDate ? sinceDate : null,
      });

      if (result.viewport) {
        setFitBoundsRequest({
          id: Date.now(),
          bounds: result.viewport,
          padding: 48,
          maxZoom: getSearchMaxZoom(result.resultType),
        });
        return;
      }

      setFitBoundsRequest(null);
    },
    [
      getFallbackZoom,
      getSearchMaxZoom,
      getSearchRadiusMiles,
      historyRange,
      sinceDate,
    ],
  );

  const handleSearchResult = useCallback((result: SearchResult) => {
    setActiveView('map');
    applySearchResult(result);
  }, [applySearchResult]);

  // ---- Sidebar search (manual geocoding) ----
  const handleSidebarSearch = useCallback((query: string) => {
    geocodeAddress(query).then((result) => {
      if (result) {
        setActiveView('map');
        applySearchResult(result);
      }
    });
  }, [applySearchResult]);

  // ---- Map click handler ----
  const handleMapClick = useCallback((event: StormEvent | null) => {
    if (!event) {
      return;
    }

    const clickedDate = event.beginDate.slice(0, 10);
    const matchingStormDate =
      filteredStormDates.find((stormDate) => stormDate.date === clickedDate) ?? null;
    setSelectedDate(matchingStormDate);
  }, [filteredStormDates]);

  const handleOpenStormDate = useCallback((stormDate: StormDate) => {
    setActiveView('map');
    setSelectedDate(stormDate);
  }, []);

  const handleEnableNotifications = useCallback(async () => {
    const permission = await requestNotificationPermission();
    setNotificationPermission(permission);
  }, []);

  const handleHistoryRangeChange = useCallback((nextRange: HistoryRangePreset) => {
    setSelectedDate(null);
    setHistoryRange(nextRange);
    setSearchSummary((current) =>
      current
        ? {
            ...current,
            historyPreset: nextRange,
            sinceDate: nextRange === 'since' && sinceDate ? sinceDate : null,
          }
        : current,
    );
  }, [sinceDate]);

  const handleSinceDateChange = useCallback((nextSinceDate: string) => {
    setSelectedDate(null);
    setSinceDate(nextSinceDate);
    setSearchSummary((current) =>
      current
        ? {
            ...current,
            sinceDate: nextSinceDate || null,
          }
        : current,
    );
  }, []);

  const handleCameraChanged = useCallback((nextCamera: MapCameraState) => {
    setCamera(nextCamera);
  }, []);

  const handleFilterChange = useCallback((nextFilters: EventFilterState) => {
    setSelectedDate(null);
    setEventFilters(nextFilters);
  }, []);

  const handleGenerateReport = useCallback(async (dateOfLoss: string) => {
    if (!dateOfLoss) {
      return;
    }

    setGeneratingReport(true);
    try {
      const approvedEvidenceItems = evidenceItems.filter((item) => {
        if (item.status !== 'approved' || !item.includeInReport) {
          return false;
        }

        if (searchSummary && item.propertyLabel !== searchSummary.locationLabel) {
          return false;
        }

        return item.stormDate === null || item.stormDate === dateOfLoss;
      });

      await generateStormReport({
        address:
          searchSummary?.locationLabel ||
          `${queryLocation.lat.toFixed(4)}, ${queryLocation.lng.toFixed(4)}`,
        lat: queryLocation.lat,
        lng: queryLocation.lng,
        radiusMiles: searchSummary?.radiusMiles ?? activeRadiusMiles,
        events,
        dateOfLoss,
        evidenceItems: approvedEvidenceItems,
      });
    } catch (error) {
      console.error('[App] Failed to generate report:', error);
      window.alert(
        error instanceof Error
          ? error.message
          : 'Failed to generate report.',
      );
      throw error;
    } finally {
      setGeneratingReport(false);
    }
  }, [activeRadiusMiles, evidenceItems, events, queryLocation, searchSummary]);

  const handleDownloadEvidencePack = useCallback(async (dateOfLoss: string) => {
    if (!dateOfLoss) {
      return;
    }

    setDownloadingEvidencePack(true);
    try {
      const selectedEvidenceItems = evidenceItems.filter((item) => {
        if (item.status !== 'approved' || !item.includeInReport) {
          return false;
        }

        if (searchSummary && item.propertyLabel !== searchSummary.locationLabel) {
          return false;
        }

        return item.stormDate === null || item.stormDate === dateOfLoss;
      });

      await generateEvidencePack({
        address:
          searchSummary?.locationLabel ||
          `${queryLocation.lat.toFixed(4)}, ${queryLocation.lng.toFixed(4)}`,
        dateOfLoss,
        evidenceItems: selectedEvidenceItems,
      });
    } catch (error) {
      console.error('[App] Failed to download evidence pack:', error);
      window.alert(
        error instanceof Error
          ? error.message
          : 'Failed to download evidence pack.',
      );
      throw error;
    } finally {
      setDownloadingEvidencePack(false);
    }
  }, [evidenceItems, queryLocation, searchSummary]);

  const selectedEvidenceCount = useMemo(() => {
    return evidenceItems.filter((item) => {
      if (item.status !== 'approved' || !item.includeInReport) {
        return false;
      }

      if (searchSummary && item.propertyLabel !== searchSummary.locationLabel) {
        return false;
      }

      return true;
    }).length;
  }, [evidenceItems, searchSummary]);

  const propertyEvidenceItems = useMemo(() => {
    return evidenceItems
      .filter((item) => {
        if (searchSummary && item.propertyLabel !== searchSummary.locationLabel) {
          return false;
        }

        return true;
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [evidenceItems, searchSummary]);

  const propertyEvidenceCountsByDate = useMemo(() => {
    const counts = new Map<string, number>();

    for (const item of propertyEvidenceItems) {
      if (!item.stormDate) {
        continue;
      }

      counts.set(item.stormDate, (counts.get(item.stormDate) || 0) + 1);
    }

    return counts;
  }, [propertyEvidenceItems]);

  const selectedEvidenceCountsByDate = useMemo(() => {
    const counts: Record<string, number> = {};

    for (const stormDate of filteredStormDates) {
      counts[stormDate.date] = evidenceItems.filter((item) => {
        if (item.status !== 'approved' || !item.includeInReport) {
          return false;
        }

        if (searchSummary && item.propertyLabel !== searchSummary.locationLabel) {
          return false;
        }

        return item.stormDate === null || item.stormDate === stormDate.date;
      }).length;
    }

    return counts;
  }, [evidenceItems, filteredStormDates, searchSummary]);

  const currentPropertyRouteStops = useMemo(() => {
    if (!searchSummary) {
      return routeStopsState;
    }

    return routeStopsState.filter(
      (stop) => stop.propertyLabel === searchSummary.locationLabel,
    );
  }, [routeStopsState, searchSummary]);

  const stormRouteCandidatesByDate = useMemo(() => {
    const stops = new Map<string, CanvassRouteStop[]>();
    const propertyLabel = searchSummary?.locationLabel || 'Current search area';
    const fallbackLabel = propertyLabel;

    for (const stormDate of filteredStormDates) {
      const dateEvents = filteredEvents.filter(
        (event) => event.beginDate.slice(0, 10) === stormDate.date,
      );
      const existingStops = currentPropertyRouteStops.filter(
        (stop) => stop.stormDate === stormDate.date,
      );
      const candidates = buildStormRouteCandidates({
        propertyLabel,
        stormDate,
        events: dateEvents,
        evidenceCount: propertyEvidenceCountsByDate.get(stormDate.date) || 0,
        fallbackLabel,
        fallbackCenter: queryLocation,
        existingStops,
      });

      stops.set(stormDate.date, candidates);
    }

    return stops;
  }, [
    currentPropertyRouteStops,
    filteredEvents,
    filteredStormDates,
    propertyEvidenceCountsByDate,
    queryLocation,
    searchSummary,
  ]);

  const routeStops = useMemo(() => {
    return currentPropertyRouteStops
      .filter((stop) =>
        filteredStormDates.some((stormDate) => stormDate.date === stop.stormDate),
      )
      .map((stop) => {
        const refreshed =
          stormRouteCandidatesByDate
            .get(stop.stormDate)
            ?.find((candidate) => candidate.id === stop.id || candidate.sourceEventId === stop.sourceEventId) ??
          stop;

        return {
          ...refreshed,
          notes: stop.notes,
          status: stop.status,
          createdAt: stop.createdAt,
          updatedAt: stop.updatedAt,
          visitedAt: stop.visitedAt ?? null,
          completedAt: stop.completedAt ?? null,
        };
      });
  }, [currentPropertyRouteStops, filteredStormDates, stormRouteCandidatesByDate]);

  const routeOrigin = useMemo(
    () =>
      gpsPosition
        ? { lat: gpsPosition.lat, lng: gpsPosition.lng }
        : queryLocation,
    [gpsPosition, queryLocation],
  );

  const orderedRouteStops = useMemo(() => {
    if (routeStops.length <= 1) {
      return routeStops;
    }

    const pendingStops = routeStops.filter((stop) => stop.status !== 'completed');
    const completedStops = routeStops.filter((stop) => stop.status === 'completed');
    const orderedPending =
      pendingStops.length <= 1 ? pendingStops : orderStopsByNearest(pendingStops, routeOrigin);

    return [...orderedPending, ...completedStops];
  }, [routeOrigin, routeStops]);

  const activeRouteStop = useMemo(() => {
    if (orderedRouteStops.length === 0) {
      return null;
    }

    return (
      orderedRouteStops.find(
        (stop) => stop.id === activeRouteStopId && stop.status !== 'completed',
      ) ||
      orderedRouteStops.find((stop) => stop.status !== 'completed') ||
      orderedRouteStops[0]
    );
  }, [activeRouteStopId, orderedRouteStops]);

  const knockNowRouteCandidates = useMemo(() => {
    return filteredStormDates
      .flatMap((stormDate) => stormRouteCandidatesByDate.get(stormDate.date) || [])
      .filter((stop) => stop.priority === 'Knock now')
      .sort(
        (left, right) =>
          right.topHailInches - left.topHailInches ||
          right.reportCount - left.reportCount ||
          right.stormDate.localeCompare(left.stormDate),
      )
      .slice(0, MAX_ROUTE_STOPS);
  }, [filteredStormDates, stormRouteCandidatesByDate]);

  const routeQueuedCountsByDate = useMemo(() => {
    const counts = new Map<string, number>();
    for (const stop of routeStops) {
      if (stop.status === 'completed') {
        continue;
      }

      counts.set(stop.stormDate, (counts.get(stop.stormDate) || 0) + 1);
    }
    return counts;
  }, [routeStops]);

  useEffect(() => {
    if (routeStops.length === 0) {
      setActiveRouteStopId(null);
      return;
    }

    if (
      !activeRouteStopId ||
      !routeStops.some((stop) => stop.id === activeRouteStopId && stop.status !== 'completed')
    ) {
      setActiveRouteStopId(
        routeStops.find((stop) => stop.status !== 'completed')?.id ?? routeStops[0].id,
      );
    }
  }, [activeRouteStopId, routeStops]);

  const makePinnedPropertyId = useCallback((label: string, lat: number, lng: number) => {
    return `${label.toLowerCase()}-${lat.toFixed(4)}-${lng.toFixed(4)}`
      .replace(/[^a-z0-9.-]+/g, '-')
      .replace(/-+/g, '-');
  }, []);

  const currentPinnedId = useMemo(() => {
    if (!searchSummary) {
      return null;
    }

    return makePinnedPropertyId(
      searchSummary.locationLabel,
      queryLocation.lat,
      queryLocation.lng,
    );
  }, [makePinnedPropertyId, queryLocation.lat, queryLocation.lng, searchSummary]);

  const isCurrentPropertyPinned = useMemo(
    () =>
      currentPinnedId
        ? pinnedProperties.some((property) => property.id === currentPinnedId)
        : false,
    [currentPinnedId, pinnedProperties],
  );

  const handlePinProperty = useCallback(() => {
    if (!searchSummary) {
      return;
    }

    const now = new Date().toISOString();
    const nextProperty: PinnedProperty = {
      id: makePinnedPropertyId(
        searchSummary.locationLabel,
        queryLocation.lat,
        queryLocation.lng,
      ),
      locationLabel: searchSummary.locationLabel,
      lat: queryLocation.lat,
      lng: queryLocation.lng,
      resultType: searchSummary.resultType,
      radiusMiles: searchSummary.radiusMiles,
      historyPreset: historyRange,
      sinceDate: historyRange === 'since' && sinceDate ? sinceDate : null,
      stormDateCount: filteredStormDates.length,
      latestStormDate: filteredStormDates[0]?.date ?? null,
      latestMaxHailInches: filteredStormDates[0]?.maxHailInches ?? 0,
      createdAt: now,
      updatedAt: now,
    };

    setPinnedProperties((current) => {
      const existingIndex = current.findIndex(
        (property) => property.id === nextProperty.id,
      );

      if (existingIndex === -1) {
        return [nextProperty, ...current];
      }

      const existing = current[existingIndex];
      const updated = {
        ...existing,
        ...nextProperty,
        createdAt: existing.createdAt,
      };
      const next = [...current];
      next.splice(existingIndex, 1);
      return [updated, ...next];
    });
  }, [
    filteredStormDates,
    historyRange,
    makePinnedPropertyId,
    queryLocation.lat,
    queryLocation.lng,
    searchSummary,
    sinceDate,
  ]);

  const handleRemovePinnedProperty = useCallback((propertyId: string) => {
    setPinnedProperties((current) =>
      current.filter((property) => property.id !== propertyId),
    );
  }, []);

  const handleOpenPinnedProperty = useCallback((property: PinnedProperty) => {
    setActiveView('map');
    setSelectedDate(null);
    setHistoryRange(property.historyPreset);
    setSinceDate(property.sinceDate ?? '');
    setQueryLocation({ lat: property.lat, lng: property.lng });
    setSearchSummary({
      locationLabel: property.locationLabel,
      resultType: property.resultType,
      radiusMiles: property.radiusMiles,
      historyPreset: property.historyPreset,
      sinceDate: property.sinceDate,
    });
    setFitBoundsRequest(null);
    setCamera((prev) => ({
      ...prev,
      center: { lat: property.lat, lng: property.lng },
      zoom: getFallbackZoom(property.resultType),
    }));
  }, [getFallbackZoom]);

  const focusRouteStop = useCallback((stop: CanvassRouteStop) => {
    const matchingStormDate =
      filteredStormDates.find((stormDate) => stormDate.date === stop.stormDate) ?? null;

    setActiveView('map');
    setSelectedDate(matchingStormDate);
    setFitBoundsRequest(null);
    setCamera((current) => ({
      ...current,
      center: { lat: stop.lat, lng: stop.lng },
      zoom: Math.max(current.zoom, 13),
    }));
    setActiveRouteStopId(stop.id);
    setShowRoutePanel(true);
  }, [filteredStormDates]);

  const handleToggleStormRoute = useCallback((stormDate: StormDate) => {
    const candidateStops = stormRouteCandidatesByDate.get(stormDate.date) || [];
    const primaryStop = candidateStops[0];
    if (!primaryStop) {
      window.alert('No mappable storm hit is available for this date yet.');
      return;
    }

    setRouteStopsState((current) => {
      const hasQueuedStops = current.some(
        (stop) =>
          stop.propertyLabel === primaryStop.propertyLabel &&
          stop.stormDate === stormDate.date,
      );

      if (hasQueuedStops) {
        return current.filter(
          (stop) =>
            !(
              stop.propertyLabel === primaryStop.propertyLabel &&
              stop.stormDate === stormDate.date
            ),
        );
      }

      const next = [
        ...current.filter((stop) => stop.propertyLabel !== primaryStop.propertyLabel),
        ...current.filter((stop) => stop.propertyLabel === primaryStop.propertyLabel),
        primaryStop,
      ];

      const foreignStops = next.filter(
        (stop) => stop.propertyLabel !== primaryStop.propertyLabel,
      );
      const currentPropertyStops = next
        .filter((stop) => stop.propertyLabel === primaryStop.propertyLabel)
        .slice(0, MAX_ROUTE_STOPS);

      return [...foreignStops, ...currentPropertyStops];
    });
    setActiveRouteStopId(primaryStop.id);
    setShowRoutePanel(true);
    focusRouteStop(primaryStop);
  }, [focusRouteStop, stormRouteCandidatesByDate]);

  const handleBuildKnockRoute = useCallback(() => {
    if (knockNowRouteCandidates.length === 0) {
      window.alert('No Knock Now storm dates are available for this search yet.');
      return;
    }

    const ordered = orderStopsByNearest(knockNowRouteCandidates, routeOrigin)
      .slice(0, MAX_ROUTE_STOPS);
    setRouteStopsState((current) => [
      ...current.filter(
        (stop) => stop.propertyLabel !== (searchSummary?.locationLabel || 'Current search area'),
      ),
      ...ordered,
    ]);
    setActiveRouteStopId(ordered[0]?.id ?? null);
    setShowRoutePanel(true);

    const routeBounds = buildBoundsFromRoute(ordered, gpsPosition ? routeOrigin : null);
    if (routeBounds) {
      setFitBoundsRequest({
        id: Date.now(),
        bounds: routeBounds,
        padding: 64,
        maxZoom: 12,
      });
    }

    if (ordered[0]) {
      setSelectedDate(
        filteredStormDates.find((stormDate) => stormDate.date === ordered[0].stormDate) ?? null,
      );
    }
  }, [filteredStormDates, gpsPosition, knockNowRouteCandidates, routeOrigin, searchSummary]);

  const handleRemoveStopFromRoute = useCallback((stopId: string) => {
    setRouteStopsState((current) => current.filter((stop) => stop.id !== stopId));
    setActiveRouteStopId((current) => (current === stopId ? null : current));
  }, []);

  const handleClearRoute = useCallback(() => {
    setRouteStopsState((current) =>
      current.filter(
        (stop) => stop.propertyLabel !== (searchSummary?.locationLabel || 'Current search area'),
      ),
    );
    setActiveRouteStopId(null);
    setShowRoutePanel(false);
  }, [searchSummary]);

  const handleUpdateRouteStopStatus = useCallback(
    (stopId: string, status: CanvassStopStatus) => {
      const now = new Date().toISOString();
      setRouteStopsState((current) =>
        current.map((stop) =>
          stop.id === stopId
            ? {
                ...stop,
                status,
                updatedAt: now,
                visitedAt:
                  status === 'visited' || status === 'completed'
                    ? stop.visitedAt || now
                    : null,
                completedAt: status === 'completed' ? now : null,
              }
            : stop,
        ),
      );
    },
    [],
  );

  const handleUpdateRouteStopOutcome = useCallback(
    (stopId: string, outcome: CanvassOutcome) => {
      setRouteStopsState((current) =>
        current.map((stop) =>
          stop.id === stopId
            ? {
                ...stop,
                outcome,
                updatedAt: new Date().toISOString(),
              }
            : stop,
        ),
      );
    },
    [],
  );

  const handleUpdateRouteStopNotes = useCallback((stopId: string, notes: string) => {
    setRouteStopsState((current) =>
      current.map((stop) =>
        stop.id === stopId
          ? {
              ...stop,
              notes,
              updatedAt: new Date().toISOString(),
            }
          : stop,
      ),
    );
  }, []);

  const handleAdvanceRoute = useCallback(() => {
    if (!activeRouteStop) {
      return;
    }

    handleUpdateRouteStopStatus(activeRouteStop.id, 'completed');
    const remainingStops = orderedRouteStops.filter(
      (stop) => stop.id !== activeRouteStop.id && stop.status !== 'completed',
    );
    setActiveRouteStopId(remainingStops[0]?.id ?? null);

    if (remainingStops[0]) {
      focusRouteStop(remainingStops[0]);
      return;
    }

    setShowRoutePanel(false);
  }, [activeRouteStop, focusRouteStop, handleUpdateRouteStopStatus, orderedRouteStops]);

  const handleOpenRouteNavigation = useCallback(() => {
    const pendingStops = orderedRouteStops.filter((stop) => stop.status !== 'completed');
    const routeUrl = buildDirectionsUrl(pendingStops, gpsPosition ? routeOrigin : null);
    if (!routeUrl) {
      return;
    }

    window.open(routeUrl, '_blank', 'noopener,noreferrer');
  }, [gpsPosition, orderedRouteStops, routeOrigin]);

  const handleExportRouteSummary = useCallback(() => {
    downloadRouteSummary({
      propertyLabel: searchSummary?.locationLabel ?? null,
      stops: orderedRouteStops,
      generatedAt: new Date().toISOString(),
    });
  }, [orderedRouteStops, searchSummary]);

  const handleExportRouteCsv = useCallback(() => {
    downloadRouteCsv({
      propertyLabel: searchSummary?.locationLabel ?? null,
      stops: orderedRouteStops,
    });
  }, [orderedRouteStops, searchSummary]);

  const handleUploadEvidenceFiles = useCallback(async (
    files: FileList,
    stormDate: string | null,
  ) => {
    if (!searchSummary) {
      throw new Error('Search a property before uploading evidence.');
    }

    const savedItems = await Promise.all(
      Array.from(files).map(async (file) => {
        const now = new Date().toISOString();
        const mediaType = file.type.startsWith('video/')
          ? 'video'
          : 'image';
        const item: EvidenceItem = {
          id: `upload-${crypto.randomUUID()}`,
          kind: 'upload',
          provider: 'upload',
          mediaType,
          propertyLabel: searchSummary.locationLabel,
          stormDate,
          title: file.name,
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          blob: file,
          createdAt: now,
          updatedAt: now,
          status: 'pending',
          includeInReport: false,
        };

        await saveEvidenceItem(item);
        return normalizeEvidenceItem(item);
      }),
    );

    setEvidenceItems((current) =>
      [...savedItems, ...current].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    );
  }, [searchSummary]);

  const handleFetchEvidenceCandidates = useCallback(async () => {
    if (!searchSummary) {
      throw new Error('Search a property before fetching evidence candidates.');
    }

    let result: {
      items: EvidenceItem[];
      providerStatus: {
        youtube: 'live' | 'fallback';
        flickr: 'live' | 'fallback';
      };
    };

    try {
      result = await fetchEvidenceCandidates(
        searchSummary,
        queryLocation.lat,
        queryLocation.lng,
        filteredStormDates,
      );
    } catch (error) {
      console.error('[App] Evidence API unavailable, using fallback packs:', error);
      result = {
        items: buildEvidenceQuerySeeds(searchSummary, filteredStormDates),
        providerStatus: {
          youtube: 'fallback',
          flickr: 'fallback',
        },
      };
    }

    setEvidenceProviderStatus(result.providerStatus);

    await Promise.all(
      result.items.map(async (item) => {
        const normalizedItem = normalizeEvidenceItem(item);
        const existing = evidenceItems.find((current) => current.id === item.id);
        const nextItem = existing
          ? {
              ...existing,
              ...normalizedItem,
              createdAt: existing.createdAt,
            }
          : normalizedItem;
        await saveEvidenceItem(nextItem);
      }),
    );

    setEvidenceItems((current) => {
      const nextMap = new Map(current.map((item) => [item.id, item]));
      for (const item of result.items) {
        const normalizedItem = normalizeEvidenceItem(item);
        const existing = nextMap.get(item.id);
        nextMap.set(
          item.id,
          existing
            ? { ...existing, ...normalizedItem, createdAt: existing.createdAt }
            : normalizedItem,
        );
      }
      return Array.from(nextMap.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }, [evidenceItems, filteredStormDates, queryLocation.lat, queryLocation.lng, searchSummary]);

  const handleSeedDemoEvidence = useCallback(async () => {
    if (!searchSummary) {
      throw new Error('Search a property before seeding demo evidence.');
    }

    const seededItems = buildDemoEvidencePack(searchSummary, filteredStormDates);

    await Promise.all(
      seededItems.map(async (item) => {
        const existing = evidenceItems.find((current) => current.id === item.id);
        const nextItem = existing
          ? {
              ...existing,
              ...item,
              createdAt: existing.createdAt,
            }
          : item;
        await saveEvidenceItem(nextItem);
      }),
    );

    setEvidenceItems((current) => {
      const nextMap = new Map(current.map((item) => [item.id, item]));
      for (const item of seededItems) {
        const existing = nextMap.get(item.id);
        nextMap.set(
          item.id,
          existing ? { ...existing, ...item, createdAt: existing.createdAt } : item,
        );
      }
      return Array.from(nextMap.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }, [evidenceItems, filteredStormDates, searchSummary]);

  const handleSeedRegionalEvidence = useCallback(async () => {
    if (!searchSummary) {
      throw new Error('Search a property before seeding regional evidence.');
    }

    const seededItems = buildRegionalEvidenceSeeds(
      searchSummary,
      filteredStormDates,
      queryLocation,
    );

    if (seededItems.length === 0) {
      throw new Error(
        'No pre-seeded regional evidence exists for this search area yet. Try DMV, PA, or Richmond-area properties.',
      );
    }

    await Promise.all(
      seededItems.map(async (item) => {
        const existing = evidenceItems.find((current) => current.id === item.id);
        const nextItem = existing
          ? {
              ...existing,
              ...item,
              createdAt: existing.createdAt,
            }
          : item;
        await saveEvidenceItem(nextItem);
      }),
    );

    setEvidenceItems((current) => {
      const nextMap = new Map(current.map((item) => [item.id, item]));
      for (const item of seededItems) {
        const existing = nextMap.get(item.id);
        nextMap.set(
          item.id,
          existing ? { ...existing, ...item, createdAt: existing.createdAt } : item,
        );
      }
      return Array.from(nextMap.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }, [evidenceItems, filteredStormDates, queryLocation, searchSummary]);

  const handleRemoveEvidenceItem = useCallback(async (itemId: string) => {
    await removeEvidenceItem(itemId);
    setEvidenceItems((current) => current.filter((item) => item.id !== itemId));
  }, []);

  const handleToggleEvidenceStatus = useCallback(async (itemId: string) => {
    const currentItem = evidenceItems.find((item) => item.id === itemId);
    if (!currentItem) {
      return;
    }

    const nextStatus = currentItem.status === 'approved' ? 'pending' : 'approved';

    const nextItem: EvidenceItem = {
      ...currentItem,
      status: nextStatus,
      includeInReport: nextStatus === 'approved',
      updatedAt: new Date().toISOString(),
    };

    await saveEvidenceItem(nextItem);
    setEvidenceItems((current) =>
      current
        .map((item) => (item.id === itemId ? nextItem : item))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    );
  }, [evidenceItems]);

  const handleToggleEvidenceInReport = useCallback(async (itemId: string) => {
    const currentItem = evidenceItems.find((item) => item.id === itemId);
    if (!currentItem || currentItem.status !== 'approved') {
      return;
    }

    const nextItem: EvidenceItem = {
      ...currentItem,
      includeInReport: !currentItem.includeInReport,
      updatedAt: new Date().toISOString(),
    };

    await saveEvidenceItem(nextItem);
    setEvidenceItems((current) =>
      current
        .map((item) => (item.id === itemId ? nextItem : item))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    );
  }, [evidenceItems]);

  const mapArea = (
    <main className="relative flex min-h-[55vh] flex-1 flex-col min-w-0 lg:min-h-0">
      {/* Search bar (uses Places Autocomplete when inside APIProvider) */}
      <SearchBar onResult={handleSearchResult} />

      {/* Map */}
      <StormMap
        center={camera.center}
        zoom={camera.zoom}
        bounds={camera.bounds}
        events={filteredEvents}
        swaths={filteredSwaths}
        gpsPosition={gpsPosition}
        selectedDate={selectedDate?.date ?? null}
        fitBoundsRequest={fitBoundsRequest}
        onCameraChanged={handleCameraChanged}
        onMapClick={handleMapClick}
      />

      <RouteQueuePanel
        visible={showRoutePanel || orderedRouteStops.length > 0}
        stops={orderedRouteStops}
        activeStopId={activeRouteStop?.id ?? null}
        gpsPosition={gpsPosition}
        knockNowCount={knockNowRouteCandidates.length}
        onToggleOpen={() => setShowRoutePanel((current) => !current)}
        onBuildKnockRoute={handleBuildKnockRoute}
        onFocusStop={focusRouteStop}
        onRemoveStop={handleRemoveStopFromRoute}
        onUpdateStopStatus={handleUpdateRouteStopStatus}
        onUpdateStopOutcome={handleUpdateRouteStopOutcome}
        onUpdateStopNotes={handleUpdateRouteStopNotes}
        onAdvanceRoute={handleAdvanceRoute}
        onOpenNavigation={handleOpenRouteNavigation}
        onExportSummary={handleExportRouteSummary}
        onClearRoute={handleClearRoute}
      />

      {/* Legend overlay */}
      <Legend />

      {/* GPS tracking toggle + center on me */}
      <div className="absolute bottom-6 left-4 z-10 flex gap-2">
        <button
          onClick={isTracking ? stopTracking : startTracking}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg shadow-lg text-xs font-semibold transition-colors ${
            isTracking
              ? 'bg-violet-600 text-white'
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
            <span className="h-2 w-2 animate-pulse rounded-full bg-orange-300" />
          )}
        </button>
        {isTracking && gpsPosition && (
          <button
            onClick={() => {
              setSelectedDate(null);
              setFitBoundsRequest(null);
              setSearchSummary(null);
              setQueryLocation({ lat: gpsPosition.lat, lng: gpsPosition.lng });
              setCamera((prev) => ({
                ...prev,
                center: { lat: gpsPosition.lat, lng: gpsPosition.lng },
                zoom: 14,
              }));
            }}
            className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-violet-600 shadow-lg transition-colors hover:bg-violet-50"
            title="Center map on your location"
            aria-label="Center map on your location"
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
                d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0013 3.06V1h-2v2.06A8.994 8.994 0 003.06 11H1v2h2.06A8.994 8.994 0 0011 20.94V23h2v-2.06A8.994 8.994 0 0020.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"
              />
            </svg>
            Center
          </button>
        )}
        {notificationsSupported && (
          <button
            onClick={handleEnableNotifications}
            disabled={notificationPermission !== 'default'}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg shadow-lg text-xs font-semibold transition-colors ${
              notificationPermission === 'granted'
                ? 'bg-violet-600 text-white'
                : notificationPermission === 'denied'
                  ? 'bg-gray-800 text-gray-300 cursor-not-allowed'
                  : 'bg-amber-500 text-gray-950 hover:bg-amber-400'
            }`}
            title={
              notificationPermission === 'granted'
                ? 'Hail alerts are enabled'
                : notificationPermission === 'denied'
                  ? 'Notifications are blocked in browser settings'
                  : 'Enable hail zone notifications'
            }
            aria-label="Enable hail alerts"
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
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V4a2 2 0 10-4 0v1.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0a3 3 0 11-6 0m6 0H9"
              />
            </svg>
            {notificationPermission === 'granted'
              ? 'Alerts On'
              : notificationPermission === 'denied'
                ? 'Alerts Blocked'
                : 'Enable Alerts'}
          </button>
        )}
      </div>

      {/* Canvassing alert toast */}
      {canvassingAlert?.inHailZone && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-30 max-w-sm w-full mx-4 animate-slide-up">
          <div className="rounded-xl border border-orange-400/40 bg-[linear-gradient(135deg,rgba(249,115,22,0.94),rgba(124,58,237,0.9))] p-4 text-white shadow-2xl">
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
                <p className="mt-0.5 text-xs text-orange-50">
                  {canvassingAlert.estimatedHailSize}" hail detected
                  {canvassingAlert.stormDate
                    ? ` on ${canvassingAlert.stormDate}`
                    : ''}
                </p>
                {canvassingAlert.talkingPoints.length > 1 && (
                  <p className="mt-1 text-xs italic text-orange-100/90">
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

  const mapWorkspace = mapLoadError ? (
    <MapUnavailablePanel
      title="Google Maps could not load"
      body={mapLoadError}
      host={window.location.host}
      onOpenDashboard={() => setActiveView('dashboard')}
    />
  ) : HAS_API_KEY ? (
    <APIProvider
      apiKey={API_KEY}
      authReferrerPolicy="origin"
      onLoad={() => setMapLoadError(null)}
      onError={(error) => {
        console.error('[App] Google Maps failed to load:', error);

        const message =
          window.location.hostname === 'hailyes.up.railway.app'
            ? 'The Google Maps key is likely not authorized for hailyes.up.railway.app yet. Add this domain to the key HTTP referrer allowlist in Google Cloud, then hard refresh.'
            : 'The Google Maps key could not authenticate for this domain. Confirm the key and HTTP referrer allowlist in Google Cloud, then hard refresh.';

        setMapLoadError(message);
      }}
    >
      {mapArea}
    </APIProvider>
  ) : (
    <MapUnavailablePanel
      title="Google Maps API key missing"
      body="This build does not have a valid Google Maps API key configured, so the map workspace cannot render."
      host={window.location.host}
      onOpenDashboard={() => setActiveView('dashboard')}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-black text-white">
      <AppHeader
        activeView={activeView}
        onChangeView={setActiveView}
        pinnedCount={pinnedProperties.length}
        activeSearchLabel={searchSummary?.locationLabel ?? null}
      />

      <div className="flex min-h-0 flex-1 flex-col">
        {activeView === 'dashboard' && (
          <DashboardPage
            searchSummary={searchSummary}
            stormDates={filteredStormDates}
            events={filteredEvents}
            evidenceItems={propertyEvidenceItems}
            routeStops={routeStops}
            pinnedProperties={pinnedProperties}
            onOpenMap={() => setActiveView('map')}
            onOpenStormDate={handleOpenStormDate}
            onOpenPinned={() => setActiveView('pinned')}
            onOpenPinnedProperty={handleOpenPinnedProperty}
            onOpenEvidence={() => setActiveView('evidence')}
            onOpenReports={() => setActiveView('reports')}
            onOpenCanvass={() => setActiveView('canvass')}
          />
        )}

        {activeView === 'map' && (
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <Sidebar
              stormDates={filteredStormDates}
              events={filteredEvents}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              loading={loading}
              error={error}
              canvassingAlert={canvassingAlert}
              onSearch={handleSidebarSearch}
              activeSearchLabel={searchSummary?.locationLabel ?? null}
              historyRange={historyRange}
              sinceDate={sinceDate}
              onHistoryRangeChange={handleHistoryRangeChange}
              onSinceDateChange={handleSinceDateChange}
              searchSummary={searchSummary}
              eventFilters={eventFilters}
              onFilterChange={handleFilterChange}
              generatingReport={generatingReport}
              onGenerateReport={handleGenerateReport}
              onOpenReports={() => setActiveView('reports')}
              canPinProperty={Boolean(searchSummary)}
              isPinned={isCurrentPropertyPinned}
              onPinProperty={handlePinProperty}
              evidenceItems={propertyEvidenceItems}
              onOpenEvidence={() => setActiveView('evidence')}
              queuedRouteCountsByDate={Object.fromEntries(routeQueuedCountsByDate)}
              onToggleStormRoute={handleToggleStormRoute}
              onBuildKnockRoute={handleBuildKnockRoute}
            />

            {mapWorkspace}
          </div>
        )}

        {activeView === 'canvass' && (
          <CanvassPage
            searchSummary={searchSummary}
            routeStops={orderedRouteStops}
            onOpenMap={() => setActiveView('map')}
            onFocusStop={(stop) => {
              focusRouteStop(stop);
              setActiveView('map');
            }}
            onBuildKnockRoute={handleBuildKnockRoute}
            onOpenNavigation={handleOpenRouteNavigation}
            onExportSummary={handleExportRouteSummary}
            onExportCsv={handleExportRouteCsv}
            onClearRoute={handleClearRoute}
            onUpdateStopStatus={handleUpdateRouteStopStatus}
            onUpdateStopOutcome={handleUpdateRouteStopOutcome}
            onUpdateStopNotes={handleUpdateRouteStopNotes}
            onRemoveStop={handleRemoveStopFromRoute}
          />
        )}

        {activeView === 'pinned' && (
          <PinnedPropertiesPage
            pinnedProperties={pinnedProperties}
            onOpenProperty={handleOpenPinnedProperty}
            onRemoveProperty={handleRemovePinnedProperty}
            onOpenMap={() => setActiveView('map')}
          />
        )}

        {activeView === 'reports' && (
          <ReportsPage
            searchSummary={searchSummary}
            stormDates={filteredStormDates}
            evidenceItems={propertyEvidenceItems}
            selectedEvidenceCount={selectedEvidenceCount}
            selectedEvidenceCountsByDate={selectedEvidenceCountsByDate}
            generatingReport={generatingReport}
            downloadingEvidencePack={downloadingEvidencePack}
            onGenerateReport={handleGenerateReport}
            onDownloadEvidencePack={handleDownloadEvidencePack}
            onOpenMap={() => setActiveView('map')}
            onOpenEvidence={() => setActiveView('evidence')}
          />
        )}

        {activeView === 'evidence' && (
          <EvidencePage
            searchSummary={searchSummary}
            stormDates={filteredStormDates}
            evidenceItems={evidenceItems}
            onUploadFiles={handleUploadEvidenceFiles}
            onFetchProviderCandidates={handleFetchEvidenceCandidates}
            onSeedDemoEvidence={handleSeedDemoEvidence}
            onSeedRegionalEvidence={handleSeedRegionalEvidence}
            onRemoveEvidenceItem={handleRemoveEvidenceItem}
            onToggleEvidenceStatus={handleToggleEvidenceStatus}
            onToggleEvidenceInReport={handleToggleEvidenceInReport}
            onOpenReports={() => setActiveView('reports')}
            onOpenMap={() => setActiveView('map')}
            providerStatus={evidenceProviderStatus}
          />
        )}
      </div>
    </div>
  );
}

function RouteQueuePanel({
  visible,
  stops,
  activeStopId,
  gpsPosition,
  knockNowCount,
  onToggleOpen,
  onBuildKnockRoute,
  onFocusStop,
  onRemoveStop,
  onUpdateStopStatus,
  onUpdateStopOutcome,
  onUpdateStopNotes,
  onAdvanceRoute,
  onOpenNavigation,
  onExportSummary,
  onClearRoute,
}: {
  visible: boolean;
  stops: CanvassRouteStop[];
  activeStopId: string | null;
  gpsPosition: LatLng | null;
  knockNowCount: number;
  onToggleOpen: () => void;
  onBuildKnockRoute: () => void;
  onFocusStop: (stop: CanvassRouteStop) => void;
  onRemoveStop: (stopId: string) => void;
  onUpdateStopStatus: (stopId: string, status: CanvassStopStatus) => void;
  onUpdateStopOutcome: (stopId: string, outcome: CanvassOutcome) => void;
  onUpdateStopNotes: (stopId: string, notes: string) => void;
  onAdvanceRoute: () => void;
  onOpenNavigation: () => void;
  onExportSummary: () => void;
  onClearRoute: () => void;
}) {
  if (!visible && stops.length === 0 && knockNowCount === 0) {
    return null;
  }

  const activeStop =
    stops.find((stop) => stop.id === activeStopId) ||
    stops[0] ||
    null;
  const etaLabel = gpsPosition && activeStop
    ? `${haversineDistanceMiles(gpsPosition, { lat: activeStop.lat, lng: activeStop.lng }).toFixed(1)} mi from you`
    : activeStop
      ? 'Ready for turn-by-turn'
      : 'Build a canvass route from top hail dates';
  const pendingStops = stops.filter((stop) => stop.status !== 'completed');

  return (
    <div className="absolute right-4 top-20 z-20 w-[min(24rem,calc(100%-2rem))]">
      <div className="overflow-hidden rounded-2xl border border-orange-500/20 bg-slate-950/92 shadow-[0_20px_60px_rgba(2,6,23,0.45)] backdrop-blur">
        <button
          type="button"
          onClick={onToggleOpen}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
        >
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-200">
              Route Queue
            </p>
            <p className="mt-1 text-sm font-semibold text-white">
              {stops.length > 0
                ? `${pendingStops.length} active stop${pendingStops.length === 1 ? '' : 's'}`
                : knockNowCount > 0
                  ? `${knockNowCount} knock-now dates ready`
                  : 'No route built yet'}
            </p>
            <p className="mt-1 text-xs text-slate-400">{etaLabel}</p>
          </div>
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-xs font-semibold text-orange-100">
            {stops.length > 0 ? 'Live' : 'Ready'}
          </span>
        </button>

        {visible && (stops.length > 0 || knockNowCount > 0) && (
          <div className="border-t border-slate-800 px-4 py-3">
            {stops.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-300">
                  Build a canvass run from the highest-priority hail dates and open it in Google Maps.
                </p>
                <button
                  type="button"
                  onClick={onBuildKnockRoute}
                  className="w-full rounded-xl bg-[linear-gradient(135deg,#f97316,#7c3aed)] px-3 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(124,58,237,0.22)] transition-opacity hover:opacity-95"
                >
                  Build Knock-Now Route
                </button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={onOpenNavigation}
                    disabled={pendingStops.length === 0}
                    className="rounded-xl bg-[linear-gradient(135deg,#f97316,#7c3aed)] px-3 py-2 text-xs font-semibold text-white shadow-[0_10px_30px_rgba(124,58,237,0.22)] transition-opacity hover:opacity-95"
                  >
                    Open Turn-by-Turn
                  </button>
                  <button
                    type="button"
                    onClick={onAdvanceRoute}
                    disabled={pendingStops.length === 0}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Mark Next Done
                  </button>
                  <button
                    type="button"
                    onClick={onExportSummary}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/10"
                  >
                    Export Summary
                  </button>
                  <button
                    type="button"
                    onClick={onClearRoute}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-300 transition-colors hover:bg-white/10"
                  >
                    Clear
                  </button>
                </div>

                <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                  {stops.map((stop, index) => {
                    const active = stop.id === activeStop?.id;
                    return (
                      <div
                        key={stop.id}
                        className={`rounded-2xl border px-3 py-3 ${
                          active
                            ? 'border-orange-400/40 bg-orange-500/10'
                            : stop.status === 'completed'
                              ? 'border-emerald-500/20 bg-emerald-500/5'
                            : 'border-slate-800 bg-black/20'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-bold text-orange-100">
                                {index + 1}
                              </span>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-white">
                                  {stop.stormLabel}
                                </p>
                                <p className="truncate text-xs text-slate-400">
                                  {stop.locationLabel} · {stop.sourceLabel}
                                </p>
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-300">
                              <span>{stop.reportCount} reports</span>
                              <span>{stop.topHailInches > 0 ? `${stop.topHailInches}" hail` : 'hail swath'}</span>
                              <span>{stop.evidenceCount} proof</span>
                              <span className="text-orange-200">{stop.priority}</span>
                              {stop.status === 'visited' && (
                                <span className="text-sky-200">Visited</span>
                              )}
                          {stop.status === 'completed' && (
                            <span className="text-emerald-200">Done</span>
                          )}
                        </div>
                      </div>
                          <button
                            type="button"
                            onClick={() => onRemoveStop(stop.id)}
                            className="rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-[11px] font-semibold text-slate-300 transition-colors hover:bg-black/30"
                          >
                            Remove
                          </button>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => onFocusStop(stop)}
                            className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-black/30"
                          >
                            Center Stop
                          </button>
                          {stop.status !== 'visited' && stop.status !== 'completed' && (
                            <button
                              type="button"
                              onClick={() => onUpdateStopStatus(stop.id, 'visited')}
                              className="rounded-lg border border-sky-400/30 bg-sky-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-sky-100 transition-colors hover:bg-sky-500/20"
                            >
                              Mark Visited
                            </button>
                          )}
                          {stop.status !== 'completed' && (
                            <button
                              type="button"
                              onClick={() => onUpdateStopStatus(stop.id, 'completed')}
                              className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-100 transition-colors hover:bg-emerald-500/20"
                            >
                              Mark Done
                            </button>
                          )}
                          {stop.status === 'completed' && (
                            <button
                              type="button"
                              onClick={() => onUpdateStopStatus(stop.id, 'queued')}
                              className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-black/30"
                            >
                              Reopen
                            </button>
                          )}
                          {active && (
                            <span className="rounded-lg border border-orange-400/30 bg-orange-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-orange-100">
                              Next Stop
                            </span>
                          )}
                        </div>
                        <div className="mt-3">
                          <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Outcome
                          </label>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {(
                              [
                                ['none', 'Not Set'],
                                ['no_answer', 'No Answer'],
                                ['interested', 'Interested'],
                                ['follow_up', 'Follow Up'],
                                ['inspection_booked', 'Booked'],
                              ] as Array<[CanvassOutcome, string]>
                            ).map(([outcome, label]) => (
                              <button
                                key={`${stop.id}-${outcome}`}
                                type="button"
                                onClick={() => onUpdateStopOutcome(stop.id, outcome)}
                                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                                  stop.outcome === outcome
                                    ? 'border-orange-400/40 bg-orange-500/20 text-orange-100'
                                    : 'border-white/10 bg-black/20 text-slate-300 hover:bg-black/30'
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="mt-3">
                          <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Rep Notes
                          </label>
                          <textarea
                            value={stop.notes}
                            onChange={(event) => onUpdateStopNotes(stop.id, event.target.value)}
                            placeholder="Gate code, roof condition, homeowner callback, dog in yard..."
                            className="mt-1 h-20 w-full resize-none rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-orange-400/50 focus:outline-none"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MapUnavailablePanel({
  title,
  body,
  host,
  onOpenDashboard,
}: {
  title: string;
  body: string;
  host: string;
  onOpenDashboard: () => void;
}) {
  return (
    <main className="relative flex min-h-[55vh] flex-1 min-w-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(249,115,22,0.16),_transparent_24%),radial-gradient(circle_at_75%_0%,_rgba(124,58,237,0.16),_transparent_24%),linear-gradient(180deg,_#140818_0%,_#090412_65%,_#05030a_100%)] lg:min-h-0">
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-2xl rounded-[28px] border border-orange-500/20 bg-slate-950/88 p-6 shadow-[0_24px_80px_rgba(2,6,23,0.45)]">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#f97316,#7c3aed)] text-white shadow-[0_10px_30px_rgba(124,58,237,0.25)]">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M6.5 15a3.5 3.5 0 0 1 .25-7 5.2 5.2 0 0 1 10.05 1.6A3.05 3.05 0 0 1 16.9 15H6.5Z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M8.5 16.6 7.6 19M12 16.6 11.1 19.5M15.5 16.6 14.6 19.2"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-300">
                Map Workspace
              </p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">
                {title}
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-300">{body}</p>
              <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/65 p-4 text-sm text-slate-300">
                <p className="font-semibold text-white">Current host</p>
                <p className="mt-1 font-mono text-xs text-violet-200">{host}</p>
                <p className="mt-3 text-xs text-slate-400">
                  If this is a referrer restriction issue, add this host to the Google
                  Maps JavaScript API key allowlist in Google Cloud Credentials.
                </p>
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="rounded-2xl bg-[linear-gradient(135deg,#f97316,#7c3aed)] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(124,58,237,0.22)] transition-opacity hover:opacity-95"
                >
                  Retry Map
                </button>
                <button
                  type="button"
                  onClick={onOpenDashboard}
                  className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-800"
                >
                  Back to Dashboard
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

export default App;

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

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import type {
  AppView,
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
const DEFAULT_CENTER: LatLng = { lat: 39.0, lng: -77.0 };
const DEFAULT_ZOOM = 8;
const DEFAULT_HISTORY_RANGE: HistoryRangePreset = '1y';
const PINNED_PROPERTIES_STORAGE_KEY = 'storm-maps:pinned-properties';

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

function App() {
  const notificationsSupported = isNotificationSupported();
  const [activeView, setActiveView] = useState<AppView>('map');

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
    useState<PropertySearchSummary | null>(null);
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
      window.localStorage.setItem(
        PINNED_PROPERTIES_STORAGE_KEY,
        JSON.stringify(pinnedProperties),
      );
    } catch (error) {
      console.error('[App] Failed to save pinned properties:', error);
    }
  }, [pinnedProperties]);

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
    }${stormDate ? ` from ${stormDate}` : ''}. Open Storm Maps for nearby reports.`;

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

      {/* Legend overlay */}
      <Legend />

      {/* GPS tracking toggle + center on me */}
      <div className="absolute bottom-6 left-4 z-10 flex gap-2">
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
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg shadow-lg text-xs font-semibold bg-white text-blue-600 hover:bg-blue-50 transition-colors"
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
                ? 'bg-emerald-600 text-white'
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
            pinnedProperties={pinnedProperties}
            onOpenMap={() => setActiveView('map')}
            onOpenPinned={() => setActiveView('pinned')}
            onOpenEvidence={() => setActiveView('evidence')}
            onOpenReports={() => setActiveView('reports')}
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
              canPinProperty={Boolean(searchSummary)}
              isPinned={isCurrentPropertyPinned}
              onPinProperty={handlePinProperty}
            />

            {HAS_API_KEY ? (
              <APIProvider apiKey={API_KEY}>{mapArea}</APIProvider>
            ) : (
              mapArea
            )}
          </div>
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

export default App;

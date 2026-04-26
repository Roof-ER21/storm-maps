/**
 * Sidebar — Property-search-first storm date list with range controls.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CanvassingAlert,
  EvidenceItem,
  EventFilterState,
  HistoryRangePreset,
  PropertySearchSummary,
  StormDate,
  StormEvent,
} from '../types/storm';
import {
  getHailSizeClass,
  getStormCanvassPriority,
  HAIL_SIZE_CLASSES,
} from '../types/storm';
import EvidenceThumbnailStrip from './EvidenceThumbnailStrip';
import AddressImpactBadge from './AddressImpactBadge';
import WindImpactBadge from './WindImpactBadge';
import DatePicker from './DatePicker';
import { toEasternDateKey, formatEasternDateLabel } from '../services/dateUtils';
import {
  enableStormAlerts,
  disableStormAlerts,
  getNotificationPermission,
  isNotificationSupported,
} from '../services/notificationService';

const WIND_FOCUS_STATES = ['VA', 'MD', 'PA', 'WV', 'DC', 'DE'];

interface SidebarProps {
  stormDates: StormDate[];
  events: StormEvent[];
  selectedDate: StormDate | null;
  onSelectDate: (date: StormDate | null) => void;
  loading: boolean;
  error: string | null;
  canvassingAlert: CanvassingAlert | null;
  onSearch: (query: string) => void;
  activeSearchLabel: string | null;
  historyRange: HistoryRangePreset;
  sinceDate: string;
  onHistoryRangeChange: (range: HistoryRangePreset) => void;
  onSinceDateChange: (value: string) => void;
  searchSummary: PropertySearchSummary | null;
  /** Geocoded lat/lng of the searched address — used for per-address storm impact. */
  searchLat?: number | null;
  searchLng?: number | null;
  /** Anchor timestamp for the selected storm (used to pick the right GRIB file). */
  selectedStormAnchorTimestamp?: string | null;
  eventFilters: EventFilterState;
  onFilterChange: (filters: EventFilterState) => void;
  /** When true, the map clips events/swaths to the VA/MD/PA focus territory. */
  territoryOnly?: boolean;
  onTerritoryOnlyChange?: (value: boolean) => void;
  generatingReport: boolean;
  onGenerateReport: (dateOfLoss: string) => Promise<void>;
  onOpenReports: () => void;
  canPinProperty: boolean;
  isPinned: boolean;
  onPinProperty: () => void;
  evidenceItems: EvidenceItem[];
  onOpenEvidence: () => void;
  queuedRouteCountsByDate: Record<string, number>;
  onToggleStormRoute: (stormDate: StormDate) => void;
  onBuildKnockRoute: () => void;
  onAnalyzeProperty?: (address: string) => void;
  onScanAreaWithAi?: () => void;
  scanningArea?: boolean;
  areaScanCount?: number;
}

type TabId = 'recent' | 'impact';
type DateListFilter = 'all' | 'major' | 'proof' | 'knock';

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
  badge,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  badge?: string | number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-stone-200">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-xs font-semibold uppercase tracking-widest text-stone-500 hover:text-stone-900 transition-colors"
      >
        <span className="flex items-center gap-2">
          {title}
          {badge != null && (
            <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-600 normal-case tracking-normal">
              {badge}
            </span>
          )}
        </span>
        <svg
          className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

export default function Sidebar({
  stormDates,
  events,
  selectedDate,
  onSelectDate,
  loading,
  error,
  canvassingAlert,
  onSearch,
  activeSearchLabel,
  historyRange,
  sinceDate,
  onHistoryRangeChange,
  onSinceDateChange,
  searchSummary,
  searchLat = null,
  searchLng = null,
  selectedStormAnchorTimestamp = null,
  eventFilters,
  onFilterChange,
  territoryOnly = true,
  onTerritoryOnlyChange,
  generatingReport,
  onGenerateReport,
  onOpenReports,
  canPinProperty,
  isPinned,
  onPinProperty,
  evidenceItems,
  onOpenEvidence,
  queuedRouteCountsByDate,
  onToggleStormRoute,
  onBuildKnockRoute,
  onAnalyzeProperty,
  onScanAreaWithAi,
  scanningArea = false,
  areaScanCount = 0,
}: SidebarProps) {
  const [activeTab, setActiveTab] = useState<TabId>('recent');
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [showDateOfLossModal, setShowDateOfLossModal] = useState(false);
  const [selectedDateOfLoss, setSelectedDateOfLoss] = useState('');
  const [showSelectedStormDetails, setShowSelectedStormDetails] = useState(false);
  const [dateListFilter, setDateListFilter] = useState<DateListFilter>('all');
  const inputRef = useRef<HTMLInputElement>(null);

  const sortedDates = [...stormDates].sort((a, b) => {
    if (activeTab === 'impact') {
      return b.maxHailInches - a.maxHailInches || b.date.localeCompare(a.date);
    }
    return b.date.localeCompare(a.date);
  });

  const latestStorms = useMemo(
    () => [...stormDates].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 2),
    [stormDates],
  );
  const selectedStormEvidence = useMemo(() => {
    if (!selectedDate) {
      return [];
    }

    return evidenceItems
      .filter((item) => item.stormDate === selectedDate.date)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [evidenceItems, selectedDate]);
  const selectedDateEvents = useMemo(() => {
    if (!selectedDate) {
      return [];
    }

    return events.filter((event) => toEasternDateKey(event.beginDate) === selectedDate.date);
  }, [events, selectedDate]);
  const selectedStormSources = useMemo(() => {
    const ranked = new Map<string, number>();
    for (const event of selectedDateEvents) {
      ranked.set(event.source, (ranked.get(event.source) || 0) + 1);
    }

    return [...ranked.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3)
      .map(([source]) => source);
  }, [selectedDateEvents]);
  // Bounds across all reports for the selected storm date — used by the wind
  // impact badge so we can constrain the wind swath fetch geographically.
  // Falls back to a 1° box around the searched address when no events have
  // been geocoded yet.
  const selectedStormBounds = useMemo(() => {
    if (selectedDateEvents.length === 0) {
      if (searchLat !== null && searchLng !== null) {
        return {
          north: searchLat + 0.5,
          south: searchLat - 0.5,
          east: searchLng + 0.5,
          west: searchLng - 0.5,
        };
      }
      return null;
    }
    let north = -Infinity;
    let south = Infinity;
    let east = -Infinity;
    let west = Infinity;
    for (const e of selectedDateEvents) {
      if (e.beginLat > north) north = e.beginLat;
      if (e.beginLat < south) south = e.beginLat;
      if (e.beginLon > east) east = e.beginLon;
      if (e.beginLon < west) west = e.beginLon;
    }
    // Pad ~25 mi so the wind swath fetch picks up nearby gusts that may not
    // have any hail report inside the immediate hail bounds.
    const pad = 0.4;
    return {
      north: north + pad,
      south: south - pad,
      east: east + pad,
      west: west - pad,
    };
  }, [selectedDateEvents, searchLat, searchLng]);
  const rankedStormHits = useMemo(
    () =>
      [...selectedDateEvents]
        .sort(
          (left, right) =>
            right.magnitude - left.magnitude ||
            left.beginDate.localeCompare(right.beginDate),
        )
        .slice(0, 5),
    [selectedDateEvents],
  );
  const evidenceCountsByDate = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of evidenceItems) {
      if (!item.stormDate) continue;
      counts.set(item.stormDate, (counts.get(item.stormDate) || 0) + 1);
    }
    return counts;
  }, [evidenceItems]);
  const displayedDates = useMemo(() => {
    return sortedDates.filter((stormDate) => {
      const evidenceCount = evidenceCountsByDate.get(stormDate.date) || 0;
      const priority = getStormCanvassPriority(stormDate, evidenceCount);

      if (dateListFilter === 'major') {
        return stormDate.maxHailInches >= 1.5;
      }

      if (dateListFilter === 'proof') {
        return evidenceCount > 0;
      }

      if (dateListFilter === 'knock') {
        return priority === 'Knock now';
      }

      return true;
    });
  }, [dateListFilter, evidenceCountsByDate, sortedDates]);
  const knockQueue = useMemo(
    () =>
      sortedDates.filter((stormDate) => {
        const evidenceCount = evidenceCountsByDate.get(stormDate.date) || 0;
        return getStormCanvassPriority(stormDate, evidenceCount) === 'Knock now';
      }).slice(0, 3),
    [evidenceCountsByDate, sortedDates],
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const query = inputRef.current?.value.trim() || '';
    if (query) {
      onSearch(query);
    }
  };

  const handleDateClick = (sd: StormDate) => {
    if (selectedDate?.date === sd.date) {
      onSelectDate(null);
    } else {
      onSelectDate(sd);
    }
  };

  const toggleExpand = (date: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedDate(expandedDate === date ? null : date);
  };

  const openDateOfLossModal = () => {
    const defaultDate = selectedDate?.date || latestStorms[0]?.date || '';
    setSelectedDateOfLoss(defaultDate);
    setShowDateOfLossModal(true);
  };

  const handleGenerateReportClick = async () => {
    if (!selectedDateOfLoss) {
      return;
    }

    try {
      await onGenerateReport(selectedDateOfLoss);
      setShowDateOfLossModal(false);
    } catch {
      // Parent already handles the user-visible error.
    }
  };

  useEffect(() => {
    queueMicrotask(() => {
      setShowSelectedStormDetails(false);
    });
  }, [selectedDate?.date]);

  return (
    <aside className="order-2 flex w-full flex-1 flex-col overflow-y-auto border-b border-stone-200 bg-white text-stone-900 min-h-0 lg:order-1 lg:w-80 lg:flex-initial lg:shrink-0 lg:border-b-0 lg:border-r">
      <div className="border-b border-stone-200 p-4">
        <div className="flex items-center gap-2">
          <svg
            className="h-5 w-5 flex-shrink-0 text-orange-500"
            fill="none"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <path
              d="M5.5 12.5a3 3 0 0 1 .2-6 4.5 4.5 0 0 1 8.72 1.3 2.6 2.6 0 0 1 .08 5.2H5.5Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M7.2 13.8 6.4 16M10 13.8 9.2 16.6M12.8 13.8 12 16.3"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
          <div className="flex-1">
            <h1 className="text-lg font-bold tracking-tight text-stone-900">Hail Yes!</h1>
            <p className="text-xs text-stone-500">
              Property hail intelligence for roofing reps
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSearch} className="p-3 border-b border-stone-200">
        <div className="relative">
          <input
            key={activeSearchLabel ?? 'search-location'}
            ref={inputRef}
            type="text"
            defaultValue={activeSearchLabel ?? ''}
            placeholder="Address, city, or ZIP..."
            className="w-full rounded-lg border border-stone-300 bg-stone-50 py-2 pl-9 pr-3 text-sm text-stone-900 placeholder-stone-400 focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400"
            aria-label="Search location"
          />
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>

        <div className="mt-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
            History Range
          </p>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
            <RangeButton
              active={historyRange === '1y'}
              label="1Y"
              onClick={() => onHistoryRangeChange('1y')}
            />
            <RangeButton
              active={historyRange === '2y'}
              label="2Y"
              onClick={() => onHistoryRangeChange('2y')}
            />
            <RangeButton
              active={historyRange === '5y'}
              label="5Y"
              onClick={() => onHistoryRangeChange('5y')}
            />
            <RangeButton
              active={historyRange === '10y'}
              label="10Y"
              onClick={() => onHistoryRangeChange('10y')}
            />
            <RangeButton
              active={historyRange === 'since'}
              label="Since"
              onClick={() => onHistoryRangeChange('since')}
            />
          </div>
          {historyRange === 'since' && (
            <input
              type="date"
              value={sinceDate}
              onChange={(e) => onSinceDateChange(e.target.value)}
              className="mt-2 w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-900 focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400"
              aria-label="Show storms since date"
            />
          )}
        </div>
      </form>

      {searchSummary && (
        <div className="border-b border-stone-200 px-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                Property History
              </p>
              <p className="mt-1 text-sm font-semibold text-stone-900">
                {searchSummary.locationLabel}
              </p>
              <p className="mt-1 text-xs text-stone-500">
                {loading
                  ? `Searching within ${searchSummary.radiusMiles} miles...`
                  : stormDates.length > 0
                    ? `${stormDates.length} ${getFilterSummaryLabel(eventFilters, stormDates.length)} within ${searchSummary.radiusMiles} miles for ${formatHistoryRangeLabel(historyRange, sinceDate)}.`
                    : `No ${getFilterSummaryLabel(eventFilters, 0)} found within ${searchSummary.radiusMiles} miles for ${formatHistoryRangeLabel(historyRange, sinceDate)}.`}
              </p>
            </div>
            <button
              type="button"
              onClick={onPinProperty}
              disabled={!canPinProperty}
              title={isPinned ? 'Unpin this property' : 'Pin this property to your saved list'}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                isPinned
                  ? 'bg-amber-500 text-white shadow-sm hover:bg-amber-600'
                  : 'bg-orange-500 text-white shadow-sm hover:bg-orange-600'
              } disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400 disabled:shadow-none`}
            >
              <span aria-hidden="true">{isPinned ? '★' : '☆'}</span>
              {isPinned ? 'Pinned' : 'Pin Property'}
            </button>
          </div>
          {!loading && latestStorms[0] && (
            <p className="mt-2 text-xs text-emerald-600">
              Last hit {latestStorms[0].label} with {formatStormImpactSummary(latestStorms[0])}
            </p>
          )}
          {onAnalyzeProperty && searchSummary && (
            <button
              type="button"
              onClick={() => onAnalyzeProperty(searchSummary.locationLabel)}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-100 transition-colors border border-violet-200"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                className="w-3.5 h-3.5"
                aria-hidden="true"
              >
                <path d="M7.702 1.368a.75.75 0 0 1 .597 0c.2.085 3.951 1.725 3.951 5.048 0 1.992-1.14 3.55-2.683 4.51a.75.75 0 0 1-.78 0C7.24 9.966 6.1 8.408 6.1 6.416c0-3.323 3.751-4.963 3.951-5.048h-.349Zm.298 1.563a5.14 5.14 0 0 0-.84.705A4.07 4.07 0 0 0 5.6 6.416c0 1.453.728 2.72 1.9 3.57C8.672 9.136 9.4 7.87 9.4 6.416a4.07 4.07 0 0 0-1.4-3.485ZM1.5 14.25a.75.75 0 0 1 .75-.75h11.5a.75.75 0 0 1 0 1.5H2.25a.75.75 0 0 1-.75-.75Z" />
              </svg>
              Analyze with AI
            </button>
          )}
          {onScanAreaWithAi && searchSummary && (
            <button
              type="button"
              onClick={onScanAreaWithAi}
              disabled={scanningArea}
              className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-600 hover:bg-orange-100 transition-colors border border-orange-200 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {scanningArea ? (
                <>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-3.5 h-3.5 animate-spin"
                    aria-hidden="true"
                  >
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  {areaScanCount > 0
                    ? `Scanning ${areaScanCount} properties\u2026`
                    : 'Scanning area\u2026'}
                </>
              ) : (
                <>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    className="w-3.5 h-3.5"
                    aria-hidden="true"
                  >
                    <path
                      fillRule="evenodd"
                      d="M2 4.25A2.25 2.25 0 0 1 4.25 2h7.5A2.25 2.25 0 0 1 14 4.25v7.5A2.25 2.25 0 0 1 11.75 14h-7.5A2.25 2.25 0 0 1 2 11.75v-7.5Zm2.25-.75a.75.75 0 0 0-.75.75v7.5c0 .414.336.75.75.75h7.5a.75.75 0 0 0 .75-.75v-7.5a.75.75 0 0 0-.75-.75h-7.5Z"
                      clipRule="evenodd"
                    />
                    <path d="M8.75 5.75a.75.75 0 0 0-1.5 0v1.5h-1.5a.75.75 0 0 0 0 1.5h1.5v1.5a.75.75 0 0 0 1.5 0v-1.5h1.5a.75.75 0 0 0 0-1.5h-1.5v-1.5Z" />
                  </svg>
                  Scan Area with AI
                </>
              )}
            </button>
          )}
        </div>
      )}

      {canvassingAlert?.inHailZone && (
        <div className="mx-3 mt-3 rounded-lg border border-orange-300 bg-orange-50 p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="h-2 w-2 animate-pulse rounded-full bg-orange-500" />
            <span className="text-xs font-semibold uppercase tracking-wider text-orange-700">
              Hail Zone Alert
            </span>
          </div>
          <p className="text-sm font-medium text-stone-900">
            {canvassingAlert.estimatedHailSize}" hail detected nearby
          </p>
          {canvassingAlert.talkingPoints.length > 0 && (
            <p className="mt-1 text-xs text-orange-700">
              {canvassingAlert.talkingPoints[0]}
            </p>
          )}
        </div>
      )}

      {selectedDate && (
        <div className="border-b border-stone-200 px-3 py-3">
          <div className="rounded-2xl border border-orange-200 bg-orange-50 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-600">
                  Selected Storm
                </p>
                <h3 className="mt-1 text-base font-semibold text-stone-900">
                  {selectedDate.label}
                </h3>
                <p className="mt-1 text-xs text-stone-600">
                  Historical MRMS is now the primary hail footprint for this storm on the map.
                </p>
              </div>
              <span
                className="rounded-full px-2 py-1 text-[11px] font-bold"
                style={{
                  backgroundColor: `${getHailSizeClass(selectedDate.maxHailInches)?.color || '#fb923c'}20`,
                  color: getHailSizeClass(selectedDate.maxHailInches)?.color || '#fb923c',
                }}
              >
                {selectedDate.maxHailInches > 0 ? `${selectedDate.maxHailInches}"` : '--'}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <SelectedStormMetric
                label="Reports"
                value={String(selectedDate.eventCount)}
              />
              <SelectedStormMetric
                label="Wind"
                value={
                  selectedDate.maxWindMph > 0
                    ? `${selectedDate.maxWindMph.toFixed(0)} mph`
                    : 'None'
                }
              />
              <SelectedStormMetric
                label="Proof"
                value={String(selectedStormEvidence.length)}
              />
            </div>

            {selectedStormSources.length > 0 && (
              <p className="mt-3 text-[11px] text-stone-500">
                Primary sources: {selectedStormSources.join(' · ')}
              </p>
            )}

            <AddressImpactBadge
              selectedDate={selectedDate.date}
              anchorTimestamp={selectedStormAnchorTimestamp}
              searchLat={searchLat}
              searchLng={searchLng}
              bounds={selectedStormBounds}
              addressLabel={searchSummary?.locationLabel ?? null}
            />

            <WindImpactBadge
              selectedDate={selectedDate.date}
              searchLat={searchLat}
              searchLng={searchLng}
              bounds={selectedStormBounds}
              states={WIND_FOCUS_STATES}
              addressLabel={searchSummary?.locationLabel ?? null}
            />

            <div className="mt-3 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  void onGenerateReport(selectedDate.date);
                }}
                disabled={generatingReport}
                className="rounded-xl bg-orange-500 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400"
              >
                {generatingReport ? 'Generating...' : 'Generate PDF'}
              </button>
              <button
                type="button"
                onClick={onOpenEvidence}
                className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 transition-colors hover:bg-stone-50"
              >
                Open Evidence
              </button>
              <button
                type="button"
                onClick={() => onToggleStormRoute(selectedDate)}
                className={`rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
                  (queuedRouteCountsByDate[selectedDate.date] || 0) > 0
                    ? 'border-orange-300 bg-orange-100 text-orange-700'
                    : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50'
                }`}
              >
                {(queuedRouteCountsByDate[selectedDate.date] || 0) > 0
                  ? `Queued ${queuedRouteCountsByDate[selectedDate.date]}`
                  : 'Add Route'}
              </button>
            </div>
          </div>
          <CollapsibleSection title="Actions" defaultOpen={false}>
            <button
              type="button"
              onClick={onOpenReports}
              className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-stone-700 transition-colors hover:bg-stone-100"
            >
              Open Report Workspace
            </button>

            <button
              type="button"
              onClick={() => setShowSelectedStormDetails((current) => !current)}
              className="mt-2 flex w-full items-center justify-between rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-stone-700 transition-colors hover:bg-stone-100"
            >
              <span>
                {showSelectedStormDetails ? 'Hide' : 'Show'} Storm Details
              </span>
              <span className="text-orange-500">
                {showSelectedStormDetails ? '−' : '+'}
              </span>
            </button>
          </CollapsibleSection>

          {showSelectedStormDetails && (
            <>
              <div className="mt-3 rounded-2xl border border-stone-200 bg-stone-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
                    Strongest Hits
                  </p>
                  <span className="text-[10px] text-stone-400">
                    top {rankedStormHits.length}
                  </span>
                </div>

                {rankedStormHits.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {rankedStormHits.map((event) => (
                      <div
                        key={event.id}
                        className="rounded-xl border border-stone-200 bg-white px-3 py-2"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-stone-900">
                              {formatEventMagnitude(event)}
                            </p>
                            <p className="mt-1 text-xs text-stone-500">
                              {formatEventLocation(event)}
                            </p>
                          </div>
                          <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-1 text-[11px] text-stone-600">
                            {formatEventTime(event.beginDate)}
                          </span>
                        </div>
                        <p className="mt-2 line-clamp-2 text-[11px] text-stone-400">
                          {event.narrative || event.source}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-stone-400">
                    No ranked storm reports are available for this selected date yet.
                  </p>
                )}
              </div>

              <div className="mt-3">
                <EvidenceThumbnailStrip
                  items={selectedStormEvidence}
                  title={`${selectedDate.label} Proof`}
                  subtitle="Photos, videos, and source evidence tied to the selected storm date."
                  emptyLabel="No evidence is attached to this selected storm date yet."
                  onOpenEvidence={onOpenEvidence}
                  compact
                  prioritizeIncluded
                />
              </div>
            </>
          )}
        </div>
      )}

      <CollapsibleSection title="Event Filters" defaultOpen={true}>
        <div className="grid grid-cols-2 gap-2">
          <FilterButton
            active={eventFilters.hail}
            label="Hail"
            onClick={() =>
              onFilterChange({
                ...eventFilters,
                hail: !eventFilters.hail,
              })
            }
          />
          <FilterButton
            active={eventFilters.wind}
            label="Wind"
            onClick={() =>
              onFilterChange({
                ...eventFilters,
                wind: !eventFilters.wind,
              })
            }
          />
        </div>

        {onTerritoryOnlyChange && (
          <TerritoryToggle
            value={territoryOnly}
            onChange={onTerritoryOnlyChange}
          />
        )}

        <PushAlertsToggle territoryStates={WIND_FOCUS_STATES} />
      </CollapsibleSection>

      <div className="min-h-0">
        <CollapsibleSection
          title="Storm Reports"
          defaultOpen={true}
          badge={sortedDates.length > 0 ? sortedDates.length : undefined}
        >
          <div className="flex -mx-4 border-b border-stone-200 mb-3">
            <TabButton
              active={activeTab === 'recent'}
              onClick={() => setActiveTab('recent')}
              label="Recent"
            />
            <TabButton
              active={activeTab === 'impact'}
              onClick={() => setActiveTab('impact')}
              label="Impact"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <ListFilterChip
              active={dateListFilter === 'all'}
              label={`All ${sortedDates.length}`}
              onClick={() => setDateListFilter('all')}
            />
            <ListFilterChip
              active={dateListFilter === 'major'}
              label={'1.5"+'}
              onClick={() => setDateListFilter('major')}
            />
            <ListFilterChip
              active={dateListFilter === 'proof'}
              label="With Proof"
              onClick={() => setDateListFilter('proof')}
            />
            <ListFilterChip
              active={dateListFilter === 'knock'}
              label="Knock Now"
              onClick={() => setDateListFilter('knock')}
            />
          </div>
        </CollapsibleSection>

        {knockQueue.length > 0 && (
          <CollapsibleSection
            title="Canvass Queue"
            defaultOpen={false}
            badge={knockQueue.length}
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <button
                type="button"
                onClick={onBuildKnockRoute}
                className="rounded-full border border-orange-300 bg-orange-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-orange-700 transition-colors hover:bg-orange-100"
              >
                Build Route
              </button>
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {knockQueue.map((stormDate) => (
                <button
                  key={`queue-${stormDate.date}`}
                  type="button"
                  onClick={() => handleDateClick(stormDate)}
                  className="shrink-0 rounded-full border border-orange-300 bg-orange-50 px-2.5 py-1.5 text-xs font-semibold text-orange-700"
                >
                  {stormDate.label}
                </button>
              ))}
            </div>
          </CollapsibleSection>
        )}

        <CollapsibleSection
          title="Storm Dates"
          defaultOpen={true}
          badge={displayedDates.length > 0 ? displayedDates.length : undefined}
        >
          {loading && (
            <div className="py-4 text-center">
              <div className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-orange-500" />
              <p className="text-xs text-stone-400 mt-2">Loading storm data...</p>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-orange-300 bg-orange-50 p-3">
              <p className="text-xs text-orange-700">{error}</p>
            </div>
          )}

          {!loading && !error && displayedDates.length === 0 && (
            <div className="py-4 text-center">
              <p className="text-sm text-stone-500">No storm dates found</p>
              <p className="text-xs text-stone-400 mt-1">
                {searchSummary
                  ? `Try 2Y or 5Y, or search a broader nearby area than ${searchSummary.locationLabel}.`
                  : 'Search an address, city, or ZIP to load nearby hail dates.'}
              </p>
            </div>
          )}

          <div className="-mx-4">
            {displayedDates.map((sd) => (
              <StormDateCard
                key={sd.date}
                stormDate={sd}
                isSelected={selectedDate?.date === sd.date}
                isExpanded={expandedDate === sd.date}
                compact={false}
                events={events.filter((e) => toEasternDateKey(e.beginDate) === sd.date)}
                evidenceCount={evidenceCountsByDate.get(sd.date) || 0}
                generatingReport={generatingReport}
                onGenerateReport={onGenerateReport}
                onOpenEvidence={onOpenEvidence}
                routeQueuedCount={queuedRouteCountsByDate[sd.date] || 0}
                onToggleRoute={() => onToggleStormRoute(sd)}
                onClick={() => handleDateClick(sd)}
                onToggleExpand={(e) => toggleExpand(sd.date, e)}
              />
            ))}
          </div>
        </CollapsibleSection>

        <div className="p-3">
          <button
            onClick={openDateOfLossModal}
            disabled={!searchSummary || generatingReport}
            className="w-full rounded-xl bg-[linear-gradient(135deg,#f97316,#7c3aed)] px-3 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(124,58,237,0.22)] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400 disabled:shadow-none"
          >
            {generatingReport ? 'Generating Report...' : 'Gen Report'}
          </button>
          <p className="mt-2 text-center text-[11px] text-stone-400">
            Choose the loss date, then download the NOAA-forward PDF.
          </p>
        </div>
      </div>

      <div className="p-3 border-t border-stone-200 text-xs text-stone-400">
        <div className="flex justify-between">
          <span>
            {stormDates.length} {getFilterSummaryLabel(eventFilters, stormDates.length)}
          </span>
          <span>{events.length} reports</span>
        </div>
      </div>

      {showDateOfLossModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-stone-900">
                Select Date of Loss
              </h3>
              <button
                onClick={() => setShowDateOfLossModal(false)}
                className="rounded-md p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-900"
              >
                x
              </button>
            </div>
            <p className="mt-2 text-sm text-stone-500">
              Type a date or pick from verified storms. The PDF runs a fresh
              consilience check either way.
            </p>
            <div className="mt-4">
              <DatePicker
                value={selectedDateOfLoss}
                onChange={(d) => setSelectedDateOfLoss(d)}
              />
            </div>
            {stormDates.length > 0 && (
              <>
                <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-stone-400">
                  Or pick a known storm
                </p>
                <div className="mt-2 max-h-56 space-y-2 overflow-y-auto">
                  {stormDates.map((stormDate) => (
                    <button
                      key={`dol-${stormDate.date}`}
                      onClick={() => setSelectedDateOfLoss(stormDate.date)}
                      className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                        selectedDateOfLoss === stormDate.date
                          ? 'border-orange-400 bg-orange-50'
                          : 'border-stone-200 bg-stone-50 hover:bg-stone-100'
                      }`}
                    >
                      <p className="text-sm font-semibold text-stone-900">
                        {stormDate.label}
                      </p>
                      <p className="mt-0.5 text-xs text-stone-500">
                        {stormDate.eventCount} event{stormDate.eventCount === 1 ? '' : 's'} · {formatStormImpactSummary(stormDate)}
                      </p>
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowDateOfLossModal(false)}
                className="rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-600 hover:bg-stone-50"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerateReportClick}
                disabled={!selectedDateOfLoss || generatingReport}
                className="rounded-lg bg-[linear-gradient(135deg,#f97316,#7c3aed)] px-3 py-2 text-sm font-semibold text-white hover:opacity-95 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400"
              >
                {generatingReport ? 'Generating...' : 'Gen PDF Report'}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

function SelectedStormMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-orange-200 bg-white px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-orange-600/70">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-stone-900">{value}</p>
    </div>
  );
}

function ListFilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
        active
          ? 'border-orange-400 bg-orange-50 text-orange-700'
          : 'border-stone-200 bg-stone-50 text-stone-500 hover:bg-stone-100'
      }`}
    >
      {label}
    </button>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-3 text-xs font-semibold uppercase tracking-wider transition-colors ${
        active
          ? 'text-stone-900 border-b-2 border-orange-400'
          : 'text-stone-400 hover:text-stone-700'
      }`}
      role="tab"
      aria-selected={active}
    >
      {label}
    </button>
  );
}

function RangeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-2 py-2 text-xs font-semibold transition-colors ${
        active
          ? 'bg-[linear-gradient(135deg,#f97316,#7c3aed)] text-white'
          : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
      }`}
    >
      {label}
    </button>
  );
}

function FilterButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  const activeClass =
    label === 'Wind'
      ? 'bg-violet-500 text-white'
      : 'bg-orange-400 text-stone-900';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
        active ? activeClass : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
      }`}
    >
      {label}
    </button>
  );
}

function TerritoryToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
            Coverage
          </p>
          <p className="mt-0.5 text-xs font-semibold text-stone-800">
            {value ? 'VA · MD · PA' : 'All states'}
          </p>
          <p className="mt-0.5 text-[10px] text-stone-500 leading-snug">
            {value
              ? 'Events and swaths clipped to focus territory.'
              : 'Showing every report in the search radius.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange(!value)}
          role="switch"
          aria-checked={value}
          aria-label="Toggle VA/MD/PA territory clipping"
          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
            value ? 'bg-orange-500' : 'bg-stone-300'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
              value ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
    </div>
  );
}

/**
 * "Storm alerts" toggle — enables web push so the rep gets a notification
 * when an NWS Severe Thunderstorm or Tornado Warning fires inside their
 * territory, even when the app isn't focused. Backed by the
 * /api/push/subscribe endpoint and the in-server fan-out worker.
 */
function PushAlertsToggle({
  territoryStates,
}: {
  territoryStates: string[];
}) {
  const supported = isNotificationSupported();
  const [permission, setPermission] = useState<NotificationPermission>(
    supported ? getNotificationPermission() : 'denied',
  );
  const [pending, setPending] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (!supported || !('serviceWorker' in navigator)) return;
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        if (!cancelled) setEnabled(Boolean(sub));
      } catch {
        // ignore
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, [supported]);

  if (!supported) {
    return (
      <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 p-2 text-[10px] text-stone-500">
        Push notifications aren't supported on this browser.
      </div>
    );
  }

  const blocked = permission === 'denied';

  async function handleEnable() {
    setPending(true);
    setHint(null);
    const result = await enableStormAlerts({ territoryStates });
    setPermission(getNotificationPermission());
    setPending(false);
    if (result.ok) {
      setEnabled(true);
      setHint('Alerts enabled — you’ll be notified for severe warnings in your territory.');
    } else {
      setHint(messageForReason(result.reason));
    }
  }

  async function handleDisable() {
    setPending(true);
    await disableStormAlerts();
    setEnabled(false);
    setPending(false);
    setHint('Alerts disabled.');
  }

  return (
    <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
            Storm Alerts
          </p>
          <p className="mt-0.5 text-xs font-semibold text-stone-800">
            {enabled ? 'On' : blocked ? 'Blocked' : 'Off'}
          </p>
          <p className="mt-0.5 text-[10px] leading-snug text-stone-500">
            {enabled
              ? `Push alerts for severe warnings in ${territoryStates.slice(0, 3).join(', ')}.`
              : blocked
              ? 'Notifications are blocked in this browser. Enable them from the address bar.'
              : 'Get notified the moment NWS issues a SVR/Tornado warning in your territory.'}
          </p>
        </div>
        <button
          type="button"
          onClick={enabled ? handleDisable : handleEnable}
          disabled={pending || blocked}
          aria-pressed={enabled}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
            enabled
              ? 'bg-orange-500'
              : blocked
              ? 'bg-stone-200 cursor-not-allowed'
              : 'bg-stone-300'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
              enabled ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
      {hint && (
        <p className="mt-2 text-[10px] leading-snug text-stone-500">{hint}</p>
      )}
    </div>
  );
}

function messageForReason(reason: string): string {
  switch (reason) {
    case 'denied':
      return 'Notification permission denied — enable it in your browser settings to turn on alerts.';
    case 'unsupported':
      return 'This browser does not support push notifications.';
    case 'no-vapid-key':
      return 'Push not configured on the server yet. Try again shortly.';
    case 'subscribe-failed':
      return 'Browser refused the subscription. Try reloading the page.';
    case 'invalid-subscription':
      return 'Browser returned an incomplete subscription — please retry.';
    case 'server-rejected':
    case 'network-error':
      return 'Couldn’t reach the server. Check your connection and retry.';
    default:
      return 'Could not enable alerts.';
  }
}

function formatHistoryRangeLabel(
  historyRange: HistoryRangePreset,
  sinceDate: string,
): string {
  if (historyRange === 'since' && sinceDate) {
    return `since ${formatShortDate(sinceDate)}`;
  }
  if (historyRange === '10y') return 'the last 10 years';
  if (historyRange === '5y') return 'the last 5 years';
  if (historyRange === '2y') return 'the last 2 years';
  return 'the last year';
}

function formatShortDate(date: string): string {
  return formatEasternDateLabel(date, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getFilterSummaryLabel(
  filters: EventFilterState,
  count: number,
): string {
  if (filters.hail && filters.wind) {
    return `storm date${count === 1 ? '' : 's'}`;
  }
  if (filters.wind) {
    return `wind date${count === 1 ? '' : 's'}`;
  }
  return `hail date${count === 1 ? '' : 's'}`;
}

function formatStormImpactSummary(stormDate: StormDate): string {
  const parts: string[] = [];

  if (stormDate.maxHailInches > 0) {
    parts.push(`${stormDate.maxHailInches.toFixed(2)}" hail`);
  }
  if (stormDate.maxWindMph > 0) {
    parts.push(`${stormDate.maxWindMph.toFixed(0)} mph wind`);
  }

  return parts.join(' · ') || 'no measured hail or wind';
}

function formatEventMagnitude(event: StormEvent): string {
  if (event.eventType === 'Thunderstorm Wind') {
    return `${event.magnitude.toFixed(0)} mph wind`;
  }

  return `${event.magnitude}" hail`;
}

function formatEventLocation(event: StormEvent): string {
  if (event.county && event.state) {
    return `${event.county}, ${event.state}`;
  }

  if (event.county) {
    return event.county;
  }

  if (event.state) {
    return event.state;
  }

  return event.source;
}

function formatEventTime(dateStr: string): string {
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) {
    return 'Time unknown';
  }

  return parsed.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });
}

function StormDateCard({
  stormDate,
  isSelected,
  isExpanded,
  compact,
  events: dateEvents,
  evidenceCount,
  generatingReport,
  onGenerateReport,
  onOpenEvidence,
  routeQueuedCount,
  onToggleRoute,
  onClick,
  onToggleExpand,
}: {
  stormDate: StormDate;
  isSelected: boolean;
  isExpanded: boolean;
  compact: boolean;
  events: StormEvent[];
  evidenceCount: number;
  generatingReport: boolean;
  onGenerateReport: (dateOfLoss: string) => Promise<void>;
  onOpenEvidence: () => void;
  routeQueuedCount: number;
  onToggleRoute: () => void;
  onClick: () => void;
  onToggleExpand: (e: React.MouseEvent) => void;
}) {
  const sizeClass = getHailSizeClass(stormDate.maxHailInches);
  const severityColor = sizeClass?.color || HAIL_SIZE_CLASSES[0].color;
  const canvassPriority = getStormCanvassPriority(stormDate, evidenceCount);
  // NOAA Storm Events publishes archive data on a 30–90 day lag; anything
  // newer is "preliminary" (sourced from SPC same-day reports or LSRs which
  // can be revised). Use the date age + source mix to pick the pill.
  const isPreliminary = useMemo(() => {
    // Date.now is unavoidable here — preliminary status is a function of
    // wall-clock age, not derivable from props alone. The pill re-renders
    // when StormDateCard does, which is fine for an at-a-glance freshness
    // hint that doesn't need sub-second precision.
    // eslint-disable-next-line react-hooks/purity
    const ageMs = Date.now() - new Date(`${stormDate.date}T00:00:00Z`).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays < 90) return true;
    return dateEvents.some((e) => {
      const s = e.source ?? '';
      return (
        /^SPC$/i.test(s) ||
        /^LSR/i.test(s) ||
        /^NEXRAD/i.test(s) ||
        /preliminary/i.test(s)
      );
    });
  }, [stormDate.date, dateEvents]);

  return (
    <div
      className={`border-b border-stone-200 cursor-pointer transition-colors ${
        isSelected
          ? 'bg-orange-50 border-l-2 border-l-orange-400'
          : 'hover:bg-stone-50 border-l-2 border-l-transparent'
      }`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className={compact ? 'p-2.5' : 'p-3'}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: severityColor }}
                title={sizeClass?.label || 'Unknown size'}
              />
              <span className="text-sm font-medium text-stone-900 truncate">
                {stormDate.label}
              </span>
              <span
                className={`flex-shrink-0 rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                  isPreliminary
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-emerald-100 text-emerald-700'
                }`}
                title={
                  isPreliminary
                    ? 'Preliminary — SPC/LSR same-day or recent radar; subject to revision when NOAA Storm Events publishes the official archive (typically 30–90 days).'
                    : 'Verified — sourced from NOAA Storm Events archive.'
                }
              >
                {isPreliminary ? 'PRELIM' : 'VERIFIED'}
              </span>
            </div>
            <div className={`mt-1 ml-4.5 flex flex-wrap items-center ${compact ? 'gap-2' : 'gap-3'}`}>
              <span className="text-xs text-stone-500">
                {stormDate.eventCount > 0
                  ? `${stormDate.eventCount} report${stormDate.eventCount !== 1 ? 's' : ''}`
                  : 'Swath data'}
              </span>
              {evidenceCount > 0 && (
                <span className="text-xs text-violet-600">
                  {evidenceCount} proof
                </span>
              )}
              {stormDate.statesAffected.length > 0 && (
                <span className="text-xs text-stone-400">
                  {stormDate.statesAffected.slice(0, 3).join(', ')}
                </span>
              )}
              {stormDate.maxWindMph > 0 && (
                <span className="text-xs text-sky-600">
                  {stormDate.maxWindMph.toFixed(0)} mph
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                canvassPriority === 'Knock now'
                  ? 'bg-orange-100 text-orange-700'
                  : canvassPriority === 'Monitor'
                    ? 'bg-violet-100 text-violet-700'
                    : 'bg-stone-100 text-stone-500'
              }`}
            >
              {canvassPriority}
            </span>
            <span
              className="px-1.5 py-0.5 rounded text-xs font-bold"
              style={{
                backgroundColor: `${severityColor}20`,
                color: severityColor,
              }}
            >
              {stormDate.maxHailInches > 0 ? `${stormDate.maxHailInches}"` : '--'}
            </span>
            <button
              onClick={onToggleExpand}
              className="p-0.5 text-stone-400 hover:text-stone-700 transition-colors"
              aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
            >
              <svg
                className={`w-5 h-5 transition-transform ${
                  isExpanded ? 'rotate-180' : ''
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {isSelected && (
        <div className="border-t border-stone-200 px-3 pb-2">
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void onGenerateReport(stormDate.date);
              }}
              disabled={generatingReport}
              className="rounded-lg bg-orange-500 px-2.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400"
            >
              {generatingReport ? 'Generating...' : 'PDF'}
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenEvidence();
              }}
              className="rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-stone-700 transition-colors hover:bg-stone-50"
            >
              Proof
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggleRoute();
              }}
              className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                routeQueuedCount > 0
                  ? 'border-orange-300 bg-orange-100 text-orange-700'
                  : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50'
              }`}
            >
              {routeQueuedCount > 0 ? `Queued ${routeQueuedCount}` : 'Route'}
            </button>
            <button
              type="button"
              onClick={onToggleExpand}
              className="rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-stone-600 transition-colors hover:bg-stone-50"
            >
              {isExpanded ? 'Hide Hits' : 'Show Hits'}
            </button>
          </div>
        </div>
      )}

      {isExpanded && (
        <div className="px-3 pb-3 border-t border-stone-200">
          {dateEvents.length > 0 ? (
            <div className="mt-2 space-y-1.5">
              {dateEvents.slice(0, 10).map((event) => (
                <div key={event.id} className="flex items-center gap-2 text-xs">
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{
                      backgroundColor:
                        getHailSizeClass(event.magnitude)?.color || '#888',
                    }}
                  />
                  <span className="text-stone-500 truncate flex-1">
                    {event.magnitude > 0 ? `${event.magnitude}"` : ''}{' '}
                    {event.county && `${event.county},`} {event.state || event.source}
                  </span>
                </div>
              ))}
              {dateEvents.length > 10 && (
                <p className="text-xs text-stone-400 ml-3.5">
                  +{dateEvents.length - 10} more reports
                </p>
              )}
            </div>
          ) : (
            <p className="mt-2 text-xs text-stone-400">
              MESH swath data available (no individual reports)
            </p>
          )}
        </div>
      )}
    </div>
  );
}

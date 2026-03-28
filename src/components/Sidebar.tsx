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
import { getHailSizeClass, HAIL_SIZE_CLASSES } from '../types/storm';
import EvidenceThumbnailStrip from './EvidenceThumbnailStrip';

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
  eventFilters: EventFilterState;
  onFilterChange: (filters: EventFilterState) => void;
  generatingReport: boolean;
  onGenerateReport: (dateOfLoss: string) => Promise<void>;
  onOpenReports: () => void;
  canPinProperty: boolean;
  isPinned: boolean;
  onPinProperty: () => void;
  evidenceItems: EvidenceItem[];
  onOpenEvidence: () => void;
}

type TabId = 'recent' | 'impact';
type DateListFilter = 'all' | 'major' | 'proof' | 'knock';

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
  eventFilters,
  onFilterChange,
  generatingReport,
  onGenerateReport,
  onOpenReports,
  canPinProperty,
  isPinned,
  onPinProperty,
  evidenceItems,
  onOpenEvidence,
}: SidebarProps) {
  const [activeTab, setActiveTab] = useState<TabId>('recent');
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [showDateOfLossModal, setShowDateOfLossModal] = useState(false);
  const [selectedDateOfLoss, setSelectedDateOfLoss] = useState('');
  const [showSelectedStormDetails, setShowSelectedStormDetails] = useState(false);
  const [compactList, setCompactList] = useState(true);
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

    return events.filter((event) => event.beginDate.slice(0, 10) === selectedDate.date);
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
      const priority = getCanvassPriority(stormDate, evidenceCount);

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
        return getCanvassPriority(stormDate, evidenceCount) === 'Knock now';
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
    <aside className="flex max-h-[48vh] w-full shrink-0 flex-col border-b border-slate-800 bg-slate-950 text-white min-h-0 lg:max-h-none lg:w-80 lg:border-b-0 lg:border-r">
      <div className="border-b border-slate-800 p-4">
        <div className="flex items-center gap-2">
          <svg
            className="h-5 w-5 flex-shrink-0 text-orange-300"
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
            <h1 className="text-lg font-bold tracking-tight">Hail Yes!</h1>
            <p className="text-xs text-gray-400">
              Property hail intelligence for roofing reps
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSearch} className="p-3 border-b border-gray-800">
        <div className="relative">
          <input
            key={activeSearchLabel ?? 'search-location'}
            ref={inputRef}
            type="text"
            defaultValue={activeSearchLabel ?? ''}
            placeholder="Address, city, or ZIP..."
            className="w-full rounded-lg border border-gray-700 bg-gray-900 py-2 pl-9 pr-3 text-sm text-white placeholder-gray-500 focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400"
            aria-label="Search location"
          />
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
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
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">
            History Range
          </p>
          <div className="grid grid-cols-5 gap-1.5">
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
              className="mt-2 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400"
              aria-label="Show storms since date"
            />
          )}
        </div>
      </form>

      {searchSummary && (
        <div className="border-b border-gray-800 px-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                Property History
              </p>
              <p className="mt-1 text-sm font-semibold text-white">
                {searchSummary.locationLabel}
              </p>
              <p className="mt-1 text-xs text-gray-400">
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
              className={`rounded-lg px-3 py-2 text-[11px] font-semibold transition-colors ${
                isPinned
                  ? 'bg-amber-500 text-gray-950'
                  : 'bg-gray-900 text-white hover:bg-gray-800'
              } disabled:cursor-not-allowed disabled:bg-gray-900 disabled:text-gray-500`}
            >
              {isPinned ? 'Pinned' : 'Pin'}
            </button>
          </div>
          {!loading && latestStorms[0] && (
            <p className="mt-2 text-xs text-green-300">
              Last hit {latestStorms[0].label} with {formatStormImpactSummary(latestStorms[0])}
            </p>
          )}
        </div>
      )}

      {canvassingAlert?.inHailZone && (
        <div className="mx-3 mt-3 rounded-lg border border-orange-500/30 bg-[linear-gradient(135deg,rgba(249,115,22,0.18),rgba(124,58,237,0.18))] p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="h-2 w-2 animate-pulse rounded-full bg-orange-300" />
            <span className="text-xs font-semibold uppercase tracking-wider text-orange-200">
              Hail Zone Alert
            </span>
          </div>
          <p className="text-sm font-medium text-white">
            {canvassingAlert.estimatedHailSize}" hail detected nearby
          </p>
          {canvassingAlert.talkingPoints.length > 0 && (
            <p className="mt-1 text-xs text-orange-100/90">
              {canvassingAlert.talkingPoints[0]}
            </p>
          )}
        </div>
      )}

      {latestStorms.length > 0 && (
        <div className="border-b border-gray-800 px-3 py-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">
              Latest Two Hits
            </p>
            <span className="text-[10px] text-gray-600">newest first</span>
          </div>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {latestStorms.map((stormDate) => (
              <button
                key={`latest-${stormDate.date}`}
                onClick={() => handleDateClick(stormDate)}
                className={`min-w-[11rem] shrink-0 rounded-xl border px-3 py-2 text-left transition-colors ${
                  selectedDate?.date === stormDate.date
                    ? 'border-orange-400/70 bg-orange-500/10'
                    : 'border-gray-800 bg-gray-900/70 hover:bg-gray-900'
                }`}
              >
                <p className="text-sm font-semibold text-white">{stormDate.label}</p>
                <p className="mt-1 text-xs text-gray-400">
                  {stormDate.eventCount} report{stormDate.eventCount === 1 ? '' : 's'} · {formatStormImpactSummary(stormDate)}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedDate && (
        <div className="border-b border-gray-800 px-3 py-3">
          <div className="rounded-2xl border border-orange-500/20 bg-[linear-gradient(135deg,rgba(249,115,22,0.16),rgba(124,58,237,0.14))] p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-200">
                  Selected Storm
                </p>
                <h3 className="mt-1 text-base font-semibold text-white">
                  {selectedDate.label}
                </h3>
                <p className="mt-1 text-xs text-orange-50/90">
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
              <p className="mt-3 text-[11px] text-orange-50/80">
                Primary sources: {selectedStormSources.join(' · ')}
              </p>
            )}

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  void onGenerateReport(selectedDate.date);
                }}
                disabled={generatingReport}
                className="rounded-xl bg-white px-3 py-2 text-sm font-semibold text-gray-950 transition-colors hover:bg-orange-50 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/50"
              >
                {generatingReport ? 'Generating...' : 'Generate PDF'}
              </button>
              <button
                type="button"
                onClick={onOpenEvidence}
                className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-black/30"
              >
                Open Evidence
              </button>
            </div>
            <button
              type="button"
              onClick={onOpenReports}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/15 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-orange-100/90 transition-colors hover:bg-black/25"
            >
              Open Report Workspace
            </button>

            <button
              type="button"
              onClick={() => setShowSelectedStormDetails((current) => !current)}
              className="mt-2 flex w-full items-center justify-between rounded-xl border border-white/10 bg-black/15 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white transition-colors hover:bg-black/25"
            >
              <span>
                {showSelectedStormDetails ? 'Hide' : 'Show'} Storm Details
              </span>
              <span className="text-orange-200">
                {showSelectedStormDetails ? '−' : '+'}
              </span>
            </button>
          </div>

          {showSelectedStormDetails && (
            <>
              <div className="mt-3 rounded-2xl border border-gray-800 bg-gray-950/80 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                    Strongest Hits
                  </p>
                  <span className="text-[10px] text-gray-600">
                    top {rankedStormHits.length}
                  </span>
                </div>

                {rankedStormHits.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {rankedStormHits.map((event) => (
                      <div
                        key={event.id}
                        className="rounded-xl border border-gray-800 bg-black/20 px-3 py-2"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-white">
                              {formatEventMagnitude(event)}
                            </p>
                            <p className="mt-1 text-xs text-gray-400">
                              {formatEventLocation(event)}
                            </p>
                          </div>
                          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-gray-300">
                            {formatEventTime(event.beginDate)}
                          </span>
                        </div>
                        <p className="mt-2 line-clamp-2 text-[11px] text-gray-500">
                          {event.narrative || event.source}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-gray-500">
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

      <div className="border-b border-gray-800 px-3 py-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">
            Event Filters
          </p>
          <span className="text-[10px] text-gray-600">map + dates</span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
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
      </div>

      <div className="flex-1 overflow-y-auto sidebar-scroll min-h-0">
        <div className="sticky top-0 z-10 border-b border-gray-800 bg-slate-950/96 backdrop-blur">
          <div className="flex items-center border-b border-gray-800">
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
          <div className="flex items-center justify-between px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">
              Hail Dates
            </p>
            <button
              type="button"
              onClick={() => setCompactList((current) => !current)}
              className="rounded-lg border border-gray-800 bg-gray-900 px-2.5 py-1 text-[11px] font-semibold text-gray-300 transition-colors hover:bg-gray-800"
            >
              {compactList ? 'Comfort' : 'Compact'}
            </button>
          </div>
          <div className="flex gap-1.5 overflow-x-auto px-3 pb-2">
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
          {knockQueue.length > 0 && (
            <div className="border-t border-gray-800 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-orange-200">
                Canvass Queue
              </p>
              <div className="mt-1 flex gap-1.5 overflow-x-auto pb-1">
                {knockQueue.map((stormDate) => (
                  <button
                    key={`queue-${stormDate.date}`}
                    type="button"
                    onClick={() => handleDateClick(stormDate)}
                    className="shrink-0 rounded-full border border-orange-500/30 bg-orange-500/10 px-2.5 py-1 text-[11px] font-semibold text-orange-100"
                  >
                    {stormDate.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {loading && (
          <div className="p-4 text-center">
            <div className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-gray-600 border-t-orange-400" />
            <p className="text-xs text-gray-500 mt-2">Loading storm data...</p>
          </div>
        )}

        {error && (
          <div className="m-3 rounded-lg border border-orange-500/30 bg-orange-950/25 p-3">
            <p className="text-xs text-orange-300">{error}</p>
          </div>
        )}

        {!loading && !error && displayedDates.length === 0 && (
          <div className="p-4 text-center">
            <p className="text-sm text-gray-500">No storm dates found</p>
            <p className="text-xs text-gray-600 mt-1">
              {searchSummary
                ? `Try 2Y or 5Y, or search a broader nearby area than ${searchSummary.locationLabel}.`
                : 'Search an address, city, or ZIP to load nearby hail dates.'}
            </p>
          </div>
        )}

        {displayedDates.map((sd) => (
          <StormDateCard
            key={sd.date}
            stormDate={sd}
            isSelected={selectedDate?.date === sd.date}
            isExpanded={expandedDate === sd.date}
            compact={compactList}
            events={events.filter((e) => e.beginDate.slice(0, 10) === sd.date)}
            evidenceCount={evidenceCountsByDate.get(sd.date) || 0}
            generatingReport={generatingReport}
            onGenerateReport={onGenerateReport}
            onOpenEvidence={onOpenEvidence}
            onClick={() => handleDateClick(sd)}
            onToggleExpand={(e) => toggleExpand(sd.date, e)}
          />
        ))}
      </div>

      <div className="border-t border-gray-800 p-3">
        <button
          onClick={openDateOfLossModal}
          disabled={stormDates.length === 0 || generatingReport}
          className="w-full rounded-xl bg-[linear-gradient(135deg,#f97316,#7c3aed)] px-3 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(124,58,237,0.22)] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-500 disabled:shadow-none"
        >
          {generatingReport ? 'Generating Report...' : 'Gen Report'}
        </button>
        <p className="mt-2 text-center text-[11px] text-gray-500">
          Choose the loss date, then download the NOAA-forward PDF.
        </p>
      </div>

      <div className="p-3 border-t border-gray-800 text-xs text-gray-500">
        <div className="flex justify-between">
          <span>
            {stormDates.length} {getFilterSummaryLabel(eventFilters, stormDates.length)}
          </span>
          <span>{events.length} reports</span>
        </div>
      </div>

      {showDateOfLossModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-gray-950 p-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-white">
                Select Date of Loss
              </h3>
              <button
                onClick={() => setShowDateOfLossModal(false)}
                className="rounded-md p-1 text-gray-400 hover:bg-gray-900 hover:text-white"
              >
                x
              </button>
            </div>
            <p className="mt-2 text-sm text-gray-400">
              Choose the storm date to include as the Date of Loss in the PDF report.
            </p>
            <div className="mt-4 max-h-80 space-y-2 overflow-y-auto">
              {latestStorms.length > 0 ? (
                stormDates.map((stormDate) => (
                  <button
                    key={`dol-${stormDate.date}`}
                    onClick={() => setSelectedDateOfLoss(stormDate.date)}
                    className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                      selectedDateOfLoss === stormDate.date
                        ? 'border-orange-400/70 bg-orange-500/10'
                        : 'border-gray-800 bg-gray-900/70 hover:bg-gray-900'
                    }`}
                  >
                    <p className="text-sm font-semibold text-white">
                      {stormDate.label}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      {stormDate.eventCount} event{stormDate.eventCount === 1 ? '' : 's'} · {formatStormImpactSummary(stormDate)}
                    </p>
                  </button>
                ))
              ) : (
                <p className="text-sm text-gray-500">No storm dates available.</p>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowDateOfLossModal(false)}
                className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerateReportClick}
                disabled={!selectedDateOfLoss || generatingReport}
                className="rounded-lg bg-[linear-gradient(135deg,#f97316,#7c3aed)] px-3 py-2 text-sm font-semibold text-white hover:opacity-95 disabled:cursor-not-allowed disabled:bg-gray-700"
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
    <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-orange-100/70">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
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
      className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
        active
          ? 'border-orange-400/60 bg-orange-500/15 text-orange-100'
          : 'border-gray-800 bg-gray-900 text-gray-400 hover:bg-gray-800'
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
      className={`flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
        active
          ? 'text-white border-b-2 border-orange-400'
          : 'text-gray-500 hover:text-gray-300'
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
          : 'bg-gray-900 text-gray-300 hover:bg-gray-800'
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
      : 'bg-orange-400 text-gray-950';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
        active ? activeClass : 'bg-gray-900 text-gray-300 hover:bg-gray-800'
      }`}
    >
      {label}
    </button>
  );
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
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
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

function getCanvassPriority(
  stormDate: StormDate,
  evidenceCount: number,
): 'Knock now' | 'Monitor' | 'Low' {
  if (
    stormDate.maxHailInches >= 1.5 ||
    stormDate.maxWindMph >= 60 ||
    evidenceCount >= 2
  ) {
    return 'Knock now';
  }

  if (stormDate.maxHailInches >= 1 || stormDate.eventCount >= 5) {
    return 'Monitor';
  }

  return 'Low';
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
  onClick: () => void;
  onToggleExpand: (e: React.MouseEvent) => void;
}) {
  const sizeClass = getHailSizeClass(stormDate.maxHailInches);
  const severityColor = sizeClass?.color || HAIL_SIZE_CLASSES[0].color;
  const canvassPriority = getCanvassPriority(stormDate, evidenceCount);

  return (
    <div
      className={`border-b border-gray-800 cursor-pointer transition-colors ${
        isSelected
          ? 'bg-gray-800/80 border-l-2 border-l-orange-400'
          : 'hover:bg-gray-900/60 border-l-2 border-l-transparent'
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
              <span className="text-sm font-medium text-white truncate">
                {stormDate.label}
              </span>
            </div>
            <div className={`mt-1 ml-4.5 flex flex-wrap items-center ${compact ? 'gap-2' : 'gap-3'}`}>
              <span className="text-xs text-gray-400">
                {stormDate.eventCount > 0
                  ? `${stormDate.eventCount} report${stormDate.eventCount !== 1 ? 's' : ''}`
                  : 'Swath data'}
              </span>
              {evidenceCount > 0 && (
                <span className="text-xs text-violet-300">
                  {evidenceCount} proof
                </span>
              )}
              {stormDate.statesAffected.length > 0 && (
                <span className="text-xs text-gray-500">
                  {stormDate.statesAffected.slice(0, 3).join(', ')}
                </span>
              )}
              {stormDate.maxWindMph > 0 && (
                <span className="text-xs text-sky-300">
                  {stormDate.maxWindMph.toFixed(0)} mph
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                canvassPriority === 'Knock now'
                  ? 'bg-orange-500/20 text-orange-200'
                  : canvassPriority === 'Monitor'
                    ? 'bg-violet-500/20 text-violet-200'
                    : 'bg-gray-800 text-gray-400'
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
              className="p-0.5 text-gray-500 hover:text-gray-300 transition-colors"
              aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
            >
              <svg
                className={`w-3.5 h-3.5 transition-transform ${
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
        <div className="border-t border-gray-800/60 px-3 pb-2">
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void onGenerateReport(stormDate.date);
              }}
              disabled={generatingReport}
              className="rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-semibold text-gray-950 transition-colors hover:bg-orange-50 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/50"
            >
              {generatingReport ? 'Generating...' : 'PDF'}
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpenEvidence();
              }}
              className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-black/30"
            >
              Proof
            </button>
            <button
              type="button"
              onClick={onToggleExpand}
              className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-[11px] font-semibold text-gray-300 transition-colors hover:bg-black/30"
            >
              {isExpanded ? 'Hide Hits' : 'Show Hits'}
            </button>
          </div>
        </div>
      )}

      {isExpanded && (
        <div className="px-3 pb-3 border-t border-gray-800/50">
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
                  <span className="text-gray-400 truncate flex-1">
                    {event.magnitude > 0 ? `${event.magnitude}"` : ''}{' '}
                    {event.county && `${event.county},`} {event.state || event.source}
                  </span>
                </div>
              ))}
              {dateEvents.length > 10 && (
                <p className="text-xs text-gray-600 ml-3.5">
                  +{dateEvents.length - 10} more reports
                </p>
              )}
            </div>
          ) : (
            <p className="mt-2 text-xs text-gray-500">
              MESH swath data available (no individual reports)
            </p>
          )}
        </div>
      )}
    </div>
  );
}

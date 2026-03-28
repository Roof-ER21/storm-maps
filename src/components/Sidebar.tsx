/**
 * Sidebar — Property-search-first storm date list with range controls.
 */

import { useMemo, useRef, useState } from 'react';
import type {
  CanvassingAlert,
  EventFilterState,
  HistoryRangePreset,
  PropertySearchSummary,
  StormDate,
  StormEvent,
} from '../types/storm';
import { getHailSizeClass, HAIL_SIZE_CLASSES } from '../types/storm';

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
  canPinProperty: boolean;
  isPinned: boolean;
  onPinProperty: () => void;
}

type TabId = 'recent' | 'impact';

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
  canPinProperty,
  isPinned,
  onPinProperty,
}: SidebarProps) {
  const [activeTab, setActiveTab] = useState<TabId>('recent');
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [showDateOfLossModal, setShowDateOfLossModal] = useState(false);
  const [selectedDateOfLoss, setSelectedDateOfLoss] = useState('');
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
          <div className="mt-2 grid gap-2">
            {latestStorms.map((stormDate) => (
              <button
                key={`latest-${stormDate.date}`}
                onClick={() => handleDateClick(stormDate)}
                className={`rounded-xl border px-3 py-2 text-left transition-colors ${
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

      <div className="flex border-b border-gray-800">
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

      <div className="flex-1 overflow-y-auto sidebar-scroll min-h-0">
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

        {!loading && !error && sortedDates.length === 0 && (
          <div className="p-4 text-center">
            <p className="text-sm text-gray-500">No storm dates found</p>
            <p className="text-xs text-gray-600 mt-1">
              {searchSummary
                ? `Try a wider history window or a broader location than ${searchSummary.locationLabel}.`
                : 'Search an address, city, or ZIP to load nearby hail dates.'}
            </p>
          </div>
        )}

        {sortedDates.map((sd) => (
          <StormDateCard
            key={sd.date}
            stormDate={sd}
            isSelected={selectedDate?.date === sd.date}
            isExpanded={expandedDate === sd.date}
            events={events.filter((e) => e.beginDate.slice(0, 10) === sd.date)}
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

function StormDateCard({
  stormDate,
  isSelected,
  isExpanded,
  events: dateEvents,
  onClick,
  onToggleExpand,
}: {
  stormDate: StormDate;
  isSelected: boolean;
  isExpanded: boolean;
  events: StormEvent[];
  onClick: () => void;
  onToggleExpand: (e: React.MouseEvent) => void;
}) {
  const sizeClass = getHailSizeClass(stormDate.maxHailInches);
  const severityColor = sizeClass?.color || HAIL_SIZE_CLASSES[0].color;

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
      <div className="p-3">
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
            <div className="flex items-center gap-3 mt-1 ml-4.5">
              <span className="text-xs text-gray-400">
                {stormDate.eventCount > 0
                  ? `${stormDate.eventCount} report${stormDate.eventCount !== 1 ? 's' : ''}`
                  : 'Swath data'}
              </span>
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

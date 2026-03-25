/**
 * Sidebar — Storm dates list with search, tabs, and event detail.
 *
 * Shows storm dates grouped by date with severity badges, event counts,
 * and max hail size. Click to select/deselect. Expandable detail per date.
 */

import { useState } from 'react';
import type { StormDate, StormEvent, CanvassingAlert } from '../types/storm';
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
}: SidebarProps) {
  const [activeTab, setActiveTab] = useState<TabId>('recent');
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState('');

  // Sort dates by tab
  const sortedDates = [...stormDates].sort((a, b) => {
    if (activeTab === 'impact') {
      return b.maxHailInches - a.maxHailInches;
    }
    return b.date.localeCompare(a.date);
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchValue.trim()) {
      onSearch(searchValue.trim());
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

  return (
    <aside className="w-80 bg-gray-950 text-white flex flex-col border-r border-gray-800 min-h-0">
      {/* Header */}
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <svg
            className="w-5 h-5 text-red-500 flex-shrink-0"
            fill="currentColor"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.547a1 1 0 01.64 1.895l-1.04.354L18 10.17V17a1 1 0 01-1 1H3a1 1 0 01-1-1v-6.83l1.847-3.563-1.04-.354a1 1 0 01.64-1.895l1.599.547L9 4.323V3a1 1 0 011-1z" />
          </svg>
          <div>
            <h1 className="text-lg font-bold tracking-tight">Storm Maps</h1>
            <p className="text-xs text-gray-400">
              Hail Intelligence for Roofing Pros
            </p>
          </div>
        </div>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="p-3 border-b border-gray-800">
        <div className="relative">
          <input
            type="text"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder="Address, city, or ZIP..."
            className="w-full pl-9 pr-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
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
      </form>

      {/* Canvassing Alert Banner */}
      {canvassingAlert?.inHailZone && (
        <div className="mx-3 mt-3 p-3 bg-red-900/60 border border-red-700 rounded-lg">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
            <span className="text-xs font-semibold text-red-300 uppercase tracking-wider">
              Hail Zone Alert
            </span>
          </div>
          <p className="text-sm text-red-100 font-medium">
            {canvassingAlert.estimatedHailSize}"" hail detected nearby
          </p>
          {canvassingAlert.talkingPoints.length > 0 && (
            <p className="text-xs text-red-200 mt-1">
              {canvassingAlert.talkingPoints[0]}
            </p>
          )}
        </div>
      )}

      {/* Tabs */}
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

      {/* Storm Dates List */}
      <div className="flex-1 overflow-y-auto sidebar-scroll min-h-0">
        {loading && (
          <div className="p-4 text-center">
            <div className="inline-block w-5 h-5 border-2 border-gray-600 border-t-red-500 rounded-full animate-spin" />
            <p className="text-xs text-gray-500 mt-2">Loading storm data...</p>
          </div>
        )}

        {error && (
          <div className="m-3 p-3 bg-red-900/30 border border-red-800 rounded-lg">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        {!loading && !error && sortedDates.length === 0 && (
          <div className="p-4 text-center">
            <p className="text-sm text-gray-500">No storm dates found</p>
            <p className="text-xs text-gray-600 mt-1">
              Search a location or enable GPS to find nearby hail events
            </p>
          </div>
        )}

        {sortedDates.map((sd) => (
          <StormDateCard
            key={sd.date}
            stormDate={sd}
            isSelected={selectedDate?.date === sd.date}
            isExpanded={expandedDate === sd.date}
            events={events.filter(
              (e) => e.beginDate.slice(0, 10) === sd.date,
            )}
            onClick={() => handleDateClick(sd)}
            onToggleExpand={(e) => toggleExpand(sd.date, e)}
          />
        ))}
      </div>

      {/* Footer Stats */}
      <div className="p-3 border-t border-gray-800 text-xs text-gray-500">
        <div className="flex justify-between">
          <span>
            {stormDates.length} storm date{stormDates.length !== 1 ? 's' : ''}
          </span>
          <span>{events.length} reports</span>
        </div>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

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
          ? 'text-white border-b-2 border-red-500'
          : 'text-gray-500 hover:text-gray-300'
      }`}
      role="tab"
      aria-selected={active}
    >
      {label}
    </button>
  );
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
          ? 'bg-gray-800/80 border-l-2 border-l-red-500'
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
          {/* Date and severity */}
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
            </div>
          </div>

          {/* Max hail badge */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span
              className="px-1.5 py-0.5 rounded text-xs font-bold"
              style={{
                backgroundColor: severityColor + '20',
                color: severityColor,
              }}
            >
              {stormDate.maxHailInches > 0
                ? `${stormDate.maxHailInches}"`
                : '--'}
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

      {/* Expanded detail */}
      {isExpanded && (
        <div className="px-3 pb-3 border-t border-gray-800/50">
          {dateEvents.length > 0 ? (
            <div className="mt-2 space-y-1.5">
              {dateEvents.slice(0, 10).map((event) => (
                <div
                  key={event.id}
                  className="flex items-center gap-2 text-xs"
                >
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

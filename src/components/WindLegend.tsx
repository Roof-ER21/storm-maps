/**
 * WindLegend — color key for the wind swath layer. Compact, collapsible,
 * sits next to the hail Legend so reps see both palettes side-by-side.
 */

import { useState } from 'react';
import { WIND_BAND_LEVELS } from '../types/windLevels';

interface WindLegendProps {
  /** Total wind reports backing the current swaths (informational). */
  reportCount?: number;
  /** Storm peak gust used in the InfoWindows (informational). */
  maxGustMph?: number;
  /** Hide entirely when wind layer is off. */
  visible?: boolean;
}

export default function WindLegend({
  reportCount,
  maxGustMph,
  visible = true,
}: WindLegendProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (!visible) return null;

  return (
    <div className="absolute bottom-6 right-44 z-10 max-w-[220px]">
      <div className="bg-white/95 backdrop-blur rounded-lg shadow-lg border border-stone-200 overflow-hidden">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-between gap-3 px-3 py-2 hover:bg-stone-100 transition-colors"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand wind legend' : 'Collapse wind legend'}
        >
          <h3 className="text-xs font-semibold text-stone-900 uppercase tracking-wider">
            Wind Gust
          </h3>
          <svg
            className={`w-3 h-3 text-stone-500 transition-transform ${collapsed ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {!collapsed && (
          <div className="px-3 pb-3 space-y-1">
            {WIND_BAND_LEVELS.map((band) => (
              <div key={band.label} className="flex items-center gap-2.5 text-xs">
                <span
                  className="w-3 h-3 rounded-sm flex-shrink-0 border border-white/10"
                  style={{ backgroundColor: band.color }}
                  aria-hidden="true"
                />
                <span className="text-stone-700 flex-1 leading-tight font-mono tabular-nums">
                  {band.label}
                </span>
                <span className="text-stone-400 text-[10px] capitalize">
                  {band.severity.replace('_', ' ')}
                </span>
              </div>
            ))}

            <div className="pt-2 mt-2 border-t border-stone-200 text-[10px] text-stone-500 leading-snug">
              Polygons show areas where SPC/IEM reported gusts at or above the listed mph.
            </div>
            {(reportCount !== undefined || maxGustMph !== undefined) && (
              <div className="text-[10px] text-stone-500">
                {reportCount !== undefined ? `${reportCount} report${reportCount === 1 ? '' : 's'}` : ''}
                {reportCount !== undefined && maxGustMph !== undefined && maxGustMph > 0 ? ' · ' : ''}
                {maxGustMph !== undefined && maxGustMph > 0
                  ? `peak ${Math.round(maxGustMph)} mph`
                  : ''}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

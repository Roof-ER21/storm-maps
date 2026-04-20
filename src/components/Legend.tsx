/**
 * Legend — Hail size color legend for the map.
 *
 * Primary mode ("ihm") shows the IHM-matched forensic hail levels
 * (13 bands: ⅛" through 3"+) that the MRMS vector swath backend emits.
 * Legacy mode ("default")
 * shows the 7 damage-severity bands used by older data sources.
 */

import { useState } from 'react';
import { HAIL_SIZE_CLASSES } from '../types/storm';
import { IHM_HAIL_LEVELS } from '../types/ihmHailLevels';

interface LegendProps {
  /** Which palette to display. Defaults to "ihm" since MRMS vector is primary. */
  mode?: 'ihm' | 'default';
}

export default function Legend({ mode = 'ihm' }: LegendProps) {
  const [collapsed, setCollapsed] = useState(false);

  const title = mode === 'ihm' ? 'Hail Size (MRMS)' : 'Hail Size';

  return (
    <div className="absolute bottom-6 right-4 z-10">
      <div className="bg-white/95 backdrop-blur rounded-lg shadow-lg border border-stone-200 overflow-hidden">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-between gap-3 px-3 py-2 hover:bg-stone-100 transition-colors"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand hail size legend' : 'Collapse hail size legend'}
        >
          <h3 className="text-xs font-semibold text-stone-900 uppercase tracking-wider">
            {title}
          </h3>
          <svg
            className={`w-3 h-3 text-stone-500 transition-transform ${
              collapsed ? 'rotate-180' : ''
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        {!collapsed && (
          <div className="px-3 pb-3 space-y-1">
            {mode === 'ihm'
              ? IHM_HAIL_LEVELS.map((lvl) => (
                  <div
                    key={lvl.sizeInches}
                    className="flex items-center gap-2.5 text-xs"
                  >
                    <span
                      className="w-3 h-3 rounded-sm flex-shrink-0 border border-white/10"
                      style={{ backgroundColor: lvl.color }}
                      aria-hidden="true"
                    />
                    <span className="text-stone-700 flex-1 leading-tight font-mono tabular-nums">
                      {lvl.label}
                    </span>
                    <span className="text-stone-400 text-[10px] capitalize">
                      {lvl.severity.replace('_', ' ')}
                    </span>
                  </div>
                ))
              : HAIL_SIZE_CLASSES.map((cls) => (
                  <div
                    key={cls.reference}
                    className="flex items-center gap-2.5 text-xs"
                  >
                    <span
                      className="w-3 h-3 rounded-sm flex-shrink-0 border border-white/10"
                      style={{ backgroundColor: cls.color }}
                      aria-hidden="true"
                    />
                    <span className="text-stone-700 flex-1 leading-tight">
                      {cls.label}
                    </span>
                    <span className="text-stone-400 font-mono tabular-nums text-[10px]">
                      {cls.maxInches < 99
                        ? `${cls.minInches}-${cls.maxInches}"`
                        : `${cls.minInches}"+`}
                    </span>
                  </div>
                ))}

            {mode === 'ihm' && (
              <div className="pt-2 mt-2 border-t border-stone-200 text-[10px] text-stone-500 leading-snug">
                Polygons show areas where radar-estimated hail was at least the listed size.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

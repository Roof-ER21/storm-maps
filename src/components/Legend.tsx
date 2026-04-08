/**
 * Legend — Hail size color legend for the map.
 *
 * Renders a clean vertical legend in the bottom-right showing
 * all hail size classes with their color indicators and severity.
 */

import { useState } from 'react';
import { HAIL_SIZE_CLASSES } from '../types/storm';

export default function Legend() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="absolute bottom-6 right-4 z-10">
      <div className="bg-white/95 backdrop-blur rounded-lg shadow-lg border border-stone-200 overflow-hidden">
        {/* Header with collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-between px-3 py-2 hover:bg-stone-100 transition-colors"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand hail size legend' : 'Collapse hail size legend'}
        >
          <h3 className="text-xs font-semibold text-stone-900 uppercase tracking-wider">
            Hail Size
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

        {/* Legend items */}
        {!collapsed && (
          <div className="px-3 pb-3 space-y-1.5">
            {HAIL_SIZE_CLASSES.map((cls) => (
              <div
                key={cls.reference}
                className="flex items-center gap-2.5 text-xs group"
              >
                {/* Color swatch */}
                <span
                  className="w-3 h-3 rounded-sm flex-shrink-0 border border-white/10"
                  style={{ backgroundColor: cls.color }}
                  aria-hidden="true"
                />

                {/* Label */}
                <span className="text-stone-700 flex-1 leading-tight">
                  {cls.label}
                </span>

                {/* Size range */}
                <span className="text-stone-400 font-mono tabular-nums text-[10px]">
                  {cls.maxInches < 99
                    ? `${cls.minInches}-${cls.maxInches}"`
                    : `${cls.minInches}"+`}
                </span>
              </div>
            ))}

            {/* Severity scale footer */}
            <div className="pt-2 mt-2 border-t border-stone-200">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-stone-400">Roof Damage</span>
                <div className="flex gap-0.5">
                  {[0, 1, 2, 3, 4, 5].map((level) => (
                    <span
                      key={level}
                      className="w-3 h-1.5 rounded-sm"
                      style={{
                        backgroundColor:
                          HAIL_SIZE_CLASSES.find(
                            (c) => c.damageSeverity === level,
                          )?.color || '#333',
                        opacity: 0.7,
                      }}
                      title={`Severity ${level}/5`}
                    />
                  ))}
                </div>
                <span className="text-[10px] text-stone-400">0-5</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

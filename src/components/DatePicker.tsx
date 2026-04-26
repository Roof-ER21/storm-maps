/**
 * DatePicker — date-of-loss input with quick presets.
 *
 * Native `<input type="date">` underneath so the OS provides the calendar
 * (no chart-library cost, no a11y debt). Presets shave clicks for the most
 * common rep workflows: "today" (canvassing freshest storm), "this week",
 * "last 30/90/365 days". A flat horizontal pill row — no popovers, no
 * floating chrome — keeps the visual surface area small.
 */

import { useMemo, type ReactElement } from 'react';

interface DatePickerProps {
  value: string;
  onChange: (date: string) => void;
  /** Earliest selectable date (default: 6 years ago — covers most insurance windows). */
  min?: string;
  /** Latest selectable date (default: today). */
  max?: string;
  className?: string;
}

function isoOffsetDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const PRESETS: Array<{ label: string; offset: number }> = [
  { label: 'Today', offset: 0 },
  { label: 'Yesterday', offset: -1 },
  { label: '7d', offset: -7 },
  { label: '30d', offset: -30 },
  { label: '90d', offset: -90 },
];

export default function DatePicker({
  value,
  onChange,
  min,
  max,
  className,
}: DatePickerProps): ReactElement {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const sixYearsAgo = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 6);
    return d.toISOString().slice(0, 10);
  }, []);
  const effectiveMax = max ?? today;
  const effectiveMin = min ?? sixYearsAgo;

  return (
    <div className={className}>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={effectiveMin}
        max={effectiveMax}
        className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-200"
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {PRESETS.map((p) => {
          const target = isoOffsetDays(p.offset);
          const active = value === target;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => onChange(target)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                active
                  ? 'border-orange-400 bg-orange-50 text-orange-700'
                  : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:bg-stone-50'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

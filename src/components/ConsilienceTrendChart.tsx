/**
 * ConsilienceTrendChart — per-property storm history strip chart.
 *
 * Plots cached multi-source consilience scores over the last N months. Each
 * data point is one storm date the property was queried for; Y-axis is
 * the number of independent sources that confirmed (0–10). Certified
 * (≥3) shown in green, low-confidence (1–2) in amber, zero in gray.
 *
 * Inline SVG — no chart-library dependency. Hover on dot → tooltip with
 * date + confirmed sources.
 */

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { LatLng } from '../types/storm';

interface HistoryPoint {
  date: string;
  confirmedCount: number;
  /** Configured-source denominator (12 normally, 11 without HailTrace). */
  totalSources: number;
  confidenceTier: string;
  confirmedSources: string[];
}

interface ConsilienceTrendChartProps {
  location: LatLng | null;
  monthsBack?: number;
}

const WIDTH = 720;
const HEIGHT = 180;
const PAD_LEFT = 32;
const PAD_RIGHT = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 32;
const PLOT_W = WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_H = HEIGHT - PAD_TOP - PAD_BOTTOM;

function colorForCount(count: number): string {
  if (count >= 5) return '#059669'; // emerald-600 — strongly certified
  if (count >= 3) return '#10b981'; // emerald-500 — certified
  if (count >= 1) return '#f59e0b'; // amber — low confidence
  return '#9ca3af'; // gray — none
}

function formatShortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
    timeZone: 'America/New_York',
  });
}

export default function ConsilienceTrendChart({
  location,
  monthsBack = 12,
}: ConsilienceTrendChartProps): ReactElement | null {
  const [points, setPoints] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number; pt: HistoryPoint } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!location) {
      // Clear stale points when the property closes; keep-same-ref trick
      // avoids a cascading re-render when the array was already empty.
      setPoints((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(
      `/api/storm/consilience-history?lat=${location.lat}&lng=${location.lng}&monthsBack=${monthsBack}&radius=15`,
    )
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { points?: HistoryPoint[] }) => {
        if (cancelled) return;
        setPoints(data.points ?? []);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setPoints([]);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // location is destructured into lat/lng — the object identity itself
    // can change every render, but the values are what we actually depend on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location?.lat, location?.lng, monthsBack]);

  // Y-axis max = highest totalSources we've seen across the cached points.
  // Pre-12-source rows that fall back to 12 will keep the chart at 12 even
  // when a newer 11-source row (no HailTrace) is present — that's fine.
  const yMax = useMemo(() => {
    if (points.length === 0) return 12;
    return points.reduce((acc, p) => Math.max(acc, p.totalSources || 12), 12);
  }, [points]);

  const projected = useMemo(() => {
    if (points.length === 0) return [];
    const minTs = new Date(points[0].date + 'T12:00:00Z').getTime();
    const maxTs = new Date(points[points.length - 1].date + 'T12:00:00Z').getTime();
    const span = Math.max(1, maxTs - minTs);
    return points.map((p) => {
      const ts = new Date(p.date + 'T12:00:00Z').getTime();
      const xPct = (ts - minTs) / span;
      const yPct = Math.min(1, p.confirmedCount / yMax);
      return {
        ...p,
        x: PAD_LEFT + xPct * PLOT_W,
        y: PAD_TOP + (1 - yPct) * PLOT_H,
      };
    });
  }, [points, yMax]);

  if (!location) return null;

  // Y-axis grid scaled to yMax (0, certified line at 3, midpoints, top).
  const yTicks = [
    { value: 0, label: '0', y: PAD_TOP + PLOT_H },
    { value: 3, label: '3 (certified)', y: PAD_TOP + (1 - 3 / yMax) * PLOT_H },
    {
      value: Math.round(yMax / 2),
      label: String(Math.round(yMax / 2)),
      y: PAD_TOP + (1 - Math.round(yMax / 2) / yMax) * PLOT_H,
    },
    { value: yMax, label: String(yMax), y: PAD_TOP },
  ];

  return (
    <div className="rounded-[28px] border border-stone-200 bg-white p-5">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
            Storm Consilience Trend
          </p>
          <h3 className="mt-2 text-2xl font-semibold text-stone-900">
            {yMax}-source verification by storm date
          </h3>
          <p className="mt-1 text-sm text-stone-500">
            Pre-computed scores across MRMS / SPC / IEM / Wind / Synoptic / mPING /
            NCEI SWDI / NWS / NCEI archive / NEXRAD nx3mda / CoCoRaHS
            {yMax === 12 ? ' / HailTrace' : ''}. Last {monthsBack} months.
          </p>
        </div>
        <div className="text-right">
          {loading ? (
            <p className="text-xs text-stone-400">Loading…</p>
          ) : (
            <p className="text-xs text-stone-500">
              {points.length} cached date{points.length === 1 ? '' : 's'}
            </p>
          )}
        </div>
      </div>

      <div ref={containerRef} className="relative mt-4">
        {loading && points.length === 0 ? (
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            preserveAspectRatio="xMidYMid meet"
            className="w-full animate-pulse"
            role="img"
            aria-label="Loading consilience trend chart"
          >
            {[0.25, 0.5, 0.75, 1].map((f) => (
              <line
                key={f}
                x1={PAD_LEFT}
                x2={PAD_LEFT + PLOT_W}
                y1={PAD_TOP + f * PLOT_H}
                y2={PAD_TOP + f * PLOT_H}
                stroke="#e7e5e4"
                strokeWidth={0.5}
                strokeDasharray="2 2"
              />
            ))}
            {[0.1, 0.3, 0.5, 0.7, 0.9].map((f) => (
              <circle
                key={f}
                cx={PAD_LEFT + f * PLOT_W}
                cy={PAD_TOP + (0.4 + 0.3 * Math.sin(f * 6)) * PLOT_H}
                r={4}
                fill="#d6d3d1"
              />
            ))}
          </svg>
        ) : points.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-stone-200 bg-stone-50 px-4 py-6 text-center text-xs text-stone-500">
            No consilience data cached for this property yet. Open it on the
            map to trigger a live verification query.
          </p>
        ) : (
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            preserveAspectRatio="xMidYMid meet"
            className="w-full"
            role="img"
            aria-label="Consilience trend chart"
          >
            {/* Y-axis grid */}
            {yTicks.map((t) => (
              <g key={t.value}>
                <line
                  x1={PAD_LEFT}
                  x2={PAD_LEFT + PLOT_W}
                  y1={t.y}
                  y2={t.y}
                  stroke={t.value === 3 ? '#10b981' : '#e7e5e4'}
                  strokeWidth={t.value === 3 ? 1 : 0.5}
                  strokeDasharray={t.value === 3 ? '3 3' : '2 2'}
                />
                <text
                  x={PAD_LEFT - 6}
                  y={t.y + 3}
                  textAnchor="end"
                  fontSize="10"
                  fill="#78716c"
                >
                  {t.label}
                </text>
              </g>
            ))}

            {/* Connecting line */}
            {projected.length > 1 && (
              <polyline
                fill="none"
                stroke="#a8a29e"
                strokeWidth="1.5"
                strokeOpacity="0.5"
                points={projected.map((p) => `${p.x},${p.y}`).join(' ')}
              />
            )}

            {/* Dots */}
            {projected.map((p) => (
              <circle
                key={p.date}
                cx={p.x}
                cy={p.y}
                r={p.confirmedCount >= 3 ? 5 : 4}
                fill={colorForCount(p.confirmedCount)}
                stroke="#fff"
                strokeWidth="1.5"
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHover({ x: p.x, y: p.y, pt: p })}
                onMouseLeave={() => setHover(null)}
              />
            ))}

            {/* X-axis date labels — first, mid, last */}
            {projected.length > 0 && (
              <>
                <text
                  x={projected[0].x}
                  y={HEIGHT - 8}
                  textAnchor="start"
                  fontSize="10"
                  fill="#78716c"
                >
                  {formatShortDate(projected[0].date)}
                </text>
                {projected.length > 2 && (
                  <text
                    x={projected[Math.floor(projected.length / 2)].x}
                    y={HEIGHT - 8}
                    textAnchor="middle"
                    fontSize="10"
                    fill="#78716c"
                  >
                    {formatShortDate(projected[Math.floor(projected.length / 2)].date)}
                  </text>
                )}
                <text
                  x={projected[projected.length - 1].x}
                  y={HEIGHT - 8}
                  textAnchor="end"
                  fontSize="10"
                  fill="#78716c"
                >
                  {formatShortDate(projected[projected.length - 1].date)}
                </text>
              </>
            )}
          </svg>
        )}

        {/* Tooltip */}
        {hover && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border border-stone-200 bg-white p-3 shadow-lg"
            style={{
              left: `${(hover.x / WIDTH) * 100}%`,
              top: `${(hover.y / HEIGHT) * 100}%`,
              transform: 'translate(-50%, -110%)',
              minWidth: '200px',
            }}
          >
            <p className="text-xs font-bold text-stone-900">
              {formatShortDate(hover.pt.date)}
            </p>
            <p className="mt-1 text-xs">
              <span
                className="font-semibold"
                style={{ color: colorForCount(hover.pt.confirmedCount) }}
              >
                {hover.pt.confirmedCount}/{hover.pt.totalSources} confirmed
              </span>{' '}
              <span className="text-stone-500">· {hover.pt.confidenceTier}</span>
            </p>
            {hover.pt.confirmedSources.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-[11px] text-stone-600">
                {hover.pt.confirmedSources.map((s) => (
                  <li key={s}>· {s}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Legend */}
        {projected.length > 0 && (
          <div className="mt-3 flex items-center gap-4 text-[11px] text-stone-500">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-600" />
              ≥5 sources
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
              certified (≥3)
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
              1–2 (low confidence)
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-stone-400" />
              0 / unverified
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * ActiveStormsPanel — shows what's firing in the rep's territory RIGHT NOW.
 *
 * Polls /api/storm/live-cells every 90s. Renders:
 *   - Hero state when something is active (red border, max hail size,
 *     NWS warning headlines, MRMS ref time)
 *   - Quiet state with a subtle "no active storms" pill (still shows
 *     so reps know the live engine is alive)
 *
 * The panel is the bridge between the silent push notifications and the
 * UI — when a rep opens the app during a live event they immediately see
 * the truth, without having to drill into the map controls.
 */

import { useEffect, useState, type ReactElement } from 'react';
import { fetchLiveCells, type LiveCellsResponse } from '../services/liveCellsApi';

const POLL_MS = 90_000;

interface ActiveStormsPanelProps {
  /** Optional click handler — could open the map view at the active cell. */
  onOpenLiveMap?: () => void;
}

function formatRefTime(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  return t.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
    timeZoneName: 'short',
  });
}

function bandColor(maxHailIn: number): string {
  if (maxHailIn >= 2.0) return '#7c2d92';
  if (maxHailIn >= 1.5) return '#dc2626';
  if (maxHailIn >= 1.0) return '#ea580c';
  if (maxHailIn >= 0.5) return '#f59e0b';
  return '#fbbf24';
}

export default function ActiveStormsPanel({
  onOpenLiveMap,
}: ActiveStormsPanelProps): ReactElement | null {
  const [data, setData] = useState<LiveCellsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const res = await fetchLiveCells();
      if (cancelled) return;
      setData(res);
      setLoading(false);
    };
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (loading || !data) {
    // Silent during first fetch — we don't want a "loading" pill that
    // distracts when there's actually nothing happening.
    return null;
  }

  if (!data.active) {
    return (
      <div className="mx-3 my-2 flex items-center justify-between gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-[11px] text-stone-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
          Live engine watching · no active storms
        </span>
        <span className="font-mono text-stone-400">
          {formatRefTime(data.mrms.refTime)}
        </span>
      </div>
    );
  }

  const color = bandColor(data.mrms.maxHailInches);
  return (
    <div
      className="mx-3 my-2 rounded-xl border-2 p-3"
      style={{ borderColor: color, backgroundColor: `${color}10` }}
    >
      <div className="flex items-center justify-between gap-2">
        <p
          className="text-[10px] font-bold uppercase tracking-[0.18em]"
          style={{ color }}
        >
          🔴 LIVE STORM ACTIVE
        </p>
        <span className="font-mono text-[10px] text-stone-500">
          {formatRefTime(data.mrms.refTime)}
        </span>
      </div>
      {data.mrms.maxHailInches >= 0.25 && (
        <p
          className="mt-1.5 text-base font-bold"
          style={{ color }}
        >
          {data.mrms.maxHailInches.toFixed(2)}″ hail · {data.mrms.cellCount} cell
          {data.mrms.cellCount === 1 ? '' : 's'}
        </p>
      )}
      {data.nws.count > 0 && (
        <div className="mt-2 space-y-1">
          {data.nws.warnings.slice(0, 3).map((w) => (
            <p key={w.id} className="text-[11px] leading-snug text-stone-700">
              <span className="font-semibold text-red-700">{w.headline.split(' ')[0]} ›</span>{' '}
              {w.areaDesc}{' '}
              {w.maxWindGustMph > 0 && (
                <span className="font-mono text-stone-500">
                  · gust {Math.round(w.maxWindGustMph)} mph
                </span>
              )}
            </p>
          ))}
          {data.nws.count > 3 && (
            <p className="text-[10px] text-stone-500">
              + {data.nws.count - 3} more warnings
            </p>
          )}
        </div>
      )}
      {onOpenLiveMap && (
        <button
          type="button"
          onClick={onOpenLiveMap}
          className="mt-3 w-full rounded-lg bg-white px-3 py-1.5 text-[11px] font-semibold transition-colors hover:bg-stone-50"
          style={{ color, border: `1px solid ${color}` }}
        >
          See it on the map →
        </button>
      )}
    </div>
  );
}

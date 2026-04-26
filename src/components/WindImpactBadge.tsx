/**
 * WindImpactBadge — "Was this address hit by wind?" — peer of the existing
 * AddressImpactBadge for hail. Calls /api/wind/impact and renders direct-hit
 * gust + insurance threshold guidance for the searched property.
 */

import { useEffect, useState } from 'react';
import { fetchWindImpact, type WindImpactResponse } from '../services/windApi';
import type { BoundingBox } from '../types/storm';

interface WindImpactBadgeProps {
  selectedDate: string | null;
  searchLat: number | null;
  searchLng: number | null;
  bounds: BoundingBox | null;
  states?: string[];
  /** When viewing today's storm, also include live SVR centroids. */
  live?: boolean;
  addressLabel: string | null;
}

export default function WindImpactBadge({
  selectedDate,
  searchLat,
  searchLng,
  bounds,
  states,
  live,
  addressLabel,
}: WindImpactBadgeProps) {
  const [data, setData] = useState<WindImpactResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const inputsReady =
    selectedDate !== null &&
    searchLat !== null &&
    searchLng !== null &&
    bounds !== null;

  useEffect(() => {
    if (!inputsReady) return;

    let cancelled = false;
    // Defer the loading flip into a microtask so React doesn't see a
    // synchronous setState-in-effect (which trips react-hooks/set-state-in-effect).
    queueMicrotask(() => {
      if (!cancelled) {
        setLoading(true);
        setData(null);
      }
    });
    fetchWindImpact({
      date: selectedDate as string,
      bounds: bounds as NonNullable<typeof bounds>,
      states,
      live,
      points: [
        {
          id: 'searched-address',
          lat: searchLat as number,
          lng: searchLng as number,
        },
      ],
    })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [inputsReady, selectedDate, searchLat, searchLng, bounds, states, live]);

  if (!inputsReady) return null;

  if (loading) {
    return (
      <div className="mt-3 rounded-2xl border border-stone-200 bg-stone-50 p-3 text-xs text-stone-500">
        Checking wind reports near this address…
      </div>
    );
  }

  if (!data) return null;

  const impact = data.results[0];
  const peak = data.metadata.stormMaxMph;

  if (!impact || !impact.directHit) {
    return (
      <div className="mt-3 rounded-2xl border border-stone-200 bg-white p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
              Wind Impact
            </p>
            <h4 className="mt-0.5 text-sm font-semibold text-stone-700">
              No Wind Hit
            </h4>
            <p className="mt-1 text-[11px] leading-snug text-stone-500">
              No wind reports ≥50 mph at this exact coordinate.
              {peak > 0 && (
                <>
                  {' '}Storm peaked at <strong>{Math.round(peak)} mph</strong> elsewhere.
                </>
              )}
            </p>
            {addressLabel && (
              <p className="mt-1 truncate text-[10px] text-stone-400">{addressLabel}</p>
            )}
          </div>
          <span className="rounded-full bg-stone-100 px-2 py-1 text-[11px] font-bold text-stone-500">
            MISS
          </span>
        </div>
      </div>
    );
  }

  const color = impact.color || '#FF8800';
  const gust = impact.maxGustMph ?? 0;
  const claimWorthy = gust >= 58;
  const severeClaim = gust >= 65;

  return (
    <div
      className="mt-3 rounded-2xl border p-3"
      style={{ borderColor: color, backgroundColor: `${color}15` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p
            className="text-[10px] font-semibold uppercase tracking-[0.18em]"
            style={{ color }}
          >
            Wind Hit
          </p>
          <h4 className="mt-0.5 text-lg font-bold" style={{ color }}>
            ≥ {impact.label}
          </h4>
          <p className="mt-1 text-[11px] text-stone-600">
            Property sits inside a wind-damage swath at or above this gust band.
            {impact.severity && (
              <>
                {' '}Severity: <span className="capitalize">{impact.severity.replace('_', ' ')}</span>.
              </>
            )}
          </p>
          {addressLabel && (
            <p className="mt-1 truncate text-[10px] text-stone-500">{addressLabel}</p>
          )}
          {severeClaim && (
            <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">
              ⚠ Above 3-tab failure threshold — likely supplement scope
            </p>
          )}
          {!severeClaim && claimWorthy && (
            <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-[10px] text-amber-700">
              ⚠ NWS severe-criteria gust — file uplift/blow-off claim
            </p>
          )}
        </div>
        <span
          className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl font-mono text-xs font-bold text-white shadow-sm"
          style={{ backgroundColor: color }}
        >
          {impact.label}
        </span>
      </div>
    </div>
  );
}

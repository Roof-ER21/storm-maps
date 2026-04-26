/**
 * AddressImpactBadge — "Was this address hit by this storm?"
 *
 * Calls /api/hail/storm-impact with the searched property lat/lng and
 * the selected storm date, then renders a colored badge showing the
 * max hail size at that exact coordinate (or "No Direct Hit" + peak-in-area).
 */

import { useEffect, useState } from 'react';
import { fetchStormImpact, type StormImpactResponse } from '../services/mrmsApi';
import type { BoundingBox } from '../types/storm';

interface AddressImpactBadgeProps {
  selectedDate: string | null;
  anchorTimestamp?: string | null;
  searchLat: number | null;
  searchLng: number | null;
  addressLabel: string | null;
  /** Storm bounds — passed to the in-repo MRMS impact endpoint. */
  bounds?: BoundingBox | null;
}

export default function AddressImpactBadge({
  selectedDate,
  anchorTimestamp,
  searchLat,
  searchLng,
  addressLabel,
  bounds,
}: AddressImpactBadgeProps) {
  const [data, setData] = useState<StormImpactResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedDate || searchLat === null || searchLng === null) {
      // Clear stale data when input goes invalid; keep-same-ref so we
      // don't trigger an extra render when data was already null.
      setData((prev) => (prev === null ? prev : null));
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetchStormImpact({
      date: selectedDate,
      anchorTimestamp: anchorTimestamp || null,
      bounds: bounds ?? null,
      points: [{ id: 'searched-address', lat: searchLat, lng: searchLng }],
    })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedDate, anchorTimestamp, searchLat, searchLng, bounds]);

  if (!selectedDate || searchLat === null || searchLng === null) {
    return null;
  }

  if (loading) {
    return (
      <div className="mt-3 rounded-2xl border border-stone-200 bg-stone-50 p-3 text-xs text-stone-500">
        Checking radar for this address…
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const impact = data.results[0];
  const stormPeak = data.metadata.stormMaxInches;

  if (!impact.directHit) {
    return (
      <div className="mt-3 rounded-2xl border border-stone-200 bg-white p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
              Impact at Address
            </p>
            <h4 className="mt-0.5 text-sm font-semibold text-stone-700">
              No Direct Hit
            </h4>
            <p className="mt-1 text-[11px] leading-snug text-stone-500">
              Radar shows no hail-sized echoes at this exact coordinate. Storm peaked
              at <strong>{stormPeak.toFixed(2)}"</strong> elsewhere in the area.
            </p>
            {addressLabel && (
              <p className="mt-1 truncate text-[10px] text-stone-400">
                {addressLabel}
              </p>
            )}
          </div>
          <span className="rounded-full bg-stone-100 px-2 py-1 text-[11px] font-bold text-stone-500">
            MISS
          </span>
        </div>
      </div>
    );
  }

  const color = impact.color || '#ef4444';
  const insuranceCrosses = (impact.maxHailInches ?? 0) >= 1.0;
  const insuranceHigh = (impact.maxHailInches ?? 0) >= 1.75;

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
            Direct Hit
          </p>
          <h4 className="mt-0.5 text-lg font-bold" style={{ color }}>
            {impact.label} hail
          </h4>
          <p className="mt-1 text-[11px] text-stone-600">
            Radar-estimated hail size at this exact coordinate.
            {impact.severity && (
              <> Severity: <span className="capitalize">{impact.severity.replace('_', ' ')}</span>.</>
            )}
          </p>
          {addressLabel && (
            <p className="mt-1 truncate text-[10px] text-stone-500">
              {addressLabel}
            </p>
          )}
          {insuranceHigh && (
            <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">
              ⚠ Above common insurance claim threshold in most states
            </p>
          )}
          {!insuranceHigh && insuranceCrosses && (
            <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-[10px] text-amber-700">
              ⚠ May qualify for insurance claim — verify on-site
            </p>
          )}
        </div>
        <span
          className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl font-mono text-base font-bold text-white shadow-sm"
          style={{ backgroundColor: color }}
        >
          {impact.label}
        </span>
      </div>
    </div>
  );
}

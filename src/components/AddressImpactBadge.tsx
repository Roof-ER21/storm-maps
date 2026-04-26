/**
 * AddressImpactBadge — three-tier storm impact card (DIRECT HIT / NEAR MISS
 * / AREA IMPACT / NO IMPACT) plus a per-tier distance-band breakdown.
 *
 * Mirrors Gemini Field Assistant's tier vocabulary so reps using both
 * products see the same labels and the same "At Property / 1-3mi /
 * 3-5mi / 5-10mi" column structure HailTrace and IHM also use.
 */

import { useEffect, useState } from 'react';
import { fetchStormImpact, type StormImpactResponse, type ImpactTier } from '../services/mrmsApi';
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

const TIER_STYLES: Record<ImpactTier, {
  label: string;
  color: string;
  bg: string;
  border: string;
}> = {
  direct_hit: {
    label: 'DIRECT HIT',
    color: '#dc2626',
    bg: '#fef2f2',
    border: '#fca5a5',
  },
  near_miss: {
    label: 'NEAR MISS',
    color: '#ea580c',
    bg: '#fff7ed',
    border: '#fdba74',
  },
  area_impact: {
    label: 'AREA IMPACT',
    color: '#ca8a04',
    bg: '#fefce8',
    border: '#fde047',
  },
  no_impact: {
    label: 'NO IMPACT',
    color: '#64748b',
    bg: '#f8fafc',
    border: '#cbd5e1',
  },
};

/**
 * Display floor — sub-¼" hail rounded UP to "0.25"" so adjusters don't
 * dismiss "0.13"" trace radar signatures. Matches Gemini Field's
 * Verisk/ISO display convention.
 */
function displaySize(inches: number | null): string {
  if (inches === null) return '—';
  if (inches <= 0) return '—';
  return `${Math.max(0.25, inches).toFixed(2)}"`;
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

    return () => {
      cancelled = true;
    };
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

  if (!data) return null;

  const impact = data.results[0];
  // Pre-tier-classifier fallback: synthesize tier from the legacy fields.
  const tier: ImpactTier =
    impact.tier ??
    (impact.directHit ? 'direct_hit' : impact.nearMiss ? 'near_miss' : 'no_impact');
  const style = TIER_STYLES[tier];
  const bands = impact.bands;
  const stormPeak = data.metadata.stormMaxInches;

  return (
    <div
      className="mt-3 rounded-2xl border p-3.5"
      style={{ borderColor: style.border, backgroundColor: style.bg }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p
            className="text-[10px] font-bold uppercase tracking-[0.18em]"
            style={{ color: style.color }}
          >
            {style.label}
          </p>
          <h4 className="mt-1 text-lg font-bold" style={{ color: style.color }}>
            {tier === 'direct_hit'
              ? `${displaySize(bands?.atProperty ?? impact.maxHailInches)} hail at property`
              : tier === 'near_miss'
                ? `${displaySize(bands?.atProperty ?? null)} hail within 1 mi`
                : tier === 'area_impact'
                  ? `Storm cell within 10 mi · peak ${stormPeak.toFixed(2)}"`
                  : `No verified hail within 10 mi`}
          </h4>
          {addressLabel && (
            <p className="mt-1 truncate text-[10px] text-stone-500">{addressLabel}</p>
          )}
        </div>
        {impact.color && tier === 'direct_hit' && (
          <span
            className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl font-mono text-base font-bold text-white shadow-sm"
            style={{ backgroundColor: impact.color }}
          >
            {impact.label}
          </span>
        )}
      </div>

      {/* Per-tier distance bands — matches the PDF table 1:1. */}
      {bands && tier !== 'no_impact' && (
        <div className="mt-3 grid grid-cols-4 gap-2 rounded-xl bg-white/70 p-2">
          <BandCell label="At Property" sub="0–1 mi" value={bands.atProperty} />
          <BandCell label="1–3 mi" value={bands.mi1to3} />
          <BandCell label="3–5 mi" value={bands.mi3to5} />
          <BandCell label="5–10 mi" value={bands.mi5to10} />
        </div>
      )}
    </div>
  );
}

function BandCell({
  label,
  sub,
  value,
}: {
  label: string;
  sub?: string;
  value: number | null;
}) {
  const filled = value !== null && value > 0;
  return (
    <div className="text-center">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-stone-500">
        {label}
      </p>
      {sub && <p className="text-[9px] text-stone-400">{sub}</p>}
      <p
        className={`mt-1 text-sm font-bold tabular-nums ${
          filled ? 'text-stone-900' : 'text-stone-300'
        }`}
      >
        {filled ? `${Math.max(0.25, value).toFixed(2)}"` : '—'}
      </p>
    </div>
  );
}

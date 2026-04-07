import { useCallback, useEffect, useRef, useState } from 'react';
import { analyzeProperty, getAnalysis } from '../services/aiApi';
import { createShareableReport } from '../services/api';
import type {
  AnalysisMode,
  AnalysisStatus,
  ConditionRating,
  DamageIndicator,
  PropertyAnalysis,
  PropertyImage,
  RoofType,
  SidingType,
} from '../types/analysis';

// ── Props ─────────────────────────────────────────────────────────────────────

interface AiSlideOverProps {
  open: boolean;
  onClose: () => void;
  initialAddress?: string;
  initialMode?: AnalysisMode;
  onAddToPipeline?: (analysis: PropertyAnalysis) => void;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

const ROOF_LABELS: Record<RoofType, string> = {
  three_tab_shingle:      '3-Tab Shingle',
  architectural_shingle:  'Architectural Shingle',
  designer_shingle:       'Designer Shingle',
  wood_shake:             'Wood Shake',
  synthetic_shake:        'Synthetic Shake',
  metal_standing_seam:    'Metal Standing Seam',
  metal_ribbed:           'Metal Ribbed',
  tile_clay:              'Clay Tile',
  tile_concrete:          'Concrete Tile',
  slate:                  'Slate',
  flat_membrane:          'Flat / Membrane',
  unknown:                'Unknown',
};

const SIDING_LABELS: Record<SidingType, string> = {
  aluminum:     'Aluminum',
  vinyl:        'Vinyl',
  wood:         'Wood',
  fiber_cement: 'Fiber Cement',
  brick:        'Brick',
  stone:        'Stone',
  stucco:       'Stucco',
  composite:    'Composite',
  unknown:      'Unknown',
};

function fmtRoof(type: RoofType | null): string {
  if (!type) return 'Unknown';
  return ROOF_LABELS[type] ?? type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtSiding(type: SidingType | null): string {
  if (!type) return 'Unknown';
  return SIDING_LABELS[type] ?? type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtCondition(c: ConditionRating | null): string {
  if (!c || c === 'unknown') return 'Unknown';
  return c.charAt(0).toUpperCase() + c.slice(1);
}

function conditionColor(c: ConditionRating | null): string {
  switch (c) {
    case 'excellent': return 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30';
    case 'good':      return 'text-sky-400 bg-sky-500/15 border-sky-500/30';
    case 'fair':      return 'text-amber-400 bg-amber-500/15 border-amber-500/30';
    case 'poor':      return 'text-orange-400 bg-orange-500/15 border-orange-500/30';
    case 'critical':  return 'text-red-400 bg-red-500/15 border-red-500/30';
    default:          return 'text-gray-500 bg-zinc-800/50 border-zinc-700/50';
  }
}

function statusToLabel(status: AnalysisStatus): string {
  switch (status) {
    case 'geocoding':       return 'Geocoding address...';
    case 'fetching_images': return 'Fetching satellite & street view...';
    case 'analyzing':       return 'AI is analyzing the property...';
    case 'pending':         return 'Queued...';
    case 'completed':       return 'Complete';
    case 'failed':          return 'Failed';
  }
}

function scoreConfig(score: number): {
  ring: string; glow: string; label: string; text: string; bg: string;
} {
  if (score >= 60) return {
    ring:  'border-red-400/60',
    glow:  'shadow-[0_0_32px_rgba(248,113,113,0.3)]',
    label: 'High Priority',
    text:  'text-red-400',
    bg:    'bg-red-500/10',
  };
  if (score >= 40) return {
    ring:  'border-amber-400/60',
    glow:  'shadow-[0_0_32px_rgba(251,191,36,0.25)]',
    label: 'Medium Priority',
    text:  'text-amber-400',
    bg:    'bg-amber-500/10',
  };
  return {
    ring:  'border-emerald-400/60',
    glow:  'shadow-[0_0_32px_rgba(52,211,153,0.25)]',
    label: 'Low Priority',
    text:  'text-emerald-400',
    bg:    'bg-emerald-500/10',
  };
}

function damageBadgeClass(severity: DamageIndicator['severity']): string {
  switch (severity) {
    case 'severe':   return 'bg-red-500/20 border-red-500/40 text-red-300';
    case 'moderate': return 'bg-amber-500/20 border-amber-500/40 text-amber-300';
    default:         return 'bg-sky-500/20 border-sky-500/40 text-sky-300';
  }
}

function formatCaptureDate(date: string | null | undefined): string | null {
  if (!date) return null;
  const [year, month] = date.split('-');
  if (!year || !month) return date;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(month, 10) - 1]} ${year}`;
}

const MODES: Array<{ id: AnalysisMode; label: string; desc: string }> = [
  { id: 'retail',    label: 'Retail',    desc: 'Upgrade opportunity & replacement pitch' },
  { id: 'insurance', label: 'Insurance', desc: 'Storm damage & claim potential' },
  { id: 'solar',     label: 'Solar',     desc: 'Solar suitability & candidate rating' },
];

// ── Pulsing dot status indicator ──────────────────────────────────────────────

function PulsingDot() {
  return (
    <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-60" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-violet-500" />
    </span>
  );
}

// ── Confidence bar ────────────────────────────────────────────────────────────

function ConfidenceBar({ value }: { value: number | null }) {
  const pct = value === null ? 0 : Math.round(Math.max(0, Math.min(1, value)) * 100);
  const color =
    pct >= 75 ? 'bg-emerald-500' :
    pct >= 50 ? 'bg-amber-500' :
    'bg-red-500';
  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wide text-gray-500">Confidence</span>
        <span className="text-xs font-semibold text-gray-400">{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── SVG icons ─────────────────────────────────────────────────────────────────

function IconClose() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function IconHome() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l9-9 9 9M5 10v9a1 1 0 001 1h4v-5h4v5h4a1 1 0 001-1v-9" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="11" cy="11" r="8" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35" />
    </svg>
  );
}

function IconBrain() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M9.663 17h4.673M12 3c-4.418 0-7 2.91-7 6.5 0 1.83.72 3.48 1.88 4.67A2.5 2.5 0 007.5 16.5V18a1 1 0 001 1h7a1 1 0 001-1v-1.5a2.5 2.5 0 00.62-2.33C18.28 12.98 19 11.33 19 9.5 19 5.91 16.418 3 12 3z" />
    </svg>
  );
}

function IconRoof() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l9-9 9 9" />
      <rect x="5" y="12" width="14" height="8" rx="1" />
    </svg>
  );
}

function IconWall() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path strokeLinecap="round" d="M3 9h18M3 15h18M9 3v6M15 9v6M9 15v6" />
    </svg>
  );
}

function IconWarning() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  );
}

function IconShare() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
    </svg>
  );
}

// ── Property images grid ──────────────────────────────────────────────────────

function PropertyImages({
  analysis,
  images,
}: {
  analysis: PropertyAnalysis;
  images: PropertyImage[];
}) {
  const streetImg = images.find((i) => i.imageType === 'street_view');
  const satImg    = images.find((i) => i.imageType === 'satellite');

  const streetSrc = streetImg
    ? `data:${streetImg.mimeType};base64,${streetImg.imageData}`
    : (analysis.streetViewUrl ?? null);
  const satSrc = satImg
    ? `data:${satImg.mimeType};base64,${satImg.imageData}`
    : (analysis.satelliteUrl ?? null);

  const streetDate = formatCaptureDate(streetImg?.captureDate ?? analysis.streetViewDate);
  const satDate    = formatCaptureDate(satImg?.captureDate ?? null);

  const slots: Array<{ src: string | null; label: string; date: string | null }> = [
    { src: streetSrc, label: 'Street View', date: streetDate },
    { src: satSrc,    label: 'Satellite',   date: satDate },
  ];

  if (!streetSrc && !satSrc) return null;

  return (
    <div className="grid grid-cols-2 gap-2.5">
      {slots.map(({ src, label, date }) =>
        src ? (
          <div key={label} className="relative overflow-hidden rounded-xl border border-zinc-800/60">
            <div className="aspect-video w-full">
              <img
                src={src}
                alt={label}
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).closest('div.aspect-video')?.classList.add('hidden');
                }}
              />
            </div>
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-zinc-950/90 to-transparent px-3 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                {label}
              </span>
            </div>
            {date && (
              <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white/80">
                {date}
              </span>
            )}
          </div>
        ) : null,
      )}
    </div>
  );
}

// ── Score strip ───────────────────────────────────────────────────────────────

function ScoreStrip({
  analysis,
}: {
  analysis: PropertyAnalysis;
}) {
  const hasRoof   = analysis.roofType !== null || analysis.roofCondition !== null;
  const hasSiding = analysis.sidingType !== null || analysis.sidingCondition !== null;

  return (
    <div className="flex flex-wrap items-stretch gap-2.5">
      {/* Prospect score */}
      {analysis.prospectScore !== null && (() => {
        const cfg = scoreConfig(analysis.prospectScore);
        return (
          <div
            className={`flex flex-col items-center justify-center rounded-xl border ${cfg.ring} ${cfg.glow} ${cfg.bg} px-4 py-3 min-w-[88px]`}
          >
            <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-gray-500">Score</span>
            <span className={`text-3xl font-black tabular-nums leading-none ${cfg.text}`}>
              {analysis.prospectScore}
            </span>
            <span className={`mt-1 text-[9px] font-semibold uppercase tracking-wider ${cfg.text}`}>
              {cfg.label}
            </span>
          </div>
        );
      })()}

      {/* Roof card */}
      {hasRoof && (
        <div className="flex flex-1 flex-col justify-between rounded-xl border border-zinc-800/60 bg-zinc-900/80 px-3.5 py-3 min-w-[110px]">
          <div className="flex items-center gap-1.5 text-gray-500">
            <IconRoof />
            <span className="text-[9px] font-semibold uppercase tracking-widest">Roof</span>
          </div>
          <p className="mt-1.5 text-xs font-semibold text-white leading-tight">
            {fmtRoof(analysis.roofType)}
          </p>
          {analysis.roofCondition && (
            <span
              className={`mt-1.5 inline-flex w-fit rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${conditionColor(analysis.roofCondition)}`}
            >
              {fmtCondition(analysis.roofCondition)}
            </span>
          )}
          {analysis.roofAgeEstimate !== null && (
            <p className="mt-1 text-[10px] text-gray-500">
              Est. {analysis.roofAgeEstimate} yrs
            </p>
          )}
          <ConfidenceBar value={analysis.roofConfidence} />
        </div>
      )}

      {/* Siding card */}
      {hasSiding && (
        <div className="flex flex-1 flex-col justify-between rounded-xl border border-zinc-800/60 bg-zinc-900/80 px-3.5 py-3 min-w-[110px]">
          <div className="flex items-center gap-1.5 text-gray-500">
            <IconWall />
            <span className="text-[9px] font-semibold uppercase tracking-widest">Siding</span>
          </div>
          <p className="mt-1.5 text-xs font-semibold text-white leading-tight">
            {fmtSiding(analysis.sidingType)}
          </p>
          {analysis.sidingCondition && (
            <span
              className={`mt-1.5 inline-flex w-fit rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${conditionColor(analysis.sidingCondition)}`}
            >
              {fmtCondition(analysis.sidingCondition)}
            </span>
          )}
          {analysis.isAluminumSiding && (
            <p className="mt-1 text-[10px] text-amber-500/80">Aluminum detected</p>
          )}
          <ConfidenceBar value={analysis.sidingConfidence} />
        </div>
      )}
    </div>
  );
}

// ── Damage table ──────────────────────────────────────────────────────────────

function DamageTable({ indicators }: { indicators: DamageIndicator[] }) {
  if (indicators.length === 0) return null;
  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/80 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800/60 text-amber-400">
        <IconWarning />
        <span className="text-[10px] font-semibold uppercase tracking-widest">Damage Indicators</span>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-800/40">
            <th className="px-4 py-2 text-left text-[9px] font-semibold uppercase tracking-widest text-gray-600">Type</th>
            <th className="px-4 py-2 text-left text-[9px] font-semibold uppercase tracking-widest text-gray-600">Severity</th>
            <th className="px-4 py-2 text-left text-[9px] font-semibold uppercase tracking-widest text-gray-600">Location</th>
          </tr>
        </thead>
        <tbody>
          {indicators.map((d, i) => (
            <tr key={`${d.type}-${i}`} className="border-b border-zinc-800/30 last:border-0">
              <td className="px-4 py-2.5 capitalize text-gray-300">
                {d.type.replace(/_/g, ' ')}
              </td>
              <td className="px-4 py-2.5">
                <span
                  className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${damageBadgeClass(d.severity)}`}
                >
                  {d.severity}
                </span>
              </td>
              <td className="px-4 py-2.5 text-gray-500 capitalize">{d.location}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Mode-specific insights ────────────────────────────────────────────────────

function ModeInsights({
  analysis,
  mode,
}: {
  analysis: PropertyAnalysis;
  mode: AnalysisMode;
}) {
  const raw = analysis.aiRawResponse;
  if (!raw) return null;

  const entries: Array<{ label: string; value: string | string[] }> = [];

  if (mode === 'retail') {
    const upgrade = raw.upgradeOpportunity ?? raw.upgrade_opportunity;
    if (upgrade) entries.push({ label: 'Upgrade Opportunity', value: String(upgrade) });

    const cross = raw.crossSellPotential ?? raw.cross_sell_potential;
    if (cross) entries.push({ label: 'Cross-Sell Potential', value: String(cross) });

    const points = raw.talkingPoints ?? raw.talking_points;
    if (Array.isArray(points) && points.length > 0) {
      entries.push({ label: 'Talking Points', value: points.map(String) });
    } else if (typeof points === 'string' && points) {
      entries.push({ label: 'Talking Points', value: points });
    }
  }

  if (mode === 'insurance') {
    const claim = raw.claimPotential ?? raw.claim_potential;
    if (claim) entries.push({ label: 'Claim Potential', value: String(claim) });

    const dmgTypes = raw.visibleDamageTypes ?? raw.visible_damage_types;
    if (Array.isArray(dmgTypes) && dmgTypes.length > 0) {
      entries.push({ label: 'Visible Damage Types', value: dmgTypes.map(String) });
    } else if (typeof dmgTypes === 'string' && dmgTypes) {
      entries.push({ label: 'Visible Damage Types', value: dmgTypes });
    }

    const supps = raw.supplementItems ?? raw.supplement_items;
    if (Array.isArray(supps) && supps.length > 0) {
      entries.push({ label: 'Supplement Items', value: supps.map(String) });
    } else if (typeof supps === 'string' && supps) {
      entries.push({ label: 'Supplement Items', value: supps });
    }
  }

  if (mode === 'solar') {
    const candidate = raw.solarCandidate ?? raw.solar_candidate ?? raw.solarCandidateRating ?? raw.solar_candidate_rating;
    if (candidate) entries.push({ label: 'Solar Candidate', value: String(candidate) });

    const panels = raw.estimatedPanelCount ?? raw.estimated_panel_count;
    if (panels !== undefined && panels !== null) {
      entries.push({ label: 'Estimated Panel Count', value: String(panels) });
    }

    const points = raw.talkingPoints ?? raw.talking_points;
    if (Array.isArray(points) && points.length > 0) {
      entries.push({ label: 'Talking Points', value: points.map(String) });
    } else if (typeof points === 'string' && points) {
      entries.push({ label: 'Talking Points', value: points });
    }
  }

  if (entries.length === 0) return null;

  const modeLabel = MODES.find((m) => m.id === mode)?.label ?? mode;

  return (
    <div className="rounded-xl border border-violet-500/25 bg-violet-500/[0.05] p-4">
      <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-violet-300/80 mb-3">
        {modeLabel} Insights
      </p>
      <div className="flex flex-col gap-2">
        {entries.map(({ label, value }) => (
          <div
            key={label}
            className="rounded-xl border border-zinc-800/50 bg-zinc-950/60 px-3.5 py-2.5"
          >
            <p className="text-[9px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
            {Array.isArray(value) ? (
              <ul className="mt-1 flex flex-col gap-0.5 list-none">
                {value.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-1.5 text-xs text-gray-200">
                    <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-violet-400/60" />
                    {item}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-gray-200">{value}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Full results section ──────────────────────────────────────────────────────

function AnalysisResults({
  analysis,
  images,
  mode,
}: {
  analysis: PropertyAnalysis;
  images: PropertyImage[];
  mode: AnalysisMode;
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* Address header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-violet-300/80">
            Analysis Complete
          </p>
          <p className="mt-0.5 truncate text-sm font-semibold text-white">
            {analysis.normalizedAddress ?? analysis.inputAddress}
          </p>
        </div>
        <span className="flex-shrink-0 rounded-full border border-violet-500/30 bg-violet-500/15 px-2.5 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-violet-300 capitalize">
          {mode}
        </span>
      </div>

      {/* Images */}
      <PropertyImages analysis={analysis} images={images} />

      {/* Score strip */}
      <ScoreStrip analysis={analysis} />

      {/* Damage */}
      {analysis.damageIndicators.length > 0 && (
        <DamageTable indicators={analysis.damageIndicators} />
      )}

      {/* Reasoning */}
      {analysis.reasoning && (
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/80 p-4">
          <div className="flex items-center gap-2 text-violet-400 mb-3">
            <IconBrain />
            <span className="text-[10px] font-semibold uppercase tracking-widest">AI Reasoning</span>
          </div>
          <p className="text-sm leading-6 text-gray-300">{analysis.reasoning}</p>
        </div>
      )}

      {/* Mode insights */}
      <ModeInsights analysis={analysis} mode={mode} />
    </div>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function LoadingSkeleton({ status }: { status: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={status}
      className="flex flex-col gap-5 px-5 py-6"
    >
      {/* Status row */}
      <div className="flex items-center gap-3 rounded-xl border border-zinc-800/60 bg-zinc-900/80 px-4 py-3.5">
        <PulsingDot />
        <p className="text-sm font-medium text-white">{status}</p>
      </div>

      {/* Image skeleton */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="aspect-video w-full animate-pulse rounded-xl bg-zinc-800/60" />
        <div className="aspect-video w-full animate-pulse rounded-xl bg-zinc-800/60" />
      </div>

      {/* Score / card skeleton */}
      <div className="flex gap-2.5">
        <div className="h-24 w-24 animate-pulse rounded-xl bg-zinc-800/60" />
        <div className="flex-1 animate-pulse rounded-xl bg-zinc-800/60" />
        <div className="flex-1 animate-pulse rounded-xl bg-zinc-800/60" />
      </div>

      {/* Text lines */}
      <div className="flex flex-col gap-2">
        <div className="h-3 w-3/4 animate-pulse rounded bg-zinc-800/60" />
        <div className="h-3 w-full animate-pulse rounded bg-zinc-800/60" />
        <div className="h-3 w-5/6 animate-pulse rounded bg-zinc-800/60" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-zinc-800/60" />
      </div>

      <p className="text-center text-xs text-gray-600">This usually takes 10–20 seconds</p>
    </div>
  );
}

// ── Main slide-over ───────────────────────────────────────────────────────────

export default function AiSlideOver({
  open,
  onClose,
  initialAddress,
  initialMode = 'retail',
  onAddToPipeline,
}: AiSlideOverProps) {
  const [address, setAddress]               = useState(initialAddress ?? '');
  const [mode, setMode]                     = useState<AnalysisMode>(initialMode);
  const [loading, setLoading]               = useState(false);
  const [loadingStatus, setLoadingStatus]   = useState('Starting...');
  const [error, setError]                   = useState<string | null>(null);
  const [analysis, setAnalysis]             = useState<PropertyAnalysis | null>(null);
  const [images, setImages]                 = useState<PropertyImage[]>([]);
  const [committedMode, setCommittedMode]   = useState<AnalysisMode>(initialMode);
  const [sharing, setSharing]               = useState(false);
  const [shared, setShared]                 = useState(false);

  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputRef   = useRef<HTMLInputElement>(null);
  const panelRef   = useRef<HTMLDivElement>(null);

  // ── Sync initial props when they change (e.g., opened from map pin) ─────────
  useEffect(() => {
    if (open) {
      if (initialAddress !== undefined) setAddress(initialAddress);
      if (initialMode !== undefined)    setMode(initialMode);
    }
  }, [open, initialAddress, initialMode]);

  // ── Focus input on open ──────────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 310);
      return () => clearTimeout(t);
    }
  }, [open]);

  // ── Escape key to close ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // ── Lock body scroll while open ──────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // ── Polling helpers ──────────────────────────────────────────────────────────
  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => { stopPolling(); }, [stopPolling]);

  const startPolling = useCallback(
    (id: string, resolvedMode: AnalysisMode) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const result = await getAnalysis(id);
          setLoadingStatus(statusToLabel(result.analysis.status));

          if (result.analysis.status === 'completed') {
            stopPolling();
            setAnalysis(result.analysis);
            setImages(result.images);
            setCommittedMode(resolvedMode);
            setLoading(false);
          } else if (result.analysis.status === 'failed') {
            stopPolling();
            setError(result.analysis.errorMessage ?? 'Analysis failed. Please try again.');
            setLoading(false);
          }
        } catch (err) {
          stopPolling();
          setError(err instanceof Error ? err.message : 'Failed to fetch analysis status.');
          setLoading(false);
        }
      }, 2000);
    },
    [stopPolling],
  );

  // ── Submit handler ───────────────────────────────────────────────────────────
  const handleAnalyze = useCallback(async () => {
    const trimmed = address.trim();
    if (!trimmed) return;

    stopPolling();
    setError(null);
    setAnalysis(null);
    setImages([]);
    setLoading(true);
    setLoadingStatus('Starting...');

    const resolvedMode = mode;

    try {
      const result = await analyzeProperty(trimmed, resolvedMode);
      setLoadingStatus(statusToLabel(result.status));

      if (result.status === 'completed') {
        const full = await getAnalysis(result.id);
        setAnalysis(full.analysis);
        setImages(full.images);
        setCommittedMode(resolvedMode);
        setLoading(false);
      } else if (result.status === 'failed') {
        setError(result.errorMessage ?? 'Analysis failed immediately. Please try again.');
        setLoading(false);
      } else {
        startPolling(result.id, resolvedMode);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to start analysis. Check your connection.',
      );
      setLoading(false);
    }
  }, [address, mode, startPolling, stopPolling]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !loading) handleAnalyze();
    },
    [handleAnalyze, loading],
  );

  const handleClose = useCallback(() => {
    stopPolling();
    onClose();
  }, [stopPolling, onClose]);

  const handleAddToPipeline = useCallback(() => {
    if (analysis && onAddToPipeline) {
      onAddToPipeline(analysis);
    }
  }, [analysis, onAddToPipeline]);

  const handleShare = useCallback(async () => {
    if (!analysis || sharing) return;

    setSharing(true);
    try {
      const stormVal = analysis.aiRawResponse?.storm;
      const maxHailInches =
        typeof stormVal === 'number' ? stormVal : 0;

      const result = await createShareableReport({
        address:       analysis.inputAddress,
        lat:           analysis.lat ?? 0,
        lng:           analysis.lng ?? 0,
        stormDate:     new Date().toISOString().slice(0, 10),
        stormLabel:    'AI Property Analysis',
        maxHailInches,
        maxWindMph:    0,
        eventCount:    analysis.damageIndicators.length,
        repName:       import.meta.env.VITE_REP_NAME    ?? '',
        repPhone:      import.meta.env.VITE_REP_PHONE   ?? '',
        companyName:   import.meta.env.VITE_COMPANY_NAME ?? '',
        homeownerName: '',
      });

      if (!result) {
        throw new Error('Failed to create shareable report.');
      }

      await navigator.clipboard.writeText(window.location.origin + result.url);
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not create share link.',
      );
    } finally {
      setSharing(false);
    }
  }, [analysis, sharing]);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Backdrop ──────────────────────────────────────────────────────── */}
      <div
        aria-hidden="true"
        onClick={handleClose}
        className={[
          'fixed inset-0 z-40 bg-black/50 backdrop-blur-sm',
          'transition-opacity duration-300',
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        ].join(' ')}
      />

      {/* ── Panel ─────────────────────────────────────────────────────────── */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="AI Property Intel"
        className={[
          // Base layout
          'fixed inset-y-0 right-0 z-50 flex flex-col',
          'w-full max-w-lg',
          'bg-zinc-950 border-l border-zinc-800 shadow-2xl',
          'overflow-y-auto',
          // Mobile: full screen, no left border
          'max-sm:inset-0 max-sm:max-w-none max-sm:border-l-0',
          // Slide animation
          'transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
      >
        {/* ── Mobile drag handle ──────────────────────────────────────────── */}
        <div className="sm:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="h-1 w-10 rounded-full bg-zinc-700" />
        </div>

        {/* ── Sticky header ───────────────────────────────────────────────── */}
        <header className="sticky top-0 z-10 flex-shrink-0 bg-zinc-950/95 backdrop-blur border-b border-zinc-800/60 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(180deg,rgba(124,58,237,0.3),rgba(249,115,22,0.22))] text-violet-300 ring-1 ring-violet-400/20">
                <IconBrain />
              </div>
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-violet-300/80">
                  Hail Yes
                </p>
                <h2 className="text-base font-semibold tracking-tight text-white leading-tight">
                  AI Property Intel
                </h2>
              </div>
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close panel"
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-gray-400 transition hover:bg-zinc-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60"
            >
              <IconClose />
            </button>
          </div>
        </header>

        {/* ── Scrollable body ─────────────────────────────────────────────── */}
        <div className="flex-1 min-h-0">

          {/* ── Search form ─────────────────────────────────────────────── */}
          <div className="px-5 pt-5 pb-4 border-b border-zinc-800/40">
            {/* Address input */}
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gray-500">
                Property Address
              </span>
              <div className="relative mt-1.5">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                  <IconHome />
                </span>
                <input
                  ref={inputRef}
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="123 Main St, Anytown, VA 20001"
                  disabled={loading}
                  aria-label="Property address"
                  className="w-full rounded-xl border border-zinc-700/60 bg-zinc-900/80 py-2.5 pl-9 pr-4 text-sm text-white placeholder-gray-600 outline-none transition focus:border-violet-500/60 focus:ring-1 focus:ring-violet-500/30 disabled:opacity-50"
                />
              </div>
            </label>

            {/* Mode segmented control */}
            <div className="mt-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gray-500 mb-1.5">
                Analysis Mode
              </p>
              <div className="flex gap-1.5">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMode(m.id)}
                    disabled={loading}
                    aria-pressed={mode === m.id}
                    title={m.desc}
                    className={[
                      'flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition-all',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60',
                      'disabled:opacity-50',
                      mode === m.id
                        ? 'bg-violet-600 text-white shadow-[0_0_16px_rgba(124,58,237,0.4)]'
                        : 'bg-zinc-800/80 text-gray-400 hover:bg-zinc-700 hover:text-white',
                    ].join(' ')}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Analyze button */}
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={loading || !address.trim()}
              aria-busy={loading}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_0_20px_rgba(249,115,22,0.3)] transition hover:from-orange-600 hover:to-violet-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/60 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
            >
              {loading ? (
                <>
                  <PulsingDot />
                  <span>{loadingStatus}</span>
                </>
              ) : (
                <>
                  <IconSearch />
                  <span>Analyze Property</span>
                </>
              )}
            </button>
          </div>

          {/* ── Error ───────────────────────────────────────────────────── */}
          {error && !loading && (
            <div
              role="alert"
              className="mx-5 mt-4 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/[0.07] px-4 py-3.5"
            >
              <div className="mt-0.5 flex-shrink-0 text-red-400">
                <IconWarning />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-red-300">Analysis Failed</p>
                <p className="mt-0.5 text-xs leading-5 text-red-400/80">{error}</p>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-300 hover:bg-red-500/20 transition"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* ── Loading skeleton ────────────────────────────────────────── */}
          {loading && <LoadingSkeleton status={loadingStatus} />}

          {/* ── Results ─────────────────────────────────────────────────── */}
          {analysis && !loading && (
            <div className="px-5 py-5">
              <AnalysisResults
                analysis={analysis}
                images={images}
                mode={committedMode}
              />
            </div>
          )}

          {/* ── Empty state ─────────────────────────────────────────────── */}
          {!analysis && !loading && !error && (
            <div className="flex flex-col items-center gap-3 py-14 px-5 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-800/60 text-gray-500">
                <IconBrain />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-400">No analysis yet</p>
                <p className="mt-1 text-xs text-gray-600 max-w-[220px]">
                  Enter an address above and choose a mode to get started.
                </p>
              </div>
            </div>
          )}

          {/* Spacer so footer does not overlap last card when at bottom */}
          {analysis && !loading && <div className="h-24" />}
        </div>

        {/* ── Sticky footer ───────────────────────────────────────────────── */}
        {analysis && !loading && (
          <footer className="sticky bottom-0 z-10 flex-shrink-0 bg-zinc-950/95 backdrop-blur border-t border-zinc-800/60 px-5 py-4">
            <div className="flex items-center gap-2.5">
              {/* Add to pipeline */}
              {onAddToPipeline && (
                <button
                  type="button"
                  onClick={handleAddToPipeline}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_0_20px_rgba(249,115,22,0.28)] transition hover:from-orange-600 hover:to-violet-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/60"
                >
                  <IconPlus />
                  <span>Add to Pipeline</span>
                </button>
              )}

              {/* Share report */}
              <button
                type="button"
                onClick={handleShare}
                disabled={sharing}
                aria-label={shared ? 'Link copied' : 'Share report'}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-zinc-700/60 bg-zinc-900/80 px-3.5 py-2.5 text-sm font-semibold text-gray-400 transition hover:border-zinc-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60"
              >
                <IconShare />
                <span className="hidden sm:inline">
                  {sharing ? 'Sharing…' : shared ? 'Copied!' : 'Share'}
                </span>
              </button>

              {/* Close */}
              <button
                type="button"
                onClick={handleClose}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-zinc-700/60 bg-zinc-900/80 px-3.5 py-2.5 text-sm font-semibold text-gray-400 transition hover:bg-zinc-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60"
                aria-label="Close panel"
              >
                <IconClose />
                <span className="hidden sm:inline">Close</span>
              </button>
            </div>
          </footer>
        )}
      </div>
    </>
  );
}

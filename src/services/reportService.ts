import type {
  EvidenceItem,
  ReportEvidenceItem,
  ReportHistoryRange,
  StormEvent,
} from '../types/storm';
import type {
  PropertyAnalysis,
  RoofType,
  SidingType,
  ConditionRating,
  DamageIndicator,
} from '../types/analysis';
import { HAIL_YES_HAIL_API_BASE } from './backendConfig';
import { toEasternDateKey } from './dateUtils';

// ============================================================
// AI analysis formatting helpers
// ============================================================

const ROOF_TYPE_LABELS: Record<RoofType, string> = {
  three_tab_shingle: '3-Tab Shingle',
  architectural_shingle: 'Architectural Shingle',
  designer_shingle: 'Designer Shingle',
  wood_shake: 'Wood Shake',
  synthetic_shake: 'Synthetic Shake',
  metal_standing_seam: 'Metal — Standing Seam',
  metal_ribbed: 'Metal — Ribbed Panel',
  tile_clay: 'Clay Tile',
  tile_concrete: 'Concrete Tile',
  slate: 'Slate',
  flat_membrane: 'Flat / Membrane',
  unknown: 'Unknown',
};

const SIDING_TYPE_LABELS: Record<SidingType, string> = {
  aluminum: 'Aluminum',
  vinyl: 'Vinyl',
  wood: 'Wood',
  fiber_cement: 'Fiber Cement',
  brick: 'Brick',
  stone: 'Stone',
  stucco: 'Stucco',
  composite: 'Composite',
  unknown: 'Unknown',
};

const CONDITION_LABELS: Record<ConditionRating, string> = {
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
  critical: 'Critical',
  unknown: 'Unknown',
};

function formatRoofType(value: RoofType | null): string {
  return value ? (ROOF_TYPE_LABELS[value] ?? value) : 'Not assessed';
}

function formatSidingType(value: SidingType | null): string {
  return value ? (SIDING_TYPE_LABELS[value] ?? value) : 'Not assessed';
}

function formatCondition(value: ConditionRating | null): string {
  return value ? (CONDITION_LABELS[value] ?? value) : 'Not assessed';
}

function formatScore(value: number | null): string {
  return value !== null ? `${value}/100` : 'N/A';
}

function buildDamageIndicatorRows(indicators: DamageIndicator[]): string {
  return indicators
    .map(
      (d) => `
        <tr>
          <td>${d.type}</td>
          <td class="ai-severity ai-severity--${d.severity}">${d.severity.charAt(0).toUpperCase() + d.severity.slice(1)}</td>
          <td>${d.location}</td>
        </tr>`,
    )
    .join('');
}

/**
 * Build the AI Property Intelligence HTML section.
 * Returns an empty string when no analysis is provided.
 */
export function buildAiSectionHtml(analysis: PropertyAnalysis | null | undefined): string {
  if (!analysis || analysis.status !== 'completed') return '';

  const damageTable =
    analysis.damageIndicators.length > 0
      ? `
    <div class="ai-damage">
      <h3 class="ai-subheading">Damage Indicators</h3>
      <table class="ai-table">
        <thead>
          <tr><th>Type</th><th>Severity</th><th>Location</th></tr>
        </thead>
        <tbody>
          ${buildDamageIndicatorRows(analysis.damageIndicators)}
        </tbody>
      </table>
    </div>`
      : '';

  const reasoningBlock = analysis.reasoning
    ? `
    <div class="ai-reasoning">
      <h3 class="ai-subheading">AI Analysis Notes</h3>
      <p>${analysis.reasoning}</p>
    </div>`
    : '';

  const roofConfidenceText =
    analysis.roofConfidence !== null
      ? `<p><strong>Confidence:</strong> ${analysis.roofConfidence}%</p>`
      : '';

  return `
<div class="ai-section">
  <h2 class="ai-heading">Property Intelligence Report</h2>
  <div class="ai-grid">
    <div class="ai-card">
      <h3 class="ai-card__title">Roof Assessment</h3>
      <p><strong>Type:</strong> ${formatRoofType(analysis.roofType)}</p>
      <p><strong>Condition:</strong> ${formatCondition(analysis.roofCondition)}</p>
      <p><strong>Estimated Age:</strong> ${analysis.roofAgeEstimate !== null ? `${analysis.roofAgeEstimate} years` : 'Unknown'}</p>
      ${roofConfidenceText}
    </div>
    <div class="ai-card">
      <h3 class="ai-card__title">Siding Assessment</h3>
      <p><strong>Type:</strong> ${formatSidingType(analysis.sidingType)}</p>
      <p><strong>Condition:</strong> ${formatCondition(analysis.sidingCondition)}</p>
      ${analysis.isAluminumSiding ? '<p class="ai-highlight"><strong>Aluminum siding detected</strong></p>' : ''}
    </div>
  </div>
  <div class="ai-prospect-score">
    <span class="ai-score-label">Prospect Score:</span>
    <span class="ai-score-value">${formatScore(analysis.prospectScore)}</span>
    ${analysis.isHighPriority ? '<span class="ai-badge ai-badge--priority">High Priority</span>' : ''}
  </div>
  ${damageTable}
  ${reasoningBlock}
</div>`;
}

/** Scoped CSS injected into the report document for the AI section. */
const AI_SECTION_STYLES = `
  .ai-section {
    margin: 32px 0;
    padding: 28px 32px;
    background: #0f172a;
    border: 1px solid #1e3a5f;
    border-radius: 8px;
    color: #e2e8f0;
    font-family: inherit;
    page-break-inside: avoid;
  }
  .ai-heading {
    font-size: 1.25rem;
    font-weight: 700;
    color: #38bdf8;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    margin: 0 0 20px;
    padding-bottom: 12px;
    border-bottom: 1px solid #1e3a5f;
  }
  .ai-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 20px;
  }
  .ai-card {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 6px;
    padding: 16px 18px;
  }
  .ai-card__title {
    font-size: 0.9rem;
    font-weight: 600;
    color: #7dd3fc;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0 0 12px;
  }
  .ai-card p {
    margin: 4px 0;
    font-size: 0.9rem;
    color: #cbd5e1;
  }
  .ai-card p strong {
    color: #e2e8f0;
  }
  .ai-highlight {
    color: #fbbf24 !important;
  }
  .ai-prospect-score {
    display: flex;
    align-items: center;
    gap: 12px;
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 6px;
    padding: 14px 18px;
    margin-bottom: 20px;
  }
  .ai-score-label {
    font-size: 0.95rem;
    font-weight: 600;
    color: #94a3b8;
  }
  .ai-score-value {
    font-size: 1.5rem;
    font-weight: 800;
    color: #38bdf8;
  }
  .ai-badge {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .ai-badge--priority {
    background: #7c3aed;
    color: #ede9fe;
  }
  .ai-damage {
    margin-bottom: 20px;
  }
  .ai-subheading {
    font-size: 0.9rem;
    font-weight: 600;
    color: #7dd3fc;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0 0 10px;
  }
  .ai-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
  }
  .ai-table th {
    text-align: left;
    padding: 8px 12px;
    background: #0f172a;
    color: #94a3b8;
    font-weight: 600;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    border-bottom: 1px solid #334155;
  }
  .ai-table td {
    padding: 8px 12px;
    color: #cbd5e1;
    border-bottom: 1px solid #1e293b;
  }
  .ai-table tr:last-child td {
    border-bottom: none;
  }
  .ai-severity {
    font-weight: 600;
    text-transform: capitalize;
  }
  .ai-severity--minor   { color: #4ade80; }
  .ai-severity--moderate { color: #fbbf24; }
  .ai-severity--severe  { color: #f87171; }
  .ai-reasoning {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 6px;
    padding: 14px 18px;
  }
  .ai-reasoning p {
    margin: 0;
    font-size: 0.875rem;
    color: #94a3b8;
    line-height: 1.6;
  }
`;

// ============================================================
// End AI analysis helpers
// ============================================================

// REPORT_API_URL / REPORT_USER_EMAIL removed — sa21's /generate-report
// endpoint was the source of the 5–10s wait on every PDF click (it
// returns a JSON job-queue response, not an inline PDF). The in-repo
// /api/hail/storm-report-pdf has full parity and renders synchronously.
void HAIL_YES_HAIL_API_BASE;
const REPORT_REP_NAME =
  import.meta.env.VITE_REPORT_REP_NAME || 'Ahmed Mahmoud';
const REPORT_REP_PHONE =
  import.meta.env.VITE_REPORT_REP_PHONE || '(703) 555-0199';
const REPORT_REP_EMAIL =
  import.meta.env.VITE_REPORT_REP_EMAIL || 'ahmed@theroofdocs.com';
const REPORT_COMPANY_NAME =
  import.meta.env.VITE_REPORT_COMPANY_NAME || 'Hail Yes Storm Intelligence';

interface GenerateStormReportParams {
  address: string;
  lat: number;
  lng: number;
  radiusMiles: number;
  events: StormEvent[];
  dateOfLoss: string;
  evidenceItems?: EvidenceItem[];
  historyRange?: ReportHistoryRange;
  /** Optional AI property analysis to embed as the "Property Intelligence" section. */
  aiAnalysis?: PropertyAnalysis | null;
}

type RiskLevel = 'Low' | 'Moderate' | 'High' | 'Critical';

interface DamageScoreResult {
  score: number;
  riskLevel: RiskLevel;
  summary: string;
  color: string;
  factors: {
    eventCount: number;
    stormSystemCount: number;
    maxHailSize: number;
    recentActivity: number;
    cumulativeExposure: number;
    severityDistribution: {
      severe: number;
      moderate: number;
      minor: number;
    };
    recencyScore: number;
    documentedDamage: number;
    windEvents: number;
  };
}

function getRiskLevel(score: number): RiskLevel {
  if (score >= 76) return 'Critical';
  if (score >= 51) return 'High';
  if (score >= 26) return 'Moderate';
  return 'Low';
}

function getRiskColor(riskLevel: RiskLevel): string {
  if (riskLevel === 'Critical') return '#b91c1c';
  if (riskLevel === 'High') return '#ea580c';
  if (riskLevel === 'Moderate') return '#ca8a04';
  return '#16a34a';
}

function computeDamageScore(events: StormEvent[]): DamageScoreResult {
  const hailEvents = events.filter((event) => event.eventType === 'Hail');
  const windEvents = events.filter(
    (event) => event.eventType === 'Thunderstorm Wind',
  );
  let maxHailSize = 0;
  for (const event of hailEvents) {
    if (event.magnitude > maxHailSize) {
      maxHailSize = event.magnitude;
    }
  }
  const cumulativeExposure = hailEvents.reduce(
    (sum, event) => sum + event.magnitude,
    0,
  );
  const severityDistribution = {
    severe: hailEvents.filter((event) => event.magnitude >= 1.75).length,
    moderate: hailEvents.filter(
      (event) => event.magnitude >= 1 && event.magnitude < 1.75,
    ).length,
    minor: hailEvents.filter((event) => event.magnitude < 1).length,
  };

  const rawScore =
    hailEvents.length * 8 +
    windEvents.length * 5 +
    maxHailSize * 18 +
    cumulativeExposure * 4;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  const riskLevel = getRiskLevel(score);

  return {
    score,
    riskLevel,
    summary:
      score >= 60
        ? 'Documented storm activity supports a high-likelihood roof damage conversation.'
        : score >= 30
          ? 'Documented storm history supports a moderate damage review.'
          : 'Limited storm history was found for this loss date.',
    color: getRiskColor(riskLevel),
    factors: {
      eventCount: events.length,
      stormSystemCount: 1,
      maxHailSize,
      recentActivity: events.length,
      cumulativeExposure,
      severityDistribution,
      recencyScore: 0,
      documentedDamage: 0,
      windEvents: windEvents.length,
    },
  };
}

function toReportEvent(event: StormEvent) {
  const date = event.beginDate;
  const common = {
    id: event.id,
    date,
    latitude: event.beginLat,
    longitude: event.beginLon,
  };

  if (event.eventType === 'Hail') {
    return {
      ...common,
      hailSize: event.magnitude,
      severity:
        event.magnitude >= 1.75
          ? 'severe'
          : event.magnitude >= 1
            ? 'moderate'
            : 'minor',
      source: event.source,
    };
  }

  return {
    ...common,
    magnitude: event.magnitude,
    eventType: 'wind',
    location: [event.county, event.state].filter(Boolean).join(', ') || event.source,
  };
}

function downloadBlob(blob: Blob, filename: string): void {
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(blobUrl);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read evidence blob.'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(blob);
  });
}

export async function generateStormReport({
  address,
  lat,
  lng,
  radiusMiles,
  events,
  dateOfLoss,
  evidenceItems = [],
  historyRange = '2y',
  aiAnalysis,
}: GenerateStormReportParams): Promise<void> {
  const datedEvents = events.filter(
    (event) => toEasternDateKey(event.beginDate) === dateOfLoss,
  );

  if (datedEvents.length === 0) {
    throw new Error('No events are available for the selected date of loss.');
  }

  const preparedEvidenceItems: ReportEvidenceItem[] = await Promise.all(
    evidenceItems.map(async (item) => {
      const common = {
        id: item.id,
        provider: item.provider,
        mediaType: item.mediaType,
        title: item.title,
        stormDate: item.stormDate,
        notes: item.notes,
        externalUrl: item.externalUrl,
        thumbnailUrl: item.thumbnailUrl,
        publishedAt: item.publishedAt,
        fileName: item.fileName,
        mimeType: item.mimeType,
      };

      if (item.mediaType === 'image' && item.blob) {
        return {
          ...common,
          imageDataUrl: await blobToDataUrl(item.blob),
        };
      }

      return {
        ...common,
        imageDataUrl: null,
      };
    }),
  );

  // Susan21-shape payload removed — the in-repo PDF endpoint takes
  // its own simpler shape (built below at the fetch call). Keeping
  // these lookups suppressed in case the in-repo generator is later
  // extended to consume them.
  void buildAiSectionHtml;
  void datedEvents;
  void aiAnalysis;
  void AI_SECTION_STYLES;
  void computeDamageScore;
  void toReportEvent;

  // Susan21 PDF endpoint REMOVED from the path — it was returning a
  // JSON job-queue response ({jobId, status:"pending"}) on every PDF
  // gen, forcing a 5–10s wait for the non-PDF response BEFORE falling
  // through to the in-repo generator. Net effect was every PDF click
  // took 5–10s longer than it needed to. The in-repo PDFKit pipeline
  // has full parity (cap algorithm, Sterling, hero banner, hit history,
  // sources attribution) and renders in ~3–5s, so we go straight to it.
  // Susan21 (sa21) is staying its own deployment per Ahmed's call.
  const safeAddress = address.replace(/[^a-zA-Z0-9]/g, '_');

  // In-repo PDF — reshape the evidence items into the smaller
  // {imageUrl, imageDataUrl, title, caption} shape the in-repo PDF
  // expects. Only the first 6 image-type items are actually rendered.
  const fallbackEvidence = preparedEvidenceItems
    .filter((item) => item.mediaType === 'image' && (item.imageDataUrl || item.thumbnailUrl))
    .slice(0, 6)
    .map((item) => ({
      imageDataUrl: item.imageDataUrl ?? undefined,
      imageUrl: item.imageDataUrl ? undefined : item.thumbnailUrl ?? undefined,
      title: item.title,
      caption: item.notes,
    }));

  const fallbackResponse = await fetch('/api/hail/storm-report-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address,
      lat,
      lng,
      radiusMiles,
      dateOfLoss,
      historyRange,
      rep: {
        name: REPORT_REP_NAME,
        phone: REPORT_REP_PHONE,
        email: REPORT_REP_EMAIL,
      },
      company: { name: REPORT_COMPANY_NAME },
      evidence: fallbackEvidence,
    }),
  });
  if (!fallbackResponse.ok) {
    throw new Error(`In-repo PDF fallback returned ${fallbackResponse.status}`);
  }
  const blob = await fallbackResponse.blob();
  downloadBlob(blob, `Hail_Yes_Report_${safeAddress}_${dateOfLoss}.pdf`);
}

/**
 * Convenience wrapper that makes the `aiAnalysis` parameter required.
 * Use this when calling from a context where AI analysis has already been run.
 */
export async function generateEnhancedReport(
  params: Omit<GenerateStormReportParams, 'aiAnalysis'> & {
    aiAnalysis: PropertyAnalysis;
  },
): Promise<void> {
  return generateStormReport(params);
}

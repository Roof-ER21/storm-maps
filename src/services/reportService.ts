import type { EvidenceItem, ReportEvidenceItem, StormEvent } from '../types/storm';
import { HAIL_YES_HAIL_API_BASE } from './backendConfig';

const REPORT_API_URL = `${HAIL_YES_HAIL_API_BASE}/generate-report`;
const REPORT_USER_EMAIL =
  import.meta.env.VITE_REPORT_USER_EMAIL || 'ahmed@theroofdocs.com';
const REPORT_REP_NAME =
  import.meta.env.VITE_REPORT_REP_NAME || 'Ahmed Mahmoud';
const REPORT_REP_PHONE =
  import.meta.env.VITE_REPORT_REP_PHONE || '(703) 555-0199';
const REPORT_REP_EMAIL =
  import.meta.env.VITE_REPORT_REP_EMAIL || 'ahmed@theroofdocs.com';
const REPORT_COMPANY_NAME =
  import.meta.env.VITE_REPORT_COMPANY_NAME || 'The Roof Docs';

interface GenerateStormReportParams {
  address: string;
  lat: number;
  lng: number;
  radiusMiles: number;
  events: StormEvent[];
  dateOfLoss: string;
  evidenceItems?: EvidenceItem[];
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
}: GenerateStormReportParams): Promise<void> {
  const datedEvents = events.filter(
    (event) => event.beginDate.slice(0, 10) === dateOfLoss,
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

  const payload = {
    address,
    lat,
    lng,
    radius: radiusMiles,
    events: datedEvents
      .filter((event) => event.eventType === 'Hail')
      .map(toReportEvent),
    noaaEvents: datedEvents.map(toReportEvent),
    damageScore: computeDamageScore(datedEvents),
    filter: 'hail-wind',
    includeNexrad: true,
    includeMap: true,
    includeWarnings: true,
    dateOfLoss,
    template: 'noaa-forward',
    repName: REPORT_REP_NAME,
    repPhone: REPORT_REP_PHONE,
    repEmail: REPORT_REP_EMAIL,
    companyName: REPORT_COMPANY_NAME,
    evidenceItems: preparedEvidenceItems,
  };

  const response = await fetch(REPORT_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-email': REPORT_USER_EMAIL,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Report API returned ${response.status}`);
  }

  const blob = await response.blob();
  const safeAddress = address.replace(/[^a-zA-Z0-9]/g, '_');
  downloadBlob(
    blob,
    `Hail_Yes_Report_${safeAddress}_${dateOfLoss}.pdf`,
  );
}

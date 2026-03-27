import type { EvidenceItem, PropertySearchSummary, StormDate } from '../types/storm';
import { fetchDirectEvidenceCandidates } from './evidenceProviders';

const EVIDENCE_API_BASE = 'https://sa21.up.railway.app/api/hail';

interface EvidenceSearchResponse {
  candidates: Array<{
    id: string;
    provider: 'youtube' | 'flickr';
    title: string;
    url: string;
    thumbnailUrl: string | null;
    mediaType: 'video' | 'image' | 'link';
    stormDate: string | null;
    publishedAt: string | null;
    sourceState: 'live' | 'fallback';
    notes?: string;
  }>;
  providerStatus: {
    youtube: 'live' | 'fallback';
    flickr: 'live' | 'fallback';
  };
}

export async function fetchEvidenceCandidates(
  searchSummary: PropertySearchSummary,
  lat: number,
  lng: number,
  stormDates: StormDate[],
): Promise<{ items: EvidenceItem[]; providerStatus: EvidenceSearchResponse['providerStatus'] }> {
  const direct = await fetchDirectEvidenceCandidates(
    searchSummary,
    lat,
    lng,
    stormDates,
  );

  if (direct.items.length > 0) {
    return direct;
  }

  const params = new URLSearchParams({
    propertyLabel: searchSummary.locationLabel,
    lat: String(lat),
    lng: String(lng),
    radiusMiles: String(searchSummary.radiusMiles),
  });

  const targetStormDates = stormDates.slice(0, 2).map((stormDate) => stormDate.date);
  if (targetStormDates.length > 0) {
    params.set('stormDates', targetStormDates.join(','));
  }

  const response = await fetch(
    `${EVIDENCE_API_BASE}/evidence-search?${params.toString()}`,
    { signal: AbortSignal.timeout(15000) },
  );

  if (!response.ok) {
    throw new Error(`Evidence API returned ${response.status}`);
  }

  const data = (await response.json()) as EvidenceSearchResponse;
  const now = new Date().toISOString();

  return {
    items: data.candidates.map((candidate) => ({
      id: candidate.id,
      kind: 'provider-query',
      provider: candidate.provider,
      mediaType: candidate.mediaType,
      propertyLabel: searchSummary.locationLabel,
      stormDate: candidate.stormDate,
      title: candidate.title,
      notes: candidate.notes,
      externalUrl: candidate.url,
      thumbnailUrl: candidate.thumbnailUrl,
      publishedAt: candidate.publishedAt,
      createdAt: now,
      updatedAt: now,
      status: 'pending',
      includeInReport: false,
    })),
    providerStatus: data.providerStatus,
  };
}

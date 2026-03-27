import type { EvidenceItem, PropertySearchSummary, StormDate } from '../types/storm';

function encodeQuery(value: string): string {
  return encodeURIComponent(value.trim());
}

function getStormSearchPhrase(
  propertyLabel: string,
  stormDate: string | null,
): string {
  return [propertyLabel, stormDate, 'hail storm'].filter(Boolean).join(' ');
}

function buildYoutubeSearchUrl(
  propertyLabel: string,
  stormDate: string | null,
): string {
  const query = getStormSearchPhrase(propertyLabel, stormDate);
  return `https://www.youtube.com/results?search_query=${encodeQuery(query)}`;
}

function buildFlickrSearchUrl(
  propertyLabel: string,
  stormDate: string | null,
): string {
  const query = getStormSearchPhrase(propertyLabel, stormDate);
  return `https://www.flickr.com/search/?text=${encodeQuery(query)}`;
}

function makeQueryEvidenceId(
  provider: 'youtube' | 'flickr',
  propertyLabel: string,
  stormDate: string | null,
): string {
  return `query-${provider}-${propertyLabel}-${stormDate ?? 'undated'}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-');
}

export function buildEvidenceQuerySeeds(
  searchSummary: PropertySearchSummary,
  stormDates: StormDate[],
): EvidenceItem[] {
  const now = new Date().toISOString();
  const targetStormDates = stormDates.slice(0, 2);

  if (targetStormDates.length === 0) {
    return [
      {
        id: makeQueryEvidenceId('youtube', searchSummary.locationLabel, null),
        kind: 'provider-query',
        provider: 'youtube',
        mediaType: 'link',
        propertyLabel: searchSummary.locationLabel,
        stormDate: null,
        title: `YouTube search pack for ${searchSummary.locationLabel}`,
        notes:
          'Starter source pack. Replace with real API backfill later, but reps can use this immediately to check nearby public uploads.',
        externalUrl: buildYoutubeSearchUrl(searchSummary.locationLabel, null),
        createdAt: now,
        updatedAt: now,
        status: 'pending',
      },
      {
        id: makeQueryEvidenceId('flickr', searchSummary.locationLabel, null),
        kind: 'provider-query',
        provider: 'flickr',
        mediaType: 'link',
        propertyLabel: searchSummary.locationLabel,
        stormDate: null,
        title: `Flickr search pack for ${searchSummary.locationLabel}`,
        notes:
          'Starter source pack. Use this until backend geo/date ingestion is wired in.',
        externalUrl: buildFlickrSearchUrl(searchSummary.locationLabel, null),
        createdAt: now,
        updatedAt: now,
        status: 'pending',
      },
    ];
  }

  return targetStormDates.flatMap((stormDate) => [
    {
      id: makeQueryEvidenceId('youtube', searchSummary.locationLabel, stormDate.date),
      kind: 'provider-query' as const,
      provider: 'youtube' as const,
      mediaType: 'link' as const,
      propertyLabel: searchSummary.locationLabel,
      stormDate: stormDate.date,
      title: `YouTube search pack for ${stormDate.label}`,
      notes:
        'Starter source pack for public videos near this storm date. Designed to be replaced by real provider ingestion later.',
      externalUrl: buildYoutubeSearchUrl(searchSummary.locationLabel, stormDate.date),
      createdAt: now,
      updatedAt: now,
      status: 'pending' as const,
    },
    {
      id: makeQueryEvidenceId('flickr', searchSummary.locationLabel, stormDate.date),
      kind: 'provider-query' as const,
      provider: 'flickr' as const,
      mediaType: 'link' as const,
      propertyLabel: searchSummary.locationLabel,
      stormDate: stormDate.date,
      title: `Flickr search pack for ${stormDate.label}`,
      notes:
        'Starter source pack for public photos near this storm date. Designed to be replaced by real provider ingestion later.',
      externalUrl: buildFlickrSearchUrl(searchSummary.locationLabel, stormDate.date),
      createdAt: now,
      updatedAt: now,
      status: 'pending' as const,
    },
  ]);
}

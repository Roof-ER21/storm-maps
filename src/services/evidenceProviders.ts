import type { EvidenceItem, PropertySearchSummary, StormDate } from '../types/storm';

const YOUTUBE_API_KEY =
  (import.meta.env.VITE_YOUTUBE_API_KEY as string | undefined) || '';
const FLICKR_API_KEY =
  (import.meta.env.VITE_FLICKR_API_KEY as string | undefined) || '';

type ProviderStatus = {
  youtube: 'live' | 'fallback';
  flickr: 'live' | 'fallback';
};

interface YoutubeSearchItem {
  id?: {
    videoId?: string;
  };
  snippet?: {
    title?: string;
    publishedAt?: string;
    channelTitle?: string;
    thumbnails?: {
      high?: { url?: string };
      medium?: { url?: string };
      default?: { url?: string };
    };
  };
}

interface FlickrSearchItem {
  id?: string;
  owner?: string;
  ownername?: string;
  title?: string;
  datetaken?: string;
  dateupload?: string;
  url_l?: string;
  url_m?: string;
  url_n?: string;
}

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

function milesToMeters(miles: number): number {
  return miles * 1609.344;
}

function toEvidenceItem(
  searchSummary: PropertySearchSummary,
  candidate: {
    id: string;
    provider: 'youtube' | 'flickr';
    title: string;
    externalUrl: string;
    thumbnailUrl?: string | null;
    mediaType: 'video' | 'image' | 'link';
    stormDate: string | null;
    publishedAt?: string | null;
    notes?: string;
  },
): EvidenceItem {
  const now = new Date().toISOString();

  return {
    id: candidate.id,
    kind: 'provider-query',
    provider: candidate.provider,
    mediaType: candidate.mediaType,
    propertyLabel: searchSummary.locationLabel,
    stormDate: candidate.stormDate,
    title: candidate.title,
    notes: candidate.notes,
    externalUrl: candidate.externalUrl,
    thumbnailUrl: candidate.thumbnailUrl ?? null,
    publishedAt: candidate.publishedAt ?? null,
    createdAt: now,
    updatedAt: now,
    status: 'pending',
  };
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

async function searchYoutubeDirect(
  searchSummary: PropertySearchSummary,
  lat: number,
  lng: number,
  stormDate: string | null,
): Promise<EvidenceItem[]> {
  if (!YOUTUBE_API_KEY) {
    return [];
  }

  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    maxResults: '5',
    q: getStormSearchPhrase(searchSummary.locationLabel, stormDate),
    key: YOUTUBE_API_KEY,
    location: `${lat},${lng}`,
    locationRadius: `${Math.round(milesToMeters(searchSummary.radiusMiles))}m`,
    order: 'date',
  });

  if (stormDate) {
    params.set('publishedAfter', `${stormDate}T00:00:00Z`);
    params.set('publishedBefore', `${stormDate}T23:59:59Z`);
  }

  const response = await fetch(
    `https://www.googleapis.com/youtube/v3/search?${params.toString()}`,
    { signal: AbortSignal.timeout(12000) },
  );

  if (!response.ok) {
    throw new Error(`YouTube direct search returned ${response.status}`);
  }

  const data = await response.json();
  const items: YoutubeSearchItem[] = Array.isArray(data.items) ? data.items : [];

  return items.map((item) =>
    toEvidenceItem(searchSummary, {
      id: `youtube-${item?.id?.videoId || crypto.randomUUID()}-${stormDate ?? 'undated'}`,
      provider: 'youtube',
      title: item?.snippet?.title || 'YouTube video',
      externalUrl: `https://www.youtube.com/watch?v=${item?.id?.videoId}`,
      thumbnailUrl:
        item?.snippet?.thumbnails?.high?.url ||
        item?.snippet?.thumbnails?.medium?.url ||
        item?.snippet?.thumbnails?.default?.url ||
        null,
      mediaType: 'video',
      stormDate,
      publishedAt: item?.snippet?.publishedAt || null,
      notes: item?.snippet?.channelTitle
        ? `Channel: ${item.snippet.channelTitle}`
        : 'Direct browser provider lookup',
    }),
  );
}

async function searchFlickrDirect(
  searchSummary: PropertySearchSummary,
  lat: number,
  lng: number,
  stormDate: string | null,
): Promise<EvidenceItem[]> {
  if (!FLICKR_API_KEY) {
    return [];
  }

  const params = new URLSearchParams({
    method: 'flickr.photos.search',
    api_key: FLICKR_API_KEY,
    format: 'json',
    nojsoncallback: '1',
    text: getStormSearchPhrase(searchSummary.locationLabel, stormDate),
    lat: String(lat),
    lon: String(lng),
    radius: String(Math.min(searchSummary.radiusMiles, 32)),
    radius_units: 'mi',
    extras: 'date_upload,date_taken,geo,url_l,url_m,url_n,owner_name',
    sort: 'date-posted-desc',
    per_page: '5',
    content_type: '1',
    media: 'photos',
  });

  if (stormDate) {
    params.set('min_taken_date', `${stormDate} 00:00:00`);
    params.set('max_taken_date', `${stormDate} 23:59:59`);
  }

  const response = await fetch(
    `https://www.flickr.com/services/rest/?${params.toString()}`,
    { signal: AbortSignal.timeout(12000) },
  );

  if (!response.ok) {
    throw new Error(`Flickr direct search returned ${response.status}`);
  }

  const data = await response.json();
  const items: FlickrSearchItem[] = Array.isArray(data?.photos?.photo)
    ? data.photos.photo
    : [];

  return items.map((item) =>
    toEvidenceItem(searchSummary, {
      id: `flickr-${item?.id || crypto.randomUUID()}-${stormDate ?? 'undated'}`,
      provider: 'flickr',
      title: item?.title || 'Flickr photo',
      externalUrl: `https://www.flickr.com/photos/${item?.owner}/${item?.id}`,
      thumbnailUrl: item?.url_m || item?.url_n || item?.url_l || null,
      mediaType: 'image',
      stormDate,
      publishedAt: item?.datetaken || item?.dateupload || null,
      notes: item?.ownername
        ? `Owner: ${item.ownername}`
        : 'Direct browser provider lookup',
    }),
  );
}

export async function fetchDirectEvidenceCandidates(
  searchSummary: PropertySearchSummary,
  lat: number,
  lng: number,
  stormDates: StormDate[],
): Promise<{ items: EvidenceItem[]; providerStatus: ProviderStatus }> {
  const providerStatus: ProviderStatus = {
    youtube: YOUTUBE_API_KEY ? 'live' : 'fallback',
    flickr: FLICKR_API_KEY ? 'live' : 'fallback',
  };

  if (!YOUTUBE_API_KEY && !FLICKR_API_KEY) {
    return { items: [], providerStatus };
  }

  const targetDates = stormDates.slice(0, 2).map((stormDate) => stormDate.date);
  const effectiveDates = targetDates.length > 0 ? targetDates : [null];

  const results = await Promise.all(
    effectiveDates.flatMap((stormDate) => [
      searchYoutubeDirect(searchSummary, lat, lng, stormDate),
      searchFlickrDirect(searchSummary, lat, lng, stormDate),
    ]),
  );

  return {
    items: results.flat(),
    providerStatus,
  };
}

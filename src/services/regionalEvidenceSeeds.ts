import type { EvidenceItem, LatLng, PropertySearchSummary, StormDate } from '../types/storm';

type RegionalCode = 'dmv' | 'pa' | 'ra';

interface RegionalEvidenceSeed {
  id: string;
  region: RegionalCode;
  stormDate: string;
  title: string;
  placeLabel: string;
  sourceLabel: string;
  provider: 'youtube' | 'flickr';
  mediaType: 'video' | 'image' | 'link';
  externalUrl: string;
  thumbnailUrl: string | null;
  publishedAt: string;
  notes: string;
}

const REGIONAL_SEED_CATALOG: RegionalEvidenceSeed[] = [
  {
    id: 'dmv-2024-08-29-sterling-fox5-video',
    region: 'dmv',
    stormDate: '2024-08-29',
    title: 'Hail coming down in Sterling, Virginia',
    placeLabel: 'Sterling, Virginia',
    sourceLabel: 'FOX 5 DC',
    provider: 'youtube',
    mediaType: 'video',
    externalUrl: 'https://www.fox5dc.com/video/1508890',
    thumbnailUrl: 'https://static-media.fox.com/fmcv3/prod/fts/A-229105/2ts1tkv68oyj3r2c.jpg',
    publishedAt: '2024-08-29T19:07:00-04:00',
    notes:
      'Verified public viewer video from FOX 5 DC for the Aug. 29, 2024 Sterling hail event.',
  },
  {
    id: 'dmv-2024-05-23-lovettsville-fox5-video',
    region: 'dmv',
    stormDate: '2024-05-23',
    title: 'Hail left behind after storms in Lovettsville, Virginia',
    placeLabel: 'Lovettsville, Virginia',
    sourceLabel: 'FOX 5 DC',
    provider: 'youtube',
    mediaType: 'video',
    externalUrl: 'https://www.fox5dc.com/video/1460721',
    thumbnailUrl: 'https://static-media.fox.com/fmcv3/prod/fts/A-223341/a3q7xag6mln4qpro.jpg',
    publishedAt: '2024-05-23T22:54:00-04:00',
    notes:
      'Verified public viewer video from FOX 5 DC showing hail left behind in Lovettsville after the May 23, 2024 storm.',
  },
  {
    id: 'dmv-2024-04-15-virginia-fox5-hail',
    region: 'dmv',
    stormDate: '2024-04-15',
    title: 'Pea-sized hail falls in parts of Virginia',
    placeLabel: 'Herndon / Spotsylvania / Caroline, Virginia',
    sourceLabel: 'FOX 5 DC',
    provider: 'youtube',
    mediaType: 'video',
    externalUrl: 'https://www.fox5dc.com/video/1441567',
    thumbnailUrl: 'https://static-media.fox.com/fmcv3/prod/fts/0h729prmnq03uzks/6apvtaga9ob27w8r.jpg',
    publishedAt: '2024-04-15T18:00:00-04:00',
    notes:
      'Verified FOX 5 DC weather segment showing hail reports in Virginia during the Apr. 15, 2024 severe weather event.',
  },
  {
    id: 'dmv-2025-05-16-baltimore-wbal-photos',
    region: 'dmv',
    stormDate: '2025-05-16',
    title: 'PHOTOS: WBAL-TV 11 viewers submit pictures of storm damage',
    placeLabel: 'Baltimore / Laurel / Dundalk, Maryland',
    sourceLabel: 'WBAL-TV 11',
    provider: 'flickr',
    mediaType: 'image',
    externalUrl: 'https://www.wbaltv.com/article/photos-wbal-viewers-pictures-storm-damage/64797801',
    thumbnailUrl: 'https://kubrick.htvapps.com/htv-prod-media.s3.amazonaws.com/images/37990118-source-6827da739583b.jpg?crop=1.00xw%3A0.756xh%3B0%2C0.136xh&resize=900%3A%2A',
    publishedAt: '2025-05-17T13:44:00-04:00',
    notes:
      'Verified WBAL-TV viewer photo gallery documenting May 16, 2025 storm damage in Maryland, including hail-related reports.',
  },
  {
    id: 'pa-2024-04-15-wgal-hail-photos',
    region: 'pa',
    stormDate: '2024-04-15',
    title: 'Hail falls in parts of south-central Pennsylvania',
    placeLabel: 'Spring Grove / York / Adams Counties, Pennsylvania',
    sourceLabel: 'WGAL',
    provider: 'flickr',
    mediaType: 'image',
    externalUrl: 'https://www.wgal.com/article/south-central-pennsylvania-storms-bring-hail/60503521',
    thumbnailUrl: 'https://kubrick.htvapps.com/htv-prod-media.s3.amazonaws.com/images/hail-spring-grove-661d9ecf9796a.jpeg?crop=1xw%3A1xh%3Bcenter%2Ctop&resize=900%3A%2A',
    publishedAt: '2024-04-15T18:30:00-04:00',
    notes:
      'Verified WGAL photo gallery from the Apr. 15, 2024 south-central Pennsylvania hail event.',
  },
  {
    id: 'pa-2024-04-16-wgal-hail-video',
    region: 'pa',
    stormDate: '2024-04-15',
    title: 'Hail pelts cars, homes and barns across parts of South-Central PA',
    placeLabel: 'Spring Grove / York / Adams Counties, Pennsylvania',
    sourceLabel: 'WGAL',
    provider: 'youtube',
    mediaType: 'video',
    externalUrl: 'https://www.wgal.com/article/south-central-pennsylvania-hail-video/60508979',
    thumbnailUrl: null,
    publishedAt: '2024-04-16T09:18:00-04:00',
    notes:
      'Verified WGAL viewer-video roundup from the Apr. 15, 2024 hail event in York and Adams counties.',
  },
  {
    id: 'ra-2023-04-01-wtvr-hail-richmond',
    region: 'ra',
    stormDate: '2023-04-01',
    title: 'Cold front triggered storms that brought hail, strong winds to Virginia',
    placeLabel: 'Mechanicsville / Metro Richmond, Virginia',
    sourceLabel: 'WTVR CBS 6',
    provider: 'flickr',
    mediaType: 'image',
    externalUrl: 'https://www.wtvr.com/news/local-news/cold-front-triggered-storms-that-brought-hail-strong-winds-to-virginia',
    thumbnailUrl: 'https://ewscripps.brightspotcdn.com/dims4/default/e593d80/2147483647/strip/true/crop/1280x720%2B0%2B0/resize/1280x720%21/quality/90/?url=http%3A%2F%2Fewscripps-brightspot.s3.amazonaws.com%2F7d%2F4f%2F017ef9a04b30a0c0d95ddbdd462c%2Funtitled-design.png',
    publishedAt: '2023-04-01T21:00:00-04:00',
    notes:
      'Verified WTVR coverage of the Apr. 1, 2023 Metro Richmond hail event, including reports up to golf-ball size in Mechanicsville.',
  },
];

function makeEvidenceId(propertyLabel: string, seedId: string): string {
  return `regional-${propertyLabel}-${seedId}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-');
}

function detectRegion(location: LatLng, label: string): RegionalCode | null {
  const normalizedLabel = label.toLowerCase();

  if (
    normalizedLabel.includes('pennsylvania') ||
    normalizedLabel.includes(', pa') ||
    (location.lat >= 39.5 && location.lat <= 42.5 && location.lng >= -81 && location.lng <= -74.3)
  ) {
    return 'pa';
  }

  if (
    normalizedLabel.includes('richmond') ||
    normalizedLabel.includes('henrico') ||
    normalizedLabel.includes('mechanicsville') ||
    normalizedLabel.includes('chesterfield') ||
    (location.lat >= 36.8 && location.lat <= 38.3 && location.lng >= -78.8 && location.lng <= -76.4)
  ) {
    return 'ra';
  }

  if (
    normalizedLabel.includes('maryland') ||
    normalizedLabel.includes('virginia') ||
    normalizedLabel.includes('district of columbia') ||
    normalizedLabel.includes('washington, dc') ||
    normalizedLabel.includes(', va') ||
    normalizedLabel.includes(', md') ||
    normalizedLabel.includes(', dc') ||
    (location.lat >= 38.1 && location.lat <= 40.3 && location.lng >= -78.8 && location.lng <= -75.5)
  ) {
    return 'dmv';
  }

  return null;
}

function toEpoch(date: string): number {
  const parsed = Date.parse(`${date}T12:00:00Z`);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function mapSeedToEvidence(
  searchSummary: PropertySearchSummary,
  seed: RegionalEvidenceSeed,
  matchType: 'exact' | 'regional-nearby',
): EvidenceItem {
  const now = new Date().toISOString();
  return {
    id: makeEvidenceId(searchSummary.locationLabel, seed.id),
    kind: 'provider-query',
    provider: seed.provider,
    mediaType: seed.mediaType,
    propertyLabel: searchSummary.locationLabel,
    stormDate: seed.stormDate,
    title: seed.title,
    notes:
      `${seed.notes} Source: ${seed.sourceLabel}. Place: ${seed.placeLabel}. ` +
      (matchType === 'exact'
        ? 'Exact storm-date match for the current property history.'
        : 'Regional nearby sample for this search area when an exact local clip was not pre-seeded.'),
    externalUrl: seed.externalUrl,
    thumbnailUrl: seed.thumbnailUrl,
    publishedAt: seed.publishedAt,
    createdAt: now,
    updatedAt: now,
    status: 'pending',
    includeInReport: false,
  };
}

export function buildRegionalEvidenceSeeds(
  searchSummary: PropertySearchSummary,
  stormDates: StormDate[],
  location: LatLng,
): EvidenceItem[] {
  const region = detectRegion(location, searchSummary.locationLabel);
  if (!region) {
    return [];
  }

  const activeDates = new Set(stormDates.map((stormDate) => stormDate.date));
  const regionalSeeds = REGIONAL_SEED_CATALOG.filter((seed) => seed.region === region);

  const exactMatches = regionalSeeds
    .filter((seed) => activeDates.has(seed.stormDate))
    .map((seed) => mapSeedToEvidence(searchSummary, seed, 'exact'));

  if (exactMatches.length > 0) {
    return exactMatches;
  }

  const referenceDate = stormDates[0]?.date ?? regionalSeeds[0]?.stormDate ?? null;
  if (!referenceDate) {
    return [];
  }

  return [...regionalSeeds]
    .sort((left, right) => Math.abs(toEpoch(left.stormDate) - toEpoch(referenceDate)) - Math.abs(toEpoch(right.stormDate) - toEpoch(referenceDate)))
    .slice(0, 4)
    .map((seed) => mapSeedToEvidence(searchSummary, seed, 'regional-nearby'));
}

import type { EvidenceItem, PropertySearchSummary, StormDate } from '../types/storm';

const DEMO_VIDEO_URL = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';

function makeDemoEvidenceId(propertyLabel: string, stormDate: string | null, slug: string): string {
  return `demo-${propertyLabel}-${stormDate ?? 'undated'}-${slug}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-');
}

function buildDemoItem(
  searchSummary: PropertySearchSummary,
  stormDate: string | null,
  config: {
    slug: string;
    title: string;
    mediaType: 'image' | 'video';
    notes: string;
    assetPath: string;
    externalUrl?: string;
    publishedAt?: string;
  },
): EvidenceItem {
  const now = new Date().toISOString();

  return {
    id: makeDemoEvidenceId(searchSummary.locationLabel, stormDate, config.slug),
    kind: 'provider-query',
    provider: 'upload',
    mediaType: config.mediaType,
    propertyLabel: searchSummary.locationLabel,
    stormDate,
    title: config.title,
    notes: config.notes,
    externalUrl: config.externalUrl ?? config.assetPath,
    thumbnailUrl: config.assetPath,
    publishedAt: config.publishedAt ?? now,
    createdAt: now,
    updatedAt: now,
    status: 'pending',
    includeInReport: false,
  };
}

export function buildDemoEvidencePack(
  searchSummary: PropertySearchSummary,
  stormDates: StormDate[],
): EvidenceItem[] {
  const primaryStormDate = stormDates[0]?.date ?? null;
  const secondaryStormDate = stormDates[1]?.date ?? primaryStormDate;

  return [
    buildDemoItem(searchSummary, primaryStormDate, {
      slug: 'gutter-dents',
      title: 'Collateral damage on gutter line',
      mediaType: 'image',
      notes:
        'Demo seeded image. Use this as a stand-in for dents on gutters and downspouts that help support the hail story.',
      assetPath: '/evidence-seed/gutter-dents.svg',
    }),
    buildDemoItem(searchSummary, primaryStormDate, {
      slug: 'roof-bruising',
      title: 'Roof impact close-up',
      mediaType: 'image',
      notes:
        'Demo seeded image. Designed to behave like a close-up shingle bruising photo for the selected loss date.',
      assetPath: '/evidence-seed/roof-impact.svg',
    }),
    buildDemoItem(searchSummary, secondaryStormDate, {
      slug: 'screen-tears',
      title: 'Screen and soft-metal impact marks',
      mediaType: 'image',
      notes:
        'Demo seeded image. Useful for report attachment when you want another supporting collateral-damage item.',
      assetPath: '/evidence-seed/screen-tears.svg',
    }),
    buildDemoItem(searchSummary, primaryStormDate, {
      slug: 'drive-by-video',
      title: 'Neighborhood canvass video reference',
      mediaType: 'video',
      notes:
        'Demo seeded video reference. Replace later with a real homeowner or rep clip, but it exercises the report evidence flow now.',
      assetPath: '/evidence-seed/drive-by-video.svg',
      externalUrl: DEMO_VIDEO_URL,
    }),
  ];
}

import type { EvidenceItem, LatLng, PropertySearchSummary, StormDate } from '../types/storm';

type RegionalCode =
  | 'dmv' | 'pa' | 'ra'
  | 'dfw' | 'satx' | 'houston'
  | 'denver' | 'cosprings'
  | 'okc' | 'tulsa'
  | 'wichita' | 'topeka'
  | 'omaha' | 'lincoln'
  | 'msp'
  | 'atlanta'
  | 'charlotte' | 'raleigh'
  | 'greenville' | 'columbia'
  | 'nashville' | 'memphis'
  | 'birmingham' | 'huntsville'
  | 'stlouis' | 'kc'
  | 'desmoines'
  | 'chicago'
  | 'indianapolis';

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
  // ── DMV (DC / MD / VA) ────────────────────────────────
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
    thumbnailUrl: null,
    publishedAt: '2024-08-29T19:07:00-04:00',
    notes: 'Verified FOX 5 DC viewer video from Aug 29 2024 Sterling hail event.',
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
    thumbnailUrl: null,
    publishedAt: '2024-05-23T22:54:00-04:00',
    notes: 'Verified FOX 5 DC viewer video showing hail in Lovettsville, May 23 2024.',
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
    thumbnailUrl: null,
    publishedAt: '2024-04-15T18:00:00-04:00',
    notes: 'Verified FOX 5 DC weather segment — Apr 15 2024 severe weather hail reports.',
  },
  {
    id: 'dmv-2025-05-16-baltimore-wbal-photos',
    region: 'dmv',
    stormDate: '2025-05-16',
    title: 'WBAL-TV viewers submit storm damage photos',
    placeLabel: 'Baltimore / Laurel / Dundalk, Maryland',
    sourceLabel: 'WBAL-TV 11',
    provider: 'flickr',
    mediaType: 'image',
    externalUrl: 'https://www.wbaltv.com/article/photos-wbal-viewers-pictures-storm-damage/64797801',
    thumbnailUrl: null,
    publishedAt: '2025-05-17T13:44:00-04:00',
    notes: 'Verified WBAL-TV viewer photo gallery — May 16 2025 Maryland storm damage.',
  },

  // ── Pennsylvania ──────────────────────────────────────
  {
    id: 'pa-2024-04-15-wgal-hail-photos',
    region: 'pa',
    stormDate: '2024-04-15',
    title: 'Hail falls in south-central Pennsylvania',
    placeLabel: 'Spring Grove / York / Adams Counties, PA',
    sourceLabel: 'WGAL',
    provider: 'flickr',
    mediaType: 'image',
    externalUrl: 'https://www.wgal.com/article/south-central-pennsylvania-storms-bring-hail/60503521',
    thumbnailUrl: null,
    publishedAt: '2024-04-15T18:30:00-04:00',
    notes: 'Verified WGAL photo gallery — Apr 15 2024 south-central PA hail event.',
  },
  {
    id: 'pa-2024-04-16-wgal-hail-video',
    region: 'pa',
    stormDate: '2024-04-15',
    title: 'Hail pelts cars and homes across South-Central PA',
    placeLabel: 'Spring Grove / York / Adams Counties, PA',
    sourceLabel: 'WGAL',
    provider: 'youtube',
    mediaType: 'video',
    externalUrl: 'https://www.wgal.com/article/south-central-pennsylvania-hail-video/60508979',
    thumbnailUrl: null,
    publishedAt: '2024-04-16T09:18:00-04:00',
    notes: 'Verified WGAL viewer-video roundup — Apr 15 2024 York/Adams Counties hail.',
  },

  // ── Richmond Area ─────────────────────────────────────
  {
    id: 'ra-2023-04-01-wtvr-hail-richmond',
    region: 'ra',
    stormDate: '2023-04-01',
    title: 'Cold front storms brought hail and strong winds to Virginia',
    placeLabel: 'Mechanicsville / Metro Richmond, VA',
    sourceLabel: 'WTVR CBS 6',
    provider: 'flickr',
    mediaType: 'image',
    externalUrl: 'https://www.wtvr.com/news/local-news/cold-front-triggered-storms-that-brought-hail-strong-winds-to-virginia',
    thumbnailUrl: null,
    publishedAt: '2023-04-01T21:00:00-04:00',
    notes: 'Verified WTVR coverage — Apr 1 2023 Metro Richmond hail, up to golf-ball size in Mechanicsville.',
  },

  // ── Dallas-Fort Worth, TX ─────────────────────────────
  {
    id: 'dfw-2024-05-28-nbc5-damage-photos',
    region: 'dfw',
    stormDate: '2024-05-28',
    title: 'Damage after hurricane-force winds, hail in North Texas',
    placeLabel: 'Dallas / Garland / Bedford / The Colony, TX',
    sourceLabel: 'NBC 5 Dallas-Fort Worth',
    provider: 'flickr',
    mediaType: 'image',
    externalUrl: 'https://www.nbcdfw.com/weather/weather-connection/trees-down-storm-damage-photos/3552535/',
    thumbnailUrl: null,
    publishedAt: '2024-05-28T22:00:00-05:00',
    notes: 'Verified NBC 5 DFW photo gallery — May 28 2024 storm. 95 mph winds, large hail. Dallas County disaster declared.',
  },
  {
    id: 'dfw-2025-06-01-nbc5-hail-photos',
    region: 'dfw',
    stormDate: '2025-06-01',
    title: 'Golf ball size and larger hail across North Texas',
    placeLabel: 'Tarrant County / Plano / Rockwall / Arlington, TX',
    sourceLabel: 'NBC 5 Dallas-Fort Worth',
    provider: 'flickr',
    mediaType: 'image',
    externalUrl: 'https://www.nbcdfw.com/weather/weather-connection/photos-hail-june-1-2025/3853498/',
    thumbnailUrl: null,
    publishedAt: '2025-06-01T21:00:00-05:00',
    notes: 'Verified NBC 5 DFW — Jun 1 2025. Up to 3-inch (baseball) hail. Massive roof damage across Tarrant County.',
  },

  // ── San Antonio / Austin / Central TX ─────────────────
  {
    id: 'satx-2024-05-09-ksat-hail-damage',
    region: 'satx',
    stormDate: '2024-05-09',
    title: 'Viewers share hail damage photos after Central Texas storm',
    placeLabel: 'Johnson City / San Marcos / Hays County, TX',
    sourceLabel: 'KSAT San Antonio',
    provider: 'flickr',
    mediaType: 'image',
    externalUrl: 'https://www.ksat.com/news/local/2024/05/10/ksat-viewers-share-pictures-and-videos-of-hail-damage-after-central-texas-storm/',
    thumbnailUrl: null,
    publishedAt: '2024-05-10T08:00:00-05:00',
    notes: 'Verified KSAT — May 9 2024. 6.25-inch hailstone in Johnson City (near TX state record). Buildings collapsed.',
  },
  {
    id: 'satx-2024-05-09-kxan-dvd-hail',
    region: 'satx',
    stormDate: '2024-05-09',
    title: 'DVD-size hail in Central Texas',
    placeLabel: 'Central Texas',
    sourceLabel: 'KXAN Austin',
    provider: 'youtube',
    mediaType: 'video',
    externalUrl: 'https://www.kxan.com/weather/severe-weather-brings-baseball-size-hail-in-central-texas/',
    thumbnailUrl: null,
    publishedAt: '2024-05-09T23:00:00-05:00',
    notes: 'Verified KXAN — May 9 2024 Central Texas supercell. Baseball+ hail with video coverage.',
  },

  // ── Houston, TX ───────────────────────────────────────
  {
    id: 'houston-2024-05-16-khou-derecho',
    region: 'houston',
    stormDate: '2024-05-16',
    title: 'Deadly derecho storm hits Houston with 100 mph winds',
    placeLabel: 'Houston / Harris County, TX',
    sourceLabel: 'KHOU 11',
    provider: 'youtube',
    mediaType: 'video',
    externalUrl: 'https://www.khou.com/article/weather/severe-weather/houston-weather-thunderstorm-may-2024/285-02e6b9d4-d76a-4a5f-8e6e-8b4f7f1cdae2',
    thumbnailUrl: null,
    publishedAt: '2024-05-16T22:00:00-05:00',
    notes: 'Verified KHOU — May 16 2024 Houston derecho. 100 mph winds, large hail, 7 fatalities. Over 1M without power.',
  },

  // ── Denver / Colorado ─────────────────────────────────
  {
    id: 'denver-2024-06-09-kdvr-hail-piles',
    region: 'denver',
    stormDate: '2024-06-09',
    title: 'Hail piles up during Sunday thunderstorm in Colorado',
    placeLabel: 'Castle Rock / Aurora / Douglas County, CO',
    sourceLabel: 'KDVR FOX 31 Denver',
    provider: 'flickr',
    mediaType: 'image',
    externalUrl: 'https://kdvr.com/weather/wx-news/photos-hail-piles-up-during-sunday-thunderstorm/',
    thumbnailUrl: null,
    publishedAt: '2024-06-09T19:00:00-06:00',
    notes: 'Verified KDVR — Jun 9 2024. Hail piled up like snow in Castle Rock and Aurora. Lightning sparked house fire.',
  },
  {
    id: 'cosprings-2024-05-22-kktv-yuma',
    region: 'cosprings',
    stormDate: '2024-05-22',
    title: 'Small Colorado town devastated by hailstorm',
    placeLabel: 'Yuma / Colorado Springs region, CO',
    sourceLabel: 'KKTV CBS',
    provider: 'youtube',
    mediaType: 'video',
    externalUrl: 'https://www.kktv.com/video/2024/05/22/small-colorado-town-devastated-by-hailstorm/',
    thumbnailUrl: null,
    publishedAt: '2024-05-22T18:00:00-06:00',
    notes: 'Verified KKTV — May 22 2024. Yuma devastated. Baseball-sized hail smashed windows. CO had $521M in hail claims in 2024.',
  },

  // ── Oklahoma ──────────────────────────────────────────
  {
    id: 'tulsa-2024-05-21-kjrh-hail-gallery',
    region: 'tulsa',
    stormDate: '2024-05-21',
    title: 'Hail storm gallery — Broken Arrow and Tulsa',
    placeLabel: 'Broken Arrow / South Tulsa, OK',
    sourceLabel: 'KJRH 2 News Oklahoma',
    provider: 'flickr',
    mediaType: 'image',
    externalUrl: 'https://www.kjrh.com/news/local-news/gallery-hail-storm-may-21',
    thumbnailUrl: null,
    publishedAt: '2024-05-21T21:00:00-05:00',
    notes: 'Verified KJRH — May 21 2024. Golf-ball to 4-inch hail in Broken Arrow. Roof and vehicle damage.',
  },

  // ── Kansas ────────────────────────────────────────────
  {
    id: 'wichita-2024-kake-hail-damage',
    region: 'wichita',
    stormDate: '2024-06-15',
    title: 'Large hail damages homes and cars in Wichita',
    placeLabel: 'Wichita, KS',
    sourceLabel: 'KAKE News',
    provider: 'flickr',
    mediaType: 'image',
    externalUrl: 'https://www.kake.com/home/large-hail-damages-homes-and-cars-in-wichita-after-storm/article_e7b425cd-71bc-42b1-a85d-343277b368de.html',
    thumbnailUrl: null,
    publishedAt: '2024-06-15T20:00:00-05:00',
    notes: 'Verified KAKE — 2024 Wichita hail event. Golf-ball hail punched holes in siding, dented cars, broke windows.',
  },

  // ── Kansas City / Missouri ────────────────────────────
  {
    id: 'kc-2024-03-14-gorilla-hail-npr',
    region: 'kc',
    stormDate: '2024-03-14',
    title: 'Baseball-sized "gorilla hail" hits Kansas and Missouri',
    placeLabel: 'Kansas City metro / I-70 corridor',
    sourceLabel: 'NPR / KCUR',
    provider: 'youtube',
    mediaType: 'video',
    externalUrl: 'https://www.npr.org/2024/03/14/1238571555/gorilla-hail-kansas-missouri',
    thumbnailUrl: null,
    publishedAt: '2024-03-14T22:00:00-05:00',
    notes: 'Verified NPR — Mar 14 2024. 4-inch "gorilla hail." I-70 standstill. Cracked windshields. National coverage.',
  },
  {
    id: 'kc-2024-03-14-kshb-northland',
    region: 'kc',
    stormDate: '2024-03-14',
    title: 'Large hail pelts the Northland, damaging cars and roofs',
    placeLabel: 'Kansas City Northland, MO',
    sourceLabel: 'KSHB 41',
    provider: 'flickr',
    mediaType: 'image',
    externalUrl: 'https://www.kshb.com/news/local-news/large-hail-pelts-the-northland-damaging-cars-and-roofs',
    thumbnailUrl: null,
    publishedAt: '2024-03-14T23:00:00-05:00',
    notes: 'Verified KSHB — Mar 14 2024 KC Northland. Large hail destroyed roofs and vehicles.',
  },

  // ── St. Louis, MO ────────────────────────────────────
  {
    id: 'stlouis-2024-04-02-ksdk-hail-damage',
    region: 'stlouis',
    stormDate: '2024-04-02',
    title: 'Hail, wind damage, flooding reported across St. Louis',
    placeLabel: 'St. Louis / St. Charles County, MO',
    sourceLabel: 'KSDK NBC St. Louis',
    provider: 'flickr',
    mediaType: 'image',
    externalUrl: 'https://www.ksdk.com/article/weather/severe-weather/hail-wind-damage-flooding-reported-st-louis-severe-storms/63-737d4a1a-0167-40f2-8749-55f5f495178e',
    thumbnailUrl: null,
    publishedAt: '2024-04-02T22:00:00-05:00',
    notes: 'Verified KSDK — Apr 2 2024. Golf-ball hail, 30-40 vehicles pulled over on I-55 with damage. 7,600 lost power.',
  },

  // ── Nebraska ──────────────────────────────────────────
  {
    id: 'omaha-2024-06-12-owh-supercell',
    region: 'omaha',
    stormDate: '2024-06-12',
    title: 'Mothership supercell brings hail damage and insurance claims to Omaha',
    placeLabel: 'Omaha / La Vista / Ralston, NE',
    sourceLabel: 'Omaha World-Herald',
    provider: 'flickr',
    mediaType: 'image',
    externalUrl: 'https://omaha.com/news/local/weather/article_43a62468-29bf-11ef-b182-c3d462688438.html',
    thumbnailUrl: null,
    publishedAt: '2024-06-13T10:00:00-05:00',
    notes: 'Verified OWH — Jun 12 2024. Golf-ball to teacup hail. 450 auto + 140 homeowner claims by next day.',
  },
  {
    id: 'omaha-2024-07-31-wowt-power',
    region: 'omaha',
    stormDate: '2024-07-31',
    title: '220,000 lose power as storms hit Omaha metro',
    placeLabel: 'Omaha / Lincoln / Saunders County, NE',
    sourceLabel: 'WOWT 6 News',
    provider: 'youtube',
    mediaType: 'video',
    externalUrl: 'https://www.wowt.com/2024/07/31/live-updates-thousands-without-power-omaha-metro-after-severe-weather-blows-through/',
    thumbnailUrl: null,
    publishedAt: '2024-07-31T22:00:00-05:00',
    notes: 'Verified WOWT — Jul 31 2024. 90+ mph winds, 220K lost power. Trees and vehicles damaged across metro.',
  },

  // ── Minnesota ─────────────────────────────────────────
  {
    id: 'msp-2024-07-31-kare11-giant-hail',
    region: 'msp',
    stormDate: '2024-07-31',
    title: 'Western Minnesota pummeled by giant hail',
    placeLabel: 'Chokio / Stevens County / Twin Cities, MN',
    sourceLabel: 'KARE 11',
    provider: 'youtube',
    mediaType: 'video',
    externalUrl: 'https://www.kare11.com/article/weather/western-minnesota-assesses-damage-after-pummeled-by-hail/89-be2224be-93d9-44cf-85e9-0ec37dee1652',
    thumbnailUrl: null,
    publishedAt: '2024-08-01T08:00:00-05:00',
    notes: 'Verified KARE 11 — Jul 31 2024. Near-record 6-inch hailstone in Chokio. Largest MN hail in 38 years.',
  },

  // ── Georgia ───────────────────────────────────────────
  {
    id: 'atlanta-2024-05-11alive-hail-photos',
    region: 'atlanta',
    stormDate: '2024-05-15',
    title: 'Videos and photos show hail around metro Atlanta',
    placeLabel: 'Metro Atlanta / North Georgia',
    sourceLabel: '11Alive',
    provider: 'flickr',
    mediaType: 'image',
    externalUrl: 'https://www.11alive.com/article/weather/videos-photos-hail-metro-atlanta/85-a680d4a0-70aa-4f4e-9b3d-06f1306db8b4',
    thumbnailUrl: null,
    publishedAt: '2024-05-15T20:00:00-04:00',
    notes: 'Verified 11Alive — May 2024. Multiple rounds of hail across north Georgia. Vehicle and building damage.',
  },
  {
    id: 'atlanta-2024-05-wsbtv-hail-gallery',
    region: 'atlanta',
    stormDate: '2024-05-15',
    title: 'Hail coming down across north Georgia',
    placeLabel: 'North Georgia / Troup County',
    sourceLabel: 'WSB-TV Channel 2',
    provider: 'flickr',
    mediaType: 'image',
    externalUrl: 'https://www.wsbtv.com/news/photos-hail-coming/YBVUYCZZPJAUPLQNOTQV2DKPBE/',
    thumbnailUrl: null,
    publishedAt: '2024-05-15T21:00:00-04:00',
    notes: 'Verified WSB-TV — May 2024 north Georgia hail photo gallery from viewers.',
  },

  // ── North Carolina ────────────────────────────────────
  {
    id: 'charlotte-2024-04-20-wsoc-hail',
    region: 'charlotte',
    stormDate: '2024-04-20',
    title: 'Large hailstones cut power to thousands in Charlotte area',
    placeLabel: 'Charlotte / Gaston County, NC',
    sourceLabel: 'WSOC-TV',
    provider: 'youtube',
    mediaType: 'video',
    externalUrl: 'https://www.wsoctv.com/news/local/severe-thunderstorms-bring-large-hail-knock-down-trees-cuts-power-thousands/YTULPZVGIJHCDNQJVFLZ6BB3EU/',
    thumbnailUrl: null,
    publishedAt: '2024-04-20T20:00:00-04:00',
    notes: 'Verified WSOC-TV — Apr 20 2024. Golf-ball hail in Charlotte area. 4,000+ Duke Energy outages.',
  },

  // ── South Carolina ────────────────────────────────────
  {
    id: 'greenville-2024-04-20-rockhill-softball',
    region: 'greenville',
    stormDate: '2024-04-20',
    title: 'Softball-size hail destroys property in the Carolinas',
    placeLabel: 'Rock Hill / York County, SC',
    sourceLabel: 'Fox Weather / WCNC',
    provider: 'youtube',
    mediaType: 'video',
    externalUrl: 'https://www.foxweather.com/extreme-weather/softball-size-hail-south-carolina-hailstorm',
    thumbnailUrl: null,
    publishedAt: '2024-04-21T10:00:00-04:00',
    notes: 'Verified Fox Weather — Apr 20 2024. 4-inch (softball) hail, largest in SC in 13 years. 70-90 mph winds.',
  },

  // ── Tennessee ─────────────────────────────────────────
  {
    id: 'nashville-2024-05-08-wkrn-storms',
    region: 'nashville',
    stormDate: '2024-05-08',
    title: 'Severe weather rolls through Middle Tennessee',
    placeLabel: 'Nashville / Maury County, TN',
    sourceLabel: 'WKRN',
    provider: 'flickr',
    mediaType: 'image',
    externalUrl: 'https://www.wkrn.com/news/local-news/gallery-severe-weather-rolls-through-middle-tn-may-8-2024/amp/',
    thumbnailUrl: null,
    publishedAt: '2024-05-08T22:00:00-05:00',
    notes: 'Verified WKRN — May 8 2024. Hail, tornadoes, flooding in Middle Tennessee. Fatality in Maury County.',
  },
  {
    id: 'nashville-2024-05-08-wkrn-hail-video',
    region: 'nashville',
    stormDate: '2024-05-08',
    title: 'Hail reports from storms across Middle Tennessee',
    placeLabel: 'Middle Tennessee',
    sourceLabel: 'WKRN',
    provider: 'youtube',
    mediaType: 'video',
    externalUrl: 'https://www.wkrn.com/video/hail-reports-from-storms-across-middle-tennessee/10735082/',
    thumbnailUrl: null,
    publishedAt: '2024-05-08T23:00:00-05:00',
    notes: 'Verified WKRN video — May 8 2024 hail reports compilation across Middle Tennessee.',
  },

  // ── Alabama ───────────────────────────────────────────
  {
    id: 'birmingham-2025-05-03-wbrc-golfball',
    region: 'birmingham',
    stormDate: '2025-05-03',
    title: 'Golf ball size hail and storm damage in central Alabama',
    placeLabel: 'Central Alabama / Birmingham, AL',
    sourceLabel: 'WBRC FOX 6',
    provider: 'youtube',
    mediaType: 'video',
    externalUrl: 'https://www.wbrc.com/video/2025/05/03/golf-ball-size-hail-storm-damage-central-alabama/',
    thumbnailUrl: null,
    publishedAt: '2025-05-03T20:00:00-05:00',
    notes: 'Verified WBRC — May 3 2025. Golf-ball hail across central Alabama. Roof and vehicle damage.',
  },

  // ── Iowa ──────────────────────────────────────────────
  {
    id: 'desmoines-2024-05-21-cbs2-hail-tornado',
    region: 'desmoines',
    stormDate: '2024-05-21',
    title: 'Large hail and tornados rip through Iowa',
    placeLabel: 'Des Moines / Greenfield, IA',
    sourceLabel: 'CBS2 Iowa',
    provider: 'youtube',
    mediaType: 'video',
    externalUrl: 'https://cbs2iowa.com/amp/news/local/storms-that-dropped-large-hail-and-buckets-of-rain-in-omaha-spin-up-tornados-in-iowa',
    thumbnailUrl: null,
    publishedAt: '2024-05-21T23:00:00-05:00',
    notes: 'Verified CBS2 Iowa — May 21 2024. Softball-sized hail. Des Moines airport closed. Multiple fatalities in Greenfield tornado.',
  },

  // ── Chicago / Illinois ────────────────────────────────
  {
    id: 'chicago-2024-08-27-nbcchicago-tennis-hail',
    region: 'chicago',
    stormDate: '2024-08-27',
    title: 'Storms pack tennis ball-sized hail across Chicago area',
    placeLabel: 'Woodstock / Wauconda / Northern suburbs, IL',
    sourceLabel: 'NBC Chicago',
    provider: 'flickr',
    mediaType: 'image',
    externalUrl: 'https://www.nbcchicago.com/news/local/storms-pack-tennis-ball-sized-hail-cause-thousands-to-lose-power-across-chicago-area/2607045/',
    thumbnailUrl: null,
    publishedAt: '2024-08-27T21:00:00-05:00',
    notes: 'Verified NBC Chicago — Aug 27 2024. 2.5-inch hail in Woodstock. 80 mph gusts. 400K+ lost power across region.',
  },
  {
    id: 'chicago-2024-08-27-wgn-hail-photos',
    region: 'chicago',
    stormDate: '2024-08-27',
    title: 'Severe weather hits Chicagoland with hailstones',
    placeLabel: 'Chicago suburbs, IL',
    sourceLabel: 'WGN-TV',
    provider: 'flickr',
    mediaType: 'image',
    externalUrl: 'https://wgntv.com/weather/photos-severe-weather-hits-chicagoland-with-golf-ball-sized-hail/',
    thumbnailUrl: null,
    publishedAt: '2024-08-27T22:00:00-05:00',
    notes: 'Verified WGN-TV photo gallery — Aug 27 2024 Chicagoland hailstones.',
  },

  // ── Indianapolis / Indiana ────────────────────────────
  {
    id: 'indianapolis-2024-wthr-hail-vehicles',
    region: 'indianapolis',
    stormDate: '2024-06-20',
    title: 'Large hail damages vehicles across central Indiana',
    placeLabel: 'Fishers / Broad Ripple / Hamilton County, IN',
    sourceLabel: 'WTHR',
    provider: 'flickr',
    mediaType: 'image',
    externalUrl: 'https://www.wthr.com/article/weather/large-hail-damages-vehicles-across-central-indiana/531-9183057e-f35e-40ba-9029-83bea7e31317',
    thumbnailUrl: null,
    publishedAt: '2024-06-20T21:00:00-04:00',
    notes: 'Verified WTHR — 2024. Large hail in Fishers and Broad Ripple. Aircraft damaged at Metro Airport. Lightning fire.',
  },
];

// ── Region Detection ────────────────────────────────────

interface RegionBounds {
  code: RegionalCode;
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
  keywords: string[];
}

const REGION_BOUNDS: RegionBounds[] = [
  // East Coast
  { code: 'dmv', latMin: 38.1, latMax: 40.3, lngMin: -78.8, lngMax: -75.5, keywords: ['maryland', 'virginia', 'district of columbia', 'washington, dc', ', va', ', md', ', dc', 'baltimore', 'arlington', 'alexandria', 'bethesda', 'silver spring', 'fairfax', 'owings mills'] },
  { code: 'pa', latMin: 39.5, latMax: 42.5, lngMin: -81, lngMax: -74.3, keywords: ['pennsylvania', ', pa', 'pittsburgh', 'philadelphia', 'harrisburg', 'york', 'lancaster', 'allentown'] },
  { code: 'ra', latMin: 36.8, latMax: 38.3, lngMin: -78.8, lngMax: -76.4, keywords: ['richmond', 'henrico', 'mechanicsville', 'chesterfield', 'glen allen'] },

  // Texas
  { code: 'dfw', latMin: 32.0, latMax: 33.8, lngMin: -98.0, lngMax: -96.0, keywords: ['dallas', 'fort worth', 'arlington', 'plano', 'irving', 'garland', 'frisco', 'mckinney', 'denton', 'tarrant'] },
  { code: 'satx', latMin: 28.5, latMax: 31.5, lngMin: -99.5, lngMax: -96.5, keywords: ['san antonio', 'austin', 'san marcos', 'new braunfels', 'round rock', 'bexar', 'travis', 'hays county', 'johnson city'] },
  { code: 'houston', latMin: 28.5, latMax: 30.8, lngMin: -96.5, lngMax: -94.0, keywords: ['houston', 'harris county', 'katy', 'sugar land', 'the woodlands', 'pasadena', 'galveston'] },

  // Mountain / Plains
  { code: 'denver', latMin: 39.0, latMax: 40.5, lngMin: -105.5, lngMax: -104.0, keywords: ['denver', 'aurora', 'lakewood', 'castle rock', 'boulder', 'douglas county', 'broomfield'] },
  { code: 'cosprings', latMin: 37.5, latMax: 39.5, lngMin: -106.0, lngMax: -103.5, keywords: ['colorado springs', 'pueblo', 'el paso county', 'yuma'] },
  { code: 'tulsa', latMin: 35.5, latMax: 37.0, lngMin: -96.5, lngMax: -95.0, keywords: ['tulsa', 'broken arrow', 'muskogee', 'owasso', 'jenks', 'sand springs'] },
  { code: 'okc', latMin: 34.5, latMax: 36.0, lngMin: -98.5, lngMax: -96.5, keywords: ['oklahoma city', 'norman', 'edmond', 'moore', 'yukon', 'midwest city'] },
  { code: 'wichita', latMin: 37.0, latMax: 38.5, lngMin: -98.0, lngMax: -96.5, keywords: ['wichita', 'derby', 'andover', 'sedgwick'] },
  { code: 'topeka', latMin: 38.5, latMax: 40.0, lngMin: -96.5, lngMax: -95.0, keywords: ['topeka', 'lawrence', 'manhattan, ks', 'junction city'] },
  { code: 'kc', latMin: 38.5, latMax: 39.8, lngMin: -95.5, lngMax: -93.8, keywords: ['kansas city', 'overland park', 'olathe', 'independence', 'lee\'s summit', 'blue springs'] },
  { code: 'stlouis', latMin: 38.0, latMax: 39.2, lngMin: -91.5, lngMax: -89.5, keywords: ['st. louis', 'st louis', 'st charles', 'maryland heights', 'chesterfield, mo'] },

  // Midwest
  { code: 'omaha', latMin: 40.5, latMax: 42.0, lngMin: -97.0, lngMax: -95.5, keywords: ['omaha', 'lincoln', 'la vista', 'bellevue', 'papillion', 'ralston'] },
  { code: 'msp', latMin: 44.0, latMax: 46.0, lngMin: -94.5, lngMax: -92.5, keywords: ['minneapolis', 'st. paul', 'saint paul', 'bloomington', 'eden prairie', 'plymouth', 'twin cities', 'monticello'] },
  { code: 'desmoines', latMin: 41.0, latMax: 42.5, lngMin: -94.5, lngMax: -93.0, keywords: ['des moines', 'west des moines', 'ankeny', 'urbandale', 'ames'] },
  { code: 'chicago', latMin: 41.0, latMax: 42.8, lngMin: -89.0, lngMax: -87.0, keywords: ['chicago', 'naperville', 'aurora', 'joliet', 'elgin', 'schaumburg', 'woodstock', 'wauconda', 'tinley park'] },
  { code: 'indianapolis', latMin: 39.2, latMax: 40.4, lngMin: -87.0, lngMax: -85.5, keywords: ['indianapolis', 'fishers', 'carmel', 'greenwood', 'noblesville', 'hamilton county'] },

  // Southeast
  { code: 'atlanta', latMin: 33.0, latMax: 34.5, lngMin: -85.0, lngMax: -83.5, keywords: ['atlanta', 'marietta', 'roswell', 'decatur', 'alpharetta', 'kennesaw', 'lawrenceville'] },
  { code: 'charlotte', latMin: 34.5, latMax: 36.0, lngMin: -81.5, lngMax: -79.5, keywords: ['charlotte', 'gastonia', 'concord', 'huntersville', 'matthews', 'gaston county'] },
  { code: 'raleigh', latMin: 35.0, latMax: 36.5, lngMin: -80.0, lngMax: -78.0, keywords: ['raleigh', 'durham', 'chapel hill', 'cary', 'wake county', 'triangle'] },
  { code: 'greenville', latMin: 33.5, latMax: 35.5, lngMin: -83.0, lngMax: -80.5, keywords: ['greenville', 'spartanburg', 'anderson', 'rock hill', 'york county, sc', 'columbia, sc'] },
  { code: 'nashville', latMin: 35.5, latMax: 36.8, lngMin: -87.5, lngMax: -85.5, keywords: ['nashville', 'murfreesboro', 'franklin', 'hendersonville', 'gallatin', 'maury county'] },
  { code: 'memphis', latMin: 34.5, latMax: 36.0, lngMin: -90.5, lngMax: -88.5, keywords: ['memphis', 'germantown', 'bartlett', 'collierville', 'shelby county'] },
  { code: 'birmingham', latMin: 32.8, latMax: 34.5, lngMin: -88.0, lngMax: -86.0, keywords: ['birmingham', 'hoover', 'vestavia', 'tuscaloosa', 'jefferson county, al'] },
  { code: 'huntsville', latMin: 34.2, latMax: 35.5, lngMin: -87.5, lngMax: -85.5, keywords: ['huntsville', 'decatur', 'athens', 'madison, al', 'hartselle'] },
];

function detectRegions(location: LatLng, label: string): RegionalCode[] {
  const normalizedLabel = label.toLowerCase();
  const matches: RegionalCode[] = [];

  for (const region of REGION_BOUNDS) {
    const keywordMatch = region.keywords.some((kw) => normalizedLabel.includes(kw));
    const boundsMatch = location.lat >= region.latMin && location.lat <= region.latMax && location.lng >= region.lngMin && location.lng <= region.lngMax;
    if (keywordMatch || boundsMatch) {
      matches.push(region.code);
    }
  }

  return matches;
}

// ── Public API ──────────────────────────────────────────

function makeEvidenceId(propertyLabel: string, seedId: string): string {
  return `regional-${propertyLabel}-${seedId}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-');
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
        : 'Regional nearby sample for this search area.'),
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
  const regions = detectRegions(location, searchSummary.locationLabel);
  if (regions.length === 0) {
    return [];
  }

  const activeDates = new Set(stormDates.map((sd) => sd.date));
  const regionalSeeds = REGIONAL_SEED_CATALOG.filter((seed) => regions.includes(seed.region));

  // First try exact date matches
  const exactMatches = regionalSeeds
    .filter((seed) => activeDates.has(seed.stormDate))
    .map((seed) => mapSeedToEvidence(searchSummary, seed, 'exact'));

  if (exactMatches.length > 0) {
    return exactMatches;
  }

  // Fall back to closest dates
  const referenceDate = stormDates[0]?.date ?? regionalSeeds[0]?.stormDate ?? null;
  if (!referenceDate) {
    return [];
  }

  return [...regionalSeeds]
    .sort((a, b) => Math.abs(toEpoch(a.stormDate) - toEpoch(referenceDate)) - Math.abs(toEpoch(b.stormDate) - toEpoch(referenceDate)))
    .slice(0, 6)
    .map((seed) => mapSeedToEvidence(searchSummary, seed, 'regional-nearby'));
}

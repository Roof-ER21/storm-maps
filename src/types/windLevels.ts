/**
 * Wind damage palette — stays in sync with `server/storm/types.ts`
 * `WIND_BAND_LEVELS` so the frontend legend matches what the backend emits.
 */

export type WindSeverity =
  | 'breezy'
  | 'damaging'
  | 'severe'
  | 'very_severe'
  | 'extreme';

export interface WindBandLevel {
  minMph: number;
  maxMph: number;
  label: string;
  color: string;
  severity: WindSeverity;
  /** One-liner shown to reps under the legend / on hover. */
  fieldNotes: string;
}

export const WIND_BAND_LEVELS: WindBandLevel[] = [
  {
    minMph: 50,
    maxMph: 58,
    label: '50–57 mph',
    color: '#FFEB99',
    severity: 'breezy',
    fieldNotes: 'Loose shingle uplift possible. Insurer threshold for "wind event" claim review.',
  },
  {
    minMph: 58,
    maxMph: 65,
    label: '58–64 mph',
    color: '#FFCC33',
    severity: 'damaging',
    fieldNotes: 'NWS severe-criteria gust. Common siding & ridge-cap blow-off. File a claim if any uplift.',
  },
  {
    minMph: 65,
    maxMph: 75,
    label: '65–74 mph',
    color: '#FF8800',
    severity: 'severe',
    fieldNotes: '3-tab failure threshold. Expect missing shingles, tear-off scope claims.',
  },
  {
    minMph: 75,
    maxMph: 90,
    label: '75–89 mph',
    color: '#FF3300',
    severity: 'very_severe',
    fieldNotes: 'Architectural shingle uplift, fence damage, gutter detachment. Photograph everything.',
  },
  {
    minMph: 90,
    maxMph: 999,
    label: '90 mph+',
    color: '#990033',
    severity: 'extreme',
    fieldNotes: 'Structural damage threshold. Multi-trade scope (roof, siding, framing).',
  },
];

export function getWindBand(mph: number): WindBandLevel | null {
  if (!Number.isFinite(mph) || mph < WIND_BAND_LEVELS[0].minMph) return null;
  for (const band of WIND_BAND_LEVELS) {
    if (mph >= band.minMph && mph < band.maxMph) return band;
  }
  return WIND_BAND_LEVELS[WIND_BAND_LEVELS.length - 1];
}

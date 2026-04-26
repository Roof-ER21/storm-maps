/**
 * IHM / HailTrace 10-band forensic hail size palette.
 *
 * Matches the backend `meshVectorService.ts` levels. Keep these in sync.
 * Backend emits `feature.properties.color/label/sizeInches` from this table,
 * and the frontend Legend reads from it directly.
 */

export interface IhmHailLevel {
  sizeInches: number;
  sizeMm: number;
  label: string;
  color: string;
  severity: 'trace' | 'minor' | 'moderate' | 'severe' | 'very_severe' | 'extreme';
}

// Refined IHM palette — perceptually-graded progression with saturated
// chromatic colors instead of the previous near-white traces. Trace bands
// are now actually visible without being jarring; Severe+ bands pop on
// the map without looking muddy. Tuned against fillOpacity 0.5 in
// HailSwathLayer so the rendered colors land close to these RGB values.
export const IHM_HAIL_LEVELS: IhmHailLevel[] = [
  { sizeInches: 0.13, sizeMm: 3.3,   label: '⅛"',  color: '#FEF3B0', severity: 'trace' },
  { sizeInches: 0.25, sizeMm: 6.35,  label: '¼"',  color: '#FDE68A', severity: 'trace' },
  { sizeInches: 0.38, sizeMm: 9.53,  label: '⅜"',  color: '#FCD34D', severity: 'trace' },
  { sizeInches: 0.50, sizeMm: 12.7,  label: '½"',  color: '#FBBF24', severity: 'trace' },
  { sizeInches: 0.75, sizeMm: 19.05, label: '¾"',  color: '#F59E0B', severity: 'minor' },
  { sizeInches: 1.00, sizeMm: 25.4,  label: '1"',  color: '#F97316', severity: 'moderate' },
  { sizeInches: 1.25, sizeMm: 31.75, label: '1¼"', color: '#EA580C', severity: 'moderate' },
  { sizeInches: 1.50, sizeMm: 38.1,  label: '1½"', color: '#DC2626', severity: 'severe' },
  { sizeInches: 1.75, sizeMm: 44.45, label: '1¾"', color: '#B91C1C', severity: 'severe' },
  { sizeInches: 2.00, sizeMm: 50.8,  label: '2"',  color: '#BE185D', severity: 'very_severe' },
  { sizeInches: 2.25, sizeMm: 57.15, label: '2¼"', color: '#9D174D', severity: 'very_severe' },
  { sizeInches: 2.50, sizeMm: 63.5,  label: '2½"', color: '#7C2D92', severity: 'extreme' },
  { sizeInches: 3.00, sizeMm: 76.2,  label: '3"+', color: '#5B21B6', severity: 'extreme' },
];

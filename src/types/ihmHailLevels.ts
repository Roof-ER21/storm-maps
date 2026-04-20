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

export const IHM_HAIL_LEVELS: IhmHailLevel[] = [
  { sizeInches: 0.13, sizeMm: 3.3,   label: '⅛"',  color: '#FFFFE6', severity: 'trace' },
  { sizeInches: 0.25, sizeMm: 6.35,  label: '¼"',  color: '#FFFBCC', severity: 'trace' },
  { sizeInches: 0.38, sizeMm: 9.53,  label: '⅜"',  color: '#FFF7B3', severity: 'trace' },
  { sizeInches: 0.50, sizeMm: 12.7,  label: '½"',  color: '#FFFF99', severity: 'trace' },
  { sizeInches: 0.75, sizeMm: 19.05, label: '¾"',  color: '#FFCC29', severity: 'minor' },
  { sizeInches: 1.00, sizeMm: 25.4,  label: '1"',  color: '#FF991F', severity: 'moderate' },
  { sizeInches: 1.25, sizeMm: 31.75, label: '1¼"', color: '#FF6614', severity: 'moderate' },
  { sizeInches: 1.50, sizeMm: 38.1,  label: '1½"', color: '#FF330A', severity: 'severe' },
  { sizeInches: 1.75, sizeMm: 44.45, label: '1¾"', color: '#FF0000', severity: 'severe' },
  { sizeInches: 2.00, sizeMm: 50.8,  label: '2"',  color: '#E60040', severity: 'very_severe' },
  { sizeInches: 2.25, sizeMm: 57.15, label: '2¼"', color: '#CC0080', severity: 'very_severe' },
  { sizeInches: 2.50, sizeMm: 63.5,  label: '2½"', color: '#B300BF', severity: 'extreme' },
  { sizeInches: 3.00, sizeMm: 76.2,  label: '3"+', color: '#9900FF', severity: 'extreme' },
];

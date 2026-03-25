/**
 * Xactimate Roofing Line Item Codes - Storm-related subset
 *
 * Copied from gemini-field-assistant and filtered for
 * storm damage relevant codes. Full database is in
 * /Users/a21/gemini-field-assistant/src/data/xactimate-roofing-codes.ts
 *
 * These codes are used to auto-generate scope-of-work estimates
 * when a roof is identified within a hail swath.
 */

export type UnitOfMeasure = 'SQ' | 'LF' | 'SF' | 'EA' | 'HR' | '%' | 'DAY';

export type XactimateCategory =
  | 'tear-off'
  | 'shingle-install'
  | 'underlayment'
  | 'flashing'
  | 'ventilation'
  | 'accessory'
  | 'decking'
  | 'gutter-soffit-fascia'
  | 'overhead-profit'
  | 'misc';

export interface XactimateCode {
  code: string;
  description: string;
  unit: UnitOfMeasure;
  category: XactimateCategory;
  priceRange: [number, number];
  commonlySupplement: boolean;
  notes?: string;
}

// TODO: Import full code list from gemini-field-assistant
// For now, include the most common storm-damage codes
export const STORM_DAMAGE_CODES: XactimateCode[] = [
  {
    code: 'RFG ARMV>',
    description: 'Tear off comp. shingles - Laminated (1 layer)',
    unit: 'SQ',
    category: 'tear-off',
    priceRange: [85, 150],
    commonlySupplement: false,
  },
  {
    code: 'RFG 260',
    description: 'Roofing felt - 15 lb.',
    unit: 'SQ',
    category: 'underlayment',
    priceRange: [18, 35],
    commonlySupplement: false,
  },
  {
    code: 'RFG 300',
    description: 'Comp. shingles - 25 year - 3 tab',
    unit: 'SQ',
    category: 'shingle-install',
    priceRange: [175, 280],
    commonlySupplement: false,
  },
  {
    code: 'RFG 310',
    description: 'Comp. shingles - 30 year - Laminated/Architectural',
    unit: 'SQ',
    category: 'shingle-install',
    priceRange: [210, 340],
    commonlySupplement: false,
  },
  {
    code: 'RFG 400',
    description: 'Drip edge',
    unit: 'LF',
    category: 'flashing',
    priceRange: [2.5, 5.0],
    commonlySupplement: true,
    notes: 'Required by code IRC R905.2.8.5. Commonly missed by adjusters.',
  },
  {
    code: 'RFG 210',
    description: 'Ice & water shield membrane',
    unit: 'SQ',
    category: 'underlayment',
    priceRange: [95, 160],
    commonlySupplement: true,
    notes: 'Required in first 3 feet from eave edge per IRC R905.2.7.1.',
  },
  {
    code: 'RFG 500',
    description: 'Ridge cap shingles',
    unit: 'LF',
    category: 'shingle-install',
    priceRange: [4.5, 9.0],
    commonlySupplement: false,
  },
  {
    code: 'RFG 640',
    description: 'Pipe jack/boot flashing',
    unit: 'EA',
    category: 'flashing',
    priceRange: [45, 85],
    commonlySupplement: true,
    notes: 'Must be replaced on every re-roof per manufacturer warranty requirements.',
  },
];

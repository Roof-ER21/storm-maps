/**
 * Carrier-name canonical normalizer — single source of truth.
 *
 * Used by:
 *   - server/intel/denial-analyzer.ts (carrier-hint matching, patent lookup)
 *   - scripts/roofdocs/build-denial-corpus.mjs (corpus aggregation)
 *   - scripts/roofdocs/extract-boilerplate.mjs (per-carrier phrase grouping)
 *   - scripts/roofdocs/corpus-stats.mjs (coverage reporting)
 *
 * Add a new variant by editing the CANONICAL array below. Everything that
 * imports this file picks it up automatically.
 */

/**
 * Canonical carriers, in priority order. Each entry's `matches` is a list of
 * lowercase substring patterns; the FIRST canonical whose pattern is found in
 * the lowercased input wins. Order matters when carriers contain overlapping
 * words (e.g., "Allstate Indemnity" must match Allstate before any generic
 * "indemnity" pattern).
 */
export const CANONICAL = [
  {
    name: 'Allstate',
    matches: [
      'allstate vehicle and property',
      'allstate indemnity',
      'allstate insurance',
      'allstate',
    ],
  },
  {
    name: 'State Farm',
    matches: [
      'state farm fire and casualty',
      'state farm mutual',
      'state farm',
      'statefarm',
    ],
  },
  {
    name: 'USAA',
    matches: [
      'usaa general indemnity',
      'usaa casualty insurance',
      'usaa',
    ],
  },
  {
    name: 'Travelers',
    matches: [
      'travco',
      'the standard fire insurance company',
      'standard fire insurance',
      'the automobile insurance company of hartford',
      'automobile insurance company of hartford',
      'travelers personal insurance',
      'travelers',
    ],
  },
  {
    name: 'Liberty Mutual',
    matches: [
      'liberty mutual insurance',
      'liberty mutual',
      'safeco',
    ],
  },
  {
    name: 'Nationwide',
    matches: [
      'nationwide property',
      'nationwide mutual',
      'nationwide',
    ],
  },
  {
    name: 'Encompass',
    matches: [
      'encompass insurance',
      'encompass',
      'ngic',
      'national general',
    ],
  },
  {
    name: 'Erie',
    matches: [
      'erie insurance exchange',
      'erie insurance',
      'erie',
    ],
  },
  {
    name: 'Utica National',
    matches: [
      'utica national insurance group',
      'utica national',
      'utica',
    ],
  },
  {
    name: 'AMIG (Cincinnati Financial)',
    matches: [
      'american modern insurance group',
      'american modern',
      'amig',
      'cincinnati financial',
      'cincinnati insurance',
    ],
  },
  {
    name: 'Progressive',
    matches: ['progressive'],
  },
  {
    name: 'Selective',
    matches: ['selective insurance', 'selective'],
  },
  {
    name: 'Farmers',
    matches: ['farmers insurance', 'farmers'],
  },
  {
    name: 'Chubb',
    matches: ['chubb'],
  },
  {
    name: 'Geico',
    matches: ['geico'],
  },
  {
    name: 'Lemonade',
    matches: ['lemonade'],
  },
  {
    name: 'The Hartford',
    matches: ['the hartford', 'hartford'],
  },
];

const _matchTable = (() => {
  // Pre-compute longest patterns first WITHIN each carrier so "allstate indemnity"
  // wins over plain "allstate" when both are present.
  return CANONICAL.map((c) => ({
    name: c.name,
    matches: [...c.matches].sort((a, b) => b.length - a.length),
  }));
})();

/**
 * Normalize a raw carrier string to its canonical name.
 * Returns null when the input is empty/whitespace OR doesn't match anything.
 *
 * Examples:
 *   normalizeCarrier('USAA')                                                    → 'USAA'
 *   normalizeCarrier('usaa general indemnity company')                          → 'USAA'
 *   normalizeCarrier('USAA / USAA General Indemnity / USAA Casualty')           → 'USAA'
 *   normalizeCarrier('TravCo Insurance Company')                                → 'Travelers'
 *   normalizeCarrier('Allstate Indemnity Company')                              → 'Allstate'
 *   normalizeCarrier('Liberty Mutual Insurance')                                → 'Liberty Mutual'
 *   normalizeCarrier('VENDOR_MULTI')                                            → null
 *   normalizeCarrier('')                                                        → null
 */
export function normalizeCarrier(raw) {
  const n = (raw || '').toString().toLowerCase().trim();
  if (!n) return null;
  // First-wins; within each carrier, longest pattern wins (sorted above).
  for (const c of _matchTable) {
    for (const m of c.matches) {
      if (n.includes(m)) return c.name;
    }
  }
  return null;
}

/**
 * List all canonical carrier names.
 */
export function listCanonicalCarriers() {
  return CANONICAL.map((c) => c.name);
}

/**
 * Test whether a raw string matches a specific canonical carrier.
 * Handy for filtering: `entries.filter(e => isCarrier(e.carrier, 'Travelers'))`.
 */
export function isCarrier(raw, target) {
  return normalizeCarrier(raw) === target;
}

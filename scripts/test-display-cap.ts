/**
 * scripts/test-display-cap.ts — assertion smoke tests for the display-cap
 * algorithm. Mirrors test/displayCap.spec.ts shape from the 2026-04-27
 * handoff, but runs as a standalone tsx script (we don't have vitest /
 * jest set up in this repo).
 *
 * Run:
 *   npx tsx scripts/test-display-cap.ts
 *
 * Exits 0 when every case passes, 1 otherwise.
 */

import {
  computeConsensusSize,
  displayHailInches,
  isSterlingClassStorm,
  type VerificationContext,
} from '../server/storm/displayCapService.ts';

const verified: VerificationContext = {
  isVerified: true,
  isAtLocation: true,
  isSterlingClass: false,
  consensusSize: null,
};
const verifiedNotAtLoc: VerificationContext = {
  isVerified: true,
  isAtLocation: false,
  isSterlingClass: false,
  consensusSize: null,
};
const unverified: VerificationContext = {
  isVerified: false,
  isAtLocation: true,
  isSterlingClass: false,
  consensusSize: null,
};
const sterling: VerificationContext = {
  isVerified: true,
  isAtLocation: true,
  isSterlingClass: true,
  consensusSize: null,
};
const consensusOneFive: VerificationContext = {
  isVerified: false,
  isAtLocation: true,
  isSterlingClass: false,
  consensusSize: 1.5,
};
const consensusTwoFive: VerificationContext = {
  isVerified: false,
  isAtLocation: true,
  isSterlingClass: false,
  consensusSize: 2.5,
};
const consensusOutOfRange: VerificationContext = {
  isVerified: false,
  isAtLocation: true,
  isSterlingClass: false,
  consensusSize: 2.75, // ≥2.6 → ignored, falls through to cap
};

interface Case {
  name: string;
  raw: number;
  ctx: VerificationContext;
  expect: number | null;
  /** When true, this case differs from the handoff doc — we
   *  deliberately resolve the rule-table position. */
  spec_correction?: string;
}

const cases: Case[] = [
  // Suppress threshold = <0.25 (post-clarification: meeting said
  // "minimum 0.75" with no explicit suppress, but we keep a sub-trace
  // floor at 0.25 — Ahmed confirmed Option C)
  { name: '0.1 → null (sub-trace, no event)', raw: 0.1, ctx: verified, expect: null },
  { name: '0.2 → null (under 0.25 suppress)', raw: 0.2, ctx: verified, expect: null },
  { name: '0.24 → null (just under suppress)', raw: 0.24, ctx: verified, expect: null },

  // Floor 0.25–0.74 → 0.75
  { name: '0.25 → 0.75 (just at suppress edge)', raw: 0.25, ctx: verified, expect: 0.75 },
  { name: '0.33 → 0.75 (the meeting example)', raw: 0.33, ctx: verified, expect: 0.75 },
  { name: '0.38 → 0.75 (Russ said this rounds up)', raw: 0.38, ctx: verified, expect: 0.75 },
  { name: '0.5 → 0.75 (floor)', raw: 0.5, ctx: verified, expect: 0.75 },
  { name: '0.63 → 0.75 (Russ\'s example)', raw: 0.63, ctx: verified, expect: 0.75 },
  { name: '0.74 → 0.75 (floor)', raw: 0.74, ctx: verified, expect: 0.75 },

  // Pass-through 0.75–2.0
  { name: '0.75 → 0.75', raw: 0.75, ctx: verified, expect: 0.75 },
  { name: '1.25 → 1.25', raw: 1.25, ctx: verified, expect: 1.25 },
  { name: '1.5 unverified → 1.5 (no gate at this band)', raw: 1.5, ctx: unverified, expect: 1.5 },
  { name: '2.0 → 2.0 (band edge inclusive)', raw: 2.0, ctx: unverified, expect: 2.0 },

  // 2.01–2.50 verification gate
  { name: '2.3 verified+atLoc → 2.25', raw: 2.3, ctx: verified, expect: 2.25 },
  { name: '2.3 unverified → 2.0', raw: 2.3, ctx: unverified, expect: 2.0 },
  {
    name: '2.4 verified but NOT atLoc → 2.0',
    raw: 2.4,
    ctx: verifiedNotAtLoc,
    expect: 2.0,
  },

  // >2.5 non-Sterling cap
  { name: '2.7 verified non-Sterling → 2.5', raw: 2.7, ctx: verified, expect: 2.5 },
  { name: '4.0 verified non-Sterling → 2.5', raw: 4.0, ctx: verified, expect: 2.5 },
  { name: '4.0 unverified → 2.0', raw: 4.0, ctx: unverified, expect: 2.0 },

  // Sterling-class
  { name: '2.75 Sterling+verified+atLoc → 2.75', raw: 2.75, ctx: sterling, expect: 2.75 },
  { name: '2.51 Sterling+verified+atLoc → 2.5 (snap)', raw: 2.51, ctx: sterling, expect: 2.5 },
  { name: '3.0 Sterling+verified+atLoc → 3.0', raw: 3.0, ctx: sterling, expect: 3.0 },
  {
    name: '3.5 Sterling+verified+atLoc → 3.0 hard cap',
    raw: 3.5,
    ctx: sterling,
    expect: 3.0,
    spec_correction:
      'Handoff TS reference returned 2.5 here (Sterling branch only fired for raw <=3.0); test expected 3.0; we extend Sterling-class to clamp >3.0 raw at 3.0.',
  },

  // Edge cases
  { name: 'NaN → null', raw: NaN, ctx: verified, expect: null },
  { name: '0 → null', raw: 0, ctx: verified, expect: null },
  { name: 'negative → null', raw: -1, ctx: verified, expect: null },

  // Consensus override (post-clarification): when ≥2 distinct sources
  // agree on a quarter-snap size in [0.75, 2.6), that size becomes the
  // displayed value and overrides the raw cap entirely.
  {
    name: 'consensus 1.5 with raw 4 → 1.5 (consensus wins over cap)',
    raw: 4.0,
    ctx: consensusOneFive,
    expect: 1.5,
  },
  {
    name: 'consensus 1.5 with raw 0.5 → 1.5 (consensus wins over floor)',
    raw: 0.5,
    ctx: consensusOneFive,
    expect: 1.5,
  },
  {
    name: 'consensus 1.5 with raw 0.1 → null (still respects suppress)',
    raw: 0.1,
    ctx: consensusOneFive,
    expect: null,
    spec_correction:
      'Sub-trace radar (raw < 0.25) suppresses even with consensus — no event detected on this property.',
  },
  {
    name: 'consensus 2.5 with raw 4 → 2.5 (top of consensus range)',
    raw: 4.0,
    ctx: consensusTwoFive,
    expect: 2.5,
  },
  {
    name: 'consensus 2.75 with raw 4 → 2.0 (out of range, falls through)',
    raw: 4.0,
    ctx: consensusOutOfRange,
    expect: 2.0,
    spec_correction:
      'Consensus only applies in [0.75, 2.6). 2.75 is out of range so we fall through to the unverified cap (2.0).',
  },
];

let pass = 0;
let fail = 0;
const failures: string[] = [];

for (const c of cases) {
  const got = displayHailInches(c.raw, c.ctx);
  const ok = got === c.expect;
  if (ok) {
    pass += 1;
    console.log(`  ✓  ${c.name}`);
    if (c.spec_correction) {
      console.log(`     ↳ spec correction: ${c.spec_correction}`);
    }
  } else {
    fail += 1;
    const msg = `  ✗  ${c.name} — expected ${c.expect}, got ${got}`;
    console.log(msg);
    failures.push(msg);
  }
}

// Sterling-class membership tests
const memberCases: Array<[string, number, number, string, boolean]> = [
  ['Sterling 8/29/2024 — Sterling VA itself', 39.0067, -77.4291, '2024-08-29', true],
  ['Sterling 8/29/2024 — Boone Blvd Vienna (≈12 mi)', 38.9209, -77.2369, '2024-08-29', true],
  ['Sterling 8/29/2024 — Barksdale Leesburg (≈10 mi)', 39.1286, -77.5425, '2024-08-29', true],
  // 17032 Silver Charm Place ~16 mi from center — was the meeting's actual
  // test address. 15-mi radius cut it off; 20-mi includes it.
  [
    'Sterling 8/29/2024 — 17032 Silver Charm Pl Leesburg (≈16 mi, the meeting\'s test address)',
    39.18,
    -77.59,
    '2024-08-29',
    true,
  ],
  ['Wrong date — same place', 39.0067, -77.4291, '2024-08-30', false],
  ['Outside radius — Frederick MD (≈30 mi)', 39.4143, -77.4105, '2024-08-29', false],
];

// computeConsensusSize tests
interface ConsensusCase {
  name: string;
  reports: Array<{ source: string; sizeInches: number }>;
  expect: number | null;
}
const consensusCases: ConsensusCase[] = [
  {
    name: '2 sources at 1.5 → 1.5',
    reports: [
      { source: 'ncei-storm-events', sizeInches: 1.5 },
      { source: 'iem-lsr', sizeInches: 1.5 },
    ],
    expect: 1.5,
  },
  {
    name: '3 sources at different sizes → null (no agreement)',
    reports: [
      { source: 'ncei-storm-events', sizeInches: 1.0 },
      { source: 'iem-lsr', sizeInches: 1.5 },
      { source: 'mping', sizeInches: 1.75 },
    ],
    expect: null,
  },
  {
    name: '2 sources both at 2.5, 1 at 4.0 → 2.5 (max consensus)',
    reports: [
      { source: 'ncei-storm-events', sizeInches: 2.5 },
      { source: 'iem-lsr', sizeInches: 2.5 },
      { source: 'mping', sizeInches: 4.0 },
    ],
    expect: 2.5,
  },
  {
    name: 'same-source duplicates → null (need DISTINCT sources)',
    reports: [
      { source: 'ncei-storm-events', sizeInches: 1.5 },
      { source: 'ncei-storm-events', sizeInches: 1.5 },
      { source: 'ncei-storm-events', sizeInches: 1.5 },
    ],
    expect: null,
  },
  {
    name: 'consensus at 2.75 → null (out of [0.75, 2.6) range)',
    reports: [
      { source: 'ncei-storm-events', sizeInches: 2.75 },
      { source: 'iem-lsr', sizeInches: 2.75 },
    ],
    expect: null,
  },
  {
    name: 'consensus at 0.5 → null (out of range, below floor)',
    reports: [
      { source: 'ncei-storm-events', sizeInches: 0.5 },
      { source: 'iem-lsr', sizeInches: 0.5 },
    ],
    expect: null,
  },
  {
    name: 'quarter-snap matching: 1.51 + 1.49 → 1.5 (both snap to 1.5)',
    reports: [
      { source: 'ncei-storm-events', sizeInches: 1.51 },
      { source: 'iem-lsr', sizeInches: 1.49 },
    ],
    expect: 1.5,
  },
  {
    name: 'highest consensus picked: agreement at both 1.0 and 1.5 → 1.5',
    reports: [
      { source: 'ncei-storm-events', sizeInches: 1.0 },
      { source: 'iem-lsr', sizeInches: 1.0 },
      { source: 'mping', sizeInches: 1.5 },
      { source: 'spc', sizeInches: 1.5 },
    ],
    expect: 1.5,
  },
];

console.log('\nSterling-class membership:');
for (const [name, lat, lng, date, expected] of memberCases) {
  const got = isSterlingClassStorm(date, lat, lng);
  if (got === expected) {
    pass += 1;
    console.log(`  ✓  ${name}`);
  } else {
    fail += 1;
    const msg = `  ✗  ${name} — expected ${expected}, got ${got}`;
    console.log(msg);
    failures.push(msg);
  }
}

console.log('\nConsensus-size detection:');
for (const c of consensusCases) {
  const got = computeConsensusSize(c.reports);
  if (got === c.expect) {
    pass += 1;
    console.log(`  ✓  ${c.name}`);
  } else {
    fail += 1;
    const msg = `  ✗  ${c.name} — expected ${c.expect}, got ${got}`;
    console.log(msg);
    failures.push(msg);
  }
}

const total = cases.length + memberCases.length + consensusCases.length;
console.log(`\n${pass} passed, ${fail} failed (${total} total)`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(f);
  process.exit(1);
}
process.exit(0);

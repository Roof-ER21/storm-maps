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
  displayHailInches,
  isSterlingClassStorm,
  type VerificationContext,
} from '../server/storm/displayCapService.ts';

const verified: VerificationContext = {
  isVerified: true,
  isAtLocation: true,
  isSterlingClass: false,
};
const verifiedNotAtLoc: VerificationContext = {
  isVerified: true,
  isAtLocation: false,
  isSterlingClass: false,
};
const unverified: VerificationContext = {
  isVerified: false,
  isAtLocation: true,
  isSterlingClass: false,
};
const sterling: VerificationContext = {
  isVerified: true,
  isAtLocation: true,
  isSterlingClass: true,
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
  // Suppress floor
  { name: '0.2 → null (suppress)', raw: 0.2, ctx: verified, expect: null },
  { name: '0.39 → null (just under floor)', raw: 0.39, ctx: verified, expect: null },
  {
    name: '0.33 → null (rule-table says <0.4 suppress)',
    raw: 0.33,
    ctx: verified,
    expect: null,
    spec_correction:
      'Handoff test expected 0.75 but the rule table says <0.4 suppress; rule wins.',
  },

  // 0.4 floor
  { name: '0.4 → 0.75 (floor)', raw: 0.4, ctx: verified, expect: 0.75 },
  { name: '0.5 → 0.75 (floor)', raw: 0.5, ctx: verified, expect: 0.75 },
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
  ['Wrong date — same place', 39.0067, -77.4291, '2024-08-30', false],
  ['Outside radius — Frederick MD (≈30 mi)', 39.4143, -77.4105, '2024-08-29', false],
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

console.log(`\n${pass} passed, ${fail} failed (${cases.length + memberCases.length} total)`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(f);
  process.exit(1);
}
process.exit(0);

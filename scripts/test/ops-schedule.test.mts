/**
 * Phase 8c / 8d unit tests — the pure aggregation + date helpers from
 * server/intel/ops.ts and server/intel/schedule.ts. Dependency-free tsx harness
 * (same style as ai-aggregation.test.mts). No DB — fixtures only.
 *
 *   npm test
 */
import { summarizeFixes, ageBucket, ageDays, type FixRow } from '../../server/intel/ops.js';
import { etDay } from '../../server/intel/schedule.js';

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`, detail ?? ''); }
}
function eq(name: string, got: unknown, want: unknown) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}
const daysAgoIso = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

console.log('ageBucket (open-fix age buckets):');
eq('null → unknown', ageBucket(null), 'unknown');
eq('3 → 0-7d', ageBucket(3), '0-7d');
eq('7 → 0-7d (boundary)', ageBucket(7), '0-7d');
eq('8 → 8-30d', ageBucket(8), '8-30d');
eq('30 → 8-30d', ageBucket(30), '8-30d');
eq('45 → 31-90d', ageBucket(45), '31-90d');
eq('120 → 90d+', ageBucket(120), '90d+');

console.log('ageDays:');
ok('null → null', ageDays(null) === null);
ok('garbage → null', ageDays('not-a-date') === null);
ok('~10 days ago ≈ 10', Math.abs((ageDays(daysAgoIso(10)) ?? -1) - 10) <= 1);

console.log('etDay (ET-day conversion — the text-date footgun avoidance):');
// 00:00 UTC May 6 = 20:00 EDT May 5 → ET calendar day is the 5th (real sample value)
eq('UTC midnight → prior ET day', etDay('2026-05-06T00:00:00.000Z'), '2026-05-05');
eq('null → unknown', etDay(null), 'unknown');
eq('garbage → unknown', etDay('nope'), 'unknown');

console.log('summarizeFixes (8c aggregation):');
const rows: FixRow[] = [
  { id: 1, trade: 'Roofing', completed: false, created_date: daysAgoIso(2),   employee_id: 7,    rep: 'Reese Samala' },
  { id: 2, trade: 'Gutters', completed: false, created_date: daysAgoIso(40),  employee_id: 7,    rep: 'Reese Samala' },
  { id: 3, trade: 'Roofing', completed: true,  created_date: daysAgoIso(100), employee_id: 9,    rep: 'Sam Ladder' },
  { id: 4, trade: null,      completed: false, created_date: null,            employee_id: null, rep: null },
];
const s = summarizeFixes(rows);
eq('total', s.total, 4);
eq('open', s.open, 3);
eq('completed', s.completed, 1);
ok('by_rep keyed by employee_id: Reese (id 7) = 2 open / 0 completed',
  !!s.by_rep.find((r) => r.employee_id === 7 && r.open === 2 && r.completed === 0));
ok('by_rep carries display name', !!s.by_rep.find((r) => r.rep === 'Reese Samala'));
ok('by_rep: completed rep Sam (id 9) = 0 open / 1 completed',
  !!s.by_rep.find((r) => r.employee_id === 9 && r.open === 0 && r.completed === 1));
ok('by_rep: null-employee fix → (unassigned), 1 open',
  !!s.by_rep.find((r) => r.employee_id === null && r.rep === '(unassigned)' && r.open === 1));
ok('by_trade is OPEN-only: Roofing = 1 (the completed Roofing fix excluded)',
  s.by_trade.find((t) => t.key === 'Roofing')?.count === 1);
ok('by_trade: null trade → (none)', !!s.by_trade.find((t) => t.key === '(none)'));
ok('by_age: 0-7d (id1) + 31-90d (id2) present',
  !!s.by_age.find((b) => b.bucket === '0-7d') && !!s.by_age.find((b) => b.bucket === '31-90d'));
ok('by_age: unknown bucket for null created_date (id4)',
  !!s.by_age.find((b) => b.bucket === 'unknown'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

/**
 * Regression harness for the AI assistant's deterministic aggregation core —
 * the code that fixed Gemini Flash fabricating/mis-aggregating over list tools:
 *   • applyQuery  (server-side filter/sort/top — commit 51c7f69)
 *   • summarize   (whole-element truncation, never mid-JSON — commit eca982d)
 * If these regress, the model silently invents rows again. Pure functions, no
 * DB / no model. Run: `npm test`  (node --import tsx).
 */
import { applyQuery, primaryArray, summarize } from '../../server/ai/invoke.js';

let failed = 0;
let passed = 0;
function check(cond: boolean, msg: string): void {
  if (cond) { passed++; } else { failed++; console.error('  FAIL:', msg); }
}
function eq(a: unknown, b: unknown, msg: string): void {
  check(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

interface Rep { name: string; signed: number; revenue: number }
type QueryResult = { totalCount: number; matchedCount: number; returnedCount: number; rows: Rep[] };
// 336 reps, signed = 0..335 — mirrors the real get_reps_summary shape {reps:[…]}.
const reps: Rep[] = Array.from({ length: 336 }, (_, i) => ({ name: `Rep ${i}`, signed: i, revenue: i * 1000 }));
const payload = { reps };

// ── applyQuery: filter ───────────────────────────────────────────────
{
  const r = applyQuery(payload, { filterField: 'signed', filterOp: 'lt', filterValue: 200 }) as QueryResult;
  eq(r.totalCount, 336, 'lt: totalCount is the full set');
  eq(r.matchedCount, 200, 'lt 200 → exactly 200 matched (the "49 vs 314" bug class)');
  eq(r.returnedCount, 200, 'lt: returnedCount = matched when no top');
}
{
  const r = applyQuery(payload, { filterField: 'signed', filterOp: 'gte', filterValue: 300 }) as QueryResult;
  eq(r.matchedCount, 36, 'gte 300 → 36 matched (300..335)');
}
{
  const r = applyQuery(payload, { filterField: 'signed', filterOp: 'eq', filterValue: 42 }) as QueryResult;
  eq(r.matchedCount, 1, 'eq → 1');
  eq(r.rows[0].name, 'Rep 42', 'eq → correct row');
}
{
  const r = applyQuery(payload, { filterField: 'signed', filterOp: 'ne', filterValue: 42 }) as QueryResult;
  eq(r.matchedCount, 335, 'ne → all but one');
}
{
  const r = applyQuery(payload, { filterField: 'name', filterOp: 'contains', filterValue: 'Rep 33' }) as QueryResult;
  // Names run "Rep 0".."Rep 335", so "Rep 33" matches "Rep 33" + "Rep 330".."Rep 335" = 7.
  eq(r.matchedCount, 7, 'contains: exact substring count (case-insensitive)');
  check(r.rows.every((row) => row.name.includes('Rep 33')), 'contains: every returned row actually matches');
}

// ── applyQuery: sort + top (the "top N" bug) ─────────────────────────
{
  const r = applyQuery(payload, { sortBy: 'signed', sortOrder: 'desc', top: 10 }) as QueryResult;
  eq(r.returnedCount, 10, 'top 10 → 10 rows');
  eq(r.rows[0].signed, 335, 'desc top: highest first');
  eq(r.rows[9].signed, 326, 'desc top: 10th is 326');
  eq(r.totalCount, 336, 'top: totalCount still full set');
}
{
  const r = applyQuery(payload, { sortBy: 'signed', sortOrder: 'asc', top: 3 }) as QueryResult;
  eq(r.rows.map((x) => x.signed), [0, 1, 2], 'asc top 3 → lowest first');
}
{
  // "top 10 reps UNDER 200 signed" — filter THEN sort THEN top, all server-side.
  const r = applyQuery(payload, { filterField: 'signed', filterOp: 'lt', filterValue: 200, sortBy: 'signed', sortOrder: 'desc', top: 10 }) as QueryResult;
  eq(r.totalCount, 336, 'combined: totalCount full');
  eq(r.matchedCount, 200, 'combined: 200 under 200');
  eq(r.returnedCount, 10, 'combined: top 10 of the matched');
  eq(r.rows[0].signed, 199, 'combined: highest under 200 is 199');
  eq(r.rows[9].signed, 190, 'combined: 10th is 190');
}

// ── primaryArray ─────────────────────────────────────────────────────
eq(primaryArray(payload)?.arr.length, 336, 'primaryArray: finds {reps:[…]} array');
eq(primaryArray(reps)?.arr.length, 336, 'primaryArray: bare array');
check(primaryArray({ hero: { total: 5 } }) === null, 'primaryArray: no array-valued prop → null');
{
  const r = applyQuery({ hero: { total: 5 } }, { filterField: 'x', filterOp: 'gt', filterValue: 1 });
  eq(r, { hero: { total: 5 } }, 'applyQuery: nothing list-shaped → data returned unchanged');
}

// ── summarize: small payload returned whole ──────────────────────────
{
  const small = { reps: reps.slice(0, 3) };
  const s = summarize(small);
  check(!s.includes('TRUNCATED'), 'summarize: small payload not truncated');
  eq(JSON.parse(s), small, 'summarize: small payload round-trips exactly');
}

// ── summarize: large array truncated by WHOLE element (eca982d) ──────
{
  const s = summarize(payload, 2000); // force truncation with a small budget
  check(s.includes('DATA TRUNCATED'), 'summarize: large array gets truncation marker');
  check(s.includes('336 items total'), 'summarize: marker states the TRUE total (no fabrication)');
  check(/Do not infer, filter over, or invent/.test(s), 'summarize: marker forbids inventing omitted rows');
  // The kept prefix (before the marker) must be VALID JSON of {reps:[…]} —
  // i.e. truncated on a whole-element boundary, never mid-object.
  const prefix = s.slice(0, s.indexOf('\n[DATA TRUNCATED'));
  let parsed: { reps: Rep[] } | null = null;
  try { parsed = JSON.parse(prefix); } catch { /* parsed stays null */ }
  check(parsed !== null, 'summarize: kept prefix is valid JSON (whole-element cut, not mid-JSON)');
  check(!!parsed && parsed.reps.length > 0 && parsed.reps.length < 336, 'summarize: kept a partial-but-nonzero set');
  check(!!parsed && parsed.reps[0].name === 'Rep 0', 'summarize: kept elements are intact objects');
}

// ── summarize: non-array payload hard-capped with marker ─────────────
{
  const blob = { note: 'x'.repeat(5000) };
  const s = summarize(blob, 500);
  check(s.includes('[TRUNCATED'), 'summarize: oversized non-array blob hard-capped with marker');
  check(s.length < 5000, 'summarize: non-array payload actually shortened');
}

console.log(`\nAI aggregation regression: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

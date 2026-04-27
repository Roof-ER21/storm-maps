/**
 * Pure-function tests for stormMetrics + geometry bearing helpers.
 * Run with: `npx tsx scripts/test-storm-metrics.ts`
 *
 * Not wired into the display-cap CI gate — these are sanity checks on the
 * Phase 1 helpers added for the 2026-04-27 PDF redesign. Failures here
 * mean a section of the new PDF will render "—" or the wrong heading.
 */

import {
  bearingDegrees,
  bearingToCardinal,
  bearingToCardinalWord,
} from '../server/storm/geometry.js';
import {
  computeHailDuration,
  computeStormDirectionAndSpeed,
  computeStormPeakTime,
  filterEventsByEtDate,
  computeDirectionAndSpeedFromPoints,
} from '../server/storm/stormMetrics.js';
import type { StormEventDto } from '../server/storm/eventService.js';

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass += 1;
    console.log(`  ✓  ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗  ${name}${detail ? ` (${detail})` : ''}`);
  }
}

function approxEq(a: number | null, b: number, eps = 0.5): boolean {
  if (a === null || a === undefined || !Number.isFinite(a)) return false;
  return Math.abs(a - b) < eps;
}

function makeHailEvent(
  id: string,
  beginIso: string,
  lat: number,
  lng: number,
  mag = 1.0,
): StormEventDto {
  return {
    id,
    eventType: 'Hail',
    state: 'VA',
    county: 'Loudoun',
    beginDate: beginIso,
    endDate: beginIso,
    beginLat: lat,
    beginLon: lng,
    endLat: lat,
    endLon: lng,
    magnitude: mag,
    magnitudeType: 'in',
    damageProperty: 0,
    source: 'iem-lsr',
    narrative: '',
  };
}

console.log('Bearing math:');
// Hamilton, VA (39.13, -77.67) → Leesburg, VA (39.11, -77.56) is ~6 mi East.
{
  const b = bearingDegrees(39.13, -77.67, 39.11, -77.56);
  // Slight southern drift makes this ~103° (E with a southern lean) — still
  // an "East" cardinal word per the 8-point bucket.
  check('Hamilton→Leesburg ≈ East (~103°)', approxEq(b, 103, 8), `got ${b.toFixed(1)}`);
  check('  cardinal word = East', bearingToCardinalWord(b) === 'East');
  // 16-point: 90°=E, ENE wedge ends at ~101.25°, so should still be E.
  check('  cardinal 16pt is E or ESE', ['E', 'ESE'].includes(bearingToCardinal(b)));
}
// Due North: Sterling → Leesburg is roughly NW; due-N test uses contrived points.
{
  const b = bearingDegrees(39.0, -77.5, 39.5, -77.5);
  check('due North bearing ≈ 0°', approxEq(b, 0, 1));
  check('  cardinal word = North', bearingToCardinalWord(b) === 'North');
}
// Due South
{
  const b = bearingDegrees(39.5, -77.5, 39.0, -77.5);
  check('due South bearing ≈ 180°', approxEq(b, 180, 1));
  check('  cardinal word = South', bearingToCardinalWord(b) === 'South');
}
// Due West
{
  const b = bearingDegrees(39.0, -77.0, 39.0, -78.0);
  check('due West bearing ≈ 270°', approxEq(b, 270, 1));
  check('  cardinal word = West', bearingToCardinalWord(b) === 'West');
}
check('null/undefined → "—"', bearingToCardinal(null) === '—' && bearingToCardinalWord(null) === '—');

console.log('\nfilterEventsByEtDate:');
{
  // 2025-05-16 22:00Z = 2025-05-16 18:00 ET (still 5/16 ET)
  // 2025-05-17 03:00Z = 2025-05-16 23:00 ET (still 5/16 ET)
  // 2025-05-17 05:00Z = 2025-05-17 01:00 ET (now 5/17 ET)
  const events: StormEventDto[] = [
    makeHailEvent('a', '2025-05-16T22:00:00Z', 39.13, -77.67),
    makeHailEvent('b', '2025-05-17T03:00:00Z', 39.10, -77.55),
    makeHailEvent('c', '2025-05-17T05:00:00Z', 39.10, -77.55),
  ];
  const filtered = filterEventsByEtDate(events, '2025-05-16');
  check('ET window includes a + b but not c', filtered.length === 2);
  check('  a + b kept', filtered.map((e) => e.id).join(',') === 'a,b');
}

console.log('\ncomputeHailDuration:');
{
  const events: StormEventDto[] = [
    makeHailEvent('a', '2025-05-16T20:30:00Z', 39.13, -77.67), // 4:30 PM ET
    makeHailEvent('b', '2025-05-16T20:35:00Z', 39.12, -77.65),
    makeHailEvent('c', '2025-05-16T21:00:00Z', 39.10, -77.55), // 5:00 PM ET
  ];
  const dur = computeHailDuration(events, '2025-05-16');
  check('duration ≈ 30.0 minutes', approxEq(dur, 30.0, 0.05), `got ${dur}`);
}
{
  // Single-event day → null
  const events: StormEventDto[] = [
    makeHailEvent('only', '2025-06-01T20:30:00Z', 39, -77),
  ];
  check('single event → null', computeHailDuration(events, '2025-06-01') === null);
}
{
  // Empty day → null
  check('empty day → null', computeHailDuration([], '2025-06-01') === null);
}

console.log('\ncomputeStormPeakTime:');
{
  const events: StormEventDto[] = [
    makeHailEvent('late', '2025-05-16T21:30:00Z', 39, -77),
    makeHailEvent('early', '2025-05-16T20:30:00Z', 39, -77), // 4:30 PM ET
    makeHailEvent('mid', '2025-05-16T21:00:00Z', 39, -77),
  ];
  const peak = computeStormPeakTime(events, '2025-05-16');
  check(
    'peak time = 4:30 PM EDT',
    typeof peak === 'string' && peak.includes('4:30') && peak.includes('PM'),
    `got "${peak}"`,
  );
}
check('empty day peak → null', computeStormPeakTime([], '2025-05-16') === null);

console.log('\ncomputeStormDirectionAndSpeed:');
{
  // Hamilton, VA → Leesburg, VA over 30 minutes ≈ East at ~12 mph.
  // Distance is ~6 mi, time 0.5h, so speed ≈ 12 mph.
  const events: StormEventDto[] = [
    makeHailEvent('a', '2025-05-16T20:30:00Z', 39.13, -77.67),
    makeHailEvent('b', '2025-05-16T21:00:00Z', 39.11, -77.56),
  ];
  const r = computeStormDirectionAndSpeed(events, '2025-05-16');
  check('heading = East', r.heading === 'East', `got "${r.heading}"`);
  check('speed ≈ 12 mph', approxEq(r.speedMph, 12, 4), `got ${r.speedMph?.toFixed(1)}`);
}
{
  // Single event → "—" / null
  const events: StormEventDto[] = [makeHailEvent('only', '2025-06-01T20:00:00Z', 39, -77)];
  const r = computeStormDirectionAndSpeed(events, '2025-06-01');
  check('single event → "—"', r.heading === '—' && r.speedMph === null);
}
{
  // Stationary cluster → "—"
  const events: StormEventDto[] = [
    makeHailEvent('a', '2025-05-16T20:30:00Z', 39.13, -77.67),
    makeHailEvent('b', '2025-05-16T21:00:00Z', 39.13, -77.67),
  ];
  const r = computeStormDirectionAndSpeed(events, '2025-05-16');
  check('stationary cluster → "—"', r.heading === '—' && r.speedMph === null);
}

console.log('\ncomputeDirectionAndSpeedFromPoints:');
{
  const r = computeDirectionAndSpeedFromPoints([
    { lat: 39.13, lng: -77.67, timeIso: '2025-05-16T20:30:00Z' },
    { lat: 39.11, lng: -77.56, timeIso: '2025-05-16T21:00:00Z' },
  ]);
  check('points: heading = East', r.heading === 'East');
  check('points: speed ≈ 12 mph', approxEq(r.speedMph, 12, 4));
}

console.log(
  `\n${pass} passed, ${fail} failed (${pass + fail} total)`,
);
process.exit(fail === 0 ? 0 : 1);

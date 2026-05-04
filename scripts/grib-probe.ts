/**
 * One-shot diagnostic: compare GRIB2 section-5 packing parameters across
 * known-bad (25.4× corrupted), borderline, and known-good MRMS files.
 *
 * Decides whether the corruption lives in the source files (R/E/D encoded
 * with wrong units → no parser swap will fix it) or in our decoder (R/E/D
 * misread → swap to gribberish/eccodes will fix it).
 */

import { fetchMrmsMesh1440 } from '../server/storm/mrmsFetch.js';
import { readGrib2 } from '../server/storm/grib2/sections.js';
import { decodeGribData } from '../server/storm/grib2/decode.js';

interface Probe {
  date: string;
  label: string;
  expected: 'bad' | 'borderline' | 'good';
}

const PROBES: Probe[] = [
  { date: '2024-07-16', label: 'BAD #1 (54.21" → 2.13")',     expected: 'bad' },
  { date: '2024-04-15', label: 'BAD #2 (7.41" → 1.84")',      expected: 'bad' },
  { date: '2021-07-20', label: 'BAD #3 (6.45" → 0.27")',      expected: 'bad' },
  { date: '2025-04-05', label: 'BORDERLINE (5.74", raw 145.8mm)', expected: 'borderline' },
  { date: '2026-04-26', label: 'GOOD control (recent)',        expected: 'good' },
];

function stats(values: Float32Array): { min: number; max: number; mean: number; nans: number; nonZero: number } {
  let min = Infinity, max = -Infinity, sum = 0, n = 0, nans = 0, nonZero = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (Number.isNaN(v)) { nans += 1; continue; }
    if (v < min) min = v;
    if (v > max) max = v;
    if (v !== 0) nonZero += 1;
    sum += v;
    n += 1;
  }
  return { min, max, mean: n ? sum / n : 0, nans, nonZero };
}

function fmt(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return String(n);
  return n.toFixed(digits);
}

async function probe(p: Probe): Promise<void> {
  console.log(`\n=== ${p.date}  [${p.label}] ===`);
  const file = await fetchMrmsMesh1440({ date: p.date });
  if (!file) {
    console.log('  fetch: NO FILE FOUND');
    return;
  }
  console.log(`  url:   ${file.url}`);
  console.log(`  bytes: ${file.grib2Bytes.length}`);

  let sections;
  try {
    sections = readGrib2(file.grib2Bytes);
  } catch (err) {
    console.log(`  parse FAILED: ${(err as Error).message}`);
    return;
  }

  const d = sections.data;
  console.log(`  section 5 (data template):`);
  console.log(`    kind:                ${d.kind}`);
  console.log(`    referenceValue (R):  ${fmt(d.referenceValue, 6)}`);
  console.log(`    binaryScale (E):     ${d.binaryScaleFactor}    (2^E = ${fmt(2 ** d.binaryScaleFactor, 6)})`);
  console.log(`    decimalScale (D):    ${d.decimalScaleFactor}   (10^D = ${fmt(10 ** d.decimalScaleFactor, 4)})`);
  console.log(`    bitsPerValue (nb):   ${d.bitsPerValue}`);
  console.log(`  grid: ${sections.grid.width} × ${sections.grid.height} = ${sections.grid.width * sections.grid.height} cells`);

  const decoded = decodeGribData(sections);
  const s = stats(decoded.values);
  console.log(`  decoded values (mm):`);
  console.log(`    min:        ${fmt(s.min, 4)}`);
  console.log(`    max:        ${fmt(s.max, 4)}    (÷25.4 = ${fmt(s.max / 25.4, 4)} in)`);
  console.log(`    mean:       ${fmt(s.mean, 6)}`);
  console.log(`    NaN cells:  ${s.nans}`);
  console.log(`    non-zero:   ${s.nonZero}`);
  console.log(`  heuristic:    max > 150mm → ${s.max > 150 ? 'WOULD CORRECT (÷25.4)' : 'no correction'}`);
}

(async () => {
  for (const p of PROBES) {
    try {
      await probe(p);
    } catch (err) {
      console.log(`  ERROR: ${(err as Error).message}`);
    }
  }

  console.log('\n=== VERDICT ===');
  console.log('If R/E/D match between BAD and GOOD files → source corruption (parser swap WON\'T fix).');
  console.log('If R/E/D differ in ways suggesting wrong template/scale → decoder bug (parser swap WILL fix).');
})();

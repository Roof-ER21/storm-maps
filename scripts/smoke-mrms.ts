import { fetchMrmsMesh1440 } from '../server/storm/mrmsFetch.ts';
import { readGrib2 } from '../server/storm/grib2/sections.ts';
import { decodeGribData } from '../server/storm/grib2/decode.ts';
import { buildMrmsVectorCollection } from '../server/storm/mrmsContour.ts';

async function main() {
  const testDates = ['2024-08-29', '2024-05-07', '2024-04-02'];
  for (const date of testDates) {
    console.log('--- testing', date, '---');
    const file = await fetchMrmsMesh1440({ date });
    if (!file) {
      console.log('  no file');
      continue;
    }
    console.log(
      '  fetched',
      (file.grib2Bytes.length / 1024 / 1024).toFixed(2),
      'MB GRIB2',
    );
    try {
      const sections = readGrib2(file.grib2Bytes);
      console.log(
        '  sections.grid:',
        sections.grid.width,
        'x',
        sections.grid.height,
        'lat',
        sections.grid.lat1.toFixed(2),
        '→',
        sections.grid.lat2.toFixed(2),
        'lng',
        sections.grid.lng1.toFixed(2),
        '→',
        sections.grid.lng2.toFixed(2),
      );
      console.log(
        '  data template:',
        sections.data.kind,
        'nb=',
        sections.data.bitsPerValue,
        'R=',
        sections.data.referenceValue,
        'E=',
        sections.data.binaryScaleFactor,
        'D=',
        sections.data.decimalScaleFactor,
      );
      const decoded = decodeGribData(sections);
      let max = 0;
      let nonzero = 0;
      for (let i = 0; i < decoded.values.length; i++) {
        const v = decoded.values[i];
        if (Number.isFinite(v) && v > 0) {
          nonzero++;
          if (v > max) max = v;
        }
      }
      console.log(
        '  decoded:',
        decoded.values.length,
        'cells,',
        nonzero,
        'with hail, peak',
        max.toFixed(2),
        'mm =',
        (max / 25.4).toFixed(2),
        'in',
      );
      const collection = buildMrmsVectorCollection({
        decoded,
        grid: sections.grid,
        bounds: { north: 39.5, south: 38.0, east: -76.0, west: -78.0 },
        date,
        refTime: file.refTime,
        sourceFile: file.url,
      });
      console.log(
        '  contoured:',
        collection.features.length,
        'bands, payload max',
        collection.metadata.maxHailInches.toFixed(2),
        'in,',
        collection.metadata.hailCells,
        'cells',
      );
    } catch (e) {
      console.log('  ERROR:', e instanceof Error ? e.message : e);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

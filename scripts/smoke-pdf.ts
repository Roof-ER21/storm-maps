import { writeFileSync } from 'node:fs';
import { buildStormReportPdf } from '../server/storm/reportPdf.ts';
import { buildMrmsRaster } from '../server/storm/mrmsRaster.ts';

async function main() {
  console.log('--- raster smoke ---');
  const r = await buildMrmsRaster({
    date: '2024-08-29',
    bounds: { north: 39.5, south: 38.0, east: -76.0, west: -78.0 },
  });
  if (r) {
    writeFileSync('/tmp/mrms.png', r.pngBytes);
    console.log(
      '  png',
      r.pngBytes.length,
      'bytes,',
      r.metadata.imageSize.width,
      'x',
      r.metadata.imageSize.height,
      'peak',
      r.metadata.maxMeshInches.toFixed(2),
      'in',
    );
  } else {
    console.log('  null');
  }

  console.log('--- pdf smoke ---');
  const pdf = await buildStormReportPdf({
    address: '6202 Crestwood Dr, Alexandria, VA',
    lat: 38.7965,
    lng: -77.1342,
    radiusMiles: 35,
    dateOfLoss: '2024-08-29',
    rep: { name: 'Test Rep', phone: '555-0199', email: 'test@example.com' },
    company: { name: 'Roof-ER21' },
  });
  writeFileSync('/tmp/storm-report.pdf', pdf);
  console.log('  pdf', pdf.length, 'bytes');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

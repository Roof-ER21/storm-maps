/**
 * Extract GPS coordinates from JPEG EXIF data.
 * No external dependencies — reads raw binary EXIF.
 */

export interface GpsCoords {
  lat: number;
  lng: number;
}

export async function extractGpsFromBlob(blob: Blob): Promise<GpsCoords | null> {
  if (!blob.type.startsWith('image/jpeg') && !blob.type.startsWith('image/jpg')) {
    return null;
  }

  try {
    const buffer = await blob.arrayBuffer();
    return parseExifGps(buffer);
  } catch {
    return null;
  }
}

function parseExifGps(buffer: ArrayBuffer): GpsCoords | null {
  const view = new DataView(buffer);

  // Check JPEG SOI marker
  if (view.getUint16(0) !== 0xFFD8) return null;

  // Find APP1 (EXIF) marker
  let offset = 2;
  while (offset < view.byteLength - 4) {
    const marker = view.getUint16(offset);
    if (marker === 0xFFE1) {
      // APP1 found
      return parseExifBlock(view, offset + 4);
    }

    if ((marker & 0xFF00) !== 0xFF00) break;

    // Skip to next marker
    const segLen = view.getUint16(offset + 2);
    offset += 2 + segLen;
  }

  return null;
}

function parseExifBlock(view: DataView, start: number): GpsCoords | null {
  // Check "Exif\0\0" header
  if (
    view.getUint8(start) !== 0x45 || // E
    view.getUint8(start + 1) !== 0x78 || // x
    view.getUint8(start + 2) !== 0x69 || // i
    view.getUint8(start + 3) !== 0x66 // f
  ) {
    return null;
  }

  const tiffStart = start + 6;
  const byteOrder = view.getUint16(tiffStart);
  const littleEndian = byteOrder === 0x4949; // II = little endian

  // Verify TIFF magic 42
  if (view.getUint16(tiffStart + 2, littleEndian) !== 0x002A) return null;

  const ifd0Offset = view.getUint32(tiffStart + 4, littleEndian);
  const ifd0Start = tiffStart + ifd0Offset;

  // Find GPS IFD pointer in IFD0
  const gpsIfdOffset = findTagValue(view, ifd0Start, tiffStart, littleEndian, 0x8825);
  if (gpsIfdOffset === null) return null;

  const gpsIfdStart = tiffStart + gpsIfdOffset;
  return parseGpsIfd(view, gpsIfdStart, tiffStart, littleEndian);
}

function parseGpsIfd(view: DataView, ifdStart: number, tiffStart: number, le: boolean): GpsCoords | null {
  const count = view.getUint16(ifdStart, le);
  let latRef = '';
  let lngRef = '';
  let latValues: number[] | null = null;
  let lngValues: number[] | null = null;

  for (let i = 0; i < count; i++) {
    const entryOffset = ifdStart + 2 + i * 12;
    if (entryOffset + 12 > view.byteLength) break;

    const tag = view.getUint16(entryOffset, le);
    const type = view.getUint16(entryOffset + 2, le);
    const numValues = view.getUint32(entryOffset + 4, le);
    const valueOffset = view.getUint32(entryOffset + 8, le);

    if (tag === 0x0001) {
      // GPSLatitudeRef
      latRef = String.fromCharCode(view.getUint8(entryOffset + 8));
    } else if (tag === 0x0002 && type === 5 && numValues === 3) {
      // GPSLatitude (3 rationals)
      latValues = readRationals(view, tiffStart + valueOffset, 3, le);
    } else if (tag === 0x0003) {
      // GPSLongitudeRef
      lngRef = String.fromCharCode(view.getUint8(entryOffset + 8));
    } else if (tag === 0x0004 && type === 5 && numValues === 3) {
      // GPSLongitude (3 rationals)
      lngValues = readRationals(view, tiffStart + valueOffset, 3, le);
    }
  }

  if (!latValues || !lngValues) return null;

  let lat = latValues[0] + latValues[1] / 60 + latValues[2] / 3600;
  let lng = lngValues[0] + lngValues[1] / 60 + lngValues[2] / 3600;

  if (latRef === 'S') lat = -lat;
  if (lngRef === 'W') lng = -lng;

  // Sanity check
  if (lat === 0 && lng === 0) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  return { lat, lng };
}

function readRationals(view: DataView, offset: number, count: number, le: boolean): number[] {
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    const pos = offset + i * 8;
    if (pos + 8 > view.byteLength) break;
    const num = view.getUint32(pos, le);
    const den = view.getUint32(pos + 4, le);
    values.push(den === 0 ? 0 : num / den);
  }
  return values;
}

function findTagValue(view: DataView, ifdStart: number, _tiffStart: number, le: boolean, targetTag: number): number | null {
  const count = view.getUint16(ifdStart, le);
  for (let i = 0; i < count; i++) {
    const entryOffset = ifdStart + 2 + i * 12;
    if (entryOffset + 12 > view.byteLength) break;
    const tag = view.getUint16(entryOffset, le);
    if (tag === targetTag) {
      return view.getUint32(entryOffset + 8, le);
    }
  }
  return null;
}

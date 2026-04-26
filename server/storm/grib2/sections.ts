/**
 * GRIB2 section reader — narrow subset focused on what MRMS MESH publishes.
 *
 * GRIB2 message layout (per WMO Manual on Codes, Vol I.2):
 *
 *   Section 0  Indicator         "GRIB" + reserved + discipline + edition + total length (16 bytes)
 *   Section 1  Identification     length(4) + 1 + center/subcenter/master/local tables/...
 *   Section 2  Local Use          length(4) + 2 + ... (often absent)
 *   Section 3  Grid Definition    length(4) + 3 + source + #pts + ...
 *   Section 4  Product Definition length(4) + 4 + ...
 *   Section 5  Data Representation length(4) + 5 + ...
 *   Section 6  Bitmap             length(4) + 6 + bitmap indicator + bitmap
 *   Section 7  Data               length(4) + 7 + packed data
 *   Section 8  End                "7777"
 *
 * MRMS MESH files use:
 *   Section 3 template 3.0 (regular lat/lon grid)
 *   Section 4 template 4.0 or 4.8 (analysis or stats over time interval)
 *   Section 5 template 5.0 (simple packing) or 5.41 (PNG packing)
 *
 * This reader handles those three cases and fails fast otherwise.
 */

export interface Grib2Header {
  edition: number;
  discipline: number;
  totalLength: number;
}

export interface Grib2Grid {
  /** Number of points along a parallel (Ni). */
  width: number;
  /** Number of points along a meridian (Nj). */
  height: number;
  /** Latitude of first grid point in degrees (positive = N). */
  lat1: number;
  /** Longitude of first grid point in degrees (-180..180). */
  lng1: number;
  /** Latitude of last grid point. */
  lat2: number;
  /** Longitude of last grid point. */
  lng2: number;
  /** Step in degrees latitude (positive number). */
  dLat: number;
  /** Step in degrees longitude (positive number). */
  dLng: number;
  /** Scanning mode flag — bit 0=N→S, bit 1=W→E, bit 2=adjacent points consecutive. */
  scanningMode: number;
}

export type Grib2DataTemplate =
  | {
      kind: 'simple';
      referenceValue: number;
      binaryScaleFactor: number; // E
      decimalScaleFactor: number; // D
      bitsPerValue: number; // nb
      originalFieldType: number;
    }
  | {
      kind: 'png';
      referenceValue: number;
      binaryScaleFactor: number;
      decimalScaleFactor: number;
      bitsPerValue: number;
      originalFieldType: number;
    };

export interface Grib2Sections {
  header: Grib2Header;
  grid: Grib2Grid;
  /** Raw section 4 bytes — kept for product introspection (forecast time, MESH-specific etc.). */
  section4: Uint8Array;
  data: Grib2DataTemplate;
  /** 0 = bitmap follows (in section 6), 254 = previously-defined, 255 = no bitmap. */
  bitmapIndicator: number;
  /** Section 6 bitmap bytes (after the 1-byte indicator), if any. */
  bitmap: Uint8Array | null;
  /** Section 7 packed data payload (after the 5-byte section header). */
  dataBytes: Uint8Array;
  /** Number of data points the message claims to have. */
  numberOfDataPoints: number;
}

class GribReader {
  private offset = 0;
  constructor(private readonly buf: Uint8Array, private readonly view: DataView) {}

  remaining(): number {
    return this.buf.length - this.offset;
  }

  peek(n: number): Uint8Array {
    return this.buf.subarray(this.offset, this.offset + n);
  }

  skip(n: number): void {
    this.offset += n;
  }

  position(): number {
    return this.offset;
  }

  setPosition(p: number): void {
    this.offset = p;
  }

  u8(): number {
    return this.buf[this.offset++];
  }

  u16(): number {
    const v = this.view.getUint16(this.offset, false);
    this.offset += 2;
    return v;
  }

  u32(): number {
    const v = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return v;
  }

  /** GRIB section length is 4 bytes BE. */
  u32big(): number {
    return this.u32();
  }

  i16(): number {
    const v = this.view.getInt16(this.offset, false);
    this.offset += 2;
    return v;
  }

  /** GRIB-style signed 32-bit: sign bit at MSB, value in remaining bits. */
  signedU32(): number {
    const raw = this.u32();
    const sign = raw & 0x80000000 ? -1 : 1;
    return sign * (raw & 0x7fffffff);
  }

  signedU8(): number {
    const raw = this.u8();
    return raw & 0x80 ? -(raw & 0x7f) : raw;
  }

  signedU16(): number {
    const raw = this.u16();
    return raw & 0x8000 ? -(raw & 0x7fff) : raw;
  }

  bytes(n: number): Uint8Array {
    const out = this.buf.subarray(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }

  /**
   * IEEE 754 single-precision float (used for GRIB2 reference value R).
   */
  f32(): number {
    const v = this.view.getFloat32(this.offset, false);
    this.offset += 4;
    return v;
  }
}

/**
 * Read a GRIB2 message from a byte buffer (already gunzipped). Returns the
 * parsed sections needed for data extraction.
 *
 * Throws on:
 *   - malformed magic / wrong edition (non-2)
 *   - unsupported grid template (not 3.0)
 *   - unsupported data template (not 5.0 or 5.41)
 */
export function readGrib2(buf: Uint8Array): Grib2Sections {
  if (buf.length < 16) {
    throw new Error('GRIB2 buffer too short');
  }
  // Section 0 — Indicator: "GRIB" magic, reserved×2, discipline, edition (=2), total length (8 bytes)
  if (
    buf[0] !== 0x47 ||
    buf[1] !== 0x52 ||
    buf[2] !== 0x49 ||
    buf[3] !== 0x42
  ) {
    throw new Error('GRIB2 magic mismatch');
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const r = new GribReader(buf, view);
  r.skip(4); // "GRIB"
  r.skip(2); // reserved
  const discipline = r.u8();
  const edition = r.u8();
  if (edition !== 2) {
    throw new Error(`GRIB2 edition mismatch: got ${edition}`);
  }
  // Total length is 8 bytes BE; we read low 4 since MRMS messages stay <4 GiB.
  const totalLengthHigh = r.u32();
  const totalLengthLow = r.u32();
  if (totalLengthHigh !== 0) {
    throw new Error('GRIB2 message exceeds 4 GiB — not supported');
  }
  const totalLength = totalLengthLow;

  const header: Grib2Header = { edition, discipline, totalLength };

  let grid: Grib2Grid | null = null;
  let section4: Uint8Array | null = null;
  let data: Grib2DataTemplate | null = null;
  let bitmapIndicator = 255;
  let bitmap: Uint8Array | null = null;
  let dataBytes: Uint8Array | null = null;
  let numberOfDataPoints = 0;

  // Walk sections 1..7 (and skip 2/Local Use), then 8 ("7777").
  while (r.remaining() >= 5) {
    const sectionStart = r.position();
    // First 4 bytes might be "7777" (end). Don't read as length if so.
    if (
      buf[sectionStart] === 0x37 &&
      buf[sectionStart + 1] === 0x37 &&
      buf[sectionStart + 2] === 0x37 &&
      buf[sectionStart + 3] === 0x37
    ) {
      r.skip(4);
      break;
    }
    const sectionLength = r.u32();
    if (sectionLength === 0) {
      throw new Error('GRIB2 zero section length');
    }
    if (sectionStart + sectionLength > buf.length) {
      throw new Error('GRIB2 section overruns buffer');
    }
    const sectionNum = r.u8();
    const sectionEnd = sectionStart + sectionLength;

    switch (sectionNum) {
      case 1:
      case 2:
        // Identification / Local Use — skip body.
        r.setPosition(sectionEnd);
        break;
      case 3: {
        // Grid Definition — template 3.0 (regular lat/lon).
        // bytes 6: source of grid def, 7-10: number of data points, 11: #optional list octets, 12: interpretation, 13-14: template number
        // (bytes here are 1-indexed in the spec; we already read length(4)+section# already)
        r.u8(); // source
        const npts = r.u32();
        numberOfDataPoints = npts;
        r.u8(); // #optional list
        r.u8(); // interpretation
        const tmplNumber = r.u16();
        if (tmplNumber !== 0) {
          throw new Error(
            `Unsupported grid template ${tmplNumber}; need 3.0 (regular lat/lon)`,
          );
        }
        // Template 3.0 body (after the 14 bytes already read inside the section):
        //   shape (1) + radius scale (1) + radius scaled (4) + major scale (1) + major scaled (4)
        //   + minor scale (1) + minor scaled (4) + Ni (4) + Nj (4) + basic angle (4) + subdivisions (4)
        //   + La1 (4) + Lo1 (4) + resolution flags (1) + La2 (4) + Lo2 (4)
        //   + Di (4) + Dj (4) + scanning mode (1)
        r.u8(); // shape
        r.u8(); // radius scale
        r.u32(); // radius scaled value
        r.u8(); // major scale
        r.u32(); // major scaled value
        r.u8(); // minor scale
        r.u32(); // minor scaled value
        const Ni = r.u32();
        const Nj = r.u32();
        const basicAngle = r.u32();
        const subdivisions = r.u32();
        const angleDivisor =
          basicAngle === 0 || basicAngle === 0xffffffff
            ? 1_000_000
            : (subdivisions === 0 ? 1 : subdivisions) / basicAngle;
        // Helper to convert raw lat/lng to degrees per the GRIB2 micro-degree convention.
        const toDeg = (raw: number) => raw / angleDivisor;
        const La1 = r.signedU32();
        const Lo1 = r.signedU32();
        r.u8(); // resolution + component flags
        const La2 = r.signedU32();
        const Lo2 = r.signedU32();
        const Di = r.u32();
        const Dj = r.u32();
        const scanningMode = r.u8();

        const lat1 = toDeg(La1);
        const lng1 = normalizeLng(toDeg(Lo1));
        const lat2 = toDeg(La2);
        const lng2 = normalizeLng(toDeg(Lo2));
        const dLng = Math.abs(toDeg(Di));
        const dLat = Math.abs(toDeg(Dj));
        grid = {
          width: Ni,
          height: Nj,
          lat1,
          lng1,
          lat2,
          lng2,
          dLat,
          dLng,
          scanningMode,
        };
        r.setPosition(sectionEnd);
        break;
      }
      case 4: {
        // Product Definition — capture raw bytes for caller introspection.
        section4 = buf.subarray(sectionStart + 5, sectionEnd);
        r.setPosition(sectionEnd);
        break;
      }
      case 5: {
        // Data Representation Section.
        const _npts = r.u32(); // number of data points encoded
        void _npts;
        const tmplNumber = r.u16();
        if (tmplNumber === 0) {
          // Simple packing (5.0): R(f32) + E(i16) + D(i16) + nb(u8) + originalFieldType(u8)
          const referenceValue = r.f32();
          const binaryScaleFactor = r.signedU16();
          const decimalScaleFactor = r.signedU16();
          const bitsPerValue = r.u8();
          const originalFieldType = r.u8();
          data = {
            kind: 'simple',
            referenceValue,
            binaryScaleFactor,
            decimalScaleFactor,
            bitsPerValue,
            originalFieldType,
          };
        } else if (tmplNumber === 41) {
          // PNG packing (5.41): same scaling header as simple packing.
          const referenceValue = r.f32();
          const binaryScaleFactor = r.signedU16();
          const decimalScaleFactor = r.signedU16();
          const bitsPerValue = r.u8();
          const originalFieldType = r.u8();
          data = {
            kind: 'png',
            referenceValue,
            binaryScaleFactor,
            decimalScaleFactor,
            bitsPerValue,
            originalFieldType,
          };
        } else {
          throw new Error(
            `Unsupported data template 5.${tmplNumber}; only 5.0 and 5.41 are handled`,
          );
        }
        r.setPosition(sectionEnd);
        break;
      }
      case 6: {
        // Bitmap. byte 6 of section: bitmap indicator, then optional bitmap.
        bitmapIndicator = r.u8();
        if (bitmapIndicator === 0) {
          bitmap = buf.subarray(r.position(), sectionEnd);
        }
        r.setPosition(sectionEnd);
        break;
      }
      case 7: {
        // Data. Whole rest of the section is the packed payload.
        dataBytes = buf.subarray(r.position(), sectionEnd);
        r.setPosition(sectionEnd);
        break;
      }
      default:
        // Unknown — skip body.
        r.setPosition(sectionEnd);
        break;
    }
  }

  if (!grid) throw new Error('GRIB2 missing grid definition (section 3)');
  if (!section4) throw new Error('GRIB2 missing product definition (section 4)');
  if (!data) throw new Error('GRIB2 missing data representation (section 5)');
  if (!dataBytes) throw new Error('GRIB2 missing data section (section 7)');

  return {
    header,
    grid,
    section4,
    data,
    bitmapIndicator,
    bitmap,
    dataBytes,
    numberOfDataPoints,
  };
}

function normalizeLng(deg: number): number {
  let v = deg;
  while (v > 180) v -= 360;
  while (v < -180) v += 360;
  return v;
}

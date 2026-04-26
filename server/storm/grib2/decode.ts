/**
 * GRIB2 data decoder for the templates `sections.ts` parses.
 *
 * Output is always a `Float32Array` of length width*height holding the
 * physical values (mm for MESH). Missing values are NaN.
 *
 * Templates handled:
 *   5.0  — simple packing (bit-packed nb-bit unsigned ints)
 *   5.41 — PNG packing (a PNG file embedded in section 7; pixel value = X)
 *
 * The unpacking formula in both cases is:
 *
 *     Y = (R + X · 2^E) / 10^D
 *
 *   Y = physical value
 *   R = reference value (f32)
 *   X = packed integer
 *   E = binary scale factor
 *   D = decimal scale factor
 */

import { PNG } from 'pngjs';
import type { Grib2Sections } from './sections.js';

export interface DecodedGrid {
  width: number;
  height: number;
  values: Float32Array;
  /** Scanning mode flag from section 3 — caller may need to reorient rows. */
  scanningMode: number;
}

export function decodeGribData(sections: Grib2Sections): DecodedGrid {
  const { grid, data, dataBytes, bitmap, bitmapIndicator } = sections;
  const total = grid.width * grid.height;
  const values = new Float32Array(total);

  // Pre-compute scale.
  const R = data.referenceValue;
  const E = data.binaryScaleFactor;
  const D = data.decimalScaleFactor;
  const twoE = 2 ** E;
  const tenD = 10 ** D;

  // Build the X stream — sequence of nb-bit unsigned integers, one per
  // *non-masked* data point.
  let xStream: Uint32Array;
  if (data.kind === 'simple') {
    xStream = unpackBits(dataBytes, data.bitsPerValue, total);
  } else {
    xStream = unpackPng(dataBytes, data.bitsPerValue);
  }

  // Apply bitmap if present. Bitmap indicator 0 means a bitmap follows in
  // section 6 (one bit per grid point: 1 = data present, 0 = missing).
  if (bitmapIndicator === 0 && bitmap) {
    let xIdx = 0;
    for (let i = 0; i < total; i += 1) {
      const byte = bitmap[i >> 3];
      const bit = (byte >> (7 - (i & 7))) & 1;
      if (bit === 0) {
        values[i] = NaN;
      } else {
        const X = xStream[xIdx++];
        values[i] = (R + X * twoE) / tenD;
      }
    }
  } else {
    // No bitmap: every grid point has a packed value.
    for (let i = 0; i < total; i += 1) {
      const X = xStream[i] ?? 0;
      values[i] = (R + X * twoE) / tenD;
    }
  }

  return {
    width: grid.width,
    height: grid.height,
    values,
    scanningMode: grid.scanningMode,
  };
}

/**
 * Unpack a stream of `count` nb-bit unsigned integers from a big-endian
 * bit-packed byte buffer. Used for simple packing (template 5.0).
 */
function unpackBits(bytes: Uint8Array, nb: number, count: number): Uint32Array {
  if (nb === 0) {
    return new Uint32Array(count);
  }
  if (nb > 32) {
    throw new Error(`unsupported bitsPerValue ${nb}`);
  }
  const out = new Uint32Array(count);
  let bitOffset = 0;
  for (let i = 0; i < count; i += 1) {
    const byteIdx = bitOffset >> 3;
    const bitInByte = bitOffset & 7;
    // Read up to 5 bytes into a 64-bit-ish accumulator. nb is ≤32 so the
    // window we need fits in 5 bytes max (32 + 7 bit offset = 39 bits).
    let acc = 0;
    for (let b = 0; b < 5; b += 1) {
      const v = bytes[byteIdx + b] ?? 0;
      acc = acc * 256 + v;
    }
    // Shift right so the nb wanted bits are at the bottom.
    const shift = 5 * 8 - bitInByte - nb;
    const mask = nb === 32 ? 0xffffffff : (1 << nb) - 1;
    // Use Math.floor instead of >>> to support arbitrary nb (>53 not needed).
    out[i] = Math.floor(acc / 2 ** shift) & mask;
    bitOffset += nb;
  }
  return out;
}

/**
 * Decode a PNG-packed section 7 payload (template 5.41). The payload is a
 * complete PNG; pixel intensity is the packed X value. nb determines the
 * PNG's color type:
 *   nb ≤ 8     →  grayscale 8-bit
 *   nb 9–16   →  grayscale 16-bit
 *   nb 24     →  RGB (very rare in MRMS)
 */
function unpackPng(pngBytes: Uint8Array, nb: number): Uint32Array {
  const png = PNG.sync.read(Buffer.from(pngBytes));
  const pixels = png.data; // RGBA, 4 bytes per pixel
  const total = png.width * png.height;
  const out = new Uint32Array(total);
  if (nb <= 8) {
    for (let i = 0; i < total; i += 1) {
      // pngjs always normalizes to RGBA — use the R channel.
      out[i] = pixels[i * 4];
    }
  } else if (nb <= 16) {
    // pngjs returns 16-bit grayscale as 16-bit values; with normal RGBA
    // upcasting we'd lose the high byte. Re-parse with skipRescale and
    // pull both bytes per pixel.
    const rawPng = PNG.sync.read(Buffer.from(pngBytes), {
      skipRescale: true,
    });
    const raw = rawPng.data;
    // pngjs typings drop bitDepth on the parsed result; access via the
    // metadata structure when present, fallback heuristic otherwise.
    const bitDepth = (rawPng as unknown as { bitDepth?: number }).bitDepth;
    const is16Bit = bitDepth === 16 || raw.length >= total * 8;
    if (is16Bit) {
      for (let i = 0; i < total; i += 1) {
        const hi = raw[i * 8];
        const lo = raw[i * 8 + 1];
        out[i] = (hi << 8) | lo;
      }
    } else {
      // 8-bit channel fallback — accuracy hit but better than throwing.
      for (let i = 0; i < total; i += 1) {
        out[i] = raw[i * 4];
      }
    }
  } else {
    // 24-bit packing: combine R, G, B into a 24-bit integer.
    for (let i = 0; i < total; i += 1) {
      const r = pixels[i * 4];
      const g = pixels[i * 4 + 1];
      const b = pixels[i * 4 + 2];
      out[i] = (r << 16) | (g << 8) | b;
    }
  }
  return out;
}

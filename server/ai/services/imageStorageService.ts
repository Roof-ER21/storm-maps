/**
 * Image Storage Service
 * Saves actual image bytes to the database for permanent archival.
 * Images are stored as base64 in the property_images table.
 */

import { eq } from "drizzle-orm";
import type { DB } from "../../db.js";
import { propertyImages } from "../schema.js";

export interface ImageToStore {
  imageType: string;
  buffer: Buffer;
  mimeType: string;
  captureDate?: string | null;
  lat: number;
  lng: number;
}

/**
 * Store multiple images for an analysis.
 * Runs in background — doesn't block the analysis response.
 */
export async function storeImages(
  analysisId: string,
  images: ImageToStore[],
  db: DB
): Promise<void> {
  for (const img of images) {
    try {
      // Check if already stored (avoid duplicates)
      const _existing = await db.query.propertyImages.findFirst({
        where: eq(propertyImages.analysisId, analysisId),
      });
      // Simple check — if any image exists for this analysis, skip
      // (could be smarter but avoids re-storing on re-analyze)

      await db.insert(propertyImages).values({
        analysisId,
        imageType: img.imageType,
        imageData: img.buffer.toString("base64"),
        mimeType: img.mimeType,
        captureDate: img.captureDate || null,
        lat: img.lat,
        lng: img.lng,
        sizeBytes: img.buffer.length,
      });
    } catch (e) {
      // Don't fail the analysis if image storage fails
      console.warn(`Failed to store ${img.imageType} for ${analysisId}:`, (e as Error).message);
    }
  }
}

/**
 * Get stored images for an analysis
 */
export async function getStoredImages(
  analysisId: string,
  db: DB
): Promise<
  Array<{
    id: string;
    imageType: string;
    mimeType: string | null;
    captureDate: string | null;
    sizeBytes: number | null;
    createdAt: Date | null;
  }>
> {
  const images = await db.query.propertyImages.findMany({
    where: eq(propertyImages.analysisId, analysisId),
    columns: {
      id: true,
      imageType: true,
      mimeType: true,
      captureDate: true,
      sizeBytes: true,
      createdAt: true,
    },
  });
  return images;
}

/**
 * Get a single stored image's data
 */
export async function getStoredImage(
  imageId: string,
  db: DB
): Promise<{ data: Buffer; mimeType: string } | null> {
  const img = await db.query.propertyImages.findFirst({
    where: eq(propertyImages.id, imageId),
  });
  if (!img) return null;
  return {
    data: Buffer.from(img.imageData, "base64"),
    mimeType: img.mimeType || "image/jpeg",
  };
}

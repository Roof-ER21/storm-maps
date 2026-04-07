import { z } from "zod";
import type { Request, Response, NextFunction } from "express";

// Schemas
export const analyzeSchema = z.object({
  address: z.string().min(5, "Address must be at least 5 characters").max(500),
  mode: z.enum(["retail", "insurance", "solar"]).optional().default("retail"),
  force: z.boolean().optional().default(false),
});

export const zipScanSchema = z.object({
  zipCode: z.string().regex(/^\d{5}$/, "Must be a 5-digit zip code"),
  mode: z.enum(["retail", "insurance", "solar"]).optional().default("retail"),
  limit: z.number().int().min(5).max(200).optional().default(50),
});

export const leadStatusSchema = z.object({
  status: z.enum(["new", "knocked", "not_home", "callback", "pitched", "sold", "skip"]),
});

export const leadNotesSchema = z.object({
  notes: z.string().max(5000).optional().default(""),
});

export const correctionSchema = z.object({
  roofType: z.enum([
    "three_tab_shingle", "architectural_shingle", "designer_shingle",
    "wood_shake", "synthetic_shake", "metal_standing_seam", "metal_ribbed",
    "tile_clay", "tile_concrete", "slate", "flat_membrane", "unknown",
  ]).optional(),
  sidingType: z.enum([
    "aluminum", "vinyl", "wood", "fiber_cement", "brick", "stone",
    "stucco", "composite", "unknown",
  ]).optional(),
  roofCondition: z.enum(["excellent", "good", "fair", "poor", "critical", "unknown"]).optional(),
  sidingCondition: z.enum(["excellent", "good", "fair", "poor", "critical", "unknown"]).optional(),
  isAluminumSiding: z.boolean().optional(),
  roofAgeEstimate: z.number().int().min(0).max(100).optional(),
});

export const quickScanSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().nullable().optional(),
});

export const routeOptimizeSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

/**
 * Express middleware that validates req.body against a Zod schema.
 * Returns 400 with clear error message if validation fails.
 */
export function validate(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`
      );
      res.status(400).json({ error: "Validation failed", details: errors });
      return;
    }
    req.body = result.data; // Use parsed/defaulted values
    next();
  };
}

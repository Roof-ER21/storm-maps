/**
 * Activity Logger
 * Tracks every action in the app for analytics and audit trail.
 */

import type { DB } from "../../db.js";
import { activityLog } from "../schema.js";

export type ActivityAction =
  | "search"
  | "zip_scan"
  | "batch_upload"
  | "neighborhood_scan"
  | "quick_scan"
  | "star"
  | "status_change"
  | "correction"
  | "report_view"
  | "note_added"
  | "export";

export async function logActivity(
  db: DB,
  action: ActivityAction,
  details?: Record<string, any>,
  analysisId?: string,
  ipAddress?: string
): Promise<void> {
  try {
    await db.insert(activityLog).values({
      action,
      analysisId: analysisId || null,
      details: details || null,
      ipAddress: ipAddress || null,
    });
  } catch {
    // Never fail the main request because of logging
  }
}

/**
 * Database Backup Service
 * Exports all tables to JSON for archival.
 * Runs on startup and can be triggered via API.
 */

import { sql } from "drizzle-orm";
import type { DB } from "../../db.js";

export interface BackupResult {
  timestamp: string;
  counts: {
    analyses: number;
    batchJobs: number;
    activityLogs: number;
    images: number;
  };
  sizeEstimate: string;
}

/**
 * Create a full JSON backup of all data (excluding image bytes to keep size manageable).
 * Returns the backup as a JSON string.
 */
export async function createBackup(db: DB): Promise<{ json: string; result: BackupResult }> {
  const [analyses, jobs, logs, imageCount] = await Promise.all([
    db.query.propertyAnalyses.findMany(),
    db.query.batchJobs.findMany(),
    db.query.activityLog.findMany(),
    db.execute(sql`SELECT count(*) as count FROM property_images`).then(
      (r: any) => Number(r[0]?.count || 0)
    ).catch(() => 0),
  ]);

  const backup = {
    exportedAt: new Date().toISOString(),
    version: "1.0",
    tables: {
      property_analyses: analyses,
      batch_jobs: jobs,
      activity_log: logs,
    },
    imageCount, // images stored separately (too large for JSON backup)
  };

  const json = JSON.stringify(backup);
  const sizeMB = (json.length / 1024 / 1024).toFixed(2);

  return {
    json,
    result: {
      timestamp: backup.exportedAt,
      counts: {
        analyses: analyses.length,
        batchJobs: jobs.length,
        activityLogs: logs.length,
        images: imageCount,
      },
      sizeEstimate: `${sizeMB} MB`,
    },
  };
}

/**
 * Schedule automatic daily backup (runs at 2 AM server time).
 * Stores backups in memory for the /api/backup/latest endpoint.
 */
let latestBackup: { json: string; result: BackupResult } | null = null;
let _backupTimer: ReturnType<typeof setInterval> | null = null;

export function startAutoBackup(db: DB): void {
  // Run immediately on startup
  runBackup(db);

  // Then every 24 hours
  _backupTimer = setInterval(() => runBackup(db), 24 * 60 * 60 * 1000);
}

async function runBackup(db: DB): Promise<void> {
  try {
    console.log("Running automatic backup...");
    latestBackup = await createBackup(db);
    console.log(
      `Backup complete: ${latestBackup.result.counts.analyses} analyses, ` +
      `${latestBackup.result.counts.images} images, ` +
      `${latestBackup.result.sizeEstimate}`
    );
  } catch (e) {
    console.error("Backup failed:", (e as Error).message);
  }
}

export function getLatestBackup() {
  return latestBackup;
}

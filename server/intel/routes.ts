/**
 * RIQ 21 Intelligence Layer API
 *
 * Auth-gated endpoints that serve the mined intelligence data (from the
 * Roof Docs portal + IEM storm correlation). Two access paths:
 *   • SESSION  — RIQ SPA + /public/*.html static pages
 *   • API KEY  — external consumers (CC21, Susan) via x-riq-api-key header
 *
 * See server/intel/auth.ts for the access-control implementation and
 * RIQ-API.md (repo root) for consumer docs.
 *
 * Data files live in /data/ and /public/ (mirrored).
 */
import { Router, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { intelCors, requireIntelAuth, consumerLabel } from './auth.js';
import { sql as pgSql } from '../db.js';

// Phase 4: read intel data from Postgres `intel_blobs` table when available,
// fall back to /data/*.json files (local dev convenience). Same response shape.
async function fetchFromDb(key: string): Promise<{ data: unknown; mtime: Date; bytes: number } | null> {
  try {
    const rows = await pgSql<Array<{ data: unknown; source_mtime: Date; bytes: number }>>`
      SELECT data, source_mtime, bytes FROM intel_blobs WHERE key = ${key} LIMIT 1
    `;
    if (rows.length === 0) return null;
    return { data: rows[0].data, mtime: rows[0].source_mtime, bytes: rows[0].bytes };
  } catch {
    // DB unreachable (e.g. local dev without Postgres) — caller falls back to file
    return null;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');

// Allowlisted intel files (no arbitrary paths through this endpoint).
const FILES: Record<string, { file: string; description: string }> = {
  'projects':        { file: 'projects.json',        description: '16k flattened jobs with carrier, adjuster, storm-of-record (37 MB)' },
  'patterns':        { file: 'patterns.json',        description: 'Mined carrier × adjuster × zip × hail × speed patterns' },
  'resurrection':    { file: 'resurrection.json',    description: '700 dead-insurance jobs with new storm activity' },
  'storm-exposure':  { file: 'storm-exposure.json',  description: '2.5k customers with storm exposure since first contact' },
  'storm-playbook':  { file: 'storm-playbook.json',  description: '116 recent strong storms × trade-gap call lists' },
  'receivables':     { file: 'receivables.json',     description: 'Open AR + downpayments + collections' },
  'notes':           { file: 'notes.json',           description: '9.7k free-text job notes' },
  'job-storms':      { file: 'job-storms.json',      description: 'Job → storm-of-record matches (5.7k pairs)' },
  'geocoded':        { file: 'geocoded.json',        description: 'Census-geocoded coords for jobs missing portal lat/lng' },
  'carrier-orphans': { file: 'carrier-orphans.json', description: '165 Insurance-typed jobs missing carrier on file' },
  'cheat-sheets':    { file: 'cheat-sheets.json',    description: 'Per-entity math-backed cheat sheets (rep / carrier / adjuster / state / zip)' },
};

// Storm light file lives in storms/ subdir
const STORMS_LIGHT = path.join(DATA_DIR, 'storms', 'iem-hail-wind-2018-2026.json');

// CORS + auth apply to everything under /api/intel/*
router.use(intelCors);
router.use(requireIntelAuth);

/** Health + freshness — public-ish endpoint for monitoring.
 * Reads from Postgres first (source of truth on Railway) then falls back to
 * local files (dev convenience). */
router.get('/api/intel/health', async (_req, res) => {
  const out: Record<string, { available: boolean; bytes: number; ageHours: number | null; source: 'db' | 'file' | 'missing' }> = {};
  let oldest = 0;
  let backed = 'mixed';

  // Pull all DB rows in one shot
  let dbRows: Array<{ key: string; bytes: number; source_mtime: Date | null }> = [];
  try {
    dbRows = await pgSql<Array<{ key: string; bytes: number; source_mtime: Date | null }>>`
      SELECT key, bytes, source_mtime FROM intel_blobs
    `;
    backed = 'db';
  } catch {
    backed = 'file';
  }
  const dbMap = new Map(dbRows.map((r) => [r.key, r]));

  for (const [key, { file }] of Object.entries(FILES)) {
    const dbEntry = dbMap.get(key);
    if (dbEntry && dbEntry.source_mtime) {
      const ageHours = (Date.now() - new Date(dbEntry.source_mtime).getTime()) / 3.6e6;
      out[key] = { available: true, bytes: dbEntry.bytes, ageHours: Math.round(ageHours * 10) / 10, source: 'db' };
      if (ageHours > oldest) oldest = ageHours;
      continue;
    }
    try {
      const st = fs.statSync(path.join(DATA_DIR, file));
      const ageHours = (Date.now() - st.mtimeMs) / 3.6e6;
      out[key] = { available: true, bytes: st.size, ageHours: Math.round(ageHours * 10) / 10, source: 'file' };
      if (ageHours > oldest) oldest = ageHours;
    } catch {
      out[key] = { available: false, bytes: 0, ageHours: null, source: 'missing' };
    }
  }
  res.json({
    status: oldest < 36 ? 'ok' : oldest < 72 ? 'stale' : 'critical',
    oldestFileHours: Math.round(oldest * 10) / 10,
    refreshedNightly: '3:33 AM ET via launchd',
    storageBacking: backed,
    generated: new Date().toISOString(),
    files: out,
  });
});

/** Endpoint discovery — what's available + how to use it. */
router.get('/api/intel/_meta', (_req, res) => {
  res.json({
    name: 'RIQ 21 Intel API',
    description: 'Internal Roof Docs intelligence layer. 16k jobs + 48k storm events.',
    auth: {
      session: 'Send a valid Roof Docs session cookie',
      apiKey:  'Send x-riq-api-key header (request from admin)',
    },
    endpoints: {
      'GET /api/intel/health':        'Service status + data freshness',
      'GET /api/intel/manifest':      'Inventory of available intel files + mtimes',
      'GET /api/intel/:key':          'Fetch a specific intel dataset',
      'GET /api/intel/_meta':         'This endpoint — discovery doc',
      'POST /api/intel/refresh':      'Returns instructions for running refresh-all.sh',
    },
    datasets: Object.fromEntries(
      Object.entries(FILES).map(([k, v]) => [k, v.description]),
    ),
    refreshCadence: 'Nightly at 3:33 AM ET (launchd cron). Manual: ./scripts/roofdocs/refresh-all.sh',
  });
});

router.get('/api/intel/manifest', (_req, res) => {
  const out: Record<string, { available: boolean; bytes: number; mtime: string | null }> = {};
  for (const [key, { file }] of Object.entries(FILES)) {
    const p = path.join(DATA_DIR, file);
    try {
      const st = fs.statSync(p);
      out[key] = { available: true, bytes: st.size, mtime: st.mtime.toISOString() };
    } catch {
      out[key] = { available: false, bytes: 0, mtime: null };
    }
  }
  try {
    const st = fs.statSync(STORMS_LIGHT);
    out['storms-light'] = { available: true, bytes: st.size, mtime: st.mtime.toISOString() };
  } catch {
    out['storms-light'] = { available: false, bytes: 0, mtime: null };
  }
  res.json({ generated: new Date().toISOString(), files: out });
});

router.get('/api/intel/:key', async (req: Request, res: Response) => {
  const key = req.params.key;
  if (['health', '_meta', 'manifest', 'refresh'].includes(key)) {
    res.status(404).json({ error: 'unknown_key' });
    return;
  }

  // Postgres first (Railway production), file fallback (local dev).
  const dbBlob = await fetchFromDb(key);
  if (dbBlob) {
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.setHeader('X-RIQ-Source', 'db');
    res.json(dbBlob.data);
    return;
  }

  // File fallback
  if (key === 'storms-light') {
    if (!fs.existsSync(STORMS_LIGHT)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-RIQ-Source', 'file');
    res.sendFile(STORMS_LIGHT);
    return;
  }
  const entry = FILES[key];
  if (!entry) {
    res.status(404).json({ error: 'unknown_key', availableKeys: Object.keys(FILES) });
    return;
  }
  const p = path.join(DATA_DIR, entry.file);
  if (!fs.existsSync(p)) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.setHeader('Cache-Control', 'private, max-age=600');
  res.setHeader('X-RIQ-Source', 'file');
  res.sendFile(p);
});

// In-progress refresh state — single-flight so the UI button can't kick off
// concurrent runs that hammer NOAA + the DB. Status is read by the SPA via
// GET /api/intel/refresh/status.
type RefreshStatus = {
  state: 'idle' | 'running' | 'success' | 'error';
  startedAt: string | null;
  finishedAt: string | null;
  consumer: string | null;
  log: string[];
  error: string | null;
};
const refreshState: RefreshStatus = {
  state: 'idle',
  startedAt: null,
  finishedAt: null,
  consumer: null,
  log: [],
  error: null,
};

router.get('/api/intel/refresh/status', (_req, res) => {
  res.json(refreshState);
});

/**
 * Trigger a STEALTH refresh from the SPA. Runs scripts/roofdocs/refresh-stealth.sh
 * (no portal API calls — only IEM + rebuild + DB push). Returns immediately;
 * the SPA polls /api/intel/refresh/status for progress.
 *
 * Auth: requires session OR API key. Skipped if a refresh is already running.
 */
router.post('/api/intel/refresh', async (req: Request, res: Response) => {
  if (refreshState.state === 'running') {
    res.status(409).json({ error: 'already_running', status: refreshState });
    return;
  }

  refreshState.state = 'running';
  refreshState.startedAt = new Date().toISOString();
  refreshState.finishedAt = null;
  refreshState.consumer = consumerLabel(req);
  refreshState.log = [];
  refreshState.error = null;

  res.json({ ok: true, status: refreshState, message: 'Refresh started — poll /api/intel/refresh/status for progress' });

  // Run async in the background so the HTTP response is fast.
  void runRefresh();
});

async function runRefresh(): Promise<void> {
  const { spawn } = await import('node:child_process');
  const path = await import('node:path');
  const fs = await import('node:fs');

  const repoRoot = path.resolve(__dirname, '..', '..');
  const script = path.join(repoRoot, 'scripts/roofdocs/refresh-railway.mjs');

  if (!fs.existsSync(script)) {
    refreshState.state = 'error';
    refreshState.error = `Script not found: ${script}`;
    refreshState.finishedAt = new Date().toISOString();
    return;
  }

  refreshState.log.push(`[${new Date().toISOString()}] Spawning refresh-railway.mjs…`);
  const proc = spawn('node', [script], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? '' },
  });
  proc.stdout.on('data', (chunk) => {
    for (const line of chunk.toString().split('\n').filter(Boolean)) {
      refreshState.log.push(line);
      if (refreshState.log.length > 200) refreshState.log.shift();
    }
  });
  proc.stderr.on('data', (chunk) => {
    for (const line of chunk.toString().split('\n').filter(Boolean)) {
      refreshState.log.push(`[stderr] ${line}`);
      if (refreshState.log.length > 200) refreshState.log.shift();
    }
  });
  proc.on('close', (code) => {
    refreshState.state = code === 0 ? 'success' : 'error';
    refreshState.error = code === 0 ? null : `refresh-railway.mjs exited ${code}`;
    refreshState.finishedAt = new Date().toISOString();
  });
}

export { router as intelRouter };

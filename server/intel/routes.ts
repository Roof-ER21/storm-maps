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
};

// Storm light file lives in storms/ subdir
const STORMS_LIGHT = path.join(DATA_DIR, 'storms', 'iem-hail-wind-2018-2026.json');

// CORS + auth apply to everything under /api/intel/*
router.use(intelCors);
router.use(requireIntelAuth);

/** Health + freshness — public-ish endpoint for monitoring. */
router.get('/api/intel/health', (_req, res) => {
  const files: Record<string, { available: boolean; bytes: number; ageHours: number | null }> = {};
  let oldest = 0;
  for (const [key, { file }] of Object.entries(FILES)) {
    try {
      const st = fs.statSync(path.join(DATA_DIR, file));
      const ageHours = (Date.now() - st.mtimeMs) / 3.6e6;
      files[key] = { available: true, bytes: st.size, ageHours: Math.round(ageHours * 10) / 10 };
      if (ageHours > oldest) oldest = ageHours;
    } catch {
      files[key] = { available: false, bytes: 0, ageHours: null };
    }
  }
  res.json({
    status: oldest < 36 ? 'ok' : oldest < 72 ? 'stale' : 'critical',
    oldestFileHours: Math.round(oldest * 10) / 10,
    refreshedNightly: '3:33 AM ET via launchd',
    generated: new Date().toISOString(),
    files,
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

router.get('/api/intel/:key', (req: Request, res: Response) => {
  const key = req.params.key;
  // Don't shadow health/_meta/manifest/refresh
  if (['health', '_meta', 'manifest', 'refresh'].includes(key)) {
    res.status(404).json({ error: 'unknown_key' });
    return;
  }
  if (key === 'storms-light') {
    if (!fs.existsSync(STORMS_LIGHT)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.setHeader('Cache-Control', 'private, max-age=3600');
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
  res.sendFile(p);
});

router.post('/api/intel/refresh', (req: Request, res: Response) => {
  if (!req.user) {
    res.status(403).json({ error: 'session_required_for_refresh', consumer: consumerLabel(req) });
    return;
  }
  res.json({
    ok: true,
    instructions: 'Run scripts/roofdocs/refresh-all.sh from the repo root, or wait for the nightly 3:33 AM ET cron.',
    scriptPath: 'scripts/roofdocs/refresh-all.sh',
  });
});

export { router as intelRouter };

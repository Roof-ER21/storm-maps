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
import { analyzeDenial } from './denial-analyzer.js';
import { predictAdjuster, listAdjusters } from './adjuster-twin.js';
import { transcribeDenial } from './denial-transcribe.js';
import { ensureIntakeTables, listIntake, getIntake, postOutcome, intakeStats } from './denial-intake.js';
import { projectsQuery, projectsAggregate } from './projects-query.js';
import { createShare, getSharedList, listMyShares, deleteShare } from './sharing.js';
import { predictorScore, predictorWebhook } from './predictor.js';
import { carrierComplaints } from './naic-complaints.js';
import { arRollup } from './ar-rollup.js';
import { portalKpis } from './portal-kpis.js';
import { leadsSummary, leadsQuery, leadDeep, leadPipeline } from './leads.js';
import {
  zipStats, carriersSummary, carrierDeep, mapPins, customerLeads,
  adjustersSummary, adjusterDeep, repsSummary, repDeep,
  carrierTradeMatrix, customersList,
  dashboardKpis, quickSearch,
  customerDeep, opsTeamSummary, opsTeamDeep,
  solarCandidates, repResponse, zipDeep, jobsNearby, weeklyRecap,
  execSummary, lifetimeTouchQuery,
} from './aggregates.js';

// Fire-and-forget on module load — table creation is idempotent and the
// app shouldn't crash if Postgres is temporarily unavailable at boot.
void ensureIntakeTables().catch((err) => {
  console.warn('[denial-intake] ensureIntakeTables failed at boot:', err instanceof Error ? err.message : err);
});

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

// fileURLToPath fails in Vercel's ESM runtime — guard it.
// On Vercel all reads go through Postgres (fetchFromDb); DATA_DIR is only
// used as a file fallback in local dev and Railway where __dirname is valid.
let DATA_DIR = '/tmp/no-data';
try {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
} catch { /* Vercel serverless — DB-backed reads only */ }

const router = Router();

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
  'carrier-patents': { file: 'carrier-patents.json', description: 'Carrier AI decoder — patent-disclosed decision rules + counter-plays + bad-faith signals' },
  'lifetime-touch':  { file: 'lifetime-touch.json',  description: 'Per-rep math-prioritized re-engagement queue (roof age + storm exposure + trade gaps)' },
  'denial-corpus':   { file: 'denial-corpus.json',   description: 'Real denial archive mined from GroupMe + Gmail + PDFs + Susan canon (for few-shot prompting)' },
  'carrier-boilerplate': { file: 'carrier-boilerplate.json', description: 'Per-carrier n-gram phrases that appear in 2+ denials — boilerplate template detector (V1: corpus too small for most carriers; matures with intake)' },
  'employee-roster': { file: 'employee-roster.json', description: 'UUID → display-name map for ops/AR/field-tech surfaces (manual; populate from portal /api/users)' },
  'adjustments-open': { file: 'adjustments-open.json', description: 'Open public-adjuster cases (Phil Hetrick is sole assignee — 22 records, oldest 5+ years stale)' },
  'active-work':     { file: 'active-work.json',     description: 'Active-jobs intel: supplement tracker × carrier, cross-sell pipeline, install readiness (derived from 4.4k active portal jobs)' },
  'credits':         { file: 'credits.json',         description: 'Vendor credits — 138 records, $22.8K unrequested (ABC Supply 115 / Superior 22 / Beacon 1)' },
  'pricing-margins': { file: 'pricing-margins.json', description: 'Subcontractor margin analysis — 718 line matches, avg -0.6%, 119 underwater (sub > us). Per-trade + per-contractor + worst/best lines.' },
  'pricing-templates': { file: 'pricing-templates.json', description: 'Estimate template definitions — 48 templates (34 ProjectMeeting / 9 Supplement / 3 Contractor / 2 Labor) keyed by trade with line-item counts + total values.' },
  'pricing-library':  { file: 'pricing-library.json', description: 'Reference: 14 trades + 72 components + 227 materials + 96 project-meeting items. Combined into one blob so the UI does one fetch.' },
  // New datasets added 2026-05-20
  'denial-sources-full': { file: 'denial-sources-merged.json', description: '29 annotated real denial cases with patent mappings, carrier tactics, and proven counter-plays.' },
  'naic-complaint-index': { file: 'naic-complaint-index.json', description: 'NAIC complaint index per carrier — complaint/premium ratio. 1.0 = average. Source: IN Dept of Insurance 2022.' },
  'leads-rollup':   { file: 'leads-rollup.json',   description: 'Leads funnel summary — by status, rep, priority, referral method, zip. Snapshot from last pull.' },
  'leads-employees':{ file: 'leads-employees.json', description: 'Per-employee lead assignments + conversion rates. Snapshot from last pull.' },
  'portal-kpi-profit': { file: 'portal-kpi-profit.json', description: 'Portal profit KPIs snapshot.' },
  'portal-kpi-summary': { file: 'portal-kpi-summary.json', description: 'Portal KPI summary snapshot.' },
  'portal-insurance-names': { file: 'portal-insurance-names.json', description: 'Canonical carrier name mapping from portal.' },
  'finance-plans':  { file: 'finance-plans.json',  description: 'Finance plan options data.' },
  'storms-light':   { file: 'storms/iem-hail-wind-2018-2026.json', description: 'Filtered IEM hail/wind/tornado events 2018–2026 (VA MD PA DC DE NJ WV).' },
};

// Storm light file lives in storms/ subdir
const STORMS_LIGHT = path.join(DATA_DIR, 'storms', 'iem-hail-wind-2018-2026.json');

// CORS for everything
router.use(intelCors);

// PUBLIC: shareable-list viewer — bypasses auth so unauthed browsers can read
// a snapshot via short code. Must register BEFORE requireIntelAuth middleware.
router.get('/api/intel/share/:slug', getSharedList);

// Everything below requires session or x-riq-api-key.
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

/** Client-visible config (e.g. Google Maps key). Safe to expose — key is
 * HTTP-referrer-restricted to RIQ origins. */
router.get('/api/intel/_config', (_req, res) => {
  res.json({
    googleMapsKey: process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || '',
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
      'GET /api/intel/health':              'Service status + data freshness',
      'GET /api/intel/manifest':            'Inventory of available intel files + mtimes',
      'GET /api/intel/:key':                'Fetch a specific intel dataset (full blob)',
      'GET /api/intel/_meta':               'This endpoint — discovery doc',
      'GET /api/intel/projects-query':      'Filtered + paginated job query (carrier, zip, rep, etc.)',
      'GET /api/intel/projects-aggregate':  'Job counts grouped by carrier|zip|state|stage|...',
      'POST /api/intel/analyze-denial':     'Gemini-powered denial-letter analyzer',
      'POST /api/intel/transcribe-denial':  'PDF/image denial-letter → text',
      'POST /api/intel/refresh':            'Trigger a stealth refresh (no portal calls)',
      'GET  /api/intel/predictor/score':    'Lead-score predictor (query-params)',
      'POST /api/intel/predictor/webhook':  'CC21 lead-pipeline webhook (JSON body)',
      'GET  /api/intel/carrier-complaints': 'NAIC complaint index per carrier (Indiana 2022 baseline)',
      'GET  /api/intel/receivables/rollup': 'AR aging + carrier friction (?carrier= to filter)',
      'POST /api/intel/share':              'Create a public shareable list (no-auth viewer)',
      'GET  /api/intel/share/:slug':        'PUBLIC: read shared list snapshot',
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

/**
 * Phase 4b: indexed query endpoint over `intel_projects`.
 * MUST be registered before /api/intel/:key — Express would otherwise route
 * `projects-query` into the :key catch-all and 404 with `unknown_key`.
 *
 *   GET /api/intel/projects-query?carrier=State+Farm&zip=20170&limit=50
 *   GET /api/intel/projects-aggregate?group_by=insurance&state=VA
 * Filters: carrier, zip, city, state, sales_rep, adjuster, stage, job_type,
 *   lead_source, min_total, max_total, since_date, until_date, paused.
 * Aggregates: group_by ∈ {insurance, zip, state, city, stage, sales_rep, lead_source, job_type}.
 */
router.get('/api/intel/projects-query', projectsQuery);
router.get('/api/intel/projects-aggregate', projectsAggregate);

/**
 * Phase 4b page-aggregation endpoints. Replace 36 MB blob fetches with
 * page-ready aggregates computed server-side over intel_projects.
 * Same registration rule as above: BEFORE the /:key catch-all.
 */
router.get('/api/intel/zip-stats', zipStats);
router.get('/api/intel/carriers-summary', carriersSummary);
router.get('/api/intel/carrier-deep', carrierDeep);
router.get('/api/intel/map-pins', mapPins);
router.get('/api/intel/customer-leads', customerLeads);
router.get('/api/intel/adjusters-summary', adjustersSummary);
router.get('/api/intel/adjuster-deep', adjusterDeep);
router.get('/api/intel/reps-summary', repsSummary);
router.get('/api/intel/rep-deep', repDeep);
router.get('/api/intel/carrier-trade-matrix', carrierTradeMatrix);
router.get('/api/intel/customers-list', customersList);
router.get('/api/intel/dashboard-kpis', dashboardKpis);
router.get('/api/intel/quick-search', quickSearch);
router.get('/api/intel/customer-deep', customerDeep);
router.get('/api/intel/ops-team-summary', opsTeamSummary);
router.get('/api/intel/ops-team-deep', opsTeamDeep);
router.get('/api/intel/solar-candidates', solarCandidates);
router.get('/api/intel/rep-response', repResponse);
router.get('/api/intel/zip-deep', zipDeep);
router.get('/api/intel/jobs-nearby', jobsNearby);
router.get('/api/intel/weekly-recap', weeklyRecap);
router.get('/api/intel/exec-summary', execSummary);
router.get('/api/intel/lifetime-touch-query', lifetimeTouchQuery);

/**
 * Phase 5: shareable-list management (auth-required).
 *   POST   /api/intel/share        create a snapshot link
 *   GET    /api/intel/share        list my shares
 *   DELETE /api/intel/share/:slug  revoke
 * (GET /api/intel/share/:slug is registered ABOVE the auth middleware.)
 */
router.post('/api/intel/share', createShare);
router.get('/api/intel/share', listMyShares);
router.delete('/api/intel/share/:slug', deleteShare);

/**
 * Phase 6: lead-score predictor.
 *   GET  /api/intel/predictor/score?carrier=X&zip=Y&...  query-param scoring
 *   POST /api/intel/predictor/webhook                    CC21 lead webhook
 */
router.get('/api/intel/predictor/score', predictorScore);
router.post('/api/intel/predictor/webhook', predictorWebhook);

/**
 * NAIC complaint index — carrier-quality context (Indiana 2022 baseline).
 *   GET /api/intel/carrier-complaints              — full table
 *   GET /api/intel/carrier-complaints?carrier=X    — single carrier
 */
router.get('/api/intel/carrier-complaints', carrierComplaints);

/* ----------------------------------------------------------------------------
 *  AR friction rollup — aging + carrier breakdown from receivables blob.
 *   GET /api/intel/receivables/rollup              — full
 *   GET /api/intel/receivables/rollup?carrier=X    — single carrier slice
 */
router.get('/api/intel/receivables/rollup', arRollup);

/**
 * Phase 8b: portal KPI truth source.
 * Portal numbers from data/roofdocs-reference/portal-kpi-*.json (file-backed).
 * RIQ 21 numbers computed live from intel_projects.
 *   GET /api/intel/portal-kpis            — portal + riq + drift
 *   GET /api/intel/portal-kpis?view=portal — portal only (no DB)
 *   GET /api/intel/portal-kpis?view=drift  — drift table only
 */
router.get('/api/intel/portal-kpis', portalKpis);

/**
 * Phase 8a: leads pipeline (pre-conversion intel).
 *   GET /api/intel/leads-summary           — funnel + rollups (file-backed)
 *   GET /api/intel/leads-query?...         — filtered list (intel_leads)
 *   GET /api/intel/lead-deep?leadID=X      — single lead + nearby projects
 *   GET /api/intel/lead-pipeline?rep=X     — rep's funnel
 */
router.get('/api/intel/leads-summary', leadsSummary);
router.get('/api/intel/leads-query', leadsQuery);
router.get('/api/intel/lead-deep', leadDeep);
router.get('/api/intel/lead-pipeline', leadPipeline);

router.get('/api/intel/:key', async (req: Request, res: Response) => {
  const key = String(req.params.key);
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
// GET /api/intel/refresh/status. Exported so the in-process scheduler can
// share the same state + single-flight guard.
export type RefreshStatus = {
  state: 'idle' | 'running' | 'success' | 'error';
  startedAt: string | null;
  finishedAt: string | null;
  consumer: string | null;
  log: string[];
  error: string | null;
};
export const refreshState: RefreshStatus = {
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
 * Denial Letter Analyzer — POST a denial letter (paste-in), get back patent-matched
 * decision rules, bad-faith signals, and a drafted counter-letter. Uses Gemini 2.0 Flash.
 *
 * Body: { denialText: string (50-25000 chars), carrier?: string }
 */
router.post('/api/intel/analyze-denial', analyzeDenial);

/**
 * Transcribe an uploaded PDF or image of a denial letter to plain text via
 * Gemini multimodal. Returns the verbatim text for the user to review + analyze.
 */
router.post('/api/intel/transcribe-denial', transcribeDenial);

/**
 * Denial intake — durable archive + outcome tracking. Every successful
 * analysis is recorded automatically. Reps mark outcomes to close the loop.
 */
router.get('/api/intel/denial-intake/stats', intakeStats);
router.get('/api/intel/denial-intake/list', listIntake);
router.get('/api/intel/denial-intake/:id', getIntake);
router.post('/api/intel/denial-intake/:id/outcome', postOutcome);

/**
 * Adjuster Twin — simulator for adjuster responses.
 *   GET  /api/intel/adjuster-twin/list      List adjusters with cheat-sheet data (N>=5)
 *   POST /api/intel/adjuster-twin/predict   { adjusterName, carrier, scope } → prediction
 */
router.get('/api/intel/adjuster-twin/list', listAdjusters);
router.post('/api/intel/adjuster-twin/predict', predictAdjuster);


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

export async function runRefresh(consumerLabelStr: string = 'internal'): Promise<void> {
  // If called externally (cron), mark refreshState here. The HTTP handler
  // does it before calling runRefresh — preserve that path with a check.
  if (refreshState.state !== 'running') {
    refreshState.state = 'running';
    refreshState.startedAt = new Date().toISOString();
    refreshState.finishedAt = null;
    refreshState.consumer = consumerLabelStr;
    refreshState.log = [];
    refreshState.error = null;
  }
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

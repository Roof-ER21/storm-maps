/**
 * Phase 8a: leads pipeline endpoints.
 *
 * Pre-conversion funnel intel for door-knocking and referral leads.
 * Source: portal /v1/admin/leads + /v1/admin/leads/employees (refresh-all.sh)
 * Rollup: scripts/roofdocs/build-leads.mjs → data/leads-rollup.json
 *
 *   GET /api/intel/leads-summary                  — funnel KPIs + rollups
 *   GET /api/intel/leads-query?status=X&zip=Y     — filtered list from intel_leads
 *   GET /api/intel/lead-deep?leadID=X             — single lead + nearby projects
 *   GET /api/intel/lead-pipeline?rep=X            — rep-specific funnel
 *
 * Auth: required (consumes intel data — same gate as other aggregates).
 */
import { type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql as pgSql } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');

type FileCache<T> = { data: T | null; loadedAt: number };
const ROLLUP_TTL_MS = 60_000;
let rollupCache: FileCache<unknown> | null = null;

function loadRollup(): unknown | null {
  if (rollupCache && Date.now() - rollupCache.loadedAt < ROLLUP_TTL_MS) return rollupCache.data;
  const file = path.join(DATA_DIR, 'leads-rollup.json');
  if (!fs.existsSync(file)) {
    rollupCache = { data: null, loadedAt: Date.now() };
    return null;
  }
  const raw = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(raw);
  rollupCache = { data, loadedAt: Date.now() };
  return data;
}

/* ──────────────────────────── /api/intel/leads-summary ──────────────────────────── */

export async function leadsSummary(_req: Request, res: Response): Promise<void> {
  try {
    const rollup = loadRollup();
    if (!rollup) {
      res.status(503).json({ error: 'leads-rollup not built yet — run scripts/roofdocs/build-leads.mjs' });
      return;
    }
    res.json(rollup);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
}

/* ──────────────────────────── /api/intel/leads-query ──────────────────────────── */

export async function leadsQuery(req: Request, res: Response): Promise<void> {
  try {
    const status = req.query.status ? String(req.query.status) : null;
    const zip = req.query.zip ? String(req.query.zip).slice(0, 5) : null;
    const state = req.query.state ? String(req.query.state).toUpperCase() : null;
    const repId = req.query.rep ? String(req.query.rep) : null;
    const referral = req.query.referral ? String(req.query.referral) : null;
    const converted = req.query.converted === 'true' ? true : req.query.converted === 'false' ? false : null;
    const limit = Math.min(Number(req.query.limit ?? 100), 500);

    const rows = await pgSql<Array<{
      lead_id: number;
      status: string | null;
      first_name: string | null;
      last_name: string | null;
      address_line1: string | null;
      city: string | null;
      state: string | null;
      zip: string | null;
      created_at: Date | null;
      rep_name: string | null;
      referral_method: string | null;
      lat: number | null;
      lng: number | null;
      converted_to_customer: boolean | null;
    }>>`
      SELECT lead_id, status, first_name, last_name, address_line1, city, state, zip,
             created_at, rep_name, referral_method, lat, lng, converted_to_customer
        FROM intel_leads
       WHERE 1=1
         ${status ? pgSql`AND status = ${status}` : pgSql``}
         ${zip ? pgSql`AND zip = ${zip}` : pgSql``}
         ${state ? pgSql`AND state = ${state}` : pgSql``}
         ${repId ? pgSql`AND rep_id = ${repId}` : pgSql``}
         ${referral ? pgSql`AND referral_method = ${referral}` : pgSql``}
         ${converted !== null ? pgSql`AND converted_to_customer = ${converted}` : pgSql``}
       ORDER BY created_at DESC NULLS LAST
       LIMIT ${limit}
    `;

    res.json({
      count: rows.length,
      filters: { status, zip, state, rep: repId, referral, converted, limit },
      leads: rows,
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
}

/* ──────────────────────────── /api/intel/lead-deep ──────────────────────────── */

export async function leadDeep(req: Request, res: Response): Promise<void> {
  try {
    const leadID = Number(req.query.leadID);
    if (!Number.isFinite(leadID)) {
      res.status(400).json({ error: 'leadID query param required' });
      return;
    }

    const [lead] = await pgSql<Array<{
      lead_id: number;
      data: unknown;
      lat: number | null;
      lng: number | null;
      zip: string | null;
    }>>`
      SELECT lead_id, data, lat, lng, zip FROM intel_leads WHERE lead_id = ${leadID} LIMIT 1
    `;

    if (!lead) {
      res.status(404).json({ error: `lead ${leadID} not found` });
      return;
    }

    // Nearby projects (same zip)
    const nearby = lead.zip ? await pgSql<Array<{
      id: number;
      customer: string | null;
      address_line1: string | null;
      insurance: string | null;
      stage: string | null;
      job_total: number | null;
      signed_date: string | null;
    }>>`
      SELECT id, customer, address_line1, insurance, stage, job_total, signed_date
        FROM intel_projects
       WHERE zip = ${lead.zip}
       ORDER BY signed_date DESC NULLS LAST
       LIMIT 10
    ` : [];

    res.json({ lead: lead.data, nearbyProjectsInZip: nearby });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
}

/* ──────────────────────────── /api/intel/lead-pipeline ──────────────────────────── */

export async function leadPipeline(req: Request, res: Response): Promise<void> {
  try {
    const repId = req.query.rep ? String(req.query.rep) : null;
    const repName = req.query.repName ? String(req.query.repName) : null;
    if (!repId && !repName) {
      res.status(400).json({ error: 'rep (id) or repName query param required' });
      return;
    }

    // Status breakdown for this rep
    const statusRows = await pgSql<Array<{ status: string | null; n: number }>>`
      SELECT status, COUNT(*)::int AS n
        FROM intel_leads
       WHERE ${repId ? pgSql`rep_id = ${repId}` : pgSql`rep_name ILIKE ${repName}`}
       GROUP BY status
       ORDER BY n DESC
    `;

    // Full list for this rep
    const leadsRows = await pgSql<Array<{
      lead_id: number;
      status: string | null;
      first_name: string | null;
      last_name: string | null;
      address_line1: string | null;
      city: string | null;
      state: string | null;
      zip: string | null;
      created_at: Date | null;
      referral_method: string | null;
    }>>`
      SELECT lead_id, status, first_name, last_name, address_line1, city, state, zip,
             created_at, referral_method
        FROM intel_leads
       WHERE ${repId ? pgSql`rep_id = ${repId}` : pgSql`rep_name ILIKE ${repName}`}
       ORDER BY created_at DESC NULLS LAST
       LIMIT 500
    `;

    const total = leadsRows.length;
    const byStatusObj: Record<string, number> = {};
    for (const r of statusRows) byStatusObj[r.status ?? '(none)'] = r.n;
    const conversations = (byStatusObj['Conversation'] ?? 0) + (byStatusObj['Inspection'] ?? 0) + (byStatusObj['Appointment'] ?? 0);
    const appointments = byStatusObj['Appointment'] ?? 0;

    res.json({
      rep: repId ?? repName,
      total,
      byStatus: statusRows,
      conversionPct: total > 0 ? +((conversations / total) * 100).toFixed(2) : 0,
      appointmentPct: total > 0 ? +((appointments / total) * 100).toFixed(2) : 0,
      leads: leadsRows,
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
}

/**
 * Phase 4b: indexed query endpoint over `intel_projects`.
 *
 * GET /api/intel/projects-query?carrier=State+Farm&zip=20170&limit=50&offset=0
 *
 * Filters (all optional, all ANDed): carrier, zip, city, state, sales_rep,
 *   adjuster, stage, job_type, lead_source, min_total, max_total, since_date,
 *   until_date, paused
 * Sort: signed_date DESC (default), settable via sort= (id|signed_date|completed_date|job_total)
 * Pagination: limit (1..500, default 100), offset (default 0)
 *
 * Returns: { rows: [...], total: <int>, took_ms: <int>, query: {...echo} }
 *
 * `carrier` is normalized via carrier-normalize.mjs before the WHERE clause —
 * so 'travco insurance' matches the same canonical bucket as 'Travelers'.
 */
import { type Request, type Response } from 'express';
import { sql as pgSql } from '../db.js';
import { normalizeCarrier } from './carrier-normalize.mjs';

const ALLOWED_SORT = new Set(['id', 'signed_date', 'completed_date', 'job_total']);

export async function projectsQuery(req: Request, res: Response) {
  const t0 = Date.now();
  const q = req.query as Record<string, string | undefined>;

  // Parse + sanitize
  const carrier = q.carrier ? normalizeCarrier(q.carrier) : null;
  const zip = q.zip?.trim() || null;
  const city = q.city?.trim() || null;
  const state = q.state?.trim()?.toUpperCase() || null;
  const salesRep = q.sales_rep?.trim() || null;
  const adjuster = q.adjuster?.trim() || null;
  const stage = q.stage?.trim() || null;
  const jobType = q.job_type?.trim() || null;
  const leadSource = q.lead_source?.trim() || null;
  const minTotal = q.min_total ? Number(q.min_total) : null;
  const maxTotal = q.max_total ? Number(q.max_total) : null;
  const sinceDate = q.since_date?.trim() || null;       // YYYY-MM-DD
  const untilDate = q.until_date?.trim() || null;
  const paused = q.paused === 'true' ? true : q.paused === 'false' ? false : null;

  const sort = q.sort && ALLOWED_SORT.has(q.sort) ? q.sort : 'signed_date';
  const sortDir = q.sort_dir === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(500, Math.max(1, Number(q.limit) || 100));
  const offset = Math.max(0, Number(q.offset) || 0);

  // Build WHERE incrementally — postgres.js needs sql.AND-style composition.
  // We use the parameterized template by passing a fragment per condition.
  const conds: ReturnType<typeof pgSql>[] = [];
  if (carrier !== null) conds.push(pgSql`insurance = ${carrier}`);
  if (zip !== null) conds.push(pgSql`zip = ${zip}`);
  if (city !== null) conds.push(pgSql`city ILIKE ${city}`);
  if (state !== null) conds.push(pgSql`state = ${state}`);
  if (salesRep !== null) conds.push(pgSql`sales_rep ILIKE ${'%' + salesRep + '%'}`);
  if (adjuster !== null) conds.push(pgSql`adjuster_name ILIKE ${'%' + adjuster + '%'}`);
  if (stage !== null) conds.push(pgSql`stage = ${stage}`);
  if (jobType !== null) conds.push(pgSql`job_type = ${jobType}`);
  if (leadSource !== null) conds.push(pgSql`lead_source = ${leadSource}`);
  if (minTotal !== null && Number.isFinite(minTotal)) conds.push(pgSql`job_total >= ${minTotal}`);
  if (maxTotal !== null && Number.isFinite(maxTotal)) conds.push(pgSql`job_total <= ${maxTotal}`);
  if (sinceDate !== null) conds.push(pgSql`signed_date >= ${sinceDate}`);
  if (untilDate !== null) conds.push(pgSql`signed_date <= ${untilDate}`);
  if (paused !== null) conds.push(pgSql`paused = ${paused}`);

  // Compose WHERE — empty conds = no filter (full table scan).
  const where = conds.length === 0
    ? pgSql``
    : conds.reduce((acc, c, i) => i === 0 ? pgSql`WHERE ${c}` : pgSql`${acc} AND ${c}`, pgSql``);

  try {
    // Two queries in parallel: count + page. Same WHERE.
    const [rows, countRow] = await Promise.all([
      pgSql`
        SELECT id, customer, address_line1, city, state, zip, lat, lng,
               insurance, insurance_raw, adjuster_name, adjuster_phone,
               claim_number, claim_type, job_type, stage, status_id,
               sales_rep, rep_id, lead_source, signed_date, completed_date,
               date_of_loss, job_total, acv, deductible, insurance_total, paused
          FROM intel_projects
          ${where}
          ORDER BY ${pgSql(sort)} ${sortDir === 'ASC' ? pgSql`ASC NULLS LAST` : pgSql`DESC NULLS LAST`}
          LIMIT ${limit} OFFSET ${offset}
      `,
      pgSql<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count FROM intel_projects ${where}
      `,
    ]);

    const tookMs = Date.now() - t0;
    res.json({
      rows,
      total: countRow[0]?.count ?? 0,
      took_ms: tookMs,
      query: {
        carrier, zip, city, state, salesRep, adjuster, stage, jobType,
        leadSource, minTotal, maxTotal, sinceDate, untilDate, paused,
        sort, sortDir, limit, offset,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'query_failed', message: msg });
  }
}

/** Aggregate counts by a column — useful for filter UIs ("how many jobs per carrier in zip X"). */
export async function projectsAggregate(req: Request, res: Response) {
  const q = req.query as Record<string, string | undefined>;
  const groupBy = q.group_by ?? 'insurance';
  const ALLOWED_GROUP = new Set(['insurance', 'zip', 'state', 'city', 'stage', 'sales_rep', 'lead_source', 'job_type']);
  if (!ALLOWED_GROUP.has(groupBy)) {
    res.status(400).json({ error: 'invalid_group_by', allowed: [...ALLOWED_GROUP] });
    return;
  }

  // Reuse same filter set as projectsQuery — except group_by column itself isn't filtered.
  const carrier = q.carrier && groupBy !== 'insurance' ? normalizeCarrier(q.carrier) : null;
  const zip = q.zip && groupBy !== 'zip' ? q.zip.trim() : null;
  const state = q.state && groupBy !== 'state' ? q.state.trim().toUpperCase() : null;
  const conds: ReturnType<typeof pgSql>[] = [pgSql`${pgSql(groupBy)} IS NOT NULL`];
  if (carrier) conds.push(pgSql`insurance = ${carrier}`);
  if (zip) conds.push(pgSql`zip = ${zip}`);
  if (state) conds.push(pgSql`state = ${state}`);
  const where = conds.reduce((acc, c, i) => i === 0 ? pgSql`WHERE ${c}` : pgSql`${acc} AND ${c}`, pgSql``);

  try {
    const rows = await pgSql`
      SELECT ${pgSql(groupBy)} AS bucket,
             COUNT(*)::int AS jobs,
             COALESCE(SUM(job_total), 0)::numeric AS total_value
        FROM intel_projects
        ${where}
       GROUP BY ${pgSql(groupBy)}
       ORDER BY jobs DESC
       LIMIT 100
    `;
    res.json({ groupBy, rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'aggregate_failed', message: msg });
  }
}

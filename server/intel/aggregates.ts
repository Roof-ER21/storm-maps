/**
 * Phase 4b page-aggregation endpoints over `intel_projects`.
 *
 * Each handler computes the *page-ready* shape its consumer page expects.
 * SQL does the heavy lifting (counts, sums, joins on JSONB fields); the page
 * becomes a thin presenter. Replaces 36MB blob fetches with kB-scale responses.
 *
 *   GET /api/intel/zip-stats         — for hot-zips + lead-score
 *   GET /api/intel/carriers-summary  — for carrier-detail left pane
 *   GET /api/intel/carrier-deep      — for carrier-detail right pane
 *   GET /api/intel/map-pins          — for roofdocs-map (thin payload)
 *   GET /api/intel/customer-leads    — for lead-score (server-scored)
 *
 * `stage` classification uses the same regex the pages did:
 *   completed: /completed|finalized/i
 *   dead:      /dead|cancel/i
 *
 * All handlers register before the /:key catch-all (see routes.ts).
 */
import { type Request, type Response } from 'express';
import { sql as pgSql } from '../db.js';

/** Convert postgres.js numeric/decimal returns to plain JS numbers. */
const num = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/* ============================================================================
 * /api/intel/zip-stats
 * ----------------------------------------------------------------------------
 *  ZIP-level aggregates with hot-score. Used by hot-zips.html (ranked list)
 *  and lead-score.html (per-zip lookup + customer-score normalization).
 *
 *  Query params:
 *    window  — recent-storm window in days (default 180; 0 = any time)
 *    state   — filter to one state
 *    min_jobs — drop zips with fewer than N signed jobs (default 0)
 *
 *  Response: { zips: [...], total, took_ms, window, computed_at }
 * ========================================================================= */
export async function zipStats(req: Request, res: Response) {
  const t0 = Date.now();
  const q = req.query as Record<string, string | undefined>;
  const window = q.window !== undefined ? Math.max(0, Number(q.window) || 0) : 180;
  const state = q.state?.trim()?.toUpperCase() || null;
  const minJobs = Math.max(0, Number(q.min_jobs) || 0);

  try {
    // One scan over intel_projects. Use FILTER (WHERE …) for sub-counts.
    // City is mode() within group — most common city for the zip.
    // Storm window: `(data->'stormMatch'->>'stormDate')::timestamptz` — JSONB access.
    // window=0 means "any time" — skip the date predicate by comparing against epoch.
    const cutoff = window > 0
      ? new Date(Date.now() - window * 86400_000).toISOString()
      : '1970-01-01T00:00:00Z';

    const rows = await pgSql<Array<{
      zip: string;
      state: string | null;
      city: string | null;
      signed: number;
      completed: number;
      dead: number;
      revenue: number;
      recent_storms: number;
      recent_hail: number;
    }>>`
      SELECT
        LEFT(zip, 5) AS zip,
        MODE() WITHIN GROUP (ORDER BY state) AS state,
        MODE() WITHIN GROUP (ORDER BY city) AS city,
        COUNT(*)::int AS signed,
        COUNT(*) FILTER (WHERE stage ~* 'completed|finalized')::int AS completed,
        COUNT(*) FILTER (WHERE stage ~* 'dead|cancel')::int AS dead,
        COALESCE(SUM(job_total) FILTER (WHERE stage ~* 'completed|finalized'), 0)::numeric AS revenue,
        COUNT(*) FILTER (
          WHERE data->'stormMatch'->>'stormDate' IS NOT NULL
            AND (data->'stormMatch'->>'stormDate')::timestamptz > ${cutoff}::timestamptz
        )::int AS recent_storms,
        COUNT(*) FILTER (
          WHERE data->'stormMatch'->>'stormType' = 'HAIL'
            AND data->'stormMatch'->>'stormDate' IS NOT NULL
            AND (data->'stormMatch'->>'stormDate')::timestamptz > ${cutoff}::timestamptz
        )::int AS recent_hail
        FROM intel_projects
       WHERE zip IS NOT NULL AND LENGTH(zip) >= 5
         ${state ? pgSql`AND state = ${state}` : pgSql``}
       GROUP BY LEFT(zip, 5)
      HAVING COUNT(*) >= ${minJobs}
    `;

    // Score post-process: normalize per result set, same formula as hot-zips.html.
    const zipsRaw = rows.map((r) => ({
      zip: r.zip,
      state: r.state,
      city: r.city,
      signed: num(r.signed),
      completed: num(r.completed),
      dead: num(r.dead),
      revenue: num(r.revenue),
      recentStorms: num(r.recent_storms),
      recentHail: num(r.recent_hail),
      closeRate: 0,
      avgApprovedJob: 0,
      score: 0,
    }));
    for (const z of zipsRaw) {
      z.closeRate = z.signed - z.dead > 0 ? z.completed / (z.signed - z.dead) : 0;
      z.avgApprovedJob = z.completed > 0 ? z.revenue / z.completed : 0;
    }
    const maxStorms = Math.max(1, ...zipsRaw.map((z) => z.recentStorms));
    const maxJobs = Math.max(1, ...zipsRaw.map((z) => z.signed));
    const maxAvg = Math.max(1, ...zipsRaw.map((z) => z.avgApprovedJob));
    for (const z of zipsRaw) {
      const stormN = z.recentStorms / maxStorms;
      const closeN = z.closeRate;
      const avgN = z.avgApprovedJob / maxAvg;
      const densN = z.signed / maxJobs;
      z.score = Math.round(100 * (0.40 * stormN + 0.25 * closeN + 0.20 * avgN + 0.15 * densN));
    }
    zipsRaw.sort((a, b) => b.score - a.score);

    res.json({
      zips: zipsRaw,
      total: zipsRaw.length,
      window,
      state,
      took_ms: Date.now() - t0,
      computed_at: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'zip_stats_failed', message: msg });
  }
}

/* ============================================================================
 * /api/intel/carriers-summary
 * ----------------------------------------------------------------------------
 *  Lightweight per-carrier rollup. Used as the left-pane list in
 *  carrier-detail.html. Sorted by signed-count desc.
 * ========================================================================= */
export async function carriersSummary(_req: Request, res: Response) {
  const t0 = Date.now();
  try {
    const rows = await pgSql<Array<{
      name: string;
      signed: number;
      completed: number;
      dead: number;
      revenue: number;
    }>>`
      SELECT
        insurance AS name,
        COUNT(*)::int AS signed,
        COUNT(*) FILTER (WHERE stage ~* 'completed|finalized')::int AS completed,
        COUNT(*) FILTER (WHERE stage ~* 'dead|cancel')::int AS dead,
        COALESCE(SUM(job_total) FILTER (WHERE stage ~* 'completed|finalized'), 0)::numeric AS revenue
        FROM intel_projects
       WHERE insurance IS NOT NULL AND insurance <> ''
       GROUP BY insurance
       ORDER BY COUNT(*) DESC
    `;
    const carriers = rows.map((c) => {
      const signed = num(c.signed);
      const completed = num(c.completed);
      const dead = num(c.dead);
      const revenue = num(c.revenue);
      return {
        name: c.name,
        signed,
        completed,
        dead,
        revenue,
        closeRate: signed - dead > 0 ? completed / (signed - dead) : 0,
        avgApprovedJob: completed > 0 ? revenue / completed : 0,
      };
    });
    res.json({ carriers, total: carriers.length, took_ms: Date.now() - t0 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'carriers_summary_failed', message: msg });
  }
}

/* ============================================================================
 * /api/intel/carrier-deep?name=Travelers
 * ----------------------------------------------------------------------------
 *  Multi-dimensional aggregates for a single carrier. Replaces the heavy
 *  client-side fan-out in carrier-detail.html.
 *
 *  Returns: { summary, trades, zips, reps, adjusters, years, storms, medians }
 * ========================================================================= */
export async function carrierDeep(req: Request, res: Response) {
  const t0 = Date.now();
  const name = String(req.query.name ?? '').trim();
  if (!name) {
    res.status(400).json({ error: 'missing_name' });
    return;
  }

  try {
    // 7 parallel aggregations on the same indexed predicate.
    const [
      summaryRows,
      tradeRows,
      zipRows,
      repRows,
      adjusterRows,
      yearRows,
      stormRows,
      medianRows,
    ] = await Promise.all([
      pgSql<Array<{ signed: number; completed: number; dead: number; revenue: number }>>`
        SELECT
          COUNT(*)::int AS signed,
          COUNT(*) FILTER (WHERE stage ~* 'completed|finalized')::int AS completed,
          COUNT(*) FILTER (WHERE stage ~* 'dead|cancel')::int AS dead,
          COALESCE(SUM(job_total) FILTER (WHERE stage ~* 'completed|finalized'), 0)::numeric AS revenue
          FROM intel_projects WHERE insurance = ${name}
      `,
      // Trades: unnest JSONB array, count + revenue per trade (revenue shared across trades on a job)
      pgSql<Array<{ trade: string; signed: number; completed: number; revenue: number }>>`
        SELECT
          trade,
          COUNT(*)::int AS signed,
          COUNT(*) FILTER (WHERE stage ~* 'completed|finalized')::int AS completed,
          COALESCE(SUM(
            CASE WHEN stage ~* 'completed|finalized'
                 THEN job_total / NULLIF(jsonb_array_length(data->'trades'), 0)
                 ELSE 0 END
          ), 0)::numeric AS revenue
          FROM intel_projects,
               jsonb_array_elements_text(COALESCE(data->'trades', '[]'::jsonb)) AS trade
         WHERE insurance = ${name}
         GROUP BY trade
         ORDER BY COUNT(*) DESC
         LIMIT 10
      `,
      pgSql<Array<{ zip: string; city: string | null; signed: number; completed: number; revenue: number }>>`
        SELECT
          LEFT(zip, 5) AS zip,
          MODE() WITHIN GROUP (ORDER BY city) AS city,
          COUNT(*)::int AS signed,
          COUNT(*) FILTER (WHERE stage ~* 'completed|finalized')::int AS completed,
          COALESCE(SUM(job_total) FILTER (WHERE stage ~* 'completed|finalized'), 0)::numeric AS revenue
          FROM intel_projects WHERE insurance = ${name} AND zip IS NOT NULL AND LENGTH(zip) >= 5
         GROUP BY LEFT(zip, 5)
         ORDER BY COUNT(*) DESC
         LIMIT 12
      `,
      pgSql<Array<{ rep: string; signed: number; completed: number; revenue: number }>>`
        SELECT
          sales_rep AS rep,
          COUNT(*)::int AS signed,
          COUNT(*) FILTER (WHERE stage ~* 'completed|finalized')::int AS completed,
          COALESCE(SUM(job_total) FILTER (WHERE stage ~* 'completed|finalized'), 0)::numeric AS revenue
          FROM intel_projects WHERE insurance = ${name} AND sales_rep IS NOT NULL AND sales_rep <> ''
         GROUP BY sales_rep
         ORDER BY COUNT(*) FILTER (WHERE stage ~* 'completed|finalized') DESC, COUNT(*) DESC
         LIMIT 10
      `,
      pgSql<Array<{ adjuster: string; signed: number; completed: number; dead: number }>>`
        SELECT
          adjuster_name AS adjuster,
          COUNT(*)::int AS signed,
          COUNT(*) FILTER (WHERE stage ~* 'completed|finalized')::int AS completed,
          COUNT(*) FILTER (WHERE stage ~* 'dead|cancel')::int AS dead
          FROM intel_projects WHERE insurance = ${name} AND adjuster_name IS NOT NULL AND adjuster_name <> ''
         GROUP BY adjuster_name
         ORDER BY COUNT(*) FILTER (WHERE stage ~* 'completed|finalized') DESC, COUNT(*) DESC
         LIMIT 10
      `,
      pgSql<Array<{ year: string; signed: number; completed: number; revenue: number }>>`
        SELECT
          LEFT(signed_date, 4) AS year,
          COUNT(*)::int AS signed,
          COUNT(*) FILTER (WHERE stage ~* 'completed|finalized')::int AS completed,
          COALESCE(SUM(job_total) FILTER (WHERE stage ~* 'completed|finalized'), 0)::numeric AS revenue
          FROM intel_projects WHERE insurance = ${name} AND signed_date IS NOT NULL AND LENGTH(signed_date) >= 4
         GROUP BY LEFT(signed_date, 4)
         ORDER BY LEFT(signed_date, 4) DESC
      `,
      // Storms — grouped by stormMatch.stormId from JSONB
      pgSql<Array<{
        storm_id: string;
        storm_date: string | null;
        storm_type: string | null;
        magnitude: number | null;
        unit: string | null;
        jobs: number;
        revenue: number;
      }>>`
        SELECT
          data->'stormMatch'->>'stormId' AS storm_id,
          MAX(data->'stormMatch'->>'stormDate') AS storm_date,
          MAX(data->'stormMatch'->>'stormType') AS storm_type,
          MAX(NULLIF(data->'stormMatch'->>'stormMagnitude','')::numeric) AS magnitude,
          MAX(data->'stormMatch'->>'stormUnit') AS unit,
          COUNT(*)::int AS jobs,
          COALESCE(SUM(job_total) FILTER (WHERE stage ~* 'completed|finalized'), 0)::numeric AS revenue
          FROM intel_projects
         WHERE insurance = ${name} AND data->'stormMatch'->>'stormId' IS NOT NULL
         GROUP BY data->'stormMatch'->>'stormId'
         ORDER BY COUNT(*) DESC
         LIMIT 8
      `,
      // Medians — deductible (cap noise > $50k) + supplement uplift % from estimates in JSONB
      pgSql<Array<{ med_deductible: number | null; med_uplift: number | null }>>`
        SELECT
          PERCENTILE_CONT(0.5) WITHIN GROUP (
            ORDER BY deductible
          ) FILTER (WHERE deductible > 0 AND deductible <= 50000)::numeric AS med_deductible,
          PERCENTILE_CONT(0.5) WITHIN GROUP (
            ORDER BY (
              (NULLIF(data->>'revisedEstimate','')::numeric - NULLIF(data->>'initialEstimate','')::numeric)
              / NULLIF(NULLIF(data->>'initialEstimate','')::numeric, 0)
            )
          ) FILTER (
            WHERE NULLIF(data->>'initialEstimate','')::numeric > 0
              AND NULLIF(data->>'revisedEstimate','')::numeric IS NOT NULL
          )::numeric AS med_uplift
          FROM intel_projects WHERE insurance = ${name}
      `,
    ]);

    const sum = summaryRows[0] ?? { signed: 0, completed: 0, dead: 0, revenue: 0 };
    const signed = num(sum.signed);
    const completed = num(sum.completed);
    const dead = num(sum.dead);
    const revenue = num(sum.revenue);

    const trades = tradeRows.map((r) => {
      const s = num(r.signed);
      const c = num(r.completed);
      return {
        t: r.trade,
        signed: s,
        completed: c,
        revenue: num(r.revenue),
        closeRate: s > 0 ? c / s : 0,
      };
    });
    const zips = zipRows.map((r) => {
      const s = num(r.signed);
      const c = num(r.completed);
      return {
        z: r.zip,
        city: r.city ?? '',
        signed: s,
        completed: c,
        revenue: num(r.revenue),
        closeRate: s > 0 ? c / s : 0,
      };
    });
    const reps = repRows.map((r) => {
      const s = num(r.signed);
      const c = num(r.completed);
      return {
        n: r.rep,
        signed: s,
        completed: c,
        revenue: num(r.revenue),
        closeRate: s > 0 ? c / s : 0,
      };
    });
    const adjusters = adjusterRows.map((r) => {
      const s = num(r.signed);
      const c = num(r.completed);
      const d = num(r.dead);
      return {
        n: r.adjuster,
        signed: s,
        completed: c,
        dead: d,
        approvalRate: s - d > 0 ? c / (s - d) : 0,
      };
    });
    const years = yearRows.map((r) => {
      const s = num(r.signed);
      const c = num(r.completed);
      return {
        y: r.year,
        signed: s,
        completed: c,
        revenue: num(r.revenue),
        closeRate: s > 0 ? c / s : 0,
      };
    });
    const storms = stormRows.map((r) => ({
      stormId: r.storm_id,
      date: r.storm_date,
      type: r.storm_type,
      mag: r.magnitude != null ? num(r.magnitude) : null,
      unit: r.unit,
      jobs: num(r.jobs),
      revenue: num(r.revenue),
    }));
    const med = medianRows[0] ?? { med_deductible: null, med_uplift: null };

    res.json({
      summary: {
        name,
        signed, completed, dead, revenue,
        closeRate: signed - dead > 0 ? completed / (signed - dead) : 0,
        avgApprovedJob: completed > 0 ? revenue / completed : 0,
      },
      trades, zips, reps, adjusters, years, storms,
      medians: {
        deductible: med.med_deductible != null ? num(med.med_deductible) : null,
        upliftPct: med.med_uplift != null ? num(med.med_uplift) : null,
      },
      took_ms: Date.now() - t0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'carrier_deep_failed', message: msg });
  }
}

/* ============================================================================
 * /api/intel/map-pins
 * ----------------------------------------------------------------------------
 *  Slim payload for the project map. Only the fields the marker + popup use,
 *  plus stormMatch (jsonb) since the popup renders the storm-of-record block.
 *
 *  Filters: same shape as projects-query (carrier, zip, city, state, sales_rep,
 *    adjuster, stage, job_type, lead_source, since_date, until_date).
 *  No pagination — the map wants the full filtered set.
 *  Response: { pins: [...], total, took_ms }
 * ========================================================================= */
export async function mapPins(req: Request, res: Response) {
  const t0 = Date.now();
  const q = req.query as Record<string, string | undefined>;

  // Filters — same shape as projects-query.ts. Inline normalization for carrier.
  const { normalizeCarrier } = await import('./carrier-normalize.mjs');
  const carrier = q.carrier ? normalizeCarrier(q.carrier) : null;
  const zip = q.zip?.trim() || null;
  const city = q.city?.trim() || null;
  const state = q.state?.trim()?.toUpperCase() || null;
  const salesRep = q.sales_rep?.trim() || null;
  const stage = q.stage?.trim() || null;
  const jobType = q.job_type?.trim() || null;
  const sinceDate = q.since_date?.trim() || null;
  const untilDate = q.until_date?.trim() || null;

  const conds: ReturnType<typeof pgSql>[] = [pgSql`lat IS NOT NULL AND lng IS NOT NULL`];
  if (carrier !== null) conds.push(pgSql`insurance = ${carrier}`);
  if (zip !== null) conds.push(pgSql`zip = ${zip}`);
  if (city !== null) conds.push(pgSql`city ILIKE ${city}`);
  if (state !== null) conds.push(pgSql`state = ${state}`);
  if (salesRep !== null) conds.push(pgSql`sales_rep ILIKE ${'%' + salesRep + '%'}`);
  if (stage !== null) conds.push(pgSql`stage = ${stage}`);
  if (jobType !== null) conds.push(pgSql`job_type = ${jobType}`);
  if (sinceDate !== null) conds.push(pgSql`signed_date >= ${sinceDate}`);
  if (untilDate !== null) conds.push(pgSql`signed_date <= ${untilDate}`);
  const where = conds.reduce((acc, c, i) => i === 0 ? pgSql`WHERE ${c}` : pgSql`${acc} AND ${c}`, pgSql``);

  try {
    const rows = await pgSql<Array<{
      id: number;
      customer: string | null;
      address_line1: string | null;
      city: string | null;
      state: string | null;
      zip: string | null;
      lat: number | null;
      lng: number | null;
      insurance: string | null;
      adjuster_name: string | null;
      claim_number: string | null;
      job_type: string | null;
      stage: string | null;
      sales_rep: string | null;
      signed_date: string | null;
      job_total: number | null;
      storm_match: unknown;
    }>>`
      SELECT id, customer, address_line1, city, state, zip, lat, lng,
             insurance, adjuster_name, claim_number, job_type, stage,
             sales_rep, signed_date, job_total,
             data->'stormMatch' AS storm_match
        FROM intel_projects
        ${where}
    `;

    // Match the legacy projects.json camelCase shape the map page expects.
    const pins = rows.map((r) => ({
      id: r.id,
      customer: r.customer,
      addressLine1: r.address_line1,
      city: r.city,
      state: r.state,
      zip: r.zip,
      lat: r.lat,
      lng: r.lng,
      insurance: r.insurance,
      adjusterName: r.adjuster_name,
      claimNumber: r.claim_number,
      jobType: r.job_type,
      stage: r.stage,
      salesRep: r.sales_rep,
      signedDate: r.signed_date,
      jobTotal: r.job_total,
      stormMatch: r.storm_match || null,
    }));
    res.json({ pins, total: pins.length, took_ms: Date.now() - t0 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'map_pins_failed', message: msg });
  }
}

/* ============================================================================
 * /api/intel/customer-leads
 * ----------------------------------------------------------------------------
 *  Customer-level lead scoring. Dedupes by lower(customer || addressLine1),
 *  computes 6-component score using:
 *    storm hits + magnitude        (40%, from intel_blobs[storm-exposure])
 *    personal close rate           (15%)
 *    trade-gap score               (15%, vs UPSELL_GAP catalog)
 *    zip carrier-friendliness      (10%, from zip aggregates)
 *    zip avg job value             (10%)
 *    recency (days since last job) (10%)
 *
 *  Mirrors the buildCustomerScores() formula from lead-score.html — moves
 *  the 16k-job loop server-side.
 *
 *  Query: state (optional), limit (default 1000, max 5000)
 *  Response: { rows, total, took_ms }
 * ========================================================================= */
export async function customerLeads(req: Request, res: Response) {
  const t0 = Date.now();
  const q = req.query as Record<string, string | undefined>;
  const state = q.state?.trim()?.toUpperCase() || null;
  const limit = Math.min(5000, Math.max(1, Number(q.limit) || 1000));

  try {
    // 1) Customer-level aggregates from intel_projects.
    //    Dedup key: lower(customer || '|' || coalesce(address_line1,''))
    type CustRow = {
      key: string;
      customer: string | null;
      address_line1: string | null;
      city: string | null;
      state: string | null;
      zip: string | null;
      lat: number | null;
      lng: number | null;
      email: string | null;
      phone: string | null;
      jobs: number;
      completed_jobs: number;
      dead_jobs: number;
      total_rev: number;
      last_date: string | null;
      trades: string[];
      carriers: string[];
      reps: string[];
    };
    const custRows = await pgSql<CustRow[]>`
      WITH base AS (
        SELECT
          LOWER(COALESCE(customer,'') || '|' || COALESCE(address_line1,'')) AS key,
          customer, address_line1, city, state, zip, lat, lng,
          NULLIF(data->>'customerEmail','') AS email,
          NULLIF(data->>'customerCell','') AS phone,
          insurance, sales_rep,
          stage, job_total,
          COALESCE(NULLIF(completed_date,''), signed_date) AS effective_date,
          data->'trades' AS trades_json
          FROM intel_projects
         WHERE COALESCE(customer,'') <> '' AND COALESCE(address_line1,'') <> ''
           ${state ? pgSql`AND state = ${state}` : pgSql``}
      )
      SELECT
        key,
        (ARRAY_AGG(customer ORDER BY effective_date DESC NULLS LAST))[1] AS customer,
        (ARRAY_AGG(address_line1 ORDER BY effective_date DESC NULLS LAST))[1] AS address_line1,
        (ARRAY_AGG(city ORDER BY effective_date DESC NULLS LAST))[1] AS city,
        (ARRAY_AGG(state ORDER BY effective_date DESC NULLS LAST))[1] AS state,
        (ARRAY_AGG(zip ORDER BY effective_date DESC NULLS LAST))[1] AS zip,
        (ARRAY_AGG(lat ORDER BY effective_date DESC NULLS LAST) FILTER (WHERE lat IS NOT NULL))[1] AS lat,
        (ARRAY_AGG(lng ORDER BY effective_date DESC NULLS LAST) FILTER (WHERE lng IS NOT NULL))[1] AS lng,
        (ARRAY_AGG(email) FILTER (WHERE email IS NOT NULL))[1] AS email,
        (ARRAY_AGG(phone) FILTER (WHERE phone IS NOT NULL))[1] AS phone,
        COUNT(*)::int AS jobs,
        COUNT(*) FILTER (WHERE stage ~* 'completed|finalized')::int AS completed_jobs,
        COUNT(*) FILTER (WHERE stage ~* 'dead|cancel')::int AS dead_jobs,
        COALESCE(SUM(job_total), 0)::numeric AS total_rev,
        MAX(effective_date) AS last_date,
        COALESCE(ARRAY_AGG(DISTINCT trade) FILTER (WHERE trade IS NOT NULL), ARRAY[]::text[]) AS trades,
        COALESCE(ARRAY_AGG(DISTINCT insurance) FILTER (WHERE insurance IS NOT NULL), ARRAY[]::text[]) AS carriers,
        COALESCE(ARRAY_AGG(DISTINCT sales_rep) FILTER (WHERE sales_rep IS NOT NULL), ARRAY[]::text[]) AS reps
        FROM base
        LEFT JOIN LATERAL jsonb_array_elements_text(COALESCE(trades_json, '[]'::jsonb)) AS trade ON TRUE
       GROUP BY key
    `;

    // 2) Zip aggregates (for closeRate + avgApprovedJob normalization).
    //    Same logic as zipStats but no score, no recent-storm windowing.
    const zipRows = await pgSql<Array<{
      zip: string;
      signed: number;
      completed: number;
      dead: number;
      revenue: number;
    }>>`
      SELECT
        LEFT(zip, 5) AS zip,
        COUNT(*)::int AS signed,
        COUNT(*) FILTER (WHERE stage ~* 'completed|finalized')::int AS completed,
        COUNT(*) FILTER (WHERE stage ~* 'dead|cancel')::int AS dead,
        COALESCE(SUM(job_total) FILTER (WHERE stage ~* 'completed|finalized'), 0)::numeric AS revenue
        FROM intel_projects
       WHERE zip IS NOT NULL AND LENGTH(zip) >= 5
       GROUP BY LEFT(zip, 5)
    `;
    const zipStatsMap = new Map<string, { closeRate: number; avgApprovedJob: number }>();
    let maxAvgJob = 1;
    for (const z of zipRows) {
      const s = num(z.signed), c = num(z.completed), d = num(z.dead), rev = num(z.revenue);
      const closeRate = s - d > 0 ? c / (s - d) : 0;
      const avgApprovedJob = c > 0 ? rev / c : 0;
      if (avgApprovedJob > maxAvgJob) maxAvgJob = avgApprovedJob;
      zipStatsMap.set(z.zip, { closeRate, avgApprovedJob });
    }

    // 3) Storm exposure — keyed by lower(customer || '|' || addressLine1).
    //    Lives in intel_blobs as a JSON array; we read once and index in memory.
    type ExposureEntry = {
      customer?: string;
      addressLine1?: string;
      stormCount?: number;
      strongestStorm?: { type?: string; mag?: number };
    };
    let exposureBlob: ExposureEntry[] = [];
    try {
      const rows = await pgSql<Array<{ data: ExposureEntry[] }>>`
        SELECT data FROM intel_blobs WHERE key = 'storm-exposure' LIMIT 1
      `;
      exposureBlob = Array.isArray(rows[0]?.data) ? rows[0].data : [];
    } catch {
      exposureBlob = [];
    }
    const expByKey = new Map<string, ExposureEntry>();
    let maxStormHits = 1;
    for (const c of exposureBlob) {
      const k = ((c.customer || '') + '|' + (c.addressLine1 || '')).toLowerCase();
      expByKey.set(k, c);
      if ((c.stormCount || 0) > maxStormHits) maxStormHits = c.stormCount || 1;
    }

    // 4) Score each customer row.
    const ROOF_TRADES = new Set(['Roofing', 'Metal Roofing', 'Flat Roofing']);
    const UPSELL_GAP = ['Siding', 'Gutters & Downspouts', 'Skylights', 'Trim'];

    const scored = custRows.map((r) => {
      const jobs = num(r.jobs);
      const completed = num(r.completed_jobs);
      const dead = num(r.dead_jobs);
      const personalCloseRate = jobs - dead > 0 ? completed / (jobs - dead) : 0;
      const lastDate = r.last_date;
      const daysSinceLast = lastDate
        ? Math.floor((Date.now() - new Date(lastDate).getTime()) / 86400_000)
        : null;
      const z = r.zip ? r.zip.slice(0, 5) : null;
      const zs = z ? zipStatsMap.get(z) : null;
      const zipCarrierScore = zs ? Math.min(100, zs.closeRate * 100) : 0;
      const zipJobValueScore = zs ? Math.min(100, (zs.avgApprovedJob / maxAvgJob) * 100) : 0;

      const exp = expByKey.get(r.key);
      const stormHits = exp ? (exp.stormCount || 0) : 0;
      const strongest = exp?.strongestStorm;
      const strongestMag = strongest
        ? (strongest.type === 'HAIL' ? (strongest.mag || 0) * 10 : (strongest.mag || 0))
        : 0;
      const stormScore = stormHits > 0
        ? Math.min(100, (stormHits / maxStormHits) * 60 + (strongestMag / 30) * 40)
        : 0;

      const tradesSet = new Set(r.trades);
      const tradeGaps = UPSELL_GAP.filter((t) => !tradesSet.has(t));
      const hasRoofComplete = [...tradesSet].some((t) => ROOF_TRADES.has(t)) && completed > 0;
      const tradeGapScore = hasRoofComplete ? Math.min(100, tradeGaps.length * 25) : 25;

      const personalScore = personalCloseRate * 100;
      const recencyScore = daysSinceLast == null ? 50
        : daysSinceLast > 730 ? 80
        : daysSinceLast > 365 ? 60
        : daysSinceLast > 90 ? 40
        : 20;

      const score = Math.round(
        0.40 * stormScore +
        0.15 * personalScore +
        0.15 * tradeGapScore +
        0.10 * zipCarrierScore +
        0.10 * zipJobValueScore +
        0.10 * recencyScore
      );

      return {
        customer: r.customer,
        address: [r.address_line1, r.city, r.state, r.zip].filter(Boolean).join(', '),
        addressLine1: r.address_line1,
        city: r.city,
        state: r.state,
        zip: r.zip,
        lat: r.lat,
        lng: r.lng,
        email: r.email,
        phone: r.phone,
        jobs,
        completedJobs: completed,
        totalRev: num(r.total_rev),
        trades: r.trades,
        tradeGaps,
        carriers: r.carriers,
        reps: r.reps,
        stormHits,
        strongestStorm: strongest || null,
        lastDate,
        daysSinceLast,
        stormScore,
        personalScore,
        tradeGapScore,
        zipCarrierScore,
        zipJobValueScore,
        recencyScore,
        score,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    const sliced = scored.slice(0, limit);

    res.json({
      rows: sliced,
      total: scored.length,
      returned: sliced.length,
      took_ms: Date.now() - t0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'customer_leads_failed', message: msg });
  }
}

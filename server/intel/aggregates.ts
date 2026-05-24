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
    // Close rate matches the platform-wide formula B (completed/(completed+dead)).
    for (const z of zipsRaw) {
      z.closeRate = z.completed + z.dead > 0 ? z.completed / (z.completed + z.dead) : 0;
      z.avgApprovedJob = z.completed > 0 ? z.revenue / z.completed : 0;
    }
    // Normalize against 90th-percentile (was absolute max). Single extreme
    // zip used to peg the normalizer and drag every other zip's normalized
    // component to near-zero. Cap each component at 1.0.
    function p90(values: number[]): number {
      const sorted = values.slice().sort((a, b) => a - b);
      return Math.max(1, sorted[Math.floor(sorted.length * 0.90)] ?? 1);
    }
    const p90Storms = p90(zipsRaw.map((z) => z.recentStorms));
    const p90Jobs = p90(zipsRaw.map((z) => z.signed));
    const p90Avg = p90(zipsRaw.map((z) => z.avgApprovedJob));
    for (const z of zipsRaw) {
      const stormN = Math.min(1, z.recentStorms / p90Storms);
      const closeN = Math.min(1, z.closeRate);
      const avgN = Math.min(1, z.avgApprovedJob / p90Avg);
      const densN = Math.min(1, z.signed / p90Jobs);
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
      -- Insurance carriers + a synthetic 'Retail / No Carrier' bucket for the
      -- ~40% of jobs with no insurance attached (Retail, Repair, Add-On).
      -- Without this they were silently excluded from carrier views.
      SELECT
        COALESCE(NULLIF(insurance, ''), 'Retail / No Carrier') AS name,
        COUNT(*)::int AS signed,
        COUNT(*) FILTER (WHERE stage ~* 'completed|finalized')::int AS completed,
        COUNT(*) FILTER (WHERE stage ~* 'dead|cancel')::int AS dead,
        COALESCE(SUM(job_total) FILTER (WHERE stage ~* 'completed|finalized'), 0)::numeric AS revenue
        FROM intel_projects
       GROUP BY COALESCE(NULLIF(insurance, ''), 'Retail / No Carrier')
       ORDER BY COUNT(*) DESC
    `;
    // Pull NAIC complaint indices once and attach to each carrier in the
    // summary so the left-pane list shows ratings at-a-glance.
    const { getComplaintIndex } = await import('./naic-complaints.js');
    const carriers = rows.map((c) => {
      const signed = num(c.signed);
      const completed = num(c.completed);
      const dead = num(c.dead);
      const revenue = num(c.revenue);
      const ci = getComplaintIndex(c.name);
      return {
        name: c.name,
        signed,
        completed,
        dead,
        revenue,
        closeRate: completed + dead > 0 ? completed / (completed + dead) : 0,
        avgApprovedJob: completed > 0 ? revenue / completed : 0,
        naicIndex: ci?.index ?? null,
        naicRating: ci?.rating ?? null,
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
  // "Retail / No Carrier" is a synthetic bucket for jobs with NULL insurance
  // (created by carriers-summary so the 40% of book without a carrier doesn't
  // disappear). Translate clicks into a real predicate.
  const isRetailBucket = name === 'Retail / No Carrier';
  const insuranceFilter = isRetailBucket
    ? pgSql`(insurance IS NULL OR insurance = '')`
    : pgSql`insurance = ${name}`;

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
          FROM intel_projects WHERE ${insuranceFilter}
      `,
      // Trades: unnest JSONB array, count + revenue per trade (revenue shared across trades on a job).
      // `dead` is selected so closeRate uses the canonical /(signed-dead) denominator.
      pgSql<Array<{ trade: string; signed: number; completed: number; dead: number; revenue: number }>>`
        SELECT
          trade,
          COUNT(*)::int AS signed,
          COUNT(*) FILTER (WHERE stage ~* 'completed|finalized')::int AS completed,
          COUNT(*) FILTER (WHERE stage ~* 'dead|cancel')::int AS dead,
          COALESCE(SUM(
            CASE WHEN stage ~* 'completed|finalized'
                 THEN job_total / NULLIF(jsonb_array_length(data->'trades'), 0)
                 ELSE 0 END
          ), 0)::numeric AS revenue
          FROM intel_projects,
               jsonb_array_elements_text(COALESCE(data->'trades', '[]'::jsonb)) AS trade
         WHERE ${insuranceFilter}
         GROUP BY trade
         ORDER BY COUNT(*) DESC
         LIMIT 10
      `,
      pgSql<Array<{ zip: string; city: string | null; signed: number; completed: number; dead: number; revenue: number }>>`
        SELECT
          LEFT(zip, 5) AS zip,
          MODE() WITHIN GROUP (ORDER BY city) AS city,
          COUNT(*)::int AS signed,
          COUNT(*) FILTER (WHERE stage ~* 'completed|finalized')::int AS completed,
          COUNT(*) FILTER (WHERE stage ~* 'dead|cancel')::int AS dead,
          COALESCE(SUM(job_total) FILTER (WHERE stage ~* 'completed|finalized'), 0)::numeric AS revenue
          FROM intel_projects WHERE ${insuranceFilter} AND zip IS NOT NULL AND LENGTH(zip) >= 5
         GROUP BY LEFT(zip, 5)
         ORDER BY COUNT(*) DESC
         LIMIT 12
      `,
      pgSql<Array<{ rep: string; signed: number; completed: number; dead: number; revenue: number }>>`
        SELECT
          sales_rep AS rep,
          COUNT(*)::int AS signed,
          COUNT(*) FILTER (WHERE stage ~* 'completed|finalized')::int AS completed,
          COUNT(*) FILTER (WHERE stage ~* 'dead|cancel')::int AS dead,
          COALESCE(SUM(job_total) FILTER (WHERE stage ~* 'completed|finalized'), 0)::numeric AS revenue
          FROM intel_projects WHERE ${insuranceFilter} AND sales_rep IS NOT NULL AND sales_rep <> ''
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
          FROM intel_projects WHERE ${insuranceFilter} AND adjuster_name IS NOT NULL AND adjuster_name <> ''
         GROUP BY adjuster_name
         ORDER BY COUNT(*) FILTER (WHERE stage ~* 'completed|finalized') DESC, COUNT(*) DESC
         LIMIT 10
      `,
      pgSql<Array<{ year: string; signed: number; completed: number; dead: number; revenue: number }>>`
        SELECT
          LEFT(signed_date, 4) AS year,
          COUNT(*)::int AS signed,
          COUNT(*) FILTER (WHERE stage ~* 'completed|finalized')::int AS completed,
          COUNT(*) FILTER (WHERE stage ~* 'dead|cancel')::int AS dead,
          COALESCE(SUM(job_total) FILTER (WHERE stage ~* 'completed|finalized'), 0)::numeric AS revenue
          FROM intel_projects WHERE ${insuranceFilter} AND signed_date IS NOT NULL AND LENGTH(signed_date) >= 4
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
         WHERE ${insuranceFilter} AND data->'stormMatch'->>'stormId' IS NOT NULL
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
          FROM intel_projects WHERE ${insuranceFilter}
      `,
    ]);

    const sum = summaryRows[0] ?? { signed: 0, completed: 0, dead: 0, revenue: 0 };
    const signed = num(sum.signed);
    const completed = num(sum.completed);
    const dead = num(sum.dead);
    const revenue = num(sum.revenue);

    // All sub-aggregate closeRate uses the canonical /(completed+dead).
    // For TRADES: jobs that die before scoping don't have a trades array,
    // so per-trade dead is systematically lower than carrier-overall dead.
    // We expose `share` (this trade's volume vs carrier book) and label
    // the rate "post-scope" so readers see it's a different metric than
    // carrier overall close rate.
    const carrierSigned = num(summaryRows[0]?.signed ?? 0);
    const trades = tradeRows.map((r) => {
      const s = num(r.signed);
      const c = num(r.completed);
      const d = num(r.dead);
      return {
        t: r.trade,
        signed: s,
        completed: c,
        dead: d,
        revenue: num(r.revenue),
        share: carrierSigned > 0 ? s / carrierSigned : 0,
        closeRate: c + d > 0 ? c / (c + d) : 0,
      };
    });
    const zips = zipRows.map((r) => {
      const s = num(r.signed);
      const c = num(r.completed);
      const d = num(r.dead);
      return {
        z: r.zip,
        city: r.city ?? '',
        signed: s,
        completed: c,
        dead: d,
        revenue: num(r.revenue),
        closeRate: c + d > 0 ? c / (c + d) : 0,
      };
    });
    const reps = repRows.map((r) => {
      const s = num(r.signed);
      const c = num(r.completed);
      const d = num(r.dead);
      return {
        n: r.rep,
        signed: s,
        completed: c,
        dead: d,
        revenue: num(r.revenue),
        closeRate: c + d > 0 ? c / (c + d) : 0,
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
        approvalRate: c + d > 0 ? c / (c + d) : 0,
      };
    });
    const years = yearRows.map((r) => {
      const s = num(r.signed);
      const c = num(r.completed);
      const d = num(r.dead);
      return {
        y: r.year,
        signed: s,
        completed: c,
        dead: d,
        revenue: num(r.revenue),
        closeRate: c + d > 0 ? c / (c + d) : 0,
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
        closeRate: completed + dead > 0 ? completed / (completed + dead) : 0,
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
    //    Primary dedup key: 3-part (customer|addressLine1|city) — matches
    //    customers-list, customer-deep, dashboard-kpis. `exposure_key` is
    //    the legacy 2-part variant used solely to join storm-exposure blob.
    type CustRow = {
      key: string;
      exposure_key: string;
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
    // Two-CTE pattern (see customersList comment): trades LATERAL would inflate
    // jobs/completed/dead/total_rev by the per-job trade-count multiplier.
    // 3-part dedup key (customer|addressLine1|city) matches customers-list,
    // customer-deep, dashboard-kpis, and the shared riq-links.js custKey().
    // The legacy 2-part key (customer|addressLine1) is kept ALONGSIDE for
    // joining with the storm-exposure blob which still uses 2-part keys.
    const custRows = await pgSql<CustRow[]>`
      WITH base AS (
        SELECT
          LOWER(TRIM(COALESCE(customer,'')) || '|' || TRIM(COALESCE(address_line1,'')) || '|' || TRIM(COALESCE(city,''))) AS key,
          LOWER(COALESCE(customer,'') || '|' || COALESCE(address_line1,'')) AS exposure_key,
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
      ),
      agg AS (
        SELECT
          key,
          (ARRAY_AGG(exposure_key))[1] AS exposure_key,
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
          COALESCE(ARRAY_AGG(DISTINCT insurance) FILTER (WHERE insurance IS NOT NULL), ARRAY[]::text[]) AS carriers,
          COALESCE(ARRAY_AGG(DISTINCT sales_rep) FILTER (WHERE sales_rep IS NOT NULL), ARRAY[]::text[]) AS reps
          FROM base
         GROUP BY key
      ),
      trades_agg AS (
        SELECT key, ARRAY_AGG(DISTINCT trade) AS trades
          FROM base, jsonb_array_elements_text(COALESCE(trades_json, '[]'::jsonb)) AS trade
         WHERE trade IS NOT NULL
         GROUP BY key
      )
      SELECT
        a.key, a.exposure_key, a.customer, a.address_line1, a.city, a.state, a.zip,
        a.lat, a.lng, a.email, a.phone,
        a.jobs, a.completed_jobs, a.dead_jobs, a.total_rev, a.last_date,
        a.carriers, a.reps,
        COALESCE(t.trades, ARRAY[]::text[]) AS trades
        FROM agg a
        LEFT JOIN trades_agg t USING (key)
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
      const c = num(z.completed), d = num(z.dead), rev = num(z.revenue);
      const closeRate = c + d > 0 ? c / (c + d) : 0;
      const avgApprovedJob = c > 0 ? rev / c : 0;
      if (avgApprovedJob > maxAvgJob) maxAvgJob = avgApprovedJob;
      zipStatsMap.set(z.zip, { closeRate, avgApprovedJob });
    }

    // 3) Storm exposure — Phase 4c indexed table; fall back to blob.
    type ExposureEntry = {
      customer?: string;
      addressLine1?: string;
      stormCount?: number;
      strongestStorm?: { type?: string; mag?: number };
    };
    const expByKey = new Map<string, ExposureEntry>();
    let maxStormHits = 1;
    try {
      const tableRows = await pgSql<Array<{
        key: string; storm_count: number;
        strongest_storm_type: string | null; strongest_storm_mag: number | null;
      }>>`
        SELECT key, storm_count, strongest_storm_type, strongest_storm_mag
          FROM intel_customer_exposure
      `;
      for (const r of tableRows) {
        expByKey.set(r.key, {
          stormCount: r.storm_count,
          strongestStorm: r.strongest_storm_type != null ? {
            type: r.strongest_storm_type ?? undefined,
            mag: r.strongest_storm_mag ?? undefined,
          } : undefined,
        });
        if ((r.storm_count || 0) > maxStormHits) maxStormHits = r.storm_count || 1;
      }
    } catch {
      // Fallback: read blob if table missing.
      try {
        const rows = await pgSql<Array<{ data: ExposureEntry[] }>>`
          SELECT data FROM intel_blobs WHERE key = 'storm-exposure' LIMIT 1
        `;
        const blob = Array.isArray(rows[0]?.data) ? rows[0].data : [];
        for (const c of blob) {
          const k = ((c.customer || '') + '|' + (c.addressLine1 || '')).toLowerCase();
          expByKey.set(k, c);
          if ((c.stormCount || 0) > maxStormHits) maxStormHits = c.stormCount || 1;
        }
      } catch { /* keep empty map */ }
    }

    // 4) Score each customer row.
    // Match the client-side ROOF_TRADES on customers/upgrade-campaigns/solar
    // pages — Cedar Shake + Slate were missing here, excluding those roof
    // customers from hasRoofComplete classification.
    const ROOF_TRADES = new Set(['Roofing', 'Metal Roofing', 'Flat Roofing', 'Cedar Shake Roofing', 'Slate Roofing']);
    const UPSELL_GAP = ['Siding', 'Gutters & Downspouts', 'Skylights', 'Trim'];

    const scored = custRows.map((r) => {
      const jobs = num(r.jobs);
      const completed = num(r.completed_jobs);
      const dead = num(r.dead_jobs);
      const personalCloseRate = completed + dead > 0 ? completed / (completed + dead) : 0;
      const lastDate = r.last_date;
      const daysSinceLast = lastDate
        ? Math.floor((Date.now() - new Date(lastDate).getTime()) / 86400_000)
        : null;
      const z = r.zip ? r.zip.slice(0, 5) : null;
      const zs = z ? zipStatsMap.get(z) : null;
      const zipCarrierScore = zs ? Math.min(100, zs.closeRate * 100) : 0;
      const zipJobValueScore = zs ? Math.min(100, (zs.avgApprovedJob / maxAvgJob) * 100) : 0;

      const exp = expByKey.get(r.exposure_key);  // 2-part exposure-blob key
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

/* ============================================================================
 * /api/intel/adjusters-summary
 * ----------------------------------------------------------------------------
 *  Per-(adjuster, carrier) rollup with contact aggregates. Used by
 *  adjusters.html (directory + filter). Returns one row per adjuster×carrier
 *  combo — same adjuster name working two carriers is two rows.
 * ========================================================================= */
export async function adjustersSummary(_req: Request, res: Response) {
  const t0 = Date.now();
  try {
    const rows = await pgSql<Array<{
      name: string;
      carrier: string;
      emails: string[];
      phones: string[];
      cities: string[];
      reps: string[];
      signed: number;
      completed: number;
      dead: number;
      revenue: number;
      completed_revenue: number;
      avg_deductible: number | null;
    }>>`
      SELECT
        TRIM(adjuster_name) AS name,
        COALESCE(insurance, 'Unknown') AS carrier,
        -- adjuster_email column gets poisoned with phone numbers + free text
        -- (1,006 of 3,607 rows have non-email content). Filter for an @ sign
        -- so the page doesn't render mailto: links that won't work.
        COALESCE(ARRAY_AGG(DISTINCT adjuster_email) FILTER (WHERE adjuster_email IS NOT NULL AND adjuster_email LIKE '%@%'), ARRAY[]::text[]) AS emails,
        COALESCE(ARRAY_AGG(DISTINCT adjuster_phone) FILTER (WHERE adjuster_phone IS NOT NULL AND adjuster_phone <> ''), ARRAY[]::text[]) AS phones,
        COALESCE(ARRAY_AGG(DISTINCT city) FILTER (WHERE city IS NOT NULL AND city <> ''), ARRAY[]::text[]) AS cities,
        COALESCE(ARRAY_AGG(DISTINCT sales_rep) FILTER (WHERE sales_rep IS NOT NULL AND sales_rep <> ''), ARRAY[]::text[]) AS reps,
        COUNT(*)::int AS signed,
        COUNT(*) FILTER (WHERE stage ~* 'completed|finalized')::int AS completed,
        COUNT(*) FILTER (WHERE stage ~* 'dead|cancel')::int AS dead,
        COALESCE(SUM(job_total), 0)::numeric AS revenue,
        COALESCE(SUM(job_total) FILTER (WHERE stage ~* 'completed|finalized'), 0)::numeric AS completed_revenue,
        AVG(deductible) FILTER (WHERE deductible > 0 AND deductible <= 50000)::numeric AS avg_deductible
        FROM intel_projects
       WHERE adjuster_name IS NOT NULL AND TRIM(adjuster_name) <> ''
       GROUP BY TRIM(adjuster_name), COALESCE(insurance, 'Unknown')
    `;

    const adjusters = rows.map((r) => {
      const signed = num(r.signed);
      const completed = num(r.completed);
      const dead = num(r.dead);
      const completedRev = num(r.completed_revenue);
      return {
        name: r.name,
        carrier: r.carrier,
        emails: r.emails.join(', '),
        phones: r.phones.join(', '),
        cities: r.cities,
        reps: r.reps,
        signed,
        completed,
        dead,
        revenue: num(r.revenue),
        completedRevenue: completedRev,
        approvalRate: completed + dead > 0 ? completed / (completed + dead) : 0,
        avgApprovedJob: completed > 0 ? completedRev / completed : null,
        avgDeductible: r.avg_deductible != null ? num(r.avg_deductible) : null,
      };
    });
    res.json({ adjusters, total: adjusters.length, took_ms: Date.now() - t0 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'adjusters_summary_failed', message: msg });
  }
}

/* ============================================================================
 * /api/intel/adjuster-deep?name=X[&carrier=Y]
 * ----------------------------------------------------------------------------
 *  Per-adjuster deep dive (zips, reps, trades, years, deductible median,
 *  recent jobs). Used by adjuster-detail.html right pane.
 *  If `carrier` is provided, restricts to that adjuster×carrier combo.
 * ========================================================================= */
export async function adjusterDeep(req: Request, res: Response) {
  const t0 = Date.now();
  const name = String(req.query.name ?? '').trim();
  const carrier = String(req.query.carrier ?? '').trim() || null;
  if (!name) {
    res.status(400).json({ error: 'missing_name' });
    return;
  }
  const nameCond = pgSql`TRIM(adjuster_name) = ${name}`;
  const filter = carrier
    ? pgSql`${nameCond} AND COALESCE(insurance, 'Unknown') = ${carrier}`
    : nameCond;

  try {
    const [
      contactRows,
      summaryRows,
      zipRows,
      repRows,
      tradeRows,
      yearRows,
      medianRows,
      recentRows,
    ] = await Promise.all([
      pgSql<Array<{ emails: string[]; phones: string[]; supervisors: string[] }>>`
        SELECT
          COALESCE(ARRAY_AGG(DISTINCT adjuster_email) FILTER (WHERE adjuster_email IS NOT NULL AND adjuster_email LIKE '%@%'), ARRAY[]::text[]) AS emails,
          COALESCE(ARRAY_AGG(DISTINCT adjuster_phone) FILTER (WHERE adjuster_phone IS NOT NULL AND adjuster_phone <> ''), ARRAY[]::text[]) AS phones,
          COALESCE(ARRAY_AGG(DISTINCT data->>'supervisorName') FILTER (WHERE data->>'supervisorName' IS NOT NULL AND data->>'supervisorName' <> ''), ARRAY[]::text[]) AS supervisors
          FROM intel_projects WHERE ${filter}
      `,
      pgSql<Array<{ signed: number; completed: number; dead: number; revenue: number }>>`
        SELECT
          COUNT(*)::int AS signed,
          COUNT(*) FILTER (WHERE stage ~* 'completed|finalized')::int AS completed,
          COUNT(*) FILTER (WHERE stage ~* 'dead|cancel')::int AS dead,
          COALESCE(SUM(job_total), 0)::numeric AS revenue
          FROM intel_projects WHERE ${filter}
      `,
      pgSql<Array<{ zip: string; signed: number; completed: number }>>`
        SELECT
          LEFT(zip, 5) AS zip,
          COUNT(*)::int AS signed,
          COUNT(*) FILTER (WHERE stage ~* 'completed|finalized')::int AS completed
          FROM intel_projects WHERE ${filter} AND zip IS NOT NULL AND LENGTH(zip) >= 5
         GROUP BY LEFT(zip, 5)
         ORDER BY COUNT(*) DESC
         LIMIT 10
      `,
      pgSql<Array<{ rep: string; count: number }>>`
        SELECT sales_rep AS rep, COUNT(*)::int AS count
          FROM intel_projects WHERE ${filter} AND sales_rep IS NOT NULL AND sales_rep <> ''
         GROUP BY sales_rep ORDER BY COUNT(*) DESC LIMIT 8
      `,
      pgSql<Array<{ trade: string; count: number }>>`
        SELECT trade, COUNT(*)::int AS count
          FROM intel_projects,
               jsonb_array_elements_text(COALESCE(data->'trades', '[]'::jsonb)) AS trade
         WHERE ${filter}
         GROUP BY trade ORDER BY COUNT(*) DESC LIMIT 8
      `,
      pgSql<Array<{ year: string; signed: number; completed: number }>>`
        SELECT LEFT(signed_date, 4) AS year,
               COUNT(*)::int AS signed,
               COUNT(*) FILTER (WHERE stage ~* 'completed|finalized')::int AS completed
          FROM intel_projects WHERE ${filter} AND signed_date IS NOT NULL AND LENGTH(signed_date) >= 4
         GROUP BY LEFT(signed_date, 4) ORDER BY LEFT(signed_date, 4) DESC
      `,
      pgSql<Array<{ med_deductible: number | null }>>`
        SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY deductible)
                 FILTER (WHERE deductible > 0 AND deductible <= 50000)::numeric AS med_deductible
          FROM intel_projects WHERE ${filter}
      `,
      pgSql<Array<{
        signed_date: string | null;
        customer: string | null;
        address_line1: string | null;
        city: string | null;
        stage: string | null;
        job_total: number | null;
      }>>`
        SELECT signed_date, customer, address_line1, city, stage, job_total
          FROM intel_projects WHERE ${filter}
         ORDER BY signed_date DESC NULLS LAST
         LIMIT 20
      `,
    ]);

    const contact = contactRows[0] ?? { emails: [], phones: [], supervisors: [] };
    const sum = summaryRows[0] ?? { signed: 0, completed: 0, dead: 0, revenue: 0 };
    const signed = num(sum.signed);
    const completed = num(sum.completed);
    const dead = num(sum.dead);
    const med = medianRows[0] ?? { med_deductible: null };

    res.json({
      summary: {
        name,
        carrier: carrier || null,
        signed, completed, dead,
        revenue: num(sum.revenue),
        approvalRate: completed + dead > 0 ? completed / (completed + dead) : 0,
        medianDeductible: med.med_deductible != null ? num(med.med_deductible) : null,
      },
      emails: contact.emails,
      phones: contact.phones,
      supervisors: contact.supervisors,
      zips: zipRows.map((r) => ({ zip: r.zip, signed: num(r.signed), completed: num(r.completed) })),
      reps: repRows.map((r) => ({ rep: r.rep, count: num(r.count) })),
      trades: tradeRows.map((r) => ({ trade: r.trade, count: num(r.count) })),
      years: yearRows.map((r) => ({ year: r.year, signed: num(r.signed), completed: num(r.completed) })),
      recent: recentRows.map((r) => ({
        signedDate: r.signed_date,
        customer: r.customer,
        addressLine1: r.address_line1,
        city: r.city,
        stage: r.stage,
        jobTotal: r.job_total != null ? num(r.job_total) : null,
      })),
      took_ms: Date.now() - t0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'adjuster_deep_failed', message: msg });
  }
}

/* ============================================================================
 * /api/intel/reps-summary
 * ----------------------------------------------------------------------------
 *  Per-rep rollup with Field-Portal-matching insurance/retail splits. Used
 *  by reps.html left pane.
 * ========================================================================= */
export async function repsSummary(_req: Request, res: Response) {
  const t0 = Date.now();
  try {
    // INS_TYPES = ('Insurance','Insurance Conversion','Public Adjuster') —
    // matches build-cheat-sheets.mjs's `INS_TYPES` set so the rep-level
    // INS-only counts here line up with what cheat-sheet pulls for the same
    // rep. The pre-existing `insSignedCount` / `insSalesTotal` columns stay
    // narrower (Insurance + Insurance Conversion) for backwards-compat with
    // consumers that key off them; the new `insSignedFullCount` /
    // approval-rate fields use the full INS_TYPES bucket.
    //
    // `closeRate` uses the canonical platform formula B —
    // completed / (completed + dead) — standardized in b6930c9 to match
    // Field Portal's "Approval Rate" so reps see the same number across RIQ
    // and their portal dashboard. `insApprovalRate` uses the same formula B
    // shape but over INS_TYPES only — that's the rep-level INS approval
    // metric Varun asked for, and it makes #2 (rank-by-approval) sortable
    // on reps.html via the existing riq-sort.js.
    const rows = await pgSql<Array<{
      name: string;
      signed: number;
      completed: number;
      dead: number;
      open: number;
      revenue: number;
      completed_revenue: number;
      ins_sales_total: number;
      retail_sales_total: number;
      ins_signed_count: number;
      retail_signed_count: number;
      ins_signed_full_count: number;
      ins_completed_count: number;
      ins_dead_count: number;
      signed_30d: number;
      completed_30d: number;
      dead_30d: number;
      revenue_30d: number;
      signed_200d: number;
      completed_200d: number;
      dead_200d: number;
      revenue_200d: number;
    }>>`
      SELECT
        TRIM(sales_rep) AS name,
        COUNT(*)::int AS signed,
        COUNT(*) FILTER (WHERE stage ~* 'completed|finalized')::int AS completed,
        COUNT(*) FILTER (WHERE stage ~* 'dead|cancel')::int AS dead,
        COUNT(*) FILTER (WHERE NOT (stage ~* 'completed|finalized|dead|cancel'))::int AS open,
        COALESCE(SUM(job_total), 0)::numeric AS revenue,
        COALESCE(SUM(job_total) FILTER (WHERE stage ~* 'completed|finalized'), 0)::numeric AS completed_revenue,
        COALESCE(SUM(insurance_total) FILTER (WHERE signed_date IS NOT NULL AND job_type IN ('Insurance','Insurance Conversion')), 0)::numeric AS ins_sales_total,
        COALESCE(SUM(job_total) FILTER (WHERE signed_date IS NOT NULL AND job_type = 'Retail'), 0)::numeric AS retail_sales_total,
        COUNT(*) FILTER (WHERE signed_date IS NOT NULL AND job_type IN ('Insurance','Insurance Conversion'))::int AS ins_signed_count,
        COUNT(*) FILTER (WHERE signed_date IS NOT NULL AND job_type = 'Retail')::int AS retail_signed_count,
        COUNT(*) FILTER (WHERE signed_date IS NOT NULL AND job_type IN ('Insurance','Insurance Conversion','Public Adjuster'))::int AS ins_signed_full_count,
        COUNT(*) FILTER (WHERE signed_date IS NOT NULL AND job_type IN ('Insurance','Insurance Conversion','Public Adjuster') AND stage ~* 'completed|finalized')::int AS ins_completed_count,
        COUNT(*) FILTER (WHERE signed_date IS NOT NULL AND job_type IN ('Insurance','Insurance Conversion','Public Adjuster') AND stage ~* 'dead|cancel')::int AS ins_dead_count,
        -- Varun #3: 30d trailing — jobs SIGNED in last 30 days + current close state.
        -- Most 30d-signed jobs are still open; "rate" here is "fast closers" not full conversion.
        COUNT(*) FILTER (WHERE signed_date IS NOT NULL AND signed_date::date >= (NOW() - INTERVAL '30 days')::date)::int AS signed_30d,
        COUNT(*) FILTER (WHERE signed_date IS NOT NULL AND signed_date::date >= (NOW() - INTERVAL '30 days')::date AND stage ~* 'completed|finalized')::int AS completed_30d,
        COUNT(*) FILTER (WHERE signed_date IS NOT NULL AND signed_date::date >= (NOW() - INTERVAL '30 days')::date AND stage ~* 'dead|cancel')::int AS dead_30d,
        COALESCE(SUM(job_total) FILTER (WHERE signed_date IS NOT NULL AND signed_date::date >= (NOW() - INTERVAL '30 days')::date AND stage ~* 'completed|finalized'), 0)::numeric AS revenue_30d,
        -- 200d trailing: long enough that most jobs have closed → stable approval rate.
        COUNT(*) FILTER (WHERE signed_date IS NOT NULL AND signed_date::date >= (NOW() - INTERVAL '200 days')::date)::int AS signed_200d,
        COUNT(*) FILTER (WHERE signed_date IS NOT NULL AND signed_date::date >= (NOW() - INTERVAL '200 days')::date AND stage ~* 'completed|finalized')::int AS completed_200d,
        COUNT(*) FILTER (WHERE signed_date IS NOT NULL AND signed_date::date >= (NOW() - INTERVAL '200 days')::date AND stage ~* 'dead|cancel')::int AS dead_200d,
        COALESCE(SUM(job_total) FILTER (WHERE signed_date IS NOT NULL AND signed_date::date >= (NOW() - INTERVAL '200 days')::date AND stage ~* 'completed|finalized'), 0)::numeric AS revenue_200d
        FROM intel_projects
       WHERE sales_rep IS NOT NULL AND TRIM(sales_rep) <> ''
       GROUP BY TRIM(sales_rep)
    `;

    const reps = rows.map((r) => {
      const signed = num(r.signed);
      const completed = num(r.completed);
      const dead = num(r.dead);
      const completedRev = num(r.completed_revenue);
      const insSales = num(r.ins_sales_total);
      const retailSales = num(r.retail_sales_total);
      const insSignedFull = num(r.ins_signed_full_count);
      const insCompleted = num(r.ins_completed_count);
      const insDead = num(r.ins_dead_count);
      return {
        name: r.name,
        signed,
        completed,
        dead,
        open: num(r.open),
        revenue: num(r.revenue),
        completedRevenue: completedRev,
        insSalesTotal: insSales,
        retailSalesTotal: retailSales,
        insSignedCount: num(r.ins_signed_count),
        retailSignedCount: num(r.retail_signed_count),
        insSignedFullCount: insSignedFull,
        insCompletedCount: insCompleted,
        insDeadCount: insDead,
        totalSalesAllTime: insSales + retailSales,
        // All-jobs close rate using canonical formula B (b6930c9).
        closeRate: completed + dead > 0 ? completed / (completed + dead) : 0,
        // INS-only approval rate using canonical formula B over INS_TYPES.
        // This is the rep-level "Insurance Approval Rate" that Varun asked
        // for and that #2 (rank reps by approval rate) sorts by on reps.html.
        insApprovalRate: insCompleted + insDead > 0 ? insCompleted / (insCompleted + insDead) : 0,
        avgApprovedJob: completed > 0 ? completedRev / completed : null,
        // Trailing-window stats (Varun #3) — counts + revenue from signed_date filter.
        // closeRate uses canonical formula B over the window.
        trailing30d: {
          signed: num(r.signed_30d),
          completed: num(r.completed_30d),
          dead: num(r.dead_30d),
          revenue: num(r.revenue_30d),
          closeRate: num(r.completed_30d) + num(r.dead_30d) > 0
            ? num(r.completed_30d) / (num(r.completed_30d) + num(r.dead_30d))
            : null,
        },
        trailing200d: {
          signed: num(r.signed_200d),
          completed: num(r.completed_200d),
          dead: num(r.dead_200d),
          revenue: num(r.revenue_200d),
          closeRate: num(r.completed_200d) + num(r.dead_200d) > 0
            ? num(r.completed_200d) / (num(r.completed_200d) + num(r.dead_200d))
            : null,
        },
      };
    });
    reps.sort((a, b) => b.totalSalesAllTime - a.totalSalesAllTime);
    res.json({ reps, total: reps.length, took_ms: Date.now() - t0 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'reps_summary_failed', message: msg });
  }
}

/* ============================================================================
 * /api/intel/rep-deep?name=X
 * ----------------------------------------------------------------------------
 *  Per-rep deep dive (trades / carriers / cities / zips top counts,
 *  median speed days, 10 biggest jobs). Used by reps.html right pane.
 * ========================================================================= */
export async function repDeep(req: Request, res: Response) {
  const t0 = Date.now();
  const name = String(req.query.name ?? '').trim();
  if (!name) {
    res.status(400).json({ error: 'missing_name' });
    return;
  }

  try {
    const [
      tradeRows,
      carrierRows,
      cityRows,
      zipRows,
      medianRows,
      bigJobs,
    ] = await Promise.all([
      pgSql<Array<{ trade: string; count: number }>>`
        SELECT trade, COUNT(*)::int AS count
          FROM intel_projects,
               jsonb_array_elements_text(COALESCE(data->'trades', '[]'::jsonb)) AS trade
         WHERE TRIM(sales_rep) = ${name}
         GROUP BY trade ORDER BY COUNT(*) DESC LIMIT 12
      `,
      pgSql<Array<{ carrier: string; count: number }>>`
        SELECT insurance AS carrier, COUNT(*)::int AS count
          FROM intel_projects WHERE TRIM(sales_rep) = ${name} AND insurance IS NOT NULL
         GROUP BY insurance ORDER BY COUNT(*) DESC LIMIT 12
      `,
      pgSql<Array<{ city: string; count: number }>>`
        SELECT city, COUNT(*)::int AS count
          FROM intel_projects WHERE TRIM(sales_rep) = ${name} AND city IS NOT NULL
         GROUP BY city ORDER BY COUNT(*) DESC LIMIT 12
      `,
      pgSql<Array<{ zip: string; count: number }>>`
        SELECT zip, COUNT(*)::int AS count
          FROM intel_projects WHERE TRIM(sales_rep) = ${name} AND zip IS NOT NULL
         GROUP BY zip ORDER BY COUNT(*) DESC LIMIT 12
      `,
      pgSql<Array<{ med_speed: number | null; med_complete: number | null }>>`
        SELECT
          PERCENTILE_CONT(0.5) WITHIN GROUP (
            ORDER BY NULLIF(data->>'daysLossToSign','')::int
          ) FILTER (
            WHERE NULLIF(data->>'daysLossToSign','')::int BETWEEN 0 AND 364
          )::numeric AS med_speed,
          PERCENTILE_CONT(0.5) WITHIN GROUP (
            ORDER BY NULLIF(data->>'daysToComplete','')::int
          ) FILTER (
            WHERE NULLIF(data->>'daysToComplete','')::int BETWEEN 0 AND 729
          )::numeric AS med_complete
          FROM intel_projects WHERE TRIM(sales_rep) = ${name}
      `,
      pgSql<Array<{
        customer: string | null; address_line1: string | null; city: string | null;
        state: string | null; insurance: string | null; stage: string | null;
        signed_date: string | null; job_total: number | null;
      }>>`
        SELECT customer, address_line1, city, state, insurance, stage, signed_date, job_total
          FROM intel_projects WHERE TRIM(sales_rep) = ${name} AND job_total > 0
         ORDER BY job_total DESC NULLS LAST LIMIT 10
      `,
    ]);

    const med = medianRows[0] ?? { med_speed: null, med_complete: null };

    res.json({
      trades: tradeRows.map((r) => ({ name: r.trade, count: num(r.count) })),
      carriers: carrierRows.map((r) => ({ name: r.carrier, count: num(r.count) })),
      cities: cityRows.map((r) => ({ name: r.city, count: num(r.count) })),
      zips: zipRows.map((r) => ({ name: r.zip, count: num(r.count) })),
      medianSpeedDays: med.med_speed != null ? Math.round(num(med.med_speed)) : null,
      medianCompleteDays: med.med_complete != null ? Math.round(num(med.med_complete)) : null,
      bigJobs: bigJobs.map((j) => ({
        customer: j.customer,
        addressLine1: j.address_line1,
        city: j.city,
        state: j.state,
        insurance: j.insurance,
        stage: j.stage,
        signedDate: j.signed_date,
        jobTotal: j.job_total != null ? num(j.job_total) : null,
      })),
      took_ms: Date.now() - t0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'rep_deep_failed', message: msg });
  }
}

/* ============================================================================
 * /api/intel/carrier-trade-matrix
 * ----------------------------------------------------------------------------
 *  Avg revenue per (carrier, trade) cell — top 18 carriers × top 10 trades.
 *  Splits revenue evenly across trades on each completed job. Used by
 *  carrier-trades.html (heat-map matrix).
 * ========================================================================= */
export async function carrierTradeMatrix(_req: Request, res: Response) {
  const t0 = Date.now();
  try {
    // One scan: completed jobs only, expand trades array, share revenue evenly.
    const rows = await pgSql<Array<{
      carrier: string;
      trade: string;
      jobs: number;
      revenue: number;
    }>>`
      SELECT
        insurance AS carrier,
        trade,
        COUNT(*)::int AS jobs,
        COALESCE(SUM(job_total / NULLIF(jsonb_array_length(data->'trades'), 0)), 0)::numeric AS revenue
        FROM intel_projects,
             jsonb_array_elements_text(COALESCE(data->'trades', '[]'::jsonb)) AS trade
       WHERE stage ~* 'completed|finalized'
         AND insurance IS NOT NULL
         AND job_total IS NOT NULL AND job_total > 0
       GROUP BY insurance, trade
    `;

    // Tally carrier + trade totals to pick top 18 / top 10.
    const carrierTotal = new Map<string, number>();
    const tradeTotal = new Map<string, number>();
    const cellMap = new Map<string, { jobs: number; revenue: number }>();
    for (const r of rows) {
      const jobs = num(r.jobs);
      const rev = num(r.revenue);
      cellMap.set(`${r.carrier}|${r.trade}`, { jobs, revenue: rev });
      carrierTotal.set(r.carrier, (carrierTotal.get(r.carrier) || 0) + jobs);
      tradeTotal.set(r.trade, (tradeTotal.get(r.trade) || 0) + jobs);
    }
    const topCarriers = [...carrierTotal.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).map((p) => p[0]);
    const topTrades = [...tradeTotal.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map((p) => p[0]);

    // Compute cells (jobs >= 2 to avoid noise) and tercile thresholds.
    const cells: Record<string, { avg: number; jobs: number }> = {};
    const allValues: number[] = [];
    for (const c of topCarriers) {
      for (const t of topTrades) {
        const x = cellMap.get(`${c}|${t}`);
        if (!x || x.jobs < 2) continue;
        const avg = x.revenue / x.jobs;
        cells[`${c}|${t}`] = { avg, jobs: x.jobs };
        allValues.push(avg);
      }
    }
    allValues.sort((a, b) => a - b);
    const t1 = allValues[Math.floor(allValues.length / 3)] ?? 0;
    const t2 = allValues[Math.floor((allValues.length * 2) / 3)] ?? 0;

    res.json({
      topCarriers,
      topTrades,
      carrierTotals: Object.fromEntries(carrierTotal),
      tradeTotals: Object.fromEntries(tradeTotal),
      cells,
      terciles: { t1, t2 },
      took_ms: Date.now() - t0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'carrier_trade_matrix_failed', message: msg });
  }
}

/* ============================================================================
 * /api/intel/customers-list
 * ----------------------------------------------------------------------------
 *  Full customer list with lifetime aggregates. Used by customers.html.
 *  Dedup key: lower(trim(customer) || '|' || trim(addressLine1) || '|' || trim(city))
 *  — wider than customer-leads' name+address-only key, matches customers.html.
 *  Server-side filter on state and minJobs/minRev to avoid shipping all 12k.
 * ========================================================================= */
export async function customersList(req: Request, res: Response) {
  const t0 = Date.now();
  const q = req.query as Record<string, string | undefined>;
  const state = q.state?.trim()?.toUpperCase() || null;

  try {
    // ROOF_TRADES literal is matched in SQL via ARRAY_AGG so the page can
    // filter on hasCompletedRoof / lastCompletedRoofDate / maxDeductible
    // without having to scan all jobs.
    // Two-CTE pattern: aggregate counts/sums from one-row-per-job, then JOIN a
    // separately-aggregated trades array. Doing the trades LATERAL inside the
    // main aggregation inflates COUNT/SUM by the trade-count multiplier.
    const rows = await pgSql<Array<{
      name: string;
      address_line1: string | null;
      city: string | null;
      state: string | null;
      zip: string | null;
      lat: number | null;
      lng: number | null;
      jobs: number;
      completed: number;
      dead: number;
      open: number;
      total_rev: number;
      completed_rev: number;
      first_date: string | null;
      last_date: string | null;
      trades: string[];
      carriers: string[];
      reps: string[];
      has_completed_roof: boolean;
      last_completed_roof_date: string | null;
      max_deductible: number | null;
    }>>`
      WITH base AS (
        SELECT
          LOWER(TRIM(COALESCE(customer,'')) || '|' || TRIM(COALESCE(address_line1,'')) || '|' || TRIM(COALESCE(city,''))) AS key,
          customer, address_line1, city, state, zip, lat, lng,
          insurance, sales_rep, stage, job_total, deductible,
          COALESCE(NULLIF(completed_date,''), signed_date) AS effective_date,
          data->'trades' AS trades_json,
          (stage ~* 'completed|finalized'
            AND COALESCE(data->'trades', '[]'::jsonb) ?| ARRAY['Roofing','Metal Roofing','Flat Roofing','Cedar Shake Roofing']
          ) AS is_completed_roof
          FROM intel_projects
         WHERE COALESCE(customer,'') <> ''
           ${state ? pgSql`AND state = ${state}` : pgSql``}
      ),
      agg AS (
        SELECT
          key,
          (ARRAY_AGG(customer ORDER BY effective_date DESC NULLS LAST))[1] AS name,
          (ARRAY_AGG(address_line1 ORDER BY effective_date DESC NULLS LAST))[1] AS address_line1,
          (ARRAY_AGG(city ORDER BY effective_date DESC NULLS LAST))[1] AS city,
          (ARRAY_AGG(state ORDER BY effective_date DESC NULLS LAST))[1] AS state,
          (ARRAY_AGG(zip ORDER BY effective_date DESC NULLS LAST))[1] AS zip,
          (ARRAY_AGG(lat ORDER BY effective_date DESC NULLS LAST) FILTER (WHERE lat IS NOT NULL))[1] AS lat,
          (ARRAY_AGG(lng ORDER BY effective_date DESC NULLS LAST) FILTER (WHERE lng IS NOT NULL))[1] AS lng,
          COUNT(*)::int AS jobs,
          COUNT(*) FILTER (WHERE stage ~* 'completed|finalized')::int AS completed,
          COUNT(*) FILTER (WHERE stage ~* 'dead|cancel')::int AS dead,
          COUNT(*) FILTER (WHERE NOT (stage ~* 'completed|finalized|dead|cancel'))::int AS open,
          COALESCE(SUM(job_total), 0)::numeric AS total_rev,
          COALESCE(SUM(job_total) FILTER (WHERE stage ~* 'completed|finalized'), 0)::numeric AS completed_rev,
          MIN(effective_date) AS first_date,
          MAX(effective_date) AS last_date,
          COALESCE(ARRAY_AGG(DISTINCT insurance) FILTER (WHERE insurance IS NOT NULL), ARRAY[]::text[]) AS carriers,
          COALESCE(ARRAY_AGG(DISTINCT sales_rep) FILTER (WHERE sales_rep IS NOT NULL), ARRAY[]::text[]) AS reps,
          BOOL_OR(is_completed_roof) AS has_completed_roof,
          MAX(effective_date) FILTER (WHERE is_completed_roof) AS last_completed_roof_date,
          MAX(deductible) FILTER (WHERE deductible > 0 AND deductible <= 50000) AS max_deductible
          FROM base
         GROUP BY key
      ),
      trades_agg AS (
        SELECT key, ARRAY_AGG(DISTINCT trade) AS trades
          FROM base, jsonb_array_elements_text(COALESCE(trades_json, '[]'::jsonb)) AS trade
         WHERE trade IS NOT NULL
         GROUP BY key
      )
      SELECT
        a.name, a.address_line1, a.city, a.state, a.zip, a.lat, a.lng,
        a.jobs, a.completed, a.dead, a.open, a.total_rev, a.completed_rev,
        a.first_date, a.last_date, a.carriers, a.reps,
        a.has_completed_roof, a.last_completed_roof_date, a.max_deductible,
        COALESCE(t.trades, ARRAY[]::text[]) AS trades
        FROM agg a
        LEFT JOIN trades_agg t USING (key)
    `;

    const today = Date.now();
    const customers = rows.map((r) => {
      const lastDate = r.last_date;
      const daysSince = lastDate
        ? Math.floor((today - new Date(lastDate).getTime()) / 86400_000)
        : null;
      return {
        name: r.name || '(unknown)',
        addressLine1: r.address_line1,
        city: r.city,
        state: r.state,
        zip: r.zip,
        lat: r.lat,
        lng: r.lng,
        jobCount: num(r.jobs),
        completedJobs: num(r.completed),
        deadJobs: num(r.dead),
        openJobs: num(r.open),
        totalRev: num(r.total_rev),
        completedRev: num(r.completed_rev),
        firstDate: r.first_date,
        lastDate,
        daysSince,
        trades: r.trades,
        tradeCount: r.trades.length,
        carriers: r.carriers,
        reps: r.reps,
        hasCompletedRoof: !!r.has_completed_roof,
        lastCompletedRoofDate: r.last_completed_roof_date,
        maxDeductible: r.max_deductible != null ? num(r.max_deductible) : null,
      };
    });

    res.json({ customers, total: customers.length, took_ms: Date.now() - t0 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'customers_list_failed', message: msg });
  }
}

/* ============================================================================
 * /api/intel/exec-summary
 * ----------------------------------------------------------------------------
 *  Exec dashboard widgets: latest storm, top reps last 12mo, top ZIPs by rev,
 *  YoY, top carriers by rev, top storms by jobs, risk counts, solar candidates
 *  count. Returns everything exec.html needs in one round-trip.
 * ========================================================================= */
export async function execSummary(_req: Request, res: Response) {
  const t0 = Date.now();
  const cutoff12mo = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);

  try {
    const [
      latestStormRows,
      topRepsRows,
      topZipsRows,
      yoyRows,
      topCarriersRows,
      topStormsRows,
      risksRows,
      solarRows,
    ] = await Promise.all([
      pgSql<Array<{
        storm_date: string | null; storm_type: string | null;
        storm_mag: string | null; storm_unit: string | null;
      }>>`
        SELECT
          data->'stormMatch'->>'stormDate' AS storm_date,
          data->'stormMatch'->>'stormType' AS storm_type,
          data->'stormMatch'->>'stormMagnitude' AS storm_mag,
          data->'stormMatch'->>'stormUnit' AS storm_unit
          FROM intel_projects
         WHERE data->'stormMatch'->>'stormDate' IS NOT NULL
         ORDER BY data->'stormMatch'->>'stormDate' DESC NULLS LAST
         LIMIT 1
      `,
      pgSql<Array<{ rep: string; signed: number; completed: number; revenue: number }>>`
        SELECT
          sales_rep AS rep,
          COUNT(*)::int AS signed,
          COUNT(*) FILTER (WHERE stage ~* 'completed|finalized')::int AS completed,
          COALESCE(SUM(job_total) FILTER (WHERE stage ~* 'completed|finalized'), 0)::numeric AS revenue
          FROM intel_projects
         WHERE signed_date >= ${cutoff12mo} AND sales_rep IS NOT NULL AND sales_rep <> ''
         GROUP BY sales_rep ORDER BY COUNT(*) DESC LIMIT 5
      `,
      pgSql<Array<{ zip: string; city: string | null; signed: number; revenue: number }>>`
        SELECT
          LEFT(zip, 5) AS zip,
          MODE() WITHIN GROUP (ORDER BY city) AS city,
          COUNT(*)::int AS signed,
          COALESCE(SUM(job_total) FILTER (WHERE stage ~* 'completed|finalized'), 0)::numeric AS revenue
          FROM intel_projects
         WHERE zip IS NOT NULL AND LENGTH(zip) >= 5
         GROUP BY LEFT(zip, 5) ORDER BY revenue DESC LIMIT 5
      `,
      pgSql<Array<{ year: string; signed: number; completed: number; dead: number; revenue: number }>>`
        SELECT
          LEFT(signed_date, 4) AS year,
          COUNT(*)::int AS signed,
          COUNT(*) FILTER (WHERE stage ~* 'completed|finalized')::int AS completed,
          COUNT(*) FILTER (WHERE stage ~* 'dead|cancel')::int AS dead,
          COALESCE(SUM(job_total) FILTER (WHERE stage ~* 'completed|finalized'), 0)::numeric AS revenue
          FROM intel_projects WHERE signed_date IS NOT NULL AND LENGTH(signed_date) >= 4
         GROUP BY LEFT(signed_date, 4) ORDER BY LEFT(signed_date, 4) DESC
      `,
      pgSql<Array<{ name: string; signed: number; completed: number; revenue: number }>>`
        SELECT
          insurance AS name,
          COUNT(*)::int AS signed,
          COUNT(*) FILTER (WHERE stage ~* 'completed|finalized')::int AS completed,
          COALESCE(SUM(job_total) FILTER (WHERE stage ~* 'completed|finalized'), 0)::numeric AS revenue
          FROM intel_projects WHERE insurance IS NOT NULL AND insurance <> ''
         GROUP BY insurance ORDER BY revenue DESC LIMIT 5
      `,
      pgSql<Array<{
        storm_date: string | null; storm_type: string | null;
        storm_mag: string | null; storm_unit: string | null;
        jobs: number; revenue: number;
      }>>`
        SELECT
          data->'stormMatch'->>'stormDate' AS storm_date,
          data->'stormMatch'->>'stormType' AS storm_type,
          data->'stormMatch'->>'stormMagnitude' AS storm_mag,
          data->'stormMatch'->>'stormUnit' AS storm_unit,
          COUNT(*)::int AS jobs,
          COALESCE(SUM(job_total) FILTER (WHERE stage ~* 'completed|finalized'), 0)::numeric AS revenue
          FROM intel_projects
         WHERE data->'stormMatch'->>'stormId' IS NOT NULL
         GROUP BY data->'stormMatch'->>'stormId',
                  data->'stormMatch'->>'stormDate',
                  data->'stormMatch'->>'stormType',
                  data->'stormMatch'->>'stormMag',
                  data->'stormMatch'->>'stormMagnitude',
                  data->'stormMatch'->>'stormUnit'
         ORDER BY COUNT(*) DESC LIMIT 5
      `,
      pgSql<Array<{
        paused_count: number; dead_12mo: number; supplements_open: number;
      }>>`
        SELECT
          COUNT(*) FILTER (WHERE paused = true)::int AS paused_count,
          COUNT(*) FILTER (
            WHERE stage ~* 'dead|cancel' AND signed_date >= ${cutoff12mo}
          )::int AS dead_12mo,
          COUNT(*) FILTER (
            WHERE (data->>'hasSupplement')::boolean = true
              AND NOT (stage ~* 'completed|finalized|dead|cancel')
          )::int AS supplements_open
          FROM intel_projects
      `,
      // Solar candidates: customers whose most-recent completed roof job is
      // between 1 and 7 years old (the solar-friendly age range). Rolling
      // window — was a fixed 2018-2024 literal, which drifted out of sync
      // with solar.html's "1-7y" filter as years passed.
      pgSql<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count
          FROM (
            SELECT DISTINCT ON (LOWER(COALESCE(customer,'')) || '|' || LOWER(COALESCE(address_line1,'')))
              COALESCE(NULLIF(completed_date,''), signed_date) AS d
              FROM intel_projects
             WHERE stage ~* 'completed|finalized'
               AND COALESCE(data->'trades', '[]'::jsonb) ?| ARRAY['Roofing','Metal Roofing','Flat Roofing','Cedar Shake Roofing']
               AND (COALESCE(customer,'') <> '' OR COALESCE(address_line1,'') <> '')
             ORDER BY LOWER(COALESCE(customer,'')) || '|' || LOWER(COALESCE(address_line1,'')),
                      COALESCE(NULLIF(completed_date,''), signed_date) DESC NULLS LAST
          ) latest
         WHERE d IS NOT NULL
           AND d::date BETWEEN (NOW() - INTERVAL '7 years')::date AND (NOW() - INTERVAL '1 year')::date
      `,
    ]);

    const latest = latestStormRows[0];
    res.json({
      latestStorm: latest ? {
        stormDate: latest.storm_date,
        stormType: latest.storm_type,
        stormMagnitude: latest.storm_mag != null ? num(latest.storm_mag) : null,
        stormUnit: latest.storm_unit,
      } : null,
      topRepsLast12mo: topRepsRows.map((r) => ({
        name: r.rep,
        signed: num(r.signed),
        completed: num(r.completed),
        revenue: num(r.revenue),
      })),
      topZipsByRev: topZipsRows.map((r) => ({
        zip: r.zip, city: r.city,
        signed: num(r.signed), revenue: num(r.revenue),
      })),
      yoy: yoyRows.map((r) => {
        const signed = num(r.signed);
        const completed = num(r.completed);
        const dead = num(r.dead);
        return {
          year: r.year,
          signed, completed, dead,
          revenue: num(r.revenue),
          // Canonical close rate — completed / (completed + dead). Matches the
          // Field Portal's Approval Rate (51.23%). All RIQ surfaces use this.
          closeRate: completed + dead > 0 ? completed / (completed + dead) : 0,
        };
      }),
      topCarriersByRev: topCarriersRows.map((r) => ({
        name: r.name,
        signed: num(r.signed),
        completed: num(r.completed),
        revenue: num(r.revenue),
      })),
      topStormsByJobs: topStormsRows.map((r) => ({
        date: r.storm_date,
        type: r.storm_type,
        mag: r.storm_mag != null ? num(r.storm_mag) : null,
        unit: r.storm_unit,
        jobs: num(r.jobs),
        revenue: num(r.revenue),
      })),
      risks: {
        paused: num(risksRows[0]?.paused_count ?? 0),
        deadLast12mo: num(risksRows[0]?.dead_12mo ?? 0),
        supplementsOpen: num(risksRows[0]?.supplements_open ?? 0),
      },
      solarCandidates: num(solarRows[0]?.count ?? 0),
      took_ms: Date.now() - t0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'exec_summary_failed', message: msg });
  }
}

/* ============================================================================
 * /api/intel/weekly-recap?days=7&state=VA
 * ----------------------------------------------------------------------------
 *  Date-windowed metrics for weekly-recap.html. Returns current vs prior
 *  window deltas + top reps. Receivables totals come from intel_blobs since
 *  that dataset isn't decomposed yet.
 * ========================================================================= */
export async function weeklyRecap(req: Request, res: Response) {
  const t0 = Date.now();
  const days = Math.max(1, Math.min(90, Number(req.query.days) || 7));
  const state = String(req.query.state ?? '').trim().toUpperCase() || null;

  // Date-string boundaries — using portal's YYYY-MM-DD format.
  const now = Date.now();
  const since = new Date(now - days * 86400_000).toISOString().slice(0, 10);
  const priorSince = new Date(now - 2 * days * 86400_000).toISOString().slice(0, 10);

  try {
    const [
      windowRows,
      priorRows,
      topRepsRows,
      receivablesBlob,
    ] = await Promise.all([
      pgSql<Array<{
        new_signed: number; new_completed: number; new_dead: number;
        closed_rev: number;
      }>>`
        SELECT
          COUNT(*) FILTER (WHERE signed_date >= ${since})::int AS new_signed,
          COUNT(*) FILTER (WHERE completed_date >= ${since})::int AS new_completed,
          COUNT(*) FILTER (
            WHERE stage ~* 'dead|cancel' AND COALESCE(finalized_date, signed_date) >= ${since}
          )::int AS new_dead,
          COALESCE(SUM(job_total) FILTER (WHERE completed_date >= ${since}), 0)::numeric AS closed_rev
          FROM intel_projects
         WHERE 1=1 ${state ? pgSql`AND state = ${state}` : pgSql``}
      `,
      pgSql<Array<{ prior_signed: number; prior_rev: number }>>`
        SELECT
          COUNT(*) FILTER (WHERE signed_date >= ${priorSince} AND signed_date < ${since})::int AS prior_signed,
          COALESCE(SUM(job_total) FILTER (
            WHERE completed_date >= ${priorSince} AND completed_date < ${since}
          ), 0)::numeric AS prior_rev
          FROM intel_projects
         WHERE 1=1 ${state ? pgSql`AND state = ${state}` : pgSql``}
      `,
      pgSql<Array<{ rep: string; signed: number; revenue: number }>>`
        SELECT
          TRIM(sales_rep) AS rep,
          COUNT(*)::int AS signed,
          COALESCE(SUM(job_total), 0)::numeric AS revenue
          FROM intel_projects
         WHERE signed_date >= ${since}
           AND sales_rep IS NOT NULL AND sales_rep <> ''
           ${state ? pgSql`AND state = ${state}` : pgSql``}
         GROUP BY TRIM(sales_rep)
         ORDER BY COUNT(*) DESC
         LIMIT 5
      `,
      pgSql<Array<{ data: { accounts?: Array<{ status?: string; proj?: { jobTotal?: number }; job?: { jobTotal?: number } }>; downpayments?: Array<{ status?: string }> } }>>`
        SELECT data FROM intel_blobs WHERE key = 'receivables' LIMIT 1
      `,
    ]);

    const w = windowRows[0] ?? { new_signed: 0, new_completed: 0, new_dead: 0, closed_rev: 0 };
    const p = priorRows[0] ?? { prior_signed: 0, prior_rev: 0 };
    const newSigned = num(w.new_signed);
    const newCompleted = num(w.new_completed);
    const newDead = num(w.new_dead);
    const closedRev = num(w.closed_rev);
    const priorSigned = num(p.prior_signed);
    const priorRev = num(p.prior_rev);

    // Receivables aggregate from blob
    const recv = receivablesBlob[0]?.data || {};
    const accounts = recv.accounts || [];
    let arTotal = 0;
    let cfPending = 0;
    for (const a of accounts) {
      arTotal += a.proj?.jobTotal || a.job?.jobTotal || 0;
      if (a.status === 'CF Pending' || a.status === 'CF Sent') cfPending++;
    }
    const downpayments = recv.downpayments || [];
    const downAwaiting = downpayments.filter((d) => d.status !== 'Collected').length;

    res.json({
      window: { days, since, state },
      numbers: {
        newSigned,
        newCompleted,
        newDead,
        closedRev,
        deltaSigned: newSigned - priorSigned,
        deltaRev: closedRev - priorRev,
      },
      topReps: topRepsRows.map((r) => ({
        name: r.rep,
        signed: num(r.signed),
        revenue: num(r.revenue),
      })),
      receivables: {
        arTotal,
        cfPending,
        accountsTotal: accounts.length,
        downpaymentsAwaiting: downAwaiting,
      },
      took_ms: Date.now() - t0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'weekly_recap_failed', message: msg });
  }
}

/* ============================================================================
 * /api/intel/jobs-nearby?lat=38.95&lng=-77.3&radius=3
 * ----------------------------------------------------------------------------
 *  Haversine radius query over intel_projects (jobs with lat/lng). Used by
 *  storm-intel.html (jobs near a storm) and property-lookup.html (jobs near
 *  a geocoded address).
 *
 *  Returns: { jobs: [{...job, distance}], total, took_ms }
 *  Pre-filter by lat/lng bbox using a degree-approximation (1° lat ≈ 69 mi)
 *  then refine with exact haversine. Keeps the planner from full-scanning
 *  intel_projects for nearby-query patterns.
 * ========================================================================= */
export async function jobsNearby(req: Request, res: Response) {
  const t0 = Date.now();
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const radius = Math.max(0.01, Math.min(50, Number(req.query.radius) || 3));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({ error: 'missing_or_invalid_lat_lng' });
    return;
  }
  // Bbox prefilter — 1° lat ≈ 69 mi; 1° lng ≈ 69 * cos(lat) mi.
  const latDelta = radius / 69;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const lngDelta = radius / (69 * Math.max(0.01, Math.abs(cosLat)));

  try {
    const rows = await pgSql<Array<{
      id: number;
      customer: string | null;
      address_line1: string | null;
      city: string | null;
      state: string | null;
      zip: string | null;
      lat: number;
      lng: number;
      insurance: string | null;
      adjuster_name: string | null;
      sales_rep: string | null;
      stage: string | null;
      job_type: string | null;
      signed_date: string | null;
      completed_date: string | null;
      job_total: number | null;
      customer_email: string | null;
      customer_cell: string | null;
      trades: unknown;
      distance_miles: number;
    }>>`
      SELECT id, customer, address_line1, city, state, zip, lat, lng,
             insurance, adjuster_name, sales_rep, stage, job_type,
             signed_date, completed_date, job_total,
             NULLIF(data->>'customerEmail','') AS customer_email,
             NULLIF(data->>'customerCell','') AS customer_cell,
             data->'trades' AS trades,
             -- Haversine in miles (R = 3958.7613)
             (3958.7613 * 2 * ASIN(SQRT(
               POWER(SIN(RADIANS(${lat} - lat) / 2), 2)
               + COS(RADIANS(${lat})) * COS(RADIANS(lat))
                 * POWER(SIN(RADIANS(${lng} - lng) / 2), 2)
             )))::numeric AS distance_miles
        FROM intel_projects
       WHERE lat IS NOT NULL AND lng IS NOT NULL
         AND lat BETWEEN ${lat - latDelta} AND ${lat + latDelta}
         AND lng BETWEEN ${lng - lngDelta} AND ${lng + lngDelta}
    `;

    const nearby = rows
      .map((r) => ({
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
        salesRep: r.sales_rep,
        stage: r.stage,
        jobType: r.job_type,
        signedDate: r.signed_date,
        completedDate: r.completed_date,
        jobTotal: r.job_total != null ? num(r.job_total) : null,
        customerEmail: r.customer_email,
        customerCell: r.customer_cell,
        trades: Array.isArray(r.trades) ? r.trades : [],
        distance: num(r.distance_miles),
      }))
      .filter((j) => j.distance <= radius)
      .sort((a, b) => a.distance - b.distance);

    res.json({ jobs: nearby, total: nearby.length, radius, took_ms: Date.now() - t0 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'jobs_nearby_failed', message: msg });
  }
}

/* ============================================================================
 * /api/intel/zip-deep?zip=20110
 * ----------------------------------------------------------------------------
 *  Per-ZIP deep dive: carriers/trades/reps/adjusters with rates + storms.
 *  Used by zip-intel.html right pane.
 * ========================================================================= */
export async function zipDeep(req: Request, res: Response) {
  const t0 = Date.now();
  const zip = String(req.query.zip ?? '').trim().slice(0, 5);
  if (!zip) {
    res.status(400).json({ error: 'missing_zip' });
    return;
  }
  const filter = pgSql`LEFT(zip, 5) = ${zip}`;

  try {
    const [
      summaryRows,
      carrierRows,
      tradeRows,
      repRows,
      adjusterRows,
      stormRows,
    ] = await Promise.all([
      pgSql<Array<{
        city: string | null; signed: number; completed: number; dead: number;
        revenue: number; completed_rev: number; med_deductible: number | null;
        storm_count: number;
      }>>`
        SELECT
          MODE() WITHIN GROUP (ORDER BY city) AS city,
          COUNT(*)::int AS signed,
          COUNT(*) FILTER (WHERE stage ~* 'completed|finalized')::int AS completed,
          COUNT(*) FILTER (WHERE stage ~* 'dead|cancel')::int AS dead,
          COALESCE(SUM(job_total), 0)::numeric AS revenue,
          COALESCE(SUM(job_total) FILTER (WHERE stage ~* 'completed|finalized'), 0)::numeric AS completed_rev,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY deductible)
            FILTER (WHERE deductible > 0 AND deductible <= 50000)::numeric AS med_deductible,
          COUNT(*) FILTER (
            WHERE data->'stormMatch' IS NOT NULL AND data->'stormMatch' <> 'null'::jsonb
          )::int AS storm_count
          FROM intel_projects WHERE ${filter}
      `,
      pgSql<Array<{ name: string; signed: number; completed: number; dead: number; rev: number }>>`
        SELECT
          insurance AS name,
          COUNT(*)::int AS signed,
          COUNT(*) FILTER (WHERE stage ~* 'completed|finalized')::int AS completed,
          COUNT(*) FILTER (WHERE stage ~* 'dead|cancel')::int AS dead,
          COALESCE(SUM(job_total) FILTER (WHERE stage ~* 'completed|finalized'), 0)::numeric AS rev
          FROM intel_projects WHERE ${filter} AND insurance IS NOT NULL
         GROUP BY insurance ORDER BY COUNT(*) DESC
      `,
      pgSql<Array<{ trade: string; count: number }>>`
        SELECT trade, COUNT(*)::int AS count
          FROM intel_projects,
               jsonb_array_elements_text(COALESCE(data->'trades', '[]'::jsonb)) AS trade
         WHERE ${filter}
         GROUP BY trade ORDER BY COUNT(*) DESC LIMIT 8
      `,
      pgSql<Array<{ rep: string; count: number }>>`
        SELECT sales_rep AS rep, COUNT(*)::int AS count
          FROM intel_projects WHERE ${filter} AND sales_rep IS NOT NULL
         GROUP BY sales_rep ORDER BY COUNT(*) DESC LIMIT 5
      `,
      pgSql<Array<{ adjuster: string; count: number }>>`
        SELECT adjuster_name AS adjuster, COUNT(*)::int AS count
          FROM intel_projects WHERE ${filter} AND adjuster_name IS NOT NULL AND adjuster_name <> ''
         GROUP BY adjuster_name ORDER BY COUNT(*) DESC LIMIT 5
      `,
      pgSql<Array<{
        storm_date: string | null;
        storm_type: string | null;
        storm_magnitude: string | null;
        storm_unit: string | null;
        storm_distance: string | null;
      }>>`
        SELECT
          data->'stormMatch'->>'stormDate' AS storm_date,
          data->'stormMatch'->>'stormType' AS storm_type,
          data->'stormMatch'->>'stormMagnitude' AS storm_magnitude,
          data->'stormMatch'->>'stormUnit' AS storm_unit,
          data->'stormMatch'->>'stormDistanceMiles' AS storm_distance
          FROM intel_projects
         WHERE ${filter} AND data->'stormMatch'->>'stormDate' IS NOT NULL
         ORDER BY data->'stormMatch'->>'stormDate' DESC LIMIT 5
      `,
    ]);

    const s = summaryRows[0] ?? { city: null, signed: 0, completed: 0, dead: 0, revenue: 0, completed_rev: 0, med_deductible: null, storm_count: 0 };
    const signed = num(s.signed);
    const completed = num(s.completed);
    const dead = num(s.dead);
    const completedRev = num(s.completed_rev);

    const carriers = carrierRows.map((c) => {
      const cs = num(c.signed);
      const cc = num(c.completed);
      const cd = num(c.dead);
      return {
        name: c.name,
        signed: cs, completed: cc, dead: cd, rev: num(c.rev),
        closeRate: cc + cd > 0 ? cc / (cc + cd) : 0,
      };
    });

    res.json({
      zip,
      city: s.city,
      summary: {
        signed, completed, dead,
        revenue: num(s.revenue),
        completedRev,
        closeRate: completed + dead > 0 ? completed / (completed + dead) : 0,
        avgApprovedJob: completed > 0 ? completedRev / completed : null,
        medianDeductible: s.med_deductible != null ? num(s.med_deductible) : null,
        stormCount: num(s.storm_count),
      },
      carriers,
      trades: tradeRows.map((r) => ({ name: r.trade, count: num(r.count) })),
      reps: repRows.map((r) => ({ name: r.rep, count: num(r.count) })),
      adjusters: adjusterRows.map((r) => ({ name: r.adjuster, count: num(r.count) })),
      recentStorms: stormRows.map((s) => ({
        stormDate: s.storm_date,
        stormType: s.storm_type,
        stormMagnitude: s.storm_magnitude ? num(s.storm_magnitude) : null,
        stormUnit: s.storm_unit,
        stormDistanceMiles: s.storm_distance ? num(s.storm_distance) : null,
      })),
      took_ms: Date.now() - t0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'zip_deep_failed', message: msg });
  }
}

/* ============================================================================
 * /api/intel/rep-response?year=2026
 * ----------------------------------------------------------------------------
 *  Per-rep storm-response stats: median/25th/75th percentile of
 *  daysLossToSign (clamped to 0-365), pct-within-30-days, and per-rep job
 *  counts. Only counts jobs that have a stormMatch and a valid daysLossToSign.
 *  Used by rep-response.html.
 *
 *  Also returns the list of years present in signed_date so the page can
 *  populate its year filter without a separate fetch.
 * ========================================================================= */
export async function repResponse(req: Request, res: Response) {
  const t0 = Date.now();
  const year = String(req.query.year ?? '').trim() || null;

  try {
    const [repRows, yearRows] = await Promise.all([
      pgSql<Array<{
        rep: string;
        jobs: number;
        completed: number;
        revenue: number;
        median_days: number;
        p25: number;
        p75: number;
        fast30: number;
      }>>`
        SELECT
          TRIM(sales_rep) AS rep,
          COUNT(*)::int AS jobs,
          COUNT(*) FILTER (WHERE stage ~* 'completed|finalized')::int AS completed,
          COALESCE(SUM(job_total) FILTER (WHERE stage ~* 'completed|finalized'), 0)::numeric AS revenue,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY NULLIF(data->>'daysLossToSign','')::int)::numeric AS median_days,
          PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY NULLIF(data->>'daysLossToSign','')::int)::numeric AS p25,
          PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY NULLIF(data->>'daysLossToSign','')::int)::numeric AS p75,
          COUNT(*) FILTER (WHERE NULLIF(data->>'daysLossToSign','')::int <= 30)::int AS fast30
          FROM intel_projects
         WHERE TRIM(COALESCE(sales_rep,'')) <> ''
           AND data->'stormMatch' IS NOT NULL AND data->'stormMatch' <> 'null'::jsonb
           AND NULLIF(data->>'daysLossToSign','')::int BETWEEN 0 AND 365
           ${year ? pgSql`AND LEFT(signed_date, 4) = ${year}` : pgSql``}
         GROUP BY TRIM(sales_rep)
      `,
      pgSql<Array<{ year: string }>>`
        SELECT DISTINCT LEFT(signed_date, 4) AS year
          FROM intel_projects
         WHERE signed_date IS NOT NULL AND LENGTH(signed_date) >= 4
         ORDER BY year DESC
      `,
    ]);

    const reps = repRows.map((r) => {
      const jobs = num(r.jobs);
      const fast30 = num(r.fast30);
      return {
        name: r.rep,
        jobs,
        completed: num(r.completed),
        revenue: num(r.revenue),
        medianDays: r.median_days != null ? Math.round(num(r.median_days)) : null,
        p25: r.p25 != null ? Math.round(num(r.p25)) : null,
        p75: r.p75 != null ? Math.round(num(r.p75)) : null,
        pctFast30: jobs > 0 ? fast30 / jobs : 0,
      };
    });
    reps.sort((a, b) => (a.medianDays ?? 999) - (b.medianDays ?? 999));

    res.json({
      reps,
      years: yearRows.map((y) => y.year),
      year,
      total: reps.length,
      took_ms: Date.now() - t0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'rep_response_failed', message: msg });
  }
}

/* ============================================================================
 * /api/intel/lifetime-touch-query?rep=X&tier=high&reason=storm
 * ----------------------------------------------------------------------------
 *  Phase 4d: indexed query over intel_lifetime_touch. Replaces the 2.2 MB
 *  blob fetch on lifetime-touch.html with a per-filter SELECT.
 *
 *  Params:
 *    rep    — exact match on sales_rep ('(top)' returns top-100 across all)
 *    tier   — 'high' (>=60), 'mid' (40-59), 'low' (<40)
 *    reason — 'storm' (storm_hits_since_last>=1), 'old' (years>=12), 'gap' (>=3 trade gaps)
 *
 *  Also returns 'stats' (counts only, computed once) and 'reps' list for
 *  the page's rep selector. ?include=stats|reps to include extras.
 * ========================================================================= */
export async function lifetimeTouchQuery(req: Request, res: Response) {
  const t0 = Date.now();
  const q = req.query as Record<string, string | undefined>;
  const rep = q.rep?.trim() || null;
  const tier = q.tier?.trim() || null;
  const reason = q.reason?.trim() || null;
  const include = String(q.include ?? '').split(',').filter(Boolean);
  const includeStats = include.includes('stats');
  const includeReps = include.includes('reps');

  // Build WHERE incrementally
  const conds: ReturnType<typeof pgSql>[] = [];
  if (rep && rep !== '(top)') conds.push(pgSql`sales_rep = ${rep}`);
  if (tier === 'high') conds.push(pgSql`score >= 60`);
  else if (tier === 'mid') conds.push(pgSql`score >= 40 AND score < 60`);
  else if (tier === 'low') conds.push(pgSql`score < 40`);
  if (reason === 'storm') conds.push(pgSql`storm_hits_since_last >= 1`);
  else if (reason === 'old') conds.push(pgSql`years_since_last >= 4`);
  else if (reason === 'gap') conds.push(pgSql`jsonb_array_length(COALESCE(data->'tradeGaps','[]'::jsonb)) >= 3`);
  const where = conds.length === 0
    ? pgSql``
    : conds.reduce((acc, c, i) => i === 0 ? pgSql`WHERE ${c}` : pgSql`${acc} AND ${c}`, pgSql``);

  // For "(top)" without rep filter, cap at 100. Otherwise return all matching.
  const limit = rep === '(top)' ? 100 : 5000;

  try {
    const [rows, statsRows, repRows] = await Promise.all([
      pgSql<Array<{ data: unknown }>>`
        SELECT data FROM intel_lifetime_touch
         ${where}
         ORDER BY score DESC NULLS LAST
         LIMIT ${limit}
      `,
      includeStats
        ? pgSql<Array<{
            total_customers: number; top_tier_count: number; mid_tier_count: number;
            with_storm_since: number; old_roof_count: number; contactable_count: number;
            by_rep_count: number;
          }>>`
          SELECT
            COUNT(*)::int AS total_customers,
            COUNT(*) FILTER (WHERE score >= 60)::int AS top_tier_count,
            COUNT(*) FILTER (WHERE score >= 40 AND score < 60)::int AS mid_tier_count,
            COUNT(*) FILTER (WHERE storm_hits_since_last >= 1)::int AS with_storm_since,
            COUNT(*) FILTER (WHERE years_since_last >= 4)::int AS old_roof_count,
            COUNT(*) FILTER (WHERE customer_email IS NOT NULL OR customer_cell IS NOT NULL)::int AS contactable_count,
            COUNT(DISTINCT sales_rep) FILTER (WHERE sales_rep IS NOT NULL)::int AS by_rep_count
            FROM intel_lifetime_touch
        `
        : Promise.resolve([] as Array<{ total_customers: number; top_tier_count: number; mid_tier_count: number; with_storm_since: number; old_roof_count: number; contactable_count: number; by_rep_count: number }>),
      includeReps
        ? pgSql<Array<{ rep: string; count: number }>>`
          SELECT sales_rep AS rep, COUNT(*)::int AS count
            FROM intel_lifetime_touch
           WHERE sales_rep IS NOT NULL
           GROUP BY sales_rep
           ORDER BY sales_rep
        `
        : Promise.resolve([] as Array<{ rep: string; count: number }>),
    ]);

    const result: Record<string, unknown> = {
      rows: rows.map((r) => r.data),
      total: rows.length,
      took_ms: Date.now() - t0,
    };
    if (includeStats) {
      const s = statsRows[0] ?? { total_customers: 0, top_tier_count: 0, mid_tier_count: 0, with_storm_since: 0, old_roof_count: 0, contactable_count: 0, by_rep_count: 0 };
      result.stats = {
        totalCustomers: num(s.total_customers),
        topTierCount: num(s.top_tier_count),
        midTierCount: num(s.mid_tier_count),
        withStormSince: num(s.with_storm_since),
        oldRoofCount: num(s.old_roof_count),
        contactableCount: num(s.contactable_count),
        byRepCount: num(s.by_rep_count),
      };
    }
    if (includeReps) {
      result.reps = repRows.map((r) => ({ rep: r.rep, count: num(r.count) }));
    }
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'lifetime_touch_query_failed', message: msg });
  }
}

/* ============================================================================
 * /api/intel/solar-candidates
 * ----------------------------------------------------------------------------
 *  Customers whose most-recent completed roof job is the candidate row. Used
 *  by solar.html. Per-customer dedup by lower(customer)|lower(addressLine1).
 *  Returns: { candidates: [{ customer, addressLine1, city, ..., completedDate,
 *  ageYears, jobTotal, carrier, houseType, email, phone, rep, trades }] }
 * ========================================================================= */
export async function solarCandidates(_req: Request, res: Response) {
  const t0 = Date.now();
  try {
    // DISTINCT ON picks the most recent completed roof per customer key.
    // Restrict to roofs aged 1-7 years (rolling window) — brand-new roofs
    // aren't solar-ready and 8+ year roofs are past the warranty sweet spot.
    const rows = await pgSql<Array<{
      customer: string | null;
      address_line1: string | null;
      city: string | null;
      state: string | null;
      zip: string | null;
      lat: number | null;
      lng: number | null;
      email: string | null;
      phone: string | null;
      completed_date: string | null;
      job_total: number | null;
      carrier: string | null;
      house_type: string | null;
      rep: string | null;
      trades: unknown;
    }>>`
      SELECT * FROM (
        SELECT DISTINCT ON (LOWER(COALESCE(customer,'')) || '|' || LOWER(COALESCE(address_line1,'')))
          customer,
          address_line1,
          city,
          state,
          zip,
          lat,
          lng,
          NULLIF(data->>'customerEmail','') AS email,
          NULLIF(data->>'customerCell','') AS phone,
          COALESCE(NULLIF(completed_date,''), signed_date) AS completed_date,
          job_total,
          insurance AS carrier,
          house_type,
          sales_rep AS rep,
          data->'trades' AS trades
          FROM intel_projects
         WHERE stage ~* 'completed|finalized'
           AND COALESCE(data->'trades', '[]'::jsonb) ?| ARRAY['Roofing','Metal Roofing','Flat Roofing','Cedar Shake Roofing','Slate Roofing']
           AND COALESCE(NULLIF(completed_date,''), signed_date) IS NOT NULL
           AND (COALESCE(customer,'') <> '' OR COALESCE(address_line1,'') <> '')
         ORDER BY
           LOWER(COALESCE(customer,'')) || '|' || LOWER(COALESCE(address_line1,'')),
           COALESCE(NULLIF(completed_date,''), signed_date) DESC NULLS LAST
      ) latest_per_customer
      WHERE completed_date::date BETWEEN (NOW() - INTERVAL '7 years')::date AND (NOW() - INTERVAL '1 year')::date
    `;

    const today = Date.now();
    const candidates = rows.map((r) => {
      const completedMs = r.completed_date ? new Date(r.completed_date).getTime() : null;
      const ageYears = completedMs != null
        ? (today - completedMs) / (365 * 86400_000)
        : null;
      const key = ((r.customer || '').toLowerCase() + '|' + (r.address_line1 || '').toLowerCase());
      return {
        customer: r.customer,
        addressLine1: r.address_line1,
        city: r.city,
        state: r.state,
        zip: r.zip,
        lat: r.lat,
        lng: r.lng,
        email: r.email,
        phone: r.phone,
        completedDate: r.completed_date,
        ageYears,
        jobTotal: r.job_total != null ? num(r.job_total) : null,
        carrier: r.carrier,
        houseType: r.house_type,
        rep: r.rep,
        trades: Array.isArray(r.trades) ? r.trades : [],
        customerKey: key,
      };
    });
    res.json({ candidates, total: candidates.length, took_ms: Date.now() - t0 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'solar_candidates_failed', message: msg });
  }
}

/* ============================================================================
 * /api/intel/dashboard-kpis
 * ----------------------------------------------------------------------------
 *  All summary metrics index.html shows in the hero + tile grid, in one shot:
 *  total/completed/dead counts, lifetime+completed revenue, distinct customer/
 *  zip/rep/carrier/adjuster counts, storm-matched count, hot-zips ≥60 score
 *  count, and siding-upsell count (customers with Roofing but no Siding).
 *  Also rolls in receivables + resurrection + storm-exposure + storm-playbook
 *  blob counts for the tile KPIs.
 * ========================================================================= */
export async function dashboardKpis(_req: Request, res: Response) {
  const t0 = Date.now();
  try {
    // Big scan in one query — counts + revenue + distinct cardinalities.
    const [coreRows, zipAggRows, sidingRows, blobCounts] = await Promise.all([
      pgSql<Array<{
        total: number; completed: number; dead: number;
        completed_revenue: number; total_revenue: number;
        cust_count: number; zip_count: number; rep_count: number;
        carrier_count: number; adjuster_count: number; storm_matched: number;
        ins_signed: number; ins_completed: number; ins_dead: number;
        ret_signed: number; ret_completed: number; ret_dead: number;
      }>>`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE stage ~* 'completed|finalized')::int AS completed,
          COUNT(*) FILTER (WHERE stage ~* 'dead|cancel')::int AS dead,
          COALESCE(SUM(job_total) FILTER (WHERE stage ~* 'completed|finalized'), 0)::numeric AS completed_revenue,
          COALESCE(SUM(job_total), 0)::numeric AS total_revenue,
          -- 3-part dedup key matches customers-list, customer-deep, and the
          -- shared riq-links.js custKey(). Required filter is "customer name
          -- present" (was OR-address, which surfaced 9 address-only entries).
          COUNT(DISTINCT LOWER(TRIM(COALESCE(customer,'')) || '|' || TRIM(COALESCE(address_line1,'')) || '|' || TRIM(COALESCE(city,''))))
            FILTER (WHERE TRIM(COALESCE(customer,'')) <> '')::int AS cust_count,
          COUNT(DISTINCT LEFT(zip, 5)) FILTER (WHERE zip IS NOT NULL AND LENGTH(zip) >= 5)::int AS zip_count,
          COUNT(DISTINCT sales_rep) FILTER (WHERE sales_rep IS NOT NULL AND sales_rep <> '')::int AS rep_count,
          COUNT(DISTINCT insurance) FILTER (WHERE insurance IS NOT NULL AND insurance <> '')::int AS carrier_count,
          COUNT(DISTINCT TRIM(adjuster_name) || '|' || COALESCE(insurance,''))
            FILTER (WHERE adjuster_name IS NOT NULL AND TRIM(adjuster_name) <> '')::int AS adjuster_count,
          COUNT(*) FILTER (WHERE data->'stormMatch' IS NOT NULL AND data->'stormMatch' <> 'null'::jsonb)::int AS storm_matched,
          -- Book composition: Insurance vs Retail/No-Carrier split.
          COUNT(*) FILTER (WHERE insurance IS NOT NULL AND insurance <> '')::int AS ins_signed,
          COUNT(*) FILTER (WHERE (insurance IS NOT NULL AND insurance <> '') AND stage ~* 'completed|finalized')::int AS ins_completed,
          COUNT(*) FILTER (WHERE (insurance IS NOT NULL AND insurance <> '') AND stage ~* 'dead|cancel')::int AS ins_dead,
          COUNT(*) FILTER (WHERE insurance IS NULL OR insurance = '')::int AS ret_signed,
          COUNT(*) FILTER (WHERE (insurance IS NULL OR insurance = '') AND stage ~* 'completed|finalized')::int AS ret_completed,
          COUNT(*) FILTER (WHERE (insurance IS NULL OR insurance = '') AND stage ~* 'dead|cancel')::int AS ret_dead
          FROM intel_projects
      `,
      // For hot-zips 60+ count, need same scoring as /zip-stats with 180d window.
      pgSql<Array<{
        zip: string;
        signed: number; completed: number; dead: number;
        revenue: number; recent_storms: number;
      }>>`
        SELECT
          LEFT(zip, 5) AS zip,
          COUNT(*)::int AS signed,
          COUNT(*) FILTER (WHERE stage ~* 'completed|finalized')::int AS completed,
          COUNT(*) FILTER (WHERE stage ~* 'dead|cancel')::int AS dead,
          COALESCE(SUM(job_total) FILTER (WHERE stage ~* 'completed|finalized'), 0)::numeric AS revenue,
          COUNT(*) FILTER (
            WHERE (data->'stormMatch'->>'stormDate')::timestamptz > NOW() - INTERVAL '180 days'
          )::int AS recent_storms
          FROM intel_projects
         WHERE zip IS NOT NULL AND LENGTH(zip) >= 5
         GROUP BY LEFT(zip, 5)
      `,
      // Siding upsell — customers with Roofing but no Siding in their trades union.
      pgSql<Array<{ count: number }>>`
        WITH customer_trades AS (
          SELECT
            LOWER(COALESCE(customer,'') || '|' || COALESCE(address_line1,'')) AS key,
            ARRAY_AGG(DISTINCT trade) AS trades
            FROM intel_projects,
                 jsonb_array_elements_text(COALESCE(data->'trades', '[]'::jsonb)) AS trade
           WHERE COALESCE(customer,'') <> '' OR COALESCE(address_line1,'') <> ''
           GROUP BY LOWER(COALESCE(customer,'') || '|' || COALESCE(address_line1,''))
        )
        SELECT COUNT(*)::int AS count
          FROM customer_trades
         WHERE trades && ARRAY['Roofing','Metal Roofing','Flat Roofing']
           AND NOT ('Siding' = ANY(trades))
      `,
      // Blob row counts for tile KPIs.
      pgSql<Array<{ key: string; row_count: number; bytes: number }>>`
        SELECT key, row_count, bytes FROM intel_blobs
         WHERE key IN ('resurrection','storm-exposure','storm-playbook','receivables','notes','lifetime-touch')
      `,
    ]);

    const core = coreRows[0] ?? { total: 0, completed: 0, dead: 0, completed_revenue: 0, total_revenue: 0, cust_count: 0, zip_count: 0, rep_count: 0, carrier_count: 0, adjuster_count: 0, storm_matched: 0, ins_signed: 0, ins_completed: 0, ins_dead: 0, ret_signed: 0, ret_completed: 0, ret_dead: 0 };

    // Hot-zips 60+ score post-process (same formula as zipStats).
    const zipsForScore = zipAggRows.map((r) => ({
      signed: num(r.signed),
      completed: num(r.completed),
      dead: num(r.dead),
      revenue: num(r.revenue),
      recentStorms: num(r.recent_storms),
      closeRate: 0,
      avgApprovedJob: 0,
    }));
    for (const z of zipsForScore) {
      z.closeRate = z.completed + z.dead > 0 ? z.completed / (z.completed + z.dead) : 0;
      z.avgApprovedJob = z.completed > 0 ? z.revenue / z.completed : 0;
    }
    // Normalize against 90th-percentile (not absolute max) so a single
    // extreme zip doesn't peg the normalizer and drag every other zip's
    // component down. Cap each component at 1.0 — extreme zips just hit the
    // ceiling, average zips get fair scores. Threshold 50.
    function p90(values: number[]): number {
      const sorted = values.slice().sort((a, b) => a - b);
      return Math.max(1, sorted[Math.floor(sorted.length * 0.90)] ?? 1);
    }
    const p90Storms = p90(zipsForScore.map((z) => z.recentStorms));
    const p90Jobs = p90(zipsForScore.map((z) => z.signed));
    const p90Avg = p90(zipsForScore.map((z) => z.avgApprovedJob));
    let hotZips60 = 0;
    for (const z of zipsForScore) {
      // Round to match zip-stats' Math.round(...) so the dashboard count
      // and the page list agree exactly (49.5 rounds to 50 → hot).
      const score = Math.round(100 * (
        0.40 * Math.min(1, z.recentStorms / p90Storms) +
        0.25 * Math.min(1, z.closeRate) +
        0.20 * Math.min(1, z.avgApprovedJob / p90Avg) +
        0.15 * Math.min(1, z.signed / p90Jobs)
      ));
      if (score >= 50) hotZips60++;
    }

    const siding = num(sidingRows[0]?.count ?? 0);

    // Receivables — sum stored as blob; we don't decompose for this — quick scan.
    // Pull just enough to compute AR total. Falls back gracefully if missing.
    let arTotal = 0;
    try {
      const blobRow = await pgSql<Array<{ data: { accounts?: Array<{ proj?: { jobTotal?: number }; job?: { jobTotal?: number } }> } }>>`
        SELECT data FROM intel_blobs WHERE key = 'receivables' LIMIT 1
      `;
      const accounts = blobRow[0]?.data?.accounts || [];
      for (const a of accounts) {
        arTotal += a.proj?.jobTotal || a.job?.jobTotal || 0;
      }
    } catch { /* fall through */ }

    const blobMap: Record<string, { rows: number; bytes: number }> = {};
    for (const b of blobCounts) {
      blobMap[b.key] = { rows: num(b.row_count), bytes: num(b.bytes) };
    }

    // Book composition — Insurance vs Retail close rate is the most under-
    // appreciated number in the book (51% vs 28%). Make it easy to display.
    const insSigned = num(core.ins_signed);
    const insCompleted = num(core.ins_completed);
    const insDead = num(core.ins_dead);
    const retSigned = num(core.ret_signed);
    const retCompleted = num(core.ret_completed);
    const retDead = num(core.ret_dead);
    const bookComposition = {
      insurance: {
        signed: insSigned,
        completed: insCompleted,
        dead: insDead,
        closeRate: insCompleted + insDead > 0 ? insCompleted / (insCompleted + insDead) : 0,
        share: num(core.total) > 0 ? insSigned / num(core.total) : 0,
      },
      retail: {
        signed: retSigned,
        completed: retCompleted,
        dead: retDead,
        closeRate: retCompleted + retDead > 0 ? retCompleted / (retCompleted + retDead) : 0,
        share: num(core.total) > 0 ? retSigned / num(core.total) : 0,
      },
    };

    res.json({
      hero: {
        total: num(core.total),
        completed: num(core.completed),
        dead: num(core.dead),
        totalRevenue: num(core.total_revenue),
        completedRevenue: num(core.completed_revenue),
        customers: num(core.cust_count),
        zips: num(core.zip_count),
        reps: num(core.rep_count),
        carriers: num(core.carrier_count),
        adjusters: num(core.adjuster_count),
        stormMatched: num(core.storm_matched),
      },
      bookComposition,
      tiles: {
        hotZips60,
        sidingUpsell: siding,
        arTotal,
        resurrection: blobMap['resurrection']?.rows ?? 0,
        stormExposure: blobMap['storm-exposure']?.rows ?? 0,
        stormPlaybook: blobMap['storm-playbook']?.rows ?? 0,
        notes: blobMap['notes']?.rows ?? 0,
        lifetimeTouch: blobMap['lifetime-touch']?.rows ?? 0,
      },
      took_ms: Date.now() - t0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'dashboard_kpis_failed', message: msg });
  }
}

/* ============================================================================
 * /api/intel/quick-search?q=foo
 * ----------------------------------------------------------------------------
 *  Lightweight typeahead for index.html. Matches against customer name,
 *  address, city — up to 20 results.
 *  Returns: { results: [...], took_ms }
 * ========================================================================= */
export async function quickSearch(req: Request, res: Response) {
  const t0 = Date.now();
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) {
    res.json({ results: [], took_ms: Date.now() - t0 });
    return;
  }
  const needle = '%' + q.replace(/%/g, '\\%').replace(/_/g, '\\_') + '%';
  try {
    const rows = await pgSql<Array<{
      key: string;
      customer: string | null;
      address_line1: string | null;
      city: string | null;
      state: string | null;
      insurance: string | null;
      sales_rep: string | null;
    }>>`
      SELECT DISTINCT ON (LOWER(COALESCE(customer,'') || '|' || COALESCE(address_line1,'')))
        LOWER(COALESCE(customer,'') || '|' || COALESCE(address_line1,'')) AS key,
        customer, address_line1, city, state, insurance, sales_rep
        FROM intel_projects
       WHERE customer ILIKE ${needle}
          OR address_line1 ILIKE ${needle}
          OR city ILIKE ${needle}
       ORDER BY LOWER(COALESCE(customer,'') || '|' || COALESCE(address_line1,'')),
                signed_date DESC NULLS LAST
       LIMIT 20
    `;
    const results = rows.map((r) => ({
      customer: r.customer,
      addressLine1: r.address_line1,
      city: r.city,
      state: r.state,
      insurance: r.insurance,
      salesRep: r.sales_rep,
    }));
    res.json({ results, took_ms: Date.now() - t0 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'quick_search_failed', message: msg });
  }
}

/* ============================================================================
 * /api/intel/customer-deep?key=lowercased-customer|address|city
 * ----------------------------------------------------------------------------
 *  Full picture of one customer (deduped by customer-detail.html's 3-part key).
 *  Returns: identity + all job records + aggregates + storm-exposure entry.
 *  Used by customer-detail.html right pane.
 * ========================================================================= */
export async function customerDeep(req: Request, res: Response) {
  const t0 = Date.now();
  const rawKey = String(req.query.key ?? '').trim();
  if (!rawKey) {
    res.status(400).json({ error: 'missing_key' });
    return;
  }
  // Parse 3-part dedup key: customer|address|city (already lowercased)
  const [keyCustomer = '', keyAddr = '', keyCity = ''] = rawKey.split('|');

  try {
    const jobRows = await pgSql<Array<{
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
      sales_rep: string | null;
      stage: string | null;
      job_type: string | null;
      signed_date: string | null;
      completed_date: string | null;
      job_total: number | null;
      customer_email: string | null;
      customer_cell: string | null;
      customer_home: string | null;
      trades: unknown;
    }>>`
      SELECT id, customer, address_line1, city, state, zip, lat, lng,
             insurance, adjuster_name, sales_rep, stage, job_type,
             signed_date, completed_date, job_total,
             NULLIF(data->>'customerEmail','') AS customer_email,
             NULLIF(data->>'customerCell','') AS customer_cell,
             NULLIF(data->>'customerHome','') AS customer_home,
             data->'trades' AS trades
        FROM intel_projects
       WHERE LOWER(TRIM(COALESCE(customer,''))) = ${keyCustomer}
         AND LOWER(TRIM(COALESCE(address_line1,''))) = ${keyAddr}
         AND LOWER(TRIM(COALESCE(city,''))) = ${keyCity}
    `;

    if (jobRows.length === 0) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    // Storm exposure lookup — Phase 4c indexed table, falls back to blob.
    type ExposureEntry = {
      customer?: string; addressLine1?: string;
      allStorms?: Array<{ date?: string; type?: string; mag?: number; unit?: string; distance?: number }>;
    };
    let exposure: ExposureEntry | null = null;
    const expKey = `${keyCustomer}|${keyAddr}`;
    try {
      const rows = await pgSql<Array<{ data: ExposureEntry }>>`
        SELECT data FROM intel_customer_exposure WHERE key = ${expKey} LIMIT 1
      `;
      if (rows.length > 0) exposure = rows[0].data;
    } catch { /* fall through to blob */ }
    if (exposure === null) {
      try {
        const rows = await pgSql<Array<{ data: ExposureEntry[] }>>`
          SELECT data FROM intel_blobs WHERE key = 'storm-exposure' LIMIT 1
        `;
        const blob = Array.isArray(rows[0]?.data) ? rows[0].data : [];
        exposure = blob.find((e) =>
          (e.customer || '').trim().toLowerCase() === keyCustomer &&
          (e.addressLine1 || '').trim().toLowerCase() === keyAddr
        ) || null;
      } catch { /* exposure stays null */ }
    }

    // Map rows to camelCase shape the page expects.
    const jobs = jobRows.map((r) => ({
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
      salesRep: r.sales_rep,
      stage: r.stage,
      jobType: r.job_type,
      signedDate: r.signed_date,
      completedDate: r.completed_date,
      jobTotal: r.job_total != null ? num(r.job_total) : null,
      customerEmail: r.customer_email,
      customerCell: r.customer_cell,
      customerHome: r.customer_home,
      trades: Array.isArray(r.trades) ? r.trades : [],
    }));

    res.json({
      jobs,
      exposure,
      took_ms: Date.now() - t0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'customer_deep_failed', message: msg });
  }
}

/* ============================================================================
 * /api/intel/ops-team-summary?role=projectCoordinator
 * ----------------------------------------------------------------------------
 *  Per-(projectCoordinator|estimator|fieldTechId) rollup. Role-keyed list for
 *  ops-team.html left pane.
 * ========================================================================= */
const OPS_ROLES = new Set(['projectCoordinator', 'estimator', 'fieldTechId']);
export async function opsTeamSummary(req: Request, res: Response) {
  const t0 = Date.now();
  const role = String(req.query.role ?? 'projectCoordinator');
  if (!OPS_ROLES.has(role)) {
    res.status(400).json({ error: 'invalid_role', allowed: [...OPS_ROLES] });
    return;
  }

  try {
    // Promote the role JSONB field to a column via subquery so GROUP BY can
    // reference it by name (Postgres can't match identical parameterized
    // expressions across SELECT/WHERE/GROUP BY).
    const rows = await pgSql<Array<{
      name: string;
      signed: number;
      completed: number;
      dead: number;
      revenue: number;
    }>>`
      SELECT
        person AS name,
        COUNT(*)::int AS signed,
        COUNT(*) FILTER (WHERE stage ~* 'completed|finalized')::int AS completed,
        COUNT(*) FILTER (WHERE stage ~* 'dead|cancel')::int AS dead,
        COALESCE(SUM(job_total) FILTER (WHERE stage ~* 'completed|finalized'), 0)::numeric AS revenue
        FROM (
          SELECT data->>${role} AS person, stage, job_total
            FROM intel_projects
        ) sub
       WHERE person IS NOT NULL AND person <> ''
       GROUP BY person
       ORDER BY COUNT(*) DESC
    `;
    const people = rows.map((r) => {
      const signed = num(r.signed);
      const completed = num(r.completed);
      const dead = num(r.dead);
      const revenue = num(r.revenue);
      return {
        name: r.name,
        signed, completed, dead, revenue,
        closeRate: completed + dead > 0 ? completed / (completed + dead) : 0,
        avgJob: completed > 0 ? revenue / completed : 0,
      };
    });
    res.json({ role, people, total: people.length, took_ms: Date.now() - t0 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'ops_team_summary_failed', message: msg });
  }
}

/* ============================================================================
 * /api/intel/ops-team-deep?role=projectCoordinator&key=John+Doe
 * ----------------------------------------------------------------------------
 *  Deep dive for one ops person. Returns city/carrier/rep/trade/zip rollups +
 *  median sign→complete days + 10 biggest jobs.
 * ========================================================================= */
export async function opsTeamDeep(req: Request, res: Response) {
  const t0 = Date.now();
  const role = String(req.query.role ?? 'projectCoordinator');
  const key = String(req.query.key ?? '').trim();
  if (!OPS_ROLES.has(role)) {
    res.status(400).json({ error: 'invalid_role', allowed: [...OPS_ROLES] });
    return;
  }
  if (!key) {
    res.status(400).json({ error: 'missing_key' });
    return;
  }

  try {
    const [
      summary,
      cityRows,
      carrierRows,
      repRows,
      tradeRows,
      zipRows,
      medianRows,
      bigJobs,
    ] = await Promise.all([
      pgSql<Array<{ signed: number; completed: number; dead: number; open: number; revenue: number }>>`
        SELECT
          COUNT(*)::int AS signed,
          COUNT(*) FILTER (WHERE stage ~* 'completed|finalized')::int AS completed,
          COUNT(*) FILTER (WHERE stage ~* 'dead|cancel')::int AS dead,
          COUNT(*) FILTER (WHERE NOT (stage ~* 'completed|finalized|dead|cancel'))::int AS open,
          COALESCE(SUM(job_total) FILTER (WHERE stage ~* 'completed|finalized'), 0)::numeric AS revenue
          FROM intel_projects WHERE data->>${role} = ${key}
      `,
      pgSql<Array<{ name: string; count: number }>>`
        SELECT city AS name, COUNT(*)::int AS count
          FROM intel_projects WHERE data->>${role} = ${key} AND city IS NOT NULL
         GROUP BY city ORDER BY COUNT(*) DESC LIMIT 8
      `,
      pgSql<Array<{ name: string; count: number }>>`
        SELECT insurance AS name, COUNT(*)::int AS count
          FROM intel_projects WHERE data->>${role} = ${key} AND insurance IS NOT NULL
         GROUP BY insurance ORDER BY COUNT(*) DESC LIMIT 8
      `,
      pgSql<Array<{ name: string; count: number }>>`
        SELECT sales_rep AS name, COUNT(*)::int AS count
          FROM intel_projects WHERE data->>${role} = ${key} AND sales_rep IS NOT NULL
         GROUP BY sales_rep ORDER BY COUNT(*) DESC LIMIT 8
      `,
      pgSql<Array<{ name: string; count: number }>>`
        SELECT trade AS name, COUNT(*)::int AS count
          FROM intel_projects,
               jsonb_array_elements_text(COALESCE(data->'trades', '[]'::jsonb)) AS trade
         WHERE data->>${role} = ${key}
         GROUP BY trade ORDER BY COUNT(*) DESC LIMIT 8
      `,
      pgSql<Array<{ name: string; count: number }>>`
        SELECT LEFT(zip, 5) AS name, COUNT(*)::int AS count
          FROM intel_projects WHERE data->>${role} = ${key} AND zip IS NOT NULL AND LENGTH(zip) >= 5
         GROUP BY LEFT(zip, 5) ORDER BY COUNT(*) DESC LIMIT 8
      `,
      pgSql<Array<{ med_complete: number | null }>>`
        SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (
          ORDER BY NULLIF(data->>'daysToComplete','')::int
        ) FILTER (
          WHERE NULLIF(data->>'daysToComplete','')::int BETWEEN 0 AND 729
        )::numeric AS med_complete
          FROM intel_projects WHERE data->>${role} = ${key}
      `,
      pgSql<Array<{
        customer: string | null; address_line1: string | null; city: string | null;
        state: string | null; stage: string | null; signed_date: string | null; job_total: number | null;
      }>>`
        SELECT customer, address_line1, city, state, stage, signed_date, job_total
          FROM intel_projects WHERE data->>${role} = ${key} AND job_total > 0
         ORDER BY job_total DESC NULLS LAST LIMIT 10
      `,
    ]);

    const s = summary[0] ?? { signed: 0, completed: 0, dead: 0, open: 0, revenue: 0 };
    const med = medianRows[0]?.med_complete;

    res.json({
      summary: {
        signed: num(s.signed),
        completed: num(s.completed),
        dead: num(s.dead),
        open: num(s.open),
        revenue: num(s.revenue),
      },
      cities: cityRows.map((r) => ({ name: r.name, count: num(r.count) })),
      carriers: carrierRows.map((r) => ({ name: r.name, count: num(r.count) })),
      reps: repRows.map((r) => ({ name: r.name, count: num(r.count) })),
      trades: tradeRows.map((r) => ({ name: r.name, count: num(r.count) })),
      zips: zipRows.map((r) => ({ name: r.name, count: num(r.count) })),
      medianCompleteDays: med != null ? Math.round(num(med)) : null,
      bigJobs: bigJobs.map((j) => ({
        customer: j.customer,
        addressLine1: j.address_line1,
        city: j.city,
        state: j.state,
        stage: j.stage,
        signedDate: j.signed_date,
        jobTotal: j.job_total != null ? num(j.job_total) : null,
      })),
      took_ms: Date.now() - t0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'ops_team_deep_failed', message: msg });
  }
}

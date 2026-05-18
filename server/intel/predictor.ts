/**
 * Phase 6: lead score predictor.
 *
 * v1 is a transparent SQL-driven heuristic — given a lead's features, look up
 * historical close rates from intel_projects and combine into a probability.
 * Each contributing factor is returned independently so the response shape
 * matches what a SHAP-instrumented XGBoost model would output: callers see
 * which factors moved the needle and by how much.
 *
 * The interface is stable. When we train an XGBoost model later, we swap the
 * core computeScore() function for ONNX inference — the API shape doesn't
 * change.
 *
 *   GET  /api/intel/predictor/score   — query-param scoring (rep self-serve)
 *   POST /api/intel/predictor/webhook — JSON POST for CC21 to call on new lead
 *
 * Both handlers call the same internal `computeScore()`.
 */
import { type Request, type Response } from 'express';
import { sql as pgSql } from '../db.js';
import { normalizeCarrier } from './carrier-normalize.mjs';
import { getComplaintIndex } from './naic-complaints.js';

const num = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/* ============================================================================
 * Feature types
 * ========================================================================= */
export type LeadFeatures = {
  lat?: number;
  lng?: number;
  zip?: string;
  state?: string;
  city?: string;
  carrier?: string;
  adjusterName?: string;
  leadSource?: string;
  salesRep?: string;
  // Storm features (if known)
  stormType?: string;          // 'HAIL' | 'WIND' | 'TORNADO'
  stormMagnitude?: number;     // hail inches or wind mph
  stormUnit?: string;
  daysFromLossToStorm?: number; // days between damage date and matched storm
  stormDistanceMiles?: number;
  // Job features
  daysSinceLoss?: number;       // age of the lead in days
  jobType?: string;             // 'Insurance' | 'Retail'
};

export type Factor = {
  name: string;
  value: string;
  // The raw close rate used (0..1) and the sample size behind it.
  rate?: number;
  n?: number;
  // Contribution to the final score (-50 .. +50, expressed as percentage points).
  contribution: number;
  direction: 'up' | 'down' | 'neutral';
};

export type ScoreResult = {
  score: number;             // 0-100
  probability: number;       // 0-1
  confidence: 'low' | 'medium' | 'high';
  baseRate: number;          // historical baseline before factors
  factors: Factor[];
  recommendations: string[];
  modelVersion: string;
  computedAt: string;
  tookMs: number;
};

/* ============================================================================
 * Core scoring
 *
 * Each factor's `rate` is its empirical close rate (completed / (completed +
 * dead)) for the matched bucket — matches the Field Portal's Approval Rate.
 * We start with the global base rate, then nudge toward each factor's rate
 * weighted by sample-size confidence + a hardcoded factor weight.
 *
 * Sample-size confidence: 1 - exp(-n/30). For n=30 → ~63% weight. For n=100 →
 * ~96%. Tiny buckets (n<3) ignored.
 * ========================================================================= */

const FACTOR_WEIGHTS: Record<string, number> = {
  carrier_zip:     0.30,  // strongest signal when we have it
  carrier_state:   0.15,  // fallback for carrier+state when no zip match
  carrier_overall: 0.08,  // last resort for carrier
  adjuster:        0.20,  // adjuster identity > damage per industry research
  rep_carrier:     0.10,  // rep's track record with this carrier
  rep_overall:     0.06,  // fallback for rep alone
  lead_source:     0.05,
  zip_overall:     0.10,  // zip baseline (no carrier)
  storm_match:     0.18,  // hail magnitude + days since
  naic_complaint:  0.08,  // industry-wide carrier reputation (NAIC index)
};

function confidenceWeight(n: number): number {
  if (n < 3) return 0;
  return 1 - Math.exp(-n / 30);
}

export async function computeScore(features: LeadFeatures): Promise<ScoreResult> {
  const t0 = Date.now();
  const carrier = features.carrier ? normalizeCarrier(features.carrier) : null;
  const zip5 = features.zip ? features.zip.slice(0, 5) : null;
  const state = features.state?.toUpperCase() || null;
  const adjuster = features.adjusterName?.trim() || null;
  const rep = features.salesRep?.trim() || null;
  const leadSource = features.leadSource?.trim() || null;

  // Base rate: completed / (completed + dead) — matches Field Portal Approval Rate.
  // Run all lookups in parallel.
  const [
    baseRow,
    carrierZipRow,
    carrierStateRow,
    carrierAllRow,
    adjusterRow,
    repCarrierRow,
    repAllRow,
    leadSourceRow,
    zipAllRow,
  ] = await Promise.all([
    pgSql<Array<{ rate: number | null; n: number }>>`
      SELECT
        (COUNT(*) FILTER (WHERE stage ~* 'completed|finalized'))::numeric
          / NULLIF((COUNT(*) FILTER (WHERE stage ~* 'completed|finalized|dead|cancel')), 0) AS rate,
        COUNT(*)::int AS n
        FROM intel_projects
    `,
    carrier && zip5 ? pgSql<Array<{ rate: number | null; n: number }>>`
      SELECT
        (COUNT(*) FILTER (WHERE stage ~* 'completed|finalized'))::numeric
          / NULLIF((COUNT(*) FILTER (WHERE stage ~* 'completed|finalized|dead|cancel')), 0) AS rate,
        COUNT(*)::int AS n
        FROM intel_projects WHERE insurance = ${carrier} AND LEFT(zip,5) = ${zip5}
    ` : Promise.resolve([{ rate: null, n: 0 }]),
    carrier && state ? pgSql<Array<{ rate: number | null; n: number }>>`
      SELECT
        (COUNT(*) FILTER (WHERE stage ~* 'completed|finalized'))::numeric
          / NULLIF((COUNT(*) FILTER (WHERE stage ~* 'completed|finalized|dead|cancel')), 0) AS rate,
        COUNT(*)::int AS n
        FROM intel_projects WHERE insurance = ${carrier} AND state = ${state}
    ` : Promise.resolve([{ rate: null, n: 0 }]),
    carrier ? pgSql<Array<{ rate: number | null; n: number }>>`
      SELECT
        (COUNT(*) FILTER (WHERE stage ~* 'completed|finalized'))::numeric
          / NULLIF((COUNT(*) FILTER (WHERE stage ~* 'completed|finalized|dead|cancel')), 0) AS rate,
        COUNT(*)::int AS n
        FROM intel_projects WHERE insurance = ${carrier}
    ` : Promise.resolve([{ rate: null, n: 0 }]),
    adjuster ? pgSql<Array<{ rate: number | null; n: number }>>`
      SELECT
        (COUNT(*) FILTER (WHERE stage ~* 'completed|finalized'))::numeric
          / NULLIF((COUNT(*) FILTER (WHERE stage ~* 'completed|finalized|dead|cancel')), 0) AS rate,
        COUNT(*)::int AS n
        FROM intel_projects
       WHERE LOWER(TRIM(adjuster_name)) = LOWER(${adjuster})
         ${carrier ? pgSql`AND insurance = ${carrier}` : pgSql``}
    ` : Promise.resolve([{ rate: null, n: 0 }]),
    rep && carrier ? pgSql<Array<{ rate: number | null; n: number }>>`
      SELECT
        (COUNT(*) FILTER (WHERE stage ~* 'completed|finalized'))::numeric
          / NULLIF((COUNT(*) FILTER (WHERE stage ~* 'completed|finalized|dead|cancel')), 0) AS rate,
        COUNT(*)::int AS n
        FROM intel_projects WHERE TRIM(sales_rep) = ${rep} AND insurance = ${carrier}
    ` : Promise.resolve([{ rate: null, n: 0 }]),
    rep ? pgSql<Array<{ rate: number | null; n: number }>>`
      SELECT
        (COUNT(*) FILTER (WHERE stage ~* 'completed|finalized'))::numeric
          / NULLIF((COUNT(*) FILTER (WHERE stage ~* 'completed|finalized|dead|cancel')), 0) AS rate,
        COUNT(*)::int AS n
        FROM intel_projects WHERE TRIM(sales_rep) = ${rep}
    ` : Promise.resolve([{ rate: null, n: 0 }]),
    leadSource ? pgSql<Array<{ rate: number | null; n: number }>>`
      SELECT
        (COUNT(*) FILTER (WHERE stage ~* 'completed|finalized'))::numeric
          / NULLIF((COUNT(*) FILTER (WHERE stage ~* 'completed|finalized|dead|cancel')), 0) AS rate,
        COUNT(*)::int AS n
        FROM intel_projects WHERE lead_source = ${leadSource}
    ` : Promise.resolve([{ rate: null, n: 0 }]),
    zip5 ? pgSql<Array<{ rate: number | null; n: number }>>`
      SELECT
        (COUNT(*) FILTER (WHERE stage ~* 'completed|finalized'))::numeric
          / NULLIF((COUNT(*) FILTER (WHERE stage ~* 'completed|finalized|dead|cancel')), 0) AS rate,
        COUNT(*)::int AS n
        FROM intel_projects WHERE LEFT(zip,5) = ${zip5}
    ` : Promise.resolve([{ rate: null, n: 0 }]),
  ]);

  const baseRate = num(baseRow[0]?.rate ?? 0.72);
  const factors: Factor[] = [];
  let blendedRate = baseRate;
  let totalWeightApplied = 0;

  function applyFactor(
    name: string,
    valueLabel: string,
    weightKey: keyof typeof FACTOR_WEIGHTS,
    row: { rate: number | null; n: number } | undefined,
  ): void {
    if (!row || row.rate == null || row.n < 3) return;
    const r = num(row.rate);
    const n = num(row.n);
    const w = FACTOR_WEIGHTS[weightKey] * confidenceWeight(n);
    if (w <= 0) return;
    const delta = (r - baseRate) * w;
    blendedRate += delta;
    totalWeightApplied += w;
    factors.push({
      name,
      value: valueLabel + ` · ${(r * 100).toFixed(0)}% over ${n.toLocaleString()} jobs`,
      rate: r,
      n,
      contribution: Math.round(delta * 100),
      direction: delta > 0.005 ? 'up' : delta < -0.005 ? 'down' : 'neutral',
    });
  }

  applyFactor(
    'Carrier × ZIP',
    carrier && zip5 ? `${carrier} in ${zip5}` : '',
    'carrier_zip',
    carrierZipRow[0],
  );
  applyFactor(
    'Carrier × State',
    carrier && state ? `${carrier} in ${state}` : '',
    'carrier_state',
    carrierStateRow[0],
  );
  applyFactor(
    'Carrier overall',
    carrier ?? '',
    'carrier_overall',
    carrierAllRow[0],
  );
  applyFactor(
    'Adjuster',
    adjuster ? (carrier ? `${adjuster} @ ${carrier}` : adjuster) : '',
    'adjuster',
    adjusterRow[0],
  );
  applyFactor(
    'Rep × Carrier',
    rep && carrier ? `${rep} working ${carrier}` : '',
    'rep_carrier',
    repCarrierRow[0],
  );
  applyFactor(
    'Rep overall',
    rep ?? '',
    'rep_overall',
    repAllRow[0],
  );
  applyFactor(
    'Lead source',
    leadSource ?? '',
    'lead_source',
    leadSourceRow[0],
  );
  applyFactor(
    'ZIP baseline',
    zip5 ?? '',
    'zip_overall',
    zipAllRow[0],
  );

  // NAIC complaint index — industry-wide carrier reputation, Indiana 2022.
  // Centered at 1.0 = average. Index 0.5 → carrier is better than average →
  // small upward nudge. Index 2.0 → worse than average → small downward nudge.
  // Scaled so a 0.5 swing from 1.0 = +/- 8 percentage points at max weight.
  if (carrier) {
    const ci = getComplaintIndex(carrier);
    if (ci && ci.index != null) {
      // Map index to a [-0.15, +0.15] delta vs baseRate:
      //   index 0.25 (excellent) → +0.12
      //   index 0.50 (good)      → +0.08
      //   index 1.00 (average)   → 0
      //   index 1.50 (bad)       → -0.08
      //   index 2.50 (outlier)   → -0.15 (capped)
      const delta = Math.max(-0.15, Math.min(0.15, (1 - ci.index) * 0.16));
      const w = FACTOR_WEIGHTS.naic_complaint;
      const contributionBoost = delta * w;
      blendedRate += contributionBoost;
      totalWeightApplied += w;
      factors.push({
        name: 'NAIC complaint index',
        value: `${carrier} · ${ci.index!.toFixed(2)} (${ci.rating})`,
        rate: 1 - ci.index!,
        contribution: Math.round(contributionBoost * 100),
        direction: contributionBoost > 0.005 ? 'up' : contributionBoost < -0.005 ? 'down' : 'neutral',
      });
    }
  }

  // Storm features — direct heuristic, no historical lookup.
  if (features.stormMagnitude != null && features.stormType === 'HAIL') {
    const h = features.stormMagnitude;
    let stormBoost = 0;
    let stormLabel = `${h}" hail`;
    if (h >= 1.75) { stormBoost = 0.18; stormLabel += ' (very large)'; }
    else if (h >= 1.25) { stormBoost = 0.12; stormLabel += ' (large)'; }
    else if (h >= 1.0) { stormBoost = 0.06; stormLabel += ' (mid)'; }
    else if (h >= 0.75) { stormBoost = 0.02; stormLabel += ' (small)'; }
    else { stormBoost = -0.02; stormLabel += ' (sub-threshold)'; }

    // Distance penalty
    const d = features.stormDistanceMiles;
    if (d != null) {
      if (d <= 0.5) stormLabel += `, ${d.toFixed(1)} mi (direct)`;
      else if (d <= 1.5) { stormBoost *= 0.7; stormLabel += `, ${d.toFixed(1)} mi (near)`; }
      else if (d <= 3) { stormBoost *= 0.4; stormLabel += `, ${d.toFixed(1)} mi (far)`; }
      else { stormBoost *= 0.2; stormLabel += `, ${d.toFixed(1)} mi (distant)`; }
    }

    // Recency penalty (older storms close worse).
    const dsl = features.daysSinceLoss ?? null;
    if (dsl != null) {
      if (dsl > 540) { stormBoost *= 0.3; stormLabel += `, ${dsl}d stale`; }
      else if (dsl > 365) { stormBoost *= 0.6; stormLabel += `, ${dsl}d ago`; }
      else if (dsl > 180) { stormBoost *= 0.85; stormLabel += `, ${dsl}d ago`; }
      else { stormLabel += `, ${dsl}d ago (fresh)`; }
    }

    const w = FACTOR_WEIGHTS.storm_match;
    const delta = stormBoost * w;
    blendedRate += delta;
    totalWeightApplied += w;
    factors.push({
      name: 'Storm match',
      value: stormLabel,
      contribution: Math.round(delta * 100),
      direction: delta > 0.005 ? 'up' : delta < -0.005 ? 'down' : 'neutral',
    });
  }

  // Clamp
  const probability = Math.max(0.05, Math.min(0.95, blendedRate));
  const score = Math.round(probability * 100);

  // Confidence: based on cumulative sample size + total weight applied
  const totalSampleSize = factors.reduce((s, f) => s + (f.n ?? 0), 0);
  let confidence: ScoreResult['confidence'] = 'low';
  if (totalSampleSize >= 200 && totalWeightApplied >= 0.4) confidence = 'high';
  else if (totalSampleSize >= 50) confidence = 'medium';

  // Recommendations — pull strongest factor + tactical hooks
  const recommendations: string[] = [];
  const upFactors = factors.filter((f) => f.direction === 'up').sort((a, b) => b.contribution - a.contribution);
  const downFactors = factors.filter((f) => f.direction === 'down').sort((a, b) => a.contribution - b.contribution);

  if (upFactors.length > 0) {
    const top = upFactors[0];
    recommendations.push(`Strongest signal: ${top.name} — ${top.value}. Lean into this in your opener.`);
  }
  if (downFactors.length > 0) {
    const worst = downFactors[0];
    recommendations.push(`Watch out: ${worst.name} — ${worst.value}. Pre-empt with extra documentation.`);
  }
  if (features.stormType === 'HAIL' && (features.stormMagnitude || 0) >= 1.0 && (features.daysSinceLoss || 999) < 180) {
    recommendations.push(`Fresh ${features.stormMagnitude}" hail event — frame the conversation around the specific storm date.`);
  }
  if (carrier && (carrierZipRow[0]?.n ?? 0) >= 10) {
    recommendations.push(`We've signed ${carrierZipRow[0]!.n} ${carrier} jobs in ${zip5} — drop that as social proof.`);
  }
  if (probability < 0.4) {
    recommendations.push(`Score is low — gate carefully. Don't burn rep capital unless you have storm + adjuster intel locked in.`);
  }

  return {
    score,
    probability,
    confidence,
    baseRate,
    factors,
    recommendations,
    modelVersion: 'heuristic-v1',
    computedAt: new Date().toISOString(),
    tookMs: Date.now() - t0,
  };
}

/* ============================================================================
 * Handlers
 * ========================================================================= */

function featuresFromQuery(q: Record<string, string | undefined>): LeadFeatures {
  const numOr = (s: string | undefined): number | undefined => {
    if (s == null) return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    lat: numOr(q.lat),
    lng: numOr(q.lng),
    zip: q.zip?.trim(),
    state: q.state?.trim()?.toUpperCase(),
    city: q.city?.trim(),
    carrier: q.carrier?.trim(),
    adjusterName: q.adjuster?.trim(),
    leadSource: q.lead_source?.trim(),
    salesRep: q.rep?.trim(),
    stormType: q.storm_type?.trim()?.toUpperCase(),
    stormMagnitude: numOr(q.storm_mag),
    stormUnit: q.storm_unit?.trim(),
    stormDistanceMiles: numOr(q.storm_distance),
    daysFromLossToStorm: numOr(q.days_loss_to_storm),
    daysSinceLoss: numOr(q.days_since_loss),
    jobType: q.job_type?.trim(),
  };
}

export async function predictorScore(req: Request, res: Response) {
  try {
    const features = featuresFromQuery(req.query as Record<string, string | undefined>);
    const result = await computeScore(features);
    res.json({ ...result, echoFeatures: features });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'predictor_score_failed', message: msg });
  }
}

/* ============================================================================
 * /api/intel/predictor/webhook  — POST endpoint for CC21 lead pipeline
 *
 * Body: { lead: {...feature shape...}, source?: 'cc21' }
 * Returns the same ScoreResult shape. Logs the call for audit.
 * ========================================================================= */
export async function predictorWebhook(req: Request, res: Response) {
  const body = req.body ?? {};
  const lead = body.lead ?? body;  // accept either { lead: {...} } or top-level
  const source = body.source ?? 'unknown';
  if (typeof lead !== 'object') {
    res.status(400).json({ error: 'missing_lead_object' });
    return;
  }
  try {
    const features: LeadFeatures = {
      lat: typeof lead.lat === 'number' ? lead.lat : undefined,
      lng: typeof lead.lng === 'number' ? lead.lng : undefined,
      zip: typeof lead.zip === 'string' ? lead.zip : undefined,
      state: typeof lead.state === 'string' ? lead.state : undefined,
      city: typeof lead.city === 'string' ? lead.city : undefined,
      carrier: typeof lead.carrier === 'string' ? lead.carrier
              : typeof lead.insurance === 'string' ? lead.insurance : undefined,
      adjusterName: typeof lead.adjusterName === 'string' ? lead.adjusterName
                  : typeof lead.adjuster_name === 'string' ? lead.adjuster_name : undefined,
      leadSource: typeof lead.leadSource === 'string' ? lead.leadSource
                : typeof lead.lead_source === 'string' ? lead.lead_source : undefined,
      salesRep: typeof lead.salesRep === 'string' ? lead.salesRep
              : typeof lead.sales_rep === 'string' ? lead.sales_rep
              : typeof lead.rep === 'string' ? lead.rep : undefined,
      stormType: typeof lead.stormType === 'string' ? lead.stormType : undefined,
      stormMagnitude: typeof lead.stormMagnitude === 'number' ? lead.stormMagnitude : undefined,
      stormUnit: typeof lead.stormUnit === 'string' ? lead.stormUnit : undefined,
      stormDistanceMiles: typeof lead.stormDistanceMiles === 'number' ? lead.stormDistanceMiles : undefined,
      daysSinceLoss: typeof lead.daysSinceLoss === 'number' ? lead.daysSinceLoss : undefined,
      jobType: typeof lead.jobType === 'string' ? lead.jobType : undefined,
    };
    const result = await computeScore(features);
    console.log(`[predictor] webhook source=${source} carrier=${features.carrier ?? '-'} zip=${features.zip ?? '-'} → score=${result.score}`);
    res.json({ ...result, echoFeatures: features, source });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'predictor_webhook_failed', message: msg });
  }
}

/**
 * RIQ 21 Denial Intake — durable storage for every denial that flows through
 * the analyzer, plus outcome tracking so we eventually learn which counter-letter
 * strategies actually flip denials.
 *
 * Tables:
 *   denial_intake — one row per analyzed denial (text, carrier, adjuster, AI analysis)
 *   denial_outcomes — outcome marking (approved/partial/denied/pending) + freeform notes
 *
 * The few-shot prompting in denial-analyzer.ts will eventually be wired to read
 * from denial_intake (in addition to denial-corpus.json), so user-submitted
 * denials with confirmed outcomes will start guiding new analyses automatically.
 */
import type { Request, Response } from 'express';
import { sql as pgSql } from '../db.js';
import { consumerLabel } from './auth.js';
import { normalizeCarrier } from './carrier-normalize.mjs';

export async function ensureIntakeTables(): Promise<void> {
  await pgSql`
    CREATE TABLE IF NOT EXISTS denial_intake (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      consumer TEXT,
      carrier TEXT,
      identified_carrier TEXT,
      identified_adjuster TEXT,
      claim_number TEXT,
      denial_date TEXT,
      denial_category TEXT,
      appeal_strength TEXT,
      denial_text TEXT NOT NULL,
      analysis JSONB NOT NULL,
      patents_considered TEXT[],
      corpus_examples_used JSONB,
      letter_hash TEXT
    )
  `;
  await pgSql`CREATE INDEX IF NOT EXISTS denial_intake_created_idx ON denial_intake(created_at DESC)`;
  await pgSql`CREATE INDEX IF NOT EXISTS denial_intake_carrier_idx ON denial_intake(carrier)`;
  await pgSql`CREATE INDEX IF NOT EXISTS denial_intake_hash_idx ON denial_intake(letter_hash)`;

  // Phase 5 (V2 roadmap): A/B stance variant on the counter-letter draft.
  // Set per analysis so denial-stats can rank flip-rate by carrier × stance.
  // Partial index keeps it cheap while legacy rows are NULL.
  await pgSql`ALTER TABLE denial_intake ADD COLUMN IF NOT EXISTS stance_variant TEXT`;
  await pgSql`CREATE INDEX IF NOT EXISTS denial_intake_stance_idx ON denial_intake(stance_variant) WHERE stance_variant IS NOT NULL`;

  await pgSql`
    CREATE TABLE IF NOT EXISTS denial_outcomes (
      id BIGSERIAL PRIMARY KEY,
      intake_id BIGINT REFERENCES denial_intake(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      consumer TEXT,
      outcome TEXT NOT NULL,
      outcome_date DATE,
      counter_sent BOOLEAN DEFAULT FALSE,
      counter_sent_at TIMESTAMPTZ,
      notes TEXT
    )
  `;
  await pgSql`CREATE INDEX IF NOT EXISTS denial_outcomes_intake_idx ON denial_outcomes(intake_id)`;

  // Idempotent boot-time backfill: any row whose carrier/identified_carrier
  // doesn't equal its canonical form gets rewritten. Runs once per boot;
  // skips rows that already match canonical (cheap no-op).
  try {
    const rows = await pgSql<Array<{ id: number; carrier: string | null; identified_carrier: string | null }>>`
      SELECT id, carrier, identified_carrier FROM denial_intake
    `;
    let fixed = 0;
    for (const r of rows) {
      const newCarrier = normalizeCarrier(r.carrier);
      const newIdent = normalizeCarrier(r.identified_carrier);
      const carrierChanged = newCarrier && newCarrier !== r.carrier;
      const identChanged = newIdent && newIdent !== r.identified_carrier;
      if (!carrierChanged && !identChanged) continue;
      await pgSql`
        UPDATE denial_intake
        SET carrier = ${carrierChanged ? newCarrier : r.carrier},
            identified_carrier = ${identChanged ? newIdent : r.identified_carrier}
        WHERE id = ${r.id}
      `;
      fixed += 1;
    }
    if (fixed > 0) console.log(`[denial-intake] boot backfill normalized ${fixed} legacy carrier strings`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.warn('[denial-intake] boot backfill skipped:', msg);
  }
}

function hashLetter(text: string): string {
  // Cheap content hash for dedupe — caller already validated > 50 chars
  let h = 0;
  const slice = text.slice(0, 4000);
  for (let i = 0; i < slice.length; i++) {
    h = ((h << 5) - h + slice.charCodeAt(i)) | 0;
  }
  return `h${Math.abs(h)}_${slice.length}`;
}

/** Internal — called from denial-analyzer after a successful analysis. */
export async function recordIntake(req: Request, args: {
  carrier: string;
  denialText: string;
  analysis: Record<string, unknown>;
  patentsConsidered: string[];
  corpusExamplesUsed: Array<{ id: string; source: string; carrier: string | null }>;
  stanceVariant?: string | null;
}): Promise<number | null> {
  try {
    const letterHash = hashLetter(args.denialText);
    // Avoid duplicate inserts when the same letter is re-analyzed
    const existing = await pgSql<Array<{ id: number }>>`
      SELECT id FROM denial_intake WHERE letter_hash = ${letterHash} LIMIT 1
    `;
    if (existing.length > 0) return existing[0].id;

    const a = args.analysis as Record<string, unknown>;
    // Normalize carriers BEFORE insert so all future submissions share canonical
    // grouping keys — fixes the per-carrier win-rate split caused by variants
    // like "Allstate Indemnity Company" vs "Allstate".
    const canonicalCarrier = normalizeCarrier(args.carrier) || args.carrier || null;
    const canonicalIdentified = normalizeCarrier(a.identifiedCarrier as string) || (a.identifiedCarrier as string) || null;
    // postgres.js v3 rejects raw objects/arrays for JSONB bindings —
    // see feedback_postgres-js-sql-json memory. Use JSON.stringify + ::jsonb.
    const rows = await pgSql<Array<{ id: number }>>`
      INSERT INTO denial_intake (
        consumer, carrier, identified_carrier, identified_adjuster,
        claim_number, denial_date, denial_category, appeal_strength,
        denial_text, analysis, patents_considered, corpus_examples_used, letter_hash,
        stance_variant
      ) VALUES (
        ${consumerLabel(req)},
        ${canonicalCarrier},
        ${canonicalIdentified},
        ${(a.identifiedAdjuster as string) || null},
        ${(a.claimNumber as string) || null},
        ${(a.denialDateGuess as string) || null},
        ${pickPrimaryCategory(a)},
        ${(a.appealStrength as string) || null},
        ${args.denialText},
        ${JSON.stringify(args.analysis)}::jsonb,
        ${args.patentsConsidered as unknown as string[]},
        ${JSON.stringify(args.corpusExamplesUsed)}::jsonb,
        ${letterHash},
        ${args.stanceVariant ?? null}
      )
      RETURNING id
    `;
    return rows[0]?.id ?? null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.warn('[denial-intake] insert failed:', msg);
    return null;
  }
}

function pickPrimaryCategory(a: Record<string, unknown>): string | null {
  const reasons = a.denialReasons as Array<{ category?: string }> | undefined;
  if (!reasons || !Array.isArray(reasons) || reasons.length === 0) return null;
  return reasons[0]?.category || null;
}

/** GET /api/intel/denial-intake/list — recent denials for the archive view */
export async function listIntake(req: Request, res: Response): Promise<void> {
  const limit = Math.min(Number(req.query.limit || 50), 200);
  const carrierFilter = (req.query.carrier as string || '').trim();
  try {
    const rows = carrierFilter
      ? await pgSql<Array<Record<string, unknown>>>`
          SELECT di.id, di.created_at, di.carrier, di.identified_carrier,
                 di.identified_adjuster, di.claim_number, di.denial_date,
                 di.denial_category, di.appeal_strength, di.letter_hash,
                 di.stance_variant,
                 substring(di.denial_text, 1, 400) AS preview,
                 (SELECT outcome FROM denial_outcomes o WHERE o.intake_id = di.id ORDER BY o.created_at DESC LIMIT 1) AS latest_outcome,
                 (SELECT created_at FROM denial_outcomes o WHERE o.intake_id = di.id ORDER BY o.created_at DESC LIMIT 1) AS latest_outcome_at
          FROM denial_intake di
          WHERE di.carrier ILIKE ${'%' + carrierFilter + '%'}
             OR di.identified_carrier ILIKE ${'%' + carrierFilter + '%'}
          ORDER BY di.created_at DESC
          LIMIT ${limit}
        `
      : await pgSql<Array<Record<string, unknown>>>`
          SELECT di.id, di.created_at, di.carrier, di.identified_carrier,
                 di.identified_adjuster, di.claim_number, di.denial_date,
                 di.denial_category, di.appeal_strength, di.letter_hash,
                 di.stance_variant,
                 substring(di.denial_text, 1, 400) AS preview,
                 (SELECT outcome FROM denial_outcomes o WHERE o.intake_id = di.id ORDER BY o.created_at DESC LIMIT 1) AS latest_outcome,
                 (SELECT created_at FROM denial_outcomes o WHERE o.intake_id = di.id ORDER BY o.created_at DESC LIMIT 1) AS latest_outcome_at
          FROM denial_intake di
          ORDER BY di.created_at DESC
          LIMIT ${limit}
        `;
    res.json({ generated: new Date().toISOString(), count: rows.length, entries: rows });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown';
    res.status(500).json({ error: 'db_error', detail: msg });
  }
}

/** GET /api/intel/denial-intake/:id — full record */
export async function getIntake(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  try {
    const rows = await pgSql<Array<Record<string, unknown>>>`
      SELECT * FROM denial_intake WHERE id = ${id} LIMIT 1
    `;
    if (rows.length === 0) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const outcomes = await pgSql<Array<Record<string, unknown>>>`
      SELECT id, created_at, outcome, outcome_date, counter_sent, counter_sent_at, notes, consumer
      FROM denial_outcomes WHERE intake_id = ${id} ORDER BY created_at DESC
    `;
    res.json({ ...rows[0], outcomes });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown';
    res.status(500).json({ error: 'db_error', detail: msg });
  }
}

/** POST /api/intel/denial-intake/:id/outcome — mark outcome for an analyzed denial.
 *  Body: { outcome: 'approved'|'partial'|'denied'|'pending'|'withdrawn',
 *          outcomeDate?: 'YYYY-MM-DD', counterSent?: boolean, notes?: string } */
export async function postOutcome(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const body = req.body || {};
  const outcome = (body.outcome || '').toString();
  const valid = new Set(['approved', 'partial', 'denied', 'pending', 'withdrawn']);
  if (!valid.has(outcome)) {
    res.status(400).json({ error: 'invalid_outcome', allowed: Array.from(valid) });
    return;
  }
  try {
    const intake = await pgSql<Array<{ id: number }>>`SELECT id FROM denial_intake WHERE id = ${id} LIMIT 1`;
    if (intake.length === 0) {
      res.status(404).json({ error: 'intake_not_found' });
      return;
    }
    const counterSent = !!body.counterSent;
    const rows = await pgSql<Array<{ id: number; created_at: Date }>>`
      INSERT INTO denial_outcomes (intake_id, consumer, outcome, outcome_date, counter_sent, counter_sent_at, notes)
      VALUES (
        ${id},
        ${consumerLabel(req)},
        ${outcome},
        ${body.outcomeDate || null}::date,
        ${counterSent},
        ${counterSent ? new Date() : null},
        ${body.notes || null}
      )
      RETURNING id, created_at
    `;
    res.json({ ok: true, outcomeId: rows[0].id, createdAt: rows[0].created_at });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown';
    res.status(500).json({ error: 'db_error', detail: msg });
  }
}

/** GET /api/intel/denial-intake/stats — corpus stats for the dashboard.
 *  Carrier rollups happen in JS using the canonical normalizer so legacy rows
 *  with variant strings (e.g. "Allstate Indemnity Company") aggregate into
 *  their canonical bucket ("Allstate"). */
export async function intakeStats(_req: Request, res: Response): Promise<void> {
  try {
    const totals = await pgSql<Array<{ count: string }>>`SELECT COUNT(*)::text AS count FROM denial_intake`;

    // Pull raw rows + roll up in JS via the canonical normalizer.
    const rawByCarrier = await pgSql<Array<{ identified_carrier: string | null; carrier: string | null }>>`
      SELECT identified_carrier, carrier FROM denial_intake
    `;
    const carrierCounts = new Map<string, number>();
    for (const r of rawByCarrier) {
      const raw = r.identified_carrier || r.carrier || '(unknown)';
      const canonical = normalizeCarrier(raw) || raw;
      carrierCounts.set(canonical, (carrierCounts.get(canonical) || 0) + 1);
    }
    const byCarrier = [...carrierCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([carrier, count]) => ({ carrier, count }));

    const byOutcome = await pgSql<Array<{ outcome: string; n: string }>>`
      SELECT outcome, COUNT(*)::text AS n
      FROM denial_outcomes
      GROUP BY 1
      ORDER BY 2 DESC
    `;

    // Pull raw intake + latest outcome, roll up by canonical carrier in JS.
    const rawWinRows = await pgSql<Array<{ identified_carrier: string | null; carrier: string | null; outcome: string }>>`
      SELECT
        di.identified_carrier,
        di.carrier,
        lo.outcome
      FROM denial_intake di
      JOIN LATERAL (
        SELECT outcome FROM denial_outcomes
        WHERE intake_id = di.id
        ORDER BY created_at DESC LIMIT 1
      ) lo ON true
      WHERE lo.outcome IN ('approved','partial','denied')
    `;
    type Bucket = { total: number; approved: number; partial: number; denied: number };
    const winBuckets = new Map<string, Bucket>();
    for (const r of rawWinRows) {
      const raw = r.identified_carrier || r.carrier || '(unknown)';
      const canonical = normalizeCarrier(raw) || raw;
      const bucket = winBuckets.get(canonical) || { total: 0, approved: 0, partial: 0, denied: 0 };
      bucket.total += 1;
      if (r.outcome === 'approved') bucket.approved += 1;
      else if (r.outcome === 'partial') bucket.partial += 1;
      else if (r.outcome === 'denied') bucket.denied += 1;
      winBuckets.set(canonical, bucket);
    }
    const winRates = [...winBuckets.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .map(([carrier, b]) => ({
        carrier,
        total: b.total,
        approved: b.approved,
        partial: b.partial,
        denied: b.denied,
        flipRate: (b.approved + b.partial) / Math.max(1, b.total),
      }));

    // Stance rollup (V2 Phase 5 — A/B). Counts analyses by stance_variant +
    // joins to denial_outcomes to compute flip rate per stance. Sparse at first
    // (only analyses produced after the 2026-05-18 schema change have a variant).
    const stanceVolume = await pgSql<Array<{ stance_variant: string; n: string }>>`
      SELECT stance_variant, COUNT(*)::text AS n
      FROM denial_intake
      WHERE stance_variant IS NOT NULL
      GROUP BY stance_variant
    `;
    const stanceOutcomeRows = await pgSql<Array<{ stance_variant: string; outcome: string }>>`
      SELECT di.stance_variant, lo.outcome
      FROM denial_intake di
      JOIN LATERAL (
        SELECT outcome FROM denial_outcomes
        WHERE intake_id = di.id
        ORDER BY created_at DESC LIMIT 1
      ) lo ON true
      WHERE di.stance_variant IS NOT NULL
        AND lo.outcome IN ('approved','partial','denied')
    `;
    type StanceBucket = { total: number; approved: number; partial: number; denied: number };
    const stanceBuckets = new Map<string, StanceBucket>();
    for (const v of stanceVolume) {
      stanceBuckets.set(v.stance_variant, { total: 0, approved: 0, partial: 0, denied: 0 });
    }
    for (const r of stanceOutcomeRows) {
      const b = stanceBuckets.get(r.stance_variant) || { total: 0, approved: 0, partial: 0, denied: 0 };
      b.total += 1;
      if (r.outcome === 'approved') b.approved += 1;
      else if (r.outcome === 'partial') b.partial += 1;
      else if (r.outcome === 'denied') b.denied += 1;
      stanceBuckets.set(r.stance_variant, b);
    }
    const stanceRollup = [...stanceBuckets.entries()]
      .map(([stance, b]) => {
        const volumeRow = stanceVolume.find((v) => v.stance_variant === stance);
        const analyzed = Number(volumeRow?.n || 0);
        return {
          stance,
          analyzed,
          withOutcome: b.total,
          approved: b.approved,
          partial: b.partial,
          denied: b.denied,
          flipRate: b.total > 0 ? (b.approved + b.partial) / b.total : null,
        };
      })
      .sort((a, b) => b.analyzed - a.analyzed);

    // Carrier × stance heatmap (V2 roadmap). Sparse early — most cells will be
    // 0 until enough denials with stance_variant accumulate per carrier. Once
    // a cell has ≥3 outcomes the flipRate becomes meaningful + the UI shows
    // it as a coloured tile; below that it's just a count.
    const cxsRows = await pgSql<Array<{ stance_variant: string; identified_carrier: string | null; carrier: string | null; outcome: string }>>`
      SELECT di.stance_variant, di.identified_carrier, di.carrier, lo.outcome
      FROM denial_intake di
      JOIN LATERAL (
        SELECT outcome FROM denial_outcomes
        WHERE intake_id = di.id
        ORDER BY created_at DESC LIMIT 1
      ) lo ON true
      WHERE di.stance_variant IS NOT NULL
        AND lo.outcome IN ('approved','partial','denied')
    `;
    type CSBucket = { total: number; approved: number; partial: number; denied: number };
    const cxsMap = new Map<string, Map<string, CSBucket>>(); // carrier -> stance -> bucket
    for (const r of cxsRows) {
      const raw = r.identified_carrier || r.carrier || '(unknown)';
      const carrier = normalizeCarrier(raw) || raw || '(unknown)';
      if (!cxsMap.has(carrier)) cxsMap.set(carrier, new Map());
      const inner = cxsMap.get(carrier)!;
      const b = inner.get(r.stance_variant) || { total: 0, approved: 0, partial: 0, denied: 0 };
      b.total += 1;
      if (r.outcome === 'approved') b.approved += 1;
      else if (r.outcome === 'partial') b.partial += 1;
      else if (r.outcome === 'denied') b.denied += 1;
      inner.set(r.stance_variant, b);
    }
    const carrierStanceMatrix = [...cxsMap.entries()]
      .map(([carrier, stanceMap]) => {
        const cells: Record<string, { total: number; approved: number; partial: number; denied: number; flipRate: number | null } | null> = {};
        let carrierTotal = 0;
        let bestStance: string | null = null;
        let bestFlip = -1;
        for (const [stance, b] of stanceMap) {
          carrierTotal += b.total;
          const flipRate = (b.approved + b.partial) / Math.max(1, b.total);
          cells[stance] = { total: b.total, approved: b.approved, partial: b.partial, denied: b.denied, flipRate };
          if (b.total >= 3 && flipRate > bestFlip) {
            bestFlip = flipRate;
            bestStance = stance;
          }
        }
        return { carrier, totalOutcomes: carrierTotal, cells, recommendedStance: bestStance, recommendedFlipRate: bestStance ? bestFlip : null };
      })
      .sort((a, b) => b.totalOutcomes - a.totalOutcomes);

    res.json({
      total: Number(totals[0]?.count || 0),
      byCarrier,
      byOutcome: byOutcome.map((r) => ({ outcome: r.outcome, count: Number(r.n) })),
      winRates,
      stanceRollup,
      carrierStanceMatrix,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown';
    res.status(500).json({ error: 'db_error', detail: msg });
  }
}

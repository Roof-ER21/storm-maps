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
}): Promise<number | null> {
  try {
    const letterHash = hashLetter(args.denialText);
    // Avoid duplicate inserts when the same letter is re-analyzed
    const existing = await pgSql<Array<{ id: number }>>`
      SELECT id FROM denial_intake WHERE letter_hash = ${letterHash} LIMIT 1
    `;
    if (existing.length > 0) return existing[0].id;

    const a = args.analysis as Record<string, unknown>;
    const rows = await pgSql<Array<{ id: number }>>`
      INSERT INTO denial_intake (
        consumer, carrier, identified_carrier, identified_adjuster,
        claim_number, denial_date, denial_category, appeal_strength,
        denial_text, analysis, patents_considered, corpus_examples_used, letter_hash
      ) VALUES (
        ${consumerLabel(req)},
        ${args.carrier || null},
        ${(a.identifiedCarrier as string) || null},
        ${(a.identifiedAdjuster as string) || null},
        ${(a.claimNumber as string) || null},
        ${(a.denialDateGuess as string) || null},
        ${pickPrimaryCategory(a)},
        ${(a.appealStrength as string) || null},
        ${args.denialText},
        ${args.analysis}::jsonb,
        ${args.patentsConsidered},
        ${args.corpusExamplesUsed}::jsonb,
        ${letterHash}
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

/** GET /api/intel/denial-intake/stats — corpus stats for the dashboard */
export async function intakeStats(_req: Request, res: Response): Promise<void> {
  try {
    const totals = await pgSql<Array<{ count: string }>>`SELECT COUNT(*)::text AS count FROM denial_intake`;
    const byCarrier = await pgSql<Array<{ carrier: string | null; n: string }>>`
      SELECT COALESCE(identified_carrier, carrier, '(unknown)') AS carrier, COUNT(*)::text AS n
      FROM denial_intake
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 20
    `;
    const byOutcome = await pgSql<Array<{ outcome: string; n: string }>>`
      SELECT outcome, COUNT(*)::text AS n
      FROM denial_outcomes
      GROUP BY 1
      ORDER BY 2 DESC
    `;
    res.json({
      total: Number(totals[0]?.count || 0),
      byCarrier: byCarrier.map((r) => ({ carrier: r.carrier, count: Number(r.n) })),
      byOutcome: byOutcome.map((r) => ({ outcome: r.outcome, count: Number(r.n) })),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown';
    res.status(500).json({ error: 'db_error', detail: msg });
  }
}

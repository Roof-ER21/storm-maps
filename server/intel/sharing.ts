/**
 * Phase 5: short-code shareable lists.
 *
 *   POST /api/intel/share          — auth-required: create a snapshot link
 *   GET  /api/intel/share/:slug    — PUBLIC: read a snapshot (no auth)
 *   GET  /api/intel/share          — auth-required: list creator's own shares
 *   DELETE /api/intel/share/:slug  — auth-required: revoke (creator or admin)
 *
 * The public GET endpoint is registered BEFORE the auth middleware in
 * routes.ts so unauthenticated browsers can fetch the snapshot.
 */
import { type Request, type Response } from 'express';
import { randomBytes } from 'node:crypto';
import { sql as pgSql } from '../db.js';
import { consumerLabel } from './auth.js';

// Slug alphabet: uppercase letters + digits, avoiding visually-similar pairs
// (no O/0, no I/1). 8 chars from a 32-char alphabet = 32^8 ≈ 1.1 trillion.
const SLUG_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateSlug(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) out += SLUG_ALPHA[bytes[i] % SLUG_ALPHA.length];
  return out;
}

// Sanity caps on the snapshot blob to prevent abuse / oversized shares.
const MAX_SNAPSHOT_BYTES = 1_500_000;  // 1.5 MB
const MAX_TITLE_LEN = 200;
const MAX_DESC_LEN = 1000;
const MAX_LIST_TYPE_LEN = 40;

const ALLOWED_LIST_TYPES = new Set([
  'resurrection', 'orphans', 'hot-zips', 'leads',
  'upgrade-campaign', 'storm-playbook', 'custom',
]);

/* ============================================================================
 * POST /api/intel/share
 * ----------------------------------------------------------------------------
 * Body:
 *   list_type:        string (allowlisted)
 *   title:            string (<= 200 chars)
 *   description?:     string (<= 1000 chars)
 *   snapshot_data:    object|array (<= 1.5 MB serialized)
 *   filter_params?:   object (echoed back to share-viewer for context)
 *   expires_in_days?: number (default 30, max 365, 0 = no expiry)
 *
 * Returns: { slug, url, expires_at }
 * ========================================================================= */
export async function createShare(req: Request, res: Response) {
  const body = req.body ?? {};
  const list_type = String(body.list_type ?? '').trim();
  const title = String(body.title ?? '').trim();
  const description = body.description != null ? String(body.description).trim() : null;
  const snapshot_data = body.snapshot_data;
  const filter_params = body.filter_params ?? {};
  const expiresInDays = body.expires_in_days == null
    ? 30
    : Math.max(0, Math.min(365, Number(body.expires_in_days)));

  if (!list_type || list_type.length > MAX_LIST_TYPE_LEN) {
    res.status(400).json({ error: 'invalid_list_type' });
    return;
  }
  if (!ALLOWED_LIST_TYPES.has(list_type)) {
    res.status(400).json({ error: 'list_type_not_allowed', allowed: [...ALLOWED_LIST_TYPES] });
    return;
  }
  if (!title || title.length > MAX_TITLE_LEN) {
    res.status(400).json({ error: 'invalid_title' });
    return;
  }
  if (description != null && description.length > MAX_DESC_LEN) {
    res.status(400).json({ error: 'description_too_long' });
    return;
  }
  if (snapshot_data == null) {
    res.status(400).json({ error: 'missing_snapshot_data' });
    return;
  }
  const serialized = JSON.stringify(snapshot_data);
  if (serialized.length > MAX_SNAPSHOT_BYTES) {
    res.status(413).json({ error: 'snapshot_too_large', size: serialized.length, max: MAX_SNAPSHOT_BYTES });
    return;
  }

  // Collision protection: try up to 5 random slugs before giving up.
  let slug: string | null = null;
  for (let attempt = 0; attempt < 5 && slug === null; attempt++) {
    const candidate = generateSlug();
    const existing = await pgSql`SELECT 1 FROM intel_shared_lists WHERE slug = ${candidate} LIMIT 1`;
    if (existing.length === 0) slug = candidate;
  }
  if (slug === null) {
    res.status(500).json({ error: 'slug_generation_failed' });
    return;
  }

  const expiresAt = expiresInDays > 0
    ? new Date(Date.now() + expiresInDays * 86400_000).toISOString()
    : null;

  const creatorLabel = consumerLabel(req);
  const creatorEmail = (() => {
    const r = req as Request & { session?: { email?: string } };
    return r.session?.email ?? null;
  })();

  try {
    await pgSql`
      INSERT INTO intel_shared_lists
        (slug, list_type, title, description, snapshot_data, filter_params,
         creator_email, creator_label, expires_at)
      VALUES
        (${slug}, ${list_type}, ${title}, ${description}, ${JSON.stringify(snapshot_data)}::jsonb,
         ${JSON.stringify(filter_params)}::jsonb,
         ${creatorEmail}, ${creatorLabel}, ${expiresAt})
    `;

    // Build the share URL — host header is already canonical for the deploy.
    const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
    const host = req.headers.host;
    const url = `${proto}://${host}/s.html?c=${slug}`;

    res.json({ slug, url, expires_at: expiresAt });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'share_create_failed', message: msg });
  }
}

/* ============================================================================
 * GET /api/intel/share/:slug   — PUBLIC (no auth required)
 * ----------------------------------------------------------------------------
 * Returns the snapshot. Increments view count. 404 if not found/expired.
 * ========================================================================= */
export async function getSharedList(req: Request, res: Response) {
  const slug = String(req.params.slug ?? '').trim().toUpperCase();
  if (!slug || !/^[A-Z2-9]{8}$/.test(slug)) {
    res.status(400).json({ error: 'invalid_slug' });
    return;
  }
  try {
    const rows = await pgSql<Array<{
      slug: string;
      list_type: string;
      title: string;
      description: string | null;
      snapshot_data: unknown;
      filter_params: unknown;
      creator_label: string | null;
      views: number;
      created_at: Date;
      expires_at: Date | null;
    }>>`
      SELECT slug, list_type, title, description, snapshot_data, filter_params,
             creator_label, views, created_at, expires_at
        FROM intel_shared_lists
       WHERE slug = ${slug}
         AND (expires_at IS NULL OR expires_at > NOW())
       LIMIT 1
    `;
    if (rows.length === 0) {
      res.status(404).json({ error: 'not_found_or_expired' });
      return;
    }
    // Fire-and-forget view increment.
    void pgSql`UPDATE intel_shared_lists SET views = views + 1 WHERE slug = ${slug}`.catch(() => {});
    const r = rows[0];
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({
      slug: r.slug,
      listType: r.list_type,
      title: r.title,
      description: r.description,
      snapshotData: r.snapshot_data,
      filterParams: r.filter_params,
      creatorLabel: r.creator_label,
      views: r.views + 1,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'share_read_failed', message: msg });
  }
}

/* ============================================================================
 * GET /api/intel/share?type=resurrection — list shares I created
 * ========================================================================= */
export async function listMyShares(req: Request, res: Response) {
  const q = req.query as Record<string, string | undefined>;
  const r = req as Request & { session?: { email?: string } };
  const email = r.session?.email ?? null;
  const type = q.type?.trim() || null;
  if (!email) {
    res.status(401).json({ error: 'session_required' });
    return;
  }
  try {
    const rows = await pgSql<Array<{
      slug: string; list_type: string; title: string;
      created_at: Date; expires_at: Date | null; views: number;
    }>>`
      SELECT slug, list_type, title, created_at, expires_at, views
        FROM intel_shared_lists
       WHERE creator_email = ${email}
         ${type ? pgSql`AND list_type = ${type}` : pgSql``}
       ORDER BY created_at DESC
       LIMIT 100
    `;
    res.json({ shares: rows, total: rows.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'list_shares_failed', message: msg });
  }
}

/* ============================================================================
 * DELETE /api/intel/share/:slug — revoke (creator only)
 * ========================================================================= */
export async function deleteShare(req: Request, res: Response) {
  const slug = String(req.params.slug ?? '').trim().toUpperCase();
  const r = req as Request & { session?: { email?: string } };
  const email = r.session?.email ?? null;
  if (!email) {
    res.status(401).json({ error: 'session_required' });
    return;
  }
  try {
    const result = await pgSql`
      DELETE FROM intel_shared_lists
       WHERE slug = ${slug} AND creator_email = ${email}
    `;
    if (result.count === 0) {
      res.status(404).json({ error: 'not_found_or_not_yours' });
      return;
    }
    res.json({ ok: true, slug });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'share_delete_failed', message: msg });
  }
}

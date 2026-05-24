/** Phase 6 — AI assistant router, mounted at /api/ai/*. */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { sql as pgSql } from '../db.js';
import { chatHandler, chatStreamHandler } from './chat.js';
import { confirmHandler } from './confirm.js';

const router = Router();

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) { res.status(401).json({ error: 'authentication required' }); return; }
  next();
}

router.post('/api/ai/chat', requireAuth, chatHandler);
router.post('/api/ai/chat/stream', requireAuth, chatStreamHandler); // SSE; non-stream /chat unchanged
router.post('/api/ai/confirm', requireAuth, confirmHandler);

// List the user's threads (most-recent first).
router.get('/api/ai/threads', requireAuth, async (req, res) => {
  const rows = await pgSql<Array<{ id: number; title: string; updated_at: Date }>>`
    SELECT id, title, updated_at FROM ai_threads WHERE user_id = ${req.user!.id} ORDER BY updated_at DESC LIMIT 100`;
  res.json({ threads: rows });
});

// Fetch one thread + its messages (owner only).
router.get('/api/ai/thread/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: 'invalid id' }); return; }
  const own = await pgSql<Array<{ id: number; title: string }>>`SELECT id, title FROM ai_threads WHERE id = ${id} AND user_id = ${req.user!.id}`;
  if (!own.length) { res.status(404).json({ error: 'thread not found' }); return; }
  const msgs = await pgSql<Array<{ id: number; role: string; content: string; tool_calls: unknown; created_at: Date }>>`
    SELECT id, role, content, tool_calls, created_at FROM ai_messages WHERE thread_id = ${id} ORDER BY created_at ASC`;
  res.json({ thread: own[0], messages: msgs });
});

// Delete a thread (owner only; messages cascade).
router.delete('/api/ai/thread/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: 'invalid id' }); return; }
  const del = await pgSql<Array<{ id: number }>>`DELETE FROM ai_threads WHERE id = ${id} AND user_id = ${req.user!.id} RETURNING id`;
  if (!del.length) { res.status(404).json({ error: 'thread not found' }); return; }
  res.json({ ok: true, deleted: id });
});

// Admin-only: recent tool-call audit log.
router.get('/api/ai/audit', requireAuth, async (req, res) => {
  const u = req.user!;
  if (!u.is_root_admin && u.role !== 'admin') { res.status(403).json({ error: 'forbidden' }); return; }
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const rows = await pgSql<Array<Record<string, unknown>>>`
    SELECT l.id, l.user_id, u.email AS user_email, l.session_id, l.thread_id,
           l.tool, l.kind, l.params_json, l.result_summary, l.confirmed_at, l.error, l.model, l.created_at
    FROM ai_tool_log l
    LEFT JOIN users u ON u.id = l.user_id
    ORDER BY l.created_at DESC LIMIT ${limit}`;
  res.json({ log: rows });
});

export { router as aiRouter };

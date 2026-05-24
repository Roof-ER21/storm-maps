/** Phase 6 — execute a user-confirmed act tool. POST /api/ai/confirm */
import type { Request, Response } from 'express';
import { sql as pgSql } from '../db.js';
import type { Role } from '../auth/services.js';
import { getTool, canUseTool } from './registry.js';
import { executeTool, summarize } from './invoke.js';
import { logToolCall } from './audit.js';

export async function confirmHandler(req: Request, res: Response): Promise<void> {
  const user = req.user;
  if (!user) { res.status(401).json({ error: 'authentication required' }); return; }
  const role = user.role as Role;
  const isRootAdmin = !!user.is_root_admin;
  const actor = { id: user.id, email: user.email, role, isRootAdmin };

  const { tool: toolName, args, threadId } = (req.body ?? {}) as { tool?: string; args?: Record<string, unknown>; threadId?: number };
  const tool = toolName ? getTool(toolName) : undefined;
  if (!tool) { res.status(400).json({ error: 'unknown tool' }); return; }
  if (tool.kind !== 'act') { res.status(400).json({ error: 'not an act tool' }); return; }
  if (!canUseTool(tool, role, isRootAdmin)) { res.status(403).json({ error: 'forbidden' }); return; }

  const result = await executeTool(tool, args ?? {}, actor);
  const summary = result.ok ? summarize(result.data, 1000) : `ERROR: ${result.error}`;

  await logToolCall({
    userId: user.id, threadId: threadId ?? null, tool: tool.name, kind: 'act', params: args ?? {},
    resultSummary: result.ok ? summary.slice(0, 500) : null, error: result.ok ? null : result.error,
    confirmedAt: new Date().toISOString(),
  });

  if (threadId) {
    await pgSql`INSERT INTO ai_messages (thread_id, role, content) VALUES (${threadId}, 'tool', ${`Confirmed ${tool.name} → ${summary.slice(0, 2000)}`})`;
  }

  if (!result.ok) { res.status(502).json({ ok: false, error: result.error, tool: tool.name }); return; }
  res.json({ ok: true, tool: tool.name, data: result.data });
}

/**
 * Phase 6 — chat orchestrator. POST /api/ai/chat runs a tool-calling loop:
 * model proposes tool calls → read tools execute immediately (self-fetch +
 * audit) and feed back; act tools are proposed for confirmation (or auto-run
 * under admin smart/full bypass). Threads + messages persist for history.
 *
 * MVP: non-streaming JSON response. (Streaming SSE is a follow-up — the §6.2
 * contract response shape below is stable either way.)
 */
import type { Request, Response } from 'express';
import { sql as pgSql } from '../db.js';
import type { Role } from '../auth/services.js';
import { getTool, canUseTool, toolsForRole, type ToolDef } from './registry.js';
import { generate, generateStream, selectModel, type GenMessage } from './model.js';
import { systemPrompt } from './prompts.js';
import { executeTool, summarize } from './invoke.js';
import { logToolCall } from './audit.js';

const MAX_TURNS = 5;

// Tiered hourly rate limit (in-memory; resets on restart — fine for v1).
const RATE: Record<Role, number> = { employee: 200, exec: 500, analytics: 500, admin: Number.MAX_SAFE_INTEGER };
const hits = new Map<number, { n: number; resetAt: number }>();
function rateOk(userId: number, role: Role, isRootAdmin: boolean): boolean {
  if (isRootAdmin || role === 'admin') return true;
  const now = Date.now();
  const e = hits.get(userId);
  if (!e || now > e.resetAt) { hits.set(userId, { n: 1, resetAt: now + 3600_000 }); return true; }
  if (e.n >= (RATE[role] ?? 200)) return false;
  e.n += 1;
  return true;
}

type BypassMode = 'confirm' | 'smart' | 'full';
function actDecision(tool: ToolDef, role: Role, isRootAdmin: boolean, mode: BypassMode): 'execute' | 'propose' {
  const isAdmin = isRootAdmin || role === 'admin';
  if (isAdmin && mode === 'full') return 'execute';
  if (isAdmin && mode === 'smart' && tool.danger === 'safe') return 'execute';
  return 'propose';
}

export async function chatHandler(req: Request, res: Response): Promise<void> {
  const user = req.user;
  if (!user) { res.status(401).json({ error: 'authentication required' }); return; }
  const role = user.role as Role;
  const isRootAdmin = !!user.is_root_admin;
  const actor = { id: user.id, email: user.email, role, isRootAdmin };

  const { message, threadId: inThreadId, pageContext, localOnly } = (req.body ?? {}) as {
    message?: string; threadId?: number; pageContext?: string; localOnly?: boolean;
  };
  if (!message || typeof message !== 'string') { res.status(400).json({ error: 'message required' }); return; }

  // Admins may pass a bypass mode; everyone else is forced to confirm.
  let bypassMode: BypassMode = 'confirm';
  const reqMode = (req.body?.bypassMode as BypassMode) ?? 'smart';
  if (isRootAdmin || role === 'admin') bypassMode = (['confirm', 'smart', 'full'] as const).includes(reqMode) ? reqMode : 'smart';

  if (!rateOk(user.id, role, isRootAdmin)) { res.status(429).json({ error: 'rate limit exceeded — try again later' }); return; }

  const model = selectModel({ localOnly });

  // Resolve / create thread.
  let threadId = inThreadId;
  if (threadId) {
    const owns = await pgSql<Array<{ id: number }>>`SELECT id FROM ai_threads WHERE id = ${threadId} AND user_id = ${user.id}`;
    if (!owns.length) { res.status(404).json({ error: 'thread not found' }); return; }
  } else {
    const title = message.slice(0, 60);
    const ins = await pgSql<Array<{ id: number }>>`INSERT INTO ai_threads (user_id, title, model) VALUES (${user.id}, ${title}, ${model}) RETURNING id`;
    threadId = ins[0].id;
  }

  // Load recent history (last 20 turns) for context.
  const prior = await pgSql<Array<{ role: string; content: string }>>`
    SELECT role, content FROM ai_messages WHERE thread_id = ${threadId} AND role IN ('user','assistant') ORDER BY created_at DESC LIMIT 20`;
  const history: GenMessage[] = prior.reverse().map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  await pgSql`INSERT INTO ai_messages (thread_id, role, content) VALUES (${threadId}, 'user', ${message})`;

  const tools = toolsForRole(role, isRootAdmin).map((t) => ({ name: t.name, description: t.description, parameters: t.params }));
  const messages: GenMessage[] = [...history, { role: 'user', content: message }];
  const toolsUsed: string[] = [];
  const proposals: Array<{ tool: string; args: Record<string, unknown>; danger: string; description: string }> = [];
  let reply = '';

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const out = await generate(model, { system: systemPrompt(role, isRootAdmin, pageContext), messages, tools });
      if (!out.toolCalls.length) { reply = out.text; break; }

      let proposed = false;
      for (const call of out.toolCalls) {
        const tool = getTool(call.name);
        if (!tool || !canUseTool(tool, role, isRootAdmin)) {
          messages.push({ role: 'tool', content: `Tool ${call.name} is not available to you.` });
          continue;
        }
        if (tool.kind === 'act' && actDecision(tool, role, isRootAdmin, bypassMode) === 'propose') {
          proposals.push({ tool: tool.name, args: call.args, danger: tool.danger ?? 'destructive', description: tool.description });
          proposed = true;
          continue;
        }
        // read tool, or auto-executed act under bypass
        const result = await executeTool(tool, call.args, actor);
        const sum = result.ok ? summarize(result.data) : `ERROR: ${result.error}`;
        toolsUsed.push(tool.name);
        await logToolCall({
          userId: user.id, threadId, tool: tool.name, kind: tool.kind, params: call.args,
          resultSummary: result.ok ? sum.slice(0, 500) : null, error: result.ok ? null : result.error,
          confirmedAt: tool.kind === 'act' ? new Date().toISOString() : null, model,
        });
        messages.push({ role: 'tool', content: `Result of ${tool.name}(${JSON.stringify(call.args)}):\n${sum}` });
      }
      if (proposed) { reply = reply || 'I need your confirmation to run the proposed action(s) below.'; break; }
    }
  } catch (err) {
    res.status(502).json({ error: 'ai_error', detail: (err as Error).message, threadId });
    return;
  }

  // jsonb via ${JSON.stringify(x)}::jsonb — sql.json() throws in postgres.js v3.4.5+.
  const toolCallsJson = proposals.length ? JSON.stringify(proposals) : null;
  await pgSql`INSERT INTO ai_messages (thread_id, role, content, tool_calls) VALUES (${threadId}, 'assistant', ${reply}, ${toolCallsJson}::jsonb)`;
  await pgSql`UPDATE ai_threads SET updated_at = NOW() WHERE id = ${threadId}`;

  res.json({ threadId, reply, proposals, toolsUsed, model });
}

/**
 * Streaming variant — POST /api/ai/chat/stream. Same loop + contract as
 * chatHandler, but emits Server-Sent Events: `meta` (threadId, model) →
 * `token` (text deltas) + `tool`/`proposal` as they happen → `done` (final
 * reply, proposals, toolsUsed). The non-streaming /api/ai/chat is unchanged.
 */
export async function chatStreamHandler(req: Request, res: Response): Promise<void> {
  const user = req.user;
  if (!user) { res.status(401).json({ error: 'authentication required' }); return; }
  const role = user.role as Role;
  const isRootAdmin = !!user.is_root_admin;
  const actor = { id: user.id, email: user.email, role, isRootAdmin };

  const { message, threadId: inThreadId, pageContext, localOnly } = (req.body ?? {}) as {
    message?: string; threadId?: number; pageContext?: string; localOnly?: boolean;
  };
  if (!message || typeof message !== 'string') { res.status(400).json({ error: 'message required' }); return; }

  let bypassMode: BypassMode = 'confirm';
  const reqMode = (req.body?.bypassMode as BypassMode) ?? 'smart';
  if (isRootAdmin || role === 'admin') bypassMode = (['confirm', 'smart', 'full'] as const).includes(reqMode) ? reqMode : 'smart';

  if (!rateOk(user.id, role, isRootAdmin)) { res.status(429).json({ error: 'rate limit exceeded — try again later' }); return; }

  const model = selectModel({ localOnly });

  let threadId = inThreadId;
  if (threadId) {
    const owns = await pgSql<Array<{ id: number }>>`SELECT id FROM ai_threads WHERE id = ${threadId} AND user_id = ${user.id}`;
    if (!owns.length) { res.status(404).json({ error: 'thread not found' }); return; }
  } else {
    const ins = await pgSql<Array<{ id: number }>>`INSERT INTO ai_threads (user_id, title, model) VALUES (${user.id}, ${message.slice(0, 60)}, ${model}) RETURNING id`;
    threadId = ins[0].id;
  }

  const prior = await pgSql<Array<{ role: string; content: string }>>`
    SELECT role, content FROM ai_messages WHERE thread_id = ${threadId} AND role IN ('user','assistant') ORDER BY created_at DESC LIMIT 20`;
  const history: GenMessage[] = prior.reverse().map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  await pgSql`INSERT INTO ai_messages (thread_id, role, content) VALUES (${threadId}, 'user', ${message})`;

  const tools = toolsForRole(role, isRootAdmin).map((t) => ({ name: t.name, description: t.description, parameters: t.params }));
  const messages: GenMessage[] = [...history, { role: 'user', content: message }];
  const toolsUsed: string[] = [];
  const proposals: Array<{ tool: string; args: Record<string, unknown>; danger: string; description: string }> = [];
  let reply = '';

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('meta', { threadId, model });

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const out = await generateStream(model, { system: systemPrompt(role, isRootAdmin, pageContext), messages, tools }, (delta) => send('token', { delta }));
      if (!out.toolCalls.length) { reply = out.text; break; }

      let proposed = false;
      for (const call of out.toolCalls) {
        const tool = getTool(call.name);
        if (!tool || !canUseTool(tool, role, isRootAdmin)) {
          messages.push({ role: 'tool', content: `Tool ${call.name} is not available to you.` });
          continue;
        }
        if (tool.kind === 'act' && actDecision(tool, role, isRootAdmin, bypassMode) === 'propose') {
          const p = { tool: tool.name, args: call.args, danger: tool.danger ?? 'destructive', description: tool.description };
          proposals.push(p);
          send('proposal', p);
          proposed = true;
          continue;
        }
        const result = await executeTool(tool, call.args, actor);
        const sum = result.ok ? summarize(result.data) : `ERROR: ${result.error}`;
        toolsUsed.push(tool.name);
        send('tool', { tool: tool.name, ok: result.ok });
        await logToolCall({
          userId: user.id, threadId, tool: tool.name, kind: tool.kind, params: call.args,
          resultSummary: result.ok ? sum.slice(0, 500) : null, error: result.ok ? null : result.error,
          confirmedAt: tool.kind === 'act' ? new Date().toISOString() : null, model,
        });
        messages.push({ role: 'tool', content: `Result of ${tool.name}(${JSON.stringify(call.args)}):\n${sum}` });
      }
      if (proposed) { reply = reply || 'I need your confirmation to run the proposed action(s) below.'; break; }
    }
  } catch (err) {
    send('error', { detail: (err as Error).message, threadId });
    res.end();
    return;
  }

  const toolCallsJson = proposals.length ? JSON.stringify(proposals) : null;
  await pgSql`INSERT INTO ai_messages (thread_id, role, content, tool_calls) VALUES (${threadId}, 'assistant', ${reply}, ${toolCallsJson}::jsonb)`;
  await pgSql`UPDATE ai_threads SET updated_at = NOW() WHERE id = ${threadId}`;

  send('done', { threadId, reply, proposals, toolsUsed, model });
  res.end();
}

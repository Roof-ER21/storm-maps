/** Phase 6 — write every tool call (read or act) to ai_tool_log. */
import { sql as pgSql } from '../db.js';

export interface AuditEntry {
  userId?: number | null;
  sessionId?: string | null;
  threadId?: number | null;
  tool: string;
  kind: 'read' | 'act';
  params?: unknown;
  resultSummary?: string | null;
  confirmedAt?: string | null; // null for read tools; ISO string when an act is confirmed + run
  error?: string | null;
  model?: string | null;
}

export async function logToolCall(e: AuditEntry): Promise<void> {
  try {
    // jsonb via ${JSON.stringify(x)}::jsonb — sql.json() throws in postgres.js v3.4.5+.
    const paramsJson = e.params == null ? null : JSON.stringify(e.params);
    await pgSql`
      INSERT INTO ai_tool_log
        (user_id, session_id, thread_id, tool, kind, params_json, result_summary, confirmed_at, error, model)
      VALUES
        (${e.userId ?? null}, ${e.sessionId ?? null}, ${e.threadId ?? null}, ${e.tool}, ${e.kind},
         ${paramsJson}::jsonb, ${e.resultSummary ?? null}, ${e.confirmedAt ?? null},
         ${e.error ?? null}, ${e.model ?? null})`;
  } catch (err) {
    // Audit failures must never break the chat path.
    console.error('[ai/audit] log failed:', (err as Error).message);
  }
}

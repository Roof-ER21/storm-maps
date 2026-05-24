/**
 * AuditPanel — admin-only collapsible showing recent AI tool executions from
 * GET /api/ai/audit (the ai_tool_log). Lets admins see who ran which tool,
 * with the result summary or error. Lazy: fetches on first expand.
 */
import { useState, useCallback } from 'react';
import type { AuditRow, AuditResponse } from './types';
import { humanizeTool } from './format';

function fmtAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function AuditPanel() {
  const [collapsed, setCollapsed] = useState(true);
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/audit?limit=50', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as AuditResponse;
      setRows(data.log ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    if (!next && rows === null && !loading) void load();
  }

  return (
    <div style={{ borderTop: '1px solid var(--riq-border)', paddingTop: 8, flexShrink: 0 }}>
      <div
        onClick={toggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 0 6px',
          cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--riq-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {collapsed ? '▶' : '▼'} Activity
        </span>
        {!collapsed && (
          <button
            onClick={(e) => { e.stopPropagation(); void load(); }}
            title="Refresh audit log"
            style={{ background: 'transparent', border: 'none', color: 'var(--riq-text-muted)', fontSize: 12, cursor: 'pointer', padding: '0 4px', fontFamily: 'inherit' }}
          >
            ↻
          </button>
        )}
      </div>

      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflowY: 'auto' }}>
          {loading && <div style={{ fontSize: 11, color: 'var(--riq-text-muted)', padding: '4px 0' }}>Loading…</div>}
          {error && <div style={{ fontSize: 11, color: '#e05050', padding: '4px 0' }}>{error}</div>}
          {rows && rows.length === 0 && !loading && (
            <div style={{ fontSize: 11, color: 'var(--riq-text-muted)', padding: '4px 0' }}>No tool activity yet</div>
          )}
          {rows?.map((r) => (
            <div
              key={r.id}
              style={{
                border: '1px solid var(--riq-border)',
                borderRadius: 5,
                padding: '6px 8px',
                background: 'var(--riq-surface)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--riq-text)' }} title={r.tool}>
                  {humanizeTool(r.tool)}
                  {r.confirmed_at && (
                    <span style={{ marginLeft: 6, fontSize: 9, color: 'var(--riq-accent)', fontWeight: 700, letterSpacing: '0.04em' }}>ACT</span>
                  )}
                </span>
                <span style={{ fontSize: 10, color: 'var(--riq-text-muted)', flexShrink: 0 }}>{fmtAgo(r.created_at)}</span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--riq-text-muted)', marginTop: 2 }}>
                {r.user_email ?? `user ${r.user_id}`}
              </div>
              {r.result_summary && (
                <div style={{ fontSize: 11, color: 'var(--riq-text)', marginTop: 3, wordBreak: 'break-word' }}>
                  {r.result_summary}
                </div>
              )}
              {r.error && (
                <div style={{ fontSize: 11, color: '#e05050', marginTop: 3, wordBreak: 'break-word' }}>
                  {r.error}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

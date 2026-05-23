/**
 * ThreadList — collapsible sidebar listing saved chat threads.
 * GET /api/ai/threads → list; click → load via GET /api/ai/thread/:id;
 * delete via DELETE /api/ai/thread/:id; "New chat" clears current thread.
 */
import { useState, useEffect, useCallback } from 'react';
import type { ThreadSummary, ThreadDetail, UiMessage } from './types';

interface Props {
  activeThreadId: number | null;
  onSelectThread: (messages: UiMessage[], threadId: number) => void;
  onNewChat: () => void;
}

function fmtAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function ThreadList({ activeThreadId, onSelectThread, onNewChat }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchThreads = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/threads', { credentials: 'include' });
      if (!res.ok) return;
      const data = (await res.json()) as { threads: ThreadSummary[] };
      setThreads(data.threads ?? []);
    } catch {
      // silently ignore — threads are a convenience, not critical path
    }
  }, []);

  useEffect(() => {
    void fetchThreads();
  }, [fetchThreads]);

  async function handleSelect(id: number) {
    if (id === activeThreadId) return;
    setLoadingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/ai/thread/${id}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ThreadDetail;
      const uiMessages: UiMessage[] = data.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m, i) => ({
          id: `thread-${id}-${i}`,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          created_at: m.created_at,
        }));
      onSelectThread(uiMessages, id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingId(null);
    }
  }

  async function handleDelete(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    if (!window.confirm('Delete this thread?')) return;
    setDeletingId(id);
    try {
      await fetch(`/api/ai/thread/${id}`, { method: 'DELETE', credentials: 'include' });
      setThreads((prev) => prev.filter((t) => t.id !== id));
      if (id === activeThreadId) onNewChat();
    } catch {
      // ignore
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div
      style={{
        borderTop: '1px solid var(--riq-border)',
        paddingTop: 8,
        flexShrink: 0,
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 0 6px',
          cursor: 'pointer',
        }}
        onClick={() => setCollapsed((c) => !c)}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--riq-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {collapsed ? '▶' : '▼'} Threads
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            void fetchThreads();
          }}
          title="Refresh threads"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--riq-text-muted)',
            fontSize: 12,
            cursor: 'pointer',
            padding: '0 4px',
            fontFamily: 'inherit',
          }}
        >
          ↻
        </button>
      </div>

      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 220, overflowY: 'auto' }}>
          {/* New chat */}
          <button
            onClick={onNewChat}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              background: activeThreadId == null ? 'rgba(244,167,56,0.12)' : 'transparent',
              border: activeThreadId == null ? '1px solid rgba(244,167,56,0.4)' : '1px solid transparent',
              color: activeThreadId == null ? 'var(--riq-accent)' : 'var(--riq-text-muted)',
              borderRadius: 5,
              padding: '6px 8px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            + New chat
          </button>

          {error && (
            <div style={{ fontSize: 11, color: '#e05050', padding: '4px 0' }}>{error}</div>
          )}

          {threads.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--riq-text-muted)', padding: '4px 0' }}>No saved threads</div>
          )}

          {threads.map((t) => (
            <div
              key={t.id}
              onClick={() => void handleSelect(t.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: t.id === activeThreadId ? 'rgba(244,167,56,0.10)' : 'transparent',
                border: t.id === activeThreadId ? '1px solid rgba(244,167,56,0.30)' : '1px solid transparent',
                borderRadius: 5,
                padding: '5px 8px',
                cursor: loadingId === t.id ? 'wait' : 'pointer',
                opacity: loadingId === t.id || deletingId === t.id ? 0.5 : 1,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12,
                  color: t.id === activeThreadId ? 'var(--riq-accent)' : 'var(--riq-text)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontWeight: t.id === activeThreadId ? 600 : 400,
                }}>
                  {t.title || `Thread ${t.id}`}
                </div>
                <div style={{ fontSize: 10, color: 'var(--riq-text-muted)' }}>
                  {fmtAgo(t.updated_at)}
                </div>
              </div>
              <button
                onClick={(e) => void handleDelete(t.id, e)}
                title="Delete thread"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--riq-text-muted)',
                  fontSize: 13,
                  cursor: 'pointer',
                  padding: '0 2px',
                  lineHeight: 1,
                  fontFamily: 'inherit',
                  flexShrink: 0,
                  opacity: 0.5,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = '#e05050'; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.color = 'var(--riq-text-muted)'; }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

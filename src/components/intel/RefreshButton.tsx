/**
 * RefreshButton — triggers a stealth refresh from the IntelligenceHub home pane.
 *
 * Click → POST /api/intel/refresh → server spawns refresh-stealth.sh (IEM +
 * rebuild + DB push, NO portal API calls). UI polls /api/intel/refresh/status
 * every 2s for log lines + final state.
 *
 * Single-flight on the server: button disables while a refresh is running.
 * Last 10 log lines surface in a small expandable panel.
 */
import { useEffect, useRef, useState } from 'react';

type RefreshStatus = {
  state: 'idle' | 'running' | 'success' | 'error';
  startedAt: string | null;
  finishedAt: string | null;
  consumer: string | null;
  log: string[];
  error: string | null;
};

export function RefreshButton() {
  const [status, setStatus] = useState<RefreshStatus | null>(null);
  const [expanded, setExpanded] = useState(false);
  const pollRef = useRef<number | null>(null);

  // Pull current state on mount so the button reflects an in-progress refresh
  // even when the user navigates back to home.
  useEffect(() => {
    void poll();
    return () => stopPolling();
  }, []);

  // While running, poll every 2s. Stop when terminal.
  useEffect(() => {
    if (status?.state === 'running') {
      pollRef.current = window.setInterval(poll, 2000);
    } else {
      stopPolling();
    }
    return () => stopPolling();
  }, [status?.state]);

  function stopPolling() {
    if (pollRef.current != null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function poll() {
    try {
      const res = await fetch('/api/intel/refresh/status');
      if (res.ok) setStatus(await res.json());
    } catch {
      // tolerate transient — next tick will retry
    }
  }

  async function trigger() {
    setExpanded(true);
    try {
      const res = await fetch('/api/intel/refresh', { method: 'POST' });
      if (res.ok || res.status === 409) setStatus((await res.json()).status);
    } catch (e) {
      setStatus({
        state: 'error',
        startedAt: null,
        finishedAt: null,
        consumer: null,
        log: [],
        error: String(e),
      });
    }
  }

  const running = status?.state === 'running';
  const success = status?.state === 'success';
  const failed = status?.state === 'error';
  const lastLog = status?.log?.slice(-3).join(' · ') ?? '';

  return (
    <div style={panel}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={hdr}>🔄 Manual Refresh</div>
          <div style={{ fontSize: 12, color: 'var(--riq-text-muted)', lineHeight: 1.5 }}>
            Re-pulls storm data from NOAA, rebuilds derived patterns, pushes to RIQ DB.
            Does <strong style={{ color: 'var(--riq-accent)' }}>not</strong> touch portal.theroofdocs.com.
            Use after a heavy storm or when you want a fresh check before knocking.
          </div>
          {status?.startedAt && (
            <div style={{ fontSize: 11, color: 'var(--riq-text-dim)', marginTop: 6 }}>
              Last run: {new Date(status.startedAt).toLocaleString()}
              {status.finishedAt && ` · finished ${new Date(status.finishedAt).toLocaleTimeString()}`}
            </div>
          )}
        </div>
        <button
          onClick={trigger}
          disabled={running}
          style={{
            background: running
              ? 'var(--riq-surface-elev)'
              : success
                ? 'var(--riq-success)'
                : failed
                  ? 'var(--riq-danger)'
                  : 'var(--riq-orange)',
            color: running ? 'var(--riq-text-muted)' : '#1a1612',
            border: 'none',
            borderRadius: 6,
            padding: '10px 18px',
            fontSize: 13,
            fontWeight: 700,
            cursor: running ? 'wait' : 'pointer',
            fontFamily: 'inherit',
            whiteSpace: 'nowrap',
            transition: 'background 0.2s, transform 0.1s',
          }}
        >
          {running ? '⏳ Running…' : success ? '✓ Refreshed' : failed ? '⚠ Retry' : '⚡ Refresh Now'}
        </button>
      </div>

      {(running || lastLog) && (
        <div
          style={{
            marginTop: 12,
            background: 'var(--riq-bg)',
            border: '1px solid var(--riq-border)',
            borderRadius: 4,
            padding: '8px 12px',
            fontSize: 11,
            color: 'var(--riq-text-muted)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        >
          <div
            style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}
            onClick={() => setExpanded((v) => !v)}
          >
            <span>{lastLog || 'starting…'}</span>
            <span style={{ color: 'var(--riq-accent)' }}>{expanded ? '▲ hide' : '▼ show log'}</span>
          </div>
          {expanded && status?.log && (
            <div style={{ marginTop: 8, maxHeight: 180, overflowY: 'auto', fontSize: 10, whiteSpace: 'pre-wrap' }}>
              {status.log.slice(-30).map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {failed && status?.error && (
        <div style={{ marginTop: 8, color: 'var(--riq-danger)', fontSize: 12 }}>
          {status.error}
        </div>
      )}
    </div>
  );
}

const panel: React.CSSProperties = {
  background: 'var(--riq-surface)',
  border: '1px solid var(--riq-border)',
  borderRadius: 8,
  padding: '16px 20px',
  marginBottom: 16,
};
const hdr: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 14,
  color: 'var(--riq-accent)',
  marginBottom: 4,
};

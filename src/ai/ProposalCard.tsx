/**
 * ProposalCard — renders a single tool-call proposal returned by /api/ai/chat.
 * Confirm button posts to /api/ai/confirm. Shows result or error inline.
 */
import { useState } from 'react';
import type { Proposal, ConfirmResponse } from './types';
import { ToolBadge } from './ToolBadge';
import { humanizeKey, formatArgValue, isStructured } from './format';

interface Props {
  proposal: Proposal;
  threadId?: number;
  /** Called after a successful confirm so parent can update state. */
  onConfirmed?: (result: unknown) => void;
}

export function ProposalCard({ proposal, threadId, onConfirmed }: Props) {
  const [state, setState] = useState<'pending' | 'loading' | 'confirmed' | 'dismissed' | 'error'>('pending');
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  const isDestructive = proposal.danger === 'destructive';

  async function handleConfirm() {
    setState('loading');
    setError(null);
    try {
      const res = await fetch('/api/ai/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tool: proposal.tool, args: proposal.args, threadId }),
      });
      const json: ConfirmResponse = await res.json();
      if (json.ok) {
        setState('confirmed');
        setResult(json.data);
        onConfirmed?.(json.data);
      } else {
        setState('error');
        setError(json.error ?? 'Unknown error');
      }
    } catch (err) {
      setState('error');
      setError((err as Error).message);
    }
  }

  function handleDismiss() {
    setState('dismissed');
  }

  return (
    <div
      style={{
        background: 'var(--riq-surface)',
        border: `1px solid ${isDestructive ? 'rgba(220,50,50,0.45)' : 'var(--riq-border)'}`,
        borderRadius: 8,
        padding: '12px 14px',
        marginTop: 6,
        fontSize: 13,
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <ToolBadge tool={proposal.tool} />
        {isDestructive && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: '#e05050',
              background: 'rgba(220,50,50,0.12)',
              border: '1px solid rgba(220,50,50,0.35)',
              borderRadius: 4,
              padding: '2px 6px',
              letterSpacing: '0.05em',
            }}
          >
            DESTRUCTIVE
          </span>
        )}
      </div>

      {/* Description */}
      <div style={{ color: 'var(--riq-text)', marginBottom: 8, lineHeight: 1.5 }}>
        {proposal.description}
      </div>

      {/* Args — human-readable key/value rows */}
      {Object.keys(proposal.args).length > 0 && (
        <div
          style={{
            background: 'rgba(0,0,0,0.22)',
            border: '1px solid var(--riq-border)',
            borderRadius: 5,
            padding: '6px 10px',
            margin: '0 0 10px 0',
          }}
        >
          {Object.entries(proposal.args).map(([k, v]) => (
            <div
              key={k}
              style={{ display: 'flex', gap: 10, padding: '2px 0', fontSize: 12, lineHeight: 1.45 }}
            >
              <span style={{ color: 'var(--riq-text-muted)', minWidth: 96, fontWeight: 600, flexShrink: 0 }}>
                {humanizeKey(k)}
              </span>
              <span
                style={{
                  color: 'var(--riq-text)',
                  flex: 1,
                  wordBreak: 'break-word',
                  fontFamily: isStructured(v) ? 'monospace' : 'inherit',
                }}
              >
                {formatArgValue(v)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Action buttons — only shown while pending */}
      {state === 'pending' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => void handleConfirm()}
            style={{
              background: isDestructive ? '#c0392b' : 'var(--riq-accent)',
              color: isDestructive ? '#fff' : '#0c0c0e',
              border: 'none',
              borderRadius: 5,
              padding: '7px 14px',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
          >
            Confirm
          </button>
          <button
            onClick={handleDismiss}
            style={{
              background: 'transparent',
              border: '1px solid var(--riq-border)',
              color: 'var(--riq-text-muted)',
              borderRadius: 5,
              padding: '7px 14px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Loading */}
      {state === 'loading' && (
        <div style={{ color: 'var(--riq-text-muted)', fontSize: 12 }}>Running...</div>
      )}

      {/* Confirmed result */}
      {state === 'confirmed' && (
        <div>
          <div style={{ color: '#6dba7d', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
            Done
          </div>
          {result != null && (
            <pre
              style={{
                background: 'rgba(0,0,0,0.25)',
                border: '1px solid var(--riq-border)',
                borderRadius: 5,
                padding: '8px 10px',
                fontSize: 11,
                color: 'var(--riq-text-muted)',
                overflowX: 'auto',
                margin: 0,
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {JSON.stringify(result, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* Dismissed */}
      {state === 'dismissed' && (
        <div style={{ color: 'var(--riq-text-muted)', fontSize: 12 }}>Dismissed</div>
      )}

      {/* Error */}
      {state === 'error' && (
        <div style={{ color: '#e05050', fontSize: 12 }}>
          Error: {error}
          <button
            onClick={() => setState('pending')}
            style={{
              marginLeft: 8,
              background: 'transparent',
              border: 'none',
              color: 'var(--riq-accent)',
              fontSize: 11,
              cursor: 'pointer',
              fontFamily: 'inherit',
              textDecoration: 'underline',
            }}
          >
            retry
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * ToolTrace — collapsed summary of the tools an assistant turn ran, expandable
 * to per-call detail (kind, args, result) from the enriched SSE `tool` events.
 * Falls back gracefully when only names are known (no args/result).
 */
import { useState } from 'react';
import type { ToolCall } from './types';
import { humanizeTool, humanizeKey, formatArgValue, isStructured } from './format';

export function ToolTrace({ calls }: { calls: ToolCall[] }) {
  const [open, setOpen] = useState(false);
  if (calls.length === 0) return null;

  return (
    <div style={{ marginTop: 5, maxWidth: '88%' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--riq-text-muted)',
          fontSize: 11,
          cursor: 'pointer',
          fontFamily: 'inherit',
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        <span>{open ? '▾' : '▸'}</span>
        <span>{calls.length} tool{calls.length === 1 ? '' : 's'} used</span>
      </button>

      {open && (
        <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {calls.map((c, i) => (
            <div
              key={i}
              style={{
                border: '1px solid var(--riq-border)',
                borderRadius: 5,
                padding: '6px 8px',
                background: 'var(--riq-surface)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--riq-text)' }} title={c.tool}>
                  {humanizeTool(c.tool)}
                </span>
                {c.kind && (
                  <span style={{ fontSize: 9, color: 'var(--riq-text-muted)', border: '1px solid var(--riq-border)', borderRadius: 3, padding: '1px 4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {c.kind}
                  </span>
                )}
                {c.ok === false && (
                  <span style={{ fontSize: 9, color: '#e05050', fontWeight: 700, letterSpacing: '0.04em' }}>FAILED</span>
                )}
              </div>

              {c.args && Object.keys(c.args).length > 0 && (
                <div style={{ marginTop: 3 }}>
                  {Object.entries(c.args).map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', gap: 8, fontSize: 11, lineHeight: 1.4 }}>
                      <span style={{ color: 'var(--riq-text-muted)', minWidth: 70, flexShrink: 0 }}>{humanizeKey(k)}</span>
                      <span style={{ color: 'var(--riq-text)', wordBreak: 'break-word', fontFamily: isStructured(v) ? 'monospace' : 'inherit' }}>
                        {formatArgValue(v)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {c.result && (
                <div style={{ marginTop: 3, fontSize: 11, color: 'var(--riq-text-muted)', wordBreak: 'break-word' }}>
                  {c.result}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

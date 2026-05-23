/**
 * ContextPill — shows the current page context inside the ChatDrawer header.
 */

interface Props {
  pageContext: string;
}

export function ContextPill({ pageContext }: Props) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        background: 'rgba(244,167,56,0.10)',
        border: '1px solid rgba(244,167,56,0.30)',
        color: 'var(--riq-text-muted)',
        borderRadius: 100,
        padding: '3px 10px',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.03em',
        maxWidth: '100%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ color: 'var(--riq-accent)', fontSize: 10 }}>context</span>
      {pageContext}
    </span>
  );
}

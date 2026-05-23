/**
 * ToolBadge — small pill displaying a single tool name.
 * Used in ChatPage (per toolsUsed) and ProposalCard (for the proposal tool).
 */

interface Props {
  tool: string;
}

export function ToolBadge({ tool }: Props) {
  return (
    <span
      style={{
        display: 'inline-block',
        background: 'rgba(244,167,56,0.12)',
        border: '1px solid rgba(244,167,56,0.35)',
        color: 'var(--riq-accent)',
        borderRadius: 4,
        padding: '2px 7px',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.03em',
        fontFamily: 'inherit',
      }}
    >
      {tool}
    </span>
  );
}

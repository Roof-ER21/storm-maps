/**
 * ChatPage — scrollable chat body. Renders user/assistant bubbles, handles
 * POST /api/ai/chat, shows ToolBadges + ProposalCards on assistant messages.
 * Manages local message list + current threadId.
 */
import { useState, useRef, useEffect } from 'react';
import type { UiMessage, Proposal, BypassMode, AiModel } from './types';
import { ToolBadge } from './ToolBadge';
import { ProposalCard } from './ProposalCard';
import { ToolTrace } from './ToolTrace';
import { useUser } from '../auth/UserContext';

interface Props {
  pageContext?: string;
  /** Controlled from ChatDrawer when a thread is loaded externally. */
  messages: UiMessage[];
  threadId: number | null;
  onMessagesChange: (msgs: UiMessage[]) => void;
  onThreadIdChange: (id: number | null) => void;
}

const MODEL_LABELS: Record<AiModel, string> = {
  'gemini-2.0-flash': 'Gemini 2.0 Flash',
  'ollama-qwen25': 'Qwen 2.5 (local)',
};

/** Union of fields across the SSE event payloads from POST /api/ai/chat/stream. */
interface StreamEvent {
  threadId?: number;
  model?: AiModel;
  tool?: string;
  delta?: string;
  reply?: string;
  toolsUsed?: string[];
  proposals?: Proposal[];
  args?: Record<string, unknown>;
  danger?: 'safe' | 'destructive';
  description?: string;
  kind?: string;
  ok?: boolean;
  result?: string;
}

function MessageBubble({ msg, threadId }: { msg: UiMessage; threadId: number | null }) {
  const isUser = msg.role === 'user';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 14,
      }}
    >
      {/* Role label */}
      <div style={{ fontSize: 10, color: 'var(--riq-text-muted)', marginBottom: 4, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
        {isUser ? 'You' : 'RIQ 21'}
      </div>

      {/* Bubble */}
      <div
        style={{
          maxWidth: '88%',
          background: isUser ? 'rgba(244,167,56,0.14)' : 'var(--riq-surface)',
          border: `1px solid ${isUser ? 'rgba(244,167,56,0.35)' : 'var(--riq-border)'}`,
          borderRadius: isUser ? '10px 10px 2px 10px' : '10px 10px 10px 2px',
          padding: '10px 13px',
          fontSize: 13,
          color: 'var(--riq-text)',
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {msg.content}
      </div>

      {/* Tool trace (rich if streamed, else name badges) */}
      {!isUser && msg.toolCalls && msg.toolCalls.length > 0 ? (
        <ToolTrace calls={msg.toolCalls} />
      ) : !isUser && msg.toolsUsed && msg.toolsUsed.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5, maxWidth: '88%' }}>
          {msg.toolsUsed.map((t) => (
            <ToolBadge key={t} tool={t} />
          ))}
        </div>
      ) : null}

      {/* Model badge */}
      {!isUser && msg.model && (
        <div style={{ fontSize: 10, color: 'var(--riq-text-muted)', marginTop: 3 }}>
          {MODEL_LABELS[msg.model] ?? msg.model}
        </div>
      )}

      {/* Proposal cards */}
      {!isUser && msg.proposals && msg.proposals.length > 0 && (
        <div style={{ width: '88%', marginTop: 6 }}>
          {msg.proposals.map((p, i) => (
            <ProposalCard
              key={i}
              proposal={p}
              threadId={threadId ?? undefined}
              initialState={msg.proposalStates?.[i]}
              initialResult={msg.proposalResults?.[i]}
              initialError={msg.proposalErrors?.[i]}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ChatPage({ pageContext, messages, threadId, onMessagesChange, onThreadIdChange }: Props) {
  const { user } = useUser();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bypassMode, setBypassMode] = useState<BypassMode>('smart');
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isAdmin = user?.role === 'admin' || user?.is_root_admin === true;

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setError(null);

    const userMsg: UiMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    };
    const baseMsgs = [...messages, userMsg];
    onMessagesChange(baseMsgs);
    setLoading(true);

    // Streaming assistant message — mutated as SSE events arrive, re-pushed live.
    const assistant: UiMessage = {
      id: `a-${Date.now()}`,
      role: 'assistant',
      content: '',
      toolsUsed: [],
      toolCalls: [],
      proposals: [],
      created_at: new Date().toISOString(),
    };
    const pushAssistant = () => onMessagesChange([...baseMsgs, { ...assistant }]);
    let streaming = false;

    try {
      const res = await fetch('/api/ai/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          message: text,
          threadId: threadId ?? undefined,
          pageContext: pageContext ?? undefined,
          ...(isAdmin ? { bypassMode } : {}),
        }),
      });

      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}${body ? `: ${body}` : ''}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let sep: number;
        while ((sep = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, sep);
          buf = buf.slice(sep + 2);

          let event = '';
          let dataStr = '';
          for (const ln of block.split('\n')) {
            if (ln.startsWith('event:')) event = ln.slice(6).trim();
            else if (ln.startsWith('data:')) dataStr += ln.slice(5).trim();
          }
          if (!event || !dataStr) continue;

          let data: StreamEvent;
          try {
            data = JSON.parse(dataStr) as StreamEvent;
          } catch {
            continue;
          }

          if (event === 'meta') {
            if (data.threadId && data.threadId !== threadId) onThreadIdChange(data.threadId);
            if (data.model) assistant.model = data.model;
          } else if (event === 'tool') {
            if (data.tool) {
              assistant.toolsUsed = [...(assistant.toolsUsed ?? []), data.tool];
              assistant.toolCalls = [
                ...(assistant.toolCalls ?? []),
                { tool: data.tool, kind: data.kind, ok: data.ok, args: data.args, result: data.result },
              ];
            }
          } else if (event === 'proposal') {
            if (data.tool) {
              assistant.proposals = [
                ...(assistant.proposals ?? []),
                { tool: data.tool, args: data.args ?? {}, danger: data.danger ?? 'safe', description: data.description ?? '' },
              ];
            }
          } else if (event === 'token') {
            assistant.content += data.delta ?? '';
          } else if (event === 'done') {
            if (typeof data.reply === 'string') assistant.content = data.reply;
            if (Array.isArray(data.proposals)) assistant.proposals = data.proposals;
            if (Array.isArray(data.toolsUsed)) assistant.toolsUsed = data.toolsUsed;
            if (data.model) assistant.model = data.model;
          }

          if (!streaming) {
            streaming = true;
            setLoading(false); // first event in — hide "Thinking…", the streaming bubble takes over
          }
          pushAssistant();
        }
      }

      // Commit final state (covers a terminal event without a trailing blank line).
      pushAssistant();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Message list */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 16px 4px',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--riq-text-muted)',
              fontSize: 13,
              textAlign: 'center',
              padding: '40px 20px',
            }}
          >
            <div>
              <div style={{ fontSize: 28, marginBottom: 10 }}>✦</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Ask anything about your data</div>
              <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                Carriers, storm events, adjusters, jobs, leads —{' '}
                {pageContext ? `context: ${pageContext}` : 'all pages available'}
              </div>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} threadId={threadId} />
        ))}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 14 }}>
            <div
              style={{
                background: 'var(--riq-surface)',
                border: '1px solid var(--riq-border)',
                borderRadius: '10px 10px 10px 2px',
                padding: '10px 14px',
                fontSize: 13,
                color: 'var(--riq-text-muted)',
              }}
            >
              <span style={{ animation: 'pulse 1.2s infinite' }}>Thinking...</span>
            </div>
          </div>
        )}

        {error && (
          <div
            style={{
              background: 'rgba(220,50,50,0.10)',
              border: '1px solid rgba(220,50,50,0.35)',
              borderRadius: 8,
              padding: '10px 13px',
              fontSize: 12,
              color: '#e05050',
              marginBottom: 10,
            }}
          >
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div
        style={{
          flexShrink: 0,
          borderTop: '1px solid var(--riq-border)',
          padding: '10px 12px',
          background: 'var(--riq-surface)',
        }}
      >
        {/* Admin-only bypass mode selector */}
        {isAdmin && (
          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            {(['confirm', 'smart', 'full'] as BypassMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setBypassMode(mode)}
                style={{
                  background: bypassMode === mode ? 'rgba(244,167,56,0.18)' : 'transparent',
                  border: `1px solid ${bypassMode === mode ? 'var(--riq-accent)' : 'var(--riq-border)'}`,
                  color: bypassMode === mode ? 'var(--riq-accent)' : 'var(--riq-text-muted)',
                  borderRadius: 4,
                  padding: '3px 9px',
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                {mode}
              </button>
            ))}
            <span style={{ fontSize: 10, color: 'var(--riq-text-muted)', marginLeft: 4, alignSelf: 'center' }}>
              bypass
            </span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            placeholder="Ask about carriers, storms, jobs… (Enter to send)"
            rows={2}
            style={{
              flex: 1,
              background: 'var(--riq-bg)',
              border: '1px solid var(--riq-border)',
              borderRadius: 7,
              padding: '8px 11px',
              fontSize: 13,
              color: 'var(--riq-text)',
              resize: 'none',
              fontFamily: 'inherit',
              lineHeight: 1.5,
              outline: 'none',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--riq-accent)'; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--riq-border)'; }}
          />
          <button
            onClick={() => void sendMessage()}
            disabled={!input.trim() || loading}
            style={{
              background: input.trim() && !loading ? 'var(--riq-accent)' : 'rgba(244,167,56,0.25)',
              color: '#0c0c0e',
              border: 'none',
              borderRadius: 7,
              padding: '9px 15px',
              fontSize: 13,
              fontWeight: 700,
              cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit',
              flexShrink: 0,
              transition: 'background 0.15s',
              alignSelf: 'stretch',
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

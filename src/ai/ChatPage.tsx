/**
 * ChatPage — scrollable chat body. Renders user/assistant bubbles, handles
 * POST /api/ai/chat, shows ToolBadges + ProposalCards on assistant messages.
 * Manages local message list + current threadId.
 */
import { useState, useRef, useEffect } from 'react';
import type { UiMessage, ChatResponse, BypassMode, AiModel } from './types';
import { ToolBadge } from './ToolBadge';
import { ProposalCard } from './ProposalCard';
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
        {isUser ? 'You' : 'RIQ AI'}
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

      {/* Tool badges */}
      {!isUser && msg.toolsUsed && msg.toolsUsed.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5, maxWidth: '88%' }}>
          {msg.toolsUsed.map((t) => (
            <ToolBadge key={t} tool={t} />
          ))}
        </div>
      )}

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
    const nextMsgs = [...messages, userMsg];
    onMessagesChange(nextMsgs);
    setLoading(true);

    try {
      const res = await fetch('/api/ai/chat', {
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

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body}`);
      }

      const data: ChatResponse = await res.json();

      // Update threadId if new
      if (data.threadId && data.threadId !== threadId) {
        onThreadIdChange(data.threadId);
      }

      const assistantMsg: UiMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: data.reply,
        toolsUsed: data.toolsUsed,
        proposals: data.proposals,
        model: data.model,
        created_at: new Date().toISOString(),
      };

      onMessagesChange([...nextMsgs, assistantMsg]);
    } catch (err) {
      setError((err as Error).message);
      // Put the user message back so they can retry
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

/**
 * ChatDrawer — right-side slide-in overlay hosting ChatPage.
 * Contains ContextPill + ThreadList (collapsible). Controlled open/close
 * state is managed here; the parent receives a { open, toggle } ref via
 * onRef so the floating FAB in IntelligenceHub can trigger open/close.
 */
import { useState, useCallback, useEffect } from 'react';
import type { UiMessage } from './types';
import { ChatPage } from './ChatPage';
import { ContextPill } from './ContextPill';
import { ThreadList } from './ThreadList';
import { AuditPanel } from './AuditPanel';
import { useUser } from '../auth/UserContext';

interface Props {
  pageContext?: string;
}

/** Ref-style handle exposed to parent via data attribute (simpler than forwardRef for this use-case). */
export interface ChatDrawerHandle {
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: boolean;
}

// We expose toggle state via a custom DOM event on window so the FAB (which
// lives outside this component) can open/close without prop-drilling.
const DRAWER_OPEN_EVENT = 'riq:ai-drawer-open';
const DRAWER_CLOSE_EVENT = 'riq:ai-drawer-close';
const DRAWER_TOGGLE_EVENT = 'riq:ai-drawer-toggle';

export function ChatDrawer({ pageContext }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [threadId, setThreadId] = useState<number | null>(null);
  const { user } = useUser();
  const isAdmin = user?.role === 'admin' || user?.is_root_admin === true;

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  const handleNewChat = useCallback(() => {
    setMessages([]);
    setThreadId(null);
  }, []);

  const handleSelectThread = useCallback((msgs: UiMessage[], id: number) => {
    setMessages(msgs);
    setThreadId(id);
  }, []);

  // Listen for window-level events from the FAB
  useEffect(() => {
    const handleOpen = () => open();
    const handleClose = () => close();
    const handleToggle = () => toggle();

    window.addEventListener(DRAWER_OPEN_EVENT, handleOpen);
    window.addEventListener(DRAWER_CLOSE_EVENT, handleClose);
    window.addEventListener(DRAWER_TOGGLE_EVENT, handleToggle);
    return () => {
      window.removeEventListener(DRAWER_OPEN_EVENT, handleOpen);
      window.removeEventListener(DRAWER_CLOSE_EVENT, handleClose);
      window.removeEventListener(DRAWER_TOGGLE_EVENT, handleToggle);
    };
  }, [open, close, toggle]);

  // Dismiss on Escape
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, close]);

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          onClick={close}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(10,10,12,0.45)',
            backdropFilter: 'blur(2px)',
            zIndex: 1099,
          }}
          aria-hidden="true"
        />
      )}

      {/* Drawer panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="RIQ 21"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(420px, 92vw)',
          background: 'var(--riq-bg)',
          borderLeft: '1px solid var(--riq-border)',
          zIndex: 1100,
          display: 'flex',
          flexDirection: 'column',
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
          boxShadow: isOpen ? '-8px 0 40px rgba(0,0,0,0.5)' : 'none',
        }}
      >
        {/* Header */}
        <div
          style={{
            flexShrink: 0,
            borderBottom: '1px solid var(--riq-border)',
            padding: '12px 14px',
            background: 'var(--riq-surface)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--riq-accent)', letterSpacing: '-0.01em' }}>
                ✦ RIQ 21
              </span>
              {pageContext && <ContextPill pageContext={pageContext} />}
            </div>
            <button
              onClick={close}
              aria-label="Close RIQ 21"
              style={{
                background: 'transparent',
                border: '1px solid var(--riq-border)',
                color: 'var(--riq-text-muted)',
                borderRadius: 5,
                width: 28,
                height: 28,
                fontSize: 16,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'inherit',
                flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>

          {/* Thread list (collapsible) */}
          <ThreadList
            activeThreadId={threadId}
            onSelectThread={handleSelectThread}
            onNewChat={handleNewChat}
          />

          {isAdmin && <AuditPanel />}
        </div>

        {/* Chat body — fills remaining space */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <ChatPage
            pageContext={pageContext}
            messages={messages}
            threadId={threadId}
            onMessagesChange={setMessages}
            onThreadIdChange={setThreadId}
          />
        </div>
      </div>
    </>
  );
}

/** Dispatch window events so the FAB (rendered outside ChatDrawer) can
 *  open/close without prop drilling through IntelligenceHub. */
export function dispatchDrawerToggle() {
  window.dispatchEvent(new Event(DRAWER_TOGGLE_EVENT));
}
export function dispatchDrawerOpen() {
  window.dispatchEvent(new Event(DRAWER_OPEN_EVENT));
}
export function dispatchDrawerClose() {
  window.dispatchEvent(new Event(DRAWER_CLOSE_EVENT));
}

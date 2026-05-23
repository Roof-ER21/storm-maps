/**
 * Shared type definitions for the Phase 6 AI Assistant UI.
 * All shapes mirror the live /api/ai/* backend contract exactly.
 */

export type DangerLevel = 'safe' | 'destructive';
export type BypassMode = 'confirm' | 'smart' | 'full';
export type AiModel = 'gemini-2.0-flash' | 'ollama-qwen25';

export interface Proposal {
  tool: string;
  args: Record<string, unknown>;
  danger: DangerLevel;
  description: string;
}

export interface ChatResponse {
  threadId: number;
  reply: string;
  proposals: Proposal[];
  toolsUsed: string[];
  model: AiModel;
}

export interface ChatRequest {
  message: string;
  threadId?: number;
  pageContext?: string;
  localOnly?: boolean;
  bypassMode?: BypassMode;
}

export interface ConfirmRequest {
  tool: string;
  args: Record<string, unknown>;
  threadId?: number;
}

export interface ConfirmResponse {
  ok: boolean;
  tool: string;
  data?: unknown;
  error?: string;
}

export interface ThreadSummary {
  id: number;
  title: string;
  updated_at: string;
}

export interface ThreadsResponse {
  threads: ThreadSummary[];
}

export interface MessageRecord {
  role: 'user' | 'assistant' | 'system';
  content: string;
  tool_calls?: unknown;
  created_at: string;
}

export interface ThreadDetail {
  thread: { id: number; title: string };
  messages: MessageRecord[];
}

/** A chat message as stored in local UI state (superset of MessageRecord). */
export interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolsUsed?: string[];
  proposals?: Proposal[];
  model?: AiModel;
  /** Confirmed/dismissed proposals by index */
  proposalStates?: Record<number, 'pending' | 'confirmed' | 'dismissed' | 'error'>;
  proposalResults?: Record<number, unknown>;
  proposalErrors?: Record<number, string>;
  created_at: string;
}

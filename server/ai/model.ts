/**
 * Phase 6 — model layer. Gemini 2.0 Flash (default) + local Ollama qwen2.5
 * fallback, behind one normalized `generate()` so the chat loop is
 * model-agnostic. Both do function-calling with the same tool schema.
 */
import { GoogleGenAI } from '@google/genai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://shadow21:4001';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'local-qwen25:32b';

let gemini: GoogleGenAI | undefined;
if (GEMINI_API_KEY) gemini = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

export type ModelId = 'gemini-2.0-flash' | 'ollama-qwen25';

export interface GenMessage { role: 'user' | 'assistant' | 'tool'; content: string; }
export interface GenTool { name: string; description: string; parameters: Record<string, unknown>; }
export interface GenResult {
  text: string;
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
  model: ModelId;
}

/** §5.3 selection: explicit local-only pref or missing Gemini key ⇒ Ollama. */
export function selectModel(opts: { localOnly?: boolean } = {}): ModelId {
  if (opts.localOnly) return 'ollama-qwen25';
  if (!gemini) return 'ollama-qwen25';
  return 'gemini-2.0-flash';
}

export async function generate(
  model: ModelId,
  input: { system: string; messages: GenMessage[]; tools: GenTool[] },
): Promise<GenResult> {
  return model === 'ollama-qwen25' ? generateOllama(input) : generateGemini(input);
}

async function generateGemini(input: { system: string; messages: GenMessage[]; tools: GenTool[] }): Promise<GenResult> {
  if (!gemini) throw new Error('gemini_unavailable: GEMINI_API_KEY not configured');
  const contents = input.messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user', // tool results fed back as user text
    parts: [{ text: m.content }],
  }));
  const response = await gemini.models.generateContent({
    model: 'gemini-2.0-flash',
    contents,
    config: {
      systemInstruction: input.system,
      temperature: 0.3,
      tools: input.tools.length ? [{ functionDeclarations: input.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters as never })) }] : undefined,
    },
  });
  const toolCalls = (response.functionCalls ?? []).map((fc) => ({
    name: String(fc.name),
    args: (fc.args ?? {}) as Record<string, unknown>,
  }));
  return { text: response.text ?? '', toolCalls, model: 'gemini-2.0-flash' };
}

async function generateOllama(input: { system: string; messages: GenMessage[]; tools: GenTool[] }): Promise<GenResult> {
  const body = {
    model: OLLAMA_MODEL,
    temperature: 0.3,
    messages: [
      { role: 'system', content: input.system },
      ...input.messages.map((m) => ({ role: m.role === 'tool' ? 'user' : m.role, content: m.content })),
    ],
    tools: input.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
  };
  const r = await fetch(`${OLLAMA_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`ollama_error: HTTP ${r.status}`);
  const j = (await r.json()) as { choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ function: { name: string; arguments: string } }> } }> };
  const msg = j.choices?.[0]?.message ?? {};
  const toolCalls = (msg.tool_calls ?? []).map((tc) => {
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* leave empty */ }
    return { name: tc.function.name, args };
  });
  return { text: msg.content ?? '', toolCalls, model: 'ollama-qwen25' };
}

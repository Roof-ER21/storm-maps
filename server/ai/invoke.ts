/**
 * Phase 6 — tool invoker. Executes a tool by self-fetching its backing
 * `/api/...` endpoint on this same server (loopback), so read tools reuse the
 * exact intel-endpoint logic with no duplicated data code.
 *
 * Role gating happens upstream (registry.canUseTool) before this is called.
 */
import type { ToolDef } from './registry.js';

const PORT = process.env.PORT || '3100';
const BASE = `http://127.0.0.1:${PORT}`;

export interface InvokeResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export async function invokeTool(tool: ToolDef, args: Record<string, unknown>): Promise<InvokeResult> {
  // Fill `:param` path segments; the rest become query (GET/DELETE) or JSON body.
  const used = new Set<string>();
  const path = tool.path.replace(/:(\w+)/g, (_m, k: string) => {
    used.add(k);
    return encodeURIComponent(String(args[k] ?? ''));
  });
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (!used.has(k) && v != null) rest[k] = v;
  }

  try {
    let url = BASE + path;
    const init: RequestInit = {
      method: tool.method,
      headers: { 'content-type': 'application/json', 'x-riq-ai-internal': '1' },
      signal: AbortSignal.timeout(20000),
    };
    if (tool.method === 'GET' || tool.method === 'DELETE') {
      const qs = new URLSearchParams(
        Object.entries(rest).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]),
      ).toString();
      if (qs) url += (url.includes('?') ? '&' : '?') + qs;
    } else {
      init.body = JSON.stringify(rest);
    }

    const res = await fetch(url, init);
    const raw = await res.text();
    let data: unknown;
    try { data = JSON.parse(raw); } catch { data = raw; }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, data };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Compact a tool result for the model + the audit log (avoid dumping megabytes). */
export function summarize(data: unknown, max = 6000): string {
  let s: string;
  try { s = typeof data === 'string' ? data : JSON.stringify(data); } catch { s = String(data); }
  return s.length > max ? s.slice(0, max) + `…[truncated ${s.length - max} chars]` : s;
}

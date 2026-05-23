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

/**
 * Compact a tool result for the model. Array-aware: when a result is too large
 * it is truncated by WHOLE elements (never sliced mid-JSON) and tagged with the
 * true total + an instruction not to guess past it — so the model sees the data
 * is partial instead of silently inventing the missing rows. The budget is
 * generous on purpose: feeding the full set (e.g. all reps) is what lets
 * "top N under X" filters answer correctly. A blind 6 KB cap is what made the
 * assistant fabricate reps it never received.
 */
export function summarize(data: unknown, maxChars = 200_000): string {
  const stringify = (v: unknown): string => {
    try { return typeof v === 'string' ? v : JSON.stringify(v); } catch { return String(v); }
  };

  // Locate a primary array to truncate by element: the value itself, or the
  // first array-valued property of a top-level object (e.g. {reps:[…]}).
  let arr: unknown[] | null = null;
  let rebuild: (slice: unknown[]) => unknown = (s) => s;
  if (Array.isArray(data)) {
    arr = data;
  } else if (data && typeof data === 'object') {
    const entry = Object.entries(data as Record<string, unknown>).find(([, v]) => Array.isArray(v));
    if (entry) {
      const [key] = entry;
      arr = (data as Record<string, unknown>)[key] as unknown[];
      rebuild = (s) => ({ ...(data as Record<string, unknown>), [key]: s });
    }
  }

  const full = stringify(arr ? rebuild(arr) : data);
  if (full.length <= maxChars) return full;

  if (arr) {
    // Largest whole-element prefix that fits the budget (binary search).
    let lo = 0, hi = arr.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (stringify(rebuild(arr.slice(0, mid))).length <= maxChars) lo = mid; else hi = mid - 1;
    }
    const kept = lo;
    return stringify(rebuild(arr.slice(0, kept))) +
      `\n[DATA TRUNCATED: ${arr.length} items total, only the first ${kept} shown — result too large to include in full. The other ${arr.length - kept} items are NOT shown. Do not infer, filter over, or invent the omitted items. If the question needs the complete set (totals, "top N under/over X", anything spanning all rows), tell the user the data was truncated and ask them to narrow it or use a more specific tool.]`;
  }

  // Non-array payload: hard cap with an honest marker.
  return full.slice(0, maxChars) +
    `\n[TRUNCATED ${full.length - maxChars} chars — result incomplete; do not invent the omitted content.]`;
}

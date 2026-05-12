/**
 * RIQ 21 API auth — allows two access modes:
 *
 *   1. SESSION (existing) — user has a valid Roof Docs admin/rep session cookie.
 *      Used by the RIQ 21 SPA + the static /public/*.html intel pages.
 *
 *   2. API KEY (new)      — request has an `x-riq-api-key` header that matches
 *      one of the keys in process.env.RIQ_API_KEYS (comma-separated).
 *      Used by external consumers like CC21, Susan, etc.
 *
 * AUTH_REQUIRED mode:
 *   "off"       — anyone can read intel (dev / staged rollout)
 *   "optional"  — same as "off" effectively for reads, but req.user populated when present
 *   "required"  — must have a session OR a valid API key
 *
 * CORS: requests from origins in RIQ_CORS_ORIGINS (comma-separated) get
 * Access-Control-Allow-Origin set. Default allows everything when unset.
 */
import type { Request, Response, NextFunction } from 'express';

const MODE = (process.env.AUTH_REQUIRED ?? 'optional').toLowerCase() as 'off' | 'optional' | 'required';

function parseList(v: string | undefined): string[] {
  return (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const API_KEYS = new Set(parseList(process.env.RIQ_API_KEYS));
const CORS_ORIGINS = parseList(process.env.RIQ_CORS_ORIGINS);

/** True if the request carries a valid x-riq-api-key. */
export function hasValidApiKey(req: Request): boolean {
  if (API_KEYS.size === 0) return false;
  const key = req.header('x-riq-api-key') ?? req.header('X-RIQ-API-Key');
  if (!key) return false;
  return API_KEYS.has(key);
}

/** Apply CORS headers for trusted intel-consumer origins. */
export function intelCors(req: Request, res: Response, next: NextFunction): void {
  const origin = req.header('Origin');
  if (origin) {
    const allow =
      CORS_ORIGINS.length === 0 // when unset, allow all (intel data is internal anyway)
      || CORS_ORIGINS.includes(origin)
      || CORS_ORIGINS.includes('*');
    if (allow) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-riq-api-key, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

/** Gate that requires session OR API key when AUTH_REQUIRED=required. */
export function requireIntelAuth(req: Request, res: Response, next: NextFunction): void {
  if (MODE !== 'required') {
    next();
    return;
  }
  if (req.user || hasValidApiKey(req)) {
    next();
    return;
  }
  res.status(401).json({
    error: 'auth_required',
    hint: 'Pass a session cookie OR x-riq-api-key header',
  });
}

/** Lookup name of the API consumer (for logging) — only the prefix is exposed. */
export function consumerLabel(req: Request): string {
  if (req.user) return `user:${req.user.email ?? req.user.id ?? 'unknown'}`;
  const key = req.header('x-riq-api-key') ?? req.header('X-RIQ-API-Key');
  if (key && API_KEYS.has(key)) return `apikey:${key.slice(0, 8)}…`;
  return 'anonymous';
}

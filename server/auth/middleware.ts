/**
 * Auth middleware. Resolves the session cookie into req.user / req.session
 * for downstream routes. Returns 401 when AUTH_REQUIRED=required and no
 * valid session is present.
 *
 * AUTH_REQUIRED:
 *   "off"      — skip entirely (legacy mode)
 *   "optional" — populate req.user when present, never reject (default for staged rollout)
 *   "required" — reject every /api/* request without a session, except open routes
 *
 * Open routes (always allowed): /api/auth/*, /health, /api/admin/scheduler
 *   when SCHEDULER_ADMIN_TOKEN header matches.
 */
import type { Request, Response, NextFunction } from "express";
import { sql } from "../db.js";
import { findSessionById, type UserRecord, type SessionRecord, type Role, SESSION_COOKIE } from "./services.js";

declare module "express-serve-static-core" {
  interface Request {
    user?: UserRecord;
    session?: SessionRecord;
  }
}

const MODE = (process.env.AUTH_REQUIRED ?? "optional").toLowerCase() as "off" | "optional" | "required";

const OPEN_PREFIXES = [
  "/api/auth/",
  "/health",
  "/api/health",                  // Hail Yes health endpoint path
  "/api/stats",                   // public landing-page widget
  "/api/regions",
  "/evidence/",
  "/api/reports/verify",          // public adjuster verify endpoint
  "/api/push/vapid-public",       // push subscribe needs the public key pre-auth
];

function isOpen(path: string, headers: Request["headers"]): boolean {
  if (OPEN_PREFIXES.some((p) => path.startsWith(p))) return true;
  // SCHEDULER_ADMIN_TOKEN env-var gate stays as a break-glass channel
  if (path.startsWith("/api/admin/")) {
    const tok = headers["x-admin-token"];
    if (typeof tok === "string" && tok.length > 0 && tok === process.env.SCHEDULER_ADMIN_TOKEN) {
      return true;
    }
  }
  return false;
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (MODE === "off") return next();

  const cookies = (req as { cookies?: Record<string, string> }).cookies ?? {};
  const sid = cookies[SESSION_COOKIE];
  if (sid) {
    try {
      const found = await findSessionById(sql, sid);
      if (found) {
        req.user = found.user;
        req.session = found.session;
      }
    } catch (err) {
      console.warn("[auth] session lookup failed:", (err as Error).message);
    }
  }

  if (MODE === "required" && !req.user && req.path.startsWith("/api/")) {
    if (!isOpen(req.path, req.headers)) {
      res.status(401).json({ error: "authentication required" });
      return;
    }
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) { res.status(401).json({ error: "authentication required" }); return; }
  next();
}

/** True iff the request carries a valid SCHEDULER_ADMIN_TOKEN header. */
export function hasAdminToken(req: Request): boolean {
  const tok = req.headers["x-admin-token"];
  const expected = process.env.SCHEDULER_ADMIN_TOKEN;
  return typeof tok === "string" && tok.length > 0 && !!expected && tok === expected;
}

/**
 * Cookie-admin OR x-admin-token gate — used for every /api/admin/* route.
 * Lets infra hit admin endpoints with a header (cron health probes, on-call)
 * without owning a session, while normal admin dashboard usage flows
 * through req.user.role === "admin" via the cookie.
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (roles.includes("admin") && hasAdminToken(req)) { next(); return; }
    if (!req.user) { res.status(401).json({ error: "authentication required" }); return; }
    // Root admin override: bypasses role check.
    if (req.user.is_root_admin) { next(); return; }
    if (!roles.includes(req.user.role)) { res.status(403).json({ error: "forbidden" }); return; }
    next();
  };
}

/** Shorthand for the common `requireRole("admin")` case. */
export const requireAdmin = requireRole("admin");

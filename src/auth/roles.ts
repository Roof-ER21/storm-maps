/**
 * RIQ 21 client-side role taxonomy. Mirrors server/auth/services.ts.
 *
 * Source of truth for which views each role can reach. Server `requireRole`
 * middleware is the real enforcement; this map drives nav visibility +
 * defensive client-side gating only.
 */

export type Role = "admin" | "exec" | "employee" | "analytics";

export const ALL_ROLES: readonly Role[] = ["admin", "exec", "employee", "analytics"] as const;

/** Per-role default home view. */
export const ROLE_HOME: Record<Role, string> = {
  admin:     "admin-home",
  exec:      "exec-home",
  employee:  "my-day",
  analytics: "data-room",
};

/**
 * Which roles can reach each view. Admin can reach everything (omitted views
 * default to admin-only). `is_root_admin = true` bypasses this client-side
 * (mirrored in server middleware).
 */
export const VIEW_ROLES: Record<string, readonly Role[]> = {
  // ── Role homes ────────────────────────────────────────────
  "admin-home":   ["admin"],
  "exec-home":    ["admin", "exec"],
  "my-day":       ["admin", "employee"],
  "data-room":    ["admin", "analytics"],

  // ── Universal surfaces ────────────────────────────────────
  "home":         ["admin", "exec", "employee", "analytics"],
  "master-guide": ["admin", "exec", "employee", "analytics"],

  // ── Hubs (new consolidated routes) ────────────────────────
  "carrier-hub":  ["admin", "exec", "employee", "analytics"],
  "storm-hub":    ["admin", "exec", "employee", "analytics"],
  "denial-hub":   ["admin", "employee", "analytics"],
  "adjuster-hub": ["admin", "employee", "analytics"],
  "rep-hub":      ["admin", "exec", "analytics"],
  "customer-hub": ["admin", "exec", "employee", "analytics"],
  "leads-hub":    ["admin", "exec", "employee", "analytics"],
  "pricing-hub":  ["admin", "analytics"],
  "zip-hub":      ["admin", "exec", "employee", "analytics"],

  // ── Standalone surfaces (Phase 2d will migrate these into React) ─────
  "exec":              ["admin", "exec"],
  "weekly-recap":      ["admin", "exec"],
  "analytics":         ["admin", "exec", "analytics"],
  "predictor":         ["admin", "employee", "analytics"],
  "field-guide":       ["admin", "employee", "analytics"],
  "cheat-sheet":       ["admin", "employee", "analytics"],
  "lead-score":        ["admin", "exec", "employee", "analytics"],
  "pipeline-intel":    ["admin", "exec", "analytics"],
  "lifetime-touch":    ["admin", "employee", "analytics"],
  "insurance-intel":   ["admin", "exec", "analytics"],
  "map":               ["admin", "exec", "employee", "analytics"],
  "campaigns":         ["admin", "employee", "analytics"],
  "solar":             ["admin", "employee", "analytics"],
  "ops-team":          ["admin", "exec", "employee", "analytics"],
  "notes":             ["admin", "employee", "analytics"],
  "receivables":       ["admin", "exec", "employee"],
  "active-work":       ["admin", "exec", "employee"],
  "scheduling":        ["admin", "employee"],
  "calendar":          ["admin", "exec", "employee"],
  "ops-surveillance":  ["admin", "exec", "employee"],
  "sms-reminders":     ["admin", "employee"],
  "carrier-orphans":   ["admin", "analytics"],
};

/**
 * Returns true if the user can reach a given view.
 * - is_root_admin always wins
 * - unknown view IDs default to admin-only (defensive)
 */
export function canAccess(
  view: string,
  user: { role: Role; is_root_admin: boolean } | null
): boolean {
  if (!user) return false;
  if (user.is_root_admin) return true;
  const allowed = VIEW_ROLES[view];
  if (!allowed) return user.role === "admin";
  return allowed.includes(user.role);
}

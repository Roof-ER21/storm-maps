import { Router, type Request } from "express";
import { z } from "zod";
import { sql } from "../db.js";
import {
  attemptLogin, createSession, findUserByEnrollToken, setPinForUser,
  revokeSession, revokeAllUserSessions, findUserById,
  SESSION_COOKIE,
} from "./services.js";

export const authRouter = Router();

const isProd = process.env.NODE_ENV === "production";
const COOKIE_OPTS = {
  httpOnly: true,
  secure: isProd,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 30 * 24 * 3600 * 1000,
};

const PinSchema = z.string().regex(/^\d{4,6}$/, "pin must be 4-6 digits");
const EmailSchema = z.string().email().max(254);

const LoginSchema = z.object({ email: EmailSchema, pin: PinSchema });
const EnrollSchema = z.object({ token: z.string().min(8).max(128), pin: PinSchema });
const ChangePinSchema = z.object({ current_pin: PinSchema, new_pin: PinSchema });

function clientIp(req: Request): string | null {
  return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip ?? null;
}

// ─── POST /api/auth/login ────────────────────────────────────────────────────
authRouter.post("/api/auth/login", async (req, res) => {
  const parse = LoginSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.issues }); return; }
  const result = await attemptLogin(sql, parse.data.email, parse.data.pin);
  if (!result.ok || !result.user) {
    if (result.reason === "locked") {
      res.status(429).json({ error: "account locked — try again in 15 minutes" });
    } else if (result.reason === "no-such-user" || result.reason === "wrong-pin") {
      // Don't leak which one — same response either way (anti-enumeration)
      res.status(401).json({ error: "wrong email or PIN" });
    } else if (result.reason === "no-pin-set") {
      res.status(409).json({ error: "PIN not set — check your enroll email" });
    } else {
      res.status(401).json({ error: "login failed" });
    }
    return;
  }
  const session = await createSession(sql, result.user.id,
    req.headers["user-agent"] ?? null, clientIp(req));
  res.cookie(SESSION_COOKIE, session.id, COOKIE_OPTS);
  res.json({
    user: {
      id: result.user.id, email: result.user.email,
      display_name: result.user.display_name, role: result.user.role,
      is_root_admin: result.user.is_root_admin, pin_length: result.user.pin_length,
    },
  });
});

// ─── POST /api/auth/logout ───────────────────────────────────────────────────
authRouter.post("/api/auth/logout", async (req, res) => {
  if (req.session?.id) await revokeSession(sql, req.session.id);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

// ─── POST /api/auth/logout-all ───────────────────────────────────────────────
authRouter.post("/api/auth/logout-all", async (req, res) => {
  if (!req.user) { res.status(401).json({ error: "unauthorized" }); return; }
  await revokeAllUserSessions(sql, req.user.id);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

// ─── GET /api/auth/me ────────────────────────────────────────────────────────
authRouter.get("/api/auth/me", async (req, res) => {
  if (!req.user) { res.status(401).json({ error: "unauthorized" }); return; }
  const extras = await sql<Array<{
    welcome_seen_at: string | null;
    phone: string | null;
    notification_prefs: Record<string, unknown>;
  }>>`
    SELECT welcome_seen_at::text, phone, notification_prefs
      FROM users WHERE id = ${req.user.id}
  `;
  res.json({
    user: {
      id: req.user.id, email: req.user.email,
      display_name: req.user.display_name, role: req.user.role,
      is_root_admin: req.user.is_root_admin, pin_length: req.user.pin_length,
      last_login_at: req.user.last_login_at,
      welcome_seen_at: extras[0]?.welcome_seen_at ?? null,
      phone: extras[0]?.phone ?? null,
      notification_prefs: extras[0]?.notification_prefs ?? {},
    },
  });
});

// ─── POST /api/auth/enroll/start ─────────────────────────────────────────────
// Public — caller submits the enroll_token from their invite email + new PIN
authRouter.post("/api/auth/enroll/start", async (req, res) => {
  const parse = EnrollSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.issues }); return; }
  const user = await findUserByEnrollToken(sql, parse.data.token);
  if (!user) { res.status(404).json({ error: "invalid or expired enroll token" }); return; }
  if (parse.data.pin.length !== user.pin_length) {
    res.status(400).json({ error: `PIN must be exactly ${user.pin_length} digits` });
    return;
  }
  await setPinForUser(sql, user.id, parse.data.pin);
  // Log them in immediately
  const session = await createSession(sql, user.id,
    req.headers["user-agent"] ?? null, clientIp(req));
  res.cookie(SESSION_COOKIE, session.id, COOKIE_OPTS);
  const u = await findUserById(sql, user.id);
  res.json({
    user: u && {
      id: u.id, email: u.email, display_name: u.display_name,
      role: u.role, is_root_admin: u.is_root_admin, pin_length: u.pin_length,
    },
  });
});

// ─── POST /api/auth/change-pin ───────────────────────────────────────────────
// Allow either matching the existing pin_length OR optionally switching
// length (e.g. 4 → 6) by passing { new_pin_length }.
const ChangePinSchemaV2 = z.object({
  current_pin: PinSchema,
  new_pin: PinSchema,
  new_pin_length: z.union([z.literal(4), z.literal(6)]).optional(),
});
authRouter.post("/api/auth/change-pin", async (req, res) => {
  if (!req.user) { res.status(401).json({ error: "unauthorized" }); return; }
  const parse = ChangePinSchemaV2.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.issues }); return; }
  const desiredLength = parse.data.new_pin_length ?? req.user.pin_length;
  if (parse.data.new_pin.length !== desiredLength) {
    res.status(400).json({ error: `PIN must be exactly ${desiredLength} digits` });
    return;
  }
  const result = await attemptLogin(sql, req.user.email, parse.data.current_pin);
  if (!result.ok) { res.status(401).json({ error: "current PIN incorrect" }); return; }
  if (desiredLength !== req.user.pin_length) {
    await sql`UPDATE users SET pin_length = ${desiredLength} WHERE id = ${req.user.id}`;
  }
  await setPinForUser(sql, req.user.id, parse.data.new_pin);
  res.json({ ok: true });
});

// ─── GET /api/auth/sessions — current user's session list ───────────────────
authRouter.get("/api/auth/sessions", async (req, res) => {
  if (!req.user) { res.status(401).json({ error: "unauthorized" }); return; }
  const rows = await sql`
    SELECT id::text, created_at::text, last_seen_at::text, expires_at::text,
      revoked_at::text, user_agent, ip_addr::text,
      ${req.session?.id ?? null}::uuid = id AS is_current
      FROM sessions
     WHERE user_id = ${req.user.id} AND revoked_at IS NULL
     ORDER BY last_seen_at DESC
     LIMIT 50
  `;
  res.json({ sessions: rows });
});

// ─── POST /api/auth/sessions/:id/revoke ─────────────────────────────────────
authRouter.post("/api/auth/sessions/:id/revoke", async (req, res) => {
  if (!req.user) { res.status(401).json({ error: "unauthorized" }); return; }
  const sid = req.params.id ?? "";
  // Caller can only revoke their own sessions
  await sql`
    UPDATE sessions SET revoked_at = NOW()
     WHERE id = ${sid}::uuid AND user_id = ${req.user.id}
  `;
  res.json({ ok: true });
});

// ─── POST /api/auth/welcome-seen — flag the rep welcome as dismissed ────────
authRouter.post("/api/auth/welcome-seen", async (req, res) => {
  if (!req.user) { res.status(401).json({ error: "unauthorized" }); return; }
  await sql`UPDATE users SET welcome_seen_at = NOW() WHERE id = ${req.user.id}`;
  res.json({ ok: true });
});

/**
 * Auth service — PIN hashing, session lifecycle, root-admin protection.
 *
 * Storage:
 *   - users.pin_hash    : argon2id(pin)         — never reversible
 *   - sessions.id       : opaque UUID         — sent as httpOnly cookie
 *   - users.is_root_admin TRUE for exactly one user (Ahmed); enforced by
 *     a partial unique index AND in-app middleware.
 *
 * Cookie:
 *   storm_session=<uuid>; HttpOnly; Secure; SameSite=Lax; Path=/
 *   Sliding 30-day TTL, hard cap 90 days from creation.
 */
import argon2 from "argon2";
import { randomBytes } from "node:crypto";
import type { Sql } from "../db.js";

export const SESSION_COOKIE = "storm_session";
const SESSION_SLIDING_DAYS = 30;
const SESSION_HARD_CAP_DAYS = 90;
const LOCKOUT_FAILS = 5;
const LOCKOUT_MINUTES = 15;

export type Role = "rep" | "admin" | "manager";

export interface UserRecord {
  id: number;
  email: string;
  display_name: string | null;
  role: Role;
  pin_length: 4 | 6;
  is_root_admin: boolean;
  pin_set_at: string | null;
  last_login_at: string | null;
  created_at: string;
  archived_at: string | null;
  failed_attempts: number;
  locked_until: string | null;
}

export interface SessionRecord {
  id: string;
  user_id: number;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
}

const ARGON_OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024,   // 19 MiB — OWASP minimum
  timeCost: 2,
  parallelism: 1,
};

export async function hashPin(pin: string): Promise<string> {
  return argon2.hash(pin, ARGON_OPTS);
}

export async function verifyPin(hash: string, pin: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, pin);
  } catch { return false; }
}

export function generateEnrollToken(): string {
  return randomBytes(24).toString("base64url");
}

// ─── User CRUD ───────────────────────────────────────────────────────────────
export async function findUserByEmail(sql: Sql, email: string): Promise<UserRecord | null> {
  const rows = await sql<UserRecord[]>`
    SELECT id, email, display_name, role, pin_length, is_root_admin,
      pin_set_at::text, last_login_at::text, created_at::text,
      archived_at::text, failed_attempts, locked_until::text
    FROM users WHERE email = ${email.toLowerCase()} AND archived_at IS NULL
  `;
  return rows[0] ?? null;
}

export async function findUserById(sql: Sql, id: number): Promise<UserRecord | null> {
  const rows = await sql<UserRecord[]>`
    SELECT id, email, display_name, role, pin_length, is_root_admin,
      pin_set_at::text, last_login_at::text, created_at::text,
      archived_at::text, failed_attempts, locked_until::text
    FROM users WHERE id = ${id}
  `;
  return rows[0] ?? null;
}

export async function findUserByEnrollToken(
  sql: Sql, token: string,
): Promise<UserRecord | null> {
  const rows = await sql<UserRecord[]>`
    SELECT id, email, display_name, role, pin_length, is_root_admin,
      pin_set_at::text, last_login_at::text, created_at::text,
      archived_at::text, failed_attempts, locked_until::text
    FROM users WHERE enroll_token = ${token}
      AND enroll_expires > NOW()
      AND archived_at IS NULL
  `;
  return rows[0] ?? null;
}

export async function setPinForUser(
  sql: Sql, userId: number, pin: string,
): Promise<void> {
  const hash = await hashPin(pin);
  await sql`
    UPDATE users
       SET pin_hash = ${hash},
           pin_set_at = NOW(),
           enroll_token = NULL,
           enroll_expires = NULL,
           failed_attempts = 0,
           locked_until = NULL
     WHERE id = ${userId}
  `;
}

// ─── Sessions ────────────────────────────────────────────────────────────────
export async function createSession(
  sql: Sql, userId: number, userAgent: string | null, ipAddr: string | null,
): Promise<SessionRecord> {
  const expiresAt = new Date(Date.now() + SESSION_SLIDING_DAYS * 24 * 3600_000);
  const rows = await sql<SessionRecord[]>`
    INSERT INTO sessions (user_id, expires_at, user_agent, ip_addr)
    VALUES (${userId}, ${expiresAt.toISOString()},
            ${userAgent ?? null}, ${ipAddr ?? null}::inet)
    RETURNING id, user_id, created_at::text, last_seen_at::text, expires_at::text
  `;
  await sql`UPDATE users SET last_login_at = NOW() WHERE id = ${userId}`;
  return rows[0]!;
}

interface SessionJoinRow {
  sid: string;
  uid: number;
  s_created_at: string;
  s_last_seen_at: string;
  s_expires_at: string;
  id: number;
  email: string;
  display_name: string | null;
  role: Role;
  pin_length: 4 | 6;
  is_root_admin: boolean;
  pin_set_at: string | null;
  last_login_at: string | null;
  user_created_at: string;
  archived_at: string | null;
  failed_attempts: number;
  locked_until: string | null;
}

export async function findSessionById(
  sql: Sql, id: string,
): Promise<{ session: SessionRecord; user: UserRecord } | null> {
  const rows = await sql<SessionJoinRow[]>`
    SELECT s.id::text AS sid, s.user_id AS uid,
           s.created_at::text   AS s_created_at,
           s.last_seen_at::text AS s_last_seen_at,
           s.expires_at::text   AS s_expires_at,
           u.id, u.email, u.display_name, u.role, u.pin_length,
           u.is_root_admin, u.pin_set_at::text, u.last_login_at::text,
           u.created_at::text AS user_created_at, u.archived_at::text,
           u.failed_attempts, u.locked_until::text
      FROM sessions s
      JOIN users u ON u.id = s.user_id
     WHERE s.id = ${id}::uuid
       AND s.revoked_at IS NULL
       AND s.expires_at > NOW()
       AND u.archived_at IS NULL
       AND s.created_at > NOW() - INTERVAL '${sql.unsafe(String(SESSION_HARD_CAP_DAYS))} days'
  `;
  if (rows.length === 0) return null;
  const r = rows[0]!;
  await sql`
    UPDATE sessions SET
      last_seen_at = NOW(),
      expires_at = NOW() + INTERVAL '${sql.unsafe(String(SESSION_SLIDING_DAYS))} days'
    WHERE id = ${id}::uuid
  `;
  return {
    session: {
      id: r.sid,
      user_id: r.uid,
      created_at: r.s_created_at,
      last_seen_at: r.s_last_seen_at,
      expires_at: r.s_expires_at,
    },
    user: {
      id: r.id, email: r.email, display_name: r.display_name,
      role: r.role, pin_length: r.pin_length, is_root_admin: r.is_root_admin,
      pin_set_at: r.pin_set_at, last_login_at: r.last_login_at,
      created_at: r.user_created_at,
      archived_at: r.archived_at, failed_attempts: r.failed_attempts,
      locked_until: r.locked_until,
    },
  };
}

export async function revokeSession(sql: Sql, id: string): Promise<void> {
  await sql`UPDATE sessions SET revoked_at = NOW() WHERE id = ${id} AND revoked_at IS NULL`;
}

export async function revokeAllUserSessions(sql: Sql, userId: number): Promise<void> {
  await sql`UPDATE sessions SET revoked_at = NOW() WHERE user_id = ${userId} AND revoked_at IS NULL`;
}

// ─── Login / lockout ─────────────────────────────────────────────────────────
export interface LoginResult {
  ok: boolean;
  user?: UserRecord;
  reason?: "no-such-user" | "no-pin-set" | "locked" | "wrong-pin" | "archived";
}

export async function attemptLogin(
  sql: Sql, email: string, pin: string,
): Promise<LoginResult> {
  const user = await findUserByEmail(sql, email);
  if (!user) return { ok: false, reason: "no-such-user" };
  if (user.archived_at) return { ok: false, reason: "archived" };
  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    return { ok: false, reason: "locked" };
  }
  const hashRow = await sql<Array<{ pin_hash: string | null }>>`
    SELECT pin_hash FROM users WHERE id = ${user.id}
  `;
  const hash = hashRow[0]?.pin_hash ?? null;
  if (!hash) return { ok: false, reason: "no-pin-set" };

  const ok = await verifyPin(hash, pin);
  if (!ok) {
    const newFails = user.failed_attempts + 1;
    if (newFails >= LOCKOUT_FAILS) {
      await sql`
        UPDATE users
           SET failed_attempts = ${newFails},
               locked_until = NOW() + INTERVAL '${sql.unsafe(String(LOCKOUT_MINUTES))} minutes'
         WHERE id = ${user.id}
      `;
    } else {
      await sql`UPDATE users SET failed_attempts = ${newFails} WHERE id = ${user.id}`;
    }
    return { ok: false, reason: "wrong-pin" };
  }
  await sql`UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ${user.id}`;
  return { ok: true, user };
}

// ─── Root-admin protection helpers ───────────────────────────────────────────
export class RootAdminProtectedError extends Error {
  constructor() {
    super("cannot modify root admin");
    this.name = "RootAdminProtectedError";
  }
}

export async function assertNotRootAdmin(sql: Sql, userId: number): Promise<void> {
  const rows = await sql<Array<{ is_root_admin: boolean }>>`
    SELECT is_root_admin FROM users WHERE id = ${userId}
  `;
  if (rows[0]?.is_root_admin) throw new RootAdminProtectedError();
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────
export interface BootstrapResult {
  status: "created" | "exists";
  user: UserRecord;
  enroll_token?: string;
}

/**
 * Idempotent bootstrap of the root admin. On first boot creates Ahmed
 * with role='admin', is_root_admin=true, and a fresh enroll_token. On
 * subsequent boots returns the existing row.
 */
export async function bootstrapRootAdmin(
  sql: Sql, email: string, displayName: string,
): Promise<BootstrapResult> {
  const existing = await findUserByEmail(sql, email);
  if (existing && existing.is_root_admin) {
    return { status: "exists", user: existing };
  }
  if (existing && !existing.is_root_admin) {
    // Promote to root admin (one-time idempotent)
    await sql`
      UPDATE users SET role = 'admin', is_root_admin = TRUE WHERE id = ${existing.id}
    `;
    const promoted = await findUserById(sql, existing.id);
    return { status: "created", user: promoted! };
  }
  const enrollToken = generateEnrollToken();
  const enrollExpires = new Date(Date.now() + 7 * 24 * 3600_000); // 7 days
  const rows = await sql<UserRecord[]>`
    INSERT INTO users (email, display_name, role, pin_length, is_root_admin,
      enroll_token, enroll_expires)
    VALUES (${email.toLowerCase()}, ${displayName}, 'admin', 6, TRUE,
            ${enrollToken}, ${enrollExpires.toISOString()})
    RETURNING id, email, display_name, role, pin_length, is_root_admin,
      pin_set_at::text, last_login_at::text, created_at::text,
      archived_at::text, failed_attempts, locked_until::text
  `;
  return { status: "created", user: rows[0]!, enroll_token: enrollToken };
}

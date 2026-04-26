/**
 * Admin endpoint auth.
 *
 * Two paths are accepted:
 *   1. `Authorization: Bearer <ADMIN_TOKEN>` — env-configured shared secret.
 *      Easiest path for Railway dashboards / cron / scripts.
 *   2. `Authorization: Bearer <user JWT>` — a logged-in user with
 *      `plan = 'company'`. Reuses the existing JWT issuer used by the
 *      AI routes; no new auth surface to maintain.
 *
 * Without ADMIN_TOKEN set the endpoints stay open in dev (so local
 * testing isn't a hassle). Set ADMIN_TOKEN in production.
 */

import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { sql as pgSql } from '../db.js';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN?.trim() || '';
const JWT_SECRET =
  process.env.JWT_SECRET || 'hail-yes-dev-secret-change-in-production';
// Hardcoded admin emails as a backstop; any user with plan='company' also
// passes via the JWT path.
const ADMIN_EMAIL_ALLOWLIST = new Set(
  (process.env.ADMIN_EMAILS || 'ahmed@theroofdocs.com')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

interface TokenPayload {
  userId: number;
  email: string;
}

interface UserRow {
  plan: string | null;
  email: string | null;
}

function isAdminConfigured(): boolean {
  return Boolean(ADMIN_TOKEN);
}

async function checkJwtAdmin(authHeader: string): Promise<boolean> {
  if (!authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);
  if (!token || token === ADMIN_TOKEN) return false;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;
    if (!decoded.userId) return false;
    if (
      decoded.email &&
      ADMIN_EMAIL_ALLOWLIST.has(decoded.email.toLowerCase())
    ) {
      return true;
    }
    if (!pgSql) return false;
    const rows = await pgSql<UserRow[]>`
      SELECT plan, email FROM users WHERE id = ${decoded.userId} LIMIT 1
    `;
    const user = rows[0];
    if (!user) return false;
    if (user.plan === 'company') return true;
    if (user.email && ADMIN_EMAIL_ALLOWLIST.has(user.email.toLowerCase())) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Dev mode: ADMIN_TOKEN unset → leave admin endpoints open. We log so it's
  // visible during deployment that the lock is missing.
  if (!isAdminConfigured()) {
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '[admin-auth] ADMIN_TOKEN is unset in production — admin endpoints are world-readable.',
      );
    }
    next();
    return;
  }

  const authHeader = req.headers.authorization ?? '';
  // Bearer-token path
  if (authHeader === `Bearer ${ADMIN_TOKEN}`) {
    next();
    return;
  }
  // JWT-admin path
  void checkJwtAdmin(authHeader).then((isAdmin) => {
    if (isAdmin) {
      next();
      return;
    }
    res
      .status(401)
      .json({ error: 'admin auth required (Authorization: Bearer <token>)' });
  });
}

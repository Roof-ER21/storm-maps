/**
 * AI Auth Middleware — Gates AI endpoints behind authentication
 * and enforces plan-based scan limits.
 *
 * Free plan: 10 AI scans per month
 * Pro plan: 200 AI scans per month
 * Company plan: Unlimited
 */
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { sql as pgSql } from '../db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'hail-yes-dev-secret-change-in-production';

// Monthly scan limits per plan
const PLAN_LIMITS: Record<string, number> = {
  free: 10,
  pro: 200,
  company: Infinity,
};

interface TokenPayload {
  userId: number;
  email: string;
}

/**
 * Middleware that optionally validates a JWT and attaches user info to req.
 * Requests without a token (or with an invalid token) are allowed through as
 * anonymous — scan limits and IP-based rate limiting handle abuse prevention.
 *
 * Authenticated users: plan-based monthly limits apply.
 * Anonymous users: generous free tier enforced by the IP rate limiter.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(auth.slice(7), JWT_SECRET) as TokenPayload;
      (req as any).userId = decoded.userId;
      (req as any).userEmail = decoded.email;
    } catch {
      // Invalid token — continue as anonymous
    }
  }
  // Always allow through — scan limits handle abuse prevention
  next();
}

/**
 * Middleware that checks if the user has remaining AI scans.
 * Only applies to POST routes that trigger analysis.
 * GET routes pass through without checking.
 */
export function checkScanLimit(req: Request, res: Response, next: NextFunction): void {
  // GET requests don't consume scans
  if (req.method === 'GET' || req.method === 'HEAD') {
    next();
    return;
  }

  // Skip if no auth is configured (dev mode)
  if (!(req as any).userId) {
    next();
    return;
  }

  const userId = (req as any).userId;

  // Check plan and scan count
  pgSql`SELECT plan, ai_scans_this_month, ai_scan_reset_at FROM users WHERE id = ${userId}`
    .then((result) => {
      const user = result[0] as { plan: string; ai_scans_this_month: number | null; ai_scan_reset_at: string | null } | undefined;
      if (!user) {
        res.status(401).json({ error: 'User not found' });
        return;
      }

      const plan = user.plan || 'free';
      const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;

      // Reset monthly counter if needed
      const resetAt = user.ai_scan_reset_at ? new Date(user.ai_scan_reset_at) : null;
      const now = new Date();
      if (!resetAt || resetAt < now) {
        // Reset counter — will be updated when scan completes
        next();
        return;
      }

      const scans = user.ai_scans_this_month ?? 0;
      if (scans >= limit) {
        res.status(429).json({
          error: `Monthly scan limit reached (${limit} scans on ${plan} plan). Upgrade for more.`,
          plan,
          used: scans,
          limit,
        });
        return;
      }

      next();
    })
    .catch(() => {
      // If check fails, allow through (don't block on monitoring failure)
      next();
    });
}

/**
 * AI Auth Middleware — attaches authenticated user context when present.
 *
 * Hail Yes! is currently admin-default and non-paywalled. These middleware
 * hooks remain in the route chain so abuse controls can be reintroduced
 * deliberately later without changing route wiring.
 */
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'hail-yes-dev-secret-change-in-production';

interface TokenPayload {
  userId: number;
  email: string;
}

interface AuthenticatedRequest extends Request {
  userId?: number;
  userEmail?: string;
}

/**
 * Middleware that optionally validates a JWT and attaches user info to req.
 * Requests without a token or with an invalid token continue as anonymous.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(auth.slice(7), JWT_SECRET) as TokenPayload;
      const authedReq = req as AuthenticatedRequest;
      authedReq.userId = decoded.userId;
      authedReq.userEmail = decoded.email;
    } catch {
      // Invalid token — continue as anonymous
    }
  }
  next();
}

/**
 * Placeholder for future operational abuse controls. This intentionally does
 * not enforce subscription tiers or monthly scan caps.
 */
export function checkScanLimit(req: Request, res: Response, next: NextFunction): void {
  void req;
  void res;
  next();
}

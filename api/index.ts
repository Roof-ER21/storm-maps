// Vercel serverless entry — API-only Express app.
// Static files (dist/) are served by Vercel's CDN; no need for express.static here.
// Skips fileURLToPath / __dirname entirely to avoid Vercel ESM URL issues.
import express from 'express';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from '../server/auth/middleware.js';
import { authRouter } from '../server/auth/routes.js';
import { intelRouter } from '../server/intel/routes.js';

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '30mb' }));
app.use(cookieParser());
app.use(authMiddleware);
app.use(authRouter);
app.use(intelRouter);
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, try again later' },
}));
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'riq21-vercel', timestamp: new Date().toISOString() });
});
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'riq21-vercel' });
});

export default app;

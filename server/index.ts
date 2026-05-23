/**
 * RIQ 21 server entry — slim Express server for the Roofing IQ platform.
 *
 * Mounts only what RIQ needs:
 *   • /api/auth/*      (admin bootstrap + session login from server/auth)
 *   • /api/intel/*     (the RIQ data API — server/intel)
 *   • /api/health      (monitoring)
 *   • static dist + public (SPA + intel HTML pages)
 *
 * The 2,961-line legacy index that served Hail Yes (storm/MRMS/NEXRAD/AI
 * analysis routes) is archived at server/index-legacy.ts and slated for
 * deletion alongside server/storm/, server/property/, server/sa-port/, and
 * the AI route handlers.
 */
// Env loaded via tsx --env-file=.env.local in dev, Railway/launchd in prod.
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';

import { sql as pgSql } from './db.js';
import { authMiddleware } from './auth/middleware.js';
import { authRouter } from './auth/routes.js';
import { intelRouter } from './intel/routes.js';
import { aiRouter } from './ai/router.js';
import { startRefreshScheduler } from './intel/scheduler.js';

const JWT_SECRET = process.env.JWT_SECRET || 'riq21-dev-secret-change-in-production';
const ADMIN_EMAIL = (process.env.ADMIN_EMAILS || 'ahmed@theroofdocs.com')
  .split(',')[0]
  .trim()
  .toLowerCase();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, '../dist');
const PUBLIC_DIR = path.join(__dirname, '../public');

const app = express();
app.set('trust proxy', 1);
const PORT = parseInt(process.env.PORT || '3100', 10);

app.use(express.json({ limit: '30mb' })); // bumped for denial PDF/image uploads (base64 inflates ~33%)
app.use(cookieParser());

// PIN/session auth — populates req.user/req.session from session cookie when
// AUTH_REQUIRED=required, the upstream middleware rejects unauthenticated
// requests for non-open routes. /api/intel/* additionally accepts an API key
// via the x-riq-api-key header (see server/intel/auth.ts).
app.use(authMiddleware);
app.use(authRouter);
app.use(intelRouter);
app.use(aiRouter); // Phase 6 — /api/ai/*

// Rate limiting — 2000/15min sustained is enough for any real RIQ workload
// (the heaviest endpoint is /api/intel/projects @ ~38 MB and that's cached).
app.use(
  '/api/',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 2000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, try again later' },
  }),
);

// ── Health ──────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'riq21', timestamp: new Date().toISOString() });
});
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'riq21' });
});

// ── Admin bootstrap (preserved from legacy server) ──────
// Mints a JWT for the seeded admin user so the SPA can hit /api/admin/* + the
// intel API. Optional BOOTSTRAP_PIN gate stays in place.
app.get('/api/auth/admin-bootstrap', async (req, res) => {
  try {
    const pin = process.env.BOOTSTRAP_PIN?.trim();
    if (pin) {
      const supplied =
        ((req.query.pin as string | undefined) ?? '').trim() ||
        ((req.headers['x-bootstrap-pin'] as string | undefined) ?? '').trim();
      if (supplied !== pin) {
        res.status(401).json({ error: 'Bootstrap PIN required' });
        return;
      }
    }
    const result = await pgSql`SELECT id, email, name, plan FROM users WHERE email = ${ADMIN_EMAIL} LIMIT 1`;
    const user = result[0] as { id: number; email: string; name: string; plan: string } | undefined;
    if (!user) {
      res.status(503).json({ error: 'Admin user not seeded. Run db:migrate.' });
      return;
    }
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ ok: true, token, user });
  } catch {
    res.status(500).json({ error: 'Bootstrap failed' });
  }
});

app.get('/api/auth/bootstrap-config', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ bootstrapPinRequired: !!process.env.BOOTSTRAP_PIN?.trim() });
});

// ── 301 redirects: retired Phase 2c hub HTML pages → SPA hub deep-links ──
// Phase 2c consolidated these standalone pages into native React hubs. Old
// bookmarks/links 301 to the SPA with ?view=<hub>&tab=<tab> so they land on the
// exact hub sub-view (IntelligenceHub reads ?view, HubWrapper reads ?tab).
// All 24 hub source pages retired (the 2 AI tabs verified via real-Gemini smoke).
const HUB_REDIRECTS: Record<string, string> = {
  '/carrier-detail.html':     '/?view=carrier-hub&tab=overview',
  '/carrier-trades.html':     '/?view=carrier-hub&tab=trades',
  '/carrier-playbook.html':   '/?view=carrier-hub&tab=playbook',
  '/carrier-algorithms.html': '/?view=carrier-hub&tab=algorithms',
  '/storm-playbook.html':     '/?view=storm-hub&tab=playbook',
  '/storm-intel.html':        '/?view=storm-hub&tab=intel',
  '/storm-exposure.html':     '/?view=storm-hub&tab=exposure',
  '/denial-analyzer.html':    '/?view=denial-hub&tab=analyze',
  '/denial-archive.html':     '/?view=denial-hub&tab=archive',
  '/denial-stats.html':       '/?view=denial-hub&tab=stats',
  '/adjusters.html':          '/?view=adjuster-hub&tab=directory',
  '/adjuster-detail.html':    '/?view=adjuster-hub&tab=detail',
  '/adjuster-twin.html':      '/?view=adjuster-hub&tab=twin',
  '/reps.html':               '/?view=rep-hub&tab=overview',
  '/rep-response.html':       '/?view=rep-hub&tab=response',
  '/customers.html':          '/?view=customer-hub&tab=list',
  '/customer-detail.html':    '/?view=customer-hub&tab=detail',
  '/property-lookup.html':    '/?view=customer-hub&tab=lookup',
  '/leads-intel.html':        '/?view=leads-hub&tab=intel',
  '/leads.html':              '/?view=leads-hub&tab=funnel',
  '/pricing-margins.html':    '/?view=pricing-hub&tab=margins',
  '/pricing-library.html':    '/?view=pricing-hub&tab=library',
  '/hot-zips.html':           '/?view=zip-hub&tab=hot',
  '/zip-intel.html':          '/?view=zip-hub&tab=intel',
};
// ── 301 redirects: retired Phase 2d standalone HTML pages → SPA deep-links ──
// Each retired /x.html 301s to /?view=<IntelView id>. IntelligenceHub's
// readViewFromUrl now accepts NATIVE_VIEWS ids, so these deep-link to the
// native page. Includes the market/pipeline rename aliases.
const VIEW_REDIRECTS: Record<string, string> = {
  '/exec.html':              '/?view=exec',
  '/weekly-recap.html':      '/?view=weekly-recap',
  '/analytics.html':         '/?view=analytics',
  '/insurance-intel.html':   '/?view=insurance-intel',
  '/market.html':            '/?view=insurance-intel',
  '/pipeline-intel.html':    '/?view=pipeline-intel',
  '/pipeline.html':          '/?view=pipeline-intel',
  '/carrier-orphans.html':   '/?view=carrier-orphans',
  '/lead-score.html':        '/?view=lead-score',
  '/field-guide.html':       '/?view=field-guide',
  '/cheat-sheet.html':       '/?view=cheat-sheet',
  '/lifetime-touch.html':    '/?view=lifetime-touch',
  '/upgrade-campaigns.html': '/?view=campaigns',
  '/solar.html':             '/?view=solar',
  '/sms-reminders.html':     '/?view=sms-reminders',
  '/ops-surveillance.html':  '/?view=ops-surveillance',
  '/scheduling.html':        '/?view=scheduling',
  '/active-work.html':       '/?view=active-work',
  '/receivables.html':       '/?view=receivables',
  '/ops-team.html':          '/?view=ops-team',
  '/notes.html':             '/?view=notes',
  '/roofdocs-map.html':      '/?view=map',
};
app.use((req, res, next) => {
  if (req.method === 'GET') {
    const target = HUB_REDIRECTS[req.path] ?? VIEW_REDIRECTS[req.path];
    if (target) {
      res.redirect(301, target);
      return;
    }
  }
  next();
});

// ── Static SPA + intel HTML pages ───────────────────────
// /public/*.html (the 30 static intel pages + carrier-orphans) are served
// directly at the URL root by Vite in dev. In prod they're copied into dist/
// during `npm run build`.
app.use(
  express.static(DIST_DIR, {
    setHeaders: (res, filePath) => {
      const base = path.basename(filePath);
      if (filePath.split(path.sep).includes('assets')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return;
      }
      if (base === 'index.html' || base === 'sw.js') {
        res.setHeader('Cache-Control', 'no-cache');
        return;
      }
      res.setHeader('Cache-Control', 'public, max-age=300');
    },
  }),
);

// In dev mode the static intel pages live at /public/. Mount that explicitly
// so prod and dev both serve /carrier-orphans.html etc. at the root.
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(
    express.static(PUBLIC_DIR, {
      setHeaders: (res) => {
        res.setHeader('Cache-Control', 'public, max-age=300');
      },
    }),
  );
}

// SPA fallback — any non-API GET that doesn't match a static asset returns
// the React shell, so client-side routing works. Express 5 / path-to-regexp 8
// requires named splat params, hence "/*splat" instead of bare "*".
app.get('/*splat', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  const indexHtml = path.join(DIST_DIR, 'index.html');
  if (fs.existsSync(indexHtml)) {
    res.sendFile(indexHtml);
    return;
  }
  next();
});

// Vercel serverless: skip listen + scheduler (VERCEL=1 set automatically by platform).
// Railway / local dev: start normally.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`[riq21] running on port ${PORT}`);
    startRefreshScheduler();
  });
}

export default app;

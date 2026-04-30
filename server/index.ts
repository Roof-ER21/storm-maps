import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import { db, sql as pgSql } from './db.js';
import { leads, properties, evidence, archives, reps, shareableReports } from './schema.js';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// AI Property Analysis routes
import { purgeExpiredCache } from './ai/services/enrichmentCache.js';
import analysisRoutes from './ai/routes/analysisRoutes.js';
import aiBatchRoutes from './ai/routes/batchRoutes.js';
import aiHistoryRoutes from './ai/routes/historyRoutes.js';
import aiNeighborhoodRoutes from './ai/routes/neighborhoodRoutes.js';
import aiZipScanRoutes from './ai/routes/zipScanRoutes.js';
import aiLeadRoutes from './ai/routes/leadRoutes.js';
import aiAutocompleteRoutes from './ai/routes/autocompleteRoutes.js';
import aiImageProxy from './ai/routes/imageProxy.js';
import aiDashboardRoutes from './ai/routes/dashboardRoutes.js';
import aiBridgeRoutes from './ai/routes/bridgeRoutes.js';
import { requireAuth, checkScanLimit } from './ai/authMiddleware.js';
import {
  buildWindSwathCollection,
  buildWindImpactResponse,
} from './storm/windSwathService.js';
import { getCacheSummary, purgeExpiredSwaths } from './storm/cache.js';
import { fetchStormEventsCached } from './storm/eventService.js';
import { buildConsilience } from './storm/consilienceService.js';
import { fetchRecentMpingReports, fetchMpingReportsForDate, isMpingConfigured } from './storm/mpingService.js';
import { fetchCocorahsHailReports } from './storm/cocorahsClient.js';
import { fetchParcelGeometry } from './property/parcelGeometry.js';
import { fetchActiveSvrPolygons } from './storm/nwsAlerts.js';
import { fetchMesocyclones } from './storm/nceiNx3MdaClient.js';
import { corroborateSynopticObservations } from './storm/synopticObservationsService.js';
import { etDayUtcWindow } from './storm/timeUtils.js';
import { pointInRing } from './storm/geometry.js';
import { displayHailInches } from './storm/displayCapService.js';
import {
  buildBandedVerificationBulk,
  buildVerificationBulk,
} from './storm/verificationService.js';
import {
  startPrewarmScheduler,
  getPrewarmStatus,
} from './storm/scheduler.js';
import {
  buildHailFallbackCollection,
  buildHailImpactResponse,
} from './storm/hailFallbackService.js';
import {
  buildMrmsVectorPolygons,
  buildMrmsNowVectorPolygons,
  buildMrmsImpactResponse,
} from './storm/mrmsService.js';
import { buildMrmsRaster } from './storm/mrmsRaster.js';
import { buildStormReportPdf } from './storm/reportPdf.js';
import { requireAdmin } from './storm/adminAuth.js';
import type { BoundingBox } from './storm/types.js';
import {
  upsertPushSubscription,
  deletePushSubscription,
  getPublicVapidKey,
  isPushConfigured,
} from './storm/pushService.js';
import { startPushFanout, getPushFanoutStatus } from './storm/pushFanout.js';
import { startLiveMrmsAlertWorker, getLiveMrmsAlertStatus } from './storm/liveMrmsAlertWorker.js';

const JWT_SECRET = process.env.JWT_SECRET || 'hail-yes-dev-secret-change-in-production';
const ADMIN_EMAIL = (process.env.ADMIN_EMAILS || 'ahmed@theroofdocs.com')
  .split(',')[0]
  .trim()
  .toLowerCase();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '../uploads');
const DIST_DIR = path.join(__dirname, '../dist');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const app = express();
app.set('trust proxy', 1);
const PORT = parseInt(process.env.PORT || '3100', 10);

app.use(compression({ threshold: 1024 }));
app.use(express.json({ limit: '10mb' }));

// Rate limiting — bumped from 300/15min after reps hit the ceiling on
// normal storm-page browsing (each storm-date click fires per-date-impact +
// mrms-meta + mrms-vector + mrms-impact + wind/impact = 5 requests; with
// 5–10 dates per session the old limit was ~5 minutes of work). 2000 over
// 15 minutes is ~133/min sustained — still abuse-protective but never
// trips for actual use. The push-subscribe and admin endpoints keep
// their own tighter buckets.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, try again later' },
});
app.use('/api/', apiLimiter);

// Push subscribe is browser-driven and idempotent on `endpoint`. A real
// rep hits it once per device per day. Allow ~20/hr/IP — enough for
// device migration, well below abuse territory.
const pushSubscribeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many push subscribe requests' },
});
app.use('/api/push/subscribe', pushSubscribeLimiter);

// Admin endpoints get a lower ceiling than the rest of the API.
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin requests' },
});
app.use('/api/admin/', adminLimiter);

// Consilience fan-out is expensive (10+ concurrent upstream fetches). Cap
// at 60 req/min/IP so a misbehaving client can't wedge upstream feeds.
const consilienceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Consilience rate limit — try again in a minute' },
});
app.use('/api/storm/consilience', consilienceLimiter);

// ── AI Property Analysis API ───────────────────────────
// Auth + scan limits on write endpoints (POST), reads are open
app.use('/api/ai/analyze', requireAuth, checkScanLimit, analysisRoutes);
app.use('/api/ai/batch', requireAuth, checkScanLimit, aiBatchRoutes);
app.use('/api/ai/zip-scan', requireAuth, checkScanLimit, aiZipScanRoutes);
app.use('/api/ai/bridge', requireAuth, checkScanLimit, aiBridgeRoutes);
// Read-only endpoints — auth recommended but not required
app.use('/api/ai/history', aiHistoryRoutes);
app.use('/api/ai/neighborhood', aiNeighborhoodRoutes);
app.use('/api/ai/property-leads', aiLeadRoutes);
app.use('/api/ai/autocomplete', aiAutocompleteRoutes);
app.use('/api/ai/images', aiImageProxy);
app.use('/api/ai/dashboard', aiDashboardRoutes);

// Serve Vite build. Vite fingerprints compiled assets, so those can be
// cached for a year; the app shell and service worker must revalidate so
// reps pick up deploys without manual cache clearing.
app.use(
  express.static(DIST_DIR, {
    setHeaders: (res, filePath) => {
      const baseName = path.basename(filePath);
      const isFingerprintedAsset = filePath
        .split(path.sep)
        .includes('assets');

      if (isFingerprintedAsset) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return;
      }

      if (baseName === 'index.html' || baseName === 'sw.js') {
        res.setHeader('Cache-Control', 'no-cache');
        return;
      }

      res.setHeader('Cache-Control', 'public, max-age=300');
    },
  }),
);

// ── Auth ────────────────────────────────────────────────
// Signup endpoint removed: app is admin-default. Login + bootstrap remain
// for explicit admin access. The seeded admin (server/migrate.ts) is the
// only persistent user; bootstrap below mints a JWT for that admin so the
// SPA can transparently authenticate against /api/admin/* with the JWT
// path in `requireAdmin`.

app.get('/api/auth/admin-bootstrap', async (req, res) => {
  try {
    // Optional soft gate: when BOOTSTRAP_PIN is set in env, require it as a
    // ?pin= query param OR x-bootstrap-pin header. Default-open when unset
    // so private deploys keep working without configuration.
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

/** Public-facing config endpoint.
 *
 * Previously reported `bootstrapPinRequired: true` whenever BOOTSTRAP_PIN was
 * set, which made the SPA show a PIN prompt to every visitor — including reps
 * who only need to view storm reports / dashboard. Reps don't need admin
 * access; admin endpoints are still gated server-side by the JWT path in
 * `requireAdmin` and the PIN check on `/api/auth/admin-bootstrap`.
 *
 * So the SPA always renders without a prompt now. Anyone who legitimately
 * needs admin access hits /api/auth/admin-bootstrap?pin=… with the PIN.
 */
app.get('/api/auth/bootstrap-config', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ bootstrapPinRequired: false });
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password required' });
      return;
    }

    const emailLower = email.toLowerCase().trim();
    const result = await pgSql`SELECT id, email, name, password_hash, plan FROM users WHERE email = ${emailLower}`;
    const user = result[0] as { id: number; email: string; name: string; password_hash: string; plan: string } | undefined;
    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ ok: true, token, user: { id: user.id, email: user.email, name: user.name, plan: user.plan } });
  } catch {
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    const decoded = jwt.verify(auth.slice(7), JWT_SECRET) as { userId: number; email: string };
    const result = await pgSql`SELECT id, email, name, plan FROM users WHERE id = ${decoded.userId}`;
    const user = result[0];
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }
    res.json(user);
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Billing routes removed (Stripe). App is admin-default; no subscription tier.

// ── Health check ────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// ── Leads CRUD ──────────────────────────────────────────
app.get('/api/leads', async (_req, res) => {
  try {
    const rows = await db.select().from(leads).orderBy(leads.updatedAt);
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

app.put('/api/leads/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const existing = await db.select().from(leads).where(eq(leads.id, id));
    if (existing.length === 0) {
      await db.insert(leads).values({ ...data, id });
    } else {
      await db.update(leads).set({ ...data, updatedAt: new Date() }).where(eq(leads.id, id));
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to save lead' });
  }
});

app.delete('/api/leads/:id', async (req, res) => {
  try {
    await db.delete(leads).where(eq(leads.id, req.params.id));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete lead' });
  }
});

// ── Bulk sync (client pushes full state) ────────────────
app.post('/api/sync/leads', async (req, res) => {
  try {
    const items = req.body as Array<Record<string, unknown>>;
    let synced = 0;
    const errors: Array<{ id: unknown; error: string }> = [];

    for (const item of items) {
      try {
        const id = item.id as string;
        if (!id) {
          errors.push({ id: item.id, error: 'Missing id' });
          continue;
        }

        // Sanitise fields that must be JSON objects, not strings
        const safeItem: Record<string, unknown> = { ...item };
        if (typeof safeItem.stageHistory === 'string') {
          try { safeItem.stageHistory = JSON.parse(safeItem.stageHistory as string); }
          catch { safeItem.stageHistory = []; }
        }
        if (typeof safeItem.tags === 'string') {
          try { safeItem.tags = JSON.parse(safeItem.tags as string); }
          catch { safeItem.tags = []; }
        }
        // Coerce ISO-string timestamps back to Date objects. JSON over the
        // wire serializes Dates as strings; Drizzle's PgTimestamp expects
        // a real Date and calls .toISOString() on whatever it gets — which
        // throws "value.toISOString is not a function" for strings. This
        // was firing per-lead per state change in idle, flooding logs.
        for (const k of ['createdAt', 'updatedAt', 'visitedAt', 'completedAt']) {
          const v = safeItem[k];
          if (typeof v === 'string') {
            const d = new Date(v);
            safeItem[k] = Number.isNaN(d.getTime()) ? null : d;
          }
        }

        // Remove unknown AI columns that may not yet exist in the schema
        const knownAiCols = ['aiAnalysisId', 'aiProspectScore', 'aiPropertyCondition', 'aiRecommendedAction', 'aiLastAnalyzedAt'];
        for (const col of knownAiCols) {
          if (!(col in (leads as Record<string, unknown>)) && col in safeItem) {
            delete safeItem[col];
          }
        }

        const existing = await db.select().from(leads).where(eq(leads.id, id));
        if (existing.length === 0) {
          await db.insert(leads).values(safeItem as typeof leads.$inferInsert);
        } else {
          await db.update(leads).set({ ...safeItem, updatedAt: new Date() }).where(eq(leads.id, id));
        }
        synced++;
      } catch (itemErr) {
        console.error('[sync/leads] Error on lead', item.id, ':', itemErr);
        errors.push({ id: item.id, error: itemErr instanceof Error ? itemErr.message : String(itemErr) });
      }
    }

    res.json({ ok: true, synced, errors: errors.length ? errors : undefined });
  } catch (err) {
    console.error('[sync/leads] Error:', err);
    res.status(500).json({ error: 'Failed to sync leads' });
  }
});

// ── Properties CRUD ─────────────────────────────────────
app.get('/api/properties', async (_req, res) => {
  try {
    const rows = await db.select().from(properties);
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Failed to fetch properties' });
  }
});

app.put('/api/properties/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const existing = await db.select().from(properties).where(eq(properties.id, id));
    if (existing.length === 0) {
      await db.insert(properties).values({ ...data, id });
    } else {
      await db.update(properties).set({ ...data, updatedAt: new Date() }).where(eq(properties.id, id));
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to save property' });
  }
});

// ── Evidence CRUD ───────────────────────────────────────
app.get('/api/evidence', async (_req, res) => {
  try {
    const rows = await db.select().from(evidence);
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Failed to fetch evidence' });
  }
});

app.put('/api/evidence/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const existing = await db.select().from(evidence).where(eq(evidence.id, id));
    if (existing.length === 0) {
      await db.insert(evidence).values({ ...data, id });
    } else {
      await db.update(evidence).set({ ...data, updatedAt: new Date() }).where(eq(evidence.id, id));
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to save evidence' });
  }
});

app.delete('/api/evidence/:id', async (req, res) => {
  try {
    await db.delete(evidence).where(eq(evidence.id, req.params.id));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete evidence' });
  }
});

// ── Evidence Blob Upload/Download ────────────────────────
app.post('/api/evidence/:id/blob', express.raw({ type: '*/*', limit: '20mb' }), (req, res) => {
  try {
    const filePath = path.join(UPLOADS_DIR, `${req.params.id}.bin`);
    fs.writeFileSync(filePath, Buffer.from(req.body as ArrayBuffer));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to save blob' });
  }
});

app.get('/api/evidence/:id/blob', (req, res) => {
  const filePath = path.join(UPLOADS_DIR, `${req.params.id}.bin`);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.sendFile(filePath);
});

app.head('/api/evidence/:id/blob', (req, res) => {
  const filePath = path.join(UPLOADS_DIR, `${req.params.id}.bin`);
  if (fs.existsSync(filePath)) res.sendStatus(200);
  else res.sendStatus(404);
});

// ── Reps ────────────────────────────────────────────────
app.get('/api/reps', async (_req, res) => {
  try {
    const rows = await db.select().from(reps);
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Failed to fetch reps' });
  }
});

app.put('/api/reps/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;
    const existing = await db.select().from(reps).where(eq(reps.id, id));
    if (existing.length === 0) {
      await db.insert(reps).values({ ...data, id });
    } else {
      await db.update(reps).set(data).where(eq(reps.id, id));
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to save rep' });
  }
});

// ── Archives ────────────────────────────────────────────
app.get('/api/archives', async (_req, res) => {
  try {
    const rows = await db.select().from(archives);
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'Failed to fetch archives' });
  }
});

app.post('/api/archives', async (req, res) => {
  try {
    await db.insert(archives).values(req.body);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to save archive' });
  }
});

// ── Shareable Reports (homeowner leave-behind) ──────────
app.post('/api/reports/share', async (req, res) => {
  try {
    const slug = crypto.randomBytes(6).toString('base64url');
    const data = req.body;
    await db.insert(shareableReports).values({
      slug,
      address: data.address,
      lat: data.lat,
      lng: data.lng,
      stormDate: data.stormDate,
      stormLabel: data.stormLabel,
      maxHailInches: data.maxHailInches || 0,
      maxWindMph: data.maxWindMph || 0,
      eventCount: data.eventCount || 0,
      repName: data.repName || null,
      repPhone: data.repPhone || null,
      companyName: data.companyName || null,
      homeownerName: data.homeownerName || null,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    });
    res.json({ ok: true, slug, url: `/report/${slug}` });
  } catch {
    res.status(500).json({ error: 'Failed to create shareable report' });
  }
});

app.get('/api/reports/:slug', async (req, res) => {
  try {
    const [row] = await db.select().from(shareableReports).where(eq(shareableReports.slug, req.params.slug));
    if (!row) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }
    res.json(row);
  } catch {
    res.status(500).json({ error: 'Failed to fetch report' });
  }
});

// ── Demo seed endpoint ──────────────────────────────────
app.post('/api/demo/seed', async (_req, res) => {
  try {
    const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
    const demoLeads = [
      {
        id: 'dmv-lead-1', propertyLabel: '4521 Elm St, Bethesda, MD', stormDate: '2026-03-15',
        stormLabel: 'Sun, Mar 15, 2026', lat: 38.9847, lng: -77.0947, locationLabel: 'Montgomery County, MD',
        sourceLabel: 'NOAA SWDI', topHailInches: 2.0, reportCount: 14, evidenceCount: 5,
        priority: 'Knock now', status: 'completed', outcome: 'inspection_booked', leadStage: 'won',
        dealValue: 24500, notes: 'Full tear-off approved. GAF Timberline HDZ. Install crew booked April 10.',
        reminderAt: day(-2).slice(0, 10), assignedRep: 'Ahmed M.',
        stageHistory: JSON.stringify([
          { stage: 'new', at: day(14) }, { stage: 'contacted', at: day(12) },
          { stage: 'inspection_set', at: day(8) }, { stage: 'won', at: day(2) },
        ]),
        homeownerName: 'Patricia Reynolds', homeownerPhone: '301-555-0184', homeownerEmail: 'pat.reynolds@example.com',
      },
      {
        id: 'dmv-lead-2', propertyLabel: '1825 Columbia Pike, Arlington, VA', stormDate: '2026-03-15',
        stormLabel: 'Sun, Mar 15, 2026', lat: 38.8628, lng: -77.0867, locationLabel: 'Arlington County, VA',
        sourceLabel: 'NOAA SWDI', topHailInches: 1.75, reportCount: 9, evidenceCount: 4,
        priority: 'Knock now', status: 'visited', outcome: 'inspection_booked', leadStage: 'inspection_set',
        dealValue: 19800, notes: 'Adjuster meeting Friday 10 AM. Ridge caps cracked, gutters dented.',
        reminderAt: day(-1).slice(0, 10), assignedRep: 'Ahmed M.',
        stageHistory: JSON.stringify([
          { stage: 'new', at: day(7) }, { stage: 'contacted', at: day(5) },
          { stage: 'inspection_set', at: day(1) },
        ]),
        homeownerName: 'James Nguyen', homeownerPhone: '703-555-0237', homeownerEmail: 'jnguyen@example.com',
      },
      {
        id: 'dmv-lead-3', propertyLabel: '9102 Riggs Rd, Adelphi, MD', stormDate: '2026-03-22',
        stormLabel: 'Sun, Mar 22, 2026', lat: 39.0015, lng: -76.9713, locationLabel: 'Prince George\'s County, MD',
        sourceLabel: 'NOAA SWDI', topHailInches: 2.5, reportCount: 18, evidenceCount: 3,
        priority: 'Knock now', status: 'visited', outcome: 'follow_up', leadStage: 'contacted',
        notes: 'Left door hanger + storm report link. Neighbor confirmed they saw damage.',
        reminderAt: day(-2).slice(0, 10), assignedRep: 'Ahmed M.',
        stageHistory: JSON.stringify([
          { stage: 'new', at: day(5) }, { stage: 'contacted', at: day(3) },
        ]),
        homeownerName: 'Maria Santos', homeownerPhone: '240-555-0319', homeownerEmail: '',
      },
      {
        id: 'dmv-lead-4', propertyLabel: '6700 Georgia Ave NW, Washington, DC', stormDate: '2026-03-22',
        stormLabel: 'Sun, Mar 22, 2026', lat: 38.9612, lng: -77.0275, locationLabel: 'Washington, DC',
        sourceLabel: 'NOAA SWDI', topHailInches: 1.5, reportCount: 7, evidenceCount: 2,
        priority: 'Monitor', status: 'queued', outcome: 'none', leadStage: 'new',
        notes: '', assignedRep: 'Ahmed M.',
        stageHistory: JSON.stringify([{ stage: 'new', at: day(2) }]),
        homeownerName: 'Karen Mitchell', homeownerPhone: '202-555-0456', homeownerEmail: 'karen.m@example.com',
      },
      {
        id: 'dmv-lead-5', propertyLabel: '14300 Layhill Rd, Silver Spring, MD', stormDate: '2026-03-15',
        stormLabel: 'Sun, Mar 15, 2026', lat: 39.0812, lng: -77.0453, locationLabel: 'Montgomery County, MD',
        sourceLabel: 'NOAA SWDI', topHailInches: 1.0, reportCount: 4, evidenceCount: 1,
        priority: 'Low', status: 'queued', outcome: 'none', leadStage: 'new',
        notes: '', assignedRep: '',
        stageHistory: JSON.stringify([{ stage: 'new', at: day(1) }]),
        homeownerName: 'William Park', homeownerPhone: '', homeownerEmail: 'wpark@example.com',
      },
      {
        id: 'dmv-lead-6', propertyLabel: '2300 Wilson Blvd, Arlington, VA', stormDate: '2026-03-22',
        stormLabel: 'Sun, Mar 22, 2026', lat: 38.8882, lng: -77.0846, locationLabel: 'Arlington County, VA',
        sourceLabel: 'NOAA SWDI', topHailInches: 3.0, reportCount: 22, evidenceCount: 7,
        priority: 'Knock now', status: 'completed', outcome: 'inspection_booked', leadStage: 'won',
        dealValue: 31200, notes: 'Insurance approved full replacement + gutters. CertainTeed Landmark Pro.',
        assignedRep: 'Ahmed M.',
        stageHistory: JSON.stringify([
          { stage: 'new', at: day(10) }, { stage: 'contacted', at: day(9) },
          { stage: 'inspection_set', at: day(6) }, { stage: 'won', at: day(1) },
        ]),
        homeownerName: 'Rachel Thompson', homeownerPhone: '703-555-0891', homeownerEmail: 'rthompson@example.com',
      },
      {
        id: 'dmv-lead-7', propertyLabel: '8450 Baltimore Ave, College Park, MD', stormDate: '2026-03-22',
        stormLabel: 'Sun, Mar 22, 2026', lat: 38.9807, lng: -76.9369, locationLabel: 'Prince George\'s County, MD',
        sourceLabel: 'NOAA SWDI', topHailInches: 2.0, reportCount: 11, evidenceCount: 1,
        priority: 'Knock now', status: 'queued', outcome: 'interested', leadStage: 'contacted',
        notes: 'Spoke on phone, wants estimate this week.', assignedRep: 'Ahmed M.',
        stageHistory: JSON.stringify([
          { stage: 'new', at: day(4) }, { stage: 'contacted', at: day(2) },
        ]),
        homeownerName: 'Derek Johnson', homeownerPhone: '301-555-0672', homeownerEmail: '',
      },
      {
        id: 'dmv-lead-8', propertyLabel: '5500 Franconia Rd, Alexandria, VA', stormDate: '2026-03-15',
        stormLabel: 'Sun, Mar 15, 2026', lat: 38.7722, lng: -77.1389, locationLabel: 'Fairfax County, VA',
        sourceLabel: 'NOAA SWDI', topHailInches: 1.75, reportCount: 8, evidenceCount: 3,
        priority: 'Knock now', status: 'visited', outcome: 'inspection_booked', leadStage: 'inspection_set',
        dealValue: 16500, notes: 'Insurance adjuster scheduled Monday.',
        reminderAt: day(-3).slice(0, 10), assignedRep: 'Ahmed M.',
        stageHistory: JSON.stringify([
          { stage: 'new', at: day(9) }, { stage: 'contacted', at: day(7) },
          { stage: 'inspection_set', at: day(3) },
        ]),
        homeownerName: 'Linda Garcia', homeownerPhone: '571-555-0445', homeownerEmail: 'lgarcia@example.com',
      },
    ];

    // Real photos: Google Street View for property exteriors, FEMA/Wikimedia for damage evidence
    const MAPS_KEY = process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
    const sv = (addr: string) => `https://maps.googleapis.com/maps/api/streetview?size=640x480&location=${encodeURIComponent(addr)}&key=${MAPS_KEY}`;

    // FEMA & Wikimedia Commons — real hail damage (public domain / CC)
    const FEMA = {
      roofInspection:   'https://upload.wikimedia.org/wikipedia/commons/5/5f/FEMA_-_44371_-_FEMA_PA_inspection_of_a_hail_damaged_roof_in_OK.jpg',
      documentDamage:   'https://upload.wikimedia.org/wikipedia/commons/d/de/FEMA_-_44372_-_FEMA_PA_officer_documenting_damage_to_a_hail_damaged_roof_in_OK.jpg',
      metalRoofDents:   'https://upload.wikimedia.org/wikipedia/commons/d/d3/FEMA_-_44370_-_FEMA_PA_officer_documenting_damages_to_a_roof_in_OK.jpg',
      dentedMetal:      'https://upload.wikimedia.org/wikipedia/commons/2/22/Pozega_20210625_ostecenja_na_dimnjacima_bolnice-1.jpg',
      skylightHole:     'https://upload.wikimedia.org/wikipedia/commons/8/86/FEMA_-_44373_-_hail_hole_in_fiberglass_skylight.jpg',
      crackedTiles1:    'https://upload.wikimedia.org/wikipedia/commons/e/e2/Telhado_danificado_por_granizo_22-11-2025_01.jpg',
      crackedTiles2:    'https://upload.wikimedia.org/wikipedia/commons/8/87/Telhado_danificado_por_granizo_22-11-2025_02.jpg',
      sidingSouth:      'https://upload.wikimedia.org/wikipedia/commons/6/6a/Einsiedeln.hail.damage.22.Jul.2010.JPG',
      sidingWest:       'https://upload.wikimedia.org/wikipedia/commons/8/8e/Einsiedeln.hail.damage.JPG',
      smashedWindow:    'https://upload.wikimedia.org/wikipedia/commons/a/af/Hailstone-smashed_window_from_4_July_2010_hailstorm_%282nd_floor_of_west-facing_side_of_a_motel%2C_Limon%2C_eastern_Colorado%2C_USA%29.jpg',
      windshieldHail:   'https://upload.wikimedia.org/wikipedia/commons/7/79/FEMA_-_44376_-_truck_windshield_with_hail_damage_in_OK.jpg',
      aerialTarps:      'https://upload.wikimedia.org/wikipedia/commons/d/d3/FEMA_-_24983_-_Photograph_by_Andrea_Booher_taken_on_09-19-2005_in_Mississippi.jpg',
      beforeAfter:      'https://upload.wikimedia.org/wikipedia/commons/4/4e/21_CES_continues_hail_storm_repairs_%284644916%29.jpeg',
      newShingles:      'https://upload.wikimedia.org/wikipedia/commons/4/40/On_base_housing_gets_new_shingles_for_roofs_%285566725%29.jpg',
      surveyRoof:       'https://upload.wikimedia.org/wikipedia/commons/b/b2/FEMA_-_44375_-_surveying_hail_damage_to_municipal_building_roof.jpg',
      teamOnRoof:       'https://upload.wikimedia.org/wikipedia/commons/c/c2/FEMA_-_44377_-_Preliminary_Damage_Assessment_partners_on_roof_in_OK.jpg',
      concretePitting:  'https://upload.wikimedia.org/wikipedia/commons/d/da/Pozega_20210625_ostecenja_betonske_staze.jpg',
      roofOverview:     'https://upload.wikimedia.org/wikipedia/commons/c/c4/PozegaDubrovacka_20210625-steta-od-tuce-na-krovu-i-boru-1.jpg',
    };

    const demoEvidence = [
      // ── 4521 Elm St, Bethesda, MD (lead-1: 5 items) ──
      { id: 'dmv-ev-sv1', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '4521 Elm St, Bethesda, MD', stormDate: '2026-03-15', title: 'Property exterior — Street View', notes: 'Google Street View of 4521 Elm St, Bethesda, MD. Residential property.', thumbnailUrl: sv('4521 Elm St, Bethesda, MD'), status: 'approved', includeInReport: true },
      { id: 'dmv-ev-1', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '4521 Elm St, Bethesda, MD', stormDate: '2026-03-15', title: 'Ridge cap cracking — south face', notes: 'Multiple shingles cracked along ridge line. Hail impact marks visible.', thumbnailUrl: FEMA.roofInspection, status: 'approved', includeInReport: true },
      { id: 'dmv-ev-2', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '4521 Elm St, Bethesda, MD', stormDate: '2026-03-15', title: 'Gutter dents — front elevation', notes: 'Quarter-sized dents on aluminum gutters. Consistent with 2" hail.', thumbnailUrl: FEMA.dentedMetal, status: 'approved', includeInReport: true },
      { id: 'dmv-ev-3', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '4521 Elm St, Bethesda, MD', stormDate: '2026-03-15', title: 'Soft metal test — downspout', notes: 'Clear hail dimpling on downspout elbow.', thumbnailUrl: FEMA.metalRoofDents, status: 'approved', includeInReport: true },
      { id: 'dmv-ev-4', kind: 'provider-query', provider: 'youtube', mediaType: 'video', propertyLabel: '4521 Elm St, Bethesda, MD', stormDate: '2026-03-15', title: 'Bethesda MD Hail Storm March 2026', notes: 'Local news coverage of the storm.', externalUrl: 'https://www.youtube.com/watch?v=example1', thumbnailUrl: FEMA.beforeAfter, status: 'pending', includeInReport: false },

      // ── 1825 Columbia Pike, Arlington, VA (lead-2: 4 items) ──
      { id: 'dmv-ev-sv2', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '1825 Columbia Pike, Arlington, VA', stormDate: '2026-03-15', title: 'Property exterior — Street View', notes: 'Google Street View of 1825 Columbia Pike, Arlington, VA.', thumbnailUrl: sv('1825 Columbia Pike, Arlington, VA'), status: 'approved', includeInReport: true },
      { id: 'dmv-ev-5', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '1825 Columbia Pike, Arlington, VA', stormDate: '2026-03-15', title: 'Shingle bruising — 3-tab section', notes: 'Granule loss visible on east-facing slope. Test square marked.', thumbnailUrl: FEMA.documentDamage, status: 'approved', includeInReport: true },
      { id: 'dmv-ev-6', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '1825 Columbia Pike, Arlington, VA', stormDate: '2026-03-15', title: 'Vent boot crack', notes: 'Pipe vent boot cracked from impact. Active leak risk.', thumbnailUrl: FEMA.skylightHole, status: 'approved', includeInReport: true },
      { id: 'dmv-ev-7', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '1825 Columbia Pike, Arlington, VA', stormDate: '2026-03-15', title: 'Siding impact marks', notes: 'Vinyl siding shows circular impact craters on north wall.', thumbnailUrl: FEMA.sidingSouth, status: 'pending', includeInReport: false },

      // ── 9102 Riggs Rd, Adelphi, MD (lead-3: 3 items) ──
      { id: 'dmv-ev-sv3', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '9102 Riggs Rd, Adelphi, MD', stormDate: '2026-03-22', title: 'Property exterior — Street View', notes: 'Google Street View of 9102 Riggs Rd, Adelphi, MD.', thumbnailUrl: sv('9102 Riggs Rd, Adelphi, MD'), status: 'approved', includeInReport: true },
      { id: 'dmv-ev-8', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '9102 Riggs Rd, Adelphi, MD', stormDate: '2026-03-22', title: 'Chalk circle test — shingle mat exposed', notes: 'Marked 8 impacts in 10x10 test square. Mat visible through granule loss.', thumbnailUrl: FEMA.surveyRoof, status: 'approved', includeInReport: true },
      { id: 'dmv-ev-9', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '9102 Riggs Rd, Adelphi, MD', stormDate: '2026-03-22', title: 'Window screen damage', notes: 'Holes punched through window screen by large hail.', thumbnailUrl: FEMA.smashedWindow, status: 'approved', includeInReport: true },

      // ── 6700 Georgia Ave NW, Washington, DC (lead-4: 2 items) ──
      { id: 'dmv-ev-sv4', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '6700 Georgia Ave NW, Washington, DC', stormDate: '2026-03-22', title: 'Property exterior — Street View', notes: 'Google Street View of 6700 Georgia Ave NW, Washington, DC.', thumbnailUrl: sv('6700 Georgia Ave NW, Washington, DC'), status: 'approved', includeInReport: true },
      { id: 'dmv-ev-10', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '6700 Georgia Ave NW, Washington, DC', stormDate: '2026-03-22', title: 'Skylight seal damage', notes: 'Skylight flashing bent, sealant cracked.', thumbnailUrl: FEMA.skylightHole, status: 'pending', includeInReport: false },

      // ── 14300 Layhill Rd, Silver Spring, MD (lead-5: 1 item) ──
      { id: 'dmv-ev-sv5', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '14300 Layhill Rd, Silver Spring, MD', stormDate: '2026-03-15', title: 'Property exterior — Street View', notes: 'Google Street View of 14300 Layhill Rd, Silver Spring, MD.', thumbnailUrl: sv('14300 Layhill Rd, Silver Spring, MD'), status: 'approved', includeInReport: true },

      // ── 2300 Wilson Blvd, Arlington, VA (lead-6: 6 items) ──
      { id: 'dmv-ev-sv6', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '2300 Wilson Blvd, Arlington, VA', stormDate: '2026-03-22', title: 'Property exterior — Street View', notes: 'Google Street View of 2300 Wilson Blvd, Arlington, VA.', thumbnailUrl: sv('2300 Wilson Blvd, Arlington, VA'), status: 'approved', includeInReport: true },
      { id: 'dmv-ev-11', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '2300 Wilson Blvd, Arlington, VA', stormDate: '2026-03-22', title: 'Full roof overview — drone shot', notes: 'Drone overview showing widespread granule loss across entire roof.', thumbnailUrl: FEMA.aerialTarps, status: 'approved', includeInReport: true },
      { id: 'dmv-ev-12', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '2300 Wilson Blvd, Arlington, VA', stormDate: '2026-03-22', title: 'Ridge vent cracking', notes: 'Ridge vent plastic cracked in 3 locations.', thumbnailUrl: FEMA.crackedTiles1, status: 'approved', includeInReport: true },
      { id: 'dmv-ev-13', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '2300 Wilson Blvd, Arlington, VA', stormDate: '2026-03-22', title: 'AC condenser fin damage', notes: 'Condenser fins bent/flattened from hail impact.', thumbnailUrl: FEMA.dentedMetal, status: 'approved', includeInReport: true },
      { id: 'dmv-ev-14', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '2300 Wilson Blvd, Arlington, VA', stormDate: '2026-03-22', title: 'Fence cap rail dents', notes: 'Metal fence cap rail with clear hail dents. Good soft metal reference.', thumbnailUrl: FEMA.concretePitting, status: 'approved', includeInReport: true },
      { id: 'dmv-ev-15', kind: 'provider-query', provider: 'youtube', mediaType: 'video', propertyLabel: '2300 Wilson Blvd, Arlington, VA', stormDate: '2026-03-22', title: 'Arlington VA Tennis Ball Hail March 2026', notes: 'Resident video of 3" hail falling.', externalUrl: 'https://www.youtube.com/watch?v=example2', thumbnailUrl: FEMA.newShingles, status: 'pending', includeInReport: false },

      // ── 8450 Baltimore Ave, College Park, MD (lead-7: 1 item) ──
      { id: 'dmv-ev-sv7', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '8450 Baltimore Ave, College Park, MD', stormDate: '2026-03-22', title: 'Property exterior — Street View', notes: 'Google Street View of 8450 Baltimore Ave, College Park, MD.', thumbnailUrl: sv('8450 Baltimore Ave, College Park, MD'), status: 'approved', includeInReport: true },

      // ── 5500 Franconia Rd, Alexandria, VA (lead-8: 3 items) ──
      { id: 'dmv-ev-sv8', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '5500 Franconia Rd, Alexandria, VA', stormDate: '2026-03-15', title: 'Property exterior — Street View', notes: 'Google Street View of 5500 Franconia Rd, Alexandria, VA.', thumbnailUrl: sv('5500 Franconia Rd, Alexandria, VA'), status: 'approved', includeInReport: true },
      { id: 'dmv-ev-16', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '5500 Franconia Rd, Alexandria, VA', stormDate: '2026-03-15', title: 'Shingle mat exposure — test square', notes: 'Test square showing 12 impacts with granule displacement.', thumbnailUrl: FEMA.teamOnRoof, status: 'approved', includeInReport: true },
      { id: 'dmv-ev-17', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '5500 Franconia Rd, Alexandria, VA', stormDate: '2026-03-15', title: 'Gutter splash guard dents', notes: 'Aluminum splash guards dented along entire front gutter run.', thumbnailUrl: FEMA.metalRoofDents, status: 'approved', includeInReport: true },
    ];

    // Upsert leads (update evidence count + notes on re-seed)
    for (const lead of demoLeads) {
      const existing = await db.select().from(leads).where(eq(leads.id, lead.id));
      if (existing.length === 0) {
        await db.insert(leads).values(lead as typeof leads.$inferInsert);
      } else {
        await db.update(leads).set({ evidenceCount: lead.evidenceCount }).where(eq(leads.id, lead.id));
      }
    }

    // Upsert evidence (update thumbnail if re-seeding)
    for (const ev of demoEvidence) {
      await pgSql`
        INSERT INTO evidence (id, kind, provider, media_type, property_label, storm_date, title, notes, external_url, thumbnail_url, status, include_in_report)
        VALUES (${ev.id}, ${ev.kind}, ${ev.provider}, ${ev.mediaType}, ${ev.propertyLabel}, ${ev.stormDate}, ${ev.title}, ${ev.notes || ''}, ${ev.externalUrl || ''}, ${ev.thumbnailUrl || ''}, ${ev.status}, ${ev.includeInReport})
        ON CONFLICT (id) DO UPDATE SET thumbnail_url = EXCLUDED.thumbnail_url, title = EXCLUDED.title, notes = EXCLUDED.notes
      `;
    }

    res.json({ ok: true, seededLeads: demoLeads.length, seededEvidence: demoEvidence.length });
  } catch (err) {
    console.error('Demo seed error:', err);
    res.status(500).json({ error: 'Failed to seed demo data' });
  }
});

// ── Wind swath polygons (storm-day or live now-cast) ──────
const WIND_FOCUS_STATES = ['VA', 'MD', 'PA', 'WV', 'DC', 'DE', 'NJ'];

interface WindBoundsQuery {
  date?: string;
  north?: string;
  south?: string;
  east?: string;
  west?: string;
  states?: string;
  live?: string;
  /** Optional ISO timestamps for the storm-timeline-scrubber slice. */
  windowStart?: string;
  windowEnd?: string;
}

function parseWindBounds(q: WindBoundsQuery) {
  const n = parseFloat(q.north ?? '');
  const s = parseFloat(q.south ?? '');
  const e = parseFloat(q.east ?? '');
  const w = parseFloat(q.west ?? '');
  if (![n, s, e, w].every(Number.isFinite)) return null;
  if (n <= s || e <= w) return null;
  return { north: n, south: s, east: e, west: w };
}

function parseStates(raw?: string): string[] {
  if (!raw) return WIND_FOCUS_STATES;
  return raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function isValidIsoDate(value?: string): boolean {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

app.get('/api/wind/swath-polygons', async (req, res) => {
  try {
    const q = req.query as WindBoundsQuery;
    const bounds = parseWindBounds(q);
    const date = q.date ?? new Date().toISOString().slice(0, 10);
    if (!bounds) {
      res.status(400).json({ error: 'north/south/east/west required' });
      return;
    }
    if (!isValidIsoDate(date)) {
      res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      return;
    }
    const collection = await buildWindSwathCollection({
      date,
      bounds,
      states: parseStates(q.states),
      includeLive: q.live === '1',
      windowStartIso: q.windowStart,
      windowEndIso: q.windowEnd,
    });
    res.set('Cache-Control', 'public, max-age=300');
    res.json(collection);
  } catch (err) {
    console.error('[wind] swath-polygons failed', err);
    res.status(500).json({ error: 'Failed to build wind swaths' });
  }
});

app.get('/api/wind/now-polygons', async (req, res) => {
  try {
    const q = req.query as WindBoundsQuery;
    const bounds = parseWindBounds(q);
    if (!bounds) {
      res.status(400).json({ error: 'north/south/east/west required' });
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const collection = await buildWindSwathCollection({
      date: today,
      bounds,
      states: parseStates(q.states),
      includeLive: true,
    });
    res.set('Cache-Control', 'public, max-age=120');
    res.json(collection);
  } catch (err) {
    console.error('[wind] now-polygons failed', err);
    res.status(500).json({ error: 'Failed to build live wind swaths' });
  }
});

interface WindImpactRequestBody {
  date?: string;
  bounds?: { north: number; south: number; east: number; west: number };
  states?: string[];
  live?: boolean;
  points?: Array<{ id: string; lat: number; lng: number }>;
}

app.post('/api/wind/impact', async (req, res) => {
  try {
    const body = (req.body || {}) as WindImpactRequestBody;
    if (
      !body.bounds ||
      !Array.isArray(body.points) ||
      body.points.length === 0
    ) {
      res.status(400).json({ error: 'bounds and points required' });
      return;
    }
    const date = body.date ?? new Date().toISOString().slice(0, 10);
    if (!isValidIsoDate(date)) {
      res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      return;
    }
    const response = await buildWindImpactResponse({
      date,
      bounds: body.bounds,
      states: body.states && body.states.length > 0 ? body.states : WIND_FOCUS_STATES,
      includeLive: Boolean(body.live),
      points: body.points,
    });
    res.json(response);
  } catch (err) {
    console.error('[wind] impact failed', err);
    res.status(500).json({ error: 'Failed to compute wind impact' });
  }
});

// ── SPC CSV proxy — avoids CORS issues with spc.noaa.gov ──
app.get('/api/spc-proxy', async (req, res) => {
  try {
    const url = req.query.url as string;
    if (!url || !url.startsWith('https://www.spc.noaa.gov/')) {
      res.status(400).json({ error: 'Invalid SPC URL' });
      return;
    }
    const response = await fetch(url, {
      headers: { 'User-Agent': 'HailYes/1.0 (storm-intelligence-app)' },
    });
    if (!response.ok) {
      res.status(response.status).send(await response.text());
      return;
    }
    const text = await response.text();
    res.set('Content-Type', 'text/csv');
    res.send(text);
  } catch {
    res.status(502).json({ error: 'Failed to fetch SPC data' });
  }
});

// ── Hail polygon fallback ───────────────────────────────────────
// Crisp MRMS MESH polygons are produced by the Susan21 backend (GRIB decode
// + d3-contour). This in-repo fallback uses SPC + IEM hail point reports
// buffered into IHM-shaped 13-band polygons. Used when:
//   - the Susan21 endpoint is down or returns empty
//   - reps are running this app standalone without the Susan21 dependency
interface HailFallbackQuery {
  date?: string;
  north?: string;
  south?: string;
  east?: string;
  west?: string;
  states?: string;
}

function parseHailFallbackBounds(q: HailFallbackQuery) {
  const n = parseFloat(q.north ?? '');
  const s = parseFloat(q.south ?? '');
  const e = parseFloat(q.east ?? '');
  const w = parseFloat(q.west ?? '');
  if (![n, s, e, w].every(Number.isFinite)) return null;
  if (n <= s || e <= w) return null;
  return { north: n, south: s, east: e, west: w };
}

// Real MRMS MESH GRIB pipeline → IHM 13-band MultiPolygons. When this
// succeeds it returns crisp radar-derived polygons; on any failure
// (network, malformed GRIB, unsupported template) the frontend falls
// through to /api/hail/swath-fallback below.
app.get('/api/hail/mrms-vector', async (req, res) => {
  try {
    const q = req.query as HailFallbackQuery & { anchorTimestamp?: string };
    const bounds = parseHailFallbackBounds(q);
    if (!bounds) {
      res.status(400).json({ error: 'north/south/east/west required' });
      return;
    }
    const date = q.date ?? new Date().toISOString().slice(0, 10);
    if (!isValidIsoDate(date)) {
      res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      return;
    }
    const collection = await buildMrmsVectorPolygons({
      date,
      bounds,
      anchorIso: q.anchorTimestamp,
    });
    if (!collection) {
      res.status(502).json({ error: 'MRMS pipeline unavailable' });
      return;
    }
    res.set('Cache-Control', 'public, max-age=600');
    res.json(collection);
  } catch (err) {
    console.error('[mrms-vector] failed', err);
    res.status(500).json({ error: 'Failed to build MRMS vector polygons' });
  }
});

// In-repo storm-day PDF report — fallback when Susan21 is unavailable.
// Uses PDFKit (no headless browser) and pulls vector swaths from
// swath_cache so the PDF reflects the same hail polygons the map shows.
interface ReportPdfBody {
  address?: string;
  lat?: number;
  lng?: number;
  radiusMiles?: number;
  dateOfLoss?: string;
  anchorTimestamp?: string;
  historyRange?: '2y' | '3y' | '5y' | 'full';
  rep?: { name?: string; phone?: string; email?: string };
  company?: { name?: string };
  /** Optional homeowner name — surfaces in the new PDF's Property
   *  Information "Customer Info:" subsection. Omitted when blank. */
  customerName?: string;
  evidence?: Array<{
    imageUrl?: string;
    imageDataUrl?: string;
    title?: string;
    caption?: string;
  }>;
}

app.post('/api/hail/storm-report-pdf', async (req, res) => {
  // PDF generation can take 8–15s on cold-cache (GRIB2 decode + per-warning
  // NEXRAD radar fetches + property roadmap). Default Node socket timeout
  // and Railway edge-proxy idle timeout both fire well under that window
  // when the connection is silent — that was the 502s reps were seeing
  // on Gen Report clicks. Two-line fix: bump the per-request timeout to
  // 120s, then flush headers immediately so the proxy sees the connection
  // as "active" and doesn't reset it during the build.
  req.setTimeout(120_000);
  res.setTimeout(120_000);
  try {
    const body = (req.body || {}) as ReportPdfBody;
    if (
      !body.address ||
      typeof body.lat !== 'number' ||
      typeof body.lng !== 'number' ||
      !body.dateOfLoss ||
      !isValidIsoDate(body.dateOfLoss)
    ) {
      res.status(400).json({
        error: 'address, lat, lng, dateOfLoss (YYYY-MM-DD) all required',
      });
      return;
    }
    const pdf = await buildStormReportPdf({
      address: body.address,
      lat: body.lat,
      lng: body.lng,
      radiusMiles: Math.max(1, Math.min(200, body.radiusMiles ?? 35)),
      dateOfLoss: body.dateOfLoss,
      anchorTimestamp: body.anchorTimestamp ?? null,
      historyRange: body.historyRange,
      rep: {
        name: body.rep?.name ?? 'Hail Yes Rep',
        phone: body.rep?.phone,
        email: body.rep?.email,
      },
      company: { name: body.company?.name ?? 'Hail Yes Storm Intelligence' },
      customerName: body.customerName?.trim() || undefined,
      evidence: body.evidence,
    });
    // Set headers + send the full buffer once the build is done. Earlier
    // attempt was to flushHeaders() pre-build to prevent edge-proxy 502s,
    // but it conflicted with res.send()'s implicit Content-Length set
    // (ERR_HTTP_HEADERS_SENT). The req/res setTimeout(120s) above is
    // sufficient to keep Railway's proxy from idle-cutting the
    // connection — headers go out with the body in one shot.
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Length', String(pdf.length));
    res.set(
      'Content-Disposition',
      `attachment; filename="StormReport_${body.address.replace(/[^a-zA-Z0-9]/g, '_')}_${body.dateOfLoss}.pdf"`,
    );
    res.end(pdf);
  } catch (err) {
    console.error('[storm-report-pdf] failed', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to build PDF' });
    } else {
      // Headers already flushed (we set them eagerly to keep the proxy
      // happy). Best we can do is end the response — client will see a
      // truncated/invalid PDF blob; reportService.ts validates the
      // Content-Type + size on the client and shows a friendly retry.
      res.end();
    }
  }
});

// MRMS raster overlay (PNG image + metadata) — replaces the cross-repo
// Susan21 endpoints `mrms-historical-image` and `mrms-historical-meta`.
// Same color palette as the vector pipeline so the two layers always agree.
interface MrmsRasterQuery {
  date?: string;
  north?: string;
  south?: string;
  east?: string;
  west?: string;
  anchorTimestamp?: string;
  /**
   * Which MRMS product to fetch — drives the hourly scrubber. Default
   * 'mesh1440' (24-hr composite); 'mesh60' grabs the 60-min rolling max
   * file closest to anchorTimestamp so the rep can scrub hour-by-hour.
   */
  product?: 'mesh1440' | 'mesh60';
}

function parseRasterQuery(q: MrmsRasterQuery): {
  date: string | null;
  bounds: BoundingBox | null;
} {
  const bounds = parseHailFallbackBounds(q);
  const date = q.date ?? new Date().toISOString().slice(0, 10);
  if (!isValidIsoDate(date)) return { date: null, bounds: null };
  return { date, bounds };
}

app.get('/api/hail/mrms-image', async (req, res) => {
  try {
    const q = req.query as MrmsRasterQuery;
    const { date, bounds } = parseRasterQuery(q);
    if (!date || !bounds) {
      res.status(400).json({ error: 'date + north/south/east/west required' });
      return;
    }
    const result = await buildMrmsRaster({
      date,
      bounds,
      anchorIso: q.anchorTimestamp,
      product: q.product === 'mesh60' ? 'mesh60' : 'mesh1440',
    });
    if (!result) {
      res.status(502).json({ error: 'MRMS raster unavailable' });
      return;
    }
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=600');
    res.send(Buffer.from(result.pngBytes));
  } catch (err) {
    console.error('[mrms-image] failed', err);
    res.status(500).json({ error: 'Failed to build MRMS raster' });
  }
});

app.get('/api/hail/mrms-meta', async (req, res) => {
  try {
    const q = req.query as MrmsRasterQuery;
    const { date, bounds } = parseRasterQuery(q);
    if (!date || !bounds) {
      res.status(400).json({ error: 'date + north/south/east/west required' });
      return;
    }
    const result = await buildMrmsRaster({
      date,
      bounds,
      anchorIso: q.anchorTimestamp,
      product: q.product === 'mesh60' ? 'mesh60' : 'mesh1440',
    });
    if (!result) {
      // Mirror the field-assistant shape so the frontend can render its
      // "No archived MRMS hail pixels" message instead of erroring.
      res.json({
        product: 'mesh1440',
        ref_time: q.anchorTimestamp ?? `${date}T23:30:00Z`,
        has_hail: false,
        max_mesh_inches: 0,
        bounds,
      });
      return;
    }
    res.set('Cache-Control', 'public, max-age=600');
    res.json({
      product: 'mesh1440',
      ref_time: result.metadata.refTime,
      generated_at: new Date().toISOString(),
      has_hail: result.metadata.hasHail,
      max_mesh_inches: result.metadata.maxMeshInches,
      max_mesh_mm: result.metadata.maxMeshInches * 25.4,
      hail_pixels: result.metadata.hailPixels,
      bounds: result.metadata.bounds,
      requested_bounds: result.metadata.requestedBounds,
      image_size: result.metadata.imageSize,
      archive_url: result.metadata.sourceFile,
    });
  } catch (err) {
    console.error('[mrms-meta] failed', err);
    res.status(500).json({ error: 'Failed to fetch MRMS metadata' });
  }
});

// Live now-cast: today's most-recent MRMS file, decoded + contoured.
app.get('/api/hail/mrms-now-vector', async (req, res) => {
  try {
    const q = req.query as HailFallbackQuery;
    const bounds = parseHailFallbackBounds(q);
    if (!bounds) {
      res.status(400).json({ error: 'north/south/east/west required' });
      return;
    }
    const collection = await buildMrmsNowVectorPolygons(bounds);
    if (!collection) {
      res.status(502).json({ error: 'MRMS now-cast unavailable' });
      return;
    }
    res.set('Cache-Control', 'public, max-age=120');
    res.json({ ...collection, live: true, refTime: collection.metadata.refTime });
  } catch (err) {
    console.error('[mrms-now-vector] failed', err);
    res.status(500).json({ error: 'Failed to build MRMS now-cast' });
  }
});

// ── Hail dates by location ─────────────────────────────────────────────────
// Discover hail dates where the property is INSIDE an MRMS swath polygon,
// even when no point report exists in verified_hail_events and no NHP
// centerline exists for the storm. Closes the UI/PDF parity gap: previously
// the PDF would scan swath_cache and find a containment, but the UI's
// storm-dates panel relied on NHP + verified_hail_events alone — so dates
// like 2025-06-25 in Burke (real MRMS hail, no NCEI hail report, no NHP
// centerline) were invisible until the rep generated a PDF.
//
// This endpoint:
//   1. Bbox-prefilters swath_cache rows whose bbox contains the point
//   2. Decodes payload.features and runs point-in-polygon for each
//   3. Returns { date, atPropertyInches, tier='direct_hit' } for matches

// In-memory result cache. Reps load the same property multiple times in
// rapid succession (panel refresh, tab switches, navigation). Without this
// cache the endpoint hits swath_cache on every single render, hammering
// the pool when the rep's view triggers cascading mounts.
type DatesByLocationEntry = {
  expiresAt: number;
  payload: {
    dates: Array<{
      date: string;
      atPropertyInches: number;
      rawAtPropertyInches: number;
      tier: 'direct_hit';
    }>;
  };
};
const datesByLocationCache = new Map<string, DatesByLocationEntry>();
const DATES_BY_LOCATION_TTL_MS = 120_000;
const DATES_BY_LOCATION_CACHE_MAX = 500;
const DATES_BY_LOCATION_BUDGET_MS = 8_000;

function datesByLocationCacheKey(
  lat: number,
  lng: number,
  sinceStr: string,
): string {
  // Round to 0.005° (~0.35 mi) so neighbors share cache entries.
  const round = (n: number) => (Math.round(n * 200) / 200).toFixed(3);
  return `${round(lat)}|${round(lng)}|${sinceStr}`;
}

interface HailDatesByLocationQuery {
  lat?: string;
  lng?: string;
  since?: string;
  months?: string;
}

app.get('/api/hail/dates-by-location', async (req, res) => {
  try {
    const q = req.query as HailDatesByLocationQuery;
    const lat = parseFloat(q.lat ?? '');
    const lng = parseFloat(q.lng ?? '');
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.status(400).json({ error: 'lat/lng required' });
      return;
    }
    const monthsBack = Math.min(
      120,
      Math.max(1, parseInt(q.months ?? '24', 10) || 24),
    );
    const sinceStr =
      q.since && /^\d{4}-\d{2}-\d{2}$/.test(q.since)
        ? q.since
        : new Date(Date.now() - monthsBack * 30 * 86_400_000)
            .toISOString()
            .slice(0, 10);

    if (!pgSql) {
      res.json({ dates: [] });
      return;
    }

    // L1 cache — most rep navigation re-fires the same query. 2-min TTL
    // is short enough that fresh swath_cache writes from the worker
    // surface quickly while still keeping the DB unburdened during a
    // session.
    const cacheKey = datesByLocationCacheKey(lat, lng, sinceStr);
    const cached = datesByLocationCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      res.set('Cache-Control', 'public, max-age=120');
      res.json(cached.payload);
      return;
    }

    // Bbox-prefilter: only candidates where the cached bbox contains the
    // property. DISTINCT ON (date) collapses 10+ same-day cached entries
    // (different scan times) to one. feature_count >= 4 + max_value >=
    // 0.25 filters out SPC/IEM-buffered fallback writes (1-3 features)
    // without the slow JSONB metadata.source extraction.
    //
    // 8s SQL budget. Under heavy DB load this endpoint was racing against
    // statement_timeout=30s and blocking the pool for everything else;
    // failing fast with an empty result is better than holding a slot.
    type SwathRow = {
      date: string;
      payload: {
        features: Array<{
          properties: { sizeInches: number };
          geometry: { coordinates: number[][][][] };
        }>;
      };
    };
    const queryPromise = pgSql<SwathRow[]>`
      SELECT DISTINCT ON (date) date::text, payload
        FROM swath_cache
       WHERE source IN ('mrms-hail', 'mrms-vector', 'mrms-mesh')
         AND date >= ${sinceStr}
         AND bbox_south <= ${lat} AND bbox_north >= ${lat}
         AND bbox_west  <= ${lng} AND bbox_east  >= ${lng}
         AND feature_count >= 4
         AND max_value >= 0.25
       ORDER BY date DESC, max_value DESC
       LIMIT 100
    `;
    const candidates = (await Promise.race([
      queryPromise,
      new Promise<SwathRow[]>((resolve) =>
        setTimeout(() => resolve([]), DATES_BY_LOCATION_BUDGET_MS),
      ),
    ])) as SwathRow[];

    // Per-date max band-the-house-is-in. Multiple cached entries (different
    // hours) for the same date — keep the highest band that contains the
    // point. ¼" trace floor matches the existing display logic.
    const byDate = new Map<string, number>();
    for (const row of candidates) {
      const features = row.payload?.features ?? [];
      let bestSize = 0;
      for (const feat of features) {
        const sz = Number(feat.properties?.sizeInches ?? 0);
        if (sz < 0.25) continue; // sub-trace floor
        const polys = feat.geometry?.coordinates ?? [];
        let inside = false;
        for (const poly of polys) {
          if (!poly || poly.length === 0) continue;
          if (!pointInRing(lat, lng, poly[0])) continue;
          // hole check — outer must contain, holes must not
          let inHole = false;
          for (let r = 1; r < poly.length; r += 1) {
            if (pointInRing(lat, lng, poly[r])) {
              inHole = true;
              break;
            }
          }
          if (!inHole) {
            inside = true;
            break;
          }
        }
        if (inside && sz > bestSize) bestSize = sz;
      }
      if (bestSize > 0) {
        const existing = byDate.get(row.date) ?? 0;
        if (bestSize > existing) byDate.set(row.date, bestSize);
      }
    }

    // Apply the adjuster-credibility display cap before returning. Reps and
    // adjusters expect "flat" sizes (0.75 / 1.0 / 1.25 / ...) — never the
    // raw IHM band like 0.38 (3/8") which doesn't appear in HailTrace or
    // HailRecon outputs. Pass an unverified context so we get the floor +
    // pass-through bands; consensus / Sterling-class paths require a bulk
    // verification lookup we don't run from this hot endpoint.
    const unverifiedCtx = {
      isVerified: false,
      isAtLocation: false,
      isSterlingClass: false,
      consensusSize: null,
    };
    const dates = Array.from(byDate.entries())
      .map(([date, rawAtProperty]) => {
        const display = displayHailInches(rawAtProperty, unverifiedCtx);
        return {
          date,
          atPropertyInches: display ?? rawAtProperty,
          rawAtPropertyInches: rawAtProperty,
          tier: 'direct_hit' as const,
        };
      })
      .filter((d) => d.atPropertyInches !== null)
      .sort((a, b) => b.date.localeCompare(a.date));

    const payload = { dates };

    // Cache for 2 min (shared across nearby reps) + cap entries to avoid
    // unbounded growth.
    datesByLocationCache.set(cacheKey, {
      expiresAt: Date.now() + DATES_BY_LOCATION_TTL_MS,
      payload,
    });
    while (datesByLocationCache.size > DATES_BY_LOCATION_CACHE_MAX) {
      const oldest = datesByLocationCache.keys().next().value;
      if (!oldest) break;
      datesByLocationCache.delete(oldest);
    }

    res.set('Cache-Control', 'public, max-age=120');
    res.json(payload);
  } catch (err) {
    console.error('[dates-by-location] failed', err);
    res.status(500).json({ error: 'Failed to find MRMS hail dates' });
  }
});

interface MrmsImpactBody {
  date?: string;
  bounds?: { north: number; south: number; east: number; west: number };
  anchorTimestamp?: string;
  points?: Array<{ id: string; lat: number; lng: number }>;
}

/**
 * Per-date MRMS impact classifier — SA21 `addressImpactService` parity.
 *
 * Body: `{ lat, lng, dates: string[], radiusMiles? }`
 * For each date, runs `buildMrmsImpactResponse` against a property+radius
 * bbox and returns the polygon-truth tier (DIRECT HIT when the point falls
 * inside any swath polygon). Falls back to distance classification for
 * dates with no swath geometry.
 *
 * The storm-dates list calls this once per address load to colour each row
 * with the same tier the AddressImpactBadge would show — eliminates the
 * "DIRECT HIT card vs NEAR MISS row" inconsistency for the same date.
 */
interface PerDateImpactBody {
  lat?: number;
  lng?: number;
  dates?: string[];
  radiusMiles?: number;
}

/**
 * Path B (ground-report upgrade) — bulk lookup for the per-date-impact path.
 *
 * Catches the case SA21 documents at `8482 Stonewall Rd, 4/1/2026`: the MRMS
 * polygon's vertices didn't quite enclose the property lat/lng, so the
 * polygon-containment check (Path A) returned false, yet three federal
 * ground reports of 1.0–1.25" hail sat within 0.7 mi of the address.
 *
 * Threshold: any verified_hail_events row from a federal ground source
 * (NCEI Storm Events, NCEI SWDI, IEM LSR, mPING, SPC) with hail_size_inches
 * ≥ 0.5" within ≤1.0 mi of the property. One match is enough — multiple
 * federal sources independently observing claim-grade hail next door is the
 * strongest non-radar evidence we have.
 */
interface GroundUpgradeRow {
  event_date: string | Date;
  closest_mi: number;
  max_hail: number;
  source_count: number;
}

async function fetchGroundReportUpgrades(
  lat: number,
  lng: number,
  dates: string[],
): Promise<Map<string, { closestMi: number; maxHail: number }>> {
  if (!pgSql || dates.length === 0) return new Map();
  // Coerce to plain ISO strings + compare event_date::text against text[] —
  // postgres.js's ${arr}::date[] path was throwing "Received an instance of
  // Array" in prod, silently disabling Path B ground-report upgrades.
  const dateStrs = dates.map((d) => String(d).slice(0, 10));
  try {
    const rows = await pgSql<GroundUpgradeRow[]>`
      SELECT
        event_date,
        MIN(
          3959 * acos(
            LEAST(1.0,
              cos(radians(${lat})) * cos(radians(lat)) *
              cos(radians(lng) - radians(${lng})) +
              sin(radians(${lat})) * sin(radians(lat))
            )
          )
        )::float AS closest_mi,
        MAX(COALESCE(hail_size_inches, magnitude, 0))::float AS max_hail,
        (
          (BOOL_OR(source_ncei_storm_events))::int +
          (BOOL_OR(source_ncei_swdi))::int +
          (BOOL_OR(source_iem_lsr))::int +
          (BOOL_OR(source_mping))::int +
          (BOOL_OR(source_spc_hail))::int
        ) AS source_count
        FROM verified_hail_events
       WHERE event_date::text = ANY(${dateStrs})
         AND lat BETWEEN ${lat - 0.02} AND ${lat + 0.02}
         AND lng BETWEEN ${lng - 0.025} AND ${lng + 0.025}
         AND COALESCE(hail_size_inches, magnitude, 0) >= 0.5
         AND (
           source_ncei_storm_events
           OR source_ncei_swdi
           OR source_iem_lsr
           OR source_mping
           OR source_spc_hail
         )
       GROUP BY event_date
       HAVING MIN(
         3959 * acos(
           LEAST(1.0,
             cos(radians(${lat})) * cos(radians(lat)) *
             cos(radians(lng) - radians(${lng})) +
             sin(radians(${lat})) * sin(radians(lat))
           )
         )
       ) <= 1.0
    `;
    const out = new Map<string, { closestMi: number; maxHail: number }>();
    for (const r of rows) {
      const dateStr =
        r.event_date instanceof Date
          ? r.event_date.toISOString().slice(0, 10)
          : String(r.event_date).slice(0, 10);
      out.set(dateStr, { closestMi: r.closest_mi, maxHail: r.max_hail });
    }
    return out;
  } catch (err) {
    console.warn('[per-date-impact] ground upgrade query failed:', (err as Error).message);
    return new Map();
  }
}

// ── per-date-impact concurrency + negative cache ───────────────────────────
// MRMS GRIB fetches are the heaviest upstream call we make. At the old
// `Promise.all(dates.map(...))` over up to 60 dates, a 10Y range sweep would
// kick off 60 simultaneous GRIB decodes — which is what crashed prod twice
// on 2026-04-29. We cap concurrency to 4 and remember "no MRMS" misses so
// repeated date sweeps don't refetch the same negative result.
const PER_DATE_IMPACT_CONCURRENCY = 4;
// Per-date budget. If a single MRMS lookup takes longer than this, treat
// it as "unknown" and move on. Keeps a slow upstream from pinning the
// whole 60-date batch past the Railway edge timeout (~30s).
const PER_DATE_IMPACT_BUDGET_MS = 12_000;

function withBudget<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}
type PerDateUnknownEntry = { expiresAt: number };
const perDateUnknownCache = new Map<string, PerDateUnknownEntry>();
const PER_DATE_UNKNOWN_CACHE_MAX = 5000;

function perDateUnknownKey(
  lat: number,
  lng: number,
  radiusMi: number,
  date: string,
): string {
  // Round to 0.01° (~0.7 mi) so neighbors share negative entries.
  const round = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
  return `${date}|${round(lat)}|${round(lng)}|${radiusMi}`;
}

function perDateUnknownTtlMs(date: string): number {
  const ageDays =
    (Date.now() - Date.parse(`${date}T12:00:00Z`)) / 86_400_000;
  if (ageDays < 1) return 15 * 60 * 1000; // 15 min
  if (ageDays < 7) return 60 * 60 * 1000; // 1 h
  if (ageDays < 30) return 6 * 60 * 60 * 1000; // 6 h
  return 24 * 60 * 60 * 1000; // 1 d
}

function getCachedUnknown(key: string): boolean {
  const hit = perDateUnknownCache.get(key);
  if (!hit) return false;
  if (hit.expiresAt <= Date.now()) {
    perDateUnknownCache.delete(key);
    return false;
  }
  // touch for LRU-by-insertion-order
  perDateUnknownCache.delete(key);
  perDateUnknownCache.set(key, hit);
  return true;
}

function setCachedUnknown(key: string, ttlMs: number): void {
  perDateUnknownCache.set(key, { expiresAt: Date.now() + ttlMs });
  while (perDateUnknownCache.size > PER_DATE_UNKNOWN_CACHE_MAX) {
    const oldest = perDateUnknownCache.keys().next().value;
    if (!oldest) break;
    perDateUnknownCache.delete(oldest);
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        results[i] = await worker(items[i], i);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

app.post('/api/hail/per-date-impact', async (req, res) => {
  try {
    const body = (req.body || {}) as PerDateImpactBody;
    if (
      typeof body.lat !== 'number' ||
      typeof body.lng !== 'number' ||
      !Array.isArray(body.dates)
    ) {
      res.status(400).json({ error: 'lat, lng, dates[] required' });
      return;
    }
    const radiusMi = Math.max(1, Math.min(60, body.radiusMiles ?? 25));
    const latPad = radiusMi / 69;
    const lngPad = radiusMi / (69 * Math.cos((body.lat * Math.PI) / 180));
    const bounds = {
      north: body.lat + latPad,
      south: body.lat - latPad,
      east: body.lng + lngPad,
      west: body.lng - lngPad,
    };

    const dates = body.dates.slice(0, 60).filter(isValidIsoDate);

    // Short-circuit dates we've already classified as "unknown" recently.
    // Those still need ground-upgrade + verification lookups (cheap bulk
    // queries), but skip the expensive per-date MRMS GRIB fetch.
    const knownUnknown = new Set<string>();
    const datesNeedingMrms: string[] = [];
    for (const d of dates) {
      if (getCachedUnknown(perDateUnknownKey(body.lat, body.lng, radiusMi, d))) {
        knownUnknown.add(d);
      } else {
        datesNeedingMrms.push(d);
      }
    }

    // Two bulk lookups in parallel: Path B ground-report upgrade AND
    // per-date VerificationContext (≥3 ground / ≥1 gov / consensus
    // size). The verification context drives the display-cap algorithm;
    // raw MRMS values stay in the database, only the display layer caps.
    const [groundUpgradeByDate, verificationByDate] = await Promise.all([
      fetchGroundReportUpgrades(body.lat, body.lng, dates),
      buildVerificationBulk({ lat: body.lat, lng: body.lng, dates }),
    ]);

    /** Cap a raw at-property hail size for display; returns the raw
     *  alongside so consumers / debug tooling can still see truth. */
    const cap = (
      raw: number | null | undefined,
      date: string,
    ): { display: number | null; raw: number | null } => {
      const v = verificationByDate.get(date) ?? {
        isVerified: false,
        isAtLocation: false,
        isSterlingClass: false,
        consensusSize: null,
      };
      const r = raw ?? 0;
      return { display: displayHailInches(r, v), raw: raw ?? null };
    };

    const results = await mapWithConcurrency(
      dates,
      PER_DATE_IMPACT_CONCURRENCY,
      async (date) => {
        // Cached "unknown" — skip MRMS but still apply ground upgrade if
        // present (verified_hail_events may have landed since we cached).
        if (knownUnknown.has(date)) {
          const ground = groundUpgradeByDate.get(date);
          if (ground) {
            const { display, raw } = cap(ground.maxHail, date);
            return {
              date,
              tier: 'direct_hit',
              directHit: true,
              upgradedVia: 'ground_report',
              closestMiles: ground.closestMi,
              atPropertyInches: display,
              rawAtPropertyInches: raw,
              stormPeakInches: ground.maxHail,
            };
          }
          return { date, tier: 'unknown', directHit: false, closestMiles: null };
        }
        try {
          const resp = await withBudget(
            buildMrmsImpactResponse({
              date,
              bounds,
              points: [{ id: 'addr', lat: body.lat!, lng: body.lng! }],
            }),
            PER_DATE_IMPACT_BUDGET_MS,
          );
          const r = resp?.results[0];
          if (!r) {
            const ground = groundUpgradeByDate.get(date);
            if (ground) {
              const { display, raw } = cap(ground.maxHail, date);
              return {
                date,
                tier: 'direct_hit',
                directHit: true,
                upgradedVia: 'ground_report',
                closestMiles: ground.closestMi,
                atPropertyInches: display,
                rawAtPropertyInches: raw,
                stormPeakInches: ground.maxHail,
              };
            }
            // Remember this miss so a re-issued sweep for the same
            // neighborhood doesn't refetch GRIB.
            setCachedUnknown(
              perDateUnknownKey(body.lat!, body.lng!, radiusMi, date),
              perDateUnknownTtlMs(date),
            );
            return { date, tier: 'unknown', directHit: false, closestMiles: null };
          }
          // Path A direct hit — polygon contains property; bands.atProperty
          // is now the band-the-house-is-in size (per 2026-04-27 meeting).
          if (r.tier === 'direct_hit') {
            const { display, raw } = cap(r.bands?.atProperty ?? null, date);
            return {
              date,
              tier: r.tier,
              directHit: true,
              upgradedVia: 'polygon',
              closestMiles: r.edgeDistanceMiles ?? null,
              atPropertyInches: display,
              rawAtPropertyInches: raw,
              stormPeakInches: resp?.metadata.stormMaxInches ?? null,
            };
          }
          // Path B — polygon missed, but federal ground reports confirm.
          const ground = groundUpgradeByDate.get(date);
          if (ground) {
            const rawCombined = Math.max(
              ground.maxHail,
              r.bands?.atProperty ?? 0,
            );
            const { display, raw } = cap(rawCombined, date);
            return {
              date,
              tier: 'direct_hit',
              directHit: true,
              upgradedVia: 'ground_report',
              closestMiles: Math.min(
                ground.closestMi,
                r.edgeDistanceMiles ?? Number.POSITIVE_INFINITY,
              ),
              atPropertyInches: display,
              rawAtPropertyInches: raw,
              stormPeakInches: Math.max(
                ground.maxHail,
                resp?.metadata.stormMaxInches ?? 0,
              ),
            };
          }
          // No direct hit — distance-band tier from polygon edge scan.
          const { display, raw } = cap(r.bands?.atProperty ?? null, date);
          return {
            date,
            tier: r.tier,
            directHit: r.directHit,
            closestMiles: r.edgeDistanceMiles ?? null,
            atPropertyInches: display,
            rawAtPropertyInches: raw,
            stormPeakInches: resp?.metadata.stormMaxInches ?? null,
          };
        } catch {
          return { date, tier: 'unknown', directHit: false, closestMiles: null };
        }
      },
    );

    res.json({ results });
  } catch (err) {
    console.error('[per-date-impact] failed', err);
    res.status(500).json({ error: 'Failed to classify per-date impact' });
  }
});

app.post('/api/hail/mrms-impact', async (req, res) => {
  try {
    const body = (req.body || {}) as MrmsImpactBody;
    if (
      !body.bounds ||
      !Array.isArray(body.points) ||
      body.points.length === 0
    ) {
      res.status(400).json({ error: 'bounds and points required' });
      return;
    }
    const date = body.date ?? new Date().toISOString().slice(0, 10);
    if (!isValidIsoDate(date)) {
      res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      return;
    }
    const response = await buildMrmsImpactResponse({
      date,
      bounds: body.bounds,
      anchorIso: body.anchorTimestamp,
      points: body.points,
    });
    if (!response) {
      res.status(502).json({ error: 'MRMS pipeline unavailable' });
      return;
    }

    // Apply display-cap algorithm per point with PER-BAND verification —
    // each column (atProperty / 1-3 / 3-5) runs the cap with its own
    // VerificationContext computed from primary-source reports IN that
    // band, per the 2026-04-27 afternoon addendum. mi5to10 falls back to
    // the atProperty context (the column is dropped from PDFs anyway and
    // there's no per-band verification beyond 5 mi). Raw values are
    // preserved in rawBands.
    const verificationByPoint = await Promise.all(
      body.points.map((p) =>
        buildBandedVerificationBulk({
          lat: p.lat,
          lng: p.lng,
          dates: [date],
        }).then((m) => m.get(date) ?? null),
      ),
    );
    for (let i = 0; i < response.results.length; i += 1) {
      const r = response.results[i];
      const banded = verificationByPoint[i];
      if (!banded || !r.bands) continue;
      const rawBands = { ...r.bands };
      r.bands = {
        atProperty: displayHailInches(r.bands.atProperty ?? 0, banded.atProperty),
        mi1to3: displayHailInches(r.bands.mi1to3 ?? 0, banded.mi1to3),
        mi3to5: displayHailInches(r.bands.mi3to5 ?? 0, banded.mi3to5),
        mi5to10: displayHailInches(r.bands.mi5to10 ?? 0, banded.mi3to5),
      };
      // Attach raw alongside for transparency / audit trail.
      (r as MrmsImpactResultWithRaw).rawBands = rawBands;
      // The headline maxHailInches should also reflect the capped
      // at-property reading when present.
      r.maxHailInches = r.bands.atProperty ?? r.maxHailInches;
    }
    res.json(response);
  } catch (err) {
    console.error('[mrms-impact] failed', err);
    res.status(500).json({ error: 'Failed to compute MRMS impact' });
  }
});

// Internal helper type — augments MrmsImpactResult with the raw bands
// snapshot for callers that want the underlying truth alongside display.
type MrmsImpactResultWithRaw = import('./storm/mrmsService.js').MrmsImpactResult & {
  rawBands?: import('./storm/mrmsService.js').ImpactBands;
};

app.get('/api/hail/swath-fallback', async (req, res) => {
  try {
    const q = req.query as HailFallbackQuery;
    const bounds = parseHailFallbackBounds(q);
    if (!bounds) {
      res.status(400).json({ error: 'north/south/east/west required' });
      return;
    }
    const date = q.date ?? new Date().toISOString().slice(0, 10);
    if (!isValidIsoDate(date)) {
      res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      return;
    }
    const states =
      q.states && q.states.length > 0
        ? q.states.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
        : WIND_FOCUS_STATES;
    const collection = await buildHailFallbackCollection({
      date,
      bounds,
      states,
    });
    res.set('Cache-Control', 'public, max-age=300');
    res.json(collection);
  } catch (err) {
    console.error('[hail-fallback] failed', err);
    res.status(500).json({ error: 'Failed to build hail fallback' });
  }
});

interface HailImpactBody {
  date?: string;
  bounds?: { north: number; south: number; east: number; west: number };
  states?: string[];
  points?: Array<{ id: string; lat: number; lng: number }>;
}

app.post('/api/hail/impact-fallback', async (req, res) => {
  try {
    const body = (req.body || {}) as HailImpactBody;
    if (
      !body.bounds ||
      !Array.isArray(body.points) ||
      body.points.length === 0
    ) {
      res.status(400).json({ error: 'bounds and points required' });
      return;
    }
    const date = body.date ?? new Date().toISOString().slice(0, 10);
    if (!isValidIsoDate(date)) {
      res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      return;
    }
    const response = await buildHailImpactResponse({
      date,
      bounds: body.bounds,
      states: body.states && body.states.length > 0 ? body.states : WIND_FOCUS_STATES,
      points: body.points,
    });
    res.json(response);
  } catch (err) {
    console.error('[hail-impact-fallback] failed', err);
    res.status(500).json({ error: 'Failed to compute hail impact' });
  }
});

// ── Storm events (cached aggregator) ────────────────────────────
// Server-side multi-source storm event fetcher (SPC + IEM LSR), backed by
// `event_cache`. Two reps querying nearly the same neighborhood share the
// same 3–8 second decode work.
interface StormEventsQuery {
  lat?: string;
  lng?: string;
  radius?: string;
  months?: string;
  since?: string;
  states?: string;
}

app.get('/api/storm/events', async (req, res) => {
  try {
    const q = req.query as StormEventsQuery;
    const lat = parseFloat(q.lat ?? '');
    const lng = parseFloat(q.lng ?? '');
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.status(400).json({ error: 'lat/lng required' });
      return;
    }
    const radiusMiles = Math.min(
      200,
      Math.max(1, parseFloat(q.radius ?? '50') || 50),
    );
    const months = Math.min(
      120,
      Math.max(1, parseInt(q.months ?? '12', 10) || 12),
    );
    const since = q.since && /^\d{4}-\d{2}-\d{2}$/.test(q.since) ? q.since : null;
    const states =
      q.states && q.states.length > 0
        ? q.states.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
        : WIND_FOCUS_STATES;

    const result = await fetchStormEventsCached({
      lat,
      lng,
      radiusMiles,
      months,
      sinceDate: since,
      states,
    });
    // Short browser cache so a back-button doesn't refire the full request.
    res.set('Cache-Control', 'public, max-age=120');
    res.json(result);
  } catch (err) {
    console.error('[storm-events] failed', err);
    res.status(500).json({ error: 'Failed to fetch storm events' });
  }
});

// ── Consilience (5-source corroboration) ──────────────────────
// GET /api/storm/consilience?lat=X&lng=Y&date=YYYY-MM-DD[&radius=5]
//   Returns the 5-source consilience result for a property + date.
//   Rep dashboard hits this to render the yellow-flag low-confidence indicator
//   on storm date cards. Synoptic source is silently skipped if SYNOPTIC_TOKEN
//   isn't set in env.
interface ConsilienceQuery {
  lat?: string;
  lng?: string;
  date?: string;
  radius?: string;
}

app.get('/api/storm/consilience', async (req, res) => {
  try {
    const q = req.query as ConsilienceQuery;
    const lat = parseFloat(q.lat ?? '');
    const lng = parseFloat(q.lng ?? '');
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.status(400).json({ error: 'lat/lng required' });
      return;
    }
    if (!q.date || !/^\d{4}-\d{2}-\d{2}$/.test(q.date)) {
      res.status(400).json({ error: 'date (YYYY-MM-DD) required' });
      return;
    }
    const radius = q.radius
      ? Math.min(25, Math.max(1, parseFloat(q.radius) || 5))
      : 5;
    const result = await buildConsilience({
      lat,
      lng,
      date: q.date,
      radiusMiles: radius,
    });
    // 10-min browser cache; consilience drift over <10min is negligible
    // because the underlying SPC/IEM/MRMS/Synoptic feeds update slower.
    res.set('Cache-Control', 'public, max-age=600');
    res.json(result);
  } catch (err) {
    console.error('[consilience] failed', err);
    res.status(500).json({ error: 'Failed to compute consilience' });
  }
});

// ── Consilience history (per-property trend) ────────────────────
// GET /api/storm/consilience-history?lat=X&lng=Y[&monthsBack=12]
//   Returns the cached consilience timeline for a property — used by the
//   dashboard trend chart. Reads from consilience_cache so each row is
//   pre-computed, no live fan-out per chart render.
interface ConsilienceHistoryQuery {
  lat?: string;
  lng?: string;
  monthsBack?: string;
  radius?: string;
}

app.get('/api/storm/consilience-history', async (req, res) => {
  try {
    const q = req.query as ConsilienceHistoryQuery;
    const lat = parseFloat(q.lat ?? '');
    const lng = parseFloat(q.lng ?? '');
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.status(400).json({ error: 'lat/lng required' });
      return;
    }
    const monthsBack = Math.min(60, Math.max(1, parseInt(q.monthsBack ?? '12', 10) || 12));
    // Default radius=15mi to match the prewarm scheduler — the cached entries
    // are computed at radius=15. Specify `?radius=N` to query other radii
    // (cache miss triggers live recompute via the consilience endpoint).
    const radius = q.radius ? Math.min(25, Math.max(1, parseFloat(q.radius) || 15)) : 15;
    const latQ = Math.round(lat * 100) / 100;
    const lngQ = Math.round(lng * 100) / 100;
    const rows = await pgSql<
      Array<{
        event_date: string | Date;
        confirmed_count: number;
        confidence_tier: string;
        payload: Record<string, unknown>;
      }>
    >`
      SELECT event_date::text, confirmed_count, confidence_tier, payload
        FROM consilience_cache
       WHERE lat_q BETWEEN ${latQ - 0.02} AND ${latQ + 0.02}
         AND lng_q BETWEEN ${lngQ - 0.02} AND ${lngQ + 0.02}
         AND radius_miles = ${radius}
         AND event_date >= (CURRENT_DATE - ${monthsBack}::int * INTERVAL '1 month')::date
       ORDER BY event_date ASC
       LIMIT 500
    `;
    const points = rows.map((r) => {
      const dateStr =
        r.event_date instanceof Date
          ? r.event_date.toISOString().slice(0, 10)
          : String(r.event_date).slice(0, 10);
      const payload = r.payload as {
        curated?: { confirmedSources?: string[] };
        totalSources?: number;
      };
      return {
        date: dateStr,
        confirmedCount: Number(r.confirmed_count),
        // Pre-12-source cache rows ship without totalSources — fall back to 12.
        totalSources: payload?.totalSources ?? 12,
        confidenceTier: r.confidence_tier,
        confirmedSources: payload?.curated?.confirmedSources ?? [],
      };
    });
    res.set('Cache-Control', 'public, max-age=600');
    res.json({ ok: true, points, count: points.length });
  } catch (err) {
    console.error('[consilience-history] failed', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// ── mPING crowd-source feed ───────────────────────────────────
// GET /api/storm/mping?windowMinutes=60[&north&south&east&west]   live window
// ── Live storm cells (for the Active Storms panel + map layer) ────────
// GET /api/storm/live-cells[?north=&south=&east=&west=]
//   Returns the current MRMS now-cast hail polygons + NWS active SVR
//   warnings + summary metadata in one response. Powers the rep-facing
//   "Active Storms" panel that auto-fills when something is firing.
//   Cached 90s — alignment with NWS poll cadence.
interface LiveCellsQuery {
  north?: string;
  south?: string;
  east?: string;
  west?: string;
}
// In-memory cache for live-cells responses, keyed by bounds bucket. Cold
// MRMS GRIB2 fetches take 4-6s — Railway's edge proxy times out and reps see
// 502s on the every-90s poll. Keeping a 60s in-process snapshot per bucket
// means the upstream is hit ~1×/min/bucket regardless of poll volume.
type LiveCellsSnapshot = { ts: number; payload: object };
const liveCellsCache = new Map<string, LiveCellsSnapshot>();
const LIVE_CELLS_TTL_MS = 60_000;

function liveCellsCacheKey(b: BoundingBox): string {
  // 0.5° bucket — enough to differentiate territory vs viewport polls
  // without exploding the cache. Floor to bucket on each axis.
  const bucket = (n: number) => Math.round(n * 2) / 2;
  return `${bucket(b.north)}|${bucket(b.south)}|${bucket(b.east)}|${bucket(b.west)}`;
}

app.get('/api/storm/live-cells', async (req, res) => {
  try {
    const q = req.query as LiveCellsQuery;
    // Default bounds: NoVA / VA / MD / PA / DC / DE / NJ focus territory.
    const bounds = {
      north: parseFloat(q.north ?? '42.5'),
      south: parseFloat(q.south ?? '36.5'),
      east: parseFloat(q.east ?? '-74.5'),
      west: parseFloat(q.west ?? '-83.5'),
    };

    const key = liveCellsCacheKey(bounds);
    const cached = liveCellsCache.get(key);
    if (cached && Date.now() - cached.ts < LIVE_CELLS_TTL_MS) {
      res.set('Cache-Control', 'public, max-age=60');
      res.set('X-Live-Cells-Cache', 'hit');
      res.json(cached.payload);
      return;
    }

    const [collection, svrPolygons] = await Promise.all([
      buildMrmsNowVectorPolygons(bounds).catch(() => null),
      fetchActiveSvrPolygons({ bounds }).catch(() => [] as Awaited<ReturnType<typeof fetchActiveSvrPolygons>>),
    ]);
    const maxBandIn =
      collection?.features.reduce(
        (m, f) => Math.max(m, f.properties.sizeInches),
        0,
      ) ?? 0;
    const cellCount = collection?.features.length ?? 0;
    const status = getLiveMrmsAlertStatus();
    const payload = {
      ok: true,
      // Active = either current radar shows ≥¼" hail OR an SVR/Tornado warning is up.
      active: maxBandIn >= 0.25 || svrPolygons.length > 0,
      mrms: {
        refTime: collection?.metadata.refTime ?? null,
        maxHailInches: maxBandIn,
        cellCount,
        // Lightweight feature collection for the map layer (no metadata).
        features: collection?.features ?? [],
      },
      nws: {
        warnings: svrPolygons,
        count: svrPolygons.length,
      },
      worker: {
        active: status.active,
        firedTodayByState: status.firedTodayByState,
        lastFiredAt: status.lastFiredAt,
      },
    };
    liveCellsCache.set(key, { ts: Date.now(), payload });
    res.set('Cache-Control', 'public, max-age=60');
    res.set('X-Live-Cells-Cache', 'miss');
    res.json(payload);
  } catch (err) {
    console.error('[live-cells] failed', err);
    res.status(500).json({ error: 'Failed to build live cells response' });
  }
});

// ── Parcel geometry (for the property polygon overlay) ─────────────────
// GET /api/property/parcel?lat=X&lng=Y
//   Returns the lot's polygon rings if the point falls inside a county
//   we have an ArcGIS endpoint for. Outside coverage → 200 + null payload.
interface ParcelQuery {
  lat?: string;
  lng?: string;
}
app.get('/api/property/parcel', async (req, res) => {
  try {
    const q = req.query as ParcelQuery;
    const lat = parseFloat(q.lat ?? '');
    const lng = parseFloat(q.lng ?? '');
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.status(400).json({ error: 'lat/lng required' });
      return;
    }
    const parcel = await fetchParcelGeometry(lat, lng);
    res.set('Cache-Control', 'public, max-age=86400'); // 24h — parcels rarely change
    res.json({ ok: true, parcel });
  } catch (err) {
    console.error('[parcel] failed', err);
    res.status(500).json({ error: 'Failed to fetch parcel geometry' });
  }
});

// ── Census geocoder server proxy ───────────────────────────────────────
// GET /api/geocode/census?address=<query>
//   Proxies the free US Census Bureau geocoder. The browser-side fetch was
//   blocked by CORS + intermittent 503s; running it server-side fixes both
//   and lets us cache + retry. Used as a fallback when Google geocode
//   returns ZERO_RESULTS (typos, partial addresses).
interface CensusGeocodeQuery {
  address?: string;
}
app.get('/api/geocode/census', async (req, res) => {
  try {
    const q = req.query as CensusGeocodeQuery;
    const address = (q.address ?? '').trim();
    if (!address || address.length > 300) {
      res.status(400).json({ error: 'address required (max 300 chars)' });
      return;
    }
    const params = new URLSearchParams({
      address,
      benchmark: 'Public_AR_Current',
      format: 'json',
    });
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8_000);
    try {
      const upstream = await fetch(
        `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${params}`,
        { signal: ac.signal, headers: { 'User-Agent': 'hail-yes/1.0 (Hail Yes Storm Intelligence)' } },
      );
      clearTimeout(timer);
      if (!upstream.ok) {
        res.status(502).json({ error: `Census geocoder returned ${upstream.status}` });
        return;
      }
      const data = (await upstream.json()) as {
        result?: { addressMatches?: Array<{ matchedAddress?: string; coordinates?: { x: number; y: number } }> };
      };
      const matches = data.result?.addressMatches ?? [];
      const first = matches[0];
      if (!first?.coordinates) {
        res.set('Cache-Control', 'public, max-age=300');
        res.json({ ok: true, match: null });
        return;
      }
      res.set('Cache-Control', 'public, max-age=86400');
      res.json({
        ok: true,
        match: {
          address: first.matchedAddress ?? address,
          lat: first.coordinates.y,
          lng: first.coordinates.x,
        },
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.error('[geocode-census] failed', err);
    res.status(500).json({ error: 'Failed to geocode address' });
  }
});

// ── CoCoRaHS observer hail reports ─────────────────────────────────────
// GET /api/storm/cocorahs?date=YYYY-MM-DD&state=VA[&state=MD&state=PA]
//   Returns daily citizen-observer hail-pad measurements. Free, no key.
//   When multiple states are passed, fetches in parallel and merges.
interface CocorahsQuery {
  date?: string;
  state?: string | string[];
  north?: string;
  south?: string;
  east?: string;
  west?: string;
}
app.get('/api/storm/cocorahs', async (req, res) => {
  try {
    const q = req.query as CocorahsQuery;
    if (!q.date || !/^\d{4}-\d{2}-\d{2}$/.test(q.date)) {
      res.status(400).json({ error: 'date (YYYY-MM-DD) required' });
      return;
    }
    const states = Array.isArray(q.state)
      ? q.state.map((s) => s.toUpperCase())
      : q.state
        ? [q.state.toUpperCase()]
        : ['VA', 'MD', 'PA', 'WV', 'DC', 'DE', 'NJ'];
    const bbox =
      q.north && q.south && q.east && q.west
        ? {
            north: parseFloat(q.north),
            south: parseFloat(q.south),
            east: parseFloat(q.east),
            west: parseFloat(q.west),
          }
        : undefined;
    const settled = await Promise.allSettled(
      states.map((state) => fetchCocorahsHailReports({ date: q.date as string, state, bbox })),
    );
    const reports = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    res.set('Cache-Control', 'public, max-age=600');
    res.json({ ok: true, reports, count: reports.length, states });
  } catch (err) {
    console.error('[cocorahs] failed', err);
    res.status(500).json({ error: 'Failed to fetch CoCoRaHS reports' });
  }
});

// ── NEXRAD Mesocyclone (nx3mda) detections ─────────────────────────────
// GET /api/storm/mesocyclones?date=YYYY-MM-DD&north=...&south=...&east=...&west=...
//   Returns rotating-updraft (supercell) detections from NEXRAD Level-3
//   nx3mda. Strength ≥6 is supercell-class; ≥8 is tornado-warning class.
interface MesoQueryParams {
  date?: string;
  north?: string;
  south?: string;
  east?: string;
  west?: string;
  minStrength?: string;
}
app.get('/api/storm/mesocyclones', async (req, res) => {
  try {
    const q = req.query as MesoQueryParams;
    if (!q.date || !/^\d{4}-\d{2}-\d{2}$/.test(q.date)) {
      res.status(400).json({ error: 'date (YYYY-MM-DD) required' });
      return;
    }
    if (!q.north || !q.south || !q.east || !q.west) {
      res.status(400).json({ error: 'bbox (north/south/east/west) required' });
      return;
    }
    const bbox = {
      north: parseFloat(q.north),
      south: parseFloat(q.south),
      east: parseFloat(q.east),
      west: parseFloat(q.west),
    };
    const minStrength = q.minStrength ? parseInt(q.minStrength, 10) || 5 : 5;
    const detections = await fetchMesocyclones({ date: q.date, bbox, minStrength });
    res.set('Cache-Control', 'public, max-age=900');
    res.json({ ok: true, detections, count: detections.length });
  } catch (err) {
    console.error('[mesocyclones] failed', err);
    res.status(500).json({ error: 'Failed to fetch mesocyclone detections' });
  }
});

// ── Synoptic surface stations corroboration ────────────────────────────
// GET /api/storm/synoptic-stations?date=YYYY-MM-DD&north&south&east&west
//   Returns ground-station observations (gust, precip, hail flag) for a
//   single ET day across the bbox. Uses MADIS-fed Synoptic API.
//   Empty result when SYNOPTIC_TOKEN is unset (no error — silent skip).
interface SynopticQueryParams {
  date?: string;
  north?: string;
  south?: string;
  east?: string;
  west?: string;
}
app.get('/api/storm/synoptic-stations', async (req, res) => {
  try {
    const q = req.query as SynopticQueryParams;
    if (!q.date || !/^\d{4}-\d{2}-\d{2}$/.test(q.date)) {
      res.status(400).json({ error: 'date (YYYY-MM-DD) required' });
      return;
    }
    if (!q.north || !q.south || !q.east || !q.west) {
      res.status(400).json({ error: 'bbox (north/south/east/west) required' });
      return;
    }
    const dayWindow = etDayUtcWindow(q.date);
    const result = await corroborateSynopticObservations({
      bbox: {
        minLat: parseFloat(q.south),
        minLng: parseFloat(q.west),
        maxLat: parseFloat(q.north),
        maxLng: parseFloat(q.east),
      },
      startUtc: dayWindow.startUtc,
      endUtc: dayWindow.endUtc,
    });
    res.set('Cache-Control', 'public, max-age=900');
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[synoptic-stations] failed', err);
    res.status(500).json({ error: 'Failed to fetch Synoptic stations' });
  }
});

// GET /api/storm/mping?date=YYYY-MM-DD[&north&south&east&west]    historical
//   Returns mPING hail reports as the map layer + the 6th consilience source.
//   Returns empty array when MPING_API_TOKEN is unset (no error — silent skip).
interface MpingQuery {
  date?: string;
  windowMinutes?: string;
  north?: string;
  south?: string;
  east?: string;
  west?: string;
  category?: 'Hail' | 'Wind' | 'Tornado';
}

app.get('/api/storm/mping', async (req, res) => {
  try {
    const q = req.query as MpingQuery;
    const bounds =
      q.north && q.south && q.east && q.west
        ? {
            north: parseFloat(q.north),
            south: parseFloat(q.south),
            east: parseFloat(q.east),
            west: parseFloat(q.west),
          }
        : undefined;
    if (q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date)) {
      const reports = await fetchMpingReportsForDate({
        date: q.date,
        bounds,
        category: q.category ?? 'Hail',
      });
      res.set('Cache-Control', 'public, max-age=600');
      res.json({ ok: true, reports, configured: isMpingConfigured() });
      return;
    }
    const minutes = q.windowMinutes
      ? Math.min(720, Math.max(15, parseInt(q.windowMinutes, 10) || 60))
      : 60;
    const reports = await fetchRecentMpingReports({
      windowMinutes: minutes,
      bounds,
      category: q.category ?? 'Hail',
    });
    // Live feed — short cache so the map layer refreshes meaningfully.
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ ok: true, reports, configured: isMpingConfigured() });
  } catch (err) {
    console.error('[mping] failed', err);
    res.status(500).json({ error: 'Failed to fetch mPING reports' });
  }
});

// ── Cache visibility (admin) ───────────────────────────────────
// Anyone can hit it — the response is metadata only (counts + dates), no
// cached payloads. Useful for the admin dashboard and for quick "is the
// pre-warm working?" checks.
app.get('/api/admin/cache-status', requireAdmin, async (_req, res) => {
  try {
    const summary = await getCacheSummary();
    const total = summary.reduce((sum, row) => sum + row.total, 0);
    const live = summary.reduce((sum, row) => sum + row.live, 0);
    res.json({
      ok: true,
      totals: { total, live, expired: total - live },
      bySource: summary,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[cache-status] failed', err);
    res.status(500).json({ ok: false, error: 'Failed to read cache status' });
  }
});

app.post('/api/admin/cache-purge', requireAdmin, async (req, res) => {
  try {
    // ?force=1 deletes everything (used after palette / algorithm changes
    // so existing cached rows refresh with the new shape on next view).
    const force = req.query.force === '1' || req.query.force === 'true';
    const purged = await purgeExpiredSwaths(force);
    res.json({ ok: true, purged, force });
  } catch (err) {
    console.error('[cache-purge] failed', err);
    res.status(500).json({ ok: false, error: 'Failed to purge cache' });
  }
});

app.get('/api/admin/prewarm-status', requireAdmin, (_req, res) => {
  const enabled =
    process.env.HAIL_YES_PREWARM === '1' ||
    process.env.NODE_ENV === 'production';
  res.json(getPrewarmStatus(enabled));
});

// ── Push subscriptions ─────────────────────────────────────────
// POST /api/push/subscribe  — body: { endpoint, keys, repId?, territoryStates?, label? }
// DELETE /api/push/subscribe — body: { endpoint }
// GET /api/push/vapid-public — for the frontend to grab the VAPID public key
//   (also exposed as VITE_VAPID_PUBLIC_KEY at build time, but this endpoint
//   keeps the rotation story simpler — no rebuild needed when keys change).
app.get('/api/push/vapid-public', (_req, res) => {
  res.json({
    ok: isPushConfigured(),
    publicKey: getPublicVapidKey() || null,
  });
});

interface PushSubscribeBody {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
  repId?: string;
  territoryStates?: string[];
  label?: string;
}

app.post('/api/push/subscribe', async (req, res) => {
  try {
    const body = (req.body || {}) as PushSubscribeBody;
    if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
      res.status(400).json({ error: 'endpoint and keys required' });
      return;
    }
    const result = await upsertPushSubscription({
      endpoint: body.endpoint,
      keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
      repId: body.repId ?? null,
      territoryStates:
        body.territoryStates && body.territoryStates.length > 0
          ? body.territoryStates
          : ['VA', 'MD', 'PA', 'DE', 'NJ', 'DC'],
      userAgent: req.headers['user-agent'] ?? undefined,
      label: body.label,
    });
    if (!result.ok) {
      res.status(500).json({ error: result.error ?? 'subscribe failed' });
      return;
    }
    res.json({ ok: true, id: result.id });
  } catch (err) {
    console.error('[push/subscribe] failed', err);
    res.status(500).json({ error: 'subscribe failed' });
  }
});

app.delete('/api/push/subscribe', async (req, res) => {
  try {
    const body = (req.body || {}) as { endpoint?: string };
    if (!body.endpoint) {
      res.status(400).json({ error: 'endpoint required' });
      return;
    }
    const result = await deletePushSubscription(body.endpoint);
    res.json({ ok: result.ok });
  } catch (err) {
    console.error('[push/unsubscribe] failed', err);
    res.status(500).json({ error: 'unsubscribe failed' });
  }
});

app.get('/api/admin/push-status', requireAdmin, (_req, res) => {
  res.json(getPushFanoutStatus());
});

app.get('/api/admin/live-mrms-status', requireAdmin, (_req, res) => {
  res.json(getLiveMrmsAlertStatus());
});

app.get('/api/admin/consilience-cache-status', requireAdmin, async (_req, res) => {
  try {
    const { getConsilienceCacheStats } = await import('./storm/consilienceCache.js');
    res.json(await getConsilienceCacheStats());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/admin/consilience-cache-purge', requireAdmin, async (req, res) => {
  try {
    const days = Math.max(0, parseInt((req.query.days as string) ?? '0', 10) || 0);
    const { purgeStaleCache } = await import('./storm/consilienceCache.js');
    const purged = await purgeStaleCache(days);
    res.json({ ok: true, purged, daysOldThreshold: days });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// NCEI Storm Events drill-down — adjuster-facing search against the
// official NOAA archive. Backed by the verified_hail_events table; only
// rows with source_ncei_storm_events=TRUE are queried.
//   GET /api/admin/ncei-search?date=YYYY-MM-DD[&state=XX][&type=Hail][&min_size=N][&min_mph=N][&limit=N][&fmt=csv]
// Returns matching events sorted by magnitude desc. fmt=csv returns
// adjuster-friendly CSV instead of JSON.
interface NceiSearchQuery {
  date?: string;
  start_date?: string;
  end_date?: string;
  state?: string;
  type?: 'Hail' | 'Thunderstorm Wind' | 'Tornado' | 'Funnel Cloud';
  min_size?: string;
  min_mph?: string;
  limit?: string;
  fmt?: 'json' | 'csv';
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

app.get('/api/admin/ncei-search', requireAdmin, async (req, res) => {
  try {
    const q = req.query as NceiSearchQuery;
    const limit = Math.min(500, Math.max(1, parseInt(q.limit ?? '100', 10) || 100));

    // Build WHERE clauses dynamically. postgres-js's tagged-template binding
    // is awkward for variable WHERE — accumulate fragments.
    const filters: string[] = [`source_ncei_storm_events = TRUE`];
    const params: unknown[] = [];
    let p = 1;
    const add = (sql: string, val: unknown) => {
      filters.push(sql.replace('?', `$${p}`));
      params.push(val);
      p += 1;
    };

    if (q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date)) {
      add('event_date = ?::date', q.date);
    } else {
      if (q.start_date && /^\d{4}-\d{2}-\d{2}$/.test(q.start_date)) {
        add('event_date >= ?::date', q.start_date);
      }
      if (q.end_date && /^\d{4}-\d{2}-\d{2}$/.test(q.end_date)) {
        add('event_date <= ?::date', q.end_date);
      }
    }
    if (q.state && /^[A-Z]{2}$/i.test(q.state)) {
      add('state_code = ?', q.state.toUpperCase());
    }
    if (q.type) {
      add('event_type = ?', q.type);
    }
    if (q.min_size && Number.isFinite(parseFloat(q.min_size))) {
      add('hail_size_inches >= ?', parseFloat(q.min_size));
    }
    if (q.min_mph && Number.isFinite(parseFloat(q.min_mph))) {
      add(`(event_type IN ('Thunderstorm Wind','Strong Wind','High Wind') AND magnitude >= ?)`, parseFloat(q.min_mph));
    }

    const sqlText = `
      SELECT id, event_date::text, state_code, county, wfo,
             lat::real, lng::real, event_type, magnitude::real, magnitude_type,
             ncei_event_id, episode_id, narrative,
             begin_time_utc::text, end_time_utc::text
        FROM verified_hail_events
       WHERE ${filters.join(' AND ')}
       ORDER BY event_date DESC, magnitude DESC NULLS LAST
       LIMIT ${limit}
    `;
    const rows = await pgSql.unsafe(sqlText, params as never[]);

    if (q.fmt === 'csv') {
      // Adjuster-friendly column order — what gets dropped into a claim
      // package. Includes ncei_event_id so the row is officially citable.
      const headers = [
        'event_date',
        'state_code',
        'county',
        'lat',
        'lng',
        'event_type',
        'magnitude',
        'magnitude_type',
        'ncei_event_id',
        'episode_id',
        'wfo',
        'begin_time_utc',
        'end_time_utc',
        'narrative',
      ];
      const csv = [
        headers.join(','),
        ...rows.map((r: Record<string, unknown>) =>
          headers.map((h) => csvEscape(r[h])).join(','),
        ),
      ].join('\n');
      res.set('Content-Type', 'text/csv; charset=utf-8');
      const fname =
        (q.date ? `ncei-${q.date}` : 'ncei-search') +
        (q.state ? `-${q.state.toUpperCase()}` : '') +
        (q.type ? `-${q.type.replace(/\s+/g, '-')}` : '') +
        '.csv';
      res.set('Content-Disposition', `attachment; filename="${fname}"`);
      res.set('Cache-Control', 'public, max-age=300');
      res.send(csv);
      return;
    }

    res.set('Cache-Control', 'public, max-age=300');
    res.json({ ok: true, count: rows.length, events: rows });
  } catch (err) {
    console.error('[ncei-search] failed', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// Sanity-check endpoint for the NCEI backfill — returns counts + a small
// sample of hail events so we can verify the data lands and is queryable.
app.get('/api/admin/ncei-stats', requireAdmin, async (_req, res) => {
  try {
    const totals = await pgSql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE event_type = 'Hail')::int AS hail_count,
        COUNT(*) FILTER (WHERE event_type = 'Thunderstorm Wind')::int AS wind_count,
        COUNT(*) FILTER (WHERE event_type = 'Tornado')::int AS tornado_count,
        COUNT(*) FILTER (WHERE event_type = 'Funnel Cloud')::int AS funnel_count,
        MIN(event_date)::text AS earliest_date,
        MAX(event_date)::text AS latest_date,
        MAX(magnitude) FILTER (WHERE event_type = 'Hail')::real AS max_hail_inches,
        MAX(magnitude) FILTER (WHERE event_type IN ('Thunderstorm Wind','High Wind','Strong Wind'))::real AS max_wind_mph
        FROM verified_hail_events
       WHERE source_ncei_storm_events = TRUE
    `;
    const byState = await pgSql`
      SELECT state_code, COUNT(*)::int AS n
        FROM verified_hail_events
       WHERE source_ncei_storm_events = TRUE
       GROUP BY state_code
       ORDER BY n DESC
    `;
    const sampleHail = await pgSql`
      SELECT event_date::text, state_code, county, lat::real, lng::real,
             magnitude::real, magnitude_type, ncei_event_id, narrative
        FROM verified_hail_events
       WHERE source_ncei_storm_events = TRUE
         AND event_type = 'Hail'
       ORDER BY magnitude DESC NULLS LAST
       LIMIT 10
    `;
    res.json({ totals: totals[0], byState, sampleTopHail: sampleHail });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Lazy purge timer so expired rows don't accumulate. 6-hour cadence is
// plenty given the per-row index lookup we do on each read anyway.
setInterval(() => {
  void purgeExpiredSwaths();
}, 6 * 60 * 60 * 1000).unref();

// ── SPA fallback ────────────────────────────────────────
app.get('/report/:slug', (_req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

app.get('{*path}', (_req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

// Process-level safety net. Background tasks (backfills, push fanout, prewarm
// scheduler) can hit transient errors — undici socket drops mid-stream,
// upstream API hiccups, etc. Without these handlers, a single unhandled
// rejection in a background task tears down the whole server (Node 22's
// default for unhandled rejections is `throw`, which crashes the process).
// Log loudly, don't die.
process.on('unhandledRejection', (reason: unknown) => {
  console.error('[unhandledRejection]', reason instanceof Error ? reason.stack : reason);
});
process.on('uncaughtException', (err: Error) => {
  console.error('[uncaughtException]', err.stack);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] Hail Yes! running on port ${PORT}`);
  // Background workers are embedded by default. When running a separate
  // hail-yes-worker Railway service (npm run worker), set
  // HAIL_YES_DISABLE_WORKERS=1 on the web service so the workers only run
  // in one place.
  if (process.env.HAIL_YES_DISABLE_WORKERS === '1') {
    console.log('[server] HAIL_YES_DISABLE_WORKERS=1 — skipping embedded workers (run via worker service)');
  } else {
    startPrewarmScheduler();
    startPushFanout();
    startLiveMrmsAlertWorker();
  }
  // Optional NCEI backfill (BACKFILL_NCEI_ON_BOOT env). Fire-and-forget so
  // the server stays responsive while it runs.
  void maybeRunNceiBackfill();
});

async function maybeRunNceiBackfill(): Promise<void> {
  const flag = process.env.BACKFILL_NCEI_ON_BOOT?.trim();
  if (!flag) return;
  const years: number[] = [];
  const m = flag.match(/^(\d{4})-(\d{4})$/);
  if (m) {
    for (let y = parseInt(m[1], 10); y <= parseInt(m[2], 10); y++) years.push(y);
  } else if (/^\d{4}$/.test(flag)) {
    years.push(parseInt(flag, 10));
  } else {
    return; // sentinel value like "done" — silently skip
  }
  console.log(`[server] BACKFILL_NCEI_ON_BOOT=${flag} — running NCEI backfill in background…`);
  try {
    const { runNceiBackfill } = await import('../scripts/ncei-backfill.js');
    await runNceiBackfill({ years }, { closeSql: false });
    console.log(
      `[server] NCEI backfill finished — set BACKFILL_NCEI_ON_BOOT=done to stop re-running.`,
    );
  } catch (err) {
    console.error('[server] backfill failed:', err);
  }
}

// ── Cache cleanup ───────────────────────────────────────
// Run once 30 s after startup (lets DB connections settle), then every 6 hours.
setTimeout(async () => {
  try {
    const deleted = await purgeExpiredCache(db);
    console.log(`[cache] Initial cleanup: ${deleted} expired entries purged`);
  } catch { /* non-critical — ignore startup errors */ }
}, 30_000);

setInterval(async () => {
  try {
    const deleted = await purgeExpiredCache(db);
    if (deleted > 0) console.log(`[cache] Purged ${deleted} expired entries`);
  } catch (err) {
    console.error('[cache] Cleanup failed:', err);
  }
}, 6 * 60 * 60 * 1000); // 6 hours

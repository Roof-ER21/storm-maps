import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
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
import { fetchMesocyclones } from './storm/nceiNx3MdaClient.js';
import { corroborateSynopticObservations } from './storm/synopticObservationsService.js';
import { etDayUtcWindow } from './storm/timeUtils.js';
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
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const app = express();
app.set('trust proxy', 1);
const PORT = parseInt(process.env.PORT || '3100', 10);

app.use(express.json({ limit: '10mb' }));

// Rate limiting — global apiLimiter is generous (300 req / 15 min). The
// push-subscribe and admin endpoints get their own tighter buckets.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // 300 requests per window per IP
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

// Serve Vite build
app.use(express.static(path.join(__dirname, '../dist')));

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

/** Public-facing config endpoint — tells the SPA whether bootstrap requires a PIN. */
app.get('/api/auth/bootstrap-config', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({
    bootstrapPinRequired: Boolean(process.env.BOOTSTRAP_PIN?.trim()),
  });
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
  rep?: { name?: string; phone?: string; email?: string };
  company?: { name?: string };
  evidence?: Array<{
    imageUrl?: string;
    imageDataUrl?: string;
    title?: string;
    caption?: string;
  }>;
}

app.post('/api/hail/storm-report-pdf', async (req, res) => {
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
      rep: {
        name: body.rep?.name ?? 'Roof-ER21 Rep',
        phone: body.rep?.phone,
        email: body.rep?.email,
      },
      company: { name: body.company?.name ?? 'Roof-ER21' },
      evidence: body.evidence,
    });
    res.set('Content-Type', 'application/pdf');
    res.set(
      'Content-Disposition',
      `attachment; filename="StormReport_${body.address.replace(/[^a-zA-Z0-9]/g, '_')}_${body.dateOfLoss}.pdf"`,
    );
    res.send(pdf);
  } catch (err) {
    console.error('[storm-report-pdf] failed', err);
    res.status(500).json({ error: 'Failed to build PDF' });
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

interface MrmsImpactBody {
  date?: string;
  bounds?: { north: number; south: number; east: number; west: number };
  anchorTimestamp?: string;
  points?: Array<{ id: string; lat: number; lng: number }>;
}

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
    res.json(response);
  } catch (err) {
    console.error('[mrms-impact] failed', err);
    res.status(500).json({ error: 'Failed to compute MRMS impact' });
  }
});

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
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

app.get('{*path}', (_req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
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

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
import Stripe from 'stripe';

const JWT_SECRET = process.env.JWT_SECRET || 'hail-yes-dev-secret-change-in-production';
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const stripe = STRIPE_SECRET ? new Stripe(STRIPE_SECRET) : null;

const PRICE_IDS: Record<string, string> = {
  pro: process.env.STRIPE_PRICE_PRO || '',
  company: process.env.STRIPE_PRICE_COMPANY || '',
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '../uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const app = express();
app.set('trust proxy', 1);
const PORT = parseInt(process.env.PORT || '3000', 10);

// Stripe webhook needs raw body — must be before express.json()
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    res.status(503).json({ error: 'Stripe not configured' });
    return;
  }

  try {
    const sig = req.headers['stripe-signature'] as string;
    const event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      const plan = session.metadata?.plan || 'pro';
      if (userId) {
        const uid = parseInt(userId, 10);
        const cust = session.customer as string;
        const subId = session.subscription as string;
        await pgSql`UPDATE users SET plan = ${plan}, stripe_customer_id = ${cust}, stripe_subscription_id = ${subId} WHERE id = ${uid}`;
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as Stripe.Subscription;
      await pgSql`UPDATE users SET plan = 'free', stripe_subscription_id = NULL WHERE stripe_subscription_id = ${sub.id}`;
    }

    res.json({ received: true });
  } catch {
    res.status(400).json({ error: 'Webhook verification failed' });
  }
});

app.use(express.json({ limit: '10mb' }));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // 300 requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, try again later' },
});
app.use('/api/', apiLimiter);

// Serve Vite build
app.use(express.static(path.join(__dirname, '../dist')));

// ── Auth ────────────────────────────────────────────────
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, name, password } = req.body;
    if (!email || !name || !password || password.length < 6) {
      res.status(400).json({ error: 'Email, name, and password (6+ chars) required' });
      return;
    }

    const emailLower = email.toLowerCase().trim();
    const existing = await pgSql`SELECT id FROM users WHERE email = ${emailLower}`;
    if (existing.length > 0) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    const hash = await bcrypt.hash(password, 10);
    const nameTrimmed = name.trim();
    const result = await pgSql`INSERT INTO users (email, name, password_hash) VALUES (${emailLower}, ${nameTrimmed}, ${hash}) RETURNING id, email, name, plan`;
    const user = result[0] as { id: number; email: string; name: string; plan: string };
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });

    res.json({ ok: true, token, user: { id: user.id, email: user.email, name: user.name, plan: user.plan } });
  } catch {
    res.status(500).json({ error: 'Failed to create account' });
  }
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

// ── Billing ─────────────────────────────────────────────
function verifyToken(authHeader: string | undefined): { userId: number; email: string } | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(authHeader.slice(7), JWT_SECRET) as { userId: number; email: string };
  } catch {
    return null;
  }
}

app.post('/api/billing/checkout', async (req, res) => {
  if (!stripe) {
    res.status(503).json({ error: 'Stripe not configured. Set STRIPE_SECRET_KEY env var.' });
    return;
  }

  const user = verifyToken(req.headers.authorization);
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  const plan = req.body.plan || 'pro';
  const priceId = PRICE_IDS[plan];
  if (!priceId) {
    res.status(400).json({ error: `No Stripe price configured for plan: ${plan}. Set STRIPE_PRICE_PRO or STRIPE_PRICE_COMPANY env vars.` });
    return;
  }

  try {
    const origin = req.headers.origin || `https://${req.headers.host}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/?billing=success`,
      cancel_url: `${origin}/?billing=cancel`,
      metadata: { userId: String(user.userId), plan },
      customer_email: user.email,
    });

    res.json({ url: session.url });
  } catch {
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

app.post('/api/billing/portal', async (req, res) => {
  if (!stripe) {
    res.status(503).json({ error: 'Stripe not configured' });
    return;
  }

  const user = verifyToken(req.headers.authorization);
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    const result = await pgSql`SELECT stripe_customer_id FROM users WHERE id = ${user.userId}`;
    const row = result[0] as { stripe_customer_id: string | null } | undefined;
    if (!row?.stripe_customer_id) {
      res.status(400).json({ error: 'No billing account found. Subscribe first.' });
      return;
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const session = await stripe.billingPortal.sessions.create({
      customer: row.stripe_customer_id,
      return_url: origin,
    });

    res.json({ url: session.url });
  } catch {
    res.status(500).json({ error: 'Failed to create portal session' });
  }
});

app.get('/api/billing/status', async (req, res) => {
  const user = verifyToken(req.headers.authorization);
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    const result = await pgSql`SELECT plan, stripe_customer_id, stripe_subscription_id FROM users WHERE id = ${user.userId}`;
    const row = result[0] as { plan: string; stripe_customer_id: string | null; stripe_subscription_id: string | null } | undefined;
    res.json({
      plan: row?.plan || 'free',
      hasSubscription: Boolean(row?.stripe_subscription_id),
    });
  } catch {
    res.status(500).json({ error: 'Failed to check billing' });
  }
});

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
    for (const item of items) {
      const id = item.id as string;
      const existing = await db.select().from(leads).where(eq(leads.id, id));
      if (existing.length === 0) {
        await db.insert(leads).values(item as typeof leads.$inferInsert);
      } else {
        await db.update(leads).set({ ...item, updatedAt: new Date() }).where(eq(leads.id, id));
      }
    }
    res.json({ ok: true, synced: items.length });
  } catch {
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
        sourceLabel: 'NOAA SWDI', topHailInches: 2.0, reportCount: 14, evidenceCount: 4,
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
        sourceLabel: 'NOAA SWDI', topHailInches: 1.75, reportCount: 9, evidenceCount: 3,
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
        sourceLabel: 'NOAA SWDI', topHailInches: 2.5, reportCount: 18, evidenceCount: 2,
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
        sourceLabel: 'NOAA SWDI', topHailInches: 1.5, reportCount: 7, evidenceCount: 1,
        priority: 'Monitor', status: 'queued', outcome: 'none', leadStage: 'new',
        notes: '', assignedRep: 'Ahmed M.',
        stageHistory: JSON.stringify([{ stage: 'new', at: day(2) }]),
        homeownerName: 'Karen Mitchell', homeownerPhone: '202-555-0456', homeownerEmail: 'karen.m@example.com',
      },
      {
        id: 'dmv-lead-5', propertyLabel: '14300 Layhill Rd, Silver Spring, MD', stormDate: '2026-03-15',
        stormLabel: 'Sun, Mar 15, 2026', lat: 39.0812, lng: -77.0453, locationLabel: 'Montgomery County, MD',
        sourceLabel: 'NOAA SWDI', topHailInches: 1.0, reportCount: 4, evidenceCount: 0,
        priority: 'Low', status: 'queued', outcome: 'none', leadStage: 'new',
        notes: '', assignedRep: '',
        stageHistory: JSON.stringify([{ stage: 'new', at: day(1) }]),
        homeownerName: 'William Park', homeownerPhone: '', homeownerEmail: 'wpark@example.com',
      },
      {
        id: 'dmv-lead-6', propertyLabel: '2300 Wilson Blvd, Arlington, VA', stormDate: '2026-03-22',
        stormLabel: 'Sun, Mar 22, 2026', lat: 38.8882, lng: -77.0846, locationLabel: 'Arlington County, VA',
        sourceLabel: 'NOAA SWDI', topHailInches: 3.0, reportCount: 22, evidenceCount: 5,
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
        sourceLabel: 'NOAA SWDI', topHailInches: 2.0, reportCount: 11, evidenceCount: 0,
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
        sourceLabel: 'NOAA SWDI', topHailInches: 1.75, reportCount: 8, evidenceCount: 2,
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

    const demoEvidence = [
      { id: 'dmv-ev-1', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '4521 Elm St, Bethesda, MD', stormDate: '2026-03-15', title: 'Ridge cap cracking — south face', notes: 'Multiple shingles cracked along ridge line. Hail impact marks visible.', status: 'approved', includeInReport: true },
      { id: 'dmv-ev-2', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '4521 Elm St, Bethesda, MD', stormDate: '2026-03-15', title: 'Gutter dents — front elevation', notes: 'Quarter-sized dents on aluminum gutters. Consistent with 2" hail.', status: 'approved', includeInReport: true },
      { id: 'dmv-ev-3', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '4521 Elm St, Bethesda, MD', stormDate: '2026-03-15', title: 'Soft metal test — downspout', notes: 'Clear hail dimpling on downspout elbow.', status: 'approved', includeInReport: true },
      { id: 'dmv-ev-4', kind: 'provider-query', provider: 'youtube', mediaType: 'video', propertyLabel: '4521 Elm St, Bethesda, MD', stormDate: '2026-03-15', title: 'Bethesda MD Hail Storm March 2026', notes: 'Local news coverage of the storm.', externalUrl: 'https://www.youtube.com/watch?v=example1', status: 'pending', includeInReport: false },
      { id: 'dmv-ev-5', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '1825 Columbia Pike, Arlington, VA', stormDate: '2026-03-15', title: 'Shingle bruising — 3-tab section', notes: 'Granule loss visible on east-facing slope. Test square marked.', status: 'approved', includeInReport: true },
      { id: 'dmv-ev-6', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '1825 Columbia Pike, Arlington, VA', stormDate: '2026-03-15', title: 'Vent boot crack', notes: 'Pipe vent boot cracked from impact. Active leak risk.', status: 'approved', includeInReport: true },
      { id: 'dmv-ev-7', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '1825 Columbia Pike, Arlington, VA', stormDate: '2026-03-15', title: 'Siding impact marks', notes: 'Vinyl siding shows circular impact craters on north wall.', status: 'pending', includeInReport: false },
      { id: 'dmv-ev-8', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '9102 Riggs Rd, Adelphi, MD', stormDate: '2026-03-22', title: 'Chalk circle test — shingle mat exposed', notes: 'Marked 8 impacts in 10x10 test square. Mat visible through granule loss.', status: 'approved', includeInReport: true },
      { id: 'dmv-ev-9', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '9102 Riggs Rd, Adelphi, MD', stormDate: '2026-03-22', title: 'Window screen damage', notes: 'Holes punched through window screen by large hail.', status: 'approved', includeInReport: true },
      { id: 'dmv-ev-10', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '6700 Georgia Ave NW, Washington, DC', stormDate: '2026-03-22', title: 'Skylight seal damage', notes: 'Skylight flashing bent, sealant cracked.', status: 'pending', includeInReport: false },
      { id: 'dmv-ev-11', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '2300 Wilson Blvd, Arlington, VA', stormDate: '2026-03-22', title: 'Full roof overview — drone shot', notes: 'Drone overview showing widespread granule loss across entire roof.', status: 'approved', includeInReport: true },
      { id: 'dmv-ev-12', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '2300 Wilson Blvd, Arlington, VA', stormDate: '2026-03-22', title: 'Ridge vent cracking', notes: 'Ridge vent plastic cracked in 3 locations.', status: 'approved', includeInReport: true },
      { id: 'dmv-ev-13', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '2300 Wilson Blvd, Arlington, VA', stormDate: '2026-03-22', title: 'AC condenser fin damage', notes: 'Condenser fins bent/flattened from hail impact.', status: 'approved', includeInReport: true },
      { id: 'dmv-ev-14', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '2300 Wilson Blvd, Arlington, VA', stormDate: '2026-03-22', title: 'Fence cap rail dents', notes: 'Metal fence cap rail with clear hail dents. Good soft metal reference.', status: 'approved', includeInReport: true },
      { id: 'dmv-ev-15', kind: 'provider-query', provider: 'youtube', mediaType: 'video', propertyLabel: '2300 Wilson Blvd, Arlington, VA', stormDate: '2026-03-22', title: 'Arlington VA Tennis Ball Hail March 2026', notes: 'Resident video of 3" hail falling.', externalUrl: 'https://www.youtube.com/watch?v=example2', status: 'pending', includeInReport: false },
      { id: 'dmv-ev-16', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '5500 Franconia Rd, Alexandria, VA', stormDate: '2026-03-15', title: 'Shingle mat exposure — test square', notes: 'Test square showing 12 impacts with granule displacement.', status: 'approved', includeInReport: true },
      { id: 'dmv-ev-17', kind: 'upload', provider: 'upload', mediaType: 'image', propertyLabel: '5500 Franconia Rd, Alexandria, VA', stormDate: '2026-03-15', title: 'Gutter splash guard dents', notes: 'Aluminum splash guards dented along entire front gutter run.', status: 'approved', includeInReport: true },
    ];

    // Upsert leads
    for (const lead of demoLeads) {
      const existing = await db.select().from(leads).where(eq(leads.id, lead.id));
      if (existing.length === 0) {
        await db.insert(leads).values(lead as typeof leads.$inferInsert);
      }
    }

    // Upsert evidence
    for (const ev of demoEvidence) {
      await pgSql`
        INSERT INTO evidence (id, kind, provider, media_type, property_label, storm_date, title, notes, external_url, status, include_in_report)
        VALUES (${ev.id}, ${ev.kind}, ${ev.provider}, ${ev.mediaType}, ${ev.propertyLabel}, ${ev.stormDate}, ${ev.title}, ${ev.notes || ''}, ${ev.externalUrl || ''}, ${ev.status}, ${ev.includeInReport})
        ON CONFLICT (id) DO NOTHING
      `;
    }

    res.json({ ok: true, seededLeads: demoLeads.length, seededEvidence: demoEvidence.length });
  } catch (err) {
    console.error('Demo seed error:', err);
    res.status(500).json({ error: 'Failed to seed demo data' });
  }
});

// ── SPA fallback ────────────────────────────────────────
app.get('/report/:slug', (_req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

app.get('{*path}', (_req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] Hail Yes! running on port ${PORT}`);
});

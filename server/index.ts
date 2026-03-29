import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import { db } from './db.js';
import { leads, properties, evidence, archives, reps, shareableReports } from './schema.js';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '../uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

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
    const now = new Date();
    const demoLeads = [
      {
        id: 'demo-lead-1',
        propertyLabel: 'Dallas, TX',
        stormDate: '2024-05-28',
        stormLabel: 'Tue, May 28, 2024',
        lat: 32.7767,
        lng: -96.797,
        locationLabel: 'Dallas County, TX',
        sourceLabel: 'NOAA SWDI',
        topHailInches: 1.75,
        reportCount: 12,
        evidenceCount: 3,
        priority: 'Knock now',
        status: 'completed',
        outcome: 'inspection_booked',
        leadStage: 'won',
        dealValue: 18500,
        notes: 'Full roof replacement approved. Insurance paid out. Install scheduled for next week.',
        reminderAt: now.toISOString().slice(0, 10),
        assignedRep: 'Mike R.',
        stageHistory: JSON.stringify([
          { stage: 'new', at: new Date(Date.now() - 14 * 86400000).toISOString() },
          { stage: 'contacted', at: new Date(Date.now() - 12 * 86400000).toISOString() },
          { stage: 'inspection_set', at: new Date(Date.now() - 8 * 86400000).toISOString() },
          { stage: 'won', at: new Date(Date.now() - 2 * 86400000).toISOString() },
        ]),
        homeownerName: 'Sarah Johnson',
        homeownerPhone: '214-555-0142',
        homeownerEmail: 'sarah.j@example.com',
      },
      {
        id: 'demo-lead-2',
        propertyLabel: 'Dallas, TX',
        stormDate: '2024-05-28',
        stormLabel: 'Tue, May 28, 2024',
        lat: 32.7830,
        lng: -96.8100,
        locationLabel: 'Garland, TX',
        sourceLabel: 'NOAA SWDI',
        topHailInches: 2.0,
        reportCount: 8,
        evidenceCount: 2,
        priority: 'Knock now',
        status: 'visited',
        outcome: 'inspection_booked',
        leadStage: 'inspection_set',
        dealValue: 22000,
        notes: 'Adjuster meeting Thursday 2 PM. Shingles cracked on south face.',
        reminderAt: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        assignedRep: 'Mike R.',
        stageHistory: JSON.stringify([
          { stage: 'new', at: new Date(Date.now() - 7 * 86400000).toISOString() },
          { stage: 'contacted', at: new Date(Date.now() - 5 * 86400000).toISOString() },
          { stage: 'inspection_set', at: new Date(Date.now() - 1 * 86400000).toISOString() },
        ]),
        homeownerName: 'Robert Chen',
        homeownerPhone: '972-555-0198',
        homeownerEmail: 'rchen@example.com',
      },
      {
        id: 'demo-lead-3',
        propertyLabel: 'Dallas, TX',
        stormDate: '2025-06-01',
        stormLabel: 'Sun, Jun 1, 2025',
        lat: 32.7510,
        lng: -97.0820,
        locationLabel: 'Arlington, TX',
        sourceLabel: 'NOAA SWDI',
        topHailInches: 3.0,
        reportCount: 15,
        evidenceCount: 0,
        priority: 'Knock now',
        status: 'visited',
        outcome: 'follow_up',
        leadStage: 'contacted',
        notes: 'Left door hanger. Neighbor said they\'re usually home after 5 PM.',
        reminderAt: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
        assignedRep: 'Lisa T.',
        stageHistory: JSON.stringify([
          { stage: 'new', at: new Date(Date.now() - 3 * 86400000).toISOString() },
          { stage: 'contacted', at: new Date(Date.now() - 1 * 86400000).toISOString() },
        ]),
        homeownerName: 'David Martinez',
        homeownerPhone: '817-555-0267',
        homeownerEmail: '',
      },
      {
        id: 'demo-lead-4',
        propertyLabel: 'Dallas, TX',
        stormDate: '2025-06-01',
        stormLabel: 'Sun, Jun 1, 2025',
        lat: 32.8140,
        lng: -96.8720,
        locationLabel: 'Irving, TX',
        sourceLabel: 'NOAA SWDI',
        topHailInches: 2.5,
        reportCount: 9,
        evidenceCount: 1,
        priority: 'Knock now',
        status: 'queued',
        outcome: 'interested',
        leadStage: 'new',
        notes: '',
        assignedRep: 'Lisa T.',
        stageHistory: JSON.stringify([
          { stage: 'new', at: new Date(Date.now() - 1 * 86400000).toISOString() },
        ]),
        homeownerName: 'Jennifer Williams',
        homeownerPhone: '',
        homeownerEmail: 'jen.w@example.com',
      },
      {
        id: 'demo-lead-5',
        propertyLabel: 'Dallas, TX',
        stormDate: '2024-05-28',
        stormLabel: 'Tue, May 28, 2024',
        lat: 32.7950,
        lng: -96.7550,
        locationLabel: 'Mesquite, TX',
        sourceLabel: 'NOAA SWDI',
        topHailInches: 1.5,
        reportCount: 6,
        evidenceCount: 0,
        priority: 'Monitor',
        status: 'completed',
        outcome: 'interested',
        leadStage: 'lost',
        notes: 'Homeowner went with another contractor. Follow up in 6 months for warranty issues.',
        assignedRep: 'Mike R.',
        stageHistory: JSON.stringify([
          { stage: 'new', at: new Date(Date.now() - 10 * 86400000).toISOString() },
          { stage: 'contacted', at: new Date(Date.now() - 8 * 86400000).toISOString() },
          { stage: 'lost', at: new Date(Date.now() - 3 * 86400000).toISOString() },
        ]),
        homeownerName: 'Tom Anderson',
        homeownerPhone: '469-555-0311',
        homeownerEmail: 'tom.a@example.com',
      },
    ];

    for (const lead of demoLeads) {
      const existing = await db.select().from(leads).where(eq(leads.id, lead.id));
      if (existing.length === 0) {
        await db.insert(leads).values(lead as typeof leads.$inferInsert);
      }
    }

    res.json({ ok: true, seeded: demoLeads.length });
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

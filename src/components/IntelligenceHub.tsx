/**
 * Intelligence Hub — root container for the Roof Docs intel layer
 * inside the storm-maps React app.
 *
 * For Phase 1 of the migration: lazy-loads the static HTML pages via iframe,
 * gated behind the existing JWT auth (the parent React app already checks
 * auth, so reaching this component implies authorization).
 *
 * Phase 2: replace iframes with native React components in /src/intel/.
 * Phase 3: hook up role-based access (canvasser vs manager vs admin).
 *
 * The first native React component is Predictor (highest-leverage piece);
 * see ./intel/Predictor.tsx.
 */
import { useState } from 'react';
import { Predictor } from './intel/Predictor';
import { StormFeed } from './intel/StormFeed';
import { RefreshButton } from './intel/RefreshButton';

type IntelView =
  | 'home'
  | 'predictor'
  | 'field-guide'
  | 'exec'
  | 'map'
  | 'analytics'
  | 'customers'
  | 'campaigns'
  | 'resurrection'
  | 'receivables'
  | 'storm-exposure'
  | 'storm-playbook'
  | 'storm-intel'
  | 'adjusters'
  | 'adjuster-detail'
  | 'reps'
  | 'ops-team'
  | 'rep-response'
  | 'zip-intel'
  | 'hot-zips'
  | 'carrier-detail'
  | 'carrier-trades'
  | 'customer-detail'
  | 'property-lookup'
  | 'lead-score'
  | 'solar'
  | 'notes'
  | 'sms-reminders'
  | 'weekly-recap'
  | 'carrier-orphans'
  | 'cheat-sheet';

const VIEW_FILES: Record<Exclude<IntelView, 'home' | 'predictor'>, string> = {
  'field-guide': 'field-guide.html',
  'exec': 'exec.html',
  'map': 'roofdocs-map.html',
  'analytics': 'analytics.html',
  'customers': 'customers.html',
  'campaigns': 'upgrade-campaigns.html',
  'resurrection': 'resurrection.html',
  'receivables': 'receivables.html',
  'storm-exposure': 'storm-exposure.html',
  'storm-playbook': 'storm-playbook.html',
  'storm-intel': 'storm-intel.html',
  'adjusters': 'adjusters.html',
  'adjuster-detail': 'adjuster-detail.html',
  'reps': 'reps.html',
  'ops-team': 'ops-team.html',
  'rep-response': 'rep-response.html',
  'zip-intel': 'zip-intel.html',
  'hot-zips': 'hot-zips.html',
  'carrier-detail': 'carrier-detail.html',
  'carrier-trades': 'carrier-trades.html',
  'customer-detail': 'customer-detail.html',
  'property-lookup': 'property-lookup.html',
  'lead-score': 'lead-score.html',
  'solar': 'solar.html',
  'notes': 'notes.html',
  'sms-reminders': 'sms-reminders.html',
  'weekly-recap': 'weekly-recap.html',
  'carrier-orphans': 'carrier-orphans.html',
  'cheat-sheet': 'cheat-sheet.html',
};

const NAV_GROUPS: Array<{ label: string; items: Array<{ id: IntelView; label: string }> }> = [
  {
    label: 'Executive',
    items: [
      { id: 'home', label: '🏠 Home' },
      { id: 'exec', label: '📊 Exec Snapshot' },
      { id: 'weekly-recap', label: '📰 Weekly Recap' },
      { id: 'analytics', label: '📈 Analytics' },
    ],
  },
  {
    label: 'Smart Brain',
    items: [
      { id: 'predictor', label: '🔮 Predictor (native)' },
      { id: 'cheat-sheet', label: '🎓 Cheat Sheet' },
      { id: 'field-guide', label: '📖 Field Guide' },
      { id: 'lead-score', label: '🎯 Lead Score' },
    ],
  },
  {
    label: 'Maps & Geo',
    items: [
      { id: 'map', label: '📍 Project Map' },
      { id: 'hot-zips', label: '🔥 Hot ZIPs' },
      { id: 'zip-intel', label: '📋 ZIP Intel' },
      { id: 'property-lookup', label: '🔍 Property Lookup' },
    ],
  },
  {
    label: 'Outreach',
    items: [
      { id: 'resurrection', label: '🪦 Resurrection' },
      { id: 'storm-exposure', label: '⚡ Storm Exposure' },
      { id: 'storm-playbook', label: '🎯 Storm Playbook' },
      { id: 'storm-intel', label: '🌪 Storm Intel' },
      { id: 'campaigns', label: '📨 Campaigns' },
      { id: 'solar', label: '☀️ Solar Funnel' },
      { id: 'customers', label: '👥 Customers' },
      { id: 'customer-detail', label: '👤 Customer Detail' },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { id: 'adjusters', label: '📋 Adjusters' },
      { id: 'adjuster-detail', label: '📋 Adjuster Detail' },
      { id: 'carrier-detail', label: '🏢 Carrier Deep Dive' },
      { id: 'carrier-trades', label: '🧾 Carrier × Trade' },
      { id: 'reps', label: '🎯 Reps' },
      { id: 'rep-response', label: '⏱ Rep Response' },
      { id: 'ops-team', label: '👥 Ops Team' },
      { id: 'notes', label: '📝 Notes' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { id: 'receivables', label: '💰 AR / Money' },
      { id: 'sms-reminders', label: '📱 SMS Reminders' },
      { id: 'carrier-orphans', label: '🚧 Carrier Orphans' },
    ],
  },
];

export function IntelligenceHub() {
  const [view, setView] = useState<IntelView>('home');

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--riq-bg)', color: 'var(--riq-text)' }}>
      <aside
        style={{
          width: 240,
          background: 'var(--riq-surface)',
          borderRight: '1px solid var(--riq-border)',
          padding: '16px 12px',
          overflowY: 'auto',
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--riq-accent)', marginBottom: 2, letterSpacing: '0.02em' }}>
          RIQ 21
        </div>
        <div style={{ color: 'var(--riq-text-muted)', fontSize: 11, marginBottom: 14 }}>
          Roofing IQ · 16k jobs + 48k storms
        </div>
        {NAV_GROUPS.map((g) => (
          <div key={g.label} style={{ marginBottom: 14 }}>
            <div
              style={{
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: 'var(--riq-text-muted)',
                marginBottom: 6,
                padding: '0 4px',
              }}
            >
              {g.label}
            </div>
            {g.items.map((it) => (
              <button
                key={it.id}
                onClick={() => setView(it.id)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  background: view === it.id ? 'var(--riq-surface-elev)' : 'transparent',
                  border: view === it.id ? '1px solid var(--riq-accent)' : '1px solid transparent',
                  color: view === it.id ? 'var(--riq-accent)' : 'var(--riq-text)',
                  borderRadius: 4,
                  padding: '6px 10px',
                  fontSize: 12,
                  cursor: 'pointer',
                  marginBottom: 2,
                  fontFamily: 'inherit',
                }}
              >
                {it.label}
              </button>
            ))}
          </div>
        ))}
      </aside>
      <main style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {view === 'home' && <HomePane setView={setView} />}
        {view === 'predictor' && <Predictor />}
        {view !== 'home' && view !== 'predictor' && (
          <iframe
            key={view}
            src={`/${VIEW_FILES[view]}`}
            style={{ width: '100%', height: '100%', border: 0, background: 'var(--riq-bg)' }}
            title={view}
          />
        )}
      </main>
    </div>
  );
}

function HomePane({ setView }: { setView: (v: IntelView) => void }) {
  return (
    <div style={{ padding: '32px 36px', overflowY: 'auto', height: '100%' }}>
      <h1 style={{ fontSize: 30, fontWeight: 800, color: 'var(--riq-accent)', margin: 0, letterSpacing: '-0.01em' }}>
        RIQ 21 — Roofing IQ Command Center
      </h1>
      <p style={{ color: 'var(--riq-text-muted)', fontSize: 13, marginTop: 6, marginBottom: 24 }}>
        Internal sales + ops intelligence for The Roof Docs. 16,302 jobs · 48,449 storm events ·
        458 carriers · 346 named adjusters · 12,225 deduped customers. Refreshes nightly from the
        portal.
      </p>

      <RefreshButton />

      <StormFeed />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16,
          marginBottom: 32,
        }}
      >
        <Tile
          icon="🔮"
          title="Score a Lead"
          desc="Carrier × ZIP × hail × adjuster × days → approval probability + research-backed playbook moves."
          onClick={() => setView('predictor')}
        />
        <Tile
          icon="📖"
          title="Field Guide"
          desc="9 tabs of patterns + industry thresholds + state-by-state plays."
          onClick={() => setView('field-guide')}
        />
        <Tile
          icon="🪦"
          title="Resurrection List"
          desc="Dead insurance jobs with NEW storm activity since they died."
          onClick={() => setView('resurrection')}
        />
        <Tile
          icon="⚡"
          title="Storm Exposure"
          desc="Customers in your book whose homes got hit by strong storms since first contact."
          onClick={() => setView('storm-exposure')}
        />
        <Tile
          icon="🎯"
          title="Storm Playbook"
          desc="Pick a recent strong storm → trade-gap call list per affected customer."
          onClick={() => setView('storm-playbook')}
        />
        <Tile
          icon="📊"
          title="Exec Snapshot"
          desc="One-page intelligence brief for leadership review."
          onClick={() => setView('exec')}
        />
      </div>

      <div
        style={{
          background: 'var(--riq-surface)',
          border: '1px solid var(--riq-border)',
          borderRadius: 8,
          padding: '16px 20px',
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        <strong style={{ color: 'var(--riq-accent)' }}>About RIQ 21:</strong> data refreshes nightly
        at 3:33 AM ET from portal.theroofdocs.com via{' '}
        <code style={{ color: 'var(--riq-orange)' }}>refresh-all.sh</code>. Patterns are mined from
        16k real jobs; thresholds and plays are validated against industry research (HAAG,
        RoofPredict, NCEI, NAIC complaint data). The Predictor combines historical lookup with
        encoded industry rules to forecast approval per lead. Live storm activity is fed from{' '}
        <a href="https://hailyes.up.railway.app" target="_blank" rel="noreferrer" style={{ color: 'var(--riq-orange)' }}>
          Hail Yes
        </a>{' '}
        — this app focuses on intel, not radar.
      </div>
    </div>
  );
}

function Tile({
  icon,
  title,
  desc,
  onClick,
}: {
  icon: string;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'var(--riq-surface)',
        border: '1px solid var(--riq-border)',
        borderRadius: 10,
        padding: '18px 22px',
        textAlign: 'left',
        color: 'inherit',
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--riq-accent)';
        e.currentTarget.style.background = 'var(--riq-surface-elev)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--riq-border)';
        e.currentTarget.style.background = 'var(--riq-surface)';
      }}
    >
      <div style={{ fontSize: 22, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{title}</div>
      <div style={{ color: 'var(--riq-text-muted)', fontSize: 12 }}>{desc}</div>
    </button>
  );
}
